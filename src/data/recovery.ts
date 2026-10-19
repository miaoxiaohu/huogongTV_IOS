/**
 * Automatic playback recovery.
 *
 * The TV app retries a failed playback on its own: a failure that looks like
 * a transport problem is retried a few times with a growing delay, and the
 * watching position is kept. A failure that means "this episode has no
 * video" is not retried - retrying that only wastes the user's time.
 *
 * Ported from kotlin-tv/core/src/main/kotlin/com/hongguotv/core/Watching.kt
 * (RecoveryBudget) and the recovery half of MainActivity.playerFailure.
 */
import { NO_PUBLIC_SOURCE, NO_USABLE_QUALITY } from "./errors";

/**
 * The failures that are a fact about the episode, not about the connection.
 *
 * Every other failure is worth another try: the signed player answers with
 * an empty body every so often, a server can have a bad moment, and a
 * connection can drop. A fresh request hands out fresh signing material, so
 * a retry is not the same request twice.
 */
export const PERMANENT_FAILURES = [NO_PUBLIC_SOURCE, NO_USABLE_QUALITY];

/** Whether a failure is worth retrying on its own. */
export function isRetryable(message: string): boolean {
  if (!message) return false;
  return !PERMANENT_FAILURES.includes(message);
}

/** Seconds and minutes, the way the player shows a position. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * One automatic recovery budget per episode; only an explicit user retry
 * resets it.
 */
export class RecoveryBudget {
  attempts = 0;

  get remaining(): boolean {
    return this.attempts < 3;
  }

  /** The wait before the next attempt, or null when the budget is used up. */
  get delayMillis(): number | null {
    const delays = [1000, 2500, 5000];
    return this.attempts < delays.length ? delays[this.attempts] : null;
  }

  consume(): boolean {
    if (!this.remaining) return false;
    this.attempts++;
    return true;
  }

  reset(): void {
    this.attempts = 0;
  }
}

type TimerHandle = any;

export type RecoveryHooks = {
  /** The player should try again. */
  onRetry: () => void;
  /** The line shown to the user, e.g. when the next attempt is due. */
  onNote: (note: string) => void;
  /** Whether the automatic retries are still armed. */
  onState?: (armed: boolean) => void;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

/**
 * Drives the automatic playback recovery.
 *
 * The screen owns what the user sees, this owns the timing: the budget, the
 * growing delay and the one timer that may be pending at a time. Everything
 * it needs from the outside arrives through the hooks, so the whole thing
 * can be tested without a screen.
 */
export class RecoveryController {
  private budget = new RecoveryBudget();
  private timer: TimerHandle = null;
  private enabled = false;

  constructor(private readonly hooks: RecoveryHooks) {}

  /** How many automatic attempts have been made. */
  get attempts(): number {
    return this.budget.attempts;
  }

  /** Whether the automatic retries are armed. */
  get armed(): boolean {
    return this.enabled;
  }

  /** Whether a retry is waiting to happen. */
  get pending(): boolean {
    return this.timer !== null;
  }

  /**
   * A playback failure. It is shown by the caller; this decides whether the
   * player puts the playback back on its feet on its own.
   */
  fail(message: string, position: number): void {
    if (!isRetryable(message)) {
      this.stop();
      this.arm(false);
      return;
    }
    this.arm(true);
    this.schedule(position);
  }

  /**
   * The app came back to the foreground. That is the moment a connection
   * that was down usually works again, so the retry does not have to wait.
   */
  poke(position: number): void {
    if (this.enabled) this.schedule(position);
  }

  /**
   * A new attempt has started.
   *
   * The note is stale now, but the budget is not: the budget is what stops
   * the automatic retries, and an automatic retry that reset it would never
   * run out.
   */
  begin(): void {
    this.stop();
    this.arm(false);
    this.hooks.onNote("");
  }

  /** The user asked for a retry: the budget starts over. */
  manual(): void {
    this.stop();
    this.budget.reset();
    this.arm(false);
    this.hooks.onNote("");
  }

  /** The user asked to stop the automatic retries. */
  cancel(): void {
    this.stop();
    this.arm(false);
    this.hooks.onNote("自动重试已停止，观看位置已保留。");
  }

  /** A new episode starts with a clean budget. */
  reset(): void {
    this.stop();
    this.budget.reset();
    this.arm(false);
    this.hooks.onNote("");
  }

  /** Nothing is pending and nothing will fire. */
  dispose(): void {
    this.stop();
    this.arm(false);
  }

  private arm(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.hooks.onState?.(on);
  }

  private schedule(position: number): void {
    if (!this.enabled) return;
    if (this.timer !== null) return;
    if (!this.budget.remaining) {
      this.arm(false);
      this.hooks.onNote("已自动重试 3 次，仍无法播放。可手动重试或切换清晰度。");
      return;
    }
    const delay = this.budget.delayMillis;
    if (delay === null) return;
    this.hooks.onNote(
      `准备恢复播放 · ${delay / 1000} 秒后重试 ${this.budget.attempts + 1}/3 · ${formatClock(
        position
      )}`
    );
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (!this.budget.consume()) return;
      // The attempt is under way now. The recovery is armed again only if
      // that attempt fails, so a retry that is already running cannot be
      // doubled by a second trigger.
      this.arm(false);
      this.hooks.onRetry();
    }, delay);
  }

  private setTimer(fn: () => void, ms: number): TimerHandle {
    const setter = this.hooks.setTimer ?? ((f: () => void, m: number) => setTimeout(f, m));
    return setter(fn, ms);
  }

  private clearTimer(handle: TimerHandle): void {
    const clearer = this.hooks.clearTimer ?? ((h: TimerHandle) => clearTimeout(h));
    clearer(handle);
  }

  private stop(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}
