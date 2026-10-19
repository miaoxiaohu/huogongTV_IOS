#!/usr/bin/env node
/**
 * The playback preferences: the speed, the frame mode and the sleep timer.
 *
 * The timer is checked against a transliteration of the Kotlin `SleepTimer`,
 * because it decides when the playback stops, and the speed and the frame
 * mode are checked against `PlaybackSpeed` and `VideoFrameMode`.
 */
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const cache = transpile("playback-verify");
stubNativeModules(cache);
const {
    PLAYBACK_SPEEDS,
    FRAME_MODES,
    SleepTimer,
    frameModeInfo,
    normalizeFrameMode,
    normalizeSpeed,
    speedLabel,
} = require(path.join(cache, "data/playback.js"));

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
const KOTLIN_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
function kotlinNormalizeSpeed(value) {
    return KOTLIN_SPEEDS.includes(value) ? value : 1;
}
function kotlinSpeedLabel(value) {
    const speed = kotlinNormalizeSpeed(value);
    return `${String(speed).replace(/\.0$/, "")}×`;
}
class KotlinSleepTimer {
    constructor(now) {
        this.now = now;
        this.deadline = null;
        this.episodesLeft = 0;
    }
    get active() {
        return this.deadline !== null || this.episodesLeft > 0;
    }
    cancel() {
        this.deadline = null;
        this.episodesLeft = 0;
    }
    afterMinutes(minutes) {
        if (!(minutes >= 1 && minutes <= 180)) throw new Error("out of range");
        this.cancel();
        this.deadline = this.now() + minutes * 60000;
    }
    afterEpisodes(count) {
        if (!(count >= 1 && count <= 10)) throw new Error("out of range");
        this.cancel();
        this.episodesLeft = count;
    }
    remainingMillis() {
        return this.deadline === null ? null : Math.max(0, this.deadline - this.now());
    }
    poll() {
        if (this.deadline === null || !(this.now() >= this.deadline)) return false;
        this.cancel();
        return true;
    }
    episodeEnded() {
        if (this.poll()) return true;
        if (this.episodesLeft <= 0) return false;
        this.episodesLeft--;
        return this.episodesLeft === 0;
    }
    label() {
        const left = this.remainingMillis();
        if (left !== null) return `${Math.floor((left + 59999) / 60000)} 分钟后`;
        if (this.episodesLeft > 0) return `再播完 ${this.episodesLeft} 集`;
        return "关闭";
    }
}

console.log("== the speed ==");
{
    eq(PLAYBACK_SPEEDS, [0.75, 1, 1.25, 1.5, 1.75, 2], "the speeds on offer");
    eq(speedLabel(1), "1×", "the normal speed");
    eq(speedLabel(1.25), "1.25×", "a fractional speed");
    eq(speedLabel(0.75), "0.75×", "the slowest speed");
    eq(speedLabel(2), "2×", "the fastest speed");
    eq(normalizeSpeed(1.5), 1.5, "a speed that is on the list");
    eq(normalizeSpeed(1.1), 1, "a speed that is not on the list");
    eq(normalizeSpeed(0), 1, "zero is not a speed");
    eq(normalizeSpeed("x"), 1, "nonsense is not a speed");
    eq(normalizeSpeed(undefined), 1, "nothing is not a speed");
}

console.log("== the same thing against the Kotlin ==");
{
    let mismatches = 0;
    for (const value of [0.75, 1, 1.25, 1.5, 1.75, 2, 0, 1.1, -1, null]) {
        if (normalizeSpeed(value) !== kotlinNormalizeSpeed(value)) mismatches++;
        if (speedLabel(value) !== kotlinSpeedLabel(value)) mismatches++;
    }
    eq(mismatches, 0, "every speed agrees with the Kotlin");
}

console.log("== the frame mode ==");
{
    eq(
        FRAME_MODES.map((entry) => entry.label),
        ["完整画面", "等比铺满", "拉伸铺满"],
        "the three modes"
    );
    eq(frameModeInfo("fit").resizeMode, "contain", "完整画面 keeps everything");
    eq(frameModeInfo("zoom").resizeMode, "cover", "等比铺满 crops");
    eq(frameModeInfo("fill").resizeMode, "stretch", "拉伸铺满 changes the ratio");
    eq(normalizeFrameMode("zoom"), "zoom", "a mode that is on the list");
    eq(normalizeFrameMode("nonsense"), "fit", "a mode that is not on the list");
    eq(normalizeFrameMode(undefined), "fit", "no mode at all");
    eq(frameModeInfo("fit").hint, "保留比例与全部内容", "the hint");
}

console.log("== the sleep timer ==");
{
    let now = 1000;
    const clock = () => now;
    const timer = new SleepTimer(clock);
    const kotlin = new KotlinSleepTimer(clock);

    eq(timer.active, false, "a fresh timer is not running");
    eq(timer.label(), "关闭", "a fresh timer says 关闭");
    eq(timer.label(), kotlin.label(), "the label agrees with the Kotlin");

    timer.afterMinutes(15);
    kotlin.afterMinutes(15);
    eq(timer.active, true, "the timer is running");
    eq(timer.label(), "15 分钟后", "the label counts the minutes");
    eq(timer.label(), kotlin.label(), "the label agrees with the Kotlin");

    now += 14 * 60000;
    eq(timer.poll(), false, "it does not fire before the time is up");
    eq(timer.poll(), kotlin.poll(), "the poll agrees with the Kotlin");
    now += 60000;
    eq(timer.poll(), true, "it fires when the time is up");
    eq(timer.active, false, "and it stops itself");
    eq(timer.label(), "关闭", "the label goes back to 关闭");

    timer.afterEpisodes(3);
    kotlin.afterEpisodes(3);
    eq(timer.label(), "再播完 3 集", "the label counts the episodes");
    eq(timer.label(), kotlin.label(), "the label agrees with the Kotlin");
    // Every call is made on both, once, and the answers are compared.
    const first = timer.episodeEnded();
    const firstKotlin = kotlin.episodeEnded();
    eq(first, false, "the first episode is not the last one");
    eq(first, firstKotlin, "it agrees with the Kotlin");
    const second = timer.episodeEnded();
    const secondKotlin = kotlin.episodeEnded();
    eq(second, false, "the second one is not either");
    eq(second, secondKotlin, "it agrees with the Kotlin");
    const third = timer.episodeEnded();
    const thirdKotlin = kotlin.episodeEnded();
    eq(third, true, "the third one is the last one");
    eq(third, thirdKotlin, "it agrees with the Kotlin");
    eq(timer.active, false, "the timer is done");
}

console.log("== the sleep timer against the Kotlin ==");
{
    // The same script is run on both, and every answer is compared.
    let mismatches = 0;
    const script = [
        (timer, kotlin, advance) => {
            timer.afterMinutes(30);
            kotlin.afterMinutes(30);
            advance(10 * 60000);
        },
        (timer, kotlin) => {
            const a = timer.poll();
            const b = kotlin.poll();
            if (a !== b) mismatches++;
        },
        (timer, kotlin) => {
            timer.afterEpisodes(2);
            kotlin.afterEpisodes(2);
        },
        (timer, kotlin) => {
            const a = timer.episodeEnded();
            const b = kotlin.episodeEnded();
            if (a !== b) mismatches++;
        },
        (timer, kotlin) => {
            const a = timer.episodeEnded();
            const b = kotlin.episodeEnded();
            if (a !== b) mismatches++;
        },
    ];
    let now = 500000;
    const timer = new SleepTimer(() => now);
    const kotlin = new KotlinSleepTimer(() => now);
    const advance = (ms) => {
        now += ms;
    };
    for (const step of script) {
        step(timer, kotlin, advance);
        if (timer.label() !== kotlin.label()) {
            mismatches++;
            console.error("    " + timer.label() + " vs " + kotlin.label());
        }
        if (timer.active !== kotlin.active) {
            mismatches++;
            console.error("    active differs");
        }
    }
    eq(mismatches, 0, "the timer behaves like the Kotlin");
}

console.log("== the timer refuses the impossible ==");
{
    const timer = new SleepTimer(() => 0);
    for (const bad of [0, -1, 181]) {
        let threw = false;
        try {
            timer.afterMinutes(bad);
        } catch (e) {
            threw = true;
        }
        threw ? ok("rejected " + bad + " minutes") : fail("accepted " + bad + " minutes");
    }
    for (const bad of [0, -1, 11]) {
        let threw = false;
        try {
            timer.afterEpisodes(bad);
        } catch (e) {
            threw = true;
        }
        threw ? ok("rejected " + bad + " episodes") : fail("accepted " + bad + " episodes");
    }
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
