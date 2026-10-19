/**
 * Walks the site's paged catalogues so the local search index can hold
 * every show it carries.
 *
 * The catalogue is the one thing the site still pages properly: 34 pages of
 * 24 rows in each named route, 800 shows per route, measured with zero
 * duplicates and zero overlap between them.
 *
 * The requests are serial on purpose - concurrency only buys speed and
 * costs rate-limit exposure, and the endpoint that answers this app is
 * already sensitive about how often it is called.
 *
 * The cursor is what makes this finishable on a slow phone. A walk that is
 * interrupted - by the user leaving the app, by the phone running out of
 * memory, by one page timing out - must be resumable rather than restarted.
 *
 * Ported from kotlin-tv/core/src/main/kotlin/com/hongguotv/core/
 * CatalogueBuilder.kt.
 */
import { Series } from "../domain/model";
import { CATALOGUE_ROUTES, CatalogueRoute } from "./catalogue";

/** How many tries a page gets, including the first. */
export const PAGE_ATTEMPTS = 3;
/** The pause between two tries of the same page. */
export const RETRY_PAUSE_MILLIS = 1200;
/**
 * How many pages may fail in a row before the pass gives up.
 *
 * Without it a phone with no network would ask for 102 pages three times
 * over, against an endpoint that is already sensitive about how often it is
 * called.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** What one page landing during a walk carries. */
export type WalkStep = {
    /** The shows this page added that the walk had not already seen. */
    fresh: Series[];
    route: CatalogueRoute;
    total: number;
    cursor: Record<string, number>;
    done: string[];
    /** The pages that survived their retries. */
    gaps: string[];
};

/** Fetches one catalogue page. */
export type PageFetcher = (
    route: CatalogueRoute,
    page: number
) => Promise<{ rows: Series[]; totalPages: number }>;

export type BuildOptions = {
    /** The last page already folded in per route. */
    resume?: Record<string, number>;
    /** The routes that already reached their end. */
    done?: string[];
    /** Polled before every request, so a closing app stops the walk at once. */
    isCancelled?: () => boolean;
    /** Receives each page as it lands. */
    onPage?: (step: WalkStep) => void;
    attempts?: number;
    retryPauseMillis?: number;
};

/**
 * Walks the catalogues.
 *
 * @returns the shows this pass added, plus where the next one should pick up.
 */
export async function buildCatalogue(
    fetchPage: PageFetcher,
    options: BuildOptions = {}
): Promise<{
    shows: Series[];
    routes: CatalogueRoute[];
    cursor: Record<string, number>;
    done: string[];
    gaps: string[];
}> {
    const resume = options.resume || {};
    const done = new Set(options.done || []);
    const isCancelled = options.isCancelled || (() => false);
    const attempts = options.attempts ?? PAGE_ATTEMPTS;
    const pause = options.retryPauseMillis ?? RETRY_PAUSE_MILLIS;

    const shows: Series[] = [];
    const routes: CatalogueRoute[] = [];
    const cursor: Record<string, number> = { ...resume };
    const gaps: string[] = [];
    const seen = new Set<string>();

    for (const route of CATALOGUE_ROUTES) {
        if (done.has(route)) continue;
        let page = (resume[route] || 0) + 1;
        let totalPages = 0;
        let consecutiveFailures = 0;
        for (;;) {
            if (isCancelled()) {
                return { shows, routes, cursor, done: [...done], gaps };
            }
            let answer: { rows: Series[]; totalPages: number } | null = null;
            for (let attempt = 1; attempt <= attempts; attempt++) {
                try {
                    answer = await fetchPage(route, page);
                    break;
                } catch (error) {
                    if (attempt >= attempts) {
                        // A hole is recorded rather than hidden: a library
                        // that silently hides shows is worse than one that
                        // admits a page was missed.
                        gaps.push(`${route}#${page}`);
                        answer = null;
                        break;
                    }
                    await new Promise((resolve) => setTimeout(resolve, pause * attempt));
                }
            }
            if (!answer) {
                // The page is skipped, not the rest of the catalogue. The
                // cursor steps over it, so the next pass does not die on the
                // same page again.
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    return { shows, routes, cursor, done: [...done], gaps };
                }
                cursor[route] = page;
                page++;
                continue;
            }
            consecutiveFailures = 0;
            totalPages = answer.totalPages;
            const fresh: Series[] = [];
            for (const row of answer.rows) {
                if (seen.has(row.id)) continue;
                seen.add(row.id);
                fresh.push(row);
                shows.push(row);
                routes.push(route);
            }
            cursor[route] = page;
            if (page >= totalPages) {
                // The route is finished, and the checkpoint has to say so
                // before the route's last page is written - otherwise the
                // next pass asks for a page past the end of it.
                done.add(route);
            }
            options.onPage?.({
                fresh,
                route,
                total: shows.length,
                cursor: { ...cursor },
                done: [...done],
                gaps: [...gaps],
            });
            if (page >= totalPages) break;
            page++;
        }
    }
    return { shows, routes, cursor, done: [...done], gaps };
}
