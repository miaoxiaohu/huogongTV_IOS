#!/usr/bin/env node
/**
 * End-to-end media pipeline test.
 *
 *   node scripts/verify-cenc.js [episodeId]
 *
 * Runs the whole chain against the live API:
 *
 *   sign -> video_model -> fallback_api -> video_list
 *        -> decryptUrl(main_url, key_seed)   [the real CDN url]
 *        -> deriveKey(spade_a)               [the AES-CTR content key]
 *        -> download the encrypted MP4
 *        -> prepare()  [rewrite encv -> hvc1, sinf -> free]
 *        -> decryptSamples() [AES-CTR per sample]
 *        -> ffprobe the result
 *
 * The control group matters as much as the result: ffprobe must FAIL on the
 * encrypted input and SUCCEED on the decrypted output. A decrypted file that
 * ffprobe cannot read means the sample table or the CTR counter is wrong, and
 * a "successful" decrypt that produces garbage would otherwise look fine.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const babel = require("@babel/core");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "node_modules", ".cache", "cenc-verify");
const OUT = path.join(CACHE, "out");
fs.mkdirSync(OUT, { recursive: true });

const SRC = path.join(ROOT, "src");
const walk = (dir) => {
    const files = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) files.push(...walk(p));
        else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
    return files;
};
for (const file of walk(SRC)) {
    const out = babel.transformFileSync(file, {
        presets: ["module:@react-native/babel-preset"],
        filename: file,
        babelrc: false,
        configFile: false,
    }).code;
    const rel = path.relative(SRC, file).replace(/\.tsx?$/, ".js");
    const dest = path.join(CACHE, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out, "utf8");
}

const { sign, newDevice } = require(path.join(CACHE, "data/signer.js"));
const { decryptUrl, deriveKey, decodeBase64Url } = require(path.join(CACHE, "data/mediaCrypto.js"));
const { prepare, decryptSamples } = require(path.join(CACHE, "data/cenc.js"));

const VIDEO_API = "https://api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/";
const VIDEO_UA =
    "com.phoenix.read/71332 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)";

let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};

function qualityNumber(value) {
    const m = String(value).match(/2160|1440|1080|720|576|540|480|360/);
    if (m) return parseInt(m[0], 10);
    const map = { 1920: 1080, 1280: 720, 1024: 576, 854: 480, 640: 360 };
    return map[value] || parseInt(value, 10) || 0;
}

function ffprobe(file) {
    try {
        const out = execFileSync(
            "ffprobe",
            ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,duration", "-of", "default=nw=1", file],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
        return { ok: true, text: out.trim() };
    } catch (e) {
        const err = (e.stderr || "") + (e.stdout || "");
        return { ok: false, text: String(err).trim() };
    }
}

/**
 * Decodes the first video frame. This is the real control: ffprobe only reads
 * the container, so it happily reports the streams of an encrypted file too.
 * Only an actual frame decode proves the payload was decrypted.
 */
function decodeFirstFrame(file, outPng) {
    try {
        execFileSync(
            "ffmpeg",
            ["-v", "error", "-i", file, "-frames:v", "1", "-y", outPng],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
    } catch (e) {
        return { ok: false, text: String((e.stderr || "") + (e.stdout || "")).split("\n")[0] };
    }
    if (!fs.existsSync(outPng)) return { ok: false, text: "no frame produced" };
    const size = fs.statSync(outPng).size;
    if (size < 1000) return { ok: false, text: "frame too small (" + size + " bytes)" };
    return { ok: true, text: size + " byte PNG" };
}

(async () => {
    const episodeId = process.argv[2] || "7694655440692448281";
    console.log("== episode " + episodeId + " ==");

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
    if (data.code !== 0) {
        fail("video_model code " + data.code);
        process.exit(1);
    }
    let model = data.data.video_model;
    if (typeof model === "string") model = JSON.parse(model);
    const rawFallback = model.fallback_api;
    const fallback =
        typeof rawFallback === "string"
            ? rawFallback
            : Array.isArray(rawFallback)
            ? rawFallback[0]
            : rawFallback.fallback_api || rawFallback;
    const info = JSON.parse(
        await (
            await fetch(fallback.replace(/\\\//g, "/"), { headers: { "User-Agent": VIDEO_UA } })
        ).text()
    ).video_info.data;

    const seed = decodeBase64Url(info.key_seed);
    console.log("  key_seed: " + seed.length + " bytes");

    const rows = Object.entries(info.video_list)
        .map(([k, v]) => ({ k, v, q: qualityNumber(v.definition || v.quality_desc || v.height || v.vheight || v.quality || k) }))
        .filter((r) => r.v.main_url)
        .sort((a, b) => b.q - a.q);
    console.log("  renditions: " + rows.map((r) => r.k + "(" + r.v.codec_type + "," + r.q + "p)").join(" "));

    // Only ByteVC1 (HEVC) plays on iOS. ByteVC2 ships no codec record at all.
    const playable = rows.filter((r) => !/bytevc2|bvc2/i.test(r.v.codec_type || ""));
    if (!playable.length) {
        fail("no playable rendition");
        process.exit(1);
    }
    const selected = playable[0];
    console.log("  selected: " + selected.k + " " + selected.v.codec_type + " " + selected.q + "p");

    const url = decryptUrl(selected.v.main_url, seed);
    console.log("  media url: " + url.slice(0, 110) + "...");

    const key = deriveKey(selected.v.spade_a);
    console.log("  content key: " + Buffer.from(key).toString("hex"));

    console.log("== download ==");
    const t0 = Date.now();
    const mresp = await fetch(url, {
        headers: { "User-Agent": VIDEO_UA, Referer: "https://novel.snssdk.com/", "Accept-Encoding": "identity" },
    });
    if (!mresp.ok) {
        fail("media http " + mresp.status);
        process.exit(1);
    }
    const enc = new Uint8Array(await mresp.arrayBuffer());
    const encPath = path.join(OUT, "encrypted.mp4");
    fs.writeFileSync(encPath, enc);
    console.log("  downloaded " + (enc.length / 1048576).toFixed(2) + " MB in " + (Date.now() - t0) + " ms");

    const s = Buffer.from(enc).toString("latin1");
    console.log("  boxes: encv=" + s.includes("encv") + " sinf=" + s.includes("sinf") + " hvcC=" + s.includes("hvcC") + " avcC=" + s.includes("avcC") + " tenc=" + s.includes("tenc") + " pssh=" + s.includes("pssh"));

    console.log("== decrypt ==");
    const t1 = Date.now();
    const prepared = prepare(enc, key);
    ok("prepare: " + prepared.samples.length + " encrypted ranges");
    decryptSamples(prepared.header, prepared.samples, key);
    const dec = prepared.header;
    const decPath = path.join(OUT, "decrypted.mp4");
    fs.writeFileSync(decPath, dec);
    console.log("  decrypt took " + (Date.now() - t1) + " ms (" + (enc.length / 1048576 / ((Date.now() - t1) / 1000)).toFixed(2) + " MB/s)");

    const d = Buffer.from(dec).toString("latin1");
    console.log("  boxes: encv=" + d.includes("encv") + " sinf=" + d.includes("sinf") + " hvc1=" + d.includes("hvc1") + " avc1=" + d.includes("avc1") + " hvcC=" + d.includes("hvcC"));

    console.log("== ffprobe ==");
    const probe = ffprobe(decPath);
    console.log("  streams:\n    " + probe.text.replace(/\n/g, "\n    "));
    if (!probe.ok) fail("ffprobe could not read the decrypted file:\n    " + probe.text);

    console.log("== frame decode (the real control) ==");
    const encFrame = decodeFirstFrame(encPath, path.join(OUT, "enc_frame.png"));
    const decFrame = decodeFirstFrame(decPath, path.join(OUT, "dec_frame.png"));
    console.log("  encrypted -> " + (encFrame.ok ? "DECODED (unexpected!) " + encFrame.text : "fails as expected: " + encFrame.text));
    if (encFrame.ok) fail("the still-encrypted file produced a decodable frame");
    else ok("the encrypted payload does not decode");
    console.log("  decrypted -> " + (decFrame.ok ? "decodes: " + decFrame.text : "FAILED: " + decFrame.text));
    if (!decFrame.ok) fail("the decrypted file produced no decodable frame");
    else ok("the decrypted file produces a real frame");

    console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
    console.log("artifacts: " + OUT);
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
