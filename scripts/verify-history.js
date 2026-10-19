#!/usr/bin/env node
/**
 * The watching records, the backup preview and the licenses.
 *
 * Three things that are easy to get wrong and hard to see:
 *
 * - a record that is deleted has to take its "watched through" mark with it,
 *   or the show comes back looking finished;
 * - the preview of a backup has to count the backup and not the device, or it
 *   describes the wrong thing;
 * - every library the app ships with has to be named in the licenses, or the
 *   app is not telling the truth about what is inside it.
 */
const path = require("path");
const { ROOT, transpile, stubNativeModules } = require("./transpile");

const cache = transpile("history-verify");
stubNativeModules(cache);
const { removeHistory, clearHistory, clearSearches } = require(path.join(
    cache,
    "data/history.js"
));
const { describeBackup } = require(path.join(cache, "data/backup.js"));
const { licenseNotice, LICENSES, APP_LICENSE, REPOSITORY } = require(path.join(
    cache,
    "data/licenses.js"
));

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
const has = (text, needle, m) =>
    text.includes(needle)
        ? ok(m + " (" + needle + ")")
        : fail(m + ": " + JSON.stringify(text) + " does not hold " + needle);

const show = (id, title) => ({
    id,
    title,
    cover: "https://p6-novel.byteimg.com/a.image",
    description: "",
    badge: "全86集",
    tags: "都市",
});

const progressOf = (id, title, updatedAt) => ({
    series: show(id, title),
    episodeId: "7000000000000000001",
    episodeNumber: 3,
    position: 120,
    duration: 300,
    completed: false,
    updatedAt,
});

const library = () => ({
    favorites: [show("1", "收藏一")],
    progress: {
        "1": progressOf("1", "收藏一", 1000),
        "2": progressOf("2", "收藏二", 2000),
    },
    favoriteUpdates: {},
    searches: [{ query: "都市", type: "comic" }],
    later: [show("3", "稍后看")],
    watched: ["1", "2"],
    hidden: ["9"],
});

console.log("== a record that is deleted takes its mark with it ==");
{
    const before = library();
    const after = removeHistory(before, "2");
    eq(Object.keys(after.progress), ["1"], "only that show is left without a record");
    eq(after.watched, ["1"], "and without the watched through mark");
    eq(after.favorites.length, 1, "the favourite stays");
    eq(after.later.length, 1, "the watch later list stays");
    eq(after.hidden, ["9"], "the hidden shows stay");
    eq(after.searches.length, 1, "the searches stay");
    eq(
        Object.keys(before.progress),
        ["1", "2"],
        "the old records are not touched - the app keeps the old state until the new one is saved"
    );
    eq(before.watched, ["1", "2"], "and the old marks are not touched either");
    eq(
        removeHistory(before, "77").progress,
        before.progress,
        "a show that was never watched changes nothing"
    );
}

console.log("== clearing the records keeps everything that is not a record ==");
{
    const after = clearHistory(library());
    eq(after.progress, {}, "no record is left");
    eq(after.watched, [], "and no mark is left");
    eq(after.favorites.length, 1, "the favourite stays");
    eq(after.later.length, 1, "the watch later list stays");
    eq(after.hidden, ["9"], "the hidden shows stay");
    eq(after.searches.length, 1, "the searches stay");
}

console.log("== clearing the searches keeps the records ==");
{
    const after = clearSearches(library());
    eq(after.searches, [], "the searches are gone");
    eq(Object.keys(after.progress), ["1", "2"], "the records stay");
    eq(after.watched, ["1", "2"], "and the marks stay");
    eq(after.favorites.length, 1, "and the favourite stays");
}

console.log("== the preview of a backup counts the backup ==");
{
    const backup = {
        favorites: [show("1", "a"), show("2", "b")],
        history: [progressOf("1", "a", 1), progressOf("2", "b", 2)],
        watched: ["1"],
        searches: [{ query: "x", type: "short" }],
        later: [show("3", "c")],
        hidden: ["4", "5"],
        settings: {
            quality: 540,
            speed: 1,
            autoNext: true,
            type: "short",
            frame: "fit",
        },
    };
    const text = describeBackup(backup);
    has(text, "2 部收藏", "the favourites are counted");
    has(text, "2 条观看记录", "the records are counted");
    has(text, "1 条搜索", "the searches are counted");
    has(text, "1 部稍后看", "the watch later list is counted");
    has(text, "2 部已隐藏推荐", "the hidden shows are counted");
    has(text, "收藏合并", "and the merge rules are stated");
    const empty = describeBackup({
        ...backup,
        favorites: [],
        history: [],
        searches: [],
        later: [],
        hidden: [],
    });
    has(empty, "0 部收藏", "an empty backup says zero");
    has(empty, "0 条观看记录", "for the records too");
}

console.log("== the licenses name every library that is shipped ==");
{
    const pkg = require(path.join(ROOT, "package.json"));
    const shipped = Object.keys(pkg.dependencies || {});
    eq(shipped.length > 0, true, "the app has dependencies");
    for (const name of shipped) {
        const entry = LICENSES.find((row) => row.name === name);
        if (!entry) fail("the library " + name + " is not named in the licenses");
        else ok("the library " + name + " is named (" + entry.license + ")");
    }
    for (const entry of LICENSES) {
        if (!entry.license || !entry.license.trim()) {
            fail("the library " + entry.name + " has no license");
        }
    }
    const text = licenseNotice();
    has(text, APP_LICENSE, "the app's own terms are named");
    has(text, "drpys", "the project the content handling came from is named");
    has(text, REPOSITORY, "and where the source is");
    for (const entry of LICENSES) {
        has(text, entry.name, "the notice names " + entry.name);
    }
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
