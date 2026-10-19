// Probe: what does the video_model response actually contain?
const fs = require("fs");
const path = require("path");
const { transpile } = require("./transpile");
const CACHE = transpile("signer-probe");

const { sign, newDevice } = require(path.join(CACHE, "data/signer.js"));
const VIDEO_API = "https://api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/";

(async () => {
    const device = newDevice();
    const videoId = process.argv[2] || "";
    const payload = JSON.stringify({
        biz_param: {
            detail_page_version: 0,
            device_level: 3,
            disable_digg_stat: false,
            need_all_video_definition: true,
            need_mp4_align: false,
            use_os_player: false,
            use_server_dns: false,
            video_platform: 1024,
        },
        video_id: videoId,
    });
    const body = new TextEncoder().encode(payload);
    const signed = sign(VIDEO_API, device, body);
    const resp = await fetch(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
    });
    const text = await resp.text();
    console.log("video_model status:", resp.status, "len:", text.length);
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        console.log("non-json body:", text.slice(0, 400));
        return;
    }
    console.log("code:", data.code);
    const map = data.data || {};
    let model = map.video_model;
    if (typeof model === "string") model = JSON.parse(model);
    const fallbackRaw = model && model.fallback_api;
    let fallbackUrl = "";
    if (typeof fallbackRaw === "string") fallbackUrl = fallbackRaw;
    else if (fallbackRaw && fallbackRaw.fallback_api) fallbackUrl = fallbackRaw.fallback_api;
    else if (Array.isArray(fallbackRaw)) fallbackUrl = fallbackRaw[0] || "";
    fallbackUrl = String(fallbackUrl).replace(/\\\//g, "/").replace(/\\u002F/g, "/");
    console.log("fallback_url:", fallbackUrl.slice(0, 120));

    const sresp = await fetch(fallbackUrl, {
        headers: { "User-Agent": "com.phoenix.read/71332" },
    });
    const stext = await sresp.text();
    const sdata = JSON.parse(stext);
    const info = sdata.video_info && sdata.video_info.data;
    if (!info) {
        console.log("no video_info.data; keys:", Object.keys(sdata));
        return;
    }
    console.log("info keys:", Object.keys(info));
    console.log("key_seed:", JSON.stringify(info.key_seed), "len:", (info.key_seed || "").length);
    const vlist = info.video_list || {};
    const codecCount = {};
    for (const [k, v] of Object.entries(vlist)) {
        codecCount[v.codec_type] = (codecCount[v.codec_type] || 0) + 1;
    }
    console.log("video_list entries:", Object.keys(vlist).length);
    console.log("codec breakdown:", JSON.stringify(codecCount));
    for (const [k, v] of Object.entries(vlist)) {
        console.log(
            "  ", k,
            "| codec:", v.codec_type,
            "| def:", v.definition,
            "| spade_a:", v.spade_a ? "yes(" + String(v.spade_a).length + ")" : "no",
            "| main_url:", String(v.main_url || "").slice(0, 40)
        );
    }
    console.log("raw first entry keys:", Object.keys(Object.values(vlist)[0] || {}));
    for (const [k,v] of Object.entries(vlist)) console.log(k, "| def:", v.definition, "| size:", v.size, "bytes =", v.size? (v.size/1048576).toFixed(1)+"MB":"?", "| bitrate:", v.bitrate, "| duration:", info.video_duration, "| quality_type:", v.quality_type, "| vtype:", v.vtype);
})();
