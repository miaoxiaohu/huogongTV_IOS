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

console.log("\npass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
