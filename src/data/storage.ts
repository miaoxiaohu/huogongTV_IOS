import AsyncStorage from "@react-native-async-storage/async-storage";
import { Library, Progress, Series, Settings } from "../domain/model";
import { normalizeFrameMode, normalizeSpeed } from "./playback";
import { CatalogueRoute, CatalogueSnapshot, emptySnapshot } from "./catalogue";
import { FavoriteUpdate } from "./favorites";
import { readSearches } from "./searchHistory";
const empty: Library = {
  favorites: [],
  progress: {},
  favoriteUpdates: {},
  searches: [],
  later: [],
};
const CATALOGUE_KEY = "catalogue.v1";
/** How many shows the watch later list holds. */
const LATER_LIMIT = 100;
let pending = Promise.resolve();
export async function loadState(): Promise<{
  settings: Settings;
  library: Library;
}> {
  const rows = await AsyncStorage.multiGet(["settings.v1", "library.v1"]);
  // The defaults have to be complete: a settings object without a quality
  // falls back to 540 somewhere else, and the two would drift apart.
  let settings: Settings = {
    baseUrl: "",
    token: "",
    category: "short",
    maxQuality: 540,
    playbackSpeed: 1,
    frameMode: "fit",
    autoNext: true,
  };
  let library = empty;
  try {
    const data = JSON.parse(rows[0][1] || "{}");
    if (typeof data.baseUrl === "string")
      settings = {
        baseUrl: data.baseUrl,
        token: typeof data.token === "string" ? data.token : "",
        category:
          data.category === "short" || data.category === "comic"
            ? data.category
            : "short",
        maxQuality:
          typeof data.maxQuality === "number" && data.maxQuality >= 360
            ? data.maxQuality
            : 540,
        playbackSpeed: normalizeSpeed(data.playbackSpeed),
        frameMode: normalizeFrameMode(data.frameMode),
        autoNext: typeof data.autoNext === "boolean" ? data.autoNext : true,
      };
  } catch {}
  try {
    const data = JSON.parse(rows[1][1] || "{}");
    // Every part is read on its own: one broken field must not throw the
    // others away.
    const progress: Record<string, Progress> = {};
    if (
      data.progress &&
      typeof data.progress === "object" &&
      !Array.isArray(data.progress)
    ) {
      // A record that is not a record would crash the list later, so the
      // ones that cannot be read are dropped instead of carried along.
      for (const [id, value] of Object.entries(data.progress)) {
        const entry = value as Progress;
        if (!entry || typeof entry !== "object") continue;
        if (!entry.series || typeof entry.series.id !== "string") continue;
        if (typeof entry.episodeNumber !== "number") continue;
        if (typeof entry.position !== "number") continue;
        progress[id] = entry;
      }
    }
    library = {
      favorites: readSeries(data.favorites),
      progress,
      favoriteUpdates: readUpdates(data.favoriteUpdates),
      searches: readSearches(data.searches),
      later: readSeries(data.later).slice(0, LATER_LIMIT),
    };
  } catch {}
  return { settings, library };
}
// Serialize disk writes so a delayed progress write cannot overwrite a newer episode.
export function saveLibrary(library: Library) {
  const value = JSON.stringify(library);
  pending = pending
    .catch(() => {})
    .then(() => AsyncStorage.setItem("library.v1", value));
  return pending;
}
export function saveSettings(settings: Settings) {
  return AsyncStorage.setItem("settings.v1", JSON.stringify(settings));
}

/** Reads the favourites' update records, dropping the ones that are broken. */
function readUpdates(value: any): Record<string, FavoriteUpdate> {
  const updates: Record<string, FavoriteUpdate> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return updates;
  for (const [id, raw] of Object.entries(value)) {
    const entry = raw as any;
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.total !== "number" || entry.total <= 0) continue;
    if (typeof entry.seen !== "number" || entry.seen <= 0) continue;
    if (typeof entry.checkedAt !== "number" || entry.checkedAt < 0) continue;
    updates[id] = {
      total: entry.total,
      seen: entry.seen,
      checkedAt: entry.checkedAt,
    };
  }
  return updates;
}

/** Reads a list of shows, dropping the ones that cannot be read. */
function readSeries(value: any): Series[] {
  if (!Array.isArray(value)) return [];
  const rows: Series[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    // The id is what everything hangs on. A show without a title is still
    // worth keeping - the TV app keeps those too - so only the id is
    // required.
    if (typeof raw.id !== "string" || !raw.id) continue;
    if (rows.some((row) => row.id === raw.id)) continue;
    rows.push({
      id: raw.id,
      title: typeof raw.title === "string" ? raw.title : "",
      cover: typeof raw.cover === "string" ? raw.cover : "",
      description: typeof raw.description === "string" ? raw.description : "",
      badge: typeof raw.badge === "string" ? raw.badge : "",
      tags: typeof raw.tags === "string" ? raw.tags : "",
    });
  }
  return rows;
}

/**
 * Reads the catalogue snapshot back.
 *
 * A snapshot that cannot be read is not a corrupt file - the app works
 * without it, the search just falls back to the ten rows the site renders.
 * The rows are checked one by one, because one broken row would otherwise
 * throw while the index is being built.
 */
export async function loadCatalogue(): Promise<CatalogueSnapshot> {
  try {
    const row = await AsyncStorage.getItem(CATALOGUE_KEY);
    if (!row) return emptySnapshot();
    const data = JSON.parse(row);
    if (!Array.isArray(data.entries) || !Array.isArray(data.routes)) {
      return emptySnapshot();
    }
    const entries: Series[] = [];
    const routes: (CatalogueRoute | null)[] = [];
    data.entries.forEach((value: any, position: number) => {
      if (!value || typeof value !== "object") return;
      if (typeof value.id !== "string" || !value.id) return;
      if (typeof value.title !== "string") return;
      entries.push({
        id: value.id,
        title: value.title,
        cover: typeof value.cover === "string" ? value.cover : "",
        description: "",
        badge: typeof value.badge === "string" ? value.badge : "",
        tags: typeof value.tags === "string" ? value.tags : "",
      });
      const route = data.routes[position];
      routes.push(
        route === "real-drama" || route === "comic-drama" || route === "ai-drama"
          ? route
          : null
      );
    });
    return {
      entries,
      routes,
      cursor: data.cursor && typeof data.cursor === "object" ? data.cursor : {},
      done: Array.isArray(data.done) ? data.done : [],
      gaps: Array.isArray(data.gaps) ? data.gaps : [],
      savedAt: typeof data.savedAt === "number" ? data.savedAt : 0,
    };
  } catch {
    return emptySnapshot();
  }
}

/**
 * Writes the catalogue snapshot.
 *
 * Only the five fields a search needs are kept: the rows also carry a full
 * description, and keeping it would push 2400 shows past a megabyte of JSON
 * for text the detail page fetches anyway when it opens. The writes are
 * serialised, so a slow write cannot overwrite a newer one.
 */
export function saveCatalogue(snapshot: CatalogueSnapshot) {
    const value = JSON.stringify({
        entries: snapshot.entries.map((series) => ({
            id: series.id,
            title: series.title,
            cover: series.cover,
            badge: series.badge,
            tags: series.tags,
        })),
        routes: snapshot.routes,
        cursor: snapshot.cursor,
        done: snapshot.done,
        gaps: snapshot.gaps,
        savedAt: snapshot.savedAt,
    });
    pending = pending
        .catch(() => {})
        .then(() => AsyncStorage.setItem(CATALOGUE_KEY, value));
    return pending;
}
