/**
 * One focus session, timed by the wall clock rather than by summing frame deltas. The game loop
 * stops while the app is backgrounded (a battery requirement), so frame time would freeze the
 * session the moment the wearer looks away. Wall-clock time keeps counting, which is what the
 * wearer means by "I focused for 25 minutes".
 */
export class FocusSession {
  public constructor(
    /** When the session started (ms since epoch, from the injected clock). */
    public readonly startMs: number,
    /** Full session length, in seconds. */
    public readonly lengthSeconds: number,
  ) {}

  /** Focused seconds so far, capped at the session length. Never negative, even if the clock jumps back. */
  public elapsedSeconds(nowMs: number): number {
    const elapsed = (nowMs - this.startMs) / 1000;
    return Math.min(Math.max(elapsed, 0), this.lengthSeconds);
  }

  public remainingSeconds(nowMs: number): number {
    return this.lengthSeconds - this.elapsedSeconds(nowMs);
  }

  /** 0 at the start, 1 when complete. */
  public progress(nowMs: number): number {
    return this.elapsedSeconds(nowMs) / this.lengthSeconds;
  }

  public isComplete(nowMs: number): boolean {
    return this.elapsedSeconds(nowMs) >= this.lengthSeconds;
  }
}
