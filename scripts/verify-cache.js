#!/usr/bin/env node
/**
 * The media cache cannot grow without a limit.
 *
 * The app has to write every episode to a file, because AVPlayer cannot read
 * an encrypted stream and cannot decrypt one either. One file per episode
 * watched is over a gigabyte for a whole series, so the cache is pruned.
 *
 * The file that is being played is never deleted: a file that disappears
 * under the player is a broken playback.
 */
const fs = require("fs");
const path = require("path");
const { transpile, mockModule } = require("./transpile");

const ROOT = path.join(__dirname, "..");
const WORK = path.join(ROOT, "node_modules", ".cache", "cache-verify");
const DIR = path.join(WORK, "hongguotv");
fs.mkdirSync(DIR, { recursive: true });

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

// The file system mock, backed by a real directory.
const mockPath = path.join(WORK, "file_access_mock.js");
const { installFileSystemMock } = require("./fixtures/fs-mock");
installFileSystemMock(mockPath, DIR);
mockModule("react-native-file-access", mockPath);

const cache = transpile("cache-verify");
const { pruneMediaCache, MEDIA_CACHE_BYTES, MEDIA_CACHE_FILES } = require(
    path.join(cache, "data/media.js")
);

/** Writes a file of a given size, with a given age. */
function write(name, size, ageMinutes) {
    const full = path.join(DIR, name);
    fs.writeFileSync(full, Buffer.alloc(size, 1));
    const when = Date.now() - ageMinutes * 60000;
    fs.utimesSync(full, when / 1000, when / 1000);
    return full;
}

function clear() {
    for (const name of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) {
        fs.unlinkSync(path.join(DIR, name));
    }
}

(async () => {
    console.log("== the limits ==");
    {
        eq(MEDIA_CACHE_BYTES, 256 * 1024 * 1024, "the cache may hold 256 MB");
        eq(MEDIA_CACHE_FILES, 16, "and sixteen episodes");
    }

    console.log("== a small cache is left alone ==");
    {
        clear();
        write("play-a.mp4", 1024 * 1024, 1);
        write("play-b.mp4", 1024 * 1024, 2);
        const deleted = await pruneMediaCache(DIR);
        eq(deleted, 0, "nothing was deleted");
        eq(fs.readdirSync(DIR).length, 2, "both files are still there");
    }

    console.log("== the oldest files go first ==");
    {
        clear();
        for (let i = 0; i < 20; i++) {
            write(`play-${i}.mp4`, 1024 * 1024, 20 - i);
        }
        const deleted = await pruneMediaCache(DIR);
        eq(deleted, 4, "the four oldest were deleted");
        const left = fs.readdirSync(DIR).sort();
        eq(left.length, 16, "sixteen files are left");
        eq(left.includes("play-0.mp4"), false, "the oldest one is gone");
        eq(left.includes("play-19.mp4"), true, "the newest one is still there");
    }

    console.log("== the size limit counts too ==");
    {
        clear();
        // Five files of 60 MB each: the fifth pushes the total over 256 MB.
        for (let i = 0; i < 5; i++) {
            write(`play-${i}.mp4`, 60 * 1024 * 1024, 5 - i);
        }
        const deleted = await pruneMediaCache(DIR);
        eq(deleted, 1, "the file that pushed the cache over the limit went");
        eq(fs.readdirSync(DIR).length, 4, "the rest are still there");
    }

    console.log("== the file being played is never deleted ==");
    {
        clear();
        const playing = write("play-playing.mp4", 1024 * 1024, 30);
        for (let i = 0; i < 20; i++) {
            write(`play-${i}.mp4`, 1024 * 1024, 20 - i);
        }
        const deleted = await pruneMediaCache(DIR, [playing]);
        eq(fs.existsSync(playing), true, "the file that is playing is still there");
        eq(deleted, 4, "the four oldest were deleted instead");
    }

    console.log("== other files in the directory are not touched ==");
    {
        clear();
        write("play-a.mp4", 1024 * 1024, 1);
        write("raw-a.mp4", 1024 * 1024, 1);
        write("play-a.mp4.part", 1024 * 1024, 1);
        write("notes.txt", 1024, 1);
        const deleted = await pruneMediaCache(DIR);
        eq(deleted, 0, "nothing was deleted");
        eq(fs.readdirSync(DIR).length, 4, "everything is still there");
    }

    console.log("== a directory that does not exist is not a failure ==");
    {
        const deleted = await pruneMediaCache(path.join(WORK, "nope"));
        eq(deleted, 0, "nothing was deleted and nothing threw");
    }

    console.log(failures ? "\nFAILED (" + failures + ")" : "\nALL PASS");
    process.exit(failures ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
