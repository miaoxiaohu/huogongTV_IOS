#!/usr/bin/env node
/**
 * Finding the other seasons of the same show.
 *
 * The season number is read out of a title, and the base title is what makes
 * two seasons of one show collapse onto each other. Both are checked against
 * a line by line transliteration of the Kotlin `seasonNumber` and
 * `seriesBaseTitle`, and the picking is checked against the Kotlin `seasons`.
 */
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const cache = transpile("seasons-verify");
stubNativeModules(cache);
const { seasonNumber, seriesBaseTitle, pickSeasons } = require(
    path.join(cache, "data/seasons.js")
);

let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};
const eq = (got, want, m) =>
    JSON.stringify(got) === JSON.stringify(want)
        ? ok(m + " (" + JSON.stringify(got) + ")")
        : fail(m + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

// ---------------------------------------------------------------------------
// The Kotlin, transliterated
// ---------------------------------------------------------------------------
const SEASON_MARK = /[（(【[]?\s*第\s*([0-9一二三四五六七八九十百零两]+)\s*季\s*[）)】\]]?/;
const EMPTY_BRACKETS = /[（(【[]\s*[）)】\]]/g;
const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function kotlinSeasonNumber(title) {
    const match = SEASON_MARK.exec(title);
    if (!match) return null;
    const raw = match[1];
    if (/^[+-]?\d+$/.test(raw)) {
        const value = Number(raw);
        if (!Number.isSafeInteger(value)) return null; // toIntOrNull
        return value > 0 ? value : null;
    }
    let total = 0;
    let digit = -1;
    let seen = false;
    for (const ch of raw) {
        if (ch === "百") {
            const head = digit >= 0 ? digit : 1;
            total += head * 100;
            digit = -1;
            seen = true;
        } else if (ch === "十") {
            const head = digit >= 0 ? digit : 1;
            total += head * 10;
            digit = -1;
            seen = true;
        } else if (ch in CN_DIGITS) {
            const d = CN_DIGITS[ch];
            if (d === 0) {
                seen = true;
                continue;
            }
            if (digit >= 0) return null;
            digit = d;
            seen = true;
        } else {
            return null;
        }
    }
    if (!seen) return null;
    const n = total + (digit >= 0 ? digit : 0);
    return n > 0 ? n : null;
}

function kotlinBaseTitle(title) {
    return title
        .replace(new RegExp(SEASON_MARK.source, "g"), "")
        .replace(EMPTY_BRACKETS, "")
        .replace(/\s+/g, " ")
        .trim();
}

console.log("== the season number in a title ==");
{
    eq(seasonNumber("第七季"), 7, "第七季");
    eq(seasonNumber("（第二季）"), 2, "（第二季）");
    eq(seasonNumber("第 3 季"), 3, "第 3 季");
    eq(seasonNumber("第二季"), 2, "第二季");
    eq(seasonNumber("第12季"), 12, "第12季");
    eq(seasonNumber("第三季全集"), 3, "the marker does not have to be the whole title");
    eq(seasonNumber("某某剧"), null, "a title without a marker");
    eq(seasonNumber(""), null, "an empty title");
    eq(seasonNumber("第0季"), null, "the zeroth season does not exist");
    eq(seasonNumber("第十季"), 10, "第十季");
    eq(seasonNumber("第十二季"), 12, "第十二季");
    eq(seasonNumber("第二十季"), 20, "第二十季");
    eq(seasonNumber("第一百零二季"), 102, "第一百零二季");
    eq(seasonNumber("第二百季"), 200, "第二百季");
    eq(seasonNumber("一百零二季"), null, "the marker needs the 第 in front of it");
    eq(seasonNumber("一二三季"), null, "一二三 is not a number");
    eq(seasonNumber("第季"), null, "a marker with no number in it");
}

console.log("== the same thing against the Kotlin ==");
{
    const titles = [
        "第七季",
        "（第二季）",
        "第 3 季",
        "第二季",
        "第12季",
        "第三季全集",
        "某某剧",
        "",
        "第0季",
        "第十季",
        "第十二季",
        "第二十季",
        "一百零二季",
        "两百季",
        "一二三季",
        "第季",
        "第〇季",
        "剧名（第 2 季）",
        "剧名（第二季）",
        "剧名【第三季】",
        "剧名[第四季]",
        "剧名 第五季 完结",
        "第一季",
        "第九季",
        "第十一季",
        "第零季",
        "零零季",
        "第十百季",
        "第百季",
        "二十季",
        "一零季",
    ];
    let mismatches = 0;
    for (const title of titles) {
        const got = seasonNumber(title);
        const want = kotlinSeasonNumber(title);
        if (got !== want) {
            mismatches++;
            console.error("    " + JSON.stringify(title) + ": got " + got + ", want " + want);
        }
    }
    eq(mismatches, 0, "all " + titles.length + " titles agree with the Kotlin");
}

console.log("== the base title of a show ==");
{
    eq(seriesBaseTitle("第七季"), "", "a title that is only a marker leaves nothing");
    eq(seriesBaseTitle("剧名（第二季）"), "剧名", "the marker and its brackets go");
    eq(seriesBaseTitle("剧名【第三季】"), "剧名", "square brackets go too");
    eq(seriesBaseTitle("剧名 第五季 完结"), "剧名完结", "the marker and the spaces around it go");
    eq(seriesBaseTitle("剧名"), "剧名", "a title without a marker stays");
    eq(seriesBaseTitle("  剧名  "), "剧名", "the spaces are collapsed");
}

console.log("== the same thing against the Kotlin ==");
{
    const titles = [
        "第七季",
        "（第二季）",
        "剧名（第二季）",
        "剧名【第三季】",
        "剧名[第四季]",
        "剧名 第五季 完结",
        "剧名",
        "  剧名  ",
        "剧名（第二季）（第三季）",
        "第 一 季",
    ];
    let mismatches = 0;
    for (const title of titles) {
        const got = seriesBaseTitle(title);
        const want = kotlinBaseTitle(title);
        if (got !== want) {
            mismatches++;
            console.error("    " + JSON.stringify(title) + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
        }
    }
    eq(mismatches, 0, "all " + titles.length + " titles agree with the Kotlin");
}

console.log("== picking the seasons out of the search results ==");
{
    const show = (id, title, badge) => ({ id, title, cover: "", description: "", badge: badge || "", tags: "" });
    const rows = [
        show("1", "王妈在顾家当保姆后全家只会搞笑了", "全86集"),
        show("2", "王妈在顾家当保姆后全家只会搞笑了（第二季）", "全60集"),
        show("3", "王妈在顾家当保姆后全家只会搞笑了（第三季）", "全50集"),
    ];
    const base = seriesBaseTitle(rows[0].title);
    const picked = pickSeasons(base, rows);
    eq(
        picked.map((e) => [e.series.id, e.season]),
        [
            ["1", 1],
            ["2", 2],
            ["3", 3],
        ],
        "the seasons come back in order"
    );
    eq(
        pickSeasons(base, [rows[1], rows[0]]).map((e) => e.series.id),
        ["1", "2"],
        "they are sorted by the season, not by the order they came in"
    );
    eq(
        pickSeasons(base, [rows[0], rows[0]]).map((e) => e.series.id),
        ["1"],
        "the same show twice is only one season"
    );
    eq(
        pickSeasons(base, [show("9", "完全不同的剧（第二季）")]).length,
        0,
        "a show with a different base title is not a season of this one"
    );
    eq(
        pickSeasons(base, [show("9", "捡废为宝（第二季）")]).length,
        0,
        "a title that only looks similar is not a season of this one"
    );
    eq(pickSeasons(base, []).length, 0, "no rows means no seasons");
    eq(
        pickSeasons(base, [show("4", rows[0].title)]).map((e) => e.season),
        [1],
        "a title without a marker is the first season"
    );
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
