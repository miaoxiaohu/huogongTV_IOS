#!/usr/bin/env node
/**
 * The player has to be usable with a finger.
 *
 * The TV app is driven by a remote: the back key walks out of a screen, the
 * down key opens the panel of choices, the left and right keys seek. A phone
 * has none of those, so the same things have to be on the screen - and if
 * they are not, the app is a dead end: the user walks into the player and
 * cannot get out of it.
 *
 * The player is rendered here with a small React stand-in, so the buttons
 * that a finger can reach are checked rather than hoped for.
 */
const path = require("path");
const fs = require("fs");
const { ROOT, transpile, stubNativeModules } = require("./transpile");

const cache = transpile("player-ui-verify");
stubNativeModules(cache);
const shim = require("./fixtures/react-shim");
shim.reset();
shim.install(cache);

const { Player } = require(path.join(cache, "ui/Player.js"));

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

const detail = {
    id: "1",
    title: "测试剧",
    cover: "",
    description: "",
    badge: "全86集",
    tags: "都市",
    episodes: [
        { id: "7000000000000000001", number: 1, title: "第 1 集" },
        { id: "7000000000000000002", number: 2, title: "第 2 集" },
    ],
};

// A provider that answers with a file, the way the real one does once the
// episode has been downloaded and decrypted.
const provider = {
    resolve: async () => ({
        uri: "file:///tmp/hongguotv/play-1-1080P.mp4",
        headers: {},
        quality: "1080P",
    }),
    home: async () => [],
    search: async () => [],
    detail: async () => detail,
};

/** Lets the promises the player starts settle. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

let exits = 0;
let saved = 0;
const element = shim.jsx(Player, {
    detail,
    initialIndex: 0,
    initialPosition: 0,
    provider,
    onExit: () => {
        exits++;
    },
    onProgress: () => {
        saved++;
    },
    maxQuality: 1080,
    playbackSpeed: 1,
    frameMode: "fit",
    autoNext: true,
});

const labels = (tree) => shim.buttons(tree).map((b) => b.props.accessibilityLabel);

(async () => {
console.log("== there is a way out of the player ==");
{
    const tree = shim.render(element);
    const found = labels(tree);
    ok("the buttons on the screen: " + JSON.stringify(found));
    eq(found.includes("返回"), true, "a finger can get back out of the player");
    const back = shim.buttons(tree).find((b) => b.props.accessibilityLabel === "返回");
    if (!back) {
        fail("there is no 返回 button to press");
    } else {
        back.props.onPress();
        eq(exits, 1, "pressing it leaves the player");
        eq(saved, 1, "and the watching position is saved on the way out");
    }
}

console.log("== the panel of choices can be opened without a remote ==");
{
    const tree = shim.render(element);
    const found = labels(tree);
    eq(found.includes("更多"), true, "there is a button that opens the panel");
    const more = shim.buttons(tree).find((b) => b.props.accessibilityLabel === "更多");
    if (!more) {
        fail("there is no 更多 button to press");
    } else {
        more.props.onPress();
        const after = labels(shim.rerender());
        eq(
            after.includes("播放设置"),
            true,
            "and the panel opens with the settings in it"
        );
        eq(after.includes("上一集"), true, "and the episode before this one");
        eq(after.includes("下一集"), true, "and the episode after this one");
        eq(after.includes("返回选集"), true, "and the way back to the episode list");
    }
}

console.log("== playback can be paused with a finger ==");
{
    const tree = shim.render(element);
    const found = labels(tree);
    eq(
        found.includes("暂停") || found.includes("继续播放"),
        true,
        "there is a button that pauses and resumes"
    );
}

console.log("== the progress bar can be touched ==");
{
    // The video tells how long it is, so the bar knows what a tap means.
    await tick();
    shim.rerender();
    const tree = shim.render(element);
    const track = tree.find((e) => e.props && e.props.hitSlop);
    if (!track) {
        fail("the progress bar is not a control");
    } else {
        track.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
        track.props.onPress({ nativeEvent: { locationX: 100 } });
        const after = shim.rerender();
        const texts = after
            .filter((e) => e.type && e.type.$$host === "Text")
            .flatMap((e) =>
                Array.isArray(e.props.children)
                    ? e.props.children
                    : [e.props.children]
            )
            .filter((t) => typeof t === "string");
        eq(
            texts.some((t) => t.indexOf("0:50") >= 0),
            true,
            "the tap moved the position to where it was tapped"
        );
    }
}

console.log("== there is a way back out of the detail page ==");
{
    // The app itself cannot be drawn here - it talks to the network as soon
    // as it is rendered - so this one is read in the source. The TV app walks
    // back with the remote's back key; a phone has no such key, so the
    // detail page has to offer the way back itself.
    const source = fs.readFileSync(path.join(ROOT, "App.tsx"), "utf8");
    const button = /label="返回"[\s\S]{0,240}onPress=\{closeDetail\}/.test(source);
    eq(button, true, "the detail page has a button that goes back to the list");
    eq(
        source.includes("返回键回到列表"),
        false,
        "and it does not tell the user to press a key the phone does not have"
    );
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
})();
