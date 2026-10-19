/**
 * A `react-native-file-access` stand-in backed by a real directory.
 *
 * The shipping media pipeline writes the decrypted video through the native
 * file system, which cannot run outside an app. The mock keeps the same
 * contract - `readFileChunk` returns base64, `fetch` writes to `init.path`,
 * `appendFile` requires the target to exist - so the code under test is the
 * real code, not a rewritten copy of it.
 */
const fs = require("fs");
const path = require("path");

/**
 * Writes the mock next to the transpiled sources and returns its path.
 * `root` is the directory that plays the role of the app's CacheDir.
 */
function installFileSystemMock(mockPath, root) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
        mockPath,
        `const fs = require("fs");
const path = require("path");
const ROOT = ${JSON.stringify(root)};
const toBuffer = (data, encoding) =>
  Buffer.from(data, encoding === "base64" ? "base64" : "utf8");
module.exports = {
  Dirs: { CacheDir: ROOT, DocumentDir: ROOT },
  FileSystem: {
    mkdir: async (p) => { fs.mkdirSync(p, { recursive: true }); return p; },
    exists: async (p) => fs.existsSync(p),
    stat: async (p) => {
      const s = fs.statSync(p);
      return { size: s.size, filename: path.basename(p), path: p, type: s.isDirectory() ? "directory" : "file", lastModified: s.mtimeMs };
    },
    fetch: async (url, init, onProgress) => {
      const res = await fetch(url, { method: (init && init.method) || "GET", headers: init && init.headers });
      if (!res.ok) {
        return { ok: false, status: res.status, statusText: res.statusText, url, headers: {}, redirected: false, getHeader: () => undefined };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (init && init.path) fs.writeFileSync(init.path, buf);
      if (onProgress) onProgress(buf.length, buf.length, true);
      return { ok: true, status: res.status, statusText: res.statusText, url, headers: {}, redirected: false, getHeader: () => undefined };
    },
    readFileChunk: async (p, offset, length, encoding) => {
      const fd = fs.openSync(p, "r");
      const buf = Buffer.alloc(length);
      const read = fs.readSync(fd, buf, 0, length, offset);
      fs.closeSync(fd);
      const slice = buf.subarray(0, read);
      return encoding === "base64" ? slice.toString("base64") : slice.toString("utf8");
    },
    readFile: async (p, encoding) => fs.readFileSync(p, encoding === "base64" ? "base64" : "utf8"),
    writeFile: async (p, data, encoding) => fs.writeFileSync(p, toBuffer(data, encoding)),
    appendFile: async (p, data, encoding) => fs.appendFileSync(p, toBuffer(data, encoding)),
    cp: async (src, dst) => fs.copyFileSync(src, dst),
    mv: async (src, dst) => fs.renameSync(src, dst),
    unlink: async (p) => { if (fs.existsSync(p)) fs.unlinkSync(p); },
    ls: async (p) => fs.readdirSync(p),
    statDir: async (p) => {
      const out = [];
      for (const name of fs.readdirSync(p)) {
        const full = path.join(p, name);
        const stat = fs.statSync(full);
        out.push({
          filename: name,
          path: full,
          size: stat.size,
          lastModified: stat.mtimeMs,
          type: stat.isDirectory() ? "directory" : "file",
        });
      }
      return out;
    },
  },
};
`,
        "utf8"
    );
    return mockPath;
}

module.exports = { installFileSystemMock };
