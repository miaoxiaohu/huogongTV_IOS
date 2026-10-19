/**
 * Shared helper for the verification scripts.
 *
 * Transpiles src/ with the exact React Native Babel preset Metro uses, so a
 * parse error fails here instead of on the iOS build, and stubs the native
 * modules that only exist inside a real app.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const babel = require("@babel/core");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

function walk(dir) {
    const files = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) files.push(...walk(p));
        else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
    return files;
}

/**
 * Transpiles src/ into node_modules/.cache/<name> and returns that directory.
 * The output is plain CommonJS so Node can require it directly.
 */
function transpile(name) {
    const out = path.join(ROOT, "node_modules", ".cache", name);
    fs.mkdirSync(out, { recursive: true });
    for (const file of walk(SRC)) {
        const code = babel.transformFileSync(file, {
            presets: ["module:@react-native/babel-preset"],
            filename: file,
            babelrc: false,
            configFile: false,
        }).code;
        const rel = path.relative(SRC, file).replace(/\.tsx?$/, ".js");
        const dest = path.join(out, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, code, "utf8");
    }
    return out;
}

/**
 * Replaces a module with a stub file. The media pipeline writes the
 * decrypted video through `react-native-file-access`, and it cannot run
 * outside an app - but the code that talks to it still has to load.
 */
function mockModule(request, mockPath) {
    const original = Module._resolveFilename;
    Module._resolveFilename = function (req, ...args) {
        if (req === request) return mockPath;
        return original.call(this, req, ...args);
    };
    return mockPath;
}

/** A do-nothing stand-in for the native file system. */
function stubNativeModules(cache) {
    const mock = path.join(cache, "__native_file_access_mock.js");
    fs.writeFileSync(
        mock,
        `module.exports = {
  Dirs: { CacheDir: "/tmp/hongguotv", DocumentDir: "/tmp/hongguotv" },
  FileSystem: {
    mkdir: async () => "/tmp/hongguotv",
    exists: async () => false,
    stat: async () => ({ size: 0, filename: "", path: "", type: "file", lastModified: 0 }),
    fetch: async () => ({ ok: false, status: 0, statusText: "", url: "", headers: {}, redirected: false, getHeader: () => undefined }),
    readFileChunk: async () => "",
    readFile: async () => "",
    writeFile: async () => {},
    appendFile: async () => {},
    cp: async () => {},
    mv: async () => {},
    unlink: async () => {},
  },
};
`,
        "utf8"
    );
    return mockModule("react-native-file-access", mock);
}

module.exports = { ROOT, SRC, transpile, stubNativeModules, mockModule };
