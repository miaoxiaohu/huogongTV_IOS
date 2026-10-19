#!/usr/bin/env node
/**
 * Signer regression test.
 *
 *   node scripts/verify-signer.js          # offline: parse + hash vectors
 *   node scripts/verify-signer.js --live   # also hits the real API
 *
 * The offline part is the one that matters for CI: it transpiles
 * src/data/signer.ts with the exact React Native Babel preset Metro uses
 * (so a parse error fails here instead of on the iOS build) and checks MD5
 * and SM3 byte-for-byte against node:crypto, which is backed by OpenSSL.
 *
 * Why this exists: the TypeScript port of the Kotlin signer had a missing
 * closing brace, a duplicated MD5 implementation, big-endian message words
 * where MD5 needs little-endian, and an SM3 compression function that used
 * the wrong round-dependent FF/GG. Every one of those compiled fine and
 * failed silently at runtime.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const babel = require("@babel/core");

const ROOT = path.join(__dirname, "..");
const SIGNER = path.join(ROOT, "src/data/signer.ts");

// The transpiled output requires @babel/runtime, so it has to live inside the
// project for Node to resolve it.
const CACHE = path.join(ROOT, "node_modules", ".cache", "signer-verify");
fs.mkdirSync(CACHE, { recursive: true });
const tmpFile = (name) => path.join(CACHE, name + "-" + Date.now() + ".js");

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error("  FAIL " + msg);
};
const ok = (msg) => console.log("  ok   " + msg);

// ---------------------------------------------------------------------------
// 1. Parse with the React Native preset
// ---------------------------------------------------------------------------
console.log("== babel (react-native preset) ==");
let mod;
try {
    const src =
        fs.readFileSync(SIGNER, "utf8") +
        "\nexport const __md5 = md5;\nexport const __sm3 = sm3;\n";
    const out = babel.transformSync(src, {
        presets: ["module:@react-native/babel-preset"],
        filename: SIGNER,
        babelrc: false,
        configFile: false,
    });
    const tmp = tmpFile("signer");
    fs.writeFileSync(tmp, out.code, "utf8");
    mod = require(tmp);
    ok("signer.ts transpiles and loads");
} catch (e) {
    fail("signer.ts does not transpile:\n" + e.message);
    process.exit(1);
}

const md5 = mod.__md5;
const sm3 = mod.__sm3;
const hex = (b) => Buffer.from(b).toString("hex");

// ---------------------------------------------------------------------------
// 2. Hash vectors
// ---------------------------------------------------------------------------
console.log("== md5 vs node:crypto ==");
for (const len of [0, 1, 3, 55, 56, 57, 63, 64, 65, 100, 200, 1000]) {
    const buf = crypto.randomBytes(len);
    const got = hex(md5(new Uint8Array(buf)));
    const want = crypto.createHash("md5").update(buf).digest("hex");
    if (got === want) ok("md5 len=" + len);
    else fail("md5 len=" + len + " got " + got + " want " + want);
}
{
    const got = hex(md5(new TextEncoder().encode("abc")));
    const want = "900150983cd24fb0d6963f7d28e17f72";
    got === want ? ok('md5 "abc"') : fail('md5 "abc" got ' + got);
}

console.log("== sm3 vs node:crypto ==");
for (const len of [0, 1, 3, 55, 56, 57, 63, 64, 65, 100, 200, 1000]) {
    const buf = crypto.randomBytes(len);
    const got = hex(sm3(new Uint8Array(buf)));
    const want = crypto.createHash("sm3").update(buf).digest("hex");
    if (got === want) ok("sm3 len=" + len);
    else fail("sm3 len=" + len + " got " + got + " want " + want);
}
{
    const got = hex(sm3(new TextEncoder().encode("abc")));
    const want = "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0";
    got === want ? ok('sm3 "abc"') : fail('sm3 "abc" got ' + got);
}

// ---------------------------------------------------------------------------
// 3. Optional live smoke test
// ---------------------------------------------------------------------------
if (process.argv.includes("--live")) {
    console.log("== live api ==");
    // Transpile the whole src/ tree so relative imports keep working.
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
    const { ApiProvider } = require(path.join(CACHE, "data/api.js"));

    (async () => {
        const p = new ApiProvider({ category: "short" });
        let firstSeriesId = null;
        try {
            const home = await p.home(1);
            home.length > 0 ? ok("home(1) -> " + home.length + " items") : fail("home(1) empty");
            firstSeriesId = home[0] && home[0].id;
        } catch (e) {
            fail("home(1): " + e.message);
        }
        let firstEpisodeId = null;
        try {
            const id = firstSeriesId || "7694896136963755032";
            const detail = await p.detail(id);
            const eps = detail.episodes || [];
            eps.length > 0 ? ok("detail -> " + eps.length + " episodes") : fail("detail -> no episodes");
            firstEpisodeId = eps[0] && eps[0].id;
        } catch (e) {
            fail("detail: " + e.message);
        }
        try {
            if (!firstEpisodeId) throw new Error("no episode id");
            const pb = await p.resolve(firstEpisodeId);
            pb.uri && pb.uri.length > 16
                ? ok("resolve -> signed media url")
                : fail("resolve -> bad uri");
        } catch (e) {
            fail("resolve: " + e.message);
        }
        console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
        process.exit(failures ? 1 : 0);
    })();
} else {
    console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
    process.exit(failures ? 1 : 0);
}
