#!/usr/bin/env node
/**
 * Noticing when a favourite grows.
 *
 * The site does not say "this show has three new episodes" - the only sign
 * is that the episode count went up. The seen count is a high-water mark, so
 * a catalogue that shrinks for a while is not read as a new update.
 *
 * Checked against a transliteration of the Kotlin `FavoriteUpdate`.
 */
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const cache = transpile("favorites-verify");
stubNativeModules(cache);
const {
    addedEpisodes,
    firstFavoriteUpdate,
    observeFavoriteUpdate,
    shouldCheck,
} = require(path.join(cache, "data/favorites.js"));

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
function kotlinAdded(update) {
    return Math.max(0, update.total - update.seen);
}
function kotlinFirst(count, now) {
    if (count <= 0) throw new Error("out of range");
    return { total: count, seen: count, checkedAt: now };
}
function kotlinObserve(update, count, now, acknowledge = false) {
    if (count <= 0) throw new Error("out of range");
    if (now < update.checkedAt) return update;
    return {
        total: count,
        seen: acknowledge ? Math.max(update.seen, count) : update.seen,
        checkedAt: now,
    };
}

console.log("== the first look ==");
{
    const first = firstFavoriteUpdate(86, 1000);
    eq(first, { total: 86, seen: 86, checkedAt: 1000 }, "the first look remembers the count");
    eq(addedEpisodes(first), 0, "and nothing is new yet");
    let threw = false;
    try {
        firstFavoriteUpdate(0, 1000);
    } catch (e) {
        threw = true;
    }
    threw ? ok("a count of zero is refused") : fail("a count of zero was accepted");
}

console.log("== the show grew ==");
{
    const first = firstFavoriteUpdate(86, 1000);
    const later = observeFavoriteUpdate(first, 89, 2000);
    eq(later.total, 89, "the count is the new one");
    eq(later.seen, 86, "the mark stays where it was");
    eq(addedEpisodes(later), 3, "and three episodes are new");
    eq(later.checkedAt, 2000, "the time of the check is kept");
}

console.log("== the user has seen them ==");
{
    const first = firstFavoriteUpdate(86, 1000);
    const grown = observeFavoriteUpdate(first, 89, 2000);
    const acknowledged = observeFavoriteUpdate(grown, 89, 3000, true);
    eq(acknowledged.seen, 89, "the mark moves up to the count");
    eq(addedEpisodes(acknowledged), 0, "and nothing is new any more");
    // The mark only goes up.
    const smaller = observeFavoriteUpdate(acknowledged, 80, 4000, true);
    eq(smaller.seen, 89, "a catalogue that shrank does not move the mark");
    eq(addedEpisodes(smaller), 0, "and it is not a new update");
}

console.log("== a clock that went backwards ==");
{
    const first = firstFavoriteUpdate(86, 5000);
    const back = observeFavoriteUpdate(first, 89, 1000);
    eq(back, first, "the record is left alone");
    eq(addedEpisodes(back), 0, "so nothing is reported");
}

console.log("== the same thing against the Kotlin ==");
{
    const states = [
        { total: 86, seen: 86, checkedAt: 1000 },
        { total: 89, seen: 86, checkedAt: 2000 },
        { total: 89, seen: 89, checkedAt: 3000 },
    ];
    let mismatches = 0;
    for (const state of states) {
        for (const count of [80, 86, 89, 95]) {
            for (const now of [500, 1000, 2000, 3000]) {
                for (const acknowledge of [true, false]) {
                    const got = observeFavoriteUpdate(state, count, now, acknowledge);
                    const want = kotlinObserve(state, count, now, acknowledge);
                    if (JSON.stringify(got) !== JSON.stringify(want)) mismatches++;
                    if (addedEpisodes(got) !== kotlinAdded(want)) mismatches++;
                }
            }
        }
    }
    eq(mismatches, 0, "every case agrees with the Kotlin");
}

console.log("== how often a show is looked at ==");
{
    const now = 10_000_000;
    eq(shouldCheck(undefined, now), true, "a show that was never looked at");
    const fresh = { total: 86, seen: 86, checkedAt: now };
    eq(shouldCheck(fresh, now), false, "one that was just looked at");
    eq(shouldCheck(fresh, now + 3599_999), false, "one that was looked at an hour ago");
    eq(shouldCheck(fresh, now + 3600_000), true, "one that was looked at an hour and a bit ago");
    eq(shouldCheck(fresh, now, true), true, "a forced check looks at everything");
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
