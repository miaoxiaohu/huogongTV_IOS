#!/usr/bin/env node
/**
 * The local index of the whole library.
 *
 * The search ranking, the one-character fallback and the normalisation are
 * checked against a transliteration of the Kotlin `CatalogueIndex`, and the
 * walk against `CatalogueBuilder`.
 */
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const cache = transpile("catalogue-verify");
stubNativeModules(cache);
const {
    CatalogueIndex,
    CATALOGUE_ROUTES,
    routeShelf,
    normalizeForSearch,
    mentions,
    editDistanceWithinOne,
    mergeSearch,
    SEARCH_PAGE_SIZE,
} = require(path.join(cache, "data/catalogue.js"));
const { buildCatalogue } = require(path.join(cache, "data/catalogueBuilder.js"));

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
function kotlinNormalize(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, "");
}
function kotlinMentions(title, keyword) {
    const needle = kotlinNormalize(keyword);
    return needle.length > 0 && kotlinNormalize(title).includes(needle);
}
function kotlinEditDistance(a, b, budget = 1) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > budget) return budget + 1;
    let previous = [];
    for (let j = 0; j <= b.length; j++) previous[j] = j;
    for (let i = 1; i <= a.length; i++) {
        const current = new Array(b.length + 1);
        current[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + substitution);
        }
        previous = current;
    }
    const distance = previous[b.length];
    return distance > budget ? budget + 1 : distance;
}

const show = (id, title, tags) => ({
    id,
    title,
    cover: "",
    description: "",
    badge: "",
    tags: tags || "",
});

console.log("== the routes ==");
{
    eq(
        CATALOGUE_ROUTES,
        ["real-drama", "comic-drama", "ai-drama"],
        "the three catalogues"
    );
    eq(routeShelf("real-drama"), "short", "the real drama shelf");
    eq(routeShelf("comic-drama"), "comic", "the comic shelf");
    eq(routeShelf("ai-drama"), "comic", "the ai shelf is part of 漫剧");
}

console.log("== the normaliser ==");
{
    eq(normalizeForSearch("雾锁情迷"), "雾锁情迷", "a plain title");
    eq(normalizeForSearch("雾锁情迷！"), "雾锁情迷", "punctuation goes");
    eq(normalizeForSearch("雾 锁 情迷"), "雾锁情迷", "whitespace goes");
    eq(normalizeForSearch("Total Eclipse"), "totaleclipse", "the case goes");
    eq(normalizeForSearch(""), "", "nothing at all");
    eq(mentions("雾锁情迷", "雾锁"), true, "the title mentions the word");
    eq(mentions("雾锁情迷", "情迷"), true, "and in the middle");
    eq(mentions("雾锁情迷", "总裁"), false, "and not when it does not");
    eq(mentions("雾锁情迷", "  "), false, "a blank keyword mentions nothing");
}

console.log("== the same thing against the Kotlin ==");
{
    const values = [
        "雾锁情迷",
        "雾锁情迷！",
        "雾 锁 情迷",
        "Total Eclipse",
        "总裁归来",
        "Fake Title 2",
        "",
    ];
    let mismatches = 0;
    for (const value of values) {
        if (normalizeForSearch(value) !== kotlinNormalize(value)) mismatches++;
        for (const keyword of ["雾锁", "情迷", "总裁", "eclipse", "  "]) {
            if (mentions(value, keyword) !== kotlinMentions(value, keyword)) mismatches++;
        }
    }
    eq(mismatches, 0, "every normalisation agrees with the Kotlin");
}

console.log("== the edit distance ==");
{
    eq(editDistanceWithinOne("总裁回未", "总裁归来"), 2, "two differing characters are two edits");
    eq(editDistanceWithinOne("雾锁请迷", "雾锁情迷"), 1, "one wrong character");
    eq(editDistanceWithinOne("总裁归来", "总裁归来"), 0, "the same word");
    eq(editDistanceWithinOne("总裁", "总裁归来"), 2, "a gap of two is over the budget");
    eq(editDistanceWithinOne("总裁归来", "总裁"), 2, "the same the other way");
    eq(editDistanceWithinOne("总裁回未", "总裁归来", 2), 2, "with a bigger budget the distance shows");
}

console.log("== the same thing against the Kotlin ==");
{
    const pairs = [
        ["总裁回未", "总裁归来"],
        ["雾锁请迷", "雾锁情迷"],
        ["总裁归来", "总裁归来"],
        ["总裁", "总裁归来"],
        ["abc", "abd"],
        ["", "a"],
    ];
    let mismatches = 0;
    for (const [a, b] of pairs) {
        if (editDistanceWithinOne(a, b) !== kotlinEditDistance(a, b)) {
            mismatches++;
            console.error("    " + a + " vs " + b);
        }
    }
    eq(mismatches, 0, "every distance agrees with the Kotlin");
}

console.log("== searching the index ==");
{
    const entries = [
        show("1", "谁让这个文盲修仙的", "玄幻"),
        show("2", "谁让这个文盲修仙的第三季", "玄幻"),
        show("3", "雾锁情迷", "总裁 都市"),
        show("4", "回到心跳开始时", "都市"),
    ];
    const index = new CatalogueIndex(entries);
    eq(index.size, 4, "the index holds every show");
    eq(
        index.search("谁让这个文盲修仙的").map((s) => s.id),
        ["1", "2"],
        "the exact one comes first, then the one that contains it"
    );
    eq(
        index.search("雾锁情迷").map((s) => s.id),
        ["3"],
        "an exact title is found"
    );
    eq(
        index.search("总裁").map((s) => s.id),
        ["3"],
        "a tag is a genuine fallback"
    );
    eq(index.search("").length, 0, "a blank keyword matches nothing");
    eq(index.search("  ").length, 0, "a blank keyword matches nothing either");
    eq(index.count("都市"), 2, "the count ignores the cap");
    eq(index.search("都不存在").length, 0, "a keyword that is not there");
}

console.log("== the one-character fallback ==");
{
    // These are the Kotlin's own cases, one by one.
    const index = new CatalogueIndex([show("3", "雾锁情迷", "总裁")]);
    const typo = index.searchAllowingTypo("雾锁请迷");
    eq(
        typo.rows.map((s) => s.id),
        ["3"],
        "a mistyped character still finds the show"
    );
    eq(typo.fuzzy, true, "and the result says it was relaxed");

    // A dropped or an extra character is the same kind of slip.
    const dropped = new CatalogueIndex([
        show("1", "分手四年，傅机长失了控", ""),
    ]).searchAllowingTypo("分手四年傅机长失控");
    eq(
        dropped.rows.map((s) => s.id),
        ["1"],
        "a swallowed character still finds the show"
    );
    const doubled = new CatalogueIndex([
        show("1", "分手四年，傅机长失了控", ""),
    ]).searchAllowingTypo("分手四年傅机长失了了控");
    eq(
        doubled.rows.map((s) => s.id),
        ["1"],
        "an extra character still finds the show"
    );

    // A literal hit is never displaced.
    const both = new CatalogueIndex([
        show("1", "雾锁情迷", ""),
        show("2", "雾锁请迷真番", ""),
    ]).searchAllowingTypo("雾锁情迷");
    eq(
        both.rows.map((s) => s.id),
        ["1"],
        "a literal hit is never displaced by the fallback"
    );
    eq(both.fuzzy, false, "and it is not relaxed");

    // Two characters get no fallback at all: a slip there is a different word.
    const short = new CatalogueIndex([
        show("1", "总裁归来", ""),
        show("2", "总裁回来", ""),
    ]).searchAllowingTypo("总载");
    eq(short.rows.length, 0, "short queries get no typo fallback");
    eq(short.fuzzy, false, "and they are not relaxed");
    // Four characters and more do get one.
    const four = new CatalogueIndex([show("1", "总裁归来", "")]).searchAllowingTypo(
        "总裁回来"
    );
    eq(
        four.rows.map((s) => s.id),
        ["1"],
        "four characters and more do get the fallback"
    );
    eq(four.fuzzy, true, "and it says so");

    // Two differing characters are two edits, not one.
    const twoEdits = new CatalogueIndex([
        show("1", "总裁归来", ""),
    ]).searchAllowingTypo("总裁回未");
    eq(twoEdits.rows.length, 0, "two differing characters stay two edits apart");
    eq(twoEdits.fuzzy, false, "and they are not relaxed");

    // A season suffix is three edits away, not one.
    const season = new CatalogueIndex([
        show("1", "谁让这个文盲修仙的", ""),
    ]).searchAllowingTypo("谁让这个文盲修仙的第五季");
    eq(season.rows.length, 0, "a season suffix is not a typo");
    eq(season.fuzzy, false, "and it is not relaxed");
}

console.log("== the shelf filter ==");
{
    const entries = [
        show("1", "真人剧一", "都市"),
        show("2", "漫剧一", "玄幻"),
        show("3", "漫剧二", "玄幻"),
    ];
    const routes = ["real-drama", "comic-drama", "ai-drama"];
    const index = new CatalogueIndex(entries, routes);
    eq(index.labelled, true, "every show records its catalogue");
    eq(
        index.search("漫", 10, "comic").map((s) => s.id),
        ["2", "3"],
        "the comic shelf only answers with comic shows"
    );
    eq(
        index.search("漫", 10, "short").map((s) => s.id),
        [],
        "the real drama shelf does not answer with comic shows"
    );
    eq(index.sizeOf("comic"), 2, "the shelf holds two shows");
    eq(index.sizeOf("short"), 1, "the other shelf holds one");
    eq(index.routeOf("2"), "comic-drama", "the catalogue a show was filed under");
    // An index that was written before the labels existed still browses.
    const old = new CatalogueIndex(entries);
    eq(old.labelled, false, "an index with no labels says so");
    eq(old.search("漫", 10, "comic").length, 2, "and it answers with everything it holds");
}

console.log("== the same show twice ==");
{
    const index = new CatalogueIndex(
        [show("1", "剧", "甲"), show("1", "剧", "甲")],
        [null, "comic-drama"]
    );
    eq(index.size, 1, "the show is only in the index once");
    eq(index.routeOf("1"), "comic-drama", "and the labelled copy wins");
}

console.log("== the page of results ==");
{
    const entries = [];
    for (let i = 1; i <= 70; i++) entries.push(show(String(i), "剧" + i, ""));
    const index = new CatalogueIndex(entries);
    const page1 = mergeSearch("剧", 1, index, [], "short");
    eq(page1.rows.length, SEARCH_PAGE_SIZE, "a page holds thirty rows");
    eq(page1.hasMore, true, "there is more");
    const page3 = mergeSearch("剧", 3, index, [], "short");
    eq(page3.rows.length, 10, "the last page holds the rest");
    eq(page3.hasMore, false, "and there is no more");
}

console.log("== the server's ten rows top the page up ==");
{
    const index = new CatalogueIndex([show("1", "雾锁情迷", "都市")]);
    const server = [show("9", "雾锁情迷", "都市"), show("8", "别的剧", "都市")];
    const merged = mergeSearch("雾锁情迷", 1, index, server, "short");
    eq(
        merged.rows.map((s) => s.id),
        ["1", "9"],
        "the local hit comes first and the server's rows that mention the word fill the rest"
    );
    eq(merged.matchedCount, 2, "both mention the keyword");
    eq(merged.totalHits, 2, "and the total counts them");

    // A local hit has to stay alone: the server's fuzzy rows would bury it.
    const unrelated = [show("8", "完全无关的剧", "别的")];
    const alone = mergeSearch("雾锁情迷", 1, index, unrelated, "short");
    eq(
        alone.rows.map((s) => s.id),
        ["1"],
        "an unrelated server row does not join the page"
    );
    eq(alone.matchedCount, 1, "and it does not count as a match");
}

console.log("== with no index the server's rows are all there is ==");
{
    const server = [show("8", "别的剧", "都市")];
    const merged = mergeSearch("雾锁情迷", 1, null, server, "short");
    eq(
        merged.rows.map((s) => s.id),
        ["8"],
        "the server's rows are shown whole"
    );
    eq(merged.hasMore, false, "and there is no more");
}

console.log("== the shows are merged by id ==");
{
    const { CatalogueEntries } = require(path.join(cache, "data/catalogue.js"));
    const entries = new CatalogueEntries();
    entries.add([show("1", "剧一", ""), show("2", "剧二", "")], "real-drama");
    entries.add([show("2", "剧二", ""), show("3", "剧三", "")], "real-drama");
    eq(entries.size, 3, "the show that came twice is only counted once");
    eq(
        entries.entries.map((s) => s.id),
        ["1", "2", "3"],
        "and the order of the first sighting is kept"
    );
    eq(entries.routes.length, 3, "every show has a route");

    // A re-walk has to replace, not double: that is the whole point.
    const again = new CatalogueEntries(entries.entries, entries.routes);
    again.add(entries.entries, "real-drama");
    eq(again.size, 3, "a re-walk does not double the library");

    // A show that was not labelled before gets its label from the second pass.
    const old = new CatalogueEntries([show("1", "剧", "")], [null]);
    old.add([show("1", "剧", "")], "comic-drama");
    eq(old.routes[0], "comic-drama", "the labelled copy wins");
    eq(old.size, 1, "and the show is still only one");
}

console.log("== the walk ==");
{
    const pages = {
        "real-drama": 2,
        "comic-drama": 1,
        "ai-drama": 1,
    };
    const fetched = [];
    const build = async () => {
        const result = await buildCatalogue(
            async (route, page) => {
                fetched.push(route + "#" + page);
                const totalPages = pages[route];
                const rows = [];
                for (let i = 0; i < 2; i++) {
                    rows.push(show(route + "-" + page + "-" + i, "剧", ""));
                }
                return { rows, totalPages };
            },
            { attempts: 1, retryPauseMillis: 0 }
        );
        return result;
    };
    build().then((result) => {
        eq(result.shows.length, 8, "the walk collected every page");
        eq(result.done.length, 3, "every catalogue reached its end");
        eq(result.gaps.length, 0, "no page was missed");
        eq(result.cursor["real-drama"], 2, "the cursor is at the last page");
        eq(result.routes.length, result.shows.length, "every show records its catalogue");
        eq(
            result.routes[0],
            "real-drama",
            "and the first one came from the first catalogue"
        );
        ok("fetched " + fetched.length + " pages");
    });
}

// The walk has to survive a page that fails, and it has to be resumable.
setTimeout(() => {
    (async () => {
        console.log("== the walk survives a page that fails ==");
        let attempts = 0;
        const result = await buildCatalogue(
            async (route, page) => {
                if (route === "real-drama" && page === 2) {
                    attempts++;
                    throw new Error("timeout");
                }
                return { rows: [show(route + page, "剧", "")], totalPages: 3 };
            },
            { attempts: 2, retryPauseMillis: 1 }
        );
        eq(attempts, 2, "the page was tried twice");
        eq(result.gaps.length, 1, "the page that failed is recorded");
        eq(result.gaps[0], "real-drama#2", "and it is named");
        // The bad page is stepped over, not the rest of the catalogue: the
        // walk has to keep going, or the shows behind it are lost.
        eq(
            result.shows.length,
            8,
            "the pages behind the bad one are still collected"
        );
        eq(result.cursor["real-drama"], 3, "the cursor stepped over the bad page");
        eq(result.done.length, 3, "every catalogue still finished");

        console.log("== the checkpoint records the route that finished ==");
        {
            const steps = [];
            await buildCatalogue(
                async (route, page) => ({
                    rows: [show(route + page, "剧", "")],
                    totalPages: 2,
                }),
                {
                    resume: { "real-drama": 0 },
                    done: ["comic-drama", "ai-drama"],
                    attempts: 1,
                    retryPauseMillis: 0,
                    onPage: (step) => steps.push({ route: step.route, done: step.done }),
                }
            );
            const last = steps[steps.length - 1];
            last.done.includes("real-drama")
                ? ok("the finished route is in the checkpoint of its last page")
                : fail("the finished route is missing: " + JSON.stringify(last.done));
        }

        console.log("== a dead network gives up instead of hammering ==");
        {
            let requests = 0;
            const result = await buildCatalogue(
                async () => {
                    requests++;
                    throw new Error("offline");
                },
                { attempts: 1, retryPauseMillis: 0 }
            );
            requests <= 3
                ? ok("the walk gave up after " + requests + " requests")
                : fail("the walk made " + requests + " requests");
            eq(result.shows.length, 0, "and it collected nothing");
        }

        console.log("== the walk carries on where it stopped ==");
        const fetched = [];
        const resumed = await buildCatalogue(
            async (route, page) => {
                fetched.push(route + "#" + page);
                return { rows: [show(route + page, "剧", "")], totalPages: 3 };
            },
            {
                resume: { "real-drama": 2, "comic-drama": 1 },
                done: ["ai-drama"],
                attempts: 1,
                retryPauseMillis: 0,
            }
        );
        eq(
            fetched.filter((f) => f.startsWith("real-drama")),
            ["real-drama#3"],
            "the finished page is not asked for again"
        );
        eq(
            fetched.filter((f) => f.startsWith("ai-drama")),
            [],
            "a catalogue that was done is not asked for again"
        );
        eq(resumed.done.length, 3, "every catalogue is done at the end");

        console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
        process.exit(failures ? 1 : 0);
    })().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}, 50);
