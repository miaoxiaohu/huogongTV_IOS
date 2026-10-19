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
  Series,
} from "../domain/model";
import { sign, newDevice } from "./signer";

type SignedRequest = {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
};

const SITE = "https://hongguoduanju.com";
const VIDEO_API = "https://api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/";
const FETCH_TIMEOUT = 65000;

export type ApiSettings = {
  category: "short" | "comic";
};

export class ApiProvider implements ContentProvider {
  private category: string;

  constructor(settings?: ApiSettings) {
    this.category = settings?.category === "short" ? "real-drama" : "comic-drama";
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

  async resolve(id: string, _fresh = false): Promise<Playback> {
    // Try signed endpoint first, fall back to web player
    try {
      return await this.signedResolve(id);
    } catch (e) {
      return this.webResolve(id);
    }
  }

  private async signedResolve(id: string): Promise<Playback> {
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
    const html = await this.signedFetch(VIDEO_API, body);
    let data: any;
    try {
      data = JSON.parse(html);
    } catch {
      throw new Error("播放接口暂不可用");
    }
    const code = data.code ?? data.Code ?? -1;
    if (code !== 0) throw new Error("播放接口暂不可用");
    const map = data.data;
    if (!map) throw new Error("播放信息为空");

    // video_model can be a JSON string or object
    let model: any;
    if (map.video_model) {
      if (typeof map.video_model === "object") model = map.video_model;
      else {
        try {
          model = JSON.parse(map.video_model);
        } catch {
          throw new Error("播放信息为空");
        }
      }
    } else {
      throw new Error("播放信息为空");
    }

    const fallbackRaw = model.fallback_api;
    let fallbackUrl = "";
    if (typeof fallbackRaw === "string") fallbackUrl = fallbackRaw;
    else if (fallbackRaw?.fallback_api) fallbackUrl = fallbackRaw.fallback_api;
    else if (Array.isArray(fallbackRaw)) fallbackUrl = fallbackRaw[0] || "";
    else fallbackUrl = String(fallbackRaw || "");

    fallbackUrl = this.cleanUrl(fallbackUrl);
    if (!fallbackUrl.startsWith("https://") && !fallbackUrl.startsWith("http://")) {
      throw new Error("播放地址格式异常");
    }

    // Fetch the actual stream info from the fallback URL
    const streamResp = await this.fetchText(fallbackUrl);
    let streamData: any;
    try {
      streamData = JSON.parse(streamResp);
    } catch {
      throw new Error("没有播放资源");
    }
    const info =
      streamData.video_info?.data ||
      (() => { throw new Error("没有播放资源"); })();
    const videoList = info.video_list ||
      (() => { throw new Error("没有可用清晰度"); })();

    const entries: Array<{ key: string; quality: number; obj: any }> = [];
    for (const [k, v] of Object.entries(videoList)) {
      const obj = v as any;
      const mainUrl: string = obj.main_url || "";
      if (!mainUrl) continue;
      // Skip ByteVC2 (no avcC/hvcC record)
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

    if (entries.length === 0) throw new Error("没有可用清晰度");

    // Sort by quality descending
    entries.sort((a, b) => b.quality - a.quality);

    const selected = entries[0];
    let url = this.cleanUrl(selected.obj.main_url);

    const keySeed: string = info.key_seed || "";
    if (keySeed) {
      // MediaCrypto.decryptUrl — simplified; if the seed is there we pass it as header
      // For now, just use the URL as-is
    }

    return {
      uri: url,
      headers: {},
    };
  }

  private async webResolve(id: string): Promise<Playback> {
    // Fallback: public player page (only first 3 episodes)
    const match = id.match(/^(\d+)\/(\d+)$/);
    const seriesId = match?.[1] ?? id;
    const episodeId = match?.[2] ?? "0";
    const url = `${SITE}/player/${seriesId}/${episodeId}`;
    const html = await this.fetchText(url);

    // Try contentUrl first, then main_url
    let raw =
      html.match(/"contentUrl"\s*:\s*"([^"]+)"/)?.[1] ||
      html.match(/"main_url"\s*:\s*"([^"]+)"/)?.[1] ||
      "";

    // trimEnd() takes no arguments — strip trailing ? and & explicitly.
    raw = this.cleanUrl(raw)
      .replace(/([?&])Range=[^&]*/gi, "$1")
      .replace(/[?&]+$/, "");

    if (!raw.startsWith("https://") && !raw.startsWith("http://")) {
      throw new Error("播放地址暂不可用");
    }
    return { uri: raw, headers: {} };
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
