/**
 * Direct API provider — calls hongguoduanju.com without an intermediate server.
 *
 * Endpoints (all via HTML router / signed player):
 *   Home     : GET  https://hongguoduanju.com/category/{slug}?page=N
 *   Search   : GET  https://hongguoduanju.com/search/{kw}?page=1
 *   Detail   : GET  https://hongguoduanju.com/detail?series_id={id}
 *   Stream   : POST https://api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/
 *              (signed request, per-request device identity)
 */

import {
  ContentProvider,
  Detail,
  Episode,
  Playback,
  PlaybackProgress,
  Series,
} from "../domain/model";
import { sign, newDevice } from "./signer";
import { decodeBase64Url, decryptUrl, deriveKey } from "./mediaCrypto";
import { prepareLocalMedia } from "./media";
import {
    BAD_PLAYBACK_ADDRESS,
    NO_PLAYBACK_RESOURCE,
    NO_PUBLIC_SOURCE,
    NO_USABLE_QUALITY,
    PLAYBACK_INFO_EMPTY,
    PLAYER_UNAVAILABLE,
} from "./errors";

type SignedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
};

const SITE = "https://hongguoduanju.com";
const VIDEO_API = "https://api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/";
const FETCH_TIMEOUT = 65000;

/**
 * The CDN rejects requests that do not look like the app's own player.
 * VendorConstants.VIDEO_UA in the Kotlin.
 */
const VIDEO_HEADERS: Record<string, string> = {
  "User-Agent":
    "com.phoenix.read/71332 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)",
  Referer: "https://novel.snssdk.com/",
  "Accept-Encoding": "identity",
};

export type ApiSettings = {
  category: "short" | "comic";
  /** Highest resolution to use. 1080 is the best the source offers. */
  maxQuality?: number;
};

/** A downloadable, still encrypted stream. */
export type SignedStream = {
  url: string;
  key: Uint8Array | null;
  headers: Record<string, string>;
  quality: string;
};

export class ApiProvider implements ContentProvider {
  private category: string;
  private maxQuality: number;

  constructor(settings?: ApiSettings) {
    this.category = settings?.category === "short" ? "real-drama" : "comic-drama";
    this.maxQuality = settings?.maxQuality ?? 540;
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

  private async fetchText(url: string, signed?: SignedRequest): Promise<string> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT);
    try {
      const headers: Record<string, string> = signed?.headers ?? {
        "User-Agent":
          "com.phoenix.read/71332 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)",
        "Accept-Language": "zh-CN,zh;q=0.9",
      };
      const opts: RequestInit = { headers, signal: abort.signal };
      if (signed?.body) {
        opts.method = "POST";
        opts.body = signed.body;
      }
      const resp = await fetch(url, opts);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private async signedFetch(
    url: string,
    body: Uint8Array | null
  ): Promise<string> {
    const device = newDevice();
    const signed = sign(VIDEO_API, device, body);
    return this.fetchText(signed.url, signed);
  }

  /**
   * Fetches a JSON document, retrying the answers that are clearly broken.
   *
   * The signed player answers HTTP 200 with a zero-byte body every so often.
   * The Kotlin app documents the same behaviour and drops straight down to the
   * public player, which only hosts the first three episodes of a series - so
   * one empty answer costs the user the whole episode.
   *
   * The signed request signs itself with a fresh device identity every time,
   * and a shared identity is exactly what the server blocks silently, so each
   * attempt is a genuinely new request. A body that is empty or that is not
   * JSON at all is a broken answer and is worth another try; an HTTP error
   * status is a real answer from the server and is not retried.
   */
  private async fetchJson(
    makeRequest: () => Promise<string>,
    attempts = 3
  ): Promise<any> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
      try {
        const text = await makeRequest();
        if (!text || text.trim().length === 0) {
          lastError = new Error("播放接口返回空内容");
          continue;
        }
        return JSON.parse(text);
      } catch (error) {
        const failure = error as Error;
        const status = /^HTTP (\d+)/.exec(failure.message);
        if (status) {
          const code = parseInt(status[1], 10);
          // A 4xx is the server's real answer and is not worth another try;
          // a 5xx is the server having a bad moment, so it is.
          if (code < 500) throw failure;
        }
        lastError = failure;
      }
    }
    throw lastError ?? new Error("播放接口暂不可用");
  }

  // -------------------------------------------------------------------------
  // Router data extraction
  // -------------------------------------------------------------------------

  private extractRouter(html: string): any {
    const marker = html.indexOf("_ROUTER_DATA");
    if (marker < 0) throw new Error("页面没有内容数据");
    const first = html.indexOf("{", marker);
    if (first < 0) throw new Error("页面数据格式错误");
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = first; i < html.length; i++) {
      const ch = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      switch (ch) {
        case '"':
          quoted = true;
          break;
        case "{":
        case "[":
          depth++;
          break;
        case "}":
        case "]":
          depth--;
          if (depth === 0) return JSON.parse(html.substring(first, i + 1));
      }
    }
    throw new Error("页面数据不完整");
  }

  private cleanUrl(s: string): string {
    return s.replace(/\\\//g, "/").replace(/\\u002F/g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
  }

  // -------------------------------------------------------------------------
  // Data parsing helpers
  // -------------------------------------------------------------------------

  private card(item: any): Series {
    const o = item.video_data || item;
    let episodeCount = 0;
    const episodeInfo = o.series_episode_info;
    if (o.episode_cnt) episodeCount = o.episode_cnt;
    else if (episodeInfo?.episode_cnt) episodeCount = episodeInfo.episode_cnt;

    const tags: string[] = [];
    const rawTags = o.tags || o.category_list || [];
    for (let i = 0; i < Math.min(rawTags.length, 5); i++) {
      const t = rawTags[i];
      tags.push(typeof t === "string" ? t : t.name || "");
    }

    const title = o.series_name || o.series_title || item.name || "";
    const badge = o.episode_right_text || (episodeCount > 0 ? `全 ${episodeCount} 集` : "");

    return {
      id: o.series_id || "",
      title: this.cleanUrl(title),
      cover: this.cleanUrl(o.series_cover || ""),
      description: o.series_intro || "",
      badge,
      tags: tags.join(" · "),
    };
  }

  private valid(rows: Series[]): Series[] {
    return rows.filter(
      (r) => r.id && /^[0-9]+$/.test(r.id) && r.title.trim().length > 0
    );
  }

  private str(o: any, key: string): string {
    return o[key] == null || o[key] === "" ? "" : String(o[key]);
  }

  // -------------------------------------------------------------------------
  // ContentProvider implementation
  // -------------------------------------------------------------------------

  async home(page: number): Promise<Series[]> {
    const url = `${SITE}/category/${this.category}${page > 1 ? `?page=${page}` : ""}`;
    const html = await this.fetchText(url);
    const data = this.extractRouter(html);
    const section =
      data.loaderData?.category_page ||
      data.loaderData?.category_$ ||
      (() => { throw new Error("首页数据结构已变化"); })();
    const rows = section?.recommendList ||
      section?.categoryData?.recommendList ||
      (() => { throw new Error("首页数据暂不可用"); })();
    const items = this.valid((rows || []).map((item: any) => this.card(item)));
    return items;
  }

  async search(query: string, page: number): Promise<Series[]> {
    // The site's search always returns 10 results and ignores page numbers.
    // We call the public page but also check the local index for real matches.
    const encoded = encodeURIComponent(query);
    const url = `${SITE}/search/${encoded}?page=1`;
    const html = await this.fetchText(url);
    const data = this.extractRouter(html);
    const section =
      data.loaderData?.["search_(keyword)/page"] ||
      data.loaderData?.search_page ||
      (() => { throw new Error("搜索数据暂不可用"); })();
    const rows = section?.searchList || (() => { throw new Error("搜索数据结构已变化"); })();
    return this.valid((rows || []).map((item: any) => this.card(item)));
  }

  async detail(id: string): Promise<Detail> {
    const url = `${SITE}/detail?series_id=${id}`;
    const html = await this.fetchText(url);
    const data = this.extractRouter(html);
    const o =
      data.loaderData?.detail_page?.seriesDetail ||
      (() => { throw new Error("剧集详情暂不可用"); })();
    const raw: string[] = o.vid_list || (() => { throw new Error("分集暂不可用"); })();
    if (raw.length === 0 || !raw.every((v: any) => /^[0-9]+$/.test(String(v)))) {
      throw new Error("分集数据异常");
    }
    const episodes: Episode[] = raw.map((v: string, i: number) => ({
      id: String(v),
      number: i + 1,
      title: `第 ${i + 1} 集`,
    }));
    return {
      ...this.card(o),
      id,
      episodes,
    };
  }

  async resolve(
    id: string,
    fresh = false,
    onProgress?: (progress: PlaybackProgress) => void
  ): Promise<Playback> {
    // The signed player covers every episode. The public plain MP4 is the
    // fallback: it needs no decryption but only exists for the first three
    // episodes of a series.
    try {
      const stream = await this.resolveStream(id);
      const path = await prepareLocalMedia({
        url: stream.url,
        key: stream.key,
        headers: stream.headers,
        episodeId: id,
        quality: stream.quality,
        fresh,
        onProgress,
      });
      return { uri: `file://${path}`, headers: {}, quality: stream.quality };
    } catch (signed) {
      try {
        return await this.publicResolve(id);
      } catch (publicError) {
        throw signed;
      }
    }
  }

  /**
   * Resolves an episode to a downloadable, encrypted stream.
   * Kept separate from `resolve` so it can be exercised without a file
   * system - the Node side verification uses this.
   */
  async resolveStream(id: string): Promise<SignedStream> {
    const device = newDevice();
    const payload = JSON.stringify({
      biz_param: {
        detail_page_version: 0,
        device_level: 3,
        disable_digg_stat: false,
        need_all_video_definition: true,
        need_mp4_align: false,
        use_os_player: false,
        use_server_dns: false,
        video_platform: 1024,
      },
      video_id: id,
    });
    const body = new TextEncoder().encode(payload);
    let data: any;
    try {
      data = await this.fetchJson(() => this.signedFetch(VIDEO_API, body));
    } catch {
      // The retry already tried three times with three different identities.
      // The reason is not worth showing raw, the user only needs to know
      // that it did not work.
      throw new Error(PLAYER_UNAVAILABLE);
    }
    const code = data.code ?? data.Code ?? -1;
    if (code !== 0) throw new Error(PLAYER_UNAVAILABLE);
    const map = data.data;
    if (!map) throw new Error(PLAYBACK_INFO_EMPTY);

    // video_model can be a JSON string or object
    let model: any;
    if (map.video_model) {
      if (typeof map.video_model === "object") model = map.video_model;
      else {
        try {
          model = JSON.parse(map.video_model);
        } catch {
          throw new Error(PLAYBACK_INFO_EMPTY);
        }
      }
    } else {
      throw new Error(PLAYBACK_INFO_EMPTY);
    }

    const fallbackRaw = model.fallback_api;
    let fallbackUrl = "";
    if (typeof fallbackRaw === "string") fallbackUrl = fallbackRaw;
    else if (fallbackRaw?.fallback_api) fallbackUrl = fallbackRaw.fallback_api;
    else if (Array.isArray(fallbackRaw)) fallbackUrl = fallbackRaw[0] || "";
    else fallbackUrl = String(fallbackRaw || "");

    fallbackUrl = this.cleanUrl(fallbackUrl);
    if (!fallbackUrl.startsWith("https://") && !fallbackUrl.startsWith("http://")) {
      throw new Error(BAD_PLAYBACK_ADDRESS);
    }

    // Fetch the actual stream info from the fallback URL
    let streamData: any;
    try {
      streamData = await this.fetchJson(() => this.fetchText(fallbackUrl));
    } catch {
      throw new Error(NO_PLAYBACK_RESOURCE);
    }
    const info =
      streamData.video_info?.data ||
      (() => { throw new Error(NO_PLAYBACK_RESOURCE); })();
    const videoList = info.video_list ||
      (() => { throw new Error(NO_USABLE_QUALITY); })();

    const entries: Array<{ key: string; quality: number; obj: any }> = [];
    for (const [k, v] of Object.entries(videoList)) {
      const obj = v as any;
      const mainUrl: string = obj.main_url || "";
      if (!mainUrl) continue;
      // ByteVC2 renditions ship no avcC/hvcC record at all, so neither
      // Android nor iOS finds a video track in them. Only ByteVC1 plays.
      const codec = (obj.codec_type || "").toLowerCase();
      if (codec === "bytevc2" || codec === "bvc2") continue;

      const defStr: string =
        obj.definition ||
        obj.quality_desc ||
        obj.height ||
        obj.vheight ||
        obj.quality ||
        k;
      const quality = this.qualityNumber(defStr);
      entries.push({ key: k, quality, obj });
    }

    if (entries.length === 0) throw new Error(NO_USABLE_QUALITY);

    // Sort by quality descending, then take the best one that fits the
    // quality limit.
    entries.sort((a, b) => b.quality - a.quality);
    const selected =
      entries.find((entry) => entry.quality <= this.maxQuality) ??
      entries[entries.length - 1];

    let url = this.cleanUrl(selected.obj.main_url);

    // MediaCrypto.decryptUrl - the real CDN url is encrypted with a key
    // derived from the response's key_seed.
    const keySeed: string = info.key_seed || "";
    if (keySeed) {
      url = decryptUrl(url, decodeBase64Url(keySeed));
    }
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      throw new Error(BAD_PLAYBACK_ADDRESS);
    }

    // MediaCrypto.deriveKey - the AES-CTR key for the sample payloads.
    const spade: string = selected.obj.spade_a || "";
    const key = spade ? deriveKey(spade) : null;

    return {
      url,
      key,
      headers: VIDEO_HEADERS,
      quality: selected.quality > 0 ? `${selected.quality}P` : "auto",
    };
  }

  /**
   * The public player hosts a plain, unencrypted MP4 - but only for the
   * first three episodes of a series, so it has to be probed.
   */
  private async publicResolve(id: string): Promise<Playback> {
    const url = `${SITE}/video/public/${id}/360p.mp4`;
    // A blip on the probe costs the whole episode, because the signed error is
    // the one that surfaces when the fallback is gone too. A status answer is
    // final; a broken connection is not.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 20000);
      try {
        // A ranged GET, not a HEAD: some servers answer HEAD with 405.
        const response = await fetch(url, {
          headers: {
            "User-Agent": VIDEO_HEADERS["User-Agent"],
            Range: "bytes=0-0",
          },
          signal: abort.signal,
        });
        if (!response.ok) throw new Error("not found");
        return { uri: url, headers: {}, quality: "360P" };
      } catch (error) {
        if (error instanceof Error && error.message === "not found") {
          throw new Error(NO_PUBLIC_SOURCE);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(NO_PUBLIC_SOURCE);
  }

  private qualityNumber(value: string): number {
    const m = value.match(/2160|1440|1080|720|576|540|480|360/);
    if (m) return parseInt(m[0]);
    const map: Record<string, number> = {
      "1920": 1080,
      "1280": 720,
      "1024": 576,
      "854": 480,
      "640": 360,
    };
    return map[value] ?? (isNaN(parseInt(value)) ? 0 : parseInt(value));
  }
}
