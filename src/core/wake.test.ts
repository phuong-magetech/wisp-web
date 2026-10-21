import { describe, expect, it } from 'vitest';

import { nextWake } from '@/core/wake';

describe('nextWake', () => {
  it('sleeps at rest: no frames until the next input', () => {
    expect(nextWake({ animating: false, focusing: false, remainingSeconds: 0 })).toEqual({ kind: 'sleep' });
  });

  it('runs frames while something animates, session or not', () => {
    expect(nextWake({ animating: true, focusing: false, remainingSeconds: 0 })).toEqual({ kind: 'frame' });
    expect(nextWake({ animating: true, focusing: true, remainingSeconds: 90.5 })).toEqual({ kind: 'frame' });
  });

  it('wakes just after the displayed second changes during a still session', () => {
    expect(nextWake({ animating: false, focusing: true, remainingSeconds: 90.25 })).toEqual({ kind: 'timer', delayMs: 255 });
  });

  it('waits a full second when exactly on a second boundary', () => {
    expect(nextWake({ animating: false, focusing: true, remainingSeconds: 90 })).toEqual({ kind: 'timer', delayMs: 1005 });
  });
});
