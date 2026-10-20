#!/usr/bin/env node
/**
 * The iOS project has to agree with the JavaScript about what the app is
 * called, and the two live in different files.
 *
 * That is not a detail: the native side mounts a root view by name, and the
 * JavaScript registers the app under a name. If the two do not match, the
 * bridge cannot find the component and the app dies on launch - with
 * nothing on the screen to say why. It happened once already:
 * `AppDelegate.swift` asked for "HongguoTVTemp" while `app.json` said
 * "HongguoTV".
 *
 * So the names are checked here, where a change that breaks them fails in a
 * second instead of after an eight minute build and an install.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let failures = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
    failures++;
    console.error("  FAIL " + m);
};
const eq = (got, want, m) =>
    got === want
        ? ok(m + " (" + got + ")")
        : fail(m + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

/** The value of a key in an Info.plist, as a string. */
function plistValue(source, key) {
    const match = source.match(
        new RegExp("<key>" + key + "</key>\\s*<(string|true|false)(/?)>", "m")
    );
    if (!match) return null;
    if (match[1] === "true") return "true";
    if (match[1] === "false") return "false";
    if (match[2] === "/") return "";
    const value = source.match(
        new RegExp("<key>" + key + "</key>\\s*<string>([^<]*)</string>", "m")
    );
    return value ? value[1] : null;
}

console.log("== the native side asks for the app the JavaScript registers ==");
{
    const app = JSON.parse(read("app.json"));
    const delegate = read("ios/HongguoTV/AppDelegate.swift");
    const index = read("index.js");

    const mounted = delegate.match(/withModuleName:\s*"([^"]+)"/);
    if (!mounted) {
        fail("the AppDelegate does not say which module it mounts");
    } else {
        eq(
            mounted[1],
            app.name,
            "the app the AppDelegate mounts is the one app.json names"
        );
    }
    if (!/AppRegistry\.registerComponent\(appName/.test(index)) {
        fail("index.js does not register the app under the name from app.json");
    } else {
        ok("index.js registers the app under the name from app.json");
    }
    // The binary's name and the bundle's name have to be the same as well,
    // or the app is installed under a name nobody can find.
    const project = read("ios/HongguoTV.xcodeproj/project.pbxproj");
    const product = project.match(/PRODUCT_NAME = ([^;]+);/);
    if (!product) {
        fail("the Xcode project does not set PRODUCT_NAME");
    } else {
        eq(product[1].trim(), app.name, "the product is named after app.json");
    }
}

console.log("== the bundle identifier is the one the update check looks for ==");
{
    const project = read("ios/HongguoTV.xcodeproj/project.pbxproj");
    const identifier = project.match(
        /PRODUCT_BUNDLE_IDENTIFIER = "([^"]*)"/
    );
    if (!identifier) {
        fail("the Xcode project does not set PRODUCT_BUNDLE_IDENTIFIER");
    } else {
        // The name is built from PRODUCT_NAME, so it is put together here
        // the way Xcode puts it together. The rfc1034 transform replaces the
        // characters that are not allowed; it does not change the case.
        const product = project.match(/PRODUCT_NAME = ([^;]+);/)[1].trim();
        const resolved = identifier[1].replace(
            "$(PRODUCT_NAME:rfc1034identifier)",
            product.replace(/[^A-Za-z0-9.-]/g, "-")
        );
        const updates = read("src/data/updates.ts");
        const named = updates.match(/PACKAGE_NAME = "([^"]+)"/);
        if (!named) {
            fail("src/data/updates.ts does not name the package it is for");
        } else {
            eq(
                resolved,
                named[1],
                "the app's identifier is the one the update manifest speaks of"
            );
        }
    }
}

console.log("== what the app shows on the home screen ==");
{
    const app = JSON.parse(read("app.json"));
    const info = read("ios/HongguoTV/Info.plist");
    eq(
        plistValue(info, "CFBundleDisplayName"),
        app.displayName,
        "the icon's name is the one app.json gives"
    );
}

console.log("== the backups have to be reachable from the Files app ==");
{
    const info = read("ios/HongguoTV/Info.plist");
    eq(
        plistValue(info, "UIFileSharingEnabled"),
        "true",
        "the documents directory is visible in the Files app"
    );
    eq(
        plistValue(info, "LSSupportsOpeningDocumentsInPlace"),
        "true",
        "and a backup can be put back where it came from"
    );
}

console.log("== the site has to be reachable under the transport rules ==");
{
    const info = read("ios/HongguoTV/Info.plist");
    const arbitrary = plistValue(info, "NSAllowsArbitraryLoads");
    const local = plistValue(info, "NSAllowsLocalNetworking");
    const api = read("src/data/api.ts");
    const site = api.match(/const SITE = "([^"]+)"/);
    if (!site) {
        fail("src/data/api.ts does not say what site it talks to");
    } else if (arbitrary === "false" && !site[1].startsWith("https://")) {
        fail(
            "the site is " +
                site[1] +
                " and plain http is not allowed - the app would not be able to load anything"
        );
    } else {
        ok("the site " + site[1] + " is allowed by the transport rules");
    }
    if (local !== "true") {
        fail("the local network is not allowed, so a self hosted service cannot be reached");
    } else {
        ok("a self hosted service on the local network is allowed");
    }
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
