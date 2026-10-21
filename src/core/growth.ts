/**
 * Pure rules for growth and mood. Growth only ever goes up with focused time; mood is wistful
 * after a long absence and never anything worse. No streaks, no decay, no dead pet.
 */

import { GROWTH, MOOD } from '@/config/gameplayConstants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Growth stage (0-based index into the GROWTH tables) for a total of focused seconds. */
export function stageFor(totalFocusSeconds: number): number {
  const minutes = totalFocusSeconds / 60;
  let stage = 0;
  GROWTH.stageMinutes.forEach((threshold, index) => {
    if (minutes >= threshold) {
      stage = index;
    }
  });
  return stage;
}

/** Whether Wisp greets you wistful: you've been away longer than `MOOD.wistfulAfterDays`. */
export function isWistful(lastSeenMs: number | null, nowMs: number): boolean {
  if (lastSeenMs === null) {
    return false; // First meeting: nothing to miss yet.
  }
  return nowMs - lastSeenMs > MOOD.wistfulAfterDays * MS_PER_DAY;
}
