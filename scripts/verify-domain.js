#!/usr/bin/env node
/**
 * The domain layer: where playback resumes, how a page of shows is merged,
 * how a service address is checked, and how the local records are read back.
 *
 * `resumeTarget` decides which episode the user lands on, so a mistake there
 * opens the wrong episode. It is checked against a line by line
 * transliteration of the Kotlin `ResumePlayback.target`, the same way the
 * media crypto is checked against `MediaCrypto.kt`.
 */
const fs = require("fs");
const path = require("path");
const { transpile, mockModule } = require("./transpile");

const ROOT = path.join(__dirname, "..");
const WORK = path.join(ROOT, "node_modules", ".cache", "domain-verify");
fs.mkdirSync(WORK, { recursive: true });

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
// A stand-in for the key value store
// ---------------------------------------------------------------------------
const mockPath = path.join(WORK, "async_storage_mock.js");
fs.writeFileSync(
    mockPath,
    `const store = new Map();
module.exports = {
  store,
  multiGet: async (keys) => keys.map((k) => [k, store.has(k) ? store.get(k) : null]),
  setItem: async (k, v) => { store.set(k, v); },
  getItem: async (k) => (store.has(k) ? store.get(k) : null),
  removeItem: async (k) => { store.delete(k); },
};
`,
    "utf8"
);
mockModule("@react-native-async-storage/async-storage", mockPath);
// The mock owns the store, so the test has to use that one and not its own.
const store = require(mockPath).store;
const cache = transpile("domain-verify");
const model = require(path.join(cache, "domain/model.js"));
const storage = require(path.join(cache, "data/storage.js"));

// ---------------------------------------------------------------------------
// The Kotlin, transliterated
// ---------------------------------------------------------------------------
// ResumePlayback.target(episodes, episodeId, position, completed)
function kotlinResumeTarget(episodes, episodeId, position, completed) {
    const index = episodes.indexOf(episodeId);
    if (index < 0) return { index: 0, position: 0 };
    if (completed) {
        return {
            index: Math.min(index + 1, episodes.length - 1),
            position: 0,
        };
    }
    return { index, position: Math.max(0, position) };
}

console.log("== where playback resumes ==");
{
    const episodes = ["a", "b", "c", "d"];
    const detail = { episodes: episodes.map((id, i) => ({ id, number: i + 1, title: "第" + (i + 1) + "集" })) };
    const progress = (episodeId, position, completed) => ({
        series: { id: "s", title: "t", cover: "", description: "", badge: "", tags: "" },
        episodeId,
        episodeNumber: 1,
        position,
        duration: 0,
        completed,
        updatedAt: 0,
    });

    eq(model.resumeTarget(detail, undefined), { index: 0, position: 0 }, "no record starts at the first episode");
    eq(model.resumeTarget(detail, progress("c", 42, false)), { index: 2, position: 42 }, "an unfinished episode resumes where it stopped");
    eq(model.resumeTarget(detail, progress("zzz", 42, false)), { index: 0, position: 0 }, "a record for an episode that is gone starts over");
    eq(model.resumeTarget(detail, progress("b", -10, false)), { index: 1, position: 0 }, "a negative position is clamped to zero");
    eq(model.resumeTarget(detail, progress("b", 0, false)), { index: 1, position: 0 }, "a position of zero stays zero");
    eq(model.resumeTarget(detail, progress("b", 30, true)), { index: 2, position: 0 }, "a finished episode moves to the next one");
    eq(model.resumeTarget(detail, progress("d", 30, true)), { index: 3, position: 0 }, "a finished last episode stays on the last one");

    const one = { episodes: [{ id: "only", number: 1, title: "第1集" }] };
    eq(model.resumeTarget(one, progress("only", 10, true)), { index: 0, position: 0 }, "a finished only episode stays where it is");

    // And the whole table against the Kotlin.
    let mismatches = 0;
    let cases = 0;
    for (const id of ["a", "b", "c", "d", "zzz", ""]) {
        for (const position of [-5, 0, 1, 42, 3600]) {
            for (const completed of [true, false]) {
                cases++;
                const got = model.resumeTarget(detail, progress(id, position, completed));
                const want = kotlinResumeTarget(episodes, id, position, completed);
                if (JSON.stringify(got) !== JSON.stringify(want)) {
                    mismatches++;
                    console.error("    " + JSON.stringify({ id, position, completed, got, want }));
                }
            }
        }
    }
    eq(mismatches, 0, "all " + cases + " cases match the Kotlin");
}

console.log("== merging a page of shows ==");
{
    const show = (id, title) => ({ id, title, cover: "", description: "", badge: "", tags: "" });
    eq(model.mergePage([], []), [], "two empty pages merge into nothing");
    eq(
        model.mergePage([show("1", "a")], [show("2", "b")]),
        [show("1", "a"), show("2", "b")],
        "a new page is appended"
    );
    eq(
        model.mergePage([show("1", "a"), show("2", "b")], [show("2", "B"), show("3", "c")]),
        [show("1", "a"), show("2", "B"), show("3", "c")],
        "a show that is already there is updated in place"
    );
    eq(
        model.mergePage([show("1", "a"), show("2", "b")], [show("1", "A")]),
        [show("1", "A"), show("2", "b")],
        "the order of the first page is kept"
    );
}

console.log("== a page of a hot board joins the pages on the screen ==");
{
    const show = (id, title) => ({ id, title, cover: "", description: "", badge: "", tags: "" });
    const first = {
        items: [show("1", "第一部"), show("2", "第二部")],
        positions: { 1: { rank: 1, heat: "9000万热度" }, 2: { rank: 2, heat: "8000万热度" } },
        totalPages: 5,
        updatedText: "10月19日已更新",
    };
    const second = {
        items: [show("3", "第三部")],
        positions: { 3: { rank: 21, heat: "7000万热度" } },
        totalPages: 5,
        updatedText: "10月19日已更新",
    };
    const joined = model.mergeBoardPage(first, second, false);
    eq(
        joined.items.map((item) => item.id),
        ["1", "2", "3"],
        "the new page is appended"
    );
    eq(
        Object.keys(joined.positions).sort(),
        ["1", "2", "3"],
        "the positions of the earlier pages stay, or their cards would lose the rank badge"
    );
    eq(joined.positions["1"].rank, 1, "the first page keeps its rank");
    eq(joined.positions["3"].rank, 21, "the new page brings its own");
    const replaced = model.mergeBoardPage(first, second, true);
    eq(
        replaced.items.map((item) => item.id),
        ["3"],
        "a refresh replaces the pages"
    );
    eq(
        Object.keys(replaced.positions),
        ["3"],
        "and the positions with them"
    );
}

console.log("== checking a service address ==");
{
    eq(model.normalizeBaseUrl("http://192.168.1.10:8787"), "http://192.168.1.10:8787", "a plain address is kept");
    eq(model.normalizeBaseUrl("  https://example.com/  "), "https://example.com", "spaces and trailing slashes are trimmed");
    eq(model.normalizeBaseUrl("http://example.com///"), "http://example.com", "every trailing slash is trimmed");
    eq(model.normalizeBaseUrl("http://[::1]:8787"), "http://[::1]:8787", "an ipv6 address in brackets is accepted");
    for (const bad of ["", "   ", "192.168.1.10:8787", "example.com", "http://", "ftp://example.com", "http://example.com/path"]) {
        let threw = false;
        try {
            model.normalizeBaseUrl(bad);
        } catch (e) {
            threw = true;
        }
        threw ? ok("rejected: " + JSON.stringify(bad)) : fail("accepted: " + JSON.stringify(bad));
    }
}

console.log("== reading the local records back ==");
{
    const async2 = () => {};
    (async () => {
        store.clear();
        {
            const state = await storage.loadState();
            eq(
                state.settings,
                {
                    baseUrl: "",
                    token: "",
                    category: "short",
                    maxQuality: 540,
                    playbackSpeed: 1,
                    frameMode: "fit",
                    autoNext: true,
                },
                "nothing stored gives the defaults"
            );
            eq(state.library, { favorites: [], progress: {} }, "and an empty library");
        }
        {
            store.set(
                "settings.v1",
                JSON.stringify({ baseUrl: "http://1.2.3.4:1", token: "t", category: "comic", maxQuality: 1080 })
            );
            store.set("library.v1", JSON.stringify({ favorites: [{ id: "1" }], progress: { s: { episodeId: "e" } } }));
            const state = await storage.loadState();
            eq(state.settings.maxQuality, 1080, "the stored quality is read");
            eq(state.settings.category, "comic", "the stored category is read");
            eq(state.library.favorites.length, 1, "the stored favourites are read");
        }
        {
            store.set(
                "settings.v1",
                JSON.stringify({
                    baseUrl: "http://1.2.3.4:1",
                    playbackSpeed: 1.5,
                    frameMode: "zoom",
                    autoNext: false,
                })
            );
            const state = await storage.loadState();
            eq(state.settings.playbackSpeed, 1.5, "the stored speed is read");
            eq(state.settings.frameMode, "zoom", "the stored frame mode is read");
            eq(state.settings.autoNext, false, "the stored auto next is read");
        }
        {
            store.set(
                "settings.v1",
                JSON.stringify({
                    baseUrl: "http://1.2.3.4:1",
                    playbackSpeed: 3,
                    frameMode: "nonsense",
                    autoNext: "yes",
                })
            );
            const state = await storage.loadState();
            eq(state.settings.playbackSpeed, 1, "a speed that is not on the list falls back to 1");
            eq(state.settings.frameMode, "fit", "a frame mode that is not on the list falls back");
            eq(state.settings.autoNext, true, "a broken auto next falls back to on");
        }
        {
            store.set("settings.v1", "{not json");
            store.set("library.v1", "{not json");
            const state = await storage.loadState();
            eq(state.settings.maxQuality, 540, "broken settings fall back to the defaults");
            eq(state.library, { favorites: [], progress: {} }, "broken records fall back to an empty library");
        }
        {
            store.set("settings.v1", JSON.stringify({ maxQuality: 100, category: "nonsense" }));
            const state = await storage.loadState();
            eq(state.settings.maxQuality, 540, "a quality below 360 falls back to 540");
            eq(state.settings.category, "short", "an unknown category falls back to short");
        }
        {
            store.set("library.v1", JSON.stringify({ favorites: "not an array", progress: {} }));
            const state = await storage.loadState();
            eq(state.library, { favorites: [], progress: {} }, "a library with broken favourites is ignored");
        }
        {
            store.set("library.v1", JSON.stringify({ favorites: [], progress: [] }));
            const state = await storage.loadState();
            eq(state.library, { favorites: [], progress: {} }, "a library with a broken progress map is ignored");
        }
        {
            // A record that is not a record would crash the list later, so
            // it is dropped here instead of carried along.
            store.set(
                "library.v1",
                JSON.stringify({
                    favorites: [],
                    progress: {
                        good: {
                            series: { id: "1", title: "剧" },
                            episodeId: "e",
                            episodeNumber: 2,
                            position: 30,
                            duration: 0,
                            completed: false,
                            updatedAt: 1,
                        },
                        empty: {},
                        noSeries: { episodeId: "e", episodeNumber: 1, position: 0 },
                        noNumber: {
                            series: { id: "2", title: "剧" },
                            episodeId: "e",
                            position: 0,
                        },
                        notAnObject: "nonsense",
                    },
                })
            );
            const state = await storage.loadState();
            eq(
                Object.keys(state.library.progress),
                ["good"],
                "only the records that can be read are kept"
            );
        }
        {
            // The writes are serialised, so a slow write cannot overwrite a
            // newer one.
            store.clear();
            await storage.saveLibrary({ favorites: [{ id: "1" }], progress: {} });
            await storage.saveLibrary({ favorites: [{ id: "2" }], progress: {} });
            const state = await storage.loadState();
            eq(state.library.favorites.map((f) => f.id), ["2"], "the last write wins");
        }
        async2();
        console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
        process.exit(failures ? 1 : 0);
    })().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
