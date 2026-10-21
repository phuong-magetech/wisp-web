/**
 * ScreenHistory against a fake browser history: a real stack with an index, whose back() and
 * forward() fire popstate the way a browser does (asynchronously, so tests flush explicitly).
 */

import { describe, expect, it } from 'vitest';

import { Game } from '@/core/Game';
import { FakeInput, FakeRenderer } from '@/framework/testing/fakes';
import { MemoryKeyValueStore } from '@/framework/storage/KeyValueStore';
import { ScreenHistory, type HistoryWindow } from '@/hud/ScreenHistory';
import type { ModelId } from '@/models';

class FakeHistoryWindow implements HistoryWindow {
  public entries: { state: unknown; url: string }[];
  public index = 0;
  private listener: ((event: { state: unknown }) => void) | null = null;
  private queued: (() => void)[] = [];
  public readonly location = { pathname: '/', search: '?debug', hash: '' };

  /** Following a link to a fragment: a new entry with no state, then popstate, like a browser. */
  public followHashLink(hash: string): void {
    this.queued.push(() => {
      this.history.pushState(null, '', `/?debug${hash}`);
      this.location.hash = hash;
      this.listener?.({ state: null });
    });
  }

  public constructor(initialUrl = '/?debug') {
    this.entries = [{ state: null, url: initialUrl }];
  }

  public readonly history = {
    pushState: (state: unknown, _title: string, url?: string | URL | null): void => {
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push({ state, url: String(url) });
      this.index++;
      this.location.hash = new URL(String(url), 'http://x').hash;
    },
    replaceState: (state: unknown, _title: string, url?: string | URL | null): void => {
      this.entries[this.index] = { state, url: String(url) };
      this.location.hash = new URL(String(url), 'http://x').hash;
    },
    back: (): void => this.go(-1),
    get state(): unknown {
      return null;
    },
  };

  public addEventListener(_type: 'popstate', listener: (event: { state: unknown }) => void): void {
    this.listener = listener;
  }

  /** The user pressing the browser's Back / Forward button. */
  public go(delta: number): void {
    this.queued.push(() => {
      const next = this.index + delta;
      if (next < 0 || next >= this.entries.length) {
        return;
      }
      this.index = next;
      this.location.hash = new URL(this.entries[next].url, 'http://x').hash;
      this.listener?.({ state: this.entries[next].state });
    });
  }

  /** Deliver pending navigations, as the browser's event loop would. */
  public flush(): void {
    const pending = this.queued;
    this.queued = [];
    pending.forEach((run) => run());
  }

  public get url(): string {
    return this.entries[this.index].url;
  }
}

function setup(options: { store?: MemoryKeyValueStore; startMs?: number } = {}) {
  const clock = { ms: options.startMs ?? 1_000_000 };
  const input = new FakeInput();
  const game = new Game(new FakeRenderer<ModelId>(), input, {
    store: options.store ?? new MemoryKeyValueStore(),
    now: () => clock.ms,
    sessionSeconds: 60,
  });
  const win = new FakeHistoryWindow();
  const screens = new ScreenHistory(game, win);
  /** One frame: the game updates, then history mirrors it. */
  const frame = (seconds = 1 / 30): void => {
    clock.ms += seconds * 1000;
    game.update(1 / 30);
    screens.sync();
  };
  return { game, input, win, clock, frame };
}

describe('ScreenHistory', () => {
  it('starts on the home URL with a single entry', () => {
    const { win } = setup();
    expect(win.entries).toHaveLength(1);
    expect(win.url).toBe('/?debug');
  });

  it('pushes a same-origin #focus entry when a session starts', () => {
    const { input, win, frame } = setup();
    input.fire('pinchTap', undefined);
    frame();
    expect(win.entries).toHaveLength(2);
    expect(win.url).toBe('/?debug#focus');
  });

  it('ends the session on browser Back, crediting the time', () => {
    const { game, input, win, frame } = setup();
    input.fire('pinchTap', undefined);
    frame();
    frame(20);

    win.go(-1);
    win.flush();
    expect(game.getMode()).toBe('idle');
    expect(game.getTotalFocusSeconds()).toBeCloseTo(20, 0); // plus the first frame's 1/30 s
    expect(win.url).toBe('/?debug');
  });

  it('pops its own entry when the session ends in-game, leaving no stale screen', () => {
    const { game, input, win, frame } = setup();
    input.fire('pinchTap', undefined);
    frame();
    input.fire('pinchTap', undefined); // Stop
    frame();
    win.flush();
    expect(game.getMode()).toBe('idle');
    expect(win.index).toBe(0);
    expect(win.url).toBe('/?debug');
  });

  it('pops its own entry when the timer completes', () => {
    const { game, input, win, frame } = setup();
    input.fire('pinchTap', undefined);
    frame();
    frame(61);
    win.flush();
    expect(game.getMode()).toBe('idle');
    expect(win.index).toBe(0);
  });

  it('does not touch history for selection changes or petting', () => {
    const { input, win, frame } = setup();
    input.fire('dpadSwipe', 'right');
    input.fire('pinchTap', undefined); // press [Pet]
    input.fire('dpadSwipe', 'up');
    input.fire('dpadSwipe', 'left');
    frame();
    expect(win.entries).toHaveLength(1);
  });

  it('settles on home if Forward lands on a session that already ended', () => {
    const { game, input, win, frame } = setup();
    input.fire('pinchTap', undefined);
    frame();
    win.go(-1);
    win.flush();

    win.go(1);
    win.flush(); // Forward arrives; ScreenHistory steps back
    win.flush(); // ...and that Back arrives
    expect(game.getMode()).toBe('idle');
    expect(win.index).toBe(0);
    expect(win.url).toBe('/?debug');
  });

  it('gives a resumed session a home entry beneath it, so Back works after a reload', () => {
    const store = new MemoryKeyValueStore();
    const first = setup({ store });
    first.input.fire('pinchTap', undefined);

    const second = setup({ store, startMs: first.clock.ms + 5000 });
    expect(second.game.getMode()).toBe('focusing');
    expect(second.win.entries).toHaveLength(2);
    expect(second.win.url).toBe('/?debug#focus');

    second.win.go(-1);
    second.win.flush();
    expect(second.game.getMode()).toBe('idle');
  });

  it('starts a session when the [Focus] link navigates to #focus, with one entry', () => {
    const { game, win, frame } = setup();
    win.followHashLink('#focus');
    win.flush();
    frame();
    expect(game.getMode()).toBe('focusing');
    expect(win.entries).toHaveLength(2);
    expect(win.url).toBe('/?debug#focus');

    win.go(-1);
    win.flush();
    expect(game.getMode()).toBe('idle');
    expect(win.index).toBe(0);
  });
});
