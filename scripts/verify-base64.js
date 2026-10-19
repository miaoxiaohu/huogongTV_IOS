#!/usr/bin/env node
/**
 * Base64 codec tests.
 *
 *   node scripts/verify-base64.js
 *
 * The codec is on the hot path of the media pipeline: a 12 MB video passes
 * through it twice, once to read the encrypted file and once to write the
 * decrypted one. Node's Buffer is the oracle.
 */
const path = require("path");
const crypto = require("crypto");
const { transpile } = require("./transpile");

const CACHE = transpile("base64-verify");
const { base64Encode, base64Decode } = require(path.join(CACHE, "data/base64.js"));

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

console.log("== encode matches Buffer ==");
for (const len of [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 17, 63, 64, 65, 255, 256, 1000, 100000]) {
    const data = crypto.randomBytes(len);
    const got = base64Encode(new Uint8Array(data));
    const want = data.toString("base64");
    check("encode " + len + " bytes", got === want, "got " + got.slice(0, 40) + " want " + want.slice(0, 40));
}

console.log("== decode matches Buffer ==");
for (const len of [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 17, 63, 64, 65, 255, 256, 1000, 100000]) {
    const data = crypto.randomBytes(len);
    const text = data.toString("base64");
    const got = Buffer.from(base64Decode(text));
    check("decode " + len + " bytes", got.equals(data), "got " + got.length + " bytes");
}

console.log("== round trip ==");
for (let i = 0; i < 40; i++) {
    const data = crypto.randomBytes(i * 37);
    const back = base64Decode(base64Encode(new Uint8Array(data)));
    check("round trip " + data.length + " bytes", Buffer.from(back).equals(data));
}

console.log("== padding ==");
{
    check("one byte gets two =", base64Encode(new Uint8Array([1])).endsWith("=="));
    check("two bytes get one =", base64Encode(new Uint8Array([1, 2])).endsWith("="));
    check("three bytes get none", !base64Encode(new Uint8Array([1, 2, 3])).endsWith("="));
    check("no newline is added", !base64Encode(new Uint8Array(100)).includes("\n"));
}

console.log("== odd input does not crash ==");
{
    const decode = (text) => {
        try {
            base64Decode(text);
            return "no error";
        } catch (e) {
            return "threw " + e.message;
        }
    };
    check("a single character", decode("A") === "no error");
    check("a truncated group", decode("QUJD") === "no error");
    check("characters outside the alphabet", decode("!!!!") === "no error");
    check("an empty string", decode("") === "no error");
    check("whitespace", decode("QU JD") === "no error");
    check("a non string", decode(null) === "no error");
    check("a lone character decodes to nothing", base64Decode("A").length === 0);
}

console.log("== the url safe alphabet ==");
{
    // mediaCrypto rewrites - and _ before decoding, and then uses this
    // codec, so the two have to agree.
    const { decodeBase64Url } = require(path.join(CACHE, "data/mediaCrypto.js"));
    const data = Buffer.from([0xfb, 0xef, 0xbe]);
    const standard = data.toString("base64");
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
    check(
        "the url safe form decodes to the same bytes",
        Buffer.from(decodeBase64Url(urlSafe)).equals(data)
    );
    check(
        "the standard form decodes to the same bytes",
        Buffer.from(decodeBase64Url(standard)).equals(data)
    );
    check("a non string is rejected with a message", (() => {
        try {
            decodeBase64Url(42);
            return "no error";
        } catch (e) {
            return e.message.length > 0;
        }
    })());
}

console.log(failures ? "\nFAILED (" + failures + " of " + checks + ")" : "\nALL PASS (" + checks + " checks)");
process.exit(failures ? 1 : 0);
