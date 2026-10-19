#!/usr/bin/env node
/**
 * Runs every offline verification suite in one go.
 *
 * "Offline" means: no network, no ffmpeg, no device. These suites have to
 * pass on every commit, so they belong in CI.
 *
 * The suites that need the real server are not here - they live in
 * `verify-live.js` and are run by hand with `npm run check:live`.
 */
const { execFileSync } = require("child_process");
const path = require("path");

const SUITES = [
    ["signer", "verify-signer.js"],
    ["crypto", "verify-crypto.js"],
    ["base64", "verify-base64.js"],
    ["media crypto", "verify-mediacrypto.js"],
    ["cenc units", "verify-cenc-unit.js"],
    ["api retry", "verify-api-retry.js"],
    ["playback recovery", "verify-recovery.js"],
    ["domain and storage", "verify-domain.js"],
    ["seasons", "verify-seasons.js"],
    ["hot board", "verify-rank.js"],
    ["playback settings", "verify-playback.js"],
];

let failed = 0;
for (const [label, file] of SUITES) {
    console.log("\n=== " + label + " (" + file + ") ===");
    try {
        execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
    } catch (error) {
        failed++;
        console.error("=== " + label + " FAILED ===");
    }
}

console.log("");
if (failed) {
    console.error(failed + " of " + SUITES.length + " suites failed");
    process.exit(1);
}
console.log("all " + SUITES.length + " suites passed");
