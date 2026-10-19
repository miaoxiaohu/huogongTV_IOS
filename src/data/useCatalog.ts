import { useEffect, useMemo, useReducer, useRef } from "react";
import {
  ContentProvider,
  HotRankingPage,
  mergeBoardPage,
  mergePage,
  Series,
} from "../domain/model";
import { CatalogueIndex, mergeSearch, SEARCH_PAGE_SIZE } from "./catalogue";

type Page = {
  items: Series[];
  page: number;
  more: boolean;
  busy: boolean;
  error: string;
  /** Where each show sits on a hot board, when the page is one. */
  positions: Record<string, { rank: number | null; heat: string }>;
  updatedText: string;
  /** How many shows mention the keyword, when the page is a search. */
  matchedCount: number;
  /** How many the paging will walk in total. */
  totalHits: number;
  /** Whether the results came from the one-character fallback. */
  fuzzy: boolean;
};
const empty = (): Page => ({
  items: [],
  page: 0,
  more: true,
  busy: false,
  error: "",
  positions: {},
  updatedText: "",
  matchedCount: 0,
  totalHits: 0,
  fuzzy: false,
});

export type CatalogOptions = {
  mode?: "home" | "search" | "ranking";
  /** The local index, so a search can answer with the whole library. */
  catalogue?: CatalogueIndex | null;
  /** Which shelf a search is narrowed to. */
  shelf?: "short" | "comic";
};

/** The catalog stays alive across detail/playback; each query owns its pagination. */
export function useCatalog(
  provider: ContentProvider,
  query: string | null,
  enabled: boolean,
  options: CatalogOptions = {}
) {
  const mode = options.mode ?? "home";
  const catalogue = options.catalogue ?? null;
  const shelf = options.shelf ?? "short";
  const cache = useMemo(() => new Map<string, Page>(), [provider]);
  const key = mode === "ranking" ? "ranking" : query === null ? "home" : `search:${query}`;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const entry = cache.get(key) ?? empty();
  async function load(replace = false, localOnly = false) {
    const previous = cache.get(key) ?? empty();
    if (previous.busy) return;
    const next = { ...previous, busy: true, error: "" };
    cache.set(key, next);
    redraw();
    try {
      const page = replace ? 1 : previous.page + 1;
      if (mode === "ranking") {
        if (!provider.ranking) throw new Error("这个来源没有热播榜");
        const board: HotRankingPage = await provider.ranking(page);
        const merged = mergeBoardPage(previous, board, replace);
        Object.assign(next, {
          items: merged.items,
          page,
          more: board.items.length > 0 && page < board.totalPages,
          positions: merged.positions,
          updatedText: board.updatedText,
        });
      } else if (mode === "search" && query) {
        // The server only ever answers with ten rows, and only the first
        // page uses them, so asking again for the later pages would spend a
        // request to throw the answer away.
        const serverRows =
          page === 1 && !localOnly ? await provider.search(query, page) : [];
        const merged = mergeSearch(query, page, catalogue, serverRows, shelf);
        Object.assign(next, {
          items: replace ? merged.rows : mergePage(previous.items, merged.rows),
          page,
          more: merged.hasMore,
          matchedCount: merged.matchedCount,
          totalHits: merged.totalHits,
          fuzzy: merged.fuzzy,
        });
      } else {
        const rows =
          query === null
            ? await provider.home(page)
            : await provider.search(query, page);
        Object.assign(next, {
          items: replace ? rows : mergePage(previous.items, rows),
          page,
          more: rows.length > 0,
        });
      }
    } catch (e) {
      next.error = e instanceof Error ? e.message : "内容加载失败";
    } finally {
      next.busy = false;
      if (alive.current) redraw();
    }
  }
  useEffect(() => {
    if (enabled && !cache.has(key) && query !== "") void load();
  }, [cache, key, enabled, query, mode]);
  // The index grows while the walk runs, so a search that was answered
  // early has to be asked again: the local part of the answer changed. Only
  // the local part is asked for - the server's ten rows are the same.
  const indexSize = catalogue?.size ?? 0;
  useEffect(() => {
    if (mode !== "search" || !enabled || !query) return;
    if (!cache.has(key)) return;
    void load(true, true);
  }, [indexSize]);
  return { ...entry, loadMore: () => load(), refresh: () => load(true) };
}
