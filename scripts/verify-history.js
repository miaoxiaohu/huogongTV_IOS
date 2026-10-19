#!/usr/bin/env node
/**
 * The watching records, the confirmations, the backup preview and the licenses.
 *
 * Four things that are easy to get wrong and hard to see:
 *
 * - a record that is deleted has to take its "watched through" mark with it,
 *   or the show comes back looking finished;
 * - every action that throws records away has to ask first, and the dialog
 *   has to be usable again the next time it opens;
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
const {
    confirmWords,
    applyPendingToLibrary,
    pendingRestoresSettings,
} = require(path.join(cache, "ui/confirmations.js"));

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

console.log("== every action that throws records away asks first ==");
{
    const pending = {
        "remove-record": { kind: "remove-record", id: "2", title: "收藏二" },
        "clear-searches": { kind: "clear-searches" },
        "clear-history": { kind: "clear-history" },
    };
    // The words are the TV app's: the same title, the same sentence.
    eq(
        confirmWords(pending["remove-record"]),
        {
            title: "删除观看记录",
            body: "删除《收藏二》的本机观看进度？收藏会保留。",
            okLabel: "确认",
        },
        "deleting a record says what is going to happen"
    );
    eq(
        confirmWords(pending["clear-searches"]),
        {
            title: "清空搜索历史",
            body: "清除本机保存的搜索词？",
            okLabel: "确认",
        },
        "clearing the search words says so too"
    );
    eq(
        confirmWords(pending["clear-history"]),
        {
            title: "清空观看记录",
            body: "将删除本机所有观看进度，收藏会保留。",
            okLabel: "确认",
        },
        "and clearing every record says what is kept"
    );

    // And each of them does what it says.
    const after = applyPendingToLibrary(pending["remove-record"], library());
    eq(Object.keys(after.progress), ["1"], "the record is gone");
    eq(after.watched, ["1"], "and so is its mark");
    eq(after.favorites.length, 1, "the favourite stays");
    eq(
        applyPendingToLibrary(pending["clear-searches"], library()).searches,
        [],
        "the search words are gone"
    );
    eq(
        Object.keys(applyPendingToLibrary(pending["clear-history"], library()).progress),
        [],
        "every record is gone"
    );
    eq(
        applyPendingToLibrary(pending["clear-history"], library()).favorites.length,
        1,
        "and the favourite is still there"
    );

    // The settings come back only when the box was ticked.
    const backup = {
        favorites: [],
        history: [],
        watched: [],
        searches: [],
        later: [],
        hidden: [],
        settings: {
            quality: 1080,
            speed: 2,
            autoNext: false,
            type: "comic",
            frame: "zoom",
        },
    };
    eq(
        pendingRestoresSettings({ kind: "restore", backup, name: "b", withSettings: false }),
        false,
        "a restore leaves the settings alone by default"
    );
    eq(
        pendingRestoresSettings({ kind: "restore", backup, name: "b", withSettings: true }),
        true,
        "and brings them back when the box is ticked"
    );
    eq(
        pendingRestoresSettings(pending["clear-history"]),
        false,
        "nothing else carries the settings"
    );
    eq(
        confirmWords({ kind: "restore", backup, name: "b", withSettings: false }).okLabel,
        "合并恢复",
        "the restore says it merges"
    );
}

console.log("== the dialog is usable again the next time it opens ==");
{
    const shim = require("./fixtures/react-shim");
    shim.reset();
    shim.install(cache);
    const { Confirm } = require(path.join(cache, "ui/Confirm.js"));

    let okCalls = 0;
    const dialog = (pending) =>
        shim.jsx(Confirm, {
            pending,
            onClose: () => {},
            onOk: () => {
                okCalls++;
            },
        });

    const first = { kind: "clear-searches" };
    let tree = shim.render(dialog(first));
    let found = shim.buttons(tree);
    eq(found.length, 2, "the dialog has two buttons");
    eq(
        found.map((b) => b.props.disabled),
        [false, false],
        "and both of them work"
    );
    // The user presses the one that goes ahead.
    const go = found.find((b) => b.props.accessibilityLabel === "确认");
    go.props.onPress();
    eq(okCalls, 1, "the action ran");
    tree = shim.render(dialog(first));
    found = shim.buttons(tree);
    eq(
        found.map((b) => b.props.disabled),
        [true, true],
        "and the buttons stop working, so a second tap cannot do it twice"
    );
    // The dialog closes and something else opens it.
    tree = shim.render(dialog(null));
    eq(shim.buttons(tree).length, 0, "the dialog is gone");
    tree = shim.render(dialog({ kind: "clear-history" }));
    found = shim.buttons(tree);
    eq(
        found.map((b) => b.props.disabled),
        [false, false],
        "and the next one works - a new dialog never inherits the last one's state"
    );
    // And the very same request, shown again. The flag has to go away with
    // the dialog, not with the request: a parent that keeps its request
    // around would otherwise get a dead dialog.
    tree = shim.render(dialog(null));
    tree = shim.render(dialog(first));
    found = shim.buttons(tree);
    eq(
        found.map((b) => b.props.disabled),
        [false, false],
        "and the same request shown again is a new dialog, not a dead one"
    );
}

console.log("== the licenses name every library that is shipped ==");
{
    const pkg = require(path.join(ROOT, "package.json"));
    const shipped = Object.keys(pkg.dependencies || {});
    eq(shipped.length > 0, true, "the app has dependencies");
    for (const name of shipped) {
        const entry = LICENSES.find((row) => row.name === name);
        if (!entry) {
            fail("the library " + name + " is not named in the licenses");
            continue;
        }
        ok("the library " + name + " is named (" + entry.license + ")");
        // The terms have to be the ones the package really is under, not just
        // something that is written down.
        let installed = null;
        try {
            installed = require(path.join(
                ROOT,
                "node_modules",
                name,
                "package.json"
            ));
        } catch (error) {
            fail("the library " + name + " is not installed");
            continue;
        }
        const terms =
            installed.license ||
            (installed.licenses && installed.licenses[0] &&
                (installed.licenses[0].type || installed.licenses[0])) ||
            "";
        eq(
            entry.license,
            terms,
            "the terms of " + name + " are the ones the package really has"
        );
    }
    for (const entry of LICENSES) {
        if (!entry.license || !entry.license.trim()) {
            fail("the library " + entry.name + " has no license");
        }
        if (!shipped.includes(entry.name)) {
            fail("the license list names " + entry.name + ", which is not a dependency");
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
