import AsyncStorage from "@react-native-async-storage/async-storage";
import { Library, Progress, Settings } from "../domain/model";
const empty: Library = { favorites: [], progress: {} };
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
