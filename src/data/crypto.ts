/**
 * Standard SHA-512 and AES, implemented in TypeScript.
 *
 * React Native has no crypto module, and the media pipeline needs real
 * SHA-512 (for the URL key derivation) plus AES in CBC (URL decryption) and
 * CTR (CENC sample decryption). The custom AesV3 in signer.ts is a different
 * cipher and cannot be reused here.
 *
 * Both implementations are checked against node:crypto by
 * scripts/verify-signer.js.
 */

// ---------------------------------------------------------------------------
// SHA-512
// ---------------------------------------------------------------------------

const MASK64 = (1n << 64n) - 1n;

const K512: bigint[] = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const H512: bigint[] = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function readU64BE(dv: DataView, off: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(dv.getUint8(off + i));
  return v;
}

function writeU64BE(dv: DataView, off: number, v: bigint): void {
  for (let i = 0; i < 8; i++) {
    dv.setUint8(off + i, Number((v >> BigInt(8 * (7 - i))) & 0xffn));
  }
}

export function sha512(data: Uint8Array): Uint8Array {
  const dvIn = new DataView(data.buffer, data.byteOffset, data.byteLength);
  void dvIn;
  const bitLen = BigInt(data.length) * 8n;
  // len + 1 (0x80) + padding + 16 (length) must be a multiple of 128 bytes.
  const blocks = Math.ceil((data.length + 17) / 128);
  const padded = new Uint8Array(blocks * 128);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  writeU64BE(dv, padded.length - 16, (bitLen >> 64n) & MASK64);
  writeU64BE(dv, padded.length - 8, bitLen & MASK64);

  const H = H512.slice();
  const w: bigint[] = new Array(80);

  for (let off = 0; off < padded.length; off += 128) {
    for (let i = 0; i < 16; i++) w[i] = readU64BE(dv, off + i * 8);
    for (let i = 16; i < 80; i++) {
      const s0 =
        rotr64(w[i - 15], 1n) ^ rotr64(w[i - 15], 8n) ^ (w[i - 15] >> 7n);
      const s1 =
        rotr64(w[i - 2], 19n) ^ rotr64(w[i - 2], 61n) ^ (w[i - 2] >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K512[i] + w[i]) & MASK64;
      const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64;
      h = g;
      g = f;
      f = e;
      e = (d + t1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) & MASK64;
    }

    H[0] = (H[0] + a) & MASK64;
    H[1] = (H[1] + b) & MASK64;
    H[2] = (H[2] + c) & MASK64;
    H[3] = (H[3] + d) & MASK64;
    H[4] = (H[4] + e) & MASK64;
    H[5] = (H[5] + f) & MASK64;
    H[6] = (H[6] + g) & MASK64;
    H[7] = (H[7] + h) & MASK64;
  }

  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) writeU64BE(odv, i * 8, H[i]);
  return out;
}

// ---------------------------------------------------------------------------
// AES
// ---------------------------------------------------------------------------

function xtime(a: number): number {
  return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
}

function gmul(a: number, b: number): number {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return r & 0xff;
}

// The multiplicative inverse table. 2 is NOT a generator of GF(2^8) under the
// AES polynomial 0x11b - its order is 51, not 255 - so a log/antilog table
// built on it does not cover the whole group. Brute force the inverses
// instead; gmul is cheap and this runs once.
let SBOX: Uint8Array | null = null;
let INV_SBOX: Uint8Array | null = null;

function ensureTables(): void {
    if (SBOX) return;
    const inv = new Uint8Array(256);
    for (let i = 1; i < 256; i++) {
        for (let j = 1; j < 256; j++) {
            if (gmul(i, j) === 1) {
                inv[i] = j;
                break;
            }
        }
    }
    const rotl8 = (b: number, n: number) =>
        ((b << n) | (b >>> (8 - n))) & 0xff;
    const sbox = new Uint8Array(256);
    const invSbox = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        const b = inv[i];
        sbox[i] =
          (b ^ rotl8(b, 1) ^ rotl8(b, 2) ^ rotl8(b, 3) ^ rotl8(b, 4) ^ 0x63) & 0xff;
    }
    for (let i = 0; i < 256; i++) invSbox[sbox[i]] = i;
    SBOX = sbox;
    INV_SBOX = invSbox;
}

const RCON = new Uint8Array(11);
(() => {
  let r = 1;
  for (let i = 1; i <= 10; i++) {
    RCON[i] = r;
    r = xtime(r);
  }
})();

function expandKey(key: Uint8Array): Uint8Array {
  ensureTables();
  const nk = key.length / 4;
  if (![4, 6, 8].includes(nk)) throw new Error("Bad AES key length");
  const nr = nk + 6;
  const words = nk * 4;
  const out = new Uint8Array(16 * (nr + 1));
  out.set(key);
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t0 = out[(i - 1) * 4];
    let t1 = out[(i - 1) * 4 + 1];
    let t2 = out[(i - 1) * 4 + 2];
    let t3 = out[(i - 1) * 4 + 3];
    if (i % nk === 0) {
      const tmp = t0;
      t0 = SBOX![t1] ^ RCON[i / nk];
      t1 = SBOX![t2];
      t2 = SBOX![t3];
      t3 = SBOX![tmp];
    } else if (nk > 6 && i % nk === 4) {
      t0 = SBOX![t0];
      t1 = SBOX![t1];
      t2 = SBOX![t2];
      t3 = SBOX![t3];
    }
    out[i * 4] = out[(i - nk) * 4] ^ t0;
    out[i * 4 + 1] = out[(i - nk) * 4 + 1] ^ t1;
    out[i * 4 + 2] = out[(i - nk) * 4 + 2] ^ t2;
    out[i * 4 + 3] = out[(i - nk) * 4 + 3] ^ t3;
  }
  void words;
  return out;
}

// The key schedule is reused for every block, and AES-CTR encrypts 16 bytes
// at a time, so re-expanding per block would dominate the runtime of a
// multi-megabyte video. Cache the most recent schedule.
let CACHED_KEY: Uint8Array | null = null;
let CACHED_SCHEDULE: Uint8Array | null = null;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function keySchedule(key: Uint8Array): Uint8Array {
  if (CACHED_KEY && CACHED_SCHEDULE && sameBytes(CACHED_KEY, key)) {
    return CACHED_SCHEDULE;
  }
  const schedule = expandKey(key);
  CACHED_KEY = new Uint8Array(key);
  CACHED_SCHEDULE = schedule;
  return schedule;
}

function addRoundKey(s: Uint8Array, rk: Uint8Array, round: number): void {
  const off = round * 16;
  for (let i = 0; i < 16; i++) s[i] ^= rk[off + i];
}

function subBytes(s: Uint8Array, box: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i] = box[s[i]];
}

function shiftRows(s: Uint8Array): void {
  let t = s[1];
  s[1] = s[5];
  s[5] = s[9];
  s[9] = s[13];
  s[13] = t;
  t = s[2];
  s[2] = s[10];
  s[10] = t;
  t = s[6];
  s[6] = s[14];
  s[14] = t;
  t = s[15];
  s[15] = s[11];
  s[11] = s[7];
  s[7] = s[3];
  s[3] = t;
}

function invShiftRows(s: Uint8Array): void {
  let t = s[13];
  s[13] = s[9];
  s[9] = s[5];
  s[5] = s[1];
  s[1] = t;
  t = s[2];
  s[2] = s[10];
  s[10] = t;
  t = s[6];
  s[6] = s[14];
  s[14] = t;
  t = s[3];
  s[3] = s[7];
  s[7] = s[11];
  s[11] = s[15];
  s[15] = t;
}

function mixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const a0 = s[i];
    const a1 = s[i + 1];
    const a2 = s[i + 2];
    const a3 = s[i + 3];
    s[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
    s[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
    s[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
    s[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
  }
}

function invMixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const a0 = s[i];
    const a1 = s[i + 1];
    const a2 = s[i + 2];
    const a3 = s[i + 3];
    s[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    s[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    s[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    s[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

// ---------------------------------------------------------------------------
// T-tables
// ---------------------------------------------------------------------------
//
// The byte-oriented round function above is easy to read but slow: it does
// sixteen table lookups plus four gmul() calls per column. Decrypting a
// 12 MB video with it runs at ~4.7 MB/s, which on a phone means a ten second
// wait before the first frame.
//
// The T-table form folds SubBytes, ShiftRows and MixColumns into four 32 bit
// lookups per column, which measures ~20 MB/s - four times faster. The
// decryption direction keeps the readable implementation: it only ever runs
// on a few hundred bytes of URL payload.

const T0 = new Int32Array(256);
const T1 = new Int32Array(256);
const T2 = new Int32Array(256);
const T3 = new Int32Array(256);
let TABLES_READY = false;

function buildTables(): void {
  if (TABLES_READY) return;
  ensureTables();
  const rotr = (x: number, n: number): number =>
    ((x >>> n) | (x << (32 - n))) | 0;
  for (let i = 0; i < 256; i++) {
    const s = SBOX![i];
    const m2 = gmul(s, 2);
    const m3 = gmul(s, 3);
    const t = ((m2 << 24) | (s << 16) | (s << 8) | m3) | 0;
    T0[i] = t;
    T1[i] = rotr(t, 8);
    T2[i] = rotr(t, 16);
    T3[i] = rotr(t, 24);
  }
  TABLES_READY = true;
}

function word(b0: number, b1: number, b2: number, b3: number): number {
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) | 0;
}

export function aesEncryptBlock(
  key: Uint8Array,
  block: Uint8Array
): Uint8Array {
  buildTables();
  const rk = keySchedule(key);
  const nr = key.length / 4 + 6;
  let s0 = word(block[0], block[1], block[2], block[3]) ^ word(rk[0], rk[1], rk[2], rk[3]);
  let s1 = word(block[4], block[5], block[6], block[7]) ^ word(rk[4], rk[5], rk[6], rk[7]);
  let s2 = word(block[8], block[9], block[10], block[11]) ^ word(rk[8], rk[9], rk[10], rk[11]);
  let s3 = word(block[12], block[13], block[14], block[15]) ^ word(rk[12], rk[13], rk[14], rk[15]);
  for (let r = 1; r < nr; r++) {
    const o = r * 16;
    const t0 =
      (T0[(s0 >>> 24) & 0xff] ^
        T1[(s1 >>> 16) & 0xff] ^
        T2[(s2 >>> 8) & 0xff] ^
        T3[s3 & 0xff] ^
        word(rk[o], rk[o + 1], rk[o + 2], rk[o + 3])) |
      0;
    const t1 =
      (T0[(s1 >>> 24) & 0xff] ^
        T1[(s2 >>> 16) & 0xff] ^
        T2[(s3 >>> 8) & 0xff] ^
        T3[s0 & 0xff] ^
        word(rk[o + 4], rk[o + 5], rk[o + 6], rk[o + 7])) |
      0;
    const t2 =
      (T0[(s2 >>> 24) & 0xff] ^
        T1[(s3 >>> 16) & 0xff] ^
        T2[(s0 >>> 8) & 0xff] ^
        T3[s1 & 0xff] ^
        word(rk[o + 8], rk[o + 9], rk[o + 10], rk[o + 11])) |
      0;
    const t3 =
      (T0[(s3 >>> 24) & 0xff] ^
        T1[(s0 >>> 16) & 0xff] ^
        T2[(s1 >>> 8) & 0xff] ^
        T3[s2 & 0xff] ^
        word(rk[o + 12], rk[o + 13], rk[o + 14], rk[o + 15])) |
      0;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    s3 = t3;
  }
  const o = nr * 16;
  const f0 =
    (word(
      SBOX![(s0 >>> 24) & 0xff],
      SBOX![(s1 >>> 16) & 0xff],
      SBOX![(s2 >>> 8) & 0xff],
      SBOX![s3 & 0xff]
    ) ^
      word(rk[o], rk[o + 1], rk[o + 2], rk[o + 3])) |
    0;
  const f1 =
    (word(
      SBOX![(s1 >>> 24) & 0xff],
      SBOX![(s2 >>> 16) & 0xff],
      SBOX![(s3 >>> 8) & 0xff],
      SBOX![s0 & 0xff]
    ) ^
      word(rk[o + 4], rk[o + 5], rk[o + 6], rk[o + 7])) |
    0;
  const f2 =
    (word(
      SBOX![(s2 >>> 24) & 0xff],
      SBOX![(s3 >>> 16) & 0xff],
      SBOX![(s0 >>> 8) & 0xff],
      SBOX![s1 & 0xff]
    ) ^
      word(rk[o + 8], rk[o + 9], rk[o + 10], rk[o + 11])) |
    0;
  const f3 =
    (word(
      SBOX![(s3 >>> 24) & 0xff],
      SBOX![(s0 >>> 16) & 0xff],
      SBOX![(s1 >>> 8) & 0xff],
      SBOX![s2 & 0xff]
    ) ^
      word(rk[o + 12], rk[o + 13], rk[o + 14], rk[o + 15])) |
    0;
  const out = new Uint8Array(16);
  out[0] = (f0 >>> 24) & 0xff;
  out[1] = (f0 >>> 16) & 0xff;
  out[2] = (f0 >>> 8) & 0xff;
  out[3] = f0 & 0xff;
  out[4] = (f1 >>> 24) & 0xff;
  out[5] = (f1 >>> 16) & 0xff;
  out[6] = (f1 >>> 8) & 0xff;
  out[7] = f1 & 0xff;
  out[8] = (f2 >>> 24) & 0xff;
  out[9] = (f2 >>> 16) & 0xff;
  out[10] = (f2 >>> 8) & 0xff;
  out[11] = f2 & 0xff;
  out[12] = (f3 >>> 24) & 0xff;
  out[13] = (f3 >>> 16) & 0xff;
  out[14] = (f3 >>> 8) & 0xff;
  out[15] = f3 & 0xff;
  return out;
}

export function aesDecryptBlock(
  key: Uint8Array,
  block: Uint8Array
): Uint8Array {
  const rk = keySchedule(key);
  const nr = key.length / 4 + 6;
  const s = new Uint8Array(block);
  addRoundKey(s, rk, nr);
  for (let r = nr - 1; r > 0; r--) {
    invShiftRows(s);
    subBytes(s, INV_SBOX!);
    addRoundKey(s, rk, r);
    invMixColumns(s);
  }
  invShiftRows(s);
  subBytes(s, INV_SBOX!);
  addRoundKey(s, rk, 0);
  return s;
}

export function aesDecryptCbc(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array
): Uint8Array {
  const out = new Uint8Array(data.length - (data.length % 16));
  let prev = new Uint8Array(iv);
  const block = new Uint8Array(16);
  for (let off = 0; off < out.length; off += 16) {
    for (let i = 0; i < 16; i++) block[i] = data[off + i];
    const plain = aesDecryptBlock(key, block);
    for (let i = 0; i < 16; i++) out[off + i] = plain[i] ^ prev[i];
    // Copy: `block` is reused on the next iteration.
    prev = new Uint8Array(block);
  }
  return out;
}

export function aesCtr(
  key: Uint8Array,
  counter: Uint8Array,
  data: Uint8Array
): Uint8Array {
  buildTables();
  const out = new Uint8Array(data.length);
  const ctr = new Uint8Array(counter);
  const rk = keySchedule(key);
  const nr = key.length / 4 + 6;
  const s = new Int32Array(4);
  for (let off = 0; off < data.length; off += 16) {
    s[0] =
      word(ctr[0], ctr[1], ctr[2], ctr[3]) ^
      word(rk[0], rk[1], rk[2], rk[3]);
    s[1] =
      word(ctr[4], ctr[5], ctr[6], ctr[7]) ^
      word(rk[4], rk[5], rk[6], rk[7]);
    s[2] =
      word(ctr[8], ctr[9], ctr[10], ctr[11]) ^
      word(rk[8], rk[9], rk[10], rk[11]);
    s[3] =
      word(ctr[12], ctr[13], ctr[14], ctr[15]) ^
      word(rk[12], rk[13], rk[14], rk[15]);
    for (let r = 1; r < nr; r++) {
      const o = r * 16;
      const t0 =
        (T0[(s[0] >>> 24) & 0xff] ^
          T1[(s[1] >>> 16) & 0xff] ^
          T2[(s[2] >>> 8) & 0xff] ^
          T3[s[3] & 0xff] ^
          word(rk[o], rk[o + 1], rk[o + 2], rk[o + 3])) |
        0;
      const t1 =
        (T0[(s[1] >>> 24) & 0xff] ^
          T1[(s[2] >>> 16) & 0xff] ^
          T2[(s[3] >>> 8) & 0xff] ^
          T3[s[0] & 0xff] ^
          word(rk[o + 4], rk[o + 5], rk[o + 6], rk[o + 7])) |
        0;
      const t2 =
        (T0[(s[2] >>> 24) & 0xff] ^
          T1[(s[3] >>> 16) & 0xff] ^
          T2[(s[0] >>> 8) & 0xff] ^
          T3[s[1] & 0xff] ^
          word(rk[o + 8], rk[o + 9], rk[o + 10], rk[o + 11])) |
        0;
      const t3 =
        (T0[(s[3] >>> 24) & 0xff] ^
          T1[(s[0] >>> 16) & 0xff] ^
          T2[(s[1] >>> 8) & 0xff] ^
          T3[s[2] & 0xff] ^
          word(rk[o + 12], rk[o + 13], rk[o + 14], rk[o + 15])) |
        0;
      s[0] = t0;
      s[1] = t1;
      s[2] = t2;
      s[3] = t3;
    }
    const o = nr * 16;
    const f0 =
      (word(
        SBOX![(s[0] >>> 24) & 0xff],
        SBOX![(s[1] >>> 16) & 0xff],
        SBOX![(s[2] >>> 8) & 0xff],
        SBOX![s[3] & 0xff]
      ) ^
        word(rk[o], rk[o + 1], rk[o + 2], rk[o + 3])) |
      0;
    const f1 =
      (word(
        SBOX![(s[1] >>> 24) & 0xff],
        SBOX![(s[2] >>> 16) & 0xff],
        SBOX![(s[3] >>> 8) & 0xff],
        SBOX![s[0] & 0xff]
      ) ^
        word(rk[o + 4], rk[o + 5], rk[o + 6], rk[o + 7])) |
      0;
    const f2 =
      (word(
        SBOX![(s[2] >>> 24) & 0xff],
        SBOX![(s[3] >>> 16) & 0xff],
        SBOX![(s[0] >>> 8) & 0xff],
        SBOX![s[1] & 0xff]
      ) ^
        word(rk[o + 8], rk[o + 9], rk[o + 10], rk[o + 11])) |
      0;
    const f3 =
      (word(
        SBOX![(s[3] >>> 24) & 0xff],
        SBOX![(s[0] >>> 16) & 0xff],
        SBOX![(s[1] >>> 8) & 0xff],
        SBOX![s[2] & 0xff]
      ) ^
        word(rk[o + 12], rk[o + 13], rk[o + 14], rk[o + 15])) |
      0;
    const n = Math.min(16, data.length - off);
    out[off] = data[off] ^ ((f0 >>> 24) & 0xff);
    if (n > 1) out[off + 1] = data[off + 1] ^ ((f0 >>> 16) & 0xff);
    if (n > 2) out[off + 2] = data[off + 2] ^ ((f0 >>> 8) & 0xff);
    if (n > 3) out[off + 3] = data[off + 3] ^ (f0 & 0xff);
    if (n > 4) out[off + 4] = data[off + 4] ^ ((f1 >>> 24) & 0xff);
    if (n > 5) out[off + 5] = data[off + 5] ^ ((f1 >>> 16) & 0xff);
    if (n > 6) out[off + 6] = data[off + 6] ^ ((f1 >>> 8) & 0xff);
    if (n > 7) out[off + 7] = data[off + 7] ^ (f1 & 0xff);
    if (n > 8) out[off + 8] = data[off + 8] ^ ((f2 >>> 24) & 0xff);
    if (n > 9) out[off + 9] = data[off + 9] ^ ((f2 >>> 16) & 0xff);
    if (n > 10) out[off + 10] = data[off + 10] ^ ((f2 >>> 8) & 0xff);
    if (n > 11) out[off + 11] = data[off + 11] ^ (f2 & 0xff);
    if (n > 12) out[off + 12] = data[off + 12] ^ ((f3 >>> 24) & 0xff);
    if (n > 13) out[off + 13] = data[off + 13] ^ ((f3 >>> 16) & 0xff);
    if (n > 14) out[off + 14] = data[off + 14] ^ ((f3 >>> 8) & 0xff);
    if (n > 15) out[off + 15] = data[off + 15] ^ (f3 & 0xff);
    // increment the 128-bit counter (big endian)
    for (let i = 15; i >= 0; i--) {
      ctr[i] = (ctr[i] + 1) & 0xff;
      if (ctr[i] !== 0) break;
    }
  }
  return out;
}
