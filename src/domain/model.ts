import { FrameMode } from "../data/playback";
import { CatalogueRoute } from "../data/catalogue";

export interface Series {
  id: string;
  title: string;
  cover: string;
  description: string;
  badge: string;
  tags: string;
}
/** One season of a multi-season series, plus the season number. */
export interface SeasonEntry {
  series: Series;
  season: number;
}
export interface Episode {
  id: string;
  number: number;
  title: string;
}
export interface Detail extends Series {
  episodes: Episode[];
}
export interface Progress {
  series: Series;
  episodeId: string;
  episodeNumber: number;
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: number;
}
export interface Library {
  favorites: Series[];
  progress: Record<string, Progress>;
}
export interface Settings {
  baseUrl: string;
  token: string;
  category?: "short" | "comic";
  /** Highest video resolution to fetch. 1080 is the best the source offers. */
  maxQuality?: number;
  /** The speed the player starts at. 1 is the normal one. */
  playbackSpeed?: number;
  /** How the picture fills the screen. */
  frameMode?: FrameMode;
  /** Whether the next episode starts by itself. */
  autoNext?: boolean;
}
export interface Playback {  uri: string;
  headers: Record<string, string>;
  /** The quality that was actually selected, e.g. "720P". */
  quality?: string;
}
export interface PlaybackProgress {
  percent: number;
  message: string;
}
/** Where a show sits on a hot board, and how hot it is. */
export interface RankPosition {
  /** The rank the site gave it, or null when it could not be read. */
  rank: number | null;
  /** The heat text as the site printed it, e.g. "8370万热度". */
  heat: string;
}
export interface ContentProvider {
  home(page: number): Promise<Series[]>;
  search(query: string, page: number): Promise<Series[]>;
  detail(id: string): Promise<Detail>;
  resolve(
    id: string,
    fresh?: boolean,
    onProgress?: (progress: PlaybackProgress) => void
  ): Promise<Playback>;
  /**
   * The other seasons of the same show, when the provider can find them.
   * Optional: a self hosted service has no way to know them.
   */
  seasons?(series: Series): Promise<SeasonEntry[]>;
  /**
   * The hot board of the provider's shelf.
   * Optional: a self hosted service has no board.
   */
  ranking?(page: number): Promise<HotRankingPage>;
  /**
   * One page of a catalogue, for the local index.
   * Optional: a self hosted service has no catalogue to walk.
   */
  cataloguePage?(
    route: CatalogueRoute,
    page: number
  ): Promise<{ rows: Series[]; totalPages: number }>;
}
export interface HotRankingPage {
  items: Series[];
  positions: Record<string, RankPosition>;
  totalPages: number;
  updatedText: string;
}
export function resumeTarget(
  detail: Detail,
  progress?: Progress
): { index: number; position: number } {
  if (!progress) return { index: 0, position: 0 };
  const index = detail.episodes.findIndex((e) => e.id === progress.episodeId);
  if (index < 0) return { index: 0, position: 0 };
  if (progress.completed)
    return {
      index: Math.min(index + 1, detail.episodes.length - 1),
      position: 0,
    };
  return { index, position: Math.max(0, progress.position) };
}
export function mergePage(existing: Series[], incoming: Series[]): Series[] {
  return Array.from(
    new Map([...existing, ...incoming].map((item) => [item.id, item])).values()
  );
}

/**
 * How a page of a hot board joins the pages that are already on the screen.
 *
 * The positions of the earlier pages have to stay: a card that loses its
 * position loses its rank badge, and the badge is the whole point of the
 * board.
 */
export function mergeBoardPage(
  previous: { items: Series[]; positions: Record<string, RankPosition> },
  board: HotRankingPage,
  replace: boolean
): { items: Series[]; positions: Record<string, RankPosition> } {
  return {
    items: replace ? board.items : mergePage(previous.items, board.items),
    positions: replace
      ? board.positions
      : { ...previous.positions, ...board.positions },
  };
}
export function normalizeBaseUrl(input: string): string {
  const url = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[a-z\d.\-\[\]:]+(?::\d+)?$/i.test(url))
    throw new Error("请输入完整服务地址，例如 http://192.168.1.10:8787");
  return url;
}
