/**
 * Turns a signed stream into a file AVPlayer can actually play.
 *
 * The signed player hands out CENC encrypted MP4s. iOS has no way to decrypt
 * those on its own, and `AVURLAsset` cannot read `data:` or `blob:` URIs, so
 * the only workable route is a real file on disk:
 *
 *   1. download the encrypted MP4 natively (no bridge traffic for the body),
 *   2. read the header, rewrite `encv` -> `hvc1` and `sinf` -> `free`,
 *   3. decrypt the samples with AES-CTR while streaming the rest through,
 *   4. hand the finished file to the player as a `file://` uri.
 *
 * The work is chunked on purpose: a 1080p episode is 13 MB, and holding the
 * body plus its base64 form plus the decrypted copy in memory at once is how
 * a phone runs out of it.
 */
import { Dirs, FileSystem } from "react-native-file-access";
import { base64Decode, base64Encode } from "./base64";
import { decryptChunk, headerEnd, prepare } from "./cenc";
import { EMPTY_CONTENT } from "./errors";

/** How many bytes travel through the bridge per read/write round trip. */
const CHUNK_BYTES = 512 * 1024;

/** Anything smaller than this is not a playable video. */
const MIN_PLAYABLE = 1024;

export type MediaProgress = { percent: number; message: string };

export type MediaRequest = {
  /** The decrypted CDN url. */
  url: string;
  /** The AES-CTR content key, or null when the content is not encrypted. */
  key: Uint8Array | null;
  headers: Record<string, string>;
  episodeId: string;
  quality: string;
  /** Ignore a cached copy and fetch the episode again. */
  fresh?: boolean;
  onProgress?: (progress: MediaProgress) => void;
};

async function readBytes(
  path: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  const text = await FileSystem.readFileChunk(path, offset, length, "base64");
  return base64Decode(text);
}

function safeTag(value: string): string {
  return value.replace(/[^0-9a-zA-Z_-]/g, "");
}

/**
 * Downloads, decrypts and stores the episode.
 * Returns the absolute path of the playable file.
 */
export async function prepareLocalMedia(request: MediaRequest): Promise<string> {
  const report = request.onProgress;
  const dir = `${Dirs.CacheDir}/hongguotv`;
  await FileSystem.mkdir(dir);
  const tag = safeTag(`${request.episodeId}-${request.quality}`);
  const rawPath = `${dir}/raw-${tag}.mp4`;
  const outPath = `${dir}/play-${tag}.mp4`;
  const partPath = `${outPath}.part`;

  // A previous visit may already have prepared this episode. A fresh run
  // skips the cache: a cached file that failed to play has to be replaced,
  // not handed back again.
  if (!request.fresh && (await FileSystem.exists(outPath))) {
    const stat = await FileSystem.stat(outPath);
    if (stat.size > MIN_PLAYABLE) {
      report?.({ percent: 100, message: "已缓存，正在打开" });
      return outPath;
    }
  }
  if (await FileSystem.exists(outPath)) await FileSystem.unlink(outPath);
  if (await FileSystem.exists(partPath)) await FileSystem.unlink(partPath);

  report?.({ percent: 0, message: "正在下载视频" });
  try {
    const result = await FileSystem.fetch(
      request.url,
      { method: "GET", headers: request.headers, path: rawPath },
      (bytesRead, contentLength) => {
        const percent =
          contentLength > 0
            ? Math.min(99, Math.round((bytesRead / contentLength) * 100))
            : 0;
        report?.({ percent, message: `正在下载视频 ${percent}%` });
      }
    );
    if (!result.ok) throw new Error(`视频下载失败（HTTP ${result.status}）`);

    const total = (await FileSystem.stat(rawPath)).size;
    if (total < MIN_PLAYABLE) throw new Error(EMPTY_CONTENT);

    // Clear content needs no rewriting at all - copy it straight over.
    if (!request.key) {
      report?.({ percent: 95, message: "正在准备视频" });
      await FileSystem.cp(rawPath, partPath);
      await FileSystem.mv(partPath, outPath);
      report?.({ percent: 100, message: "准备完成" });
      return outPath;
    }

    // The sample table lives in the `moov` box right after `ftyp`, so the
    // first chunk is enough to build it. That same chunk also holds the first
    // part of the media data, so it has to be decrypted as well.
    let headerLength = Math.min(total, CHUNK_BYTES);
    let head = await readBytes(rawPath, 0, headerLength);
    const moovEnd = headerEnd(head, total);
    if (moovEnd > head.length) {
      headerLength = moovEnd;
      head = await readBytes(rawPath, 0, headerLength);
    }
    const prepared = prepare(head, request.key);
    decryptChunk(prepared.header, 0, prepared.samples, request.key);

    await FileSystem.writeFile(partPath, base64Encode(prepared.header), "base64");

    let offset = headerLength;
    while (offset < total) {
      const length = Math.min(CHUNK_BYTES, total - offset);
      const bytes = await readBytes(rawPath, offset, length);
      decryptChunk(bytes, offset, prepared.samples, request.key);
      await FileSystem.appendFile(partPath, base64Encode(bytes), "base64");
      offset += length;
      const percent = Math.min(99, Math.round((offset / total) * 100));
      report?.({ percent, message: `正在解密 ${percent}%` });
    }

    // Only now is the file complete, so it is published under its real name.
    await FileSystem.mv(partPath, outPath);
    report?.({ percent: 100, message: "准备完成" });
    return outPath;
  } catch (error) {
    // A half written file must not be mistaken for a finished one later.
    if (await FileSystem.exists(partPath)) await FileSystem.unlink(partPath);
    throw error;
  } finally {
    // The encrypted original is worth nothing once the file is written, and
    // it is the bigger of the two.
    if (await FileSystem.exists(rawPath)) await FileSystem.unlink(rawPath);
  }
}
