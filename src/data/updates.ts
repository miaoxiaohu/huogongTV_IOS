/**
 * Checking whether there is a newer build.
 *
 * The TV app publishes every build as a GitHub release with a small manifest
 * next to it, and the app reads that manifest to find out whether the build
 * on the device is the newest one. The same thing works here, with the same
 * manifest shape, so the two apps understand each other's releases.
 *
 * The app's own version is read out of its Info.plist rather than written
 * down twice: the manifest and the bundle have to agree, and the bundle is
 * the one that is really installed.
 *
 * Ported from kotlin-tv/core/.../AppUpdates.kt.
 */
import { Platform } from "react-native";
import { Dirs, FileSystem } from "react-native-file-access";

/** Where the releases of this app live. */
export const RELEASES = "https://github.com/miaoxiaohu/huogongTV_IOS/releases";
/** The manifest of the newest release. */
export const MANIFEST_URL = `${RELEASES}/latest/download/update.json`;
/** The app this manifest belongs to. */
export const PACKAGE_NAME = "org.reactjs.native.example.HongguoTV";
/** The largest manifest that is accepted. */
export const MANIFEST_MAX_BYTES = 65536;

export type AppUpdate = {
    /** The build number, the thing that is compared. */
    versionCode: number;
    /** The version the user sees, e.g. "1.0". */
    versionName: string;
    /** The tag of the release. */
    tag: string;
    /** The name of the ipa in the release. */
    fileName: string;
    /** How big it is, so a truncated download is noticed. */
    size: number;
    /** Its sha256, so a wrong file is noticed. */
    sha256: string;
    /** What the release says about it. */
    notes: string;
    /** Where to get it. */
    downloadUrl: string;
};

const ID = /^[0-9]{1,30}$/;

function numberField(value: any, max: number, name: string): number {
    if (typeof value !== "number" || !isFinite(value)) {
        throw new Error(`${name}无效`);
    }
    if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new Error(`${name}超出范围`);
    }
    return value;
}

function textField(value: any, max: number, name: string): string {
    if (typeof value !== "string" || !value || value.length > max) {
        throw new Error(`${name}无效`);
    }
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 32 || code === 127) throw new Error(`${name}无效`);
    }
    return value;
}

/** Reads a manifest. A manifest that cannot be read is refused. */
export function parseUpdateManifest(text: string): AppUpdate {
    if (!text || text.length > MANIFEST_MAX_BYTES) {
        throw new Error("更新信息过大");
    }
    const data = JSON.parse(text);
    if (!data || data.schema !== 1) throw new Error("更新信息格式不正确");
    if (data.packageName !== PACKAGE_NAME) throw new Error("更新信息不匹配");
    const versionCode = numberField(data.versionCode, 1000000, "版本号无效");
    const versionName = textField(data.versionName, 64, "版本名无效");
    const tag = textField(data.tag, 80, "发布标记无效");
    if (!/^ios-v[0-9][0-9A-Za-z.+-]{0,60}$/.test(tag)) {
        throw new Error("发布标记无效");
    }
    const ipa = data.ipa;
    if (!ipa || typeof ipa !== "object") throw new Error("安装包信息无效");
    const fileName = textField(ipa.name, 120, "安装包名无效");
    if (!/^hongguotv-ios-[0-9][0-9A-Za-z.+-]{0,60}\.ipa$/.test(fileName)) {
        throw new Error("安装包名无效");
    }
    const size = numberField(ipa.size, 200 * 1024 * 1024, "安装包大小无效");
    if (size < 1) throw new Error("安装包大小无效");
    const sha256 = textField(ipa.sha256, 64, "校验值无效").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("校验值无效");
    return {
        versionCode,
        versionName,
        tag,
        fileName,
        size,
        sha256,
        notes: typeof data.notes === "string" ? data.notes.slice(0, 1500) : "",
        downloadUrl: `${RELEASES}/download/${tag}/${fileName}`,
    };
}

/** The version and build of the app that is installed. */
export async function readInstalledVersion(): Promise<{
    version: string;
    build: number;
}> {
    const fallback = { version: "0", build: 0 };
    try {
        const plist = await FileSystem.readFile(
            `${Dirs.MainBundleDir}/Info.plist`,
            "utf8"
        );
        const value = (key: string): string => {
            const match = new RegExp(
                `<key>${key}</key>\\s*<string>([^<]*)</string>`
            ).exec(plist);
            return match ? match[1] : "";
        };
        const build = Number(value("CFBundleVersion"));
        return {
            version: value("CFBundleShortVersionString") || "0",
            build: Number.isInteger(build) && build >= 0 ? build : 0,
        };
    } catch {
        return fallback;
    }
}

/**
 * Asks for the newest release.
 *
 * Only GitHub's own hosts are followed, never a host the manifest names.
 */
export async function checkForUpdate(): Promise<AppUpdate> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const response = await fetch(MANIFEST_URL, {
            headers: { "User-Agent": "HongguoTV-Updater", "Cache-Control": "no-cache" },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(
                response.status === 404
                    ? "尚无可用的自动更新版本"
                    : "无法检查更新，请稍后重试"
            );
        }
        const text = await response.text();
        if (!text) throw new Error("更新信息为空");
        return parseUpdateManifest(text);
    } catch (error) {
        if (error instanceof Error && error.message) throw error;
        throw new Error("无法检查更新，请稍后重试");
    } finally {
        clearTimeout(timer);
    }
}

/** Whether a release is newer than what is installed. */
export function isNewer(update: AppUpdate, installedBuild: number): boolean {
    return update.versionCode > installedBuild;
}

/** The page the user opens to get the new build. */
export function releasePage(tag: string): string {
    return `${RELEASES}/tag/${tag}`;
}

/** The device's iOS version, for the minimum the build needs. */
export function deviceVersion(): string {
    return String(Platform.Version);
}
