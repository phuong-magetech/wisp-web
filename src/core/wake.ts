/**
 * When should the app run its next frame? Wisp is event-driven: it does no work at all at rest,
 * runs frames only while something animates, and during a focus session wakes once a second for
 * the timer. This is the whole policy, as a pure function so it is unit-tested; `main.ts` turns
 * the answer into `requestAnimationFrame` / `setTimeout` calls.
 */

/** What the policy needs to know about the game after a frame. */
export interface WakeState {
  /** Something is mid-animation (a pet wiggle, the brightening fade, the credit message). */
  animating: boolean;
  /** A focus session is running. */
  focusing: boolean;
  /** Seconds left in the session (fractional). Ignored when not focusing. */
  remainingSeconds: number;
}

export type Wake =
  /** Run another frame as soon as the display allows. */
  | { kind: 'frame' }
  /** Nothing moves, but the session timer will change: run one frame after `delayMs`. */
  | { kind: 'timer'; delayMs: number }
  /** Nothing to do until the next input. */
  | { kind: 'sleep' };

/** Wake this long after the displayed second changes, so the change has definitely happened. */
const TIMER_SLACK_MS = 5;

export function nextWake(state: WakeState): Wake {
  if (state.animating) {
    return { kind: 'frame' };
  }
  if (state.focusing) {
    // The HUD shows whole seconds rounded up, so it changes as the remaining time crosses the
    // next integer. Wake just after that. The same frame also catches a ring dot lighting and the
    // session completing.
    const fraction = state.remainingSeconds % 1;
    const untilNextSecond = fraction > 0 ? fraction : 1;
    return { kind: 'timer', delayMs: Math.ceil(untilNextSecond * 1000) + TIMER_SLACK_MS };
  }
  return { kind: 'sleep' };
}
