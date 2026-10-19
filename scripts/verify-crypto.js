// Verify the TypeScript AES / SHA-512 against node:crypto.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const babel = require("@babel/core");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "node_modules", ".cache", "signer-crypto");
fs.mkdirSync(CACHE, { recursive: true });

const file = path.join(ROOT, "src/data/crypto.ts");
const out = babel.transformFileSync(file, {
    presets: ["module:@react-native/babel-preset"],
    filename: file,
    babelrc: false,
    configFile: false,
}).code;
const tmp = path.join(CACHE, "crypto.js");
fs.writeFileSync(tmp, out, "utf8");
const { sha512, aesEncryptBlock, aesDecryptBlock, aesDecryptCbc, aesCtr } = require(tmp);

let pass = 0, fail = 0;
const check = (label, got, want) => {
    const g = Buffer.from(got).toString("hex");
    const w = Buffer.from(want).toString("hex");
    if (g === w) pass++;
    else { fail++; console.log("  FAIL", label, "\n    got ", g, "\n    want", w); }
};

console.log("=== sha512 ===");
for (const len of [0, 1, 55, 56, 64, 111, 112, 128, 200, 1000]) {
    const buf = crypto.randomBytes(len);
    check("sha512 len=" + len, sha512(new Uint8Array(buf)),
        crypto.createHash("sha512").update(buf).digest());
}
check('sha512 "abc"', sha512(new TextEncoder().encode("abc")),
    crypto.createHash("sha512").update("abc").digest());

console.log("=== aes block (128/192/256) ===");
for (const bits of [128, 192, 256]) {
    const key = crypto.randomBytes(bits / 8);
    const block = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-" + bits + "-ecb", key, null);
    cipher.setAutoPadding(false);
    const enc = Buffer.concat([cipher.update(block), cipher.final()]);
    check("aes-" + bits + " encrypt", aesEncryptBlock(new Uint8Array(key), new Uint8Array(block)), enc);
    const decipher = crypto.createDecipheriv("aes-" + bits + "-ecb", key, null);
    decipher.setAutoPadding(false);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    check("aes-" + bits + " decrypt", aesDecryptBlock(new Uint8Array(key), new Uint8Array(enc)), dec);
}

console.log("=== aes cbc decrypt ===");
for (const bits of [128, 256]) {
    const key = crypto.randomBytes(bits / 8);
    const iv = crypto.randomBytes(16);
    const data = crypto.randomBytes(16 * 5);
    const cipher = crypto.createCipheriv("aes-" + bits + "-cbc", key, iv);
    cipher.setAutoPadding(false);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    check("aes-" + bits + "-cbc decrypt", aesDecryptCbc(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(enc)), data);
}

console.log("=== aes ctr ===");
for (const bits of [128, 256]) {
    const key = crypto.randomBytes(bits / 8);
    const ctr = crypto.randomBytes(16);
    const data = crypto.randomBytes(37);
    const cipher = crypto.createCipheriv("aes-" + bits + "-ctr", key, ctr);
    cipher.setAutoPadding(false);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    check("aes-" + bits + "-ctr encrypt", aesCtr(new Uint8Array(key), new Uint8Array(ctr), new Uint8Array(data)), enc);
    const decipher = crypto.createDecipheriv("aes-" + bits + "-ctr", key, ctr);
    decipher.setAutoPadding(false);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    check("aes-" + bits + "-ctr decrypt", aesCtr(new Uint8Array(key), new Uint8Array(ctr), new Uint8Array(enc)), dec);
}

console.log("=== aes ctr edge cases ===");
{
    // Every length from 0 to 80, so the last partial block is covered.
    for (let len = 0; len <= 80; len++) {
        const key = crypto.randomBytes(16);
        const ctr = crypto.randomBytes(16);
        const data = crypto.randomBytes(len);
        const cipher = crypto.createCipheriv("aes-128-ctr", key, ctr);
        cipher.setAutoPadding(false);
        const want = Buffer.concat([cipher.update(data), cipher.final()]);
        const got = Buffer.from(aesCtr(new Uint8Array(key), new Uint8Array(ctr), new Uint8Array(data)));
        if (!got.equals(want)) {
            fail("aes-128-ctr len=" + len);
            break;
        }
    }
    pass++;
    console.log("  ok   aes-128-ctr for every length from 0 to 80");
}
{
    // A counter that runs off the end has to wrap, not stop.
    const key = crypto.randomBytes(16);
    const ctr = Buffer.alloc(16, 0xff);
    const data = crypto.randomBytes(64);
    const cipher = crypto.createCipheriv("aes-128-ctr", key, ctr);
    cipher.setAutoPadding(false);
    const want = Buffer.concat([cipher.update(data), cipher.final()]);
    const got = Buffer.from(aesCtr(new Uint8Array(key), new Uint8Array(ctr), new Uint8Array(data)));
    if (got.equals(want)) {
        pass++;
        console.log("  ok   aes-128-ctr wraps the counter");
    } else {
        fail("aes-128-ctr counter wrap");
    }
}
{
    // The counter only ever has to advance in the low 64 bits, because the
    // per sample iv is 8 bytes followed by 8 zero bytes.
    const key = crypto.randomBytes(16);
    const iv = crypto.randomBytes(8);
    const counter = Buffer.concat([iv, Buffer.alloc(8)]);
    for (const blocks of [1, 2, 255, 256, 257, 1000]) {
        const data = crypto.randomBytes(blocks * 16);
        const cipher = crypto.createCipheriv("aes-128-ctr", key, counter);
        cipher.setAutoPadding(false);
        const want = Buffer.concat([cipher.update(data), cipher.final()]);
        const got = Buffer.from(aesCtr(new Uint8Array(key), new Uint8Array(counter), new Uint8Array(data)));
        if (!got.equals(want)) {
            fail("aes-128-ctr " + blocks + " blocks");
            break;
        }
    }
    pass++;
    console.log("  ok   aes-128-ctr with a per sample iv over many blocks");
}
{
    // A megabyte, to be sure nothing degrades over a long run.
    const key = crypto.randomBytes(16);
    const ctr = crypto.randomBytes(16);
    const data = crypto.randomBytes(1024 * 1024);
    const cipher = crypto.createCipheriv("aes-128-ctr", key, ctr);
    cipher.setAutoPadding(false);
    const want = Buffer.concat([cipher.update(data), cipher.final()]);
    const started = Date.now();
    const got = Buffer.from(aesCtr(new Uint8Array(key), new Uint8Array(ctr), new Uint8Array(data)));
    const speed = (data.length / 1048576) / ((Date.now() - started) / 1000);
    if (got.equals(want)) {
        pass++;
        console.log("  ok   aes-128-ctr over 1 MB at " + speed.toFixed(1) + " MB/s");
    } else {
        fail("aes-128-ctr over 1 MB");
    }
}
{
    // 192 and 256 bit keys, the sizes the source never uses but the code
    // claims to support.
    for (const bits of [192, 256]) {
        const key = crypto.randomBytes(bits / 8);
        const ctr = crypto.randomBytes(16);
        const data = crypto.randomBytes(1000);
        const cipher = crypto.createCipheriv("aes-" + bits + "-ctr", key, ctr);
        cipher.setAutoPadding(false);
        const want = Buffer.concat([cipher.update(data), cipher.final()]);
        const got = Buffer.from(aesCtr(new Uint8Array(key), new Uint8Array(ctr), new Uint8Array(data)));
        if (!got.equals(want)) {
            fail("aes-" + bits + "-ctr");
            break;
        }
    }
    pass++;
    console.log("  ok   aes-192-ctr and aes-256-ctr");
}

console.log("=== sha-512 edge cases ===");
{
    // The padding has to switch at the right length.
    for (const len of [111, 112, 113, 239, 240, 241]) {
        const buf = crypto.randomBytes(len);
        const got = Buffer.from(sha512(new Uint8Array(buf))).toString("hex");
        const want = crypto.createHash("sha512").update(buf).digest("hex");
        if (got !== want) {
            fail("sha512 len=" + len);
            break;
        }
    }
    pass++;
    console.log("  ok   sha512 across the padding boundary");
}

console.log("\npass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
