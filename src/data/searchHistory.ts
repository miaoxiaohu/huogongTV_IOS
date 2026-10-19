/**
 * The searches the user made.
 *
 * The TV app keeps the last twenty of them, with the content type they were
 * made in: the same word can mean different things in the two shelves, so
 * 「都市」 searched in 漫剧 is not the same search as 「都市」 searched in
 * 真人剧.
 *
 * Ported from kotlin-tv/core/.../ViewingTools.kt (SearchHistory).
 */
export type RecentSearch = {
  query: string;
  type: "short" | "comic";
};

/** How many searches are kept. */
export const SEARCH_HISTORY_LIMIT = 20;
/** The longest query that is worth remembering. */
export const SEARCH_QUERY_LIMIT = 80;

/**
 * Remembers a search.
 *
 * The newest one goes first, and an identical search - the same word in the
 * same shelf - is not kept twice. A blank query or a very long one is not
 * remembered at all.
 */
export function rememberSearch(
  existing: RecentSearch[],
  query: string,
  type: "short" | "comic"
): RecentSearch[] {
  const clean = (query || "").trim();
  if (!clean || clean.length > SEARCH_QUERY_LIMIT) return existing;
  const entry: RecentSearch = { query: clean, type };
  return [entry, ...existing.filter((row) => !(row.query === entry.query && row.type === entry.type))].slice(
    0,
    SEARCH_HISTORY_LIMIT
  );
}

/**
 * Reads the searches back.
 *
 * A history that cannot be read is not a corrupt file: the search still
 * works, it just does not remember what was typed.
 */
export function readSearches(value: any): RecentSearch[] {
  if (!Array.isArray(value)) return [];
  const rows: RecentSearch[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const query = String(raw.query || "").trim();
    if (!query || query.length > SEARCH_QUERY_LIMIT) continue;
    if (raw.type !== "short" && raw.type !== "comic") continue;
    const entry: RecentSearch = { query, type: raw.type };
    if (rows.some((row) => row.query === entry.query && row.type === entry.type)) {
      continue;
    }
    rows.push(entry);
  }
  return rows.slice(0, SEARCH_HISTORY_LIMIT);
}
