// Port of Signer.kt / AesV3 / VendorConstants from Kotlin to TypeScript
// Protocol-specific crypto; not standard AES.

const VIDEO_UA =
  "com.phoenix.read/71332 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)";
const APP_UA =
  "com.phoenix.read/72232 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)";

function decodeBase64(s: string): Uint8Array {
  const b =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  s = s.replace(/=+$/, "");
  const out: number[] = [];
  let bits = 0,
    buf = 0;
  for (let i = 0; i < s.length; i++) {
    const idx = b.indexOf(s[i]);
    if (idx < 0) continue;
    buf = (buf << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >>> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

function md5(input: Uint8Array): Uint8Array {
  // RFC 1321 MD5. Must match java.security.MessageDigest("MD5") byte for byte.
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14,
    20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16,
    23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21, 6, 10, 15, 21,
  ];
  const K = new Array(64);
  for (let i = 0; i < 64; i++)
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);

  const rol = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const add = (...vals: number[]) => {
    let s = 0;
    for (const v of vals) s = (s + (v >>> 0)) >>> 0;
    return s;
  };
  const cmn = (
    q: number,
    a: number,
    b: number,
    x: number,
    s: number,
    t: number
  ) => add(rol(add(a, add(q, add(x, t))), s), b);

  const len = input.length;
  const padLen = ((55 - len) % 64 + 64) % 64;
  const data = new Uint8Array(len + 1 + padLen + 8);
  data.set(input);
  data[len] = 0x80;
  const bits = len * 8;
  for (let i = 0; i < 8; i++)
    data[data.length - 8 + i] = Math.floor(bits / Math.pow(2, 8 * i)) & 255;

  let A = 0x67452301;
  let B = 0xefcdab89;
  let C = 0x98badcfe;
  let D = 0x10325476;
  const M = new Array(16);

  for (let off = 0; off < data.length; off += 64) {
    for (let j = 0; j < 16; j++) {
      let x = 0;
      // MD5 message words are little-endian.
      for (let k = 0; k < 4; k++)
        x = (x | (data[off + j * 4 + k] << (8 * k))) >>> 0;
      M[j] = x;
    }
    let a = A;
    let b = B;
    let c = C;
    let d = D;
    for (let i = 0; i < 64; i++) {
      let f: number;
      if (i < 16)
        f = cmn((b & c) | (~b & d), a, b, M[i], S[i], K[i]);
      else if (i < 32)
        f = cmn((b & d) | (c & ~d), a, b, M[(5 * i + 1) % 16], S[i], K[i]);
      else if (i < 48)
        f = cmn(b ^ c ^ d, a, b, M[(3 * i + 5) % 16], S[i], K[i]);
      else f = cmn(c ^ (b | ~d), a, b, M[(7 * i) % 16], S[i], K[i]);
      const tmp = d;
      d = c;
      c = b;
      b = f;
      a = tmp;
    }
    A = add(A, a);
    B = add(B, b);
    C = add(C, c);
    D = add(D, d);
  }

  const res = new Uint8Array(16);
  const vals = [A, B, C, D];
  for (let i = 0; i < 4; i++) {
    // MD5 serialises each 32-bit word little-endian.
    res[i * 4] = vals[i] & 255;
    res[i * 4 + 1] = (vals[i] >>> 8) & 255;
    res[i * 4 + 2] = (vals[i] >>> 16) & 255;
    res[i * 4 + 3] = (vals[i] >>> 24) & 255;
  }
  return res;
}

// SM3: Chinese national standard hash function

function sm3(data: Uint8Array): Uint8Array {
  // GB/T 32905-2016 SM3. Must match org.bouncycastle.crypto.digests.SM3Digest.
  const rol = (x: number, n: number) => {
    const s = n & 31;
    return ((x << s) | (x >>> (32 - s))) >>> 0;
  };
  const u32 = (x: number) => x >>> 0;
  const add = (...vals: number[]) => {
    let s = 0;
    for (const v of vals) s = (s + (v >>> 0)) >>> 0;
    return s;
  };
  // P0(X) = X xor (X <<< 9) xor (X <<< 17)
  const p0 = (x: number) => u32(x ^ rol(x, 9) ^ rol(x, 17));
  // P1(X) = X xor (X <<< 15) xor (X <<< 23)
  const p1 = (x: number) => u32(x ^ rol(x, 15) ^ rol(x, 23));

  const len = data.length;
  const bitLen = len * 8;
  // Zero bytes after the 0x80 marker so the total is a multiple of 64 bytes.
  const padLen = ((55 - len) % 64 + 64) % 64;
  const padded = new Uint8Array(len + 1 + padLen + 8);
  padded.set(data);
  padded[len] = 0x80;
  for (let i = 0; i < 8; i++)
    padded[padded.length - 1 - i] =
      Math.floor(bitLen / Math.pow(2, 8 * i)) & 255;

  const V = new Uint32Array([
    0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa,
    0xe38dee4d, 0xb0fb0e4e,
  ]);
  const W = new Uint32Array(68);
  const W1 = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    // W0..W15 from the block, big-endian.
    for (let j = 0; j < 16; j++) {
      let x = 0;
      for (let k = 0; k < 4; k++)
        x = ((x << 8) | padded[off + j * 4 + k]) >>> 0;
      W[j] = x;
    }
    // W16..W67
    for (let j = 16; j < 68; j++) {
      W[j] = u32(
        p1(u32((W[j - 16] ^ W[j - 9]) ^ rol(W[j - 3], 15))) ^
          rol(W[j - 13], 7) ^
          W[j - 6]
      );
    }
    // W'[j] = W[j] xor W[j+4]
    for (let j = 0; j < 64; j++) W1[j] = u32(W[j] ^ W[j + 4]);

    let A = V[0];
    let B = V[1];
    let C = V[2];
    let D = V[3];
    let E = V[4];
    let F = V[5];
    let G = V[6];
    let H = V[7];

    for (let j = 0; j < 64; j++) {
      const T = j < 16 ? 0x79cc4519 : 0x7a879d8a;
      const SS1 = rol(u32(rol(A, 12) + E + rol(T, j)), 7);
      const SS2 = u32(SS1 ^ rol(A, 12));
      // FF / GG are round dependent: XOR for the first 16 rounds, then the
      // boolean forms for the remaining 48.
      const ff =
        j < 16 ? u32(A ^ B ^ C) : u32((A & B) | (A & C) | (B & C));
      const gg =
        j < 16 ? u32(E ^ F ^ G) : u32((E & F) | (~E & G));
      const TT1 = u32(add(ff, D, SS2, W1[j]));
      const TT2 = u32(add(gg, H, SS1, W[j]));
      D = C;
      C = rol(B, 9);
      B = A;
      A = TT1;
      H = G;
      G = rol(F, 19);
      F = E;
      E = p0(TT2);
    }

    V[0] = u32(V[0] ^ A);
    V[1] = u32(V[1] ^ B);
    V[2] = u32(V[2] ^ C);
    V[3] = u32(V[3] ^ D);
    V[4] = u32(V[4] ^ E);
    V[5] = u32(V[5] ^ F);
    V[6] = u32(V[6] ^ G);
    V[7] = u32(V[7] ^ H);
  }

  const result = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    result[i * 4] = (V[i] >>> 24) & 255;
    result[i * 4 + 1] = (V[i] >>> 16) & 255;
    result[i * 4 + 2] = (V[i] >>> 8) & 255;
    result[i * 4 + 3] = V[i] & 255;
  }
  return result;
}

function hh(x: number, y: number, z: number) {
  return u32(x ^ y ^ z);
}

function u32(x: number) {
  return x >>> 0;
}

function ror(v: number, n: number) {
  return u32((v >>> n) | (v << (32 - n)));
}

function rol(v: number, n: number) {
  return u32((v << n) | (v >>> (32 - n)));
}

function le32(n: number): Uint8Array {
  return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}

function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function le64(n: number): Uint8Array {
  return new Uint8Array([
    n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255,
    (n >>> 32) & 255, (n >>> 40) & 255, (n >>> 48) & 255, (n >>> 56) & 255,
  ]);
}

function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const r = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    r.set(a, off);
    off += a.length;
  }
  return r;
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  // Kotlin: ByteArray(a.size) { a[it].u() xor b[it % b.size].u() }
  const r = new Uint8Array(a.length);
  for (let i = 0; i < r.length; i++) r[i] = a[i] ^ b[i % b.length];
  return r;
}

function getIv(initial: number, data: Uint8Array): number {
  let value = initial >>> 0;
  for (let i = 0; i < data.length; i++) {
    if ((i & 1) === 0) {
      value = u32(
        ((value >>> 4) ^ value ^ ((value << 6) | (data[i] & 0xff))) >>> 0
      );
    } else {
      value = u32(
        (
          ((value >>> 7) ^
            value ^
            ((data[i] & 0xff) | (value << 12))) ^
          0xffffffff
        ) >>> 0
      );
    }
  }
  return value >>> 0;
}

function rand() {
  return Math.floor(Math.random() * 4294967296);
}

// ----- AesV3 -----
const SBOX = decodeBase64(
  "+n0Ia5xZs0sEXznQOEqRmQBnpiCf9U2Ccybu3xhmgzOAAxn72f6uqqmwUsYL83klTni0NqxdGieeiNu9PGPsSRXBMB/cuFbUbM3KCUPINaPvHvSW0vwOcnuUhNHqRVpiAj/TEoE0K91+5ijypUYTATsh9mE3KSoN7Yyvv51cuyR2D3XkU4nhmI2xmmVwT1RMWKtub4sjxAcRDLrPoKSO2AU9FLLadMPX577Wf95IFj6FkKFVt3dCIsmGUC4X+WQxLJvxbRxEaOPpqJOXyzJX6+Vxaq3AzMfF/WAdoi1Hp+JRaV56zgpBtpWP97mH4DoGEIq1+FvV8LyS/3wvwugbQOwb2r26mJEMsiuDQTRn+wrYdrVGBVlhI3WQhyrjUBVMrLF5667llUcEaPCGPVGLD8qO5LlO8hKCvA7V9+8oJc9bXelqVQLhM76T5/WtnT45JKji+hdX0HoNCDDWuKON/QeaxB5uImSX0h2wv0VmP2zd2yeApxHcpsVS+MC2yFwAc2B7oBkTqsk1SEvTpM2fmfMQREBUfin0Bh+iq6EvPPavhWI2IX9e3yAas7Tm/3KEj2UmlFp36kN4x0rMLBRrxuh0U/zUHM4xcAMYjJY4MonxOl/X+alpt2M3WMI7w3HLnpIBigtNiJu7T21v4P6lSd5WFgntnMEt7oF92XzRLkJbTcGmXepE/UVOG6E/0YnhfS+q26utWcuxzpooyeD2cDlK1/8w9d28VzsRjbLuALbmGlp8+d7EzS6Au7lMpZ+ECMZvQmzwJ+eLOpxR+2chdUExp8ogQyq3v9l68rX4jCwjg0+PYKAEEzcU4wHFY2ZcdIHfWL1okD3SszT0GZMyKdZJrg1L2AeerB4tC0C4crp2EHGo5FYdSP7lwkeR2ocmnR+Ia8CYviUJlzOjhRZef9xuVOn3qcjow3fQgivsAmKKkg4+sA8F8/GWeDiGNhg8JM8KtFPMYWWkx5TVFX5t73kiNRJqjlIGVXtGZFCV4gzt0xcDopuZ6xz8r9Rzafpf9ywev8jh8592gHFIqpStZPuJxmDDMrNN0uBE3V+oscdoIzTJbRJ/t+sVvqnReJOgDJKk10fjisJwqyZBmnmn2BSFj8BvVtCMEbkuPOKdzw7eA11GPs04Qw8zWtkaZWwiO/wwpojqN6K0jY5RnNZA7vn4hPSul+nKCkVnVwQvg1zVxcSCtqORmB9KrJaBbssbCQivGJVJfVTt+hYxOtq4ZvWl8f4QAQZ0zGPffCgl9s6yT4vlvIdpu4YhBwA25wtQWZsc6GJYGWHyvSdeuh3mmUI9DSq13Fsp8C1MU3tqc04/df9LoTUXVXI5INOw/e8C7Hd+5CvbkMEFnnrUUmskEw=="
);

const HASH_TABLE = new Int32Array([
  0xebb64faf, 0x7a0adcc2, 0xcf3187bf, 0xe01138ff, 0x6d0bfcff, 0x5a30a3be,
  0xb41ad638, 0x34180eb8, 0xf233eb6f, 0xb1a584cc, 0xccc30dc7, 0x47d1db51,
  0xd55653de, 0x70a84fa1, 0x57473c12, 0xf76f0288, 0x2c077f0a, 0xda0dcad0,
  0xfbb86f6c, 0xfdc4cf00, 0x688a020d, 0xe676c6a6, 0x8cd6338b, 0x1a3c8d0e,
  0xcce8b06b, 0x6ad0ed0b, 0xa0522717, 0xdc71ac83, 0x2285db71, 0xd5b4dda6,
  0x736f8650, 0x6560306c, 0x617ce2a6, 0xe423417e, 0xa40e143, 0x544e4032,
  0x88dffb2a, 0x716c1ae0, 0x4c467a88, 0x5b023bb3, 0xe1d0b866, 0xbaa3dcb8,
  0xae3374d3, 0xc3381a50, 0x1702f75b, 0xfe6da368, 0xf0b4cf48, 0x4e0ffbb8,
  0x72aad10d, 0x26c53a3d, 0xf2bce0f6, 0xb4557581, 0x4a257fdd, 0x8c3182a2,
  0xab0b3b86, 0x3d5dfb14, 0x4f103634, 0xd37b52d7, 0x444eff16, 0xeb0a33d1,
  0x6ca86f6e, 0x0284ba7, 0x08387cfa, 0x5fb37586,
]);

function boxForWord(word: number): Uint8Array {
  const start = (word & 3) * 256;
  return SBOX.slice(start, start + 256);
}

const AES_CON = [
  [1, 0, 2, 3],
  [2, 0, 3, 1],
  [0, 1, 3, 2],
  [1, 0, 2, 3],
];
const AES_ORDER = [
  [0, 9, 14, 11, 4, 13, 2, 7, 8, 1, 6, 15, 12, 5, 10, 3],
  [0, 9, 14, 15, 4, 13, 2, 7, 8, 1, 6, 3, 12, 5, 10, 11],
  [0, 9, 14, 7, 4, 13, 2, 11, 8, 1, 6, 3, 12, 5, 10, 15],
  [0, 9, 14, 11, 4, 13, 2, 7, 8, 1, 6, 15, 12, 5, 10, 3],
];
const AES_INIT = [0xca025ddc, 0x823dc546, 0xc9420583, 0xc298225f];

function blockEncrypt(
  input: Uint8Array,
  keys: Int32Array[],
  box: Uint8Array,
  con: number[],
  order: number[]
): Uint8Array {
  const rows: number[][] = [
    [input[0], input[1], input[2], input[3]],
    [input[4], input[5], input[6], input[7]],
    [input[8], input[9], input[10], input[11]],
    [input[12], input[13], input[14], input[15]],
  ];

  function addCon(offset: number) {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        rows[i][j] ^= keys[offset + i][con[j]];
  }
  function xt(x: number) {
    return ((x << 1) ^ (x & 128 ? 0x1b : 0)) & 255;
  }

  addCon(0);
  for (let round = 1; round <= 2; round++) {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) rows[i][j] = box[rows[i][j]];
    const before = rows.map((r) => [...r]);
    for (let i = 0; i < 4; i++) rows[i] = [...before[con[i]]];
    const flat: number[] = rows.flatMap((r) => r);
    for (let i = 0; i < 16; i++) rows[Math.floor(i / 4)][i % 4] = flat[order[i]];
    if (round === 1) {
      for (let i = 0; i < 4; i++) {
        const old = [...rows[i]];
        rows[i] = old.map((_, j) => old[con[j]]);
      }
      for (let i = 0; i < 4; i++) {
        const t =
          rows[0][i] ^
          rows[1][i] ^
          rows[2][i] ^
          rows[3][i];
        const u = rows[0][i];
        rows[0][i] ^= t ^ xt(rows[0][i] ^ rows[1][i]);
        rows[1][i] ^= t ^ xt(rows[1][i] ^ rows[2][i]);
        rows[2][i] ^= t ^ xt(rows[2][i] ^ rows[3][i]);
        rows[3][i] ^= t ^ xt(rows[3][i] ^ u);
      }
    }
    addCon(round * 4);
  }
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) rows[i][j] ^= keys[4 + i][j];
  return new Uint8Array(rows.flatMap((r) => r.map((x) => x & 255)));
}

class AesV3 {
  private box: Uint8Array;
  private keys: Int32Array[];

  constructor(key: Uint8Array, timestamp: number) {
    const word = timestamp & 3;
    this.box = boxForWord(word);
    const con = AES_CON[word];
    const order = AES_ORDER[word];

    const initial = AES_INIT[word];
    const expanded: number[] = [];
    for (let i = 0; i < 4; i++) {
      const v = (initial >>> ((3 - i) * 8)) & 255;
      expanded.push(
        (v ^
          key[i * 4] ^
          key[i * 4 + 1] ^
          key[i * 4 + 2] ^
          key[i * 4 + 3]) &
        255
      );
      expanded.push(
        (v ^
          key[i * 4] ^
          key[i * 4 + 1] ^
          key[i * 4 + 2] ^
          key[i * 4 + 3]) &
        255
      );
      expanded.push(
        (v ^
          key[i * 4] ^
          key[i * 4 + 1] ^
          key[i * 4 + 2] ^
          key[i * 4 + 3]) &
        255
      );
      expanded.push(
        (v ^
          key[i * 4] ^
          key[i * 4 + 1] ^
          key[i * 4 + 2] ^
          key[i * 4 + 3]) &
        255
      );
    }
    const keyCopy = Array.from({ length: 48 }, (_, i) => (i < 16 ? expanded[i] : 0));

    let rounds = 8;
    for (let i = 4; i < 12; i++) {
      const at = 4 * (i - 1);
      let a = keyCopy[at],
        b = keyCopy[at + 1],
        c = keyCopy[at + 2],
        d = keyCopy[at + 3];
      if ((i & 3) === 0) {
        const t =
          ((initial >>> (rounds & 24)) ^ this.box[b]) & 255;
        b = this.box[c];
        c = this.box[d];
        d = this.box[a];
        a = t;
        rounds += 2;
      }
      keyCopy[at + 4] = a ^ keyCopy[at - 12];
      keyCopy[at + 5] = b ^ keyCopy[at - 11];
      keyCopy[at + 6] = c ^ keyCopy[at - 10];
      keyCopy[at + 7] = d ^ keyCopy[at - 9];
    }
    this.keys = [];
    for (let i = 0; i < 12; i++)
      this.keys.push(new Int32Array(keyCopy.slice(i * 4, i * 4 + 4)));
  }

  encrypt(source: Uint8Array, iv: Uint8Array): Uint8Array {
    if (source.length < 248) throw new Error("source too short");
    const con = AES_CON[0];
    const order = AES_ORDER[0];

    const plaintext = new Uint8Array(32);
    for (let i = 0; i < 31; i++) {
      const at = i * 8;
      plaintext[i] =
        ((source[at] >>> 4) & 2) |
        (source[at + 1] & 64) |
        ((source[at + 2] >>> 2) & 1) |
        ((source[at + 3] << 3) & 128) |
        ((source[at + 4] >>> 1) & 4) |
        ((source[at + 5] << 3) & 16) |
        ((source[at + 6] << 5) & 32) |
        ((source[at + 7] >>> 4) & 8);
    }
    plaintext[31] = 1;

    const first = blockEncrypt(
      xor(plaintext.slice(0, 16), iv),
      this.keys,
      this.box,
      con,
      order
    );
    const second = blockEncrypt(
      xor(plaintext.slice(16, 32), first),
      this.keys,
      this.box,
      con,
      order
    );
    const key = concat(first, second);

    const out = source.slice();
    for (let i = 0; i < 31; i++) {
      const at = i * 8;
      const k = key[i];
      out[at] = (out[at] & 0xdf) | ((k << 4) & 32);
      out[at + 1] = (out[at + 1] & 0xbf) | (k & 64);
      out[at + 2] = (out[at + 2] & 0xfb) | ((k << 2) & 4);
      out[at + 3] = (out[at + 3] & 0xef) | ((k >>> 3) & 16);
      out[at + 4] = (out[at + 4] & 0xf7) | ((k + k) & 8);
      out[at + 5] = (out[at + 5] & 0xfd) | ((k >>> 3) & 2);
      out[at + 6] = (out[at + 6] & 0xfe) | ((k >>> 5) & 1);
      out[at + 7] = (out[at + 7] & 0x7f) | ((k << 4) & 128);
    }
    return concat(new Uint8Array([key[key.length - 1]]), out);
  }
}

// ----- High-level signing -----
function digest(
  alg: "MD5",
  data: Uint8Array
): Uint8Array {
  if (alg === "MD5") return md5(data);
  throw new Error("Unsupported digest: " + alg);
}

function varint(value: number): Uint8Array {
  const out: number[] = [];
  let n = value;
  while (n > 127) {
    out.push((n & 127) | 128);
    n = n >>> 7;
  }
  out.push(n & 127);
  return new Uint8Array(out);
}

type Field = { tag: number; value: any; type?: string };

function proto(...fields: Field[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const { tag, value, type = "string" } of fields) {
    if (type === "sint") {
      const n = value as number;
      parts.push(varint((tag << 3) | 0));
      parts.push(varint(n < 0 ? -n * 2 - 1 : n * 2));
    } else if (type === "float") {
      parts.push(varint((tag << 3) | 5));
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(
        0,
        value as number,
        true
      );
      parts.push(new Uint8Array(buf));
    } else {
      const bytes =
        value instanceof Uint8Array
          ? value
          : new TextEncoder().encode(String(value));
      if (bytes.length === 0) continue;
      parts.push(varint((tag << 3) | 2));
      parts.push(varint(bytes.length));
      parts.push(bytes);
    }
  }
  return concat(...parts);
}

function deviceProto(device: Record<string, string>): Uint8Array {
  // `f` builds a field descriptor; proto() encodes it.
  const f = (tag: number, value: any, type = "string"): Field => ({
    tag,
    value,
    type,
  });
  return proto(
    f(1, 1, "sint"),
    f(2, 2, "sint"),
    f(3, "8662"),
    f(4, device["device_id"]),
    f(5, "Ai6svO3PyrwDOUSmO6ZcResxu"),
    f(6, "!noperm!"),
    f(7, -888888, "sint"),
    f(8, -888888, "sint"),
    f(9, 3, "sint"),
    f(10, -888888, "sint"),
    f(11, "!notset!"),
    f(12, "Asia/Shanghai,8"),
    f(13, "zh_CN"),
    f(14, 4, "sint"),
    f(16, 255.24993896484375, "float"),
    f(17, 35.58599090576172, "float"),
    f(18, 3.467449188232422, "float"),
    f(19, 3.467449188232422, "float"),
    f(20, 255.1754913330078, "float"),
    f(21, 42.17544174194336, "float"),
    f(22, "16"),
    f(23, 41, "sint"),
    f(24, 36, "sint"),
    f(25, 1728388016635, "sint"),
    f(26, 1728388016635, "sint"),
    f(27, 1728388016635, "sint"),
    f(28, 1728388016637, "sint"),
    f(29, -1, "sint"),
    f(30, "25053RT47C"),
    f(31, "Redmi"),
    f(32, "25053RT47C"),
    f(33, "25053RT47C"),
    f(34, "Xiaomi"),
    f(35, "Redmi"),
    f(36, "Redmi"),
    f(38, 31, "sint")
  );
}

function xmxor(data: Uint8Array, key: Uint8Array): Uint8Array {
  const encoded = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const at = (i * 4) & 28;
    const d0 = key[at] & 255;
    const d1 = key[at + 1] & 255;
    let v = data[i] & 255;
    let d2 = (((v << 4) | (v >>> 4)) & 255) + d0;
    d2 = (~d2) & 255;
    d2 = (d2 ^ d1) & 255;
    d2 = (((d2 & 255) << 3) | ((d2 & 255) >>> 5)) & 255;
    d2 = (d2 + d1) & 255;
    d2 = (d2 ^ d0) & 255;
    encoded[data.length - i - 1] = (~d2) & 255;
  }
  const last = encoded[encoded.length - 1] ^ encoded[encoded.length - 2];
  const first = encoded[0];
  encoded[0] = (last + first) & 255;
  encoded[1] = ((encoded[0] ^ encoded[encoded.length - 1] ^ 254) + encoded[1]) & 255;
  encoded[2] = (encoded[2] + (((last - first) ^ ((((encoded[1] << 3) | (encoded[1] >>> 5)) & 255) ^ 2))) & 255);
  for (let i = 0; i < encoded.length - 4; i++) {
    const temp =
      (((encoded[i + 2] << 3) | (encoded[i + 2] >>> 5)) & 255) ^
      encoded[i + 1] ^
      (i + 3);
    encoded[i + 3] = ((~temp) + encoded[i + 3]) & 255;
  }
  encoded[encoded.length - 1] = encoded[encoded.length - 1] ^ encoded[encoded.length - 2];
  encoded[0] = ((encoded[0] ^ encoded[1]) + encoded.slice(1).reduce((a, b) => a + b, 0)) & 255;
  return new Uint8Array(encoded);
}

function branch(query: Uint8Array, body: Uint8Array | null, ts: number): number {
  const bodyMd5 = body ? digest("MD5", body) : new Uint8Array(16);
  // Signer.branch() hashes the query with SM3 before deriving the branch.
  const ivVal = getIv(getIv(getIv(0x20230928, sm3(query)), bodyMd5), le32(ts));
  return ((ivVal >>> 0) & 15) % 3;
}

function sumMd5(data: Uint8Array): number {
  let check = 0x20220420;
  for (let i = 0; i < 12; i++) {
    const temp =
      (check >>> (i & 1 ? 5 : 3)) ^ check;
    if ((i & 1) === 0) {
      check = (data[i] & 255) ^ (check << 7);
    } else {
      check = ((data[i] & 255) | (check << 11)) ^ 0xffffffff;
    }
    check = (check ^ temp) >>> 0;
  }
  return ((check | 4) ^ 0x1000000) >>> 0;
}

function hashF13(
  query: Uint8Array,
  body: Uint8Array,
  ts: number
): Uint8Array {
  const ivVal = getIv(getIv(getIv(0x20230928, query), body), le32(ts));
  const index = ((ivVal >>> 0) & 15) / 3;
  if (((ivVal >>> 0) & 15) % 3 !== 0) throw new Error("Unsupported hash branch");

  const ivV1Arr = [
    0xc4a78580, 0xb3c0fd39, 0xc58c5686, 0xc9aa3ba7, 0xf5a7adf2, 0x963c2ed1,
  ];
  const ivV1 = ivV1Arr[index];
  const count = ivV1 + ts;
  const countLow = count & 0xff;

  const tt = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    const r = HASH_TABLE[i];
    tt[i] = ror(r, (countLow + 1) & 255);
  }

  const shift = (countLow + 2) & 7;
  const padArr = [0xfa, 0x45, 0x61, 0xd7].map((it) =>
    ((it | (it << 8)) >>> shift) & 255
  );
  const pad = new Uint8Array(padArr);
  const hexTail = hex("00000000000001a0");
  const data = concat(query, body, le32(ts), pad, hexTail);

  // Kotlin builds `di` as a growable list: the 16 big-endian words of `data`
  // followed by 112 expanded words appended one by one.
  const di: number[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    let x = 0;
    for (let k = 0; k < 4; k++) x = (x << 8) | (data[i + k] & 255);
    di.push(x | 0);
  }
  for (let i = 0; i < 112; i++) {
    const x = di[i + 1];
    const y = di[i + 14];
    const x1 = rol(x, 14) ^ rol(x, 25) ^ (x >>> 3);
    const y1 = rol(y, 13) ^ rol(y, 15) ^ (y >>> 10);
    di.push((di[i] + di[i + 9] + x1 + y1) | 0);
  }

  const initArr = [
    0x7aba4fc8, 0x67166507, 0x6403fa00, 0x340f512f, 984304912,
    3005047866, 2874125293, 2152413264,
  ];
  const initial = new Int32Array(initArr.map((v) => ror(v, countLow)));

  const chosenArr = [
    [101, 5, 7, 6, 3, 2, 1, 0, 5, 4, 3],
    [96, 0, 6, 7, 5, 3, 2, 1, 5, 4, 4],
    [96, 7, 6, 2, 1, 4, 0, 5, 4, 3, 5],
    [99, 3, 6, 2, 4, 5, 1, 0, 0, 7, 6],
    [96, 0, 5, 6, 7, 3, 1, 2, 5, 4, 4],
    [100, 2, 0, 3, 5, 4, 6, 7, 2, 1, 5],
  ][index];

  const d = [...initial];

  for (let i = 0; i < chosenArr[0]; i++) {
    const base = ivV1 + i;
    const n1 = ((d[chosenArr[3]] ^ d[chosenArr[4]]) & d[chosenArr[1]]) ^ d[chosenArr[3]];
    const n2 = ror(d[chosenArr[1]], 26) ^ ror(d[chosenArr[1]], 21) ^ ror(d[chosenArr[1]], 7);
    const n4 = (di[base & 127] + n1 + n2 + tt[base & 63] + d[chosenArr[5]]) >>> 0;
    const n5 = ror(d[chosenArr[2]], 30) ^ ror(d[chosenArr[2]], 19) ^ ror(d[chosenArr[2]], 10);
    const n6 =
      (d[chosenArr[2]] & d[chosenArr[6]]) |
      ((d[chosenArr[2]] | d[chosenArr[6]]) & d[chosenArr[7]]);
    const old = d[chosenArr[9]];
    // Kotlin: d.add(0, d.removeAt(7)) — element 7 moves to the front.
    d.unshift(d.splice(7, 1)[0]);
    d[chosenArr[10]] = (n5 + n6 + n4) >>> 0;
    d[chosenArr[8]] = ((old + n4) >>> 0);
  }

  let ret: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < 8; i++) {
    ret = concat(ret, be32((d[i] + initial[i]) >>> 0));
  }
  const folded = xor(ret.slice(0, 16), ret.slice(16, 32));
  return concat(folded, le32(sumMd5(folded) & 0xffffffff));
}

function gorgon(
  query: string,
  body: Uint8Array | null,
  ts: number,
  random: number
): string {
  const queryBytes = new TextEncoder().encode(query);
  const qMd5 = digest("MD5", queryBytes).slice(0, 4);
  const bMd5 = body ? digest("MD5", body).slice(0, 4) : new Uint8Array(4);
  const input = concat(
    qMd5,
    bMd5,
    new Uint8Array(4),
    le32(67503104),
    be32(ts)
  );
  const key = new Uint8Array([
    0x4a, 0x40, 0x16, (random >>> 8) & 255, 0x47, 0x6c, 1, random & 255,
  ]);
  const s = new Int32Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i & 7]) & 255;
    // Kotlin assigns s[i] = s[j]; it is not a swap.
    s[i] = s[j];
  }
  j = 0;
  const out = new Uint8Array(input.length);
  for (let n = 0; n < input.length; n++) {
    const i = n + 1;
    j = j + s[i & 255];
    const y = s[j & 255];
    s[i & 255] = y;
    out[n] = ((input[n] ^ s[(y + y) & 255])) & 255;
  }
  for (let i = 0; i < out.length; i++) {
    const value = (((out[i] >>> 4) | (out[i] << 4)) & 255);
    const next = i + 1 < out.length ? out[i + 1] : 0;
    const byte = (next ^ value) & 255;
    const r1 = ((byte >> 1) & 0x55) | ((byte & 0x55) << 1);
    const r2 = ((r1 >> 2) & 0x33) | ((r1 & 0x33) << 2);
    const reversed8 = ((r2 >> 4) & 0x0f) | ((r2 & 0x0f) << 4);
    out[i] = (~(reversed8 ^ 20)) & 255;
  }
  return bytesToHex(
    concat(hex("8404"), new Uint8Array([random & 255, (random >>> 8) & 255, 0x40, 1]), out)
  );
}



function medusa(
  url: string,
  body: Uint8Array | null,
  ts: number,
  device: Record<string, string>
): string {
  const bodyMd5 = body ? digest("MD5", body) : new Uint8Array(16);
  const queryBytes = new TextEncoder().encode(url.substring(url.indexOf("?") + 1));
  const querySm3 = sm3(queryBytes);
  const queryBodyTs = hashF13(querySm3, bodyMd5, ts);

  const nested = proto(
    { tag: 1, value: 111, type: "sint" },
    { tag: 2, value: 10, type: "sint" },
    { tag: 3, value: 694367, type: "sint" },
    { tag: 5, value: 586952199, type: "sint" }
  );

  const messageRand = rand();
  const envLaunch = Math.floor(Math.random() * 21) + 100;
  const envPid = Math.floor(Math.random() * 2000) + 10001;
  const version = device["version_name"];

  const env = proto(
    { tag: 1, value: envLaunch, type: "sint" },
    { tag: 2, value: 146331399, type: "sint" },
    { tag: 3, value: 146331396, type: "sint" },
    { tag: 5, value: 7, type: "sint" },
    { tag: 6, value: "v04.06.04.03-bugfix" },
    { tag: 7, value: envPid, type: "sint" },
    { tag: 12, value: deviceProto(device) },
    {
      tag: 13,
      value: proto(
        { tag: 1, value: Math.floor(Date.now() / 1000), type: "sint" },
        { tag: 2, value: -2, type: "sint" },
        { tag: 4, value: 200, type: "sint" }
      ),
    },
    { tag: 14, value: version }
  );

  const queryHash = sm3(concat(queryBytes, bodyMd5, new TextEncoder().encode("none")));
  const message = proto(
    { tag: 1, value: hex("f7e85ffad7d7dc3bd62ac87057cf6118") },
    { tag: 2, value: 3, type: "sint" },
    { tag: 3, value: messageRand, type: "sint" },
    { tag: 4, value: "8662" },
    { tag: 5, value: device["device_id"] },
    { tag: 6, value: "1588093228" },
    { tag: 7, value: version },
    { tag: 8, value: "v04.06.04-ml-android" },
    { tag: 9, value: 67503104, type: "sint" },
    { tag: 10, value: hex("4001000000000000") },
    { tag: 12, value: ts, type: "sint" },
    { tag: 13, value: queryBodyTs },
    { tag: 14, value: querySm3.slice(0, 6) },
    { tag: 15, value: nested },
    { tag: 16, value: "AXYQOS6n2m60x1fVZHIrH3iol" },
    { tag: 17, value: ts, type: "sint" },
    { tag: 19, value: queryHash },
    { tag: 20, value: "none" },
    { tag: 21, value: 312, type: "sint" },
    { tag: 23, value: env },
    {
      tag: 24,
      value: `{"cmr":16777216,"cmr2":16777216,"un_h":1879194040,"vpn":0,"kd":0,"fkd":3672518972,"pd":-1872573247,"dyn":"","do":0,"tk":true}`,
    }
  );

  const r = rand();
  const signKey = hex("8ebdfa3806ecc5cee79423e6029ed82540bc2218bb7eaef71cb691f7aa8aa2f5");
  const hash = sm3(concat(signKey, le32(r), signKey));
  const d1 = (r >>> 16) & 255;
  const seed = le32((((((d1 << 11) | (r >>> 24)) ^ ((d1 >>> 5) ^ d1)) ^ 0xffffffff) >>> 0));

  const xoredMsg = xmxor(message, hash);
  const transformed = Array.from(
    concat(hex("4001000000000000"), xoredMsg)
  ).reverse();
  for (let i = 0; i < transformed.length; i++) {
    // Kotlin uses seed[i.inv() and 3].
    transformed[i] ^= seed[(~i) & 3];
  }
  const check =
    (((querySm3[0] & 63) << 14) | 0x18000001 | ((queryBodyTs[0] & 63) << 8)) >>> 0;

  const packed = concat(
    new Uint8Array([0x35]),
    le32(rand()),
    le32(check),
    new Uint8Array(transformed),
    new Uint8Array([(r >>> 16) & 255, (r >>> 24) & 255])
  );

  const aes = new AesV3(
    hex("f1593376766ea98d34f31b057a9d5be4"),
    ts
  );
  const encrypted = aes.encrypt(
    packed,
    hex("1fe109a4125283f418de9e051a969e12")
  );

  const versionBytes = hex("03000000f7e85ffad7d7dc3bd62ac87057cf6118");
  let prefix: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < 20; i += 4) {
    // Kotlin reads versionBytes.i32(i, true) — little-endian.
    const word =
      (versionBytes[i] |
        (versionBytes[i + 1] << 8) |
        (versionBytes[i + 2] << 16) |
        (versionBytes[i + 3] << 24)) >>>
      0;
    prefix = concat(prefix, le32((word ^ ts) >>> 0));
  }
  const finalBytes = concat(
    prefix,
    new Uint8Array([r & 255, (r >>> 8) & 255, 0, 1]),
    encrypted
  );
  return btoa(String.fromCharCode(...finalBytes));
}

// 64-bit helpers — the Kotlin side works on java.lang.Long for helios.
const U64 = (1n << 64n) - 1n;
function ror64(v: bigint, n: bigint): bigint {
  return ((v >> n) | (v << (64n - n))) & U64;
}
function le64Bytes(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let x = v & U64;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
function i64le(at: number, data: Uint8Array): bigint {
  let x = 0n;
  for (let k = 0; k < 8; k++) x |= BigInt(data[at + k]) << BigInt(8 * k);
  return x & U64;
}

function helios(ts: number): string {
  const random = rand();
  const md5Out = digest("MD5", concat(le32(random), new TextEncoder().encode("8662")));
  const hexStr = bytesToHex(md5Out);
  // ascii.i64(it * 8, true) — little-endian 64-bit words of the hex text.
  const words: bigint[] = [];
  for (let i = 0; i < 4; i++) {
    words.push(i64le(i * 8, new TextEncoder().encode(hexStr)));
  }
  const table: bigint[] = [words[0]];
  // b0 = words.removeAt(0); b8 = words.removeAt(0)  ->  queue holds the rest.
  let b0 = words[0];
  let b8 = words[1];
  const queue: bigint[] = [words[2], words[3]];
  for (let i = 0; i < 34; i++) {
    let x8 = ((ror64(b8, 8n) + b0) & U64) ^ BigInt(i);
    queue.push(x8 & U64);
    x8 = (x8 ^ ror64(b0, 61n)) & U64;
    table.push(x8);
    b0 = x8;
    b8 = queue.shift()!;
  }

  const textBytes = new TextEncoder().encode(`${ts}-1588093228-8662`);
  const padLen = 16 - (textBytes.length % 16);
  const padded = new Uint8Array(textBytes.length + padLen);
  padded.set(textBytes);
  for (let i = 0; i < padLen; i++) padded[textBytes.length + i] = padLen;

  let output = le32(random);
  for (let at = 0; at < padded.length; at += 16) {
    let a = i64le(at, padded);
    let b = i64le(at + 8, padded);
    for (let i = 0; i < 34; i++) {
      b = (table[i] ^ ((a + ror64(b, 8n)) & U64)) & U64;
      a = (b ^ ror64(a, 61n)) & U64;
    }
    output = concat(output, le64Bytes(a), le64Bytes(b));
  }
  return btoa(String.fromCharCode(...output));
}

function ladon(ts: number): string {
  return btoa(
    String.fromCharCode(
      ...Array.from(be32(ts)).map((b, i) =>
        i < 3 ? ((b >>> (i * 8)) & 255) : 0
      )
    )
  ).replace(/=+$/, "");
}

function argus(ts: number): string {
  return btoa(
    String.fromCharCode(...Array.from(le32(ts)))
  ).replace(/=+$/, "");
}

type SignedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
};

function encodeValue(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/%7E/g, "~");
}

function encodeParams(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([k, v]) => `${encodeValue(k)}=${encodeValue(v)}`)
    .join("&");
}

export function newDevice(): Record<string, string> {
  const digits = (n: number) =>
    Array.from({ length: n }, () => String(Math.floor(Math.random() * 10))).join("");
  const base: Record<string, string> = {
    iid: "",
    device_id: "",
    ac: "wifi",
    channel: "update_64",
    aid: "8662",
    app_name: "novelread",
    version_code: "71332",
    version_name: "7.1.3.32",
    device_platform: "android",
    os: "android",
    ssmix: "a",
    device_type: "25053RT47C",
    device_brand: "Redmi",
    language: "zh",
    os_api: "36",
    os_version: "16",
    manifest_version_code: "71332",
    resolution: "1280*2772",
    dpi: "520",
    update_version_code: "71332",
    host_abi: "arm64-v8a",
    dragon_device_type: "phone",
    pv_player: "71332",
    compliance_status: "0",
    need_personal_recommend: "1",
    player_so_load: "1",
    is_android_pad_screen: "0",
  };
  return { ...base, iid: digits(16), device_id: digits(16) };
}

export function sign(
  base: string,
  values: Record<string, string>,
  body: Uint8Array | null = null
): SignedRequest {
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  let ticket = now;

  for (let offset = 0; offset <= 127; offset++) {
    ticket = now + offset;
    const params: Record<string, string> = {
      ...values,
      ts: String(ts),
      _rticket: String(ticket),
    };
    const query = encodeParams(params);
    const qBytes = new TextEncoder().encode(query);

    const b = branch(qBytes, body, ts);
    if (b === 0) {
      const url = `${base}?${query}`;
      const random = Math.floor(Math.random() * 65536);
      const headers: Record<string, string> = {
        "User-Agent": body ? VIDEO_UA : APP_UA,
        Accept: "application/json; charset=utf-8,application/x-protobuf",
        "x-ss-req-ticket": String(ticket),
        "x-tt-request-tag": "t=0;n=0",
        "sdk-version": "2",
        "passport-sdk-version": "50561",
        "x-xs-from-web": "0",
        "x-khronos": String(ts),
        "x-ladon": ladon(ts),
        "x-argus": argus(ts),
        "x-gorgon": gorgon(query, body, ts, random),
        "x-helios": helios(ts),
        "x-medusa": medusa(url, body, ts, values as Record<string, string>),
        "x-tt-dt": "",
      };
      if (body !== null) {
        headers["Content-Type"] = "application/json; charset=UTF-8";
        headers["x-vc-bdturing-sdk-version"] = "3.7.2.cn";
        headers["x-ss-stub"] = bytesToHex(digest("MD5", body)).toUpperCase();
      }
      return { url, headers, body };
    }
  }
  throw new Error("无法生成请求签名");
}
