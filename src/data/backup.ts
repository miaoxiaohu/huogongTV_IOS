/**
 * Backing the local records up and putting them back.
 *
 * The TV app hands its records to a phone over a local server and gets them
 * back. On a phone the same thing is a file: the records are written into
 * the app's documents directory, which the user can put on Files or an iCloud
 * drive, and a file that is put back is read and merged.
 *
 * The format is the TV app's, so one backup works on both: the same keys,
 * the same limits and the same rules about what a merge means.
 *
 * Ported from kotlin-tv/core/.../LibraryBackup.kt.
 */
import { Library, Progress, Series, Settings } from "../domain/model";
import { readSearches } from "./searchHistory";

/** The largest backup that is accepted. */
export const BACKUP_MAX_BYTES = 2 * 1024 * 1024;
/** The format marker and version. */
export const BACKUP_FORMAT = "hongguotv.library";
export const BACKUP_VERSION = 1;

/** One watching record, as it travels. */
export type BackupProgress = {
  series: Series;
  episodeId: string;
  episodeIndex: number;
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: number;
};

/** The settings that travel with the records. The token stays on the device. */
export type BackupSettings = {
  quality: number;
  speed: number;
  autoNext: boolean;
  type: "short" | "comic";
  frame: "fit" | "zoom" | "fill";
};

export type BackupData = {
  favorites: Series[];
  history: BackupProgress[];
  watched: string[];
  searches: { query: string; type: "short" | "comic" }[];
  settings: BackupSettings;
  later: Series[];
  hidden: string[];
};

const ID = /^[0-9]{1,30}$/;

function cleanText(value: unknown, max: number): string {
    const text = typeof value === "string" ? value : "";
    return text
        .split("")
        .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
        .join("")
        .slice(0, max);
}

/** A cover url is only kept when it is a plain https one. */
function cleanCover(value: unknown): string {
    const text = typeof value === "string" ? value : "";
    if (!text || text.length > 2048) return "";
    if (!text.startsWith("https://")) return "";
    if (text.indexOf("@") >= 0) return "";
    const rest = text.substring("https://".length);
    const host = rest.split("/")[0];
    if (!host || host.indexOf(":") >= 0) return "";
    if (/^[0-9.]+$/.test(host)) return "";
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".lan")) {
        return "";
    }
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) < 32 || text.charCodeAt(i) === 127) return "";
    }
    return text;
}

function seriesJson(series: Series) {
    return {
        id: series.id,
        title: cleanText(series.title, 200),
        cover: cleanCover(series.cover),
        description: "",
        badge: cleanText(series.badge, 100),
        tags: cleanText(series.tags, 200),
    };
}

/** Encodes the records into the text that travels. */
export function encodeBackup(
    library: Library,
    settings: Settings,
    now: number
): string {
    const history: BackupProgress[] = Object.values(library.progress).map((p) => ({
        series: p.series,
        episodeId: p.episodeId,
        episodeIndex: Math.max(0, (p.episodeNumber || 1) - 1),
        position: p.position || 0,
        duration: p.duration || 0,
        completed: !!p.completed,
        updatedAt: p.updatedAt || 0,
    }));
    const retained = new Set(
        library.favorites
            .map((s) => s.id)
            .concat(history.map((p) => p.series.id))
    );
    const payload = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: now,
        later: library.later.map(seriesJson),
        favorites: library.favorites.map(seriesJson),
        history: history.map((p) => ({
            series: seriesJson(p.series),
            episodeId: p.episodeId,
            episodeIndex: p.episodeIndex,
            position: p.position,
            duration: p.duration,
            completed: p.completed,
            updatedAt: p.updatedAt,
        })),
        watched: library.watched.filter((id) => retained.has(id)).slice(0, 500),
        hidden: library.hidden.slice(0, 500),
        searches: library.searches
            .slice(0, 20)
            .map((s) => ({ query: cleanText(s.query, 80), type: s.type })),
        settings: {
            quality: settings.maxQuality ?? 540,
            speed: settings.playbackSpeed ?? 1,
            autoNext: settings.autoNext ?? true,
            type: settings.category === "comic" ? "comic" : "short",
            frame: settings.frameMode ?? "fit",
        },
    };
    const text = JSON.stringify(payload);
    if (text.length > BACKUP_MAX_BYTES) throw new Error("备份超过 2 MB 限制");
    return text;
}

function numberField(value: any, max: number, name: string): number {
    if (typeof value !== "number" || !isFinite(value)) {
        throw new Error(`${name}无效`);
    }
    if (value < 0 || value > max) throw new Error(`${name}超出范围`);
    return Math.trunc(value);
}

function textField(value: any, max: number, name: string): string {
    if (typeof value !== "string" || value.length > max) {
        throw new Error(`${name}无效`);
    }
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 32 || code === 127) throw new Error(`${name}无效`);
    }
    return value;
}

function idField(value: any): string {
    const text = textField(value, 30, "剧集标识无效");
    if (!ID.test(text)) throw new Error("剧集标识无效");
    return text;
}

function seriesOf(value: any): Series {
    const id = idField(value.id);
    const title = textField(value.title, 200, "剧名无效");
    if (!title.trim()) throw new Error("剧名无效");
    return {
        id,
        title,
        cover: cleanCover(value.cover),
        description: "",
        badge: textField(value.badge, 100, "标签无效"),
        tags: textField(value.tags, 200, "分类无效"),
    };
}

/** Reads a backup back. A backup that cannot be read is refused. */
export function decodeBackup(text: string): BackupData {
    if (!text || text.length > BACKUP_MAX_BYTES) {
        throw new Error("备份超过 2 MB 限制");
    }
    const data = JSON.parse(text);
    if (
        !data ||
        data.format !== BACKUP_FORMAT ||
        data.version !== BACKUP_VERSION
    ) {
        throw new Error("不支持的备份格式或版本");
    }
    const rows = (key: string, max: number): any[] => {
        const array = data[key];
        if (!Array.isArray(array) || array.length > max) {
            throw new Error("记录数量超过上限");
        }
        return array;
    };
    const later = rows("later", 100).map(seriesOf);
    if (new Set(later.map((s) => s.id)).size !== later.length) {
        throw new Error("稍后看包含重复剧集");
    }
    const favorites = rows("favorites", 500).map(seriesOf);
    const history: BackupProgress[] = rows("history", 200).map((row) => {
        const duration = numberField(row.duration, 604800000, "时长无效");
        const position = numberField(row.position, 604800000, "进度无效");
        if (typeof row.completed !== "boolean") throw new Error("完成标记无效");
        return {
            series: seriesOf(row.series),
            episodeId: idField(row.episodeId),
            episodeIndex: numberField(row.episodeIndex, 100000, "集数无效"),
            position: duration > 0 ? Math.min(position, duration) : position,
            duration,
            completed: row.completed,
            updatedAt: numberField(row.updatedAt, 4102444800000, "时间无效"),
        };
    });
    if (
        new Set(favorites.map((s) => s.id)).size !== favorites.length ||
        new Set(history.map((p) => p.series.id)).size !== history.length
    ) {
        throw new Error("备份包含重复剧集");
    }
    const watched = rows("watched", 500).map((value) => idField(value));
    const hidden = data.hidden
        ? rows("hidden", 500).map((value) => idField(value))
        : [];
    const searches = readSearches(rows("searches", 20));
    const raw = data.settings;
    if (!raw || typeof raw !== "object") throw new Error("设置无效");
    const quality = numberField(raw.quality, 1080, "清晰度无效");
    if (![360, 540, 720, 1080].includes(quality)) {
        throw new Error("清晰度无效");
    }
    if (typeof raw.speed !== "number" || !isFinite(raw.speed)) {
        throw new Error("倍速无效");
    }
    if (typeof raw.autoNext !== "boolean") throw new Error("自动连播无效");
    if (raw.type !== "short" && raw.type !== "comic") throw new Error("分类无效");
    if (raw.frame !== "fit" && raw.frame !== "zoom" && raw.frame !== "fill") {
        throw new Error("画面模式无效");
    }
    return {
        favorites,
        history,
        watched,
        searches,
        later,
        hidden,
        settings: {
            quality,
            speed: raw.speed,
            autoNext: raw.autoNext,
            type: raw.type,
            frame: raw.frame,
        },
    };
}

/**
 * Puts a backup together with what is already on the device.
 *
 * The favourites that are already here stay first, and only a record that is
 * newer replaces one that is older - so restoring an old backup does not
 * throw away a position the user has moved on from.
 *
 * The settings are not part of this: they are restored by the caller, and
 * only when the user says so. The TV app's `merge` carries the settings
 * inside the merged data, so it can decide there.
 */
export function mergeBackup(local: Library, incoming: BackupData): Library {
    const favorites = local.favorites
        .concat(incoming.favorites)
        .filter(
            (row, index, all) =>
                all.findIndex((other) => other.id === row.id) === index
        )
        .slice(0, 500);

    const records = new Map<string, Progress>();
    for (const p of Object.values(local.progress)) records.set(p.series.id, p);
    const watched = new Set(local.watched);
    for (const candidate of incoming.history) {
        const id = candidate.series.id;
        const prior = records.get(id);
        if (!prior || candidate.updatedAt > prior.updatedAt) {
            records.set(id, {
                series: candidate.series,
                episodeId: candidate.episodeId,
                episodeNumber: candidate.episodeIndex + 1,
                position: candidate.position,
                duration: candidate.duration,
                completed: candidate.completed,
                updatedAt: candidate.updatedAt,
            });
            if (incoming.watched.includes(id)) watched.add(id);
            else watched.delete(id);
        }
    }
    for (const id of incoming.watched) {
        if (!records.has(id) && !local.favorites.some((s) => s.id === id)) {
            watched.add(id);
        }
    }
    const history = Array.from(records.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 200);
    const retained = new Set(
        favorites.map((s) => s.id).concat(history.map((p) => p.series.id))
    );
    const progress: Record<string, Progress> = {};
    for (const p of history) progress[p.series.id] = p;

    const later = local.later
        .concat(incoming.later)
        .filter(
            (row, index, all) =>
                all.findIndex((other) => other.id === row.id) === index
        )
        .slice(0, 100);

    const searches = local.searches
        .concat(incoming.searches)
        .filter(
            (row, index, all) =>
                all.findIndex(
                    (other) =>
                        other.query === row.query && other.type === row.type
                ) === index
        )
        .slice(0, 20);

    return {
        favorites,
        progress,
        favoriteUpdates: local.favoriteUpdates,
        searches,
        later,
        watched: Array.from(watched)
            .filter((id) => retained.has(id))
            .slice(0, 500),
        hidden: Array.from(new Set(local.hidden.concat(incoming.hidden))).slice(
            -500
        ),
    };
}

/**
 * What a backup holds, in words.
 *
 * The user is shown this before the records are put back, so the numbers are
 * the ones from the backup itself and not from the device - otherwise the
 * preview would describe the wrong thing.
 */
export function describeBackup(data: BackupData): string {
    const counts = `备份含 ${data.favorites.length} 部收藏、${data.history.length} 条观看记录、${data.searches.length} 条搜索、${data.later.length} 部稍后看、${data.hidden.length} 部已隐藏推荐。`;
    const rules =
        "收藏合并，观看位置以较新的记录为准；已有收藏优先保留（最多 500 部），历史保留最近 200 条。";
    return `${counts}\n\n${rules}`;
}

/** The settings a backup carries, in the shape the app stores them. */
export function settingsFromBackup(
    settings: BackupSettings
): Partial<Settings> {
    return {
        maxQuality: settings.quality,
        playbackSpeed: settings.speed,
        autoNext: settings.autoNext,
        category: settings.type,
        frameMode: settings.frame,
    };
}
