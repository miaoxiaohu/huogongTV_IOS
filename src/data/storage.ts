import AsyncStorage from "@react-native-async-storage/async-storage";
import { Library, Progress, Series, Settings } from "../domain/model";
import { normalizeFrameMode, normalizeSpeed } from "./playback";
import { CatalogueRoute, CatalogueSnapshot, emptySnapshot } from "./catalogue";
const empty: Library = { favorites: [], progress: {} };
const CATALOGUE_KEY = "catalogue.v1";
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
    if (
      Array.isArray(data.favorites) &&
      data.progress &&
      typeof data.progress === "object" &&
      !Array.isArray(data.progress)
    ) {
      // A record that is not a record would crash the list later, so the
      // ones that cannot be read are dropped instead of carried along.
      const progress: Record<string, Progress> = {};
      for (const [id, value] of Object.entries(data.progress)) {
        const entry = value as Progress;
        if (!entry || typeof entry !== "object") continue;
        if (!entry.series || typeof entry.series.id !== "string") continue;
        if (typeof entry.episodeNumber !== "number") continue;
        if (typeof entry.position !== "number") continue;
        progress[id] = entry;
      }
      library = { favorites: data.favorites, progress };
    }
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
