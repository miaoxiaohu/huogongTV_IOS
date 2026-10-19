/**
 * A local index of every show the site carries, so the search is not capped
 * at the ten rows it renders.
 *
 * The site will not page its search. `/search/<keyword>` server-renders
 * exactly ten rows and ignores seventeen different paging parameters, and
 * the signed App search endpoint answers with a zero-byte body for every
 * parameter shape tried. Ten is therefore the server's ceiling, not a
 * client-side shortcoming.
 *
 * What the site *does* page is the catalogue: 34 pages of 24 rows in each
 * named route, 800 shows per route. The walk collects those and this class
 * searches the result locally.
 *
 * Ported from kotlin-tv/core/src/main/kotlin/com/hongguotv/core/
 * CatalogueIndex.kt.
 */
import { Series } from "../domain/model";

/** The three catalogues the site serves. */
export type CatalogueRoute = "real-drama" | "comic-drama" | "ai-drama";

export const CATALOGUE_ROUTES: CatalogueRoute[] = [
    "real-drama",
    "comic-drama",
    "ai-drama",
];

/** Which shelf a route belongs to. 漫剧 is two routes. */
export function routeShelf(route: CatalogueRoute): "short" | "comic" {
    return route === "real-drama" ? "short" : "comic";
}

/**
 * Whitespace and punctuation carry no meaning when looking for a show by
 * name, and neither does the case.
 */
export function normalizeForSearch(value: string): string {
    if (!value) return "";
    return value
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * Does the title actually mention the keyword?
 *
 * The site's search never says no. Searching a show it does not carry still
 * answers with ten rows, so 「站内没有这部剧」 can only be decided here.
 */
export function mentions(title: string, keyword: string): boolean {
    const needle = normalizeForSearch(keyword);
    return needle.length > 0 && normalizeForSearch(title).includes(needle);
}

/**
 * Levenshtein distance, capped at the budget.
 *
 * Plain two-row dynamic programming. The length-gap early exit survives
 * because it is a property of the inputs rather than of the matrix: the
 * row minimum is not monotone, so bailing out when a row's minimum exceeds
 * the budget would miss real matches.
 *
 * @returns the distance, or `budget + 1` if it is at least that.
 */
export function editDistanceWithinOne(
    a: string,
    b: string,
    budget = 1
): number {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > budget) return budget + 1;
    let previous = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) previous[j] = j;
    for (let i = 1; i <= a.length; i++) {
        const current = new Array(b.length + 1);
        current[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + substitution
            );
        }
        previous = current;
    }
    const distance = previous[b.length];
    return distance > budget ? budget + 1 : distance;
}

/** One show in the index, plus the catalogue it came from. */
type Entry = {
    series: Series;
    title: string;
    tags: string;
    route: CatalogueRoute | null;
};

/** A page of results. */
export const SEARCH_PAGE_SIZE = 30;
/** A page shows 30 rows; this leaves room for a few pages of scroll. */
export const DEFAULT_LIMIT = 200;
/** Below this length a one-character slip is a different word, not a typo. */
export const TYPO_FLOOR = 4;

export class CatalogueIndex {
    /**
     * The shows, in catalogue order, so ties resolve to the site's own
     * ranking. The normalised titles and tags are computed once here: a
     * search sweeps every entry, and re-running two regex replaces over each
     * of them per keystroke would be the slowest part of a keystroke.
     */
    private readonly ordered: Entry[];

    constructor(entries: Series[], routes: (CatalogueRoute | null)[] = []) {
        const rows: Entry[] = [];
        const at = new Map<string, number>();
        entries.forEach((series, position) => {
            const route = routes[position] ?? null;
            const known = at.get(series.id);
            if (known === undefined) {
                at.set(series.id, rows.length);
                rows.push({
                    series,
                    title: normalizeForSearch(series.title),
                    tags: normalizeForSearch(series.tags),
                    route,
                });
            } else if (route !== null) {
                // The same show can come twice: once from an index that has
                // no catalogue label yet, once from the walk that adds it.
                // The labelled one has to win.
                rows[known] = {
                    series: rows[known].series,
                    title: rows[known].title,
                    tags: rows[known].tags,
                    route,
                };
            }
        });
        this.ordered = rows;
    }

    /** How many shows this index holds. */
    get size(): number {
        return this.ordered.length;
    }

    /**
     * True when every show here records the catalogue it came from.
     *
     * Only then can a search be split by shelf. A missing label reads as
     * 「belongs to both」 so an index written before the labels existed still
     * browses.
     */
    get labelled(): boolean {
        return this.ordered.every((entry) => entry.route !== null);
    }

    /** Which catalogue a show was filed under. */
    routeOf(id: string): CatalogueRoute | null {
        const found = this.ordered.find((entry) => entry.series.id === id);
        return found ? found.route : null;
    }

    /** How many shows a shelf holds. */
    sizeOf(shelf: "short" | "comic"): number {
        return this.ordered.filter(
            (entry) => entry.route === null || routeShelf(entry.route) === shelf
        ).length;
    }

    /**
     * Ranked matches for the keyword, best first, capped at the limit.
     *
     * Blank input matches nothing rather than everything: an index that
     * returned the whole library for a stray space would defeat the
     * 「站内没有这部剧」 notice entirely.
     */
    search(
        keyword: string,
        limit = DEFAULT_LIMIT,
        shelf: "short" | "comic" | null = null
    ): Series[] {
        const needle = normalizeForSearch(keyword);
        if (!needle || limit <= 0) return [];
        const pool = this.pool(shelf);
        const ranked: Array<{ series: Series; rank: number; order: number }> = [];
        pool.forEach((entry, order) => {
            const rank = rankEntry(entry, needle);
            if (rank !== null) ranked.push({ series: entry.series, rank, order });
        });
        ranked.sort(
            (a, b) =>
                a.rank - b.rank ||
                a.series.title.length - b.series.title.length ||
                a.order - b.order
        );
        return ranked.slice(0, limit).map((row) => row.series);
    }

    /** How many entries match, ignoring the cap. */
    count(keyword: string): number {
        const needle = normalizeForSearch(keyword);
        if (!needle) return 0;
        return this.ordered.filter((entry) => rankEntry(entry, needle) !== null)
            .length;
    }

    /**
     * The search, then a one-character fallback when nothing matched
     * literally.
     *
     * Typing a long Chinese title on a TV keyboard gets a character wrong
     * often enough to be worth absorbing: 搜「雾锁请迷」 should still find
     * 《雾锁情迷》. The fallback only runs on an empty result, so it can
     * never displace a real match, and only for queries of four characters
     * or more.
     *
     * The boolean says whether the results came from the fallback, so the
     * tab can say so.
     */
    searchAllowingTypo(
        keyword: string,
        limit = DEFAULT_LIMIT,
        shelf: "short" | "comic" | null = null
    ): { rows: Series[]; fuzzy: boolean } {
        const literal = this.search(keyword, limit, shelf);
        if (literal.length > 0) return { rows: literal, fuzzy: false };
        const needle = normalizeForSearch(keyword);
        if (needle.length < TYPO_FLOOR) return { rows: [], fuzzy: false };
        const relaxed: Array<{ distance: number; series: Series }> = [];
        for (const entry of this.pool(shelf)) {
            const distance = editDistanceWithinOne(needle, entry.title);
            if (distance <= 1) relaxed.push({ distance, series: entry.series });
        }
        relaxed.sort(
            (a, b) => a.distance - b.distance || a.series.title.length - b.series.title.length
        );
        const rows = relaxed.slice(0, limit).map((entry) => entry.series);
        return { rows, fuzzy: rows.length > 0 };
    }

    /** The shows of one shelf, in that shelf's own order. */
    browse(offset: number, size: number, shelf: "short" | "comic" | null = null): Series[] {
        if (offset < 0 || size <= 0) return [];
        return this.pool(shelf)
            .slice(offset, offset + size)
            .map((entry) => entry.series);
    }

    private pool(shelf: "short" | "comic" | null): Entry[] {
        if (shelf === null) return this.ordered;
        return this.ordered.filter(
            (entry) => entry.route === null || routeShelf(entry.route) === shelf
        );
    }
}

/**
 * How well a show matches.
 *
 * Tags are a genuine fallback: 「总裁」 is a tag on 《雾锁情迷》 even though
 * its title does not contain the word, and the site's own search ranks such
 * rows first too.
 */
function rankEntry(entry: Entry, needle: string): number | null {
    if (entry.title === needle) return 0;
    if (entry.title.startsWith(needle)) return 1;
    if (entry.title.includes(needle)) return 2;
    if (entry.tags.includes(needle)) return 3;
    return null;
}

/**
 * A decoded index plus the walk state needed to carry on from where it
 * stopped.
 */
export type CatalogueSnapshot = {
    entries: Series[];
    /** Which catalogue each entry came from, parallel to the entries. */
    routes: (CatalogueRoute | null)[];
    /** route -> the last page already folded in. */
    cursor: Record<string, number>;
    /** The routes that reached their final page. */
    done: string[];
    savedAt: number;
};

export function emptySnapshot(): CatalogueSnapshot {
    return { entries: [], routes: [], cursor: {}, done: [], savedAt: 0 };
}

/** What a search answered. */
export type SearchResult = {
    rows: Series[];
    /** Whether there is another page. */
    hasMore: boolean;
    /** How many shows actually mention the keyword. */
    matchedCount: number;
    /** How many the paging will walk in total. */
    totalHits: number;
    /** Whether the results came from the one-character fallback. */
    fuzzy: boolean;
};

/**
 * Puts the local index and the server's ten rows into one page.
 *
 * The server's rows merely top up a page the local index has not filled, so
 * the server is asked on page one only. A local hit has to stay alone: 搜
 * 「雾锁情迷」 finds exactly one show, and topping the page up with the
 * server's fuzzy rows would bury nine unrelated dramas under it. When the
 * index finds nothing at all those rows are the only thing left to show.
 *
 * The shelf filter only narrows the rows the index can place. A row the
 * index has never heard of is left alone: the server carries shows the walk
 * does not reach, and filtering them out would make them unsearchable.
 */
export function mergeSearch(
    keyword: string,
    page: number,
    local: CatalogueIndex | null,
    serverRows: Series[],
    shelf: "short" | "comic"
): SearchResult {
    const localResult = local
        ? local.searchAllowingTypo(keyword, DEFAULT_LIMIT, shelf)
        : { rows: [] as Series[], fuzzy: false };
    const localRows = localResult.rows;

    const scoped =
        local && local.labelled
            ? serverRows.filter((row) => {
                  const route = local.routeOf(row.id);
                  return route ? routeShelf(route) === shelf : true;
              })
            : serverRows;
    const known = new Set(localRows.map((row) => row.id));
    const unseen = scoped.filter((row) => !known.has(row.id));
    const filler =
        localRows.length === 0
            ? unseen
            : unseen.filter((row) => mentions(row.title, keyword));

    let rows: Series[];
    if (localRows.length === 0) {
        rows = page > 1 ? [] : scoped;
    } else {
        const slice = localRows
            .slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE)
            .slice();
        // Only the first page borrows room from the server, so paging never
        // drifts between two different orderings.
        if (page === 1 && slice.length < SEARCH_PAGE_SIZE) {
            slice.push(...filler.slice(0, SEARCH_PAGE_SIZE - slice.length));
        }
        rows = slice;
    }

    const seen = new Set<string>();
    return {
        rows: rows.filter((row) => {
            if (seen.has(row.id)) return false;
            seen.add(row.id);
            return true;
        }),
        hasMore: localRows.length > page * SEARCH_PAGE_SIZE,
        matchedCount:
            localRows.length + filler.filter((row) => mentions(row.title, keyword)).length,
        totalHits: localRows.length + (page === 1 ? filler.length : 0),
        fuzzy: localResult.fuzzy,
    };
}
