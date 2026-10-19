// Verify decryptUrl / deriveKey against a live signed response.
const fs = require("fs");
const path = require("path");
const { transpile } = require("./transpile");
const CACHE = transpile("signer-media");

const { sign, newDevice } = require(path.join(CACHE, "data/signer.js"));
const { decryptUrl, deriveKey, decodeBase64Url } = require(path.join(CACHE, "data/mediaCrypto.js"));
const VIDEO_API = "https://api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/";

(async () => {
    const episodeId = process.argv[2];
    const device = newDevice();
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
        video_id: episodeId,
    });
    const body = new TextEncoder().encode(payload);
    const signed = sign(VIDEO_API, device, body);
    const resp = await fetch(signed.url, { method: "POST", headers: signed.headers, body: signed.body });
    const data = JSON.parse(await resp.text());
    if (data.code !== 0) { console.log("video_model code:", data.code); return; }
    let model = data.data.video_model;
    if (typeof model === "string") model = JSON.parse(model);
    const raw = model.fallback_api;
    const fallback = typeof raw === "string" ? raw : raw.fallback_api || raw[0];
    const info = JSON.parse(await (await fetch(fallback.replace(/\\\//g, "/"), { headers: { "User-Agent": "com.phoenix.read/71332" } })).text()).video_info.data;

    const seed = decodeBase64Url(info.key_seed);
    console.log("key_seed bytes:", seed.length);
    const vlist = info.video_list;
    for (const [k, v] of Object.entries(vlist)) {
        const enc = v.main_url;
        let real = "";
        try {
            real = decryptUrl(enc, seed);
        } catch (e) {
            real = "ERROR: " + e.message;
        }
        console.log("\n" + k, "(" + v.definition + ")");
        console.log("  encrypted:", enc.slice(0, 50) + "...");
        console.log("  decrypted:", real.slice(0, 170));
        let key = null;
        try {
            key = deriveKey(v.spade_a);
            console.log("  content key:", Buffer.from(key).toString("hex"));
        } catch (e) {
            console.log("  deriveKey ERROR:", e.message);
        }
        if (real.startsWith("http")) {
            const r = await fetch(real, { headers: { "User-Agent": "com.phoenix.read/71332", Range: "bytes=0-4095" } });
            const buf = Buffer.from(await r.arrayBuffer());
            const s = buf.toString("latin1");
            console.log("  media status:", r.status, "| type:", r.headers.get("content-type"), "| len:", r.headers.get("content-length"));
            console.log("  box0:", buf.slice(4, 8).toString("latin1"), "| avcC:", s.includes("avcC"), "| hvcC:", s.includes("hvcC"), "| encv:", s.includes("encv"), "| sinf:", s.includes("sinf"), "| tenc:", s.includes("tenc"));
        }
    }
})();
