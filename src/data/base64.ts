/**
 * Base64 codec.
 *
 * `react-native-file-access` can only read and write strings, so binary media
 * has to cross the bridge as base64. React Native ships no `btoa`/`atob` in
 * the JS runtime that is guaranteed to exist, and `Buffer` is not there
 * either, so this is a small hand rolled implementation.
 *
 * It is written for speed because a 12 MB video passes through it twice
 * (read: base64 -> bytes, write: bytes -> base64).
 */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Reverse lookup: char code -> 6 bit value, -1 for anything invalid. */
const LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

// Encoding is done through char codes so the hot loop never builds a string
// per character; the codes are flushed in batches.
const BATCH = 4096;

export function base64Encode(bytes: Uint8Array): string {
  const len = bytes.length;
  if (len === 0) return "";
  const parts: string[] = [];
  const batch: number[] = [];
  let i = 0;
  const limit = len - 2;
  for (; i < limit; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    batch.push(
      ALPHABET.charCodeAt((n >>> 18) & 63),
      ALPHABET.charCodeAt((n >>> 12) & 63),
      ALPHABET.charCodeAt((n >>> 6) & 63),
      ALPHABET.charCodeAt(n & 63)
    );
    if (batch.length >= BATCH) {
      parts.push(String.fromCharCode.apply(null, batch));
      batch.length = 0;
    }
  }
  if (i < len) {
    const rest = len - i;
    const n = (bytes[i] << 16) | (rest > 1 ? bytes[i + 1] << 8 : 0);
    batch.push(
      ALPHABET.charCodeAt((n >>> 18) & 63),
      ALPHABET.charCodeAt((n >>> 12) & 63)
    );
    if (rest > 1) {
      batch.push(ALPHABET.charCodeAt((n >>> 6) & 63), 61);
    } else {
      batch.push(61, 61);
    }
  }
  if (batch.length) parts.push(String.fromCharCode.apply(null, batch));
  return parts.join("");
}

export function base64Decode(text: string): Uint8Array {
  const len = text.length;
  // Every 4 characters carry 3 bytes; the tail is handled separately.
  const full = len - (len % 4);
  const out = new Uint8Array(Math.floor((full * 3) / 4) + 2);
  let o = 0;
  let i = 0;
  for (; i < full; i += 4) {
    const a = LOOKUP[text.charCodeAt(i)];
    const b = LOOKUP[text.charCodeAt(i + 1)];
    const c = LOOKUP[text.charCodeAt(i + 2)];
    const d = LOOKUP[text.charCodeAt(i + 3)];
    if (a < 0 || b < 0) continue;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out[o++] = (n >>> 16) & 0xff;
    if (c >= 0) out[o++] = (n >>> 8) & 0xff;
    if (d >= 0) out[o++] = n & 0xff;
  }
  if (i < len) {
    const a = LOOKUP[text.charCodeAt(i)];
    const b = LOOKUP[text.charCodeAt(i + 1)];
    if (a >= 0 && b >= 0) {
      const n = (a << 18) | (b << 12);
      out[o++] = (n >>> 16) & 0xff;
      if (LOOKUP[text.charCodeAt(i + 2)] >= 0) out[o++] = (n >>> 8) & 0xff;
    }
  }
  return out.subarray(0, o);
}
