/**
 * Finding the other seasons of the same show.
 *
 * Ported from kotlin-tv/core/src/main/kotlin/com/hongguotv/core/
 * ContentRepository.kt (seasonNumber, seriesBaseTitle, seasons).
 *
 * No server-side endpoint exposes the relationship between two seasons:
 * every `/novel/series/` path answers 404, the public detail page carries no
 * series field, and the reference APK has no `season` string at all. Each
 * season is simply its own `series_id` whose title carries a season marker.
 *
 * So the relationship is recovered the only way the remaining data allows:
 * search the base title and keep whatever normalises onto the same base.
 * That is deliberately conservative - 「变废为宝…」 and 「捡废为宝…」 are
 * different shows that both have a 第二季, and fuzzy matching would wrongly
 * merge them, so the titles have to be identical after the marker is removed.
 */
import { SeasonEntry, Series } from "../domain/model";

/** "第七季", "（第二季）", "第 3 季" - with an optional bracket around it. */
const SEASON_MARK_ONE =
    /[（(【[]?\s*第\s*([0-9一二三四五六七八九十百零两]+)\s*季\s*[）)】\]]?/;
const SEASON_MARK_ALL =
    /[（(【[]?\s*第\s*([0-9一二三四五六七八九十百零两]+)\s*季\s*[）)】\]]?/g;

/** A pair of brackets left empty once the season marker is gone. */
const EMPTY_BRACKETS = /[（(【[]\s*[）)】\]]/g;

const CN_DIGITS: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
};

/**
 * The season number in a title, or null when the title carries no marker.
 *
 * "第七季" is 7 and "（第二季）" is 2. The Chinese numerals only ever come
 * in the 「十二」「二十」「一百零二」 shape, so the plain 十/百 carry rules
 * are enough.
 */
export function seasonNumber(title: string): number | null {
    if (!title) return null;
    const match = SEASON_MARK_ONE.exec(title);
    if (!match) return null;
    const raw = match[1];

    // A plain number, the way the Kotlin's toIntOrNull reads it.
    if (/^[+-]?\d+$/.test(raw)) {
        const value = Number(raw);
        if (!Number.isSafeInteger(value)) return null;
        return value > 0 ? value : null;
    }

    let total = 0;
    let digit = -1; // the number gathered so far, before a carry character
    let seen = false;
    for (const ch of raw) {
        if (ch === "百") {
            const head = digit >= 0 ? digit : 1; // 「百」 with no number is 一百
            total += head * 100;
            digit = -1;
            seen = true;
        } else if (ch === "十") {
            const head = digit >= 0 ? digit : 1; // 「十」 with no number is 十几
            total += head * 10;
            digit = -1;
            seen = true;
        } else {
            const value = CN_DIGITS[ch];
            if (value === undefined) return null;
            // 「零」 in 「一百零二」 is only a placeholder, it does not take a
            // digit position. Any other digit that shows up twice is not a
            // number.
            if (value === 0) {
                seen = true;
                continue;
            }
            if (digit >= 0) return null; // 「一二三」 is not a number
            digit = value;
            seen = true;
        }
    }
    if (!seen) return null;
    const value = total + (digit >= 0 ? digit : 0);
    return value > 0 ? value : null;
}

/** Strips the season marker so all the seasons of one show collapse onto
 * the same base title. */
export function seriesBaseTitle(title: string): string {
    if (!title) return "";
    return title
        .replace(SEASON_MARK_ALL, "")
        .replace(EMPTY_BRACKETS, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * The seasons among the search results that belong to the same show.
 *
 * The rows are searched by the base title, so a row only counts when its own
 * base title is exactly the same. A title without a marker is the first
 * season.
 */
export function pickSeasons(base: string, rows: Series[]): SeasonEntry[] {
    const found: SeasonEntry[] = [];
    for (const row of rows) {
        if (seriesBaseTitle(row.title) !== base) continue;
        const number = seasonNumber(row.title);
        found.push({ series: row, season: number === null ? 1 : number });
    }
    const seen = new Set<string>();
    const unique: SeasonEntry[] = [];
    for (const entry of found) {
        if (seen.has(entry.series.id)) continue;
        seen.add(entry.series.id);
        unique.push(entry);
    }
    return unique.sort((a, b) => a.season - b.season);
}
