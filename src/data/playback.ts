/**
 * The playback preferences: the speed, the frame mode and the sleep timer.
 *
 * Ported from kotlin-tv/core/src/main/kotlin/com/hongguotv/core/
 * PlaybackSpeed.kt, PlaybackComfort.kt and VideoFrameMode.
 */

/** The speeds the player offers. */
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** A speed that is not on the list is the normal one. */
export function normalizeSpeed(value: unknown): number {
  const speed = Number(value);
  return PLAYBACK_SPEEDS.includes(speed) ? speed : 1;
}

/** "1" is "1×", "1.25" is "1.25×". */
export function speedLabel(value: number): string {
  const speed = normalizeSpeed(value);
  return `${Number.isInteger(speed) ? speed : String(speed)}×`;
}

/** How the picture fills the screen. */
export type FrameMode = "fit" | "zoom" | "fill";

export type FrameModeInfo = {
  mode: FrameMode;
  label: string;
  /** What the player hands to react-native-video. */
  resizeMode: "contain" | "cover" | "stretch";
  /** What the picker explains. */
  hint: string;
};

export const FRAME_MODES: FrameModeInfo[] = [
  {
    mode: "fit",
    label: "完整画面",
    resizeMode: "contain",
    hint: "保留比例与全部内容",
  },
  {
    mode: "zoom",
    label: "等比铺满",
    resizeMode: "cover",
    hint: "会裁掉部分画面与字幕",
  },
  {
    mode: "fill",
    label: "拉伸铺满",
    resizeMode: "stretch",
    hint: "画面比例会改变",
  },
];

/** A frame mode that is not on the list is the first one. */
export function normalizeFrameMode(value: unknown): FrameMode {
  const found = FRAME_MODES.find((entry) => entry.mode === value);
  return found ? found.mode : "fit";
}

/** The frame mode's own entry. */
export function frameModeInfo(mode: FrameMode): FrameModeInfo {
  return FRAME_MODES.find((entry) => entry.mode === mode) || FRAME_MODES[0];
}

/**
 * Whether the next episode should be fetched now.
 *
 * The wall-clock time to the end matters: a long episode must not sit on a
 * speculative download for an hour. The speed is taken into account, so an
 * episode played at half speed prefetches later - it takes twice as long in
 * real time to reach the end.
 *
 * The positions are in seconds, the way the player counts them.
 *
 * Ported from kotlin-tv/core/.../PrefetchPolicy.kt, which counts in
 * milliseconds.
 */
export function nearEnd(
  position: number,
  duration: number,
  speed: number
): boolean {
  if (
    duration <= 0 ||
    position < 0 ||
    position >= duration ||
    !isFinite(speed) ||
    speed <= 0
  ) {
    return false;
  }
  return (duration - position) / speed <= 30;
}

/**
 * The timer that stops the playback after a while.
 *
 * It runs on a clock the caller supplies, so it does not care whether the
 * device was asleep, and it is independent of the playback speed.
 */
export class SleepTimer {
  private deadline: number | null = null;
  private episodesLeft = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get active(): boolean {
    return this.deadline !== null || this.episodesLeft > 0;
  }

  get remainingMinutes(): number {
    if (this.deadline === null) return 0;
    return Math.ceil(Math.max(0, this.deadline - this.now()) / 60000);
  }

  cancel(): void {
    this.deadline = null;
    this.episodesLeft = 0;
  }

  /** Stops after a number of minutes, 1 to 180. */
  afterMinutes(minutes: number): void {
    if (minutes < 1 || minutes > 180) throw new Error("定时停止的分钟数超出范围");
    this.cancel();
    this.deadline = this.now() + minutes * 60000;
  }

  /** Stops after a number of episodes, 1 to 10. */
  afterEpisodes(count: number): void {
    if (count < 1 || count > 10) throw new Error("定时停止的集数超出范围");
    this.cancel();
    this.episodesLeft = count;
  }

  /** Whether the timer has run out. */
  poll(): boolean {
    if (this.deadline === null || this.now() < this.deadline) return false;
    this.cancel();
    return true;
  }

  /** Whether the playback should stop now that an episode ended. */
  episodeEnded(): boolean {
    if (this.poll()) return true;
    if (this.episodesLeft <= 0) return false;
    this.episodesLeft--;
    return this.episodesLeft === 0;
  }

  /** What the player shows. */
  label(): string {
    if (this.deadline !== null) return `${this.remainingMinutes} 分钟后`;
    if (this.episodesLeft > 0) return `再播完 ${this.episodesLeft} 集`;
    return "关闭";
  }
}
