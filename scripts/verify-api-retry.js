#!/usr/bin/env node
/**
 * The signed player answers HTTP 200 with a zero-byte body every so often.
 *
 * That is documented in the Kotlin app as well, and it is real: measured on
 * 2026-10-19, one request in a batch came back empty. The app has to survive
 * it, because the public fallback only hosts the first three episodes of a
 * series - an empty answer would otherwise cost the user the whole episode.
 *
 * This test drives `ApiProvider` with a mocked `fetch`, so the behaviour is
 * pinned down without depending on the server's mood:
 *
 *   - an empty body is retried, and the retry succeeds,
 *   - every attempt signs with a fresh device identity,
 *   - when every attempt comes back empty, the failure is reported,
 *   - an HTTP error status is a real answer and is NOT retried,
 *   - the public fallback survives one broken probe.
 */
const fs = require("fs");
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const ROOT = path.join(__dirname, "..");
const fixture = require("./fixtures/media.json");
const VIDEO_API = "https://api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/";
const EPISODE = "7694655440692448281";

// One real rendition, straight out of the captured fixture.
const sample = fixture.find((f) => f.episodeId === EPISODE && f.definition === "540p");
if (!sample) {
    console.error("the fixture has no 540p entry for " + EPISODE);
    process.exit(1);
}

const FALLBACK_URL = "https://example.invalid/stream.json";
const PUBLIC_URL = "https://hongguoduanju.com/video/public/" + EPISODE + "/360p.mp4";

let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};

const cache = transpile("api-retry");
stubNativeModules(cache);
const { ApiProvider } = require(path.join(cache, "data/api.js"));

/**
 * A mock server whose behaviour the test controls.
 *
 *   videoModel:  queue of answers for the signed POST, each either
 *                {body: "..."} or {status: 500} or {throw: true}
 *   publicProbe: queue of answers for the public MP4 probe
 */
function installMock(server) {
    global.fetch = async (url, options) => {
        server.calls.push({ url: String(url), options });
        if (String(url).startsWith(VIDEO_API)) {
            const answer = server.videoModel.shift() || { body: "{}" };
            if (answer.throw) throw new Error("socket hang up");
            return new Response(answer.body, {
                status: answer.status || 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (String(url) === FALLBACK_URL) {
            const answer = server.fallback.shift() || { body: fallbackJson() };
            if (answer.throw) throw new Error("socket hang up");
            return new Response(answer.body, { status: answer.status || 200 });
        }
        if (String(url) === PUBLIC_URL) {
            const answer = server.publicProbe.shift() || { status: 404 };
            if (answer.throw) throw new Error("socket hang up");
            return new Response("x", { status: answer.status || 200 });
        }
        throw new Error("the mock server has no route for " + url);
    };
}

function videoModelJson() {
    return JSON.stringify({
        code: 0,
        data: { video_model: JSON.stringify({ fallback_api: FALLBACK_URL }) },
    });
}

function fallbackJson() {
    return JSON.stringify({
        video_info: {
            data: {
                key_seed: sample.key_seed,
                video_list: {
                    "540p": {
                        main_url: sample.main_url,
                        codec_type: sample.codec,
                        definition: "540p",
                        spade_a: sample.spade_a,
                    },
                },
            },
        },
    });
}

function deviceIdOf(call) {
    const query = String(call.url).split("?")[1] || "";
    const match = query.match(/[?&]device_id=([^&]+)/);
    return match ? match[1] : null;
}

(async () => {
    // -----------------------------------------------------------------------
    console.log("== an empty answer is retried ==");
    {
        const server = { videoModel: [{ body: "" }, { body: "" }, { body: videoModelJson() }], fallback: [], publicProbe: [], calls: [] };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        try {
            const stream = await provider.resolveStream(EPISODE);
            server.videoModel.length === 0
                ? ok("the third attempt answered and the stream resolved")
                : fail("the stream resolved but the queue still had " + server.videoModel.length + " answers");
            if (stream.quality !== "540P") fail("quality was " + stream.quality + ", expected 540P");
            else ok("the resolved stream is the 540p rendition");
            if (!stream.key || stream.key.length !== 16) fail("the content key is not 16 bytes");
            else ok("the content key is 16 bytes");
        } catch (e) {
            fail("resolveStream threw: " + (e && e.message));
        }
        const signedCalls = server.calls.filter((c) => c.url.startsWith(VIDEO_API));
        signedCalls.length === 3
            ? ok("the signed endpoint was called " + signedCalls.length + " times")
            : fail("the signed endpoint was called " + signedCalls.length + " times, expected 3");
    }

    // -----------------------------------------------------------------------
    console.log("== every attempt uses a fresh device identity ==");
    {
        const server = { videoModel: [{ body: "" }, { body: "" }, { body: videoModelJson() }], fallback: [], publicProbe: [], calls: [] };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        await provider.resolveStream(EPISODE);
        const ids = server.calls.filter((c) => c.url.startsWith(VIDEO_API)).map(deviceIdOf);
        if (ids.some((id) => id === null)) fail("a signed request carried no device_id");
        else if (new Set(ids).size !== ids.length) {
            fail("the attempts reused a device identity: " + ids.join(", "));
        } else {
            ok("the three attempts used three different device ids");
        }
    }

    // -----------------------------------------------------------------------
    console.log("== when every answer is empty, the failure is reported ==");
    {
        const server = { videoModel: [{ body: "" }, { body: "" }, { body: "" }], fallback: [], publicProbe: [], calls: [] };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        let threw = false;
        try {
            await provider.resolveStream(EPISODE);
        } catch (e) {
            threw = true;
        }
        threw ? ok("resolveStream rejected instead of returning a broken stream") : fail("resolveStream did not throw");
        const signedCalls = server.calls.filter((c) => c.url.startsWith(VIDEO_API));
        signedCalls.length === 3
            ? ok("it gave up after three attempts")
            : fail("it made " + signedCalls.length + " attempts, expected 3");
    }

    // -----------------------------------------------------------------------
    console.log("== the failure the user sees is a sentence, not a stack ==");
    {
        const server = { videoModel: [{ body: "<html>oops</html>" }, { body: "" }, { body: "" }], fallback: [], publicProbe: [], calls: [] };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        let message = "";
        try {
            await provider.resolveStream(EPISODE);
        } catch (e) {
            message = String(e && e.message);
        }
        message === "播放接口暂不可用"
            ? ok("the message is 播放接口暂不可用")
            : fail("the message was " + JSON.stringify(message));
    }

    // -----------------------------------------------------------------------
    console.log("== a 4xx is a real answer and is not retried ==");
    {
        const server = { videoModel: [{ status: 403 }], fallback: [], publicProbe: [], calls: [] };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        let message = "";
        try {
            await provider.resolveStream(EPISODE);
        } catch (e) {
            message = String(e && e.message);
        }
        const signedCalls = server.calls.filter((c) => c.url.startsWith(VIDEO_API));
        signedCalls.length === 1
            ? ok("a 403 was not retried")
            : fail("a 403 was retried " + signedCalls.length + " times");
        message === "播放接口暂不可用"
            ? ok("the message is 播放接口暂不可用")
            : fail("the message was " + JSON.stringify(message));
    }

    // -----------------------------------------------------------------------
    console.log("== a 5xx is the server having a bad moment, so it is retried ==");
    {
        const server = { videoModel: [{ status: 500 }, { status: 500 }, { body: videoModelJson() }], fallback: [], publicProbe: [], calls: [] };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        let threw = false;
        try {
            await provider.resolveStream(EPISODE);
        } catch (e) {
            threw = true;
        }
        threw ? fail("the 500s were not retried") : ok("the third attempt answered after two 500s");
        const signedCalls = server.calls.filter((c) => c.url.startsWith(VIDEO_API));
        signedCalls.length === 3
            ? ok("the signed endpoint was called " + signedCalls.length + " times")
            : fail("the signed endpoint was called " + signedCalls.length + " times, expected 3");
    }

    // -----------------------------------------------------------------------
    console.log("== a body that is not JSON is treated as a broken answer ==");
    {
        const server = { videoModel: [{ body: "<html>oops</html>" }, { body: videoModelJson() }], fallback: [], publicProbe: [], calls: [] };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        let threw = false;
        try {
            await provider.resolveStream(EPISODE);
        } catch (e) {
            threw = true;
        }
        threw ? fail("a broken body was accepted") : ok("a broken body was retried and the second answer was used");
    }

    // -----------------------------------------------------------------------
    console.log("== the permanent verdict survives the fallback ==");
    {
        // The signed player has no stream and the public one has none either:
        // that is a fact about the episode, and the recovery must not spend
        // its budget on it.
        const server = {
            videoModel: [{ body: "" }, { body: "" }, { body: "" }],
            fallback: [],
            publicProbe: [{ status: 404 }],
            calls: [],
        };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        let message = "";
        try {
            await provider.resolve(EPISODE);
        } catch (e) {
            message = String(e && e.message);
        }
        message === "该剧集暂无公开播放资源"
            ? ok("the message is 该剧集暂无公开播放资源")
            : fail("the message was " + JSON.stringify(message));
    }

    // -----------------------------------------------------------------------
    console.log("== the public fallback survives one broken probe ==");
    {
        const server = {
            videoModel: [{ body: "" }, { body: "" }, { body: "" }],
            fallback: [],
            publicProbe: [{ throw: true }, { status: 206 }],
            calls: [],
        };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        let playback = null;
        let failure = null;
        try {
            playback = await provider.resolve(EPISODE);
        } catch (e) {
            failure = e;
        }
        if (!playback) {
            fail("the episode did not resolve: " + (failure && failure.message));
        } else if (!playback.uri.includes("/video/public/")) {
            fail("the fallback produced " + playback.uri);
        } else {
            ok("the broken probe was retried and the public MP4 was used");
        }
    }

    // -----------------------------------------------------------------------
    console.log("== the public fallback is not retried when it is really gone ==");
    {
        const server = {
            videoModel: [{ body: "" }, { body: "" }, { body: "" }],
            fallback: [],
            publicProbe: [{ status: 404 }],
            calls: [],
        };
        installMock(server);
        const provider = new ApiProvider({ category: "short", maxQuality: 540 });
        let threw = false;
        try {
            await provider.resolve(EPISODE);
        } catch (e) {
            threw = true;
        }
        threw ? ok("the episode reported a failure") : fail("the episode resolved although nothing was there");
        const probes = server.calls.filter((c) => c.url === PUBLIC_URL);
        probes.length === 1
            ? ok("the 404 was not retried")
            : fail("the 404 was probed " + probes.length + " times");
    }

    console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
