#!/usr/bin/env node
/**
 * End-to-end test of the shipping media pipeline.
 *
 *   node scripts/verify-media.js [episodeId]
 *
 * This runs the exact code the app runs - `ApiProvider.resolveStream` and
 * `prepareLocalMedia` - with the native file system replaced by a Node
 * implementation that writes to a real temp directory. The result is a real
 * MP4 on disk, which ffprobe then has to read and ffmpeg has to decode.
 *
 * The point of the chunked pipeline is that it produces the same bytes as
 * decrypting the whole file at once, so the test compares them byte for byte
 * before decoding anything.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { transpile, mockModule } = require("./transpile");

const ROOT = path.join(__dirname, "..");
const WORK = path.join(ROOT, "node_modules", ".cache", "media-verify");
const TMP = path.join(WORK, "fs");
fs.mkdirSync(TMP, { recursive: true });

// Start from an empty cache so the pipeline really runs every time.
for (const name of fs.existsSync(path.join(TMP, "hongguotv")) ? fs.readdirSync(path.join(TMP, "hongguotv")) : []) {
    fs.rmSync(path.join(TMP, "hongguotv", name), { force: true });
}

let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};

// ---------------------------------------------------------------------------
// A file system mock backed by a real directory
// ---------------------------------------------------------------------------
const mockPath = path.join(WORK, "file_access_mock.js");
fs.writeFileSync(
    mockPath,
    `const fs = require("fs");
const path = require("path");
const ROOT = ${JSON.stringify(TMP)};
const toBuffer = (data, encoding) =>
  Buffer.from(data, encoding === "base64" ? "base64" : "utf8");
module.exports = {
  Dirs: { CacheDir: ROOT, DocumentDir: ROOT },
  FileSystem: {
    mkdir: async (p) => { fs.mkdirSync(p, { recursive: true }); return p; },
    exists: async (p) => fs.existsSync(p),
    stat: async (p) => {
      const s = fs.statSync(p);
      return { size: s.size, filename: path.basename(p), path: p, type: s.isDirectory() ? "directory" : "file", lastModified: s.mtimeMs };
    },
    fetch: async (url, init, onProgress) => {
      const res = await fetch(url, { method: (init && init.method) || "GET", headers: init && init.headers });
      if (!res.ok) {
        return { ok: false, status: res.status, statusText: res.statusText, url, headers: {}, redirected: false, getHeader: () => undefined };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (init && init.path) fs.writeFileSync(init.path, buf);
      if (onProgress) onProgress(buf.length, buf.length, true);
      return { ok: true, status: res.status, statusText: res.statusText, url, headers: {}, redirected: false, getHeader: () => undefined };
    },
    readFileChunk: async (p, offset, length, encoding) => {
      const fd = fs.openSync(p, "r");
      const buf = Buffer.alloc(length);
      const read = fs.readSync(fd, buf, 0, length, offset);
      fs.closeSync(fd);
      const slice = buf.subarray(0, read);
      return encoding === "base64" ? slice.toString("base64") : slice.toString("utf8");
    },
    readFile: async (p, encoding) => fs.readFileSync(p, encoding === "base64" ? "base64" : "utf8"),
    writeFile: async (p, data, encoding) => fs.writeFileSync(p, toBuffer(data, encoding)),
    appendFile: async (p, data, encoding) => fs.appendFileSync(p, toBuffer(data, encoding)),
    cp: async (src, dst) => fs.copyFileSync(src, dst),
    mv: async (src, dst) => fs.renameSync(src, dst),
    unlink: async (p) => { if (fs.existsSync(p)) fs.unlinkSync(p); },
  },
};
`,
    "utf8"
);
mockModule("react-native-file-access", mockPath);

const cache = transpile("media-verify");
const { ApiProvider } = require(path.join(cache, "data/api.js"));
const { prepareLocalMedia } = require(path.join(cache, "data/media.js"));
const { prepare, decryptSamples } = require(path.join(cache, "data/cenc.js"));
const { base64Encode, base64Decode } = require(path.join(cache, "data/base64.js"));

function ffprobe(file) {
    try {
        return {
            ok: true,
            text: execFileSync(
                "ffprobe",
                ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height", "-of", "default=nw=1", file],
                { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
            ).trim(),
        };
    } catch (e) {
        return { ok: false, text: String((e.stderr || "") + (e.stdout || "")).trim() };
    }
}

function decodeFirstFrame(file, outPng) {
    try {
        execFileSync("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-y", outPng], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (e) {
        return { ok: false, text: String((e.stderr || "") + (e.stdout || "")).split("\n")[0] };
    }
    if (!fs.existsSync(outPng)) return { ok: false, text: "no frame produced" };
    const size = fs.statSync(outPng).size;
    return size > 1000 ? { ok: true, text: size + " byte PNG" } : { ok: false, text: "frame too small" };
}

(async () => {
    const episodeId = process.argv[2] || "7694655440692448281";
    console.log("== base64 round trip ==");
    for (const len of [0, 1, 2, 3, 4, 5, 255, 4096, 100000]) {
        const data = new Uint8Array(len);
        for (let i = 0; i < len; i++) data[i] = (i * 37 + 11) & 0xff;
        const back = base64Decode(base64Encode(data));
        let same = back.length === data.length;
        for (let i = 0; same && i < len; i++) if (back[i] !== data[i]) same = false;
        same ? ok("base64 len=" + len) : fail("base64 len=" + len);
    }
    {
        const rnd = require("crypto").randomBytes(5000);
        const back = base64Decode(base64Encode(new Uint8Array(rnd)));
        Buffer.from(back).equals(rnd) ? ok("base64 random 5000 bytes") : fail("base64 random");
    }

    console.log("== resolve stream ==");
    const provider = new ApiProvider({ category: "short", maxQuality: 720 });
    const stream = await provider.resolveStream(episodeId);
    ok("stream " + stream.quality + " " + stream.url.slice(0, 70) + "...");
    stream.key && stream.key.length === 16 ? ok("16 byte content key") : fail("bad content key");

    console.log("== chunked pipeline (the shipping code path) ==");
    const stages = [];
    const started = Date.now();
    const mark = () => Date.now() - started;
    const outPath = await prepareLocalMedia({
        url: stream.url,
        key: stream.key,
        headers: stream.headers,
        episodeId,
        quality: "720",
        onProgress: (p) => {
            if (stages.length === 0 || stages[stages.length - 1].message !== p.message) {
                stages.push(p);
                console.log("    [" + String(mark()).padStart(6) + " ms] " + p.message);
            }
        },
    });
    console.log("  took " + (Date.now() - started) + " ms");
    console.log("  stages: " + stages.map((s) => s.message).slice(0, 4).join(" | ") + " ...");
    const size = fs.statSync(outPath).size;
    console.log("  output: " + (size / 1048576).toFixed(2) + " MB at " + outPath);

    console.log("== ffprobe ==");
    const probe = ffprobe(outPath);
    console.log("  " + probe.text.replace(/\n/g, "\n  "));
    if (!probe.ok) fail("ffprobe could not read the output: " + probe.text);
    else ok("ffprobe reads the output");

    const frame = decodeFirstFrame(outPath, path.join(WORK, "frame.png"));
    console.log("  frame: " + (frame.ok ? frame.text : "FAILED " + frame.text));
    if (!frame.ok) fail("no decodable frame: " + frame.text);
    else ok("the output produces a real frame");

    console.log("== chunked result == whole file result ==");
    {
        // Download the same stream again and decrypt it in one piece, then
        // compare with what the chunked pipeline produced.
        const res = await fetch(stream.url, { headers: stream.headers });
        const whole = new Uint8Array(await res.arrayBuffer());
        const prepared = prepare(whole, stream.key);
        decryptSamples(prepared.header, prepared.samples, stream.key);
        const chunked = new Uint8Array(fs.readFileSync(outPath));
        let same = chunked.length === prepared.header.length;
        let firstDiff = -1;
        for (let i = 0; same && i < chunked.length; i++) {
            if (chunked[i] !== prepared.header[i]) {
                same = false;
                firstDiff = i;
            }
        }
        same
            ? ok("chunked output is byte identical to the whole file decrypt")
            : fail(
                "chunked output differs at byte " +
                    firstDiff +
                    " (lengths " +
                    chunked.length +
                    " vs " +
                    prepared.header.length +
                    ")"
            );
    }

    console.log("== cache behaviour ==");
    {
        // A second call without `fresh` must reuse the finished file.
        const again = await prepareLocalMedia({
            url: stream.url,
            key: stream.key,
            headers: stream.headers,
            episodeId,
            quality: "720",
        });
        again === outPath
            ? ok("the second call reuses the cached file")
            : fail("the second call did not reuse the cache");
    }
    {
        // A `fresh` call must throw the cached file away first, so a file
        // that failed to play can be replaced.
        let failed = false;
        try {
            await prepareLocalMedia({
                url: "https://127.0.0.1:1/nothing.mp4",
                key: stream.key,
                headers: stream.headers,
                episodeId,
                quality: "720",
                fresh: true,
            });
        } catch (e) {
            failed = true;
        }
        const stillThere = fs.existsSync(outPath);
        failed && !stillThere
            ? ok("a fresh run discards the cached file")
            : fail("fresh=" + failed + " cachedFileStillThere=" + stillThere);
    }

    console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
