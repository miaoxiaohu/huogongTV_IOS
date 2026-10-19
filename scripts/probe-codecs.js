// Probe: does the video_model endpoint return a plain (non-CENC) rendition
// when the client claims to be an OS player?
const fs = require("fs");
const path = require("path");
const { transpile } = require("./transpile");
const CACHE = transpile("signer-media");
const { sign, newDevice } = require(path.join(CACHE, "data/signer.js"));
const { decryptUrl, deriveKey, decodeBase64Url } = require(path.join(CACHE, "data/mediaCrypto.js"));
const VIDEO_API = "https://api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/";

const EPISODE = process.argv[2] || "7694655231191174169"; // episode #4 (no public mp4)

async function probe(label, bizParam) {
    const device = newDevice();
    const payload = JSON.stringify({ biz_param: bizParam, video_id: EPISODE });
    const body = new TextEncoder().encode(payload);
    const signed = sign(VIDEO_API, device, body);
    const resp = await fetch(signed.url, { method: "POST", headers: signed.headers, body: signed.body });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { console.log(label, "-> non-json", text.slice(0, 120)); return; }
    if (data.code !== 0) { console.log(label, "-> code", data.code); return; }
    let model = data.data.video_model;
    if (typeof model === "string") model = JSON.parse(model);
    const raw = model.fallback_api;
    const fallback = typeof raw === "string" ? raw : (raw.fallback_api || raw[0]);
    const info = JSON.parse(await (await fetch(fallback.replace(/\\\//g, "/"), { headers: { "User-Agent": "com.phoenix.read/71332" } })).text()).video_info.data;
    const codecs = {};
    for (const v of Object.values(info.video_list)) codecs[v.codec_type] = (codecs[v.codec_type] || 0) + 1;
    console.log(label, "-> codecs:", JSON.stringify(codecs), "| key_seed:", info.key_seed ? "yes" : "no");
    for (const [k, v] of Object.entries(info.video_list)) {
        const hasSpade = !!v.spade_a;
        let real = "";
        try { real = decryptUrl(v.main_url, decodeBase64Url(info.key_seed)); } catch (e) { real = "ERR " + e.message; }
        let enc = "?";
        if (real.startsWith("http")) {
            const r = await fetch(real, { headers: { "User-Agent": "com.phoenix.read/71332", Range: "bytes=0-4095" } });
            const buf = Buffer.from(await r.arrayBuffer());
            const s = buf.toString("latin1");
            enc = "encv=" + s.includes("encv") + " hvcC=" + s.includes("hvcC") + " avcC=" + s.includes("avcC");
        }
        console.log("   ", k, v.definition, "codec=" + v.codec_type, "spade=" + hasSpade, "|", enc);
        if (k === "video_1" || k === "video_5") {
            console.log("      backup_url_1:", String(v.backup_url_1 || "").slice(0, 100));
        }
    }
}

(async () => {
    const base = {
        detail_page_version: 0,
        device_level: 3,
        disable_digg_stat: false,
        need_all_video_definition: true,
        need_mp4_align: false,
        use_os_player: false,
        use_server_dns: false,
        video_platform: 1024,
    };
    await probe("baseline (use_os_player=false)", base);
    await probe("use_os_player=TRUE", { ...base, use_os_player: true });
    await probe("need_mp4_align=TRUE", { ...base, need_mp4_align: true });
    await probe("device_level=1", { ...base, device_level: 1 });
    await probe("video_platform=0", { ...base, video_platform: 0 });
})();
