/**
 * MediaCrypto — the media side of the signed player.
 *
 * Ported from kotlin-tv/core/src/main/kotlin/com/hongguotv/core/MediaCrypto.kt.
 *
 * The signed endpoint hands out two secrets:
 *   - `key_seed`  encrypts the real media URL (AES-128-CBC).
 *   - `spade_a`   derives the AES-CTR key for the MP4 sample payloads.
 *
 * The MP4 itself is standard CENC (encryption_method = cenc-aes-ctr) with
 * HEVC (bytevc1) video, so once the samples are decrypted and the `encv`
 * box is rewritten back to the original codec, iOS can play it natively.
 */
import { sha512, aesDecryptCbc } from "./crypto";

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 decoder that also accepts the URL-safe alphabet, like the Kotlin. */
export function decodeBase64Url(input: string): Uint8Array {
  const s = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const idx = B64.indexOf(s[i]);
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

function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2)
    out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function popcount(n: number): number {
  let c = 0;
  let v = n;
  while (v) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

/**
 * Derives the 16 byte content key from the `spade_a` blob.
 * MediaCrypto.deriveKey in the Kotlin.
 */
export function deriveKey(value: string): Uint8Array {
  const raw = decodeBase64Url(value);
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
    let previous: number;
    if (i & 1) {
      previous = a;
      a = old;
    } else {
      previous = b;
      b = old;
    }
    work[i] = (-21 - popcount(i) + (previous ^ old)) & 0xff;
  }
  const text = String.fromCharCode(...work.slice(1, 33));
  const key = hexToBytes(text);
  if (key.length !== 16) throw new Error("内容密钥格式异常");
  return key;
}

const URL_CONSTANTS = hexToBytes(
  "4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f" +
    "49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58"
);

/**
 * Decrypts the opaque `main_url` into the real media URL.
 * MediaCrypto.decryptUrl in the Kotlin.
 */
export function decryptUrl(value: string, seed: Uint8Array): string {
  const raw = decodeBase64Url(value);
  if (
    raw.length < 20 ||
    raw[0] !== 0xa8 ||
    raw[2] !== 1 ||
    raw[3] !== 0
  ) {
    throw new Error("播放地址格式异常");
  }
  const inner = sha512(seed);
  const h = sha512(concat(inner, URL_CONSTANTS));
  const bodyLen = 4 + Math.floor((raw.length - 4) / 16) * 16;
  const bytes = aesDecryptCbc(
    h.slice(0, 16),
    h.slice(16, 32),
    raw.slice(4, bodyLen)
  );
  let end = bytes.length;
  const padding = bytes[bytes.length - 1] & 0xff;
  if (padding >= 1 && padding <= 16 && padding <= end) end -= padding;
  while (end > 0 && bytes[end - 1] === 0) end--;
  let text = "";
  for (let i = 0; i < end; i++) text += String.fromCharCode(bytes[i]);
  return text;
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

export { bytesToHex, hexToBytes };
