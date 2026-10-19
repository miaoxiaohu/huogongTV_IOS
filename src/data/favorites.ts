/**
 * Watching a favourite closely enough to notice when it grows.
 *
 * The site does not say "this show has three new episodes" - the only sign
 * is that the episode count went up. So the count is remembered, and the
 * difference is what the user is told about.
 *
 * The seen count is a high-water mark, so a catalogue that shrinks for a
 * while - the site reorganises its shelves now and then - is not read as a
 * new update.
 *
 * Ported from kotlin-tv/core/.../Watching.kt (FavoriteUpdate).
 */
export type FavoriteUpdate = {
  /** The episode count the last check saw. */
  total: number;
  /** The high-water mark the user has been told about. */
  seen: number;
  /** When it was last checked. */
  checkedAt: number;
};

/** How many episodes are new since the user last looked. */
export function addedEpisodes(update: FavoriteUpdate): number {
  return Math.max(0, update.total - update.seen);
}

/** The first look at a show: nothing is new yet. */
export function firstFavoriteUpdate(count: number, now: number): FavoriteUpdate {
  if (count <= 0) throw new Error("集数必须是正数");
  return { total: count, seen: count, checkedAt: now };
}

/**
 * What a fresh count does to the record.
 *
 * @param acknowledge the user has seen the new episodes, so the mark moves
 * up to the current count.
 */
export function observeFavoriteUpdate(
  update: FavoriteUpdate,
  count: number,
  now: number,
  acknowledge = false
): FavoriteUpdate {
  if (count <= 0) throw new Error("集数必须是正数");
  // A clock that went backwards must not wipe what was seen.
  if (now < update.checkedAt) return update;
  return {
    total: count,
    seen: acknowledge ? Math.max(update.seen, count) : update.seen,
    checkedAt: now,
  };
}

/**
 * Whether a show should be looked at again.
 *
 * The site is asked once an hour at most: every check is a request, and the
 * endpoint that answers this app is sensitive about how often it is called.
 */
export function shouldCheck(
  update: FavoriteUpdate | undefined,
  now: number,
  force = false
): boolean {
  if (!update) return true;
  if (force) return true;
  return now - update.checkedAt >= 3600000;
}
