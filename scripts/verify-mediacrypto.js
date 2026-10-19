#!/usr/bin/env node
/**
 * Tests for the media crypto: the url decryption and the content key.
 *
 *   node scripts/verify-mediacrypto.js
 *
 * The reference implementation below is a separate transliteration of
 * kotlin-tv/core/.../MediaCrypto.kt, written line by line from the Kotlin
 * with Java semantics for the signed byte and for Integer.bitCount. The code
 * under test is a different implementation of the same thing, so agreement
 * between them means the port matches the source it was ported from.
 *
 * The fixtures are real values captured from the live API, so the exact
 * server format is pinned down: a change in the algorithm breaks this test
 * instead of breaking playback on a device.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { transpile } = require("./transpile");

const CACHE = transpile("mediacrypto-verify");
const { decryptUrl, deriveKey, decodeBase64Url } = require(path.join(CACHE, "data/mediaCrypto.js"));

let failures = 0;
let checks = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};
const check = (label, condition, detail) => {
    checks++;
    condition ? ok(label) : fail(label + (detail ? " - " + detail : ""));
};

// ---------------------------------------------------------------------------
// The reference implementation, transliterated from MediaCrypto.kt
// ---------------------------------------------------------------------------

/** Java's Base64.getDecoder().decode(): strict, throws on anything odd. */
function javaDecode64(input) {
    const s = String(input).replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error("illegal base64");
    const body = s.replace(/=+$/, "");
    if (body.length % 4 === 1) throw new Error("last unit does not have enough valid bits");
    const out = Buffer.from(body, "base64");
    // Round trip check: Buffer is lenient, so verify the result re-encodes.
    if (out.toString("base64").replace(/=+$/, "") !== body) throw new Error("illegal base64");
    return out;
}

/** Kotlin's hex(): throws on a non hex digit. */
function kotlinHex(bytes) {
    if (bytes.length % 2 !== 0) throw new Error("odd length");
    const out = [];
    for (let i = 0; i < bytes.length; i += 2) {
        const pair = String.fromCharCode(bytes[i], bytes[i + 1]);
        if (!/^[0-9a-fA-F]{2}$/.test(pair)) throw new Error("not a hex digit: " + pair);
        out.push(parseInt(pair, 16));
    }
    return Buffer.from(out);
}

function bitCount(n) {
    let c = 0;
    let v = n;
    while (v) {
        c += v & 1;
        v >>>= 1;
    }
    return c;
}

/** MediaCrypto.deriveKey in the Kotlin. */
function kotlinDeriveKey(value) {
    const raw = javaDecode64(value);
    if (raw.length < 3) throw new Error("内容密钥格式异常");
    const length = Math.min(
        raw.length - ((raw[0] ^ raw[1] ^ raw[2]) & 0xff) + 47,
        raw.length - 1
    );
    if (length < 33) throw new Error("内容密钥格式异常");
    const work = raw.slice(1, 1 + length);
    let a = 85;
    let b = 246;
    for (let i = 0; i < work.length; i++) {
        const old = work[i] & 0xff;
        const previous = (i & 1) !== 0 ? a : b;
        if ((i & 1) !== 0) a = old;
        else b = old;
        work[i] = (-21 - bitCount(i) + (previous ^ old)) & 0xff;
    }
    return kotlinHex(work.slice(1, 33));
}

const URL_CONSTANTS = Buffer.from(
    "4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f" +
        "49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58",
    "hex"
);

/** MediaCrypto.decryptUrl in the Kotlin. */
function kotlinDecryptUrl(value, seed) {
    const raw = javaDecode64(value);
    if (raw.length < 20 || raw[0] !== 0xa8 || raw[2] !== 1 || raw[3] !== 0)
        throw new Error("播放地址格式异常");
    const inner = crypto.createHash("sha512").update(Buffer.from(seed)).digest();
    const h = crypto
        .createHash("sha512")
        .update(Buffer.concat([inner, URL_CONSTANTS]))
        .digest();
    const bodyLen = 4 + Math.floor((raw.length - 4) / 16) * 16;
    const decipher = crypto.createDecipheriv("aes-128-cbc", h.subarray(0, 16), h.subarray(16, 32));
    decipher.setAutoPadding(false);
    const bytes = Buffer.concat([decipher.update(raw.subarray(4, bodyLen)), decipher.final()]);
    let end = bytes.length;
    const padding = bytes[bytes.length - 1] & 0xff;
    if (padding >= 1 && padding <= 16 && padding <= end) end -= padding;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return bytes.subarray(0, end).toString("utf8");
}

// ---------------------------------------------------------------------------
console.log("== the fixtures agree with the Kotlin reference ==");
const fixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "media.json"), "utf8")
);
check("the fixture file has entries", fixtures.length > 0, "got " + fixtures.length);

for (const item of fixtures) {
    const seed = decodeBase64Url(item.key_seed);
    const label = item.episodeId + "/" + item.key;

    let mine = null;
    let reference = null;
    let mineError = "";
    let referenceError = "";
    try {
        mine = deriveKey(item.spade_a);
    } catch (e) {
        mineError = e.message;
    }
    try {
        reference = kotlinDeriveKey(item.spade_a);
    } catch (e) {
        referenceError = e.message;
    }
    check(
        label + ": deriveKey matches the Kotlin",
        mine && reference && Buffer.compare(Buffer.from(mine), reference) === 0,
        "mine " + (mine ? Buffer.from(mine).toString("hex") : mineError) +
            " reference " + (reference ? reference.toString("hex") : referenceError)
    );
    check(label + ": the content key is 16 bytes", mine && mine.length === 16);

    let url = null;
    let refUrl = null;
    try {
        url = decryptUrl(item.main_url, seed);
    } catch (e) {
        url = "ERROR " + e.message;
    }
    try {
        refUrl = kotlinDecryptUrl(item.main_url, seed);
    } catch (e) {
        refUrl = "ERROR " + e.message;
    }
    check(label + ": decryptUrl matches the Kotlin", url === refUrl, "mine " + url + " reference " + refUrl);
    check(label + ": the url is a real media url", /^https?:\/\//.test(url), url);
}

console.log("== the key seed decodes to 32 bytes ==");
{
    const seeds = new Set(fixtures.map((f) => f.key_seed));
    for (const seed of seeds) {
        const raw = decodeBase64Url(seed);
        check("key_seed is 32 bytes", raw.length === 32, "got " + raw.length);
    }
}

console.log("== random input behaves the same on both sides ==");
{
    let produced = 0;
    let bothThrew = 0;
    let differed = 0;
    const asText = (v) => (v === "threw" ? "threw" : Buffer.from(v).toString("hex"));
    for (let i = 0; i < 200; i++) {
        const value = crypto.randomBytes(20 + (i % 30)).toString("base64");
        let mine = null;
        let reference = null;
        try {
            mine = deriveKey(value);
        } catch (e) {
            mine = "threw";
        }
        try {
            reference = kotlinDeriveKey(value);
        } catch (e) {
            reference = "threw";
        }
        if (asText(mine) === asText(reference)) {
            if (mine === "threw") bothThrew++;
            else produced++;
        } else {
            differed++;
        }
    }
    check(
        "200 random values agree on the result (" +
            produced +
            " produced a key, " +
            bothThrew +
            " were rejected)",
        differed === 0,
        differed + " differed"
    );
}

console.log("== a url encrypted here comes back out ==");
{
    // Build a main_url the way the server does, then check that decryptUrl
    // recovers it.
    const url = "https://example.cdn/video/tos/cn/tos-cn-v-a1234.mp4?sign=abc";
    const seed = crypto.randomBytes(32);
    const inner = crypto.createHash("sha512").update(seed).digest();
    const h = crypto
        .createHash("sha512")
        .update(Buffer.concat([inner, URL_CONSTANTS]))
        .digest();
    const plain = Buffer.concat([Buffer.from(url, "utf8"), Buffer.from([0, 0, 0, 0])]);
    const pad = 16 - (plain.length % 16);
    const cipher = crypto.createCipheriv("aes-128-cbc", h.subarray(0, 16), h.subarray(16, 32));
    cipher.setAutoPadding(false);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const encoded = Buffer.concat([Buffer.from([0xa8, 0x00, 0x01, 0x00]), body]);
    const value = encoded.toString("base64");
    check("a url built here decrypts back", decryptUrl(value, seed) === url, decryptUrl(value, seed));
    check(
        "and the Kotlin agrees",
        kotlinDecryptUrl(value, seed) === url,
        kotlinDecryptUrl(value, seed)
    );
}

console.log("== malformed input is rejected ==");
{
    const throws = (label, fn) => {
        try {
            fn();
            fail(label + " - no error was raised");
        } catch (e) {
            checks++;
            ok(label + " -> " + e.message);
        }
    };
    throws("a main_url that is too short", () => decryptUrl("AAAA", new Uint8Array(32)));
    throws("a main_url with the wrong magic", () =>
        decryptUrl(Buffer.from([0, 0, 1, 0, ...new Array(32).fill(0)]).toString("base64"), new Uint8Array(32))
    );
    throws("a spade_a that is not base64", () => deriveKey("not base64!!"));
    throws("a spade_a that is too short", () => deriveKey(Buffer.from([1, 2, 3]).toString("base64")));
    throws("a key seed that is not a string", () => decodeBase64Url(42));
}

console.log(failures ? "\nFAILED (" + failures + " of " + checks + ")" : "\nALL PASS (" + checks + " checks)");
process.exit(failures ? 1 : 0);
