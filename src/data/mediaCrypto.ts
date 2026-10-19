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
import { base64Decode } from "./base64";
import { BAD_CONTENT_KEY, BAD_PLAYBACK_ADDRESS } from "./errors";

/** Base64 decoder that also accepts the URL-safe alphabet, like the Kotlin. */
export function decodeBase64Url(input: string): Uint8Array {
  if (typeof input !== "string") throw new Error(BAD_CONTENT_KEY);
  return base64Decode(input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, ""));
}

/**
 * Hex decoder that rejects anything that is not a hex digit.
 *
 * The Kotlin's hex() uses toInt(16), which throws on a bad digit, so a
 * malformed blob is rejected instead of being turned into a key full of
 * zeros. parseInt would return NaN, and a NaN written into a Uint8Array
 * becomes 0, which would quietly produce a wrong content key.
 */
function hexToBytes(s: string): Uint8Array {
  if (s.length % 2 !== 0) throw new Error(BAD_CONTENT_KEY);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    const pair = s.slice(i, i + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) throw new Error(BAD_CONTENT_KEY);
    out[i / 2] = parseInt(pair, 16);
  }
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
  if (raw.length < 3) throw new Error(BAD_CONTENT_KEY);
  const length = Math.min(
    raw.length - ((raw[0] ^ raw[1] ^ raw[2]) & 0xff) + 47,
    raw.length - 1
  );
  if (length < 33) throw new Error(BAD_CONTENT_KEY);
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
  if (key.length !== 16) throw new Error(BAD_CONTENT_KEY);
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
    throw new Error(BAD_PLAYBACK_ADDRESS);
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
