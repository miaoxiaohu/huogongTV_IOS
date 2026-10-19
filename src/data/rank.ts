/**
 * The site's hot boards.
 *
 * Ported from kotlin-tv/core/src/main/kotlin/com/hongguotv/core/HotRank.kt.
 *
 * The site serves one board per route - `/rank/hot-real-drama`,
 * `/rank/hot-comic-drama`, `/rank/hot-ai-drama` - and one overall board,
 * `/rank/hot-drama`, which is the same hot list with the routes interleaved.
 * A show's heat belongs to the show and not to the board it is printed on,
 * which is what makes a shelf's board possible: 漫剧 is two routes on the
 * site and there is no board holding both, but their heat values are
 * comparable, so the two boards can be put into the one list the user
 * expects - the hottest 漫剧 shows first.
 *
 * The boards carry their data as deferred JSON, the site's own loader calls
 * in a `data-fn-args` attribute. Only the serialized data is read; the
 * site's scripts are never executed.
 */
import { RankPosition, Series } from "../domain/model";
import { cleanUrl, extractRouter, unescapeHtml } from "./html";

/** One board, as the site serves it. */
export type RankBoard = {
  items: Series[];
  positions: Record<string, RankPosition>;
  totalPages: number;
  updatedText: string;
};

/** The boards of one shelf, put into one hot list. */
export type HotRanking = {
  items: Series[];
  positions: Record<string, RankPosition>;
  totalPages: number;
  updatedText: string;
};

/** The router key the site files a route's board under. */
export function routeKey(rankPath: string): string {
  return `rank_${rankPath}/page`;
}

/** The board a route's hot list is served at. */
export function rankPath(categorySlug: string): string {
  return `hot-${categorySlug}`;
}

/**
 * "8370万热度" is 83700000.
 *
 * The site's number is occasionally broken by a stray control character
 * inside it - measured on the real board: 「5997 万热度」 - so the text is
 * stripped down to the digits and the unit before it is read. A heat that
 * is not there at all reads as null, and the caller decides what to do with
 * a row it cannot place.
 */
export function heatValue(heat?: string | null): number | null {
  if (!heat) return null;
  const text = heat.replace(/[^0-9.万亿]/g, "");
  const match = /([0-9]+(?:\.[0-9]+)?)([万亿]?)/.exec(text);
  if (!match) return null;
  const number = Number(match[1]);
  if (!isFinite(number)) return null;
  const scale = match[2] === "万" ? 10000 : match[2] === "亿" ? 100000000 : 1;
  return Math.trunc(number * scale);
}

/**
 * The deferred loader call that carries a board's data.
 *
 * The site writes it as a `data-fn-args` attribute, HTML escaped, on a
 * script tag. Two shapes are used: `r` with the payload as the third
 * argument, and `mergeLoaderData` with it inside a list of router calls.
 */
export function deferredPayload(html: string, key: string): any | null {
  const tags = html.match(/<script\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = /data-fn-name="([^"]*)"/.exec(tag)?.[1];
    const rawArgs = /data-fn-args="([^"]*)"/.exec(tag)?.[1];
    if (!name || !rawArgs) continue;
    if (name !== "r" && name !== "mergeLoaderData") continue;
    let args: any;
    try {
      args = JSON.parse(unescapeHtml(rawArgs));
    } catch (e) {
      continue;
    }
    if (!Array.isArray(args) || args[0] !== key) continue;
    let raw: any = null;
    if (name === "r" && args[1] === "content") {
      raw = args[2];
    } else if (name === "mergeLoaderData") {
      const entries = Array.isArray(args[1]) ? args[1] : [];
      const content = entries.find(
        (entry: any) => entry && entry.key === "content" && entry.routerDataFnName === "p"
      );
      raw = content?.routerDataFnArgs?.[0];
    }
    if (!raw) continue;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        continue;
      }
    }
    if (raw && typeof raw === "object") return raw;
  }
  return null;
}

/** One row of a board, as the site sends it. */
function rowToSeries(row: any, positions: Record<string, RankPosition>): Series | null {
  const id = String(row.seriesId || row.id || "");
  if (!id) return null;
  const count =
    typeof row.episodeCount === "number"
      ? row.episodeCount
      : Array.isArray(row.episodeVids)
      ? row.episodeVids.length
      : 0;
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const heat = String(row.heatText || "");
  if (!positions[id]) {
    const rank = typeof row.rank === "number" && row.rank > 0 ? row.rank : null;
    positions[id] = { rank, heat };
  }
  return {
    id,
    title: String(row.title || ""),
    cover: cleanUrl(String(row.cover || "")),
    description: String(row.description || ""),
    badge: count > 0 ? `全 ${count} 集` : heat,
    tags: tags
      .slice(0, 5)
      .map((tag: any) => (typeof tag === "string" ? tag : tag?.name || ""))
      .join(" · "),
  };
}

/** The text of a chunk of html, with the tags and the entities taken out. */
function textOf(html: string): string {
  return unescapeHtml(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads a board out of the rendered cards.
 *
 * Some responses carry the cards but not the deferred JSON - measured on the
 * real board: 5 of 12 requests. The cards hold the same data, so they are
 * read when the loader call is not there.
 */
export function parseRenderedBoard(
  html: string,
  page: number,
  updatedText: string,
  label: string
): RankBoard {
  const positions: Record<string, RankPosition> = {};
  const items: Series[] = [];
  const seen = new Set<string>();
  for (const card of html.split(/<article\b/).slice(1)) {
    const id = /aria-labelledby="rank-title-(\d{1,30})"/.exec(card)?.[1];
    if (!id || seen.has(id)) continue;
    const title = textOf(
      new RegExp(`id="rank-title-${id}"[^>]*>([\\s\\S]*?)</`).exec(card)?.[1] || ""
    );
    if (!title) continue;
    const rankText = (/class="[^"]*badge-number-[^"]*"[^>]*>([^<]*)</.exec(card)?.[1] || "").trim();
    const rank = Number(rankText);
    const heat = textOf(
      /class="[^"]*metrics-[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(card)?.[1] || ""
    );
    const description = textOf(
      /class="[^"]*description-[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(card)?.[1] || ""
    );
    let cover = "";
    for (const tag of card.match(/<img\b[^>]*>/g) || []) {
      if (!/class="[^"]*cover-[^"]*"/.test(tag)) continue;
      cover = /src="([^"]*)"/.exec(tag)?.[1] || "";
      break;
    }
    const categories =
      /class="[^"]*categories-[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(card)?.[1] || "";
    const tags = [...categories.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
      .map((match) => textOf(match[1]))
      .filter(Boolean)
      .slice(0, 5);
    positions[id] = {
      rank: Number.isInteger(rank) && rank > 0 ? rank : null,
      heat,
    };
    seen.add(id);
    items.push({
      id,
      title,
      cover: cleanUrl(cover),
      description,
      badge: heat,
      tags: tags.join(" · "),
    });
  }
  if (items.length === 0) throw new Error(`页面没有${label}榜数据`);

  const nav = /<nav[^>]*aria-label="榜单分页"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
  if (!nav) throw new Error(`${label}榜分页信息缺失`);
  const current = Number(
    textOf(/aria-current="page"[^>]*>([^<]*)</.exec(nav)?.[1] || "")
  );
  if (current !== page) throw new Error(`${label}榜分页信息异常`);
  const pages = [...nav.matchAll(/href="[^"]*\?page=(\d+)/g)].map((match) =>
    Number(match[1])
  );
  const lastPage = pages.length ? Math.max(page, ...pages) : page;
  return { items, positions, totalPages: Math.min(lastPage, 100), updatedText };
}

/** Reads one board out of a board page. */
export function parseBoard(
  html: string,
  page: number,
  key: string,
  label: string
): RankBoard {
  const data = extractRouter(html);
  const routeData = data.loaderData?.[key];
  if (!routeData) throw new Error(`页面没有${label}榜数据`);
  const updatedText = String(routeData.updatedText || "");

  const payload = deferredPayload(html, key);
  if (payload) {
    if (!payload.isSuccess) throw new Error(`${label}榜暂不可用`);
    const rows = payload.rankList;
    if (!Array.isArray(rows)) throw new Error(`${label}榜格式已变化`);
    const pagination = payload.pagination;
    if (!pagination) throw new Error(`${label}榜分页信息缺失`);
    const totalPages = pagination.totalPages || 0;
    if (totalPages < 1 || (pagination.pageNum || page) !== page) {
      throw new Error(`${label}榜分页信息异常`);
    }

    const positions: Record<string, RankPosition> = {};
    const items: Series[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const series = rowToSeries(row, positions);
      if (!series) continue;
      if (!/^[0-9]{1,30}$/.test(series.id) || !series.title.trim()) continue;
      if (seen.has(series.id)) continue;
      seen.add(series.id);
      items.push(series);
    }
    return { items, positions, totalPages: Math.min(totalPages, 100), updatedText };
  }
  // The cards are there even when the loader call is not.
  return parseRenderedBoard(html, page, updatedText, label);
}

/**
 * Puts the boards of one shelf into one hot list.
 *
 * The site's own ranks are per route - the comic board counts from 1 among
 * comic shows, the AI board from 1 among AI shows - so two boards on one
 * page would show two 「第 1 名」. The merged list is renumbered instead, and
 * it continues across pages the way the site's own boards do (measured: page
 * 2 of a board starts at 21, not at 1).
 *
 * The order is the heat, descending, because the heat is comparable across
 * boards. A heat that cannot be read is put last rather than guessed at:
 * one row out of place is a small thing, and inventing a number for it
 * would be a lie in the place the user reads a ranking.
 */
export function mergeBoards(page: number, boards: RankBoard[]): HotRanking {
  const rows: Array<{ heat: string; series: Series }> = [];
  for (const board of boards) {
    for (const series of board.items) {
      rows.push({ heat: board.positions[series.id]?.heat || "", series });
    }
  }
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = heatValue(a.row.heat);
      const right = heatValue(b.row.heat);
      if (left === null && right === null) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      if (left !== right) return right - left;
      return a.index - b.index;
    })
    .map((entry) => entry.row);

  const siteFirst = boards
    .map((board) =>
      Object.values(board.positions)
        .map((position) => position.rank)
        .filter((rank): rank is number => rank !== null && rank !== undefined)
        .sort((a, b) => a - b)[0]
    )
    .filter((rank): rank is number => rank !== undefined)
    .sort((a, b) => a - b)[0];
  const base =
    siteFirst !== undefined
      ? (siteFirst - 1) * boards.length
      : (page - 1) * ordered.length;

  const positions: Record<string, RankPosition> = {};
  const items: Series[] = [];
  ordered.forEach((entry, index) => {
    positions[entry.series.id] = { rank: base + index + 1, heat: entry.heat };
    items.push(entry.series);
  });

  const totalPages = boards.reduce(
    (smallest, board) => Math.min(smallest, board.totalPages),
    Number.MAX_SAFE_INTEGER
  );
  const updated = boards.find((board) => board.updatedText.trim())?.updatedText || "";
  return {
    items,
    positions,
    totalPages: totalPages === Number.MAX_SAFE_INTEGER ? 1 : totalPages,
    updatedText: updated,
  };
}
