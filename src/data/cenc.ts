/**
 * CENC (Common Encryption) MP4 handling.
 *
 * Ported from kotlin-tv/core/src/main/kotlin/com/hongguotv/core/MediaCrypto.kt.
 *
 * The signed player serves MP4 files whose video track is an `encv` box
 * holding HEVC (`bytevc1`) samples encrypted with AES-CTR, one IV per
 * sample. iOS AVPlayer cannot decrypt that on its own, so the app has to
 *
 *   1. read the sample table out of the `moov` box (stsz/stsc/stco/saiz/saio),
 *   2. rewrite the header so the track looks like a plain `hvc1` track again
 *      (the original codec is preserved in the `frma` box), and
 *   3. decrypt every sample with AES-CTR using the per-sample IV.
 *
 * The result is an ordinary MP4 that AVPlayer plays natively.
 *
 * Layout note: the file starts with `ftyp` and the `moov` box follows it
 * immediately, so the whole sample table sits in the first few hundred KB
 * and the box offsets are absolute file offsets.
 */
import { aesCtr } from "./crypto";

export type Sample = {
  start: number;
  end: number;
  iv: Uint8Array; // 16 bytes: 8 byte per-sample IV + 8 zero bytes
  encryptedOffset: number;
};

export type Prepared = {
  header: Uint8Array;
  samples: Sample[];
};

type Box = { start: number; end: number; body: number; type: string };

function u32(d: Uint8Array, at: number): number {
  return (
    ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0
  );
}

/** 64 bit big-endian read - ISO BMFF stores box sizes and offsets big-endian. */
function u64(d: Uint8Array, at: number): number {
  let v = 0;
  for (let i = 0; i < 8; i++) v = v * 256 + d[at + i];
  return v;
}

function i32(d: Uint8Array, at: number): number {
  return u32(d, at) | 0;
}

function ascii(d: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(d[at + i]);
  return s;
}

function box(data: Uint8Array, at: number, limit: number): Box | null {
  if (at < 0 || at + 8 > limit) return null;
  let size = u32(data, at);
  let header = 8;
  if (size === 1) {
    if (at + 16 > limit) return null;
    size = u64(data, at + 8);
    header = 16;
  }
  if (size === 0) size = limit - at;
  if (size < header || size > limit - at) return null;
  return {
    start: at,
    end: at + size,
    body: at + header,
    type: ascii(data, at + 4, 4),
  };
}

/**
 * Scans for a box of the given type. The four character type is looked up
 * before the full box header is validated, so this is a byte-wise scan -
 * the same trick the Kotlin uses.
 */
function find(
  data: Uint8Array,
  type: string,
  start: number,
  limit: number
): Box | null {
  const first = type.charCodeAt(0);
  for (let at = start; at <= limit - 8; at++) {
    if (data[at + 4] === first) {
      const b = box(data, at, limit);
      if (b && b.type === type) return b;
    }
  }
  return null;
}

/**
 * Locates the end of the `moov` box from the first bytes of the file.
 * The container starts with `ftyp` and the sample table follows immediately,
 * so the header region is small and can be read on its own.
 * Mirrors MediaCrypto.headerEnd in the Kotlin.
 */
export function headerEnd(first: Uint8Array, total: number): number {
  if (first.length < 16 || ascii(first, 4, 4) !== "ftyp")
    throw new Error("不支持的视频容器");
  const ftyp = u32(first, 0);
  if (ftyp < 8 || ftyp + 8 > first.length || ascii(first, ftyp + 4, 4) !== "moov")
    throw new Error("视频索引不在文件开头");
  const size = u32(first, ftyp);
  const end = ftyp + size;
  if (size < 8 || end > total || end > 8 * 1024 * 1024)
    throw new Error("视频索引大小异常");
  return end;
}

/**
 * Reads the sample table and rewrites the header into a plain track.
 * `key` is null for clear content, in which case the file is returned as-is.
 */
export function prepare(data: Uint8Array, key: Uint8Array | null): Prepared {
  const header = new Uint8Array(data);
  if (!key) return { header, samples: [] };

  // The first box is `ftyp`; the sample table lives in the `moov` right after it.
  const moov = box(data, u32(data, 0), data.length);
  if (!moov || moov.type !== "moov") throw new Error("视频索引不完整");

  const samples: Sample[] = [];
  let cursor = moov.body;
  while (cursor < moov.end) {
    const track = box(data, cursor, moov.end);
    if (!track) throw new Error("视频轨道格式异常");
    cursor = track.end;
    if (track.type !== "trak") continue;

    const stbl = find(data, "stbl", track.body, track.end);
    if (!stbl) continue;
    const saiz = find(data, "saiz", stbl.body, stbl.end);
    if (!saiz) continue;
    const saio = find(data, "saio", stbl.body, stbl.end);
    if (!saio) throw new Error("视频加密索引缺失");
    const stsz = find(data, "stsz", stbl.body, stbl.end);
    if (!stsz) throw new Error("样本索引缺失");
    const stsc = find(data, "stsc", stbl.body, stbl.end);
    if (!stsc) throw new Error("块索引缺失");
    let chunks = find(data, "stco", stbl.body, stbl.end);
    if (!chunks) {
      chunks = find(data, "co64", stbl.body, stbl.end);
      if (!chunks) throw new Error("块偏移缺失");
    }

    const count = (at: number, limit: number): number => {
      if (at + 4 > limit) throw new Error("索引越界");
      const n = u32(data, at);
      if (n > 200000) throw new Error("索引数量过大");
      return n;
    };

    const n = count(stsz.body + 8, stsz.end);
    const defaultSize = u32(data, stsz.body + 4);
    if (defaultSize === 0 && stsz.body + 12 + n * 4 > stsz.end)
      throw new Error("样本索引截断");
    const sizes: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      sizes[i] = defaultSize > 0 ? defaultSize : u32(data, stsz.body + 12 + i * 4);
    }

    const chunkCount = count(chunks.body + 4, chunks.end);
    const width = chunks.type === "co64" ? 8 : 4;
    if (chunks.body + 8 + chunkCount * width > chunks.end)
      throw new Error("块偏移截断");
    const offsets: number[] = new Array(chunkCount);
    for (let i = 0; i < chunkCount; i++) {
      offsets[i] =
        width === 8
          ? u64(data, chunks.body + 8 + i * width)
          : u32(data, chunks.body + 8 + i * width);
    }

    const entryCount = count(stsc.body + 4, stsc.end);
    if (stsc.body + 8 + entryCount * 12 > stsc.end || entryCount === 0)
      throw new Error("块索引截断");
    const entries: Array<{ first: number; count: number }> = new Array(
      entryCount
    );
    for (let i = 0; i < entryCount; i++) {
      entries[i] = {
        first: u32(data, stsc.body + 8 + i * 12),
        count: u32(data, stsc.body + 12 + i * 12),
      };
    }

    // ISO BMFF auxiliary-info flags may insert an eight-byte type/parameter pair.
    const sizeBase = saiz.body + 4 + (i32(data, saiz.body) & 1 ? 8 : 0);
    if (sizeBase + 5 > saiz.end) throw new Error("辅助索引截断");
    const auxDefault = data[sizeBase] & 0xff;
    const auxCount = count(sizeBase + 1, saiz.end);
    if (auxCount !== n || (auxDefault === 0 && sizeBase + 5 + n > saiz.end))
      throw new Error("辅助索引数量不一致");
    const auxSizes: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      auxSizes[i] = auxDefault > 0 ? auxDefault : data[sizeBase + 5 + i] & 0xff;
    }

    const offsetBase = saio.body + 4 + (i32(data, saio.body) & 1 ? 8 : 0);
    const offsetWidth = (data[saio.body] & 0xff) === 1 ? 8 : 4;
    if (count(offsetBase, saio.end) !== 1 || offsetBase + 4 + offsetWidth > saio.end)
      throw new Error("不支持的辅助索引布局");
    let aux =
      offsetWidth === 8
        ? u64(data, offsetBase + 4)
        : u32(data, offsetBase + 4);
    let auxEnd = aux;
    for (let i = 0; i < n; i++) auxEnd += auxSizes[i];
    if (aux < 0 || auxEnd > data.length) throw new Error("辅助数据超出索引范围");

    let sampleIndex = 0;
    let entry = 0;
    for (let chunk = 0; chunk < offsets.length; chunk++) {
      while (
        entry + 1 < entries.length &&
        entries[entry + 1].first <= chunk + 1
      ) {
        entry++;
      }
      const sampleCount = entries[entry].count;
      if (sampleCount > n - sampleIndex || entries[entry].first > chunk + 1)
        throw new Error("样本与块数量不一致");
      let position = offsets[chunk];
      for (let k = 0; k < sampleCount; k++) {
        const length = sizes[sampleIndex];
        const auxSize = auxSizes[sampleIndex];
        if (position < 0 || length <= 0 || auxSize < 8)
          throw new Error("样本索引异常");
        const iv = new Uint8Array(16);
        iv.set(data.subarray(aux, aux + 8));
        if (auxSize === 8) {
          samples.push({
            start: position,
            end: position + length,
            iv,
            encryptedOffset: 0,
          });
        } else {
          if (auxSize < 10) throw new Error("不支持的加密样本格式");
          const subs =
            ((data[aux + 8] & 0xff) << 8) | (data[aux + 9] & 0xff);
          if (auxSize !== 10 + subs * 6) throw new Error("加密子样本索引异常");
          let offset = position;
          let encrypted = 0;
          for (let sub = 0; sub < subs; sub++) {
            const at = aux + 10 + sub * 6;
            const clear = ((data[at] & 0xff) << 8) | (data[at + 1] & 0xff);
            const size = u32(data, at + 2);
            offset += clear;
            if (offset + size > position + length)
              throw new Error("加密子样本越界");
            if (size > 0) {
              samples.push({
                start: offset,
                end: offset + size,
                iv,
                encryptedOffset: encrypted,
              });
            }
            encrypted += size;
            offset += size;
          }
          if (offset !== position + length)
            throw new Error("加密子样本长度异常");
        }
        position += length;
        aux += auxSize;
        sampleIndex++;
      }
    }
    if (sampleIndex !== n) throw new Error("视频样本不完整");

    // Preserve the original codec from frma (AVC and HEVC), not a hardcoded tag.
    let at = stbl.body;
    while (at + 8 <= stbl.end) {
      const sinf = find(data, "sinf", at, stbl.end);
      if (!sinf) break;
      const frma = find(data, "frma", sinf.body, sinf.end);
      if (!frma) throw new Error("原始编码格式缺失");
      if (frma.body + 4 > frma.end) throw new Error("原始编码格式无效");
      const original = data.subarray(frma.body, frma.body + 4);
      // `sinf` lives inside the sample entry, so the `encv` type field sits
      // four bytes before it. Scan back for it.
      let entryAt = sinf.start - 1;
      while (entryAt >= stbl.body) {
        const type = ascii(data, entryAt, 4);
        if (type === "encv" || type === "enca") {
          header.set(original, entryAt);
          break;
        }
        entryAt--;
      }
      // Turn the sinf box into a free box and wipe its contents.
      header.set([0x66, 0x72, 0x65, 0x65], sinf.start + 4); // "free"
      header.fill(0, sinf.body, sinf.end);
      at = sinf.end;
    }
  }

  if (samples.length === 0) throw new Error("视频加密索引不可用");
  const sorted = samples.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].end > sorted[i].start) throw new Error("视频样本重叠");
  }
  return { header, samples: sorted };
}

/** Adds `n` to the low 64 bits of a 128-bit big-endian counter. */
function add128(iv: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(iv);
  let carry = n;
  for (let i = 15; i >= 8 && carry > 0; i--) {
    const add = carry % 256;
    const sum = out[i] + add;
    out[i] = sum & 0xff;
    carry = Math.floor(carry / 256) + (sum >= 256 ? 1 : 0);
  }
  return out;
}

/**
 * Decrypts the encrypted samples that fall inside one chunk, in place.
 *
 * `target` holds the file bytes starting at absolute offset `chunkStart`.
 * AES-CTR is a stream cipher, so a chunk that cuts a sample in half is
 * still decryptable: the keystream position is derived from how many
 * encrypted bytes of that sample come before the chunk.
 */
export function decryptChunk(
  target: Uint8Array,
  chunkStart: number,
  samples: Sample[],
  key: Uint8Array
): void {
  const chunkEnd = chunkStart + target.length;
  for (const sample of samples) {
    if (sample.end <= chunkStart) continue;
    if (sample.start >= chunkEnd) break;
    const begin = Math.max(sample.start, chunkStart);
    const stop = Math.min(sample.end, chunkEnd);
    if (begin >= stop) continue;
    // How many encrypted bytes of this sample come before `begin`.
    const relative = sample.encryptedOffset + (begin - sample.start);
    const skip = relative % 16;
    const counter = add128(sample.iv, Math.floor(relative / 16));
    const at = begin - chunkStart;
    const cipher = target.subarray(at, at + (stop - begin));
    const padded = new Uint8Array(skip + cipher.length);
    padded.set(cipher, skip);
    const plain = aesCtr(key, counter, padded);
    target.set(plain.subarray(skip), at);
  }
}

/**
 * Decrypts the encrypted samples in place.
 * `key` is the AES-CTR content key (16 bytes).
 */
export function decryptSamples(
  target: Uint8Array,
  samples: Sample[],
  key: Uint8Array
): void {
  decryptChunk(target, 0, samples, key);
}

/**
 * One-shot helper: rewrites the container and decrypts every sample.
 * Returns a new buffer; the input is left untouched.
 */
export function decryptFile(
  data: Uint8Array,
  key: Uint8Array | null
): Uint8Array {
  const prepared = prepare(data, key);
  if (key) decryptSamples(prepared.header, prepared.samples, key);
  return prepared.header;
}
