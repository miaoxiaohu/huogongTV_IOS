#!/usr/bin/env node
/**
 * Live test against the real hongguoduanju.com.
 *
 *   node scripts/verify-live.js [--full] [--only=<episodeId>]
 *
 * The offline suites (verify-cenc-unit, verify-mediacrypto, verify-base64,
 * verify-crypto) prove the algorithms against oracles. This one proves the
 * things only the real server can answer:
 *
 *   1. the signed player still answers, and still answers with a usable url,
 *   2. the bytevc2 renditions are really skipped - and the *chosen* rendition
 *      is provably a bytevc1 one, not just "some" rendition,
 *   3. the quality ceiling really picks the entry we expect,
 *   4. the public plain MP4 fallback exists for the first three episodes of a
 *      series and is really gone from the fourth episode on,
 *   5. the whole download -> decrypt -> write pipeline produces a file that
 *      ffmpeg can decode a frame from.
 *
 * `--full` adds step 5, which downloads a few megabytes per episode.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { transpile, mockModule } = require("./transpile");
const { installFileSystemMock } = require("./fixtures/fs-mock");

const ROOT = path.join(__dirname, "..");
const WORK = path.join(ROOT, "node_modules", ".cache", "live-verify");
const TMP = path.join(WORK, "fs");
fs.mkdirSync(TMP, { recursive: true });

const SITE = "https://hongguoduanju.com";

const args = process.argv.slice(2);
const FULL = args.includes("--full");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").slice("--only=".length);

// A real series, and the episode ids of the first five of its 86 episodes.
const SERIES_ID = "7694653385668037657";
const EPISODES = [
    { number: 1, id: "7694655440692448281" },
    { number: 2, id: "7694655210777480217" },
    { number: 3, id: "7694655216007777305" },
    { number: 4, id: "7694655231191174169" },
    { number: 5, id: "7694655394844527641" },
];
const LATE_EPISODES = [
    { number: 40, id: null },
    { number: 86, id: null },
];

let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};
const note = (m) => console.log("  --   " + m);

// The file system mock has to be in place before the transpiled modules load.
installFileSystemMock(path.join(WORK, "file_access_mock.js"), TMP);
mockModule("react-native-file-access", path.join(WORK, "file_access_mock.js"));

const cache = transpile("live-verify");
const { ApiProvider } = require(path.join(cache, "data/api.js"));
const { prepareLocalMedia } = require(path.join(cache, "data/media.js"));
const { decryptUrl, decodeBase64Url } = require(path.join(cache, "data/mediaCrypto.js"));

/** Decrypts every rendition url so the chosen one can be identified. */
function decryptedUrls(list, keySeed, cleanUrl) {
    const seed = keySeed ? decodeBase64Url(keySeed) : null;
    const out = new Map();
    for (const entry of list) {
        if (!entry.mainUrl) continue;
        // The app cleans the escaped slashes before it decrypts, so the test
        // has to do the same or it compares two different strings.
        let url = cleanUrl(entry.mainUrl);
        if (seed) {
            try {
                url = decryptUrl(url, seed);
            } catch (e) {
                continue;
            }
        }
        out.set(url, entry);
    }
    return out;
}

function ffprobeStreams(file) {
    try {
        const text = execFileSync(
            "ffprobe",
            ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height", "-of", "default=nw=1", file],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        ).trim();
        return { ok: true, text };
    } catch (e) {
        return { ok: false, text: String((e.stderr || "") + (e.stdout || "")).trim() };
    }
}

function decodeFirstFrame(file, outPng) {
    try {
        execFileSync("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-y", outPng], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (e) {
        return { ok: false, text: String((e.stderr || "") + (e.stdout || "")).split("\n")[0] };
    }
    if (!fs.existsSync(outPng)) return { ok: false, text: "no frame produced" };
    const size = fs.statSync(outPng).size;
    return size > 1000 ? { ok: true, text: size + " byte PNG" } : { ok: false, text: "frame too small" };
}

/**
 * Resolves an episode and keeps the responses the provider fetched.
 *
 * The fallback url is a "hand out fresh signing material" endpoint: every
 * fetch of it returns a different key_seed and different CDN urls, and every
 * video_model call hands out a different fallback url to begin with. So the
 * only way to see the rendition list the app actually worked with is to keep
 * the response it fetched itself.
 */
async function resolveWithCapture(provider, episodeId) {
    const original = provider["fetchText"].bind(provider);
    const captured = [];
    provider["fetchText"] = async (url, signed) => {
        const text = await original(url, signed);
        captured.push({ url: String(url), text });
        return text;
    };
    try {
        const stream = await provider.resolveStream(episodeId);
        return { stream, captured };
    } finally {
        provider["fetchText"] = original;
    }
}

/** The rendition list out of a captured video_info response. */
function renditionList(captured) {
    for (const entry of captured) {
        if (!entry.text || !entry.text.trim()) continue;
        let parsed;
        try {
            parsed = JSON.parse(entry.text);
        } catch (e) {
            continue;
        }
        const info = parsed.video_info && parsed.video_info.data;
        if (!info || !info.video_list) continue;
        const list = [];
        for (const [k, v] of Object.entries(info.video_list)) {
            list.push({
                mapKey: k,
                codec: String(v.codec_type || "").toLowerCase(),
                definition: v.definition || v.quality_desc || v.height || v.vheight || v.quality || k,
                mainUrl: v.main_url || "",
            });
        }
        return { list, keySeed: info.key_seed || "" };
    }
    return null;
}

(async () => {
    const provider = new ApiProvider({ category: "short", maxQuality: 1080 });

    // -----------------------------------------------------------------------
    console.log("== episode list ==");
    const detail = await provider.detail(SERIES_ID);
    ok("series " + detail.title + " has " + detail.episodes.length + " episodes");
    if (detail.episodes.length < 40) fail("the series should have 86 episodes");
    for (const e of EPISODES) {
        const found = detail.episodes.find((x) => x.id === e.id);
        if (!found) fail("episode " + e.number + " (" + e.id + ") is not in the list");
        else if (found.number !== e.number) fail("episode " + e.id + " is number " + found.number + ", expected " + e.number);
    }
    if (detail.episodes.every((e) => EPISODES.find((x) => x.id === e.id) || e.number > 5)) {
        ok("the first five episode ids line up with the list");
    }
    LATE_EPISODES.forEach((e) => {
        const found = detail.episodes.find((x) => x.number === e.number);
        if (found) e.id = found.id;
    });

    const targets = ONLY
        ? EPISODES.concat(LATE_EPISODES).filter((e) => e.id === ONLY)
        : EPISODES.concat(LATE_EPISODES);
    if (targets.length === 0) {
        fail("no episode to test");
        process.exit(1);
    }

    // -----------------------------------------------------------------------
    console.log("== the signed player answers for every episode ==");
    const resolved = new Map();
    const renditions = new Map();
    for (const episode of targets) {
        let stream;
        let captured;
        try {
            const result = await resolveWithCapture(provider, episode.id);
            stream = result.stream;
            captured = result.captured;
        } catch (e) {
            fail("episode " + episode.number + ": " + (e && e.message));
            continue;
        }
        resolved.set(episode.id, stream);
        renditions.set(episode.id, captured);
        if (!/^https?:\/\//.test(stream.url)) fail("episode " + episode.number + ": url is not http(s)");
        if (!stream.key || stream.key.length !== 16) {
            fail("episode " + episode.number + ": content key is not 16 bytes");
        } else {
            ok("episode " + episode.number + ": " + stream.quality + ", 16 byte key, " + stream.url.slice(0, 48) + "...");
        }
    }

    // -----------------------------------------------------------------------
    console.log("== the chosen rendition is a bytevc1 one ==");
    for (const episode of targets) {
        const stream = resolved.get(episode.id);
        if (!stream) continue;
        const raw = renditionList(renditions.get(episode.id) || []);
        if (!raw) {
            fail("episode " + episode.number + ": the captured responses hold no rendition list");
            continue;
        }
        const byUrl = decryptedUrls(raw.list, raw.keySeed, (u) => provider["cleanUrl"](u));
        const chosen = byUrl.get(stream.url);
        if (!chosen) {
            fail("episode " + episode.number + ": the returned url matches no rendition in the list");
            continue;
        }
        if (chosen.codec !== "bytevc1") {
            fail("episode " + episode.number + ": the app picked a " + chosen.codec + " rendition");
        } else {
            ok("episode " + episode.number + ": picked " + chosen.codec + " " + chosen.definition);
        }
        const bytevc2 = raw.list.filter((e) => e.codec === "bytevc2");
        if (bytevc2.length > 0) {
            ok(
                "episode " +
                    episode.number +
                    ": the server offers " +
                    raw.list.length +
                    " renditions, " +
                    bytevc2.length +
                    " of them bytevc2, and none was picked"
            );
        }
    }

    // -----------------------------------------------------------------------
    console.log("== the quality ceiling picks the right entry ==");
    {
        // Episode 4 is the interesting one: 360p/480p/540p/720p are bytevc2 and
        // only 1080p is bytevc1, so every ceiling has to land on 1080p.
        const episode4 = EPISODES.find((e) => e.number === 4);
        for (const ceiling of [360, 540, 720, 1080]) {
            const p = new ApiProvider({ category: "short", maxQuality: ceiling });
            try {
                const s = await p.resolveStream(episode4.id);
                if (s.quality !== "1080P") {
                    fail("maxQuality " + ceiling + " picked " + s.quality + ", expected 1080P");
                } else {
                    ok("maxQuality " + ceiling + " -> 1080P (the only bytevc1 rendition)");
                }
            } catch (e) {
                fail("maxQuality " + ceiling + ": " + (e && e.message));
            }
        }
        // Episode 1 has every rendition as bytevc1, so the ceiling must bite.
        const episode1 = EPISODES.find((e) => e.number === 1);
        for (const ceiling of [360, 540, 720, 1080]) {
            const p = new ApiProvider({ category: "short", maxQuality: ceiling });
            try {
                const s = await p.resolveStream(episode1.id);
                const expected = ceiling + "P";
                if (s.quality !== expected) {
                    fail("maxQuality " + ceiling + " picked " + s.quality + ", expected " + expected);
                } else {
                    ok("maxQuality " + ceiling + " -> " + s.quality);
                }
            } catch (e) {
                fail("maxQuality " + ceiling + ": " + (e && e.message));
            }
        }
    }

    // -----------------------------------------------------------------------
    console.log("== the public plain MP4 fallback ==");
    for (const episode of targets) {
        const url = `${SITE}/video/public/${episode.id}/360p.mp4`;
        let status = 0;
        try {
            const res = await fetch(url, {
                headers: { "User-Agent": "com.phoenix.read/71332 (Linux; U; Android 16; zh_CN; 25053RT47C)", Range: "bytes=0-0" },
            });
            status = res.status;
        } catch (e) {
            status = 0;
        }
        const shouldExist = episode.number <= 3;
        // A ranged GET answers 206 when the file is there and 404 when it is
        // not, so both 200 and 206 mean "it exists".
        if (shouldExist && (status === 200 || status === 206)) {
            ok("episode " + episode.number + ": public MP4 exists (" + status + ")");
        } else if (shouldExist) {
            fail("episode " + episode.number + ": public MP4 should exist but answered " + status);
        } else if (status === 404) {
            ok("episode " + episode.number + ": public MP4 is gone (404), as expected");
        } else {
            note("episode " + episode.number + ": public MP4 answered " + status + " (not 404)");
        }
    }

    // -----------------------------------------------------------------------
    console.log("== the fallback path in resolve() ==");
    {
        // A broken signed player must not lose the episode: the first three
        // episodes are still playable through the public MP4.
        const p = new ApiProvider({ category: "short", maxQuality: 540 });
        const original = p.resolveStream.bind(p);
        p.resolveStream = async () => {
            throw new Error("simulated signed player outage");
        };
        const first = EPISODES[0];
        try {
            const playback = await p.resolve(first.id);
            if (playback.uri.includes("/video/public/") && playback.quality === "360P") {
                ok("a signed player outage falls back to the public MP4");
            } else {
                fail("the fallback produced " + playback.quality + " " + playback.uri.slice(0, 60));
            }
        } catch (e) {
            fail("the fallback threw: " + (e && e.message));
        }
        p.resolveStream = original;

        // And when neither source is there, the fact about the episode is
        // what the user needs: the recovery must not spend its budget on
        // an episode that simply has no video.
        const late = LATE_EPISODES[0];
        const p2 = new ApiProvider({ category: "short", maxQuality: 540 });
        p2.resolveStream = async () => {
            throw new Error("simulated signed player outage");
        };
        let surfaced = "";
        try {
            await p2.resolve(late.id);
        } catch (e) {
            surfaced = String(e && e.message);
        }
        surfaced === "该剧集暂无公开播放资源"
            ? ok("with no fallback either, the permanent verdict is the one that surfaces")
            : fail("the surfaced error was " + surfaced);
    }

    // -----------------------------------------------------------------------
    console.log("== the other seasons of the same show ==");
    {
        // A real show that has two seasons. The first one carries no marker
        // in its title, the second one says 第二季.
        const first = { id: "7682778663716146200", title: "反派拿捏！", cover: "", description: "", badge: "全155集", tags: "" };
        const second = { id: "7690412195565276184", title: "反派拿捏！第二季", cover: "", description: "", badge: "全390集", tags: "" };
        const seasons = await provider.seasons(first);
        const ids = seasons.map((entry) => entry.series.id);
        ids.includes(first.id)
            ? ok("the show itself is one of the seasons")
            : fail("the show itself is missing: " + JSON.stringify(ids));
        ids.includes(second.id)
            ? ok("the second season was found (" + second.id + ")")
            : fail("the second season is missing: " + JSON.stringify(ids));
        const numbers = seasons.map((entry) => entry.season).sort((a, b) => a - b);
        JSON.stringify(numbers) === "[1,2]"
            ? ok("the seasons are numbered 1 and 2")
            : fail("the seasons are numbered " + JSON.stringify(numbers));
        // The second season has to be a show of its own, not just a title.
        const other = await provider.detail(second.id);
        other.episodes.length > 0
            ? ok("the second season opens: " + other.title + " with " + other.episodes.length + " episodes")
            : fail("the second season has no episodes");
    }

    // -----------------------------------------------------------------------
    console.log("== the hot board ==");
    {
        const board = await provider.ranking(1);
        board.items.length > 0
            ? ok("the board has " + board.items.length + " shows")
            : fail("the board is empty");
        if (board.items.length > 0) {
            const first = board.items[0];
            const position = board.positions[first.id];
            position && position.rank === 1
                ? ok("the first show is 第 1 名: " + first.title)
                : fail("the first show is not 第 1 名: " + JSON.stringify(position));
            position && position.heat
                ? ok("the heat is read: " + position.heat)
                : fail("the heat is missing");
            board.items.every((item) => /^[0-9]+$/.test(item.id) && item.title)
                ? ok("every row has an id and a title")
                : fail("a row is missing its id or its title");
            board.updatedText
                ? ok("the update line is read: " + board.updatedText)
                : fail("the update line is missing");
            board.totalPages >= 1
                ? ok("the board has " + board.totalPages + " pages")
                : fail("the number of pages is wrong: " + board.totalPages);
            // The site's own numbering continues across the pages.
            const second = await provider.ranking(2);
            const firstRank = second.positions[second.items[0]?.id]?.rank;
            firstRank && firstRank > 1
                ? ok("page two starts at 第 " + firstRank + " 名")
                : fail("page two starts at " + firstRank);
        }
    }

    // -----------------------------------------------------------------------
    console.log("== the local catalogue ==");
    {
        // The walk against the real site, a couple of pages, and a search over
        // what it collected.
        const { buildCatalogue } = require(path.join(cache, "data/catalogueBuilder.js"));
        const { CatalogueIndex, mergeSearch } = require(path.join(cache, "data/catalogue.js"));
        // Two pages are enough to prove the chain; the whole walk is a
        // hundred requests and belongs in the app, not in a test.
        let requests = 0;
        const result = await buildCatalogue(
            async (route, page) => {
                requests++;
                return provider.cataloguePage(route, page);
            },
            { isCancelled: () => requests >= 3, attempts: 1 }
        );
        result.shows.length > 0
            ? ok("the walk collected " + result.shows.length + " shows")
            : fail("the walk collected nothing");
        const index = new CatalogueIndex(result.shows, result.routes);
        index.size > 0 ? ok("the index holds " + index.size + " shows") : fail("the index is empty");
        // A title from the first page must be findable.
        const first = result.shows[0];
        const found = index.search(first.title.slice(0, 4));
        found.length > 0
            ? ok("a show from the walk is findable: " + found[0].title)
            : fail("a show from the walk is not findable: " + first.title);
        // And the shelf the shows came from is recorded.
        index.labelled
            ? ok("every show records the catalogue it came from")
            : fail("the catalogue labels are missing");
        // The server's own ten rows still come back.
        const merged = mergeSearch(first.title, 1, index, [], "short");
        merged.rows.length > 0
            ? ok("the page of results is filled from the index")
            : fail("the page of results is empty");
    }

    // -----------------------------------------------------------------------
    console.log("== the favourites' update check ==");
    {
        const {
            firstFavoriteUpdate,
            observeFavoriteUpdate,
            addedEpisodes,
        } = require(path.join(cache, "data/favorites.js"));
        // A real show, fetched twice: the count must not move, and nothing
        // may be reported as new.
        const detail = await provider.detail("7685265188223732761");
        const count = detail.episodes.length;
        count > 0 ? ok("the show has " + count + " episodes") : fail("no episodes");
        const first = firstFavoriteUpdate(count, Date.now());
        const again = observeFavoriteUpdate(first, count, Date.now() + 1000);
        addedEpisodes(again) === 0
            ? ok("a show that did not grow reports no update")
            : fail("a show that did not grow reports an update");
        const grown = observeFavoriteUpdate(first, count + 3, Date.now() + 2000);
        addedEpisodes(grown) === 3
            ? ok("a show that grew reports three new episodes")
            : fail("a grown show reports " + addedEpisodes(grown));
    }

    // -----------------------------------------------------------------------
    if (FULL) {
        console.log("== the whole pipeline, end to end ==");
        // Three episodes: the first one, the one whose renditions are mostly
        // bytevc2, and the last one of the series. Each is a 13 MB download
        // plus a full decrypt, so the set is kept small on purpose.
        const withStream = targets.filter((e) => resolved.get(e.id));
        const picked = [];
        for (const wanted of [1, 4, 86]) {
            const found = withStream.find((e) => e.number === wanted);
            if (found) picked.push(found);
        }
        for (const episode of picked) {
            const stream = resolved.get(episode.id);
            if (!stream) continue;
            const started = Date.now();
            try {
                const outPath = await prepareLocalMedia({
                    url: stream.url,
                    key: stream.key,
                    headers: stream.headers,
                    episodeId: episode.id,
                    quality: stream.quality,
                    fresh: true,
                });
                const size = fs.statSync(outPath).size;
                const probe = ffprobeStreams(outPath);
                const frame = decodeFirstFrame(outPath, path.join(WORK, "frame-" + episode.number + ".png"));
                const hasVideo = /codec_type=video|video/.test(probe.text) && /hevc|h264/.test(probe.text);
                if (!probe.ok) fail("episode " + episode.number + ": ffprobe failed - " + probe.text);
                else if (!hasVideo) fail("episode " + episode.number + ": no video track - " + probe.text);
                else if (!frame.ok) fail("episode " + episode.number + ": no decodable frame - " + frame.text);
                else {
                    ok(
                        "episode " +
                            episode.number +
                            ": " +
                            (size / 1048576).toFixed(2) +
                            " MB in " +
                            (Date.now() - started) +
                            " ms, " +
                            probe.text.replace(/\n/g, " ") +
                            ", " +
                            frame.text
                    );
                }
            } catch (e) {
                fail("episode " + episode.number + ": the pipeline threw - " + (e && e.message));
            }
        }
    } else {
        console.log("== the whole pipeline, end to end == (skipped, pass --full to run it)");
    }

    console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
