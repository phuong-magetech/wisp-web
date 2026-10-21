/**
 * Browser history for Wisp's screens, so Back and Forward behave like any other web app.
 *
 * Wisp has two screens: home (no hash) and a focus session (`#focus`). Starting a session pushes
 * a same-origin history entry. Back from it ends the session (the time still counts, as always).
 * Navigating to `#focus` on an open page (the [Focus] link, or editing the hash) starts a session.
 * A fresh load of a `#focus` URL lands on home unless a saved session is still running, so a
 * reload never starts a session nobody asked for.
 * When the session ends from inside the game (pressing Stop, or the timer completing), the entry
 * is popped with `history.back()`, so the stack never collects stale focus screens. Selection
 * changes between the controls are transient and never touch history.
 *
 * Browser navigation is a lifecycle signal, like `visibilitychange`, not a gesture: gestures still
 * flow only through the InputManager. The window is injected so this runs under a test fake.
 */

import type { Mode } from '@/core/Game';

export type Screen = 'home' | 'focus';

/** What this needs from the game: read the mode, and start or end a session from the URL. */
export interface ScreenSource {
  getMode(): Mode;
  startSession(): void;
  stopSession(): void;
}

/** The slice of `window` this uses. */
export interface HistoryWindow {
  readonly history: Pick<History, 'pushState' | 'replaceState' | 'back' | 'state'>;
  readonly location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  addEventListener(type: 'popstate', listener: (event: { state: unknown }) => void): void;
}

const FOCUS_HASH = '#focus';

export class ScreenHistory {
  /** The screen the history stack currently shows. */
  private shown: Screen;

  public constructor(
    private readonly game: ScreenSource,
    private readonly win: HistoryWindow,
  ) {
    // Rebuild the stack from what the game is actually doing, not from the URL: a reload of
    // `#focus` with no session running lands on home, and a resumed session gets a home entry
    // beneath it so Back still has somewhere to go.
    this.win.history.replaceState({ screen: 'home' }, '', this.urlFor('home'));
    this.shown = 'home';
    if (this.screenOfGame() === 'focus') {
      this.push('focus');
    }
    this.win.addEventListener('popstate', (event) => this.onPopState(event.state));
  }

  /** Call once per frame, after the game updates: mirror screen changes into history. */
  public sync(): void {
    const screen = this.screenOfGame();
    if (screen === this.shown) {
      return;
    }
    if (screen === 'focus') {
      this.push('focus');
    } else {
      // The session ended inside the game: pop our entry rather than pushing home on top of it.
      // `shown` updates now; the popstate that follows then finds nothing to do.
      this.shown = 'home';
      this.win.history.back();
    }
  }

  private onPopState(state: unknown): void {
    // A brand-new entry with no state is a fragment navigation (the [Focus] link): route it by
    // its URL. Entries we created carry their screen in their state.
    if (state === null && this.win.location.hash === FOCUS_HASH) {
      this.game.startSession();
      this.win.history.replaceState({ screen: 'focus' }, '', this.urlFor('focus'));
      this.shown = 'focus';
      return;
    }
    const target = screenOfState(state);
    this.shown = target;
    if (target === 'home' && this.game.getMode() === 'focusing') {
      this.game.stopSession();
    } else if (target === 'focus' && this.game.getMode() !== 'focusing') {
      // Forward onto a session that has already ended: there is nothing to show, and starting a
      // session nobody asked for would be wrong. Step back to the home entry beneath it; replacing
      // this entry instead would leave two home entries stacked.
      this.shown = 'home';
      this.win.history.back();
    }
  }

  private push(screen: Screen): void {
    this.win.history.pushState({ screen }, '', this.urlFor(screen));
    this.shown = screen;
  }

  private screenOfGame(): Screen {
    return this.game.getMode() === 'focusing' ? 'focus' : 'home';
  }

  /** Same path and query (keeps `?debug` etc.), with the screen in the hash. */
  private urlFor(screen: Screen): string {
    const { pathname, search } = this.win.location;
    return pathname + search + (screen === 'focus' ? FOCUS_HASH : '');
  }
}

function screenOfState(state: unknown): Screen {
  if (typeof state === 'object' && state !== null && (state as { screen?: unknown }).screen === 'focus') {
    return 'focus';
  }
  return 'home';
}
