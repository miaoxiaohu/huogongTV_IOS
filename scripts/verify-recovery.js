#!/usr/bin/env node
/**
 * The automatic playback recovery.
 *
 * The TV app puts a failed playback back on its feet on its own: three
 * attempts, with the delay growing between them, and the watching position
 * kept. This checks the timing and the budget without a screen - the
 * controller takes its timers from the outside, so a fake clock can drive it.
 */
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const ROOT = path.join(__dirname, "..");
const cache = transpile("recovery-verify");
stubNativeModules(cache);
const {
    RecoveryBudget,
    RecoveryController,
    formatClock,
    isRetryable,
    PERMANENT_FAILURES,
} = require(path.join(cache, "data/recovery.js"));
const errors = require(path.join(cache, "data/errors.js"));

let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};
const eq = (got, want, m) =>
    got === want ? ok(m + " (" + JSON.stringify(got) + ")") : fail(m + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

/** A clock the test drives by hand. */
function fakeClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    return {
        setTimer: (fn, ms) => {
            const id = nextId++;
            timers.set(id, { fn, at: now + ms });
            return id;
        },
        clearTimer: (id) => {
            timers.delete(id);
        },
        advance: (ms) => {
            now += ms;
            const due = [...timers.entries()].filter(([, t]) => t.at <= now);
            for (const [id, t] of due) {
                timers.delete(id);
                t.fn();
            }
        },
        now: () => now,
        pending: () => timers.size,
    };
}

function makeController() {
    const clock = fakeClock();
    const state = { retries: 0, notes: [], armed: false };
    const controller = new RecoveryController({
        onRetry: () => {
            state.retries++;
        },
        onNote: (note) => {
            state.notes.push(note);
        },
        onState: (armed) => {
            state.armed = armed;
        },
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
    });
    return { clock, state, controller };
}

console.log("== the budget ==");
{
    const budget = new RecoveryBudget();
    eq(budget.attempts, 0, "a fresh budget has no attempts");
    eq(budget.remaining, true, "a fresh budget has room");
    eq(budget.delayMillis, 1000, "the first wait is one second");
    budget.consume();
    eq(budget.delayMillis, 2500, "the second wait is two and a half seconds");
    budget.consume();
    eq(budget.delayMillis, 5000, "the third wait is five seconds");
    budget.consume();
    eq(budget.remaining, false, "the budget is used up after three attempts");
    eq(budget.delayMillis, null, "there is no fourth wait");
    eq(budget.consume(), false, "a fourth attempt is refused");
    budget.reset();
    eq(budget.attempts, 0, "a reset budget starts over");
    eq(budget.remaining, true, "a reset budget has room again");
}

console.log("== which failures are worth retrying ==");
{
    eq(isRetryable("播放接口暂不可用"), true, "a player that is having a moment is worth retrying");
    eq(isRetryable("Network request failed"), true, "a dropped connection is worth retrying");
    eq(isRetryable("视频内容为空"), true, "an empty download is worth retrying");
    eq(isRetryable(""), false, "an empty message is not worth retrying");
    for (const message of PERMANENT_FAILURES) {
        eq(isRetryable(message), false, "a per-episode fact is not retried: " + message);
    }
    eq(PERMANENT_FAILURES.includes(errors.NO_PUBLIC_SOURCE), true, "the no-public-source message is in the list");
    eq(PERMANENT_FAILURES.includes(errors.NO_USABLE_QUALITY), true, "the no-quality message is in the list");
}

console.log("== the clock format ==");
{
    eq(formatClock(0), "0:00", "zero");
    eq(formatClock(9), "0:09", "seconds are padded");
    eq(formatClock(61), "1:01", "a minute and a second");
    eq(formatClock(3600), "60:00", "an hour is sixty minutes");
    eq(formatClock(-5), "0:00", "a negative position is zero");
}

console.log("== a retryable failure is retried on its own ==");
{
    const { clock, state, controller } = makeController();
    controller.fail("播放接口暂不可用", 65);
    eq(state.armed, true, "the recovery is armed");
    eq(clock.pending(), 1, "one timer is pending");
    eq(
        state.notes[state.notes.length - 1],
        "准备恢复播放 · 1 秒后重试 1/3 · 1:05",
        "the user is told when the next attempt is due"
    );
    clock.advance(999);
    eq(state.retries, 0, "nothing happens before the delay is over");
    clock.advance(1);
    eq(state.retries, 1, "the first attempt fires after one second");
    eq(controller.attempts, 1, "the budget counted it");
}

console.log("== the delay grows and the budget runs out ==");
{
    const { clock, state, controller } = makeController();
    controller.fail("播放接口暂不可用", 0);
    clock.advance(1000);
    eq(state.retries, 1, "the first attempt");
    controller.fail("播放接口暂不可用", 0);
    clock.advance(2500);
    eq(state.retries, 2, "the second attempt waits two and a half seconds");
    controller.fail("播放接口暂不可用", 0);
    clock.advance(5000);
    eq(state.retries, 3, "the third attempt waits five seconds");
    controller.fail("播放接口暂不可用", 0);
    eq(state.retries, 3, "a fourth attempt never happens");
    eq(
        state.notes[state.notes.length - 1],
        "已自动重试 3 次，仍无法播放。可手动重试或切换清晰度。",
        "the user is told the retries ran out"
    );
    eq(state.armed, false, "the recovery is disarmed once the budget is gone");
}

console.log("== a failure that means the episode has no video is not retried ==");
{
    const { clock, state, controller } = makeController();
    controller.fail(errors.NO_PUBLIC_SOURCE, 0);
    eq(clock.pending(), 0, "no timer is pending");
    eq(state.armed, false, "the recovery is not armed");
    clock.advance(10000);
    eq(state.retries, 0, "nothing is retried");
}

console.log("== only one timer is pending at a time ==");
{
    const { clock, state, controller } = makeController();
    controller.fail("播放接口暂不可用", 0);
    controller.fail("播放接口暂不可用", 0);
    controller.fail("播放接口暂不可用", 0);
    eq(clock.pending(), 1, "there is still only one timer");
    clock.advance(1000);
    eq(state.retries, 1, "one retry, not three");
}

console.log("== a retry the user asked for starts the budget over ==");
{
    const { clock, state, controller } = makeController();
    controller.fail("播放接口暂不可用", 0);
    clock.advance(1000);
    controller.fail("播放接口暂不可用", 0);
    clock.advance(2500);
    eq(state.retries, 2, "two attempts so far");
    controller.manual();
    eq(controller.attempts, 0, "the budget is back to the start");
    eq(clock.pending(), 0, "the pending timer is gone");
    controller.fail("播放接口暂不可用", 0);
    clock.advance(1000);
    eq(state.retries, 3, "the next attempt waits one second again");
}

console.log("== stopping the automatic retries ==");
{
    const { clock, state, controller } = makeController();
    controller.fail("播放接口暂不可用", 0);
    controller.cancel();
    eq(clock.pending(), 0, "the pending timer is gone");
    eq(state.armed, false, "the recovery is disarmed");
    clock.advance(10000);
    eq(state.retries, 0, "nothing fires any more");
    eq(
        state.notes[state.notes.length - 1],
        "自动重试已停止，观看位置已保留。",
        "the user is told the retries stopped"
    );
}

console.log("== coming back to the app tries again ==");
{
    const { clock, state, controller } = makeController();
    controller.fail("播放接口暂不可用", 0);
    controller.poke(0);
    eq(clock.pending(), 1, "the timer is still the only one");
    clock.advance(1000);
    eq(state.retries, 1, "the retry happens");
    eq(state.armed, false, "the recovery is disarmed while the attempt runs");
    // A poke while an attempt is under way must not double it.
    controller.poke(0);
    clock.advance(5000);
    eq(state.retries, 1, "a poke during an attempt does nothing");
    // A failure arms it again.
    controller.fail("播放接口暂不可用", 0);
    eq(state.armed, true, "a new failure arms the recovery again");
    clock.advance(2499);
    eq(state.retries, 1, "the second attempt waits two and a half seconds");
    clock.advance(1);
    eq(state.retries, 2, "and the next attempt happens");
}

console.log("== a new attempt clears the note but keeps the budget ==");
{
    const { clock, state, controller } = makeController();
    controller.fail("播放接口暂不可用", 0);
    clock.advance(1000);
    eq(controller.attempts, 1, "one attempt so far");
    controller.begin();
    eq(controller.attempts, 1, "the budget survived the new attempt");
    eq(state.notes[state.notes.length - 1], "", "the note is cleared");
}

console.log("== a new episode starts over ==");
{
    const { clock, state, controller } = makeController();
    controller.fail("播放接口暂不可用", 0);
    clock.advance(1000);
    controller.reset();
    eq(controller.attempts, 0, "the budget is back to the start");
    eq(clock.pending(), 0, "no timer is left over");
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
