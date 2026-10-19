#!/usr/bin/env node
/**
 * Parses every source file with the exact React Native Babel preset Metro
 * uses.
 *
 * A parse error in any source file would otherwise only surface as a failed
 * `xcodebuild`, eight minutes later, with a stack trace that points at Metro
 * rather than at the file that is actually broken. This runs in a second.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const ROOT = path.join(__dirname, "..");

const files = [];
const walk = (target) => {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
        for (const name of fs.readdirSync(target)) {
            walk(path.join(target, name));
        }
    } else if (/\.tsx?$/.test(target)) {
        files.push(target);
    }
};
walk(path.join(ROOT, "App.tsx"));
walk(path.join(ROOT, "src"));

let failed = 0;
for (const file of files) {
    try {
        babel.transformFileSync(file, {
            presets: ["module:@react-native/babel-preset"],
            filename: file,
            babelrc: false,
            configFile: false,
        });
    } catch (e) {
        failed++;
        console.error("FAIL " + path.relative(ROOT, file) + ": " + e.message);
    }
}

console.log(
    failed
        ? failed + " of " + files.length + " files failed to parse"
        : files.length + " files parse cleanly"
);
process.exit(failed ? 1 : 0);
