import { useEffect, useMemo, useReducer, useRef } from "react";
import {
  ContentProvider,
  HotRankingPage,
  mergeBoardPage,
  mergePage,
  Series,
} from "../domain/model";

type Page = {
  items: Series[];
  page: number;
  more: boolean;
  busy: boolean;
  error: string;
  /** Where each show sits on a hot board, when the page is one. */
  positions: Record<string, { rank: number | null; heat: string }>;
  updatedText: string;
};
const empty = (): Page => ({
  items: [],
  page: 0,
  more: true,
  busy: false,
  error: "",
  positions: {},
  updatedText: "",
});

/** The catalog stays alive across detail/playback; each query owns its pagination. */
export function useCatalog(
  provider: ContentProvider,
  query: string | null,
  enabled: boolean,
  mode: "home" | "search" | "ranking" = "home"
) {
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
  async function load(replace = false) {
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
  return { ...entry, loadMore: () => load(), refresh: () => load(true) };
}
