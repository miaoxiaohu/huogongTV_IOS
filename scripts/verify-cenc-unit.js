#!/usr/bin/env node
/**
 * Unit tests for the CENC code against synthetic MP4 fixtures.
 *
 *   node scripts/verify-cenc-unit.js
 *
 * The live episodes only ever use one shape of CENC: 32 bit chunk offsets, a
 * 32 bit auxiliary offset, and a per sample IV of exactly 8 bytes. The other
 * shapes in the specification - 64 bit chunk offsets, a 64 bit auxiliary
 * offset, and sub sample encryption where only part of a sample is encrypted
 * - never occur in those files, so they were never exercised by any test.
 * ByteDance does use sub sample encryption for audio on other content, so the
 * code has to be right even though the episodes do not prove it.
 *
 * The fixtures are encrypted with node:crypto, so the expected plaintext comes
 * from an independent implementation and the code under test has to agree
 * with it byte for byte.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { transpile } = require("./transpile");
const { buildCencMp4 } = require("./fixtures/mp4");

const ROOT = path.join(__dirname, "..");
const CACHE = transpile("cenc-unit");
const cenc = require(path.join(CACHE, "data/cenc.js"));

let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};
const check = (label, condition, detail) =>
    condition ? ok(label) : fail(label + (detail ? " - " + detail : ""));

const KEY = Buffer.from("00112233445566778899aabbccddeeff", "hex");

/** A handful of samples with recognisable content. */
function makeSamples(count, size) {
    const samples = [];
    const ivs = [];
    for (let i = 0; i < count; i++) {
        const plain = Buffer.alloc(size);
        for (let k = 0; k < size; k++) plain[k] = (i * 31 + k * 7 + 3) & 0xff;
        samples.push({ plain });
        ivs.push(crypto.randomBytes(8));
    }
    return { samples, ivs };
}

/** Decrypts a whole buffer in one go and returns it. */
function decryptAll(prepared, key) {
    const out = new Uint8Array(prepared.header);
    cenc.decryptChunk(out, 0, prepared.samples, new Uint8Array(key));
    return out;
}

/** Decrypts a whole buffer chunk by chunk and returns it. */
function decryptInChunks(prepared, key, size) {
    const out = new Uint8Array(prepared.header);
    for (let at = 0; at < out.length; at += size) {
        const slice = out.subarray(at, Math.min(at + size, out.length));
        cenc.decryptChunk(slice, at, prepared.samples, new Uint8Array(key));
    }
    return out;
}

/** The samples in the order the builder writes them into the mdat. */
function orderedSamples(samples, trackCount) {
    const out = [];
    for (let t = 0; t < trackCount; t++) {
        for (let i = t; i < samples.length; i += trackCount) out.push(samples[i]);
    }
    return out;
}

/** The plaintext that must come back out. */
function expectedPlain(samples, trackCount) {
    const parts = [];
    for (const sample of orderedSamples(samples, trackCount)) {
        if (sample.regions) {
            for (const region of sample.regions) {
                parts.push(region.clear, region.encrypted);
            }
        } else {
            parts.push(sample.plain);
        }
    }
    return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

/** The byte range of the mdat payload in the built file. */
function mediaRange(built, samples, trackCount) {
    let size = 0;
    for (const sample of orderedSamples(samples, trackCount)) size += sample.plain.length;
    return { start: built.mdatStart + 8, end: built.mdatStart + 8 + size };
}

function runCase(label, options) {
    console.log("== " + label + " ==");
    const trackCount = options.trackCount || 1;
    const built = buildCencMp4(options);
    const key = new Uint8Array(options.key);
    const prepared = cenc.prepare(built.file, key);

    const expected = expectedPlain(options.samples, trackCount);
    const range = mediaRange(built, options.samples, trackCount);
    const got = decryptAll(prepared, key).subarray(range.start, range.end);
    check(
        label + ": the whole file decrypts back to the original bytes",
        Buffer.compare(Buffer.from(got), expected) === 0,
        "expected " + expected.length + " bytes, got " + got.length
    );

    // The same bytes must come back no matter where the chunk boundaries are.
    for (const size of [1, 3, 7, 16, 17, 64, 512, 4096]) {
        const chunked = decryptInChunks(prepared, key, size).subarray(range.start, range.end);
        check(
            label + ": chunk size " + size + " gives the same bytes",
            Buffer.compare(Buffer.from(chunked), expected) === 0
        );
    }

    // The container must have been rewritten into a plain track.
    const text = Buffer.from(prepared.header).toString("latin1");
    check(label + ": the encv box became hvc1", !text.includes("encv") && text.includes("hvc1"));
    check(label + ": the sinf box became free", !text.includes("sinf") && text.includes("free"));
    return { built, prepared };
}

// ---------------------------------------------------------------------------
console.log("== full sample encryption, 32 bit offsets (the shape the episodes use) ==");
{
    const { samples, ivs } = makeSamples(7, 300);
    runCase("stco/saio-v0", { key: KEY, samples, ivs });
}

console.log("== 64 bit chunk offsets (co64) ==");
{
    const { samples, ivs } = makeSamples(5, 128);
    runCase("co64", { key: KEY, samples, ivs, useCo64: true });
}

console.log("== 64 bit auxiliary offset (saio version 1) ==");
{
    const { samples, ivs } = makeSamples(5, 128);
    runCase("saio-v1", { key: KEY, samples, ivs, saioVersion: 1 });
}

console.log("== sub sample encryption (only part of a sample is encrypted) ==");
{
    const ivs = [crypto.randomBytes(8)];
    const samples = [
        {
            plain: Buffer.concat([
                Buffer.from([1, 2, 3, 4, 5]),
                Buffer.from([6, 7, 8, 9, 10, 11, 12, 13]),
                Buffer.from([14, 15]),
                Buffer.from([16, 17, 18, 19, 20]),
            ]),
            regions: [
                { clear: Buffer.from([1, 2, 3, 4, 5]), encrypted: Buffer.from([6, 7, 8, 9, 10, 11, 12, 13]) },
                { clear: Buffer.from([14, 15]), encrypted: Buffer.from([16, 17, 18, 19, 20]) },
            ],
        },
    ];
    runCase("subsample", { key: KEY, samples, ivs });
}

console.log("== two tracks, one with sub samples ==");
{
    const ivs = [];
    const samples = [];
    for (let i = 0; i < 6; i++) ivs.push(crypto.randomBytes(8));
    for (let i = 0; i < 6; i++) {
        const plain = Buffer.alloc(64);
        for (let k = 0; k < 64; k++) plain[k] = (i * 13 + k) & 0xff;
        samples.push({ plain });
    }
    // Every second sample uses the sub sample layout.
    samples[1].regions = [
        { clear: Buffer.alloc(0), encrypted: Buffer.from(samples[1].plain.subarray(0, 20)) },
    ];
    samples[1].plain = samples[1].plain.subarray(0, 20);
    samples[3].regions = [
        { clear: Buffer.from([9, 9]), encrypted: Buffer.from(samples[3].plain.subarray(2, 30)) },
    ];
    samples[3].plain = Buffer.concat([Buffer.from([9, 9]), samples[3].plain.subarray(2, 30)]);
    runCase("two tracks", { key: KEY, samples, ivs, trackCount: 2 });
}

console.log("== the sample table is read correctly ==");
{
    const { samples, ivs } = makeSamples(4, 64);
    const built = buildCencMp4({ key: KEY, samples, ivs });
    const prepared = cenc.prepare(built.file, new Uint8Array(KEY));
    check("one entry per sample", prepared.samples.length === 4, "got " + prepared.samples.length);
    const ordered = prepared.samples.every((s, i) => i === 0 || prepared.samples[i - 1].end <= s.start);
    check("the samples are ordered and do not overlap", ordered);
    check(
        "every sample carries a 16 byte counter block",
        prepared.samples.every((s) => s.iv.length === 16)
    );
    check(
        "the last 8 bytes of the counter are zero",
        prepared.samples.every((s) => s.iv.slice(8).every((b) => b === 0))
    );
    check(
        "the samples cover the media data",
        prepared.samples[prepared.samples.length - 1].end ===
            built.mdatStart + 8 + 4 * 64,
        "end " + prepared.samples[prepared.samples.length - 1].end
    );
}

console.log("== clear content is left alone ==");
{
    const { samples, ivs } = makeSamples(3, 64);
    const built = buildCencMp4({ key: KEY, samples, ivs });
    const prepared = cenc.prepare(built.file, null);
    check("no samples", prepared.samples.length === 0);
    check(
        "the bytes are unchanged",
        Buffer.compare(Buffer.from(prepared.header), Buffer.from(built.file)) === 0
    );
}

console.log("== broken input is rejected with a message, not a crash ==");
{
    const { samples, ivs } = makeSamples(3, 64);
    const built = buildCencMp4({ key: KEY, samples, ivs });
    const file = Buffer.from(built.file);

    const throws = (label, fn) => {
        try {
            fn();
            fail(label + " - no error was raised");
        } catch (e) {
            e instanceof Error && e.message
                ? ok(label + " -> " + e.message)
                : fail(label + " - raised a non Error");
        }
    };
    throws("a file that is not an mp4", () =>
        cenc.headerEnd(new Uint8Array(Buffer.from("not an mp4 at all!!")), 20)
    );
    throws("a file whose first box is not ftyp", () =>
        cenc.headerEnd(new Uint8Array(file.subarray(28)), file.length)
    );
    throws("a truncated file", () =>
        cenc.prepare(new Uint8Array(file.subarray(0, 200)), new Uint8Array(KEY))
    );
    throws("a file with no moov", () => {
        const broken = Buffer.from(file);
        broken.write("xxxx", 32, 4, "latin1");
        cenc.prepare(new Uint8Array(broken), new Uint8Array(KEY));
    });
    throws("a file whose moov has no encryption index", () => {
        // Blank out the saiz type so the track looks like clear content.
        const broken = Buffer.from(file);
        const at = broken.indexOf("saiz", 0, "latin1");
        if (at > 0) broken.write("xxxx", at, 4, "latin1");
        cenc.prepare(new Uint8Array(broken), new Uint8Array(KEY));
    });
    throws("a key of the wrong length", () => {
        // The key is only used when the samples are decrypted, so the failure
        // surfaces there rather than while the table is read.
        const prepared = cenc.prepare(built.file, new Uint8Array(7));
        cenc.decryptChunk(prepared.header, 0, prepared.samples, new Uint8Array(7));
    });
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
