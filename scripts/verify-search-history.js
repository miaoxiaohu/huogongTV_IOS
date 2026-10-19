#!/usr/bin/env node
/**
 * The searches the user made.
 *
 * The same word means different things in the two shelves, so a search is
 * remembered together with the shelf it was made in. The history is bounded,
 * deduplicated and survives a restart.
 *
 * The cases are the Kotlin's own, one by one.
 */
const path = require("path");
const { transpile, stubNativeModules } = require("./transpile");

const cache = transpile("search-history-verify");
stubNativeModules(cache);
const {
    rememberSearch,
    readSearches,
    SEARCH_HISTORY_LIMIT,
} = require(path.join(cache, "data/searchHistory.js"));

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

console.log("== the history is bounded, deduplicated and keeps the shelves apart ==");
{
    let rows = [];
    for (let i = 0; i < 30; i++) {
        rows = rememberSearch(rows, "词" + i, "comic");
    }
    eq(rows.length, 20, "twenty searches are kept");
    eq(rows[0].query, "词29", "the newest one is first");
    rows = rememberSearch(rows, " 词15 ", "comic");
    eq(rows[0].query, "词15", "the spaces are trimmed");
    eq(rows.filter((r) => r.query === "词15").length, 1, "and it is not kept twice");
    rows = rememberSearch(rows, "词15", "short");
    eq(rows.filter((r) => r.query === "词15").length, 2, "the same word in the other shelf is another search");
    eq(rows[0].type, "short", "and the newest one is first");
    eq(rows, readSearches(rows), "what is remembered is what is read back");
    eq(rows, rememberSearch(rows, " ", "comic"), "a blank search is not remembered");
    eq(
        rows,
        rememberSearch(rows, "x".repeat(81), "comic"),
        "and neither is a very long one"
    );
    eq(SEARCH_HISTORY_LIMIT, 20, "the limit is twenty");
}

console.log("== a history that cannot be read ==");
{
    eq(readSearches(undefined), [], "nothing at all");
    eq(readSearches("not a list"), [], "something that is not a list");
    eq(readSearches([null]), [], "a broken entry");
    eq(
        readSearches([
            null,
            { query: "", type: "comic" },
            { query: "a", type: "unknown" },
            { query: "a", type: "comic" },
            { query: "a", type: "comic" },
        ]),
        [{ query: "a", type: "comic" }],
        "the entries that cannot be read are dropped and the rest is kept"
    );
    eq(
        readSearches([{ query: "x".repeat(81), type: "comic" }]),
        [],
        "a query that is too long is dropped"
    );
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
