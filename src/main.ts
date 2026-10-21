/**
 * Entry point. Builds the CSS renderer + pointer/keyboard input + game, mounts the DOM HUD, and
 * runs frames only when something needs them.
 *
 * Controls (desktop dev): arrow keys = D-pad swipe, **Enter = index tap (select)**. On the
 * glasses these are the EMG D-pad (side of the index finger) and index pinch (pad) gestures.
 * The game is TAP-ONLY: no drag channel (see the plugin's docs/drag-channel.md).
 *
 * Event-driven, not an always-on loop: at rest no frame runs at all. Input, browser navigation,
 * returning to the app and the once-a-second session tick each run a frame right away; only an
 * ongoing animation waits on `requestAnimationFrame` (capped at the glasses' 30 Hz). The policy is
 * `core/wake.ts`.
 *
 * Debug flags kept for testing on the glasses: `?stats` (live FPS / frame time on the lens) and
 * `?logview` (the log drawn on the lens). `?debug` shortens sessions and turns off the offline cache.
 */

// Side-effect import: initializes i18next with the game's bundled strings (src/i18n/) before
// anything renders. See the plugin's docs/localization.md.
import '@/i18n';

import { DISPLAY, LAYOUT, LOOP, SESSION } from '@/config/gameplayConstants';
import { Game } from '@/core/Game';
import { nextWake } from '@/core/wake';
import { applyStaticTranslations } from '@/framework/i18n/i18n';
import { consoleSink, captureGlobalErrors } from '@/framework/debug/Logger';
import { LogOverlay, logOverlayRequested } from '@/framework/debug/LogOverlay';
import { PerfOverlay } from '@/framework/debug/PerfOverlay';
import { statsOverlayRequested } from '@/framework/debug/PerfSampler';
import { PointerKeyboardInput } from '@/framework/input/PointerKeyboardInput';
import { BrowserKeyValueStore } from '@/framework/storage/KeyValueStore';
import { registerGameServiceWorker, resetServiceWorker } from '@/framework/sw/register';
import { CssRenderer } from '@/hud/CssRenderer';
import { Hud } from '@/hud/Hud';
import { ScreenHistory } from '@/hud/ScreenHistory';
import { log, search } from '@/log';
import { MODELS } from '@/models';

/**
 * `?debug`: the test build. Focus sessions are 30 s instead of 25 min, and the offline cache is
 * kept off so every load runs the current build and a load test measures a real first visit.
 */
const debugMode = new URLSearchParams(search).has('debug');

/**
 * The single-file build (`npm run deploy-file` -> `dist/deploy/wisp.html`) inlines this script into
 * the page, so the script's URL is the page's own. That is the build on magetechcorp.com, where
 * every app shares one origin. It must not touch service workers or caches at all: there is no
 * `sw.js` beside it (a relative one would resolve to the site root), and the framework's reset
 * removes every worker and cache on the origin, which would include other apps'.
 */
const singleFile = new URL(import.meta.url).pathname === window.location.pathname;

/** The 600x600 stage. Debug overlays mount here so nothing escapes the display bounds. */
function stage(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>('#game-root') ?? undefined;
}

function main(): void {
  // Fill the static DOM text from the active locale before rendering.
  applyStaticTranslations();

  // Logging stays on the device: the browser console, plus the on-lens overlay with `?logview`.
  log.addSink(consoleSink());
  if (logOverlayRequested(search)) {
    log.addSink(new LogOverlay({ mount: stage() }));
  }
  captureGlobalErrors(log);

  // Offline cache: precache this build so the next launch reads it off disk (not awaited; the
  // first launch gains nothing from it). `?swreset=1` wipes it, the only way to clear a bad cache
  // on the glasses. Under `?debug` it is removed instead, so testing always runs the current build
  // and a load test measures the download. See the plugin's docs/offline-caching.md.
  if (singleFile) {
    // Deployed build: no offline cache, and never a reset (see `singleFile`). `?swreset` is also
    // handled inside registerGameServiceWorker, so it is skipped here too.
  } else if (debugMode) {
    // Local multi-file build only. Unlike registration, the reset can reject (storage blocked);
    // losing it costs nothing.
    void resetServiceWorker().catch(() => {});
  } else {
    void registerGameServiceWorker({ search });
  }

  // Tap-only: the index pinch arrives as `Enter` -> `pinchTap`, swipes as arrow keys.
  const input = new PointerKeyboardInput();
  input.attach(window);

  const world = document.querySelector<HTMLElement>('#world');
  if (!world) {
    throw new Error('Could not find #world element.');
  }

  // Wisp is a few flat circles, drawn as CSS shapes instead of WebGL: no Three.js to download or
  // initialize on the glasses. See src/hud/CssRenderer.ts and src/models.ts.
  const renderer = new CssRenderer(world, MODELS, { viewSize: LAYOUT.viewSize });
  renderer.resize(DISPLAY.width, DISPLAY.height);

  // No sound: Wisp is silent by design. Growth persists in this browser's storage only.
  const game = new Game(renderer, input, {
    store: new BrowserKeyValueStore({ namespace: 'wisp-web' }),
    now: () => Date.now(),
    sessionSeconds: debugMode ? SESSION.debugDurationSeconds : SESSION.durationSeconds,
  });
  const hud = new Hud(game);
  // Home and the focus session have their own URLs (`#focus`), so browser Back/Forward work.
  const screens = new ScreenHistory(game, window);

  // Dev-only handle for reading state over the DevTools protocol. Stripped from production.
  if (import.meta.env.DEV) {
    (window as unknown as { __game?: Game }).__game = game;
  }

  // `?stats`: live FPS / CPU per frame on the lens. At rest it reads no frames: that is correct.
  const perf = statsOverlayRequested(search) ? new PerfOverlay(renderer, { mount: stage() }) : null;

  // --- Frame scheduling ---------------------------------------------------------------------
  // The glasses' panel is 30 Hz; on a faster display, frames closer together than this are
  // skipped. The tolerance keeps a real 30 Hz display's jitter from halving the rate.
  const minFrameMs = (1000 / LOOP.targetFps) * LOOP.frameCapTolerance;
  let frameId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  /** Time of the last frame that ran, or null after sleeping (the next frame then starts fresh). */
  let lastFrameMs: number | null = null;
  let firstFrameDrawn = false;

  /** Continue an animation on the display's next frame. */
  const requestFrame = (): void => {
    if (frameId === null && !document.hidden) {
      frameId = requestAnimationFrame(frame);
    }
  };

  /**
   * Run a frame now, for anything that is not an ongoing animation. A browser may hold back an
   * animation frame when nothing on screen is moving (it stops them entirely in a background tab),
   * so the session tick and input must not wait for one.
   */
  const runNow = (): void => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (!document.hidden) {
      draw(performance.now());
    }
  };

  /** An animation frame from the browser, capped at the panel rate. */
  const frame = (now: number): void => {
    frameId = null;
    if (lastFrameMs !== null && now - lastFrameMs < minFrameMs) {
      requestFrame(); // Faster than the panel: wait for the next one.
      return;
    }
    draw(now);
  };

  /** Update, draw, and decide when the next frame is needed. */
  const draw = (now: number): void => {
    const dt = lastFrameMs === null ? 0 : Math.min(now - lastFrameMs, LOOP.maxFrameMs) / 1000;
    lastFrameMs = now;

    perf?.beginFrame();
    game.update(dt);
    game.render();
    perf?.endFrame();
    hud.update();
    screens.sync();

    if (!firstFrameDrawn) {
      firstFrameDrawn = true;
      // The real scene is on screen: retire the HTML boot glow, and mark the moment so a load
      // test can read time-to-first-game-frame from the Performance timeline.
      document.querySelector('#boot-glow')?.remove();
      performance.mark('wisp-first-frame');
    }

    const wake = nextWake({
      animating: game.isAnimating(),
      focusing: game.getMode() === 'focusing',
      remainingSeconds: game.getRemainingSeconds(),
    });
    if (wake.kind === 'frame') {
      requestFrame();
    } else if (wake.kind === 'timer') {
      timerId = setTimeout(runNow, wake.delayMs);
    } else {
      lastFrameMs = null;
    }
  };

  // Anything that can change the scene runs a frame. Game registered its input handlers first, so
  // the state has already changed when these run.
  input.on('pinchTap', runNow);
  input.on('dpadSwipe', runNow);
  window.addEventListener('popstate', runNow);

  // Backgrounded: nothing runs at all. Back in front: one frame to catch up (a session may have
  // finished meanwhile), then the normal policy.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      lastFrameMs = null;
      log.flush();
    } else {
      runNow();
    }
  });

  runNow();
}

main();
