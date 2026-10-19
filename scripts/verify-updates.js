#!/usr/bin/env node
/**
 * Checking whether there is a newer build.
 *
 * The manifest is read out of a release, and the app compares it with the
 * build that is installed. A manifest that cannot be read is refused rather
 * than half-believed.
 *
 * The rules are the TV app's, and the manifest shape is the same, so the two
 * apps understand each other's releases.
 */
const fs = require("fs");
const path = require("path");
const { transpile, stubNativeModules, mockModule } = require("./transpile");

const WORK = path.join(__dirname, "..", "node_modules", ".cache", "updates-verify");
fs.mkdirSync(WORK, { recursive: true });
// react-native is Flow source and cannot be loaded outside an app.
const rnMock = path.join(WORK, "react_native_mock.js");
fs.writeFileSync(
    rnMock,
    "module.exports = { Platform: { Version: '17.0', OS: 'ios' } };",
    "utf8"
);
mockModule("react-native", rnMock);

const cache = transpile("updates-verify");
stubNativeModules(cache);
const {
    parseUpdateManifest,
    isNewer,
    releasePage,
    MANIFEST_URL,
    PACKAGE_NAME,
} = require(path.join(cache, "data/updates.js"));

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

const manifest = (over) =>
    JSON.stringify({
        schema: 1,
        packageName: PACKAGE_NAME,
        versionCode: 2,
        versionName: "1.0",
        tag: "ios-v1.0",
        ipa: {
            name: "hongguotv-ios-1.0.ipa",
            size: 4851186,
            sha256: "a".repeat(64),
        },
        notes: "红果 TV iOS 版",
        ...over,
    });

console.log("== a good manifest ==");
{
    const update = parseUpdateManifest(manifest());
    eq(update.versionCode, 2, "the build number");
    eq(update.versionName, "1.0", "the version");
    eq(update.tag, "ios-v1.0", "the tag");
    eq(update.fileName, "hongguotv-ios-1.0.ipa", "the file name");
    eq(update.size, 4851186, "the size");
    eq(update.sha256, "a".repeat(64), "the checksum");
    eq(update.notes, "红果 TV iOS 版", "the notes");
    eq(
        update.downloadUrl,
        "https://github.com/miaoxiaohu/huogongTV_IOS/releases/download/ios-v1.0/hongguotv-ios-1.0.ipa",
        "where to get it"
    );
    eq(
        releasePage("ios-v1.0"),
        "https://github.com/miaoxiaohu/huogongTV_IOS/releases/tag/ios-v1.0",
        "the release page"
    );
    eq(
        MANIFEST_URL,
        "https://github.com/miaoxiaohu/huogongTV_IOS/releases/latest/download/update.json",
        "the manifest is read from the newest release"
    );
}

console.log("== a manifest that cannot be read is refused ==");
{
    const cases = [
        ["not json", "不是 json"],
        [manifest({ schema: 2 }), "不支持的版本"],
        [manifest({ packageName: "com.other.app" }), "别的应用"],
        [manifest({ versionCode: "two" }), "版本号不是数字"],
        [manifest({ versionCode: -1 }), "版本号是负数"],
        [manifest({ versionName: "" }), "版本名为空"],
        [manifest({ tag: "v1.0" }), "发布标记不对"],
        [manifest({ tag: "" }), "发布标记为空"],
        [manifest({ ipa: { name: "evil.exe", size: 1, sha256: "a".repeat(64) } }), "安装包名不对"],
        [manifest({ ipa: { name: "hongguotv-ios-1.0.ipa", size: 0, sha256: "a".repeat(64) } }), "安装包大小为 0"],
        [manifest({ ipa: { name: "hongguotv-ios-1.0.ipa", size: 10, sha256: "zz" } }), "校验值不对"],
        [manifest({ ipa: undefined }), "没有安装包信息"],
    ];
    for (const [text, what] of cases) {
        let threw = false;
        try {
            parseUpdateManifest(text);
        } catch (e) {
            threw = true;
        }
        threw ? ok("rejected: " + what) : fail("accepted: " + what);
    }
    let threw = false;
    try {
        parseUpdateManifest("x".repeat(70000));
    } catch (e) {
        threw = true;
    }
    threw ? ok("rejected: too big") : fail("accepted: too big");
}

console.log("== is it newer ==");
{
    const update = parseUpdateManifest(manifest());
    eq(isNewer(update, 1), true, "a newer build");
    eq(isNewer(update, 2), false, "the same build");
    eq(isNewer(update, 3), false, "an older build");
}

console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
process.exit(failures ? 1 : 0);
