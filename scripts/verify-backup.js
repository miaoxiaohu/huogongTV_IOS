#!/usr/bin/env node
/**
 * Backing the local records up and putting them back.
 *
 * The format is the TV app's, so one backup works on both, and the merge
 * rules are the TV app's too: the favourites that are already here stay
 * first, and only a newer record replaces an older one.
 *
 * Checked against a transliteration of the Kotlin `LibraryBackup`.
 */
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const cache = transpile("backup-verify");
stubNativeModules(cache);
const {
    encodeBackup,
    decodeBackup,
    mergeBackup,
    settingsFromBackup,
    BACKUP_FORMAT,
    BACKUP_VERSION,
    BACKUP_MAX_BYTES,
} = require(path.join(cache, "data/backup.js"));

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

const show = (id, title) => ({
    id,
    title,
    cover: "https://p6-novel.byteimg.com/a.image",
    description: "不该进备份的简介",
    badge: "全86集",
    tags: "都市",
});

const library = {
    favorites: [show("1", "收藏一"), show("2", "收藏二")],
    progress: {
        "1": {
            series: show("1", "收藏一"),
            episodeId: "7000000000000000001",
            episodeNumber: 3,
            position: 120,
            duration: 300,
            completed: false,
            updatedAt: 1000,
        },
    },
    favoriteUpdates: {},
    searches: [{ query: "都市", type: "comic" }],
    later: [show("9", "稍后看")],
    watched: ["2"],
};

const settings = {
    baseUrl: "",
    token: "secret",
    category: "comic",
    maxQuality: 720,
    playbackSpeed: 1.5,
    frameMode: "zoom",
    autoNext: false,
};

console.log("== the backup travels ==");
{
    const text = encodeBackup(library, settings, 12345);
    const data = JSON.parse(text);
    eq(data.format, BACKUP_FORMAT, "the format marker");
    eq(data.version, BACKUP_VERSION, "the version");
    eq(data.createdAt, 12345, "when it was made");
    eq(data.favorites.length, 2, "the favourites are in it");
    eq(data.history.length, 1, "the records are in it");
    eq(data.watched, ["2"], "the watched shows are in it");
    eq(data.later.length, 1, "the watch later list is in it");
    eq(data.searches, [{ query: "都市", type: "comic" }], "the searches are in it");
    eq(data.settings.quality, 720, "the quality travels");
    eq(data.settings.speed, 1.5, "the speed travels");
    eq(data.settings.autoNext, false, "the auto next travels");
    eq(data.settings.type, "comic", "the shelf travels");
    eq(data.settings.frame, "zoom", "the frame mode travels");
    // The token must never leave the device.
    eq(text.includes("secret"), false, "the token is not in the backup");
    // The description is not needed for a search and would make the file big.
    eq(data.favorites[0].description, "", "the descriptions are left out");
    eq(data.history[0].episodeIndex, 2, "the episode number is stored as an index");
}

console.log("== what comes back is what went out ==");
{
    const text = encodeBackup(library, settings, 12345);
    const back = decodeBackup(text);
    eq(back.favorites.map((s) => s.id), ["1", "2"], "the favourites");
    eq(back.history.length, 1, "the records");
    eq(back.history[0].episodeIndex, 2, "the episode index");
    eq(back.history[0].position, 120, "the position");
    eq(back.watched, ["2"], "the watched shows");
    eq(back.later.map((s) => s.id), ["9"], "the watch later list");
    eq(back.searches, [{ query: "都市", type: "comic" }], "the searches");
    eq(back.settings.quality, 720, "the quality");
    eq(settingsFromBackup(back.settings).frameMode, "zoom", "the frame mode comes back in the app's shape");
}

console.log("== a backup that cannot be read is refused ==");
{
    const cases = [
        ["not json at all", "不是 json"],
        [JSON.stringify({ format: "something.else", version: 1 }), "别人的格式"],
        [JSON.stringify({ format: BACKUP_FORMAT, version: 2 }), "不支持的版本"],
        [JSON.stringify({ format: BACKUP_FORMAT, version: 1, favorites: [{ id: "1", title: "剧" }], history: [], watched: [], searches: [], settings: {} }), "设置不对"],
        [JSON.stringify({ format: BACKUP_FORMAT, version: 1, favorites: [{ id: "x", title: "剧" }], history: [], watched: [], searches: [], settings: { quality: 720, speed: 1, autoNext: true, type: "short", frame: "fit" } }), "id 不对"],
        [JSON.stringify({ format: BACKUP_FORMAT, version: 1, favorites: [], history: [], watched: [], searches: [], settings: { quality: 111, speed: 1, autoNext: true, type: "short", frame: "fit" } }), "清晰度不对"],
        [JSON.stringify({ format: BACKUP_FORMAT, version: 1, favorites: [], history: [], watched: [], searches: [], settings: { quality: 720, speed: 1, autoNext: true, type: "short", frame: "nonsense" } }), "画面模式不对"],
    ];
    for (const [text, what] of cases) {
        let threw = false;
        try {
            decodeBackup(text);
        } catch (e) {
            threw = true;
        }
        threw ? ok("rejected: " + what) : fail("accepted: " + what);
    }
    let threw = false;
    try {
        decodeBackup("x".repeat(BACKUP_MAX_BYTES + 1));
    } catch (e) {
        threw = true;
    }
    threw ? ok("rejected: too big") : fail("accepted: too big");
}

console.log("== putting a backup back ==");
{
    const incoming = {
        favorites: [show("2", "收藏二"), show("3", "收藏三")],
        history: [
            {
                series: show("1", "收藏一"),
                episodeId: "7000000000000000009",
                episodeIndex: 8,
                position: 240,
                duration: 300,
                completed: false,
                updatedAt: 5000,
            },
        ],
        watched: ["1", "3"],
        searches: [{ query: "都市", type: "comic" }, { query: "悬疑", type: "short" }],
        settings: {
            quality: 1080,
            speed: 1,
            autoNext: true,
            type: "short",
            frame: "fit",
        },
        later: [show("9", "稍后看"), show("8", "另一部")],
    };
    const merged = mergeBackup(library, incoming, true);
    eq(
        merged.favorites.map((s) => s.id),
        ["1", "2", "3"],
        "the favourites that were here stay first"
    );
    eq(
        merged.progress["1"].episodeNumber,
        9,
        "a newer record replaces the older one"
    );
    eq(merged.progress["1"].updatedAt, 5000, "and it carries its own time");
    eq(merged.watched.includes("1"), true, "the show the backup saw is watched");
    eq(
        merged.searches.map((s) => s.query),
        ["都市", "悬疑"],
        "the searches are merged"
    );
    eq(
        merged.later.map((s) => s.id),
        ["9", "8"],
        "the watch later list is merged"
    );
    eq(settingsFromBackup(incoming.settings).maxQuality, 1080, "the settings can come back too");
    eq(
        settingsFromBackup(incoming.settings).maxQuality,
        1080,
        "and the app can keep its own"
    );
}

console.log("== an older record does not replace a newer one ==");
{
    const incoming = {
        favorites: [],
        history: [
            {
                series: show("1", "收藏一"),
                episodeId: "7000000000000000000",
                episodeIndex: 0,
                position: 10,
                duration: 300,
                completed: false,
                updatedAt: 10,
            },
        ],
        watched: [],
        searches: [],
        settings: {
            quality: 540,
            speed: 1,
            autoNext: true,
            type: "short",
            frame: "fit",
        },
        later: [],
    };
    const merged = mergeBackup(library, incoming, true);
    eq(
        merged.progress["1"].episodeNumber,
        3,
        "the local record stays, because the backup is older"
    );
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
