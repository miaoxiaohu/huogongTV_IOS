/**
 * The watching records: what was played, how far, and what was finished.
 *
 * These three operations are the ones the TV app's `LibraryIndex` does, with
 * the same rules about what goes and what stays:
 *
 * - `removeHistory` drops one show: its position *and* the "watched through"
 *   mark. Leaving the mark behind would make the show look finished the next
 *   time it is opened, which is not what the user asked for.
 * - `clearHistory` drops every watching record and every finished mark. The
 *   favourites, the "watch later" list, the hidden shows and the searches are
 *   not watching records, so they stay.
 * - `clearSearches` drops the search words and nothing else.
 *
 * Ported from kotlin-tv/core/.../LibraryIndex.kt.
 */
import { Library } from "../domain/model";

/** Removes one show from the watching records. The favourite stays. */
export function removeHistory(library: Library, id: string): Library {
    const progress = { ...library.progress };
    delete progress[id];
    return {
        ...library,
        progress,
        watched: library.watched.filter((row) => row !== id),
    };
}

/**
 * Removes every watching record.
 *
 * The favourites, the "watch later" list, the hidden shows and the searches
 * are not watching records, so they stay - the same way the TV app's
 * `clearHistory` leaves them alone.
 */
export function clearHistory(library: Library): Library {
    return {
        ...library,
        progress: {},
        watched: [],
    };
}

/** Removes the search words and nothing else. */
export function clearSearches(library: Library): Library {
    return {
        ...library,
        searches: [],
    };
}
