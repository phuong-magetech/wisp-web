/**
 * Wisp's gameplay, driven with the framework fakes in plain Node — no GPU, no DOM. The clock is
 * a fake too, so a 25-minute session takes no real time.
 */

import { describe, expect, it } from 'vitest';

import { GROWTH, MOOD, SESSION } from '@/config/gameplayConstants';
import { Game } from '@/core/Game';
import { FakeInput, FakeRenderer } from '@/framework/testing/fakes';
import { MemoryKeyValueStore } from '@/framework/storage/KeyValueStore';
import type { ModelId } from '@/models';

const DAY_MS = 24 * 60 * 60 * 1000;

interface SetupOptions {
  store?: MemoryKeyValueStore;
  startMs?: number;
  sessionSeconds?: number;
}

/** A game on fakes, with a hand-cranked clock. */
function setup(options: SetupOptions = {}) {
  const clock = { ms: options.startMs ?? 1_000_000 };
  const store = options.store ?? new MemoryKeyValueStore();
  const renderer = new FakeRenderer<ModelId>();
  const input = new FakeInput();
  const game = new Game(renderer, input, {
    store,
    now: () => clock.ms,
    sessionSeconds: options.sessionSeconds,
  });
  /** Move the wall clock forward and run one frame. */
  const advance = (seconds: number): void => {
    clock.ms += seconds * 1000;
    game.update(1 / 30);
  };
  return { game, input, store, clock, renderer, advance };
}

describe('focus sessions', () => {
  it('starts on a pinch and runs for the default 25 minutes', () => {
    const { game, input, advance } = setup();
    expect(game.getMode()).toBe('idle');

    input.fire('pinchTap', undefined);
    expect(game.getMode()).toBe('focusing');
    expect(game.getRemainingSeconds()).toBe(SESSION.durationSeconds);

    advance(10 * 60);
    expect(game.getRemainingSeconds()).toBe(SESSION.durationSeconds - 10 * 60);
  });

  it('completes on its own and credits the full session', () => {
    const { game, input, advance } = setup();
    input.fire('pinchTap', undefined);
    advance(SESSION.durationSeconds + 5);

    expect(game.getMode()).toBe('idle');
    expect(game.getTotalFocusSeconds()).toBe(SESSION.durationSeconds);
    expect(game.getRecentCreditSeconds()).toBe(SESSION.durationSeconds);
  });

  it('counts a partial session when the wearer pinches to stop early', () => {
    const { game, input, advance } = setup();
    input.fire('pinchTap', undefined);
    advance(7 * 60);
    input.fire('pinchTap', undefined);

    expect(game.getMode()).toBe('idle');
    expect(game.getTotalFocusSeconds()).toBe(7 * 60);
    expect(game.getRecentCreditSeconds()).toBe(7 * 60);
  });

  it('keeps counting while the loop is paused, because it is wall-clock timed', () => {
    const { game, input, clock } = setup();
    input.fire('pinchTap', undefined);
    clock.ms += 20 * 60 * 1000; // backgrounded: no update() calls at all
    expect(game.getRemainingSeconds()).toBe(5 * 60);
  });

  it('honors a shortened session length (the ?debug flag)', () => {
    const { game, input, advance } = setup({ sessionSeconds: SESSION.debugDurationSeconds });
    input.fire('pinchTap', undefined);
    advance(SESSION.debugDurationSeconds);
    expect(game.getMode()).toBe('idle');
    expect(game.getTotalFocusSeconds()).toBe(SESSION.debugDurationSeconds);
  });

  it('hides the credit after a few seconds', () => {
    const { game, input, advance } = setup();
    input.fire('pinchTap', undefined);
    advance(60);
    input.fire('pinchTap', undefined);
    expect(game.getRecentCreditSeconds()).toBe(60);

    for (let frame = 0; frame < SESSION.creditShowSeconds * 30 + 2; frame++) {
      game.update(1 / 30);
    }
    expect(game.getRecentCreditSeconds()).toBeNull();
  });
});

describe('persistence', () => {
  it('remembers growth across visits', () => {
    const store = new MemoryKeyValueStore();
    const first = setup({ store });
    first.input.fire('pinchTap', undefined);
    first.advance(SESSION.durationSeconds);

    const second = setup({ store, startMs: first.clock.ms + 1000 });
    expect(second.game.getTotalFocusSeconds()).toBe(SESSION.durationSeconds);
  });

  it('resumes a session that was running when the app closed', () => {
    const store = new MemoryKeyValueStore();
    const first = setup({ store });
    first.input.fire('pinchTap', undefined);

    const second = setup({ store, startMs: first.clock.ms + 10 * 60 * 1000 });
    expect(second.game.getMode()).toBe('focusing');
    expect(second.game.getRemainingSeconds()).toBe(SESSION.durationSeconds - 10 * 60);
  });

  it('credits a session that finished while the app was closed', () => {
    const store = new MemoryKeyValueStore();
    const first = setup({ store });
    first.input.fire('pinchTap', undefined);

    const second = setup({ store, startMs: first.clock.ms + 2 * 60 * 60 * 1000 });
    second.game.update(1 / 30);
    expect(second.game.getMode()).toBe('idle');
    expect(second.game.getTotalFocusSeconds()).toBe(SESSION.durationSeconds);
  });
});

describe('growth', () => {
  it('grows through each stage as focused minutes add up, and never shrinks', () => {
    const { game, input, advance } = setup({ sessionSeconds: 60 });
    const stages: number[] = [game.getStage()];
    const lastThreshold = GROWTH.stageMinutes[GROWTH.stageMinutes.length - 1];
    for (let minute = 0; minute < lastThreshold; minute++) {
      input.fire('pinchTap', undefined);
      advance(60);
      stages.push(game.getStage());
    }
    expect(stages[0]).toBe(0);
    expect(stages[stages.length - 1]).toBe(GROWTH.stageMinutes.length - 1);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
  });
});

describe('mood', () => {
  it('is content on the very first visit', () => {
    expect(setup().game.isWistful()).toBe(false);
  });

  it('is wistful after a long absence, never gone, and warms up on any touch', () => {
    const store = new MemoryKeyValueStore();
    const first = setup({ store });
    const away = (MOOD.wistfulAfterDays + 1) * DAY_MS;

    const second = setup({ store, startMs: first.clock.ms + away });
    expect(second.game.isWistful()).toBe(true);

    second.input.fire('dpadSwipe', 'up');
    expect(second.game.isWistful()).toBe(false);
  });

  it('is not wistful after a short break', () => {
    const store = new MemoryKeyValueStore();
    const first = setup({ store });
    const second = setup({ store, startMs: first.clock.ms + DAY_MS / 2 });
    expect(second.game.isWistful()).toBe(false);
  });
});

describe('petting', () => {
  /** The core is the second model the game adds (after the halo). */
  const CORE = 1;

  it('squashes Wisp briefly on a swipe without starting a session', () => {
    const { game, input, renderer } = setup();
    game.update(1 / 30);
    const before = { ...[...renderer.scales.values()][CORE] };

    input.fire('dpadSwipe', 'up');
    for (let frame = 0; frame < 9; frame++) {
      game.update(1 / 30); // ~0.3 s: the middle of the wiggle
    }
    const during = [...renderer.scales.values()][CORE];

    expect(game.getMode()).toBe('idle');
    expect(during.x).toBeGreaterThan(during.y);
    expect(during.x / during.y).toBeGreaterThan(before.x / before.y);
  });

  it('brightens Wisp, then lets it fade back to rest', () => {
    const { game, input, renderer } = setup();
    const coreOpacity = (): number => [...renderer.opacities.values()][CORE];
    game.update(1 / 30);
    const rest = coreOpacity();

    input.fire('dpadSwipe', 'down');
    game.update(1 / 30);
    expect(coreOpacity()).toBeGreaterThan(rest);

    for (let frame = 0; frame < 30 * 10; frame++) {
      game.update(1 / 30);
    }
    expect(coreOpacity()).toBeCloseTo(rest);
  });
});

describe('controls', () => {
  it('starts with [Focus] selected', () => {
    expect(setup().game.getSelectedControl()).toBe('focus');
  });

  it('moves the selection with left/right and clamps at the ends', () => {
    const { game, input } = setup();
    input.fire('dpadSwipe', 'right');
    expect(game.getSelectedControl()).toBe('pet');
    input.fire('dpadSwipe', 'right');
    expect(game.getSelectedControl()).toBe('pet');
    input.fire('dpadSwipe', 'left');
    expect(game.getSelectedControl()).toBe('focus');
    input.fire('dpadSwipe', 'left');
    expect(game.getSelectedControl()).toBe('focus');
  });

  it('does not pet or start anything when only moving the selection', () => {
    const { game, input, renderer } = setup();
    const coreOpacity = (): number => [...renderer.opacities.values()][1];
    game.update(1 / 30);
    const rest = coreOpacity();

    input.fire('dpadSwipe', 'right');
    game.update(1 / 30);
    expect(game.getMode()).toBe('idle');
    expect(coreOpacity()).toBeCloseTo(rest);
  });

  it('pets, not focuses, when the pinch presses [Pet]', () => {
    const { game, input, renderer } = setup();
    const coreOpacity = (): number => [...renderer.opacities.values()][1];
    game.update(1 / 30);
    const rest = coreOpacity();

    input.fire('dpadSwipe', 'right');
    input.fire('pinchTap', undefined);
    game.update(1 / 30);
    expect(game.getMode()).toBe('idle');
    expect(coreOpacity()).toBeGreaterThan(rest);
  });

  it('stops a session from [Focus] after visiting [Pet]', () => {
    const { game, input, advance } = setup();
    input.fire('pinchTap', undefined);
    input.fire('dpadSwipe', 'right');
    input.fire('pinchTap', undefined); // pet mid-session: the session keeps going
    advance(60);
    expect(game.getMode()).toBe('focusing');

    input.fire('dpadSwipe', 'left');
    input.fire('pinchTap', undefined);
    expect(game.getMode()).toBe('idle');
    expect(game.getTotalFocusSeconds()).toBe(60);
  });
});

describe('drawing only on change', () => {
  /** Runs `frames` frames of 1/30 s and counts how many of them actually drew. */
  function drawnFrames(game: Game, frames: number): number {
    let drawn = 0;
    for (let frame = 0; frame < frames; frame++) {
      game.update(1 / 30);
      if (game.render()) {
        drawn++;
      }
    }
    return drawn;
  }

  it('draws the first frame, then nothing while Wisp is at rest', () => {
    const { game } = setup();
    expect(drawnFrames(game, 1)).toBe(1);
    expect(drawnFrames(game, 300)).toBe(0);
  });

  it('draws while a pet animates and fades, then goes quiet again', () => {
    const { game, input } = setup();
    drawnFrames(game, 1);

    input.fire('dpadSwipe', 'up');
    const during = drawnFrames(game, 30 * 5); // the 4 s fade, plus margin
    expect(during).toBeGreaterThan(30 * 3);
    expect(drawnFrames(game, 300)).toBe(0);
  });

  it('only draws when a ring dot lights during a focus session', () => {
    const { game, input, clock } = setup();
    drawnFrames(game, 1);
    input.fire('pinchTap', undefined);
    drawnFrames(game, 30 * 5); // let the start-of-session brightening settle

    // 25 min / 48 dots = 31.25 s per dot. Run 63 s of frames: exactly two dots light.
    let drawn = 0;
    for (let frame = 0; frame < 63 * 30; frame++) {
      clock.ms += 1000 / 30;
      game.update(1 / 30);
      if (game.render()) {
        drawn++;
      }
    }
    expect(drawn).toBe(2);
  });
});
