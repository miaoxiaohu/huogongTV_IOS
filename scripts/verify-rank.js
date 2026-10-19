#!/usr/bin/env node
/**
 * The hot board.
 *
 * The board is read out of the site's own deferred loader call, and the
 * shelves' boards are merged into one list. The heat reading and the merge
 * are checked against a transliteration of the Kotlin `HotRank`, and the
 * parsing is checked against a board page that was captured from the real
 * site.
 */
const fs = require("fs");
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const cache = transpile("rank-verify");
stubNativeModules(cache);
const {
    heatValue,
    mergeBoards,
    parseBoard,
    deferredPayload,
    rankPath,
    routeKey,
} = require(path.join(cache, "data/rank.js"));
const { extractRouter, unescapeHtml } = require(path.join(cache, "data/html.js"));

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
function kotlinHeatValue(heat) {
    if (!heat) return null;
    const text = heat.replace(/[^0-9.万亿]/g, "");
    const match = /([0-9]+(?:\.[0-9]+)?)([万亿]?)/.exec(text);
    if (!match) return null;
    const number = Number(match[1]);
    if (!isFinite(number)) return null;
    const scale = match[2] === "万" ? 10000 : match[2] === "亿" ? 100000000 : 1;
    return Math.trunc(number * scale);
}

console.log("== the heat of a show ==");
{
    eq(heatValue("8370万热度"), 83700000, "8370万热度");
    eq(heatValue("1.5亿热度"), 150000000, "1.5亿热度");
    eq(heatValue("5997 万热度"), 59970000, "a stray space in the number");
    eq(heatValue("100热度"), 100, "a plain number");
    eq(heatValue(""), null, "no heat at all");
    eq(heatValue(null), null, "a missing heat");
    eq(heatValue("热度暂无"), null, "heat that cannot be read");
    eq(heatValue("万热度"), null, "a unit without a number");
}

console.log("== the same thing against the Kotlin ==");
{
    const heats = [
        "8370万热度",
        "1.5亿热度",
        "5997 万热度",
        "100热度",
        "",
        null,
        "热度暂无",
        "万热度",
        "72.4万收藏",
        "203.8万点赞",
        "0热度",
        "12.34万热度",
    ];
    let mismatches = 0;
    for (const heat of heats) {
        const got = heatValue(heat);
        const want = kotlinHeatValue(heat);
        if (got !== want) {
            mismatches++;
            console.error("    " + JSON.stringify(heat) + ": got " + got + ", want " + want);
        }
    }
    eq(mismatches, 0, "all " + heats.length + " heats agree with the Kotlin");
}

console.log("== the route keys ==");
{
    eq(rankPath("real-drama"), "hot-real-drama", "the real drama board");
    eq(rankPath("comic-drama"), "hot-comic-drama", "the comic board");
    eq(rankPath("ai-drama"), "hot-ai-drama", "the ai board");
    eq(routeKey("hot-real-drama"), "rank_hot-real-drama/page", "the router key");
}

console.log("== reading a board out of a page ==");
{
    // A page in the shape the site serves it: the router payload, and the
    // deferred loader call that carries the rows.
    const rows = [
        {
            id: "7696437705822981182",
            seriesId: "7696437705822981182",
            rank: 1,
            title: "聚宝仙盆之杂灵根才是真BOSS第十四季",
            cover: "https:\\/\\/p6-novel.byteimg.com\\/a~tplv-shrink:640:0.image",
            description: "杂灵根弟子贺平生",
            heatText: "8370万热度",
            tags: ["玄幻", "逆袭", "修真"],
            episodeVids: ["1", "2", "3"],
        },
        {
            id: "7696437705822981183",
            seriesId: "",
            rank: 2,
            title: "第二部剧",
            cover: "",
            description: "",
            heatText: "100热度",
            tags: [],
            episodeCount: 12,
        },
        { id: "not a number", seriesId: "", rank: 3, title: "坏数据", heatText: "" },
    ];
    const payload = { isSuccess: true, rankList: rows, pagination: { pageNum: 1, totalPages: 5 } };
    const args = JSON.stringify([
        "rank_hot-real-drama/page",
        [{ key: "content", routerDataFnName: "p", routerDataFnArgs: [payload] }],
    ]);
    const html =
        '<html><body><script>self.__next_f.push([1,"x"])</script>' +
        '<script data-fn-name="mergeLoaderData" data-fn-args="' +
        args.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") +
        '"></script>' +
        '<script id="_ROUTER_DATA" type="application/json">' +
        JSON.stringify({
            loaderData: {
                "rank_hot-real-drama/page": { rankKey: "real", pageNum: 1, updatedText: "10月19日已更新" },
            },
        }) +
        "</script></body></html>";

    const board = parseBoard(html, 1, routeKey("hot-real-drama"), "真人剧");
    eq(board.items.length, 2, "the row with a broken id is dropped");
    eq(board.items[0].id, "7696437705822981182", "the first row");
    eq(board.items[0].badge, "全 3 集", "the badge carries the episode count");
    eq(board.items[0].cover, "https://p6-novel.byteimg.com/a~tplv-shrink:640:0.image", "the escaped cover is cleaned");
    eq(board.items[0].tags, "玄幻 · 逆袭 · 修真", "the tags");
    eq(board.items[1].id, "7696437705822981183", "the id falls back to the row's own id");
    eq(board.items[1].badge, "全 12 集", "the episode count is used when it is given");
    eq(board.positions["7696437705822981182"].rank, 1, "the rank");
    eq(board.positions["7696437705822981182"].heat, "8370万热度", "the heat");
    eq(board.totalPages, 5, "the number of pages");
    eq(board.updatedText, "10月19日已更新", "the update line");

    // A page that is not the one that was asked for.
    let threw = "";
    try {
        parseBoard(html, 2, routeKey("hot-real-drama"), "真人剧");
    } catch (e) {
        threw = String(e.message);
    }
    threw.includes("分页信息异常") ? ok("the wrong page is rejected") : fail("the wrong page was accepted: " + threw);

    // A board that says it failed.
    const failed = html.replace("&quot;isSuccess&quot;:true", "&quot;isSuccess&quot;:false");
    threw = "";
    try {
        parseBoard(failed, 1, routeKey("hot-real-drama"), "真人剧");
    } catch (e) {
        threw = String(e.message);
    }
    threw.includes("榜暂不可用") ? ok("a board that failed is reported") : fail("the failure was: " + threw);
}

console.log("== a board that carries the cards but not the loader call ==");
{
    // The site answers that way often: 5 of 12 requests on 2026-10-19 had
    // the cards but no deferred JSON. The fixture is a real response, cut
    // down to two cards.
    const html = fs.readFileSync(
        path.join(__dirname, "fixtures", "board-rendered.html"),
        "utf8"
    );
    const board = parseBoard(html, 2, routeKey("hot-real-drama"), "真人剧");
    eq(board.items.length, 2, "both cards are read");
    eq(board.items[0].id, "7685265188223732761", "the first card");
    eq(board.items[0].title, "从东北来的她", "the title");
    eq(board.items[0].cover, "https://p3-novel.byteimg.com/novel-pic/7f3bd45397c72e352e4699e2cde816ae~tplv-shrink:640:0.image", "the cover");
    eq(board.items[0].description, "东北神人屯长大的秋野，被接回京城沈家。", "the description");
    eq(board.items[0].tags, "家庭 · 家庭伦理", "the tags");
    eq(board.items[0].badge, "4892万热度", "the badge carries the heat");
    eq(board.positions["7685265188223732761"].rank, 21, "the rank");
    eq(board.positions["7685265188223732761"].heat, "4892万热度", "the heat");
    eq(board.totalPages, 5, "the last page comes from the pagination");
    eq(board.updatedText, "10月19日已更新 · 基于红果内观看/互动等综合热度排序", "the update line");

    // The page the fixture is not.
    let threw = "";
    try {
        parseBoard(html, 1, routeKey("hot-real-drama"), "真人剧");
    } catch (e) {
        threw = String(e.message);
    }
    threw.includes("分页信息异常") ? ok("the wrong page is rejected") : fail("the wrong page was accepted: " + threw);
}

console.log("== putting two boards into one list ==");
{
    const show = (id, title) => ({ id, title, cover: "", description: "", badge: "", tags: "" });
    const comic = {
        items: [show("c1", "漫剧一"), show("c2", "漫剧二")],
        positions: {
            c1: { rank: 1, heat: "5000万热度" },
            c2: { rank: 2, heat: "1000万热度" },
        },
        totalPages: 3,
        updatedText: "",
    };
    const ai = {
        items: [show("a1", "AI剧一"), show("a2", "AI剧二")],
        positions: {
            a1: { rank: 1, heat: "8000万热度" },
            a2: { rank: 2, heat: "3000万热度" },
        },
        totalPages: 4,
        updatedText: "10月19日已更新",
    };
    const merged = mergeBoards(1, [comic, ai]);
    eq(
        merged.items.map((item) => item.id),
        ["a1", "c1", "a2", "c2"],
        "the list is ordered by the heat, across both boards"
    );
    eq(
        merged.items.map((item) => merged.positions[item.id].rank),
        [1, 2, 3, 4],
        "the merged list is renumbered, so there is only one 第 1 名"
    );
    eq(merged.totalPages, 3, "the shortest board decides the number of pages");
    eq(merged.updatedText, "10月19日已更新", "the update line of the first board that has one");

    // The site's own boards continue their numbering across the pages, and
    // the merged list follows them: page 2 of a board starts at 21.
    const comicPage2 = {
        items: [show("c1", "漫剧一"), show("c2", "漫剧二")],
        positions: {
            c1: { rank: 21, heat: "5000万热度" },
            c2: { rank: 22, heat: "1000万热度" },
        },
        totalPages: 3,
        updatedText: "",
    };
    const aiPage2 = {
        items: [show("a1", "AI剧一"), show("a2", "AI剧二")],
        positions: {
            a1: { rank: 21, heat: "8000万热度" },
            a2: { rank: 22, heat: "3000万热度" },
        },
        totalPages: 4,
        updatedText: "",
    };
    const second = mergeBoards(2, [comicPage2, aiPage2]);
    eq(
        second.items.map((item) => second.positions[item.id].rank),
        [41, 42, 43, 44],
        "page two continues the numbering the site gave"
    );

    // A heat that cannot be read goes last rather than being guessed at.
    const broken = {
        items: [show("x", "没有热度")],
        positions: { x: { rank: 1, heat: "" } },
        totalPages: 1,
        updatedText: "",
    };
    const mixed = mergeBoards(1, [broken, ai]);
    eq(
        mixed.items.map((item) => item.id),
        ["a1", "a2", "x"],
        "a row without a heat goes last"
    );
}

console.log("== the router payload and the escaping ==");
{
    const html = '<script id="_ROUTER_DATA">{"loaderData":{"a":{"b":1}}}</script>';
    eq(extractRouter(html).loaderData.a.b, 1, "the router payload");
    eq(unescapeHtml("&quot;a&quot; &amp; &lt;b&gt;"), '"a" & <b>', "the attribute escaping");
    let threw = "";
    try {
        extractRouter("<html>nothing here</html>");
    } catch (e) {
        threw = String(e.message);
    }
    threw ? ok("a page without a payload is rejected") : fail("a page without a payload was accepted");
}

console.log("== the deferred payload ==");
{
    const payload = { isSuccess: true, rankList: [], pagination: { pageNum: 1, totalPages: 1 } };
    const args = JSON.stringify([
        "rank_hot-drama/page",
        [{ key: "content", routerDataFnName: "p", routerDataFnArgs: [payload] }],
    ]);
    const html = '<script data-fn-name="mergeLoaderData" data-fn-args="' + args.replace(/"/g, "&quot;") + '"></script>';
    const found = deferredPayload(html, "rank_hot-drama/page");
    eq(found && found.isSuccess, true, "the payload is found");
    eq(deferredPayload(html, "rank_other/page"), null, "a payload for another route is not taken");
    eq(deferredPayload("<html></html>", "rank_hot-drama/page"), null, "a page without one");
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
