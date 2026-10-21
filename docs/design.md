# Wisp — design

The web prototype of Wisp for Meta Display Glasses. The full product vision lives in
[`../../Design/wisp-app-design.md`](../../Design/wisp-app-design.md). This doc covers what this
build actually does.

## Concept

A small glowing companion in the 600x600 window, fed by your focus. You start a focus session and
Wisp works alongside you. Every focused minute, including partial sessions, slowly grows it. You
can pet it. It never nags, never shames, and never dies.

## Design rules (from the product doc)

- No streak-shame. No dead pet: wistful, never gone. No notifications, ever.
- Partial sessions always count. No anti-cheat: there is nothing to defraud.
- The window brightens only with your action. At rest, Wisp is dim and still.

## Core loop

Glance → press **Focus** → Wisp tucks in, closes its eyes, and a ring of dots fills clockwise →
the session completes (or you press **Stop**) → "+N min" shows briefly → Wisp is a little bigger
and brighter over the weeks.

## Controls

Tap-only. No drag channel. Two on-screen controls, **[Focus]** and **[Pet]**, below Wisp.

| Input | Desktop | Does |
|---|---|---|
| D-pad left / right | ← / → | Move the selection between [Focus] and [Pet] (stops at the ends) |
| Index pinch (`pinchTap`) | Enter | Press the selected control |
| D-pad up / down | ↑ / ↓ | Pet Wisp directly ("a silent stroke") |

- **[Focus]** starts a session. While a session runs, it reads **[Stop]** and ends it early. The
  time still counts.
- **[Pet]** pets Wisp: it squashes, stretches and brightens, silently.
- Browser focus always follows the selection, with a bright outline, so the focused control is
  what a pinch presses.
- Gestures go only through the framework's InputManager, never DOM listeners. The one exception
  is by design: [Focus] is a real link to `#focus`, so a mouse click or scripted click is an
  ordinary browser navigation (see [Screens and history](#screens-and-history)).

## Screens and history

Two screens, each with its own URL:

- **Home:** `/` (plus any query, e.g. `?debug`).
- **Focus session:** `#focus`.

`src/hud/ScreenHistory.ts` keeps browser history in step with the game:

- Starting a session pushes a `#focus` entry. Browser **Back** ends the session, crediting the
  time.
- When the session ends inside the game ([Stop] or the timer), the app steps back itself, so old
  focus screens don't pile up in history.
- Moving the selection and petting never add history entries.
- A reload during a session keeps the session and puts a home entry beneath it.

## Focus sessions

- 25 minutes (`SESSION.durationSeconds`). With `?debug`, 30 seconds.
- Timed by the **wall clock**, not by frames. Frames stop while the app is in the background,
  but the session keeps counting. A session running when the app closes is resumed on the next
  launch, or credited if it finished meanwhile.
- Credit is the focused seconds, capped at the session length.

## Growth and mood

- Stages by total focused minutes: 0 / 25 / 100 / 300 (`GROWTH`). Each stage is larger and
  brighter. Growth only goes up.
- Wistful after more than 2 days away (`MOOD`): dimmer, drooping, eyes half closed. Any pinch or
  swipe lifts it.

## Visual style

- 2D, fully procedural: CSS circles, no art files and no WebGL (see [Rendering](#rendering)).
- A pale cyan core with a dimmer blue halo. The eyes are pure black, which is see-through on the
  additive display, so they read as holes in Wisp's light.
- **Still at rest.** No idle drift or breathing. Brightness is opacity over the black page: Wisp
  rests at 55% of its stage glow, flashes to full on an action, and fades back over 4 s.
  `FEEL.breatheAmplitude` (0 = off) adds a gentle breathe, at the cost of a frame every frame.
- HUD: bright text on the transparent page, no fill. The time left sits under the ring, the
  controls below it, a short hint at the bottom. All text is at least 18px (`--text-body`). The
  time left is a bare number; all other text is localized (`src/i18n/en.json`).
- An inline CSS glow in `index.html` shows where Wisp will appear until the first frame draws.
- Favicon: `public/favicon.png`, a 192x192 PNG, inlined into the deploy file. It must be a raster
  image, not SVG, and larger than 52x52 for the single-file packager.

## Rendering

`src/hud/CssRenderer.ts` implements the framework's `Renderer` interface with plain HTML elements:
one absolutely positioned circle per shape, moved with `transform` and faded with `opacity`, the
two properties the GPU compositor animates without repainting. Changes are written in one batch
per frame. `src/models.ts` lists each shape's radius, color and stacking order.

Wisp first used the framework's Three.js renderer. Three.js was about 85% of the script, and its
WebGL setup was most of the startup time on the glasses' link and CPU. Gameplay only talks to the
`Renderer` interface, so it didn't change. Switch back to `ThreeRenderer` if Wisp ever needs real
3D.

## Frame scheduling

Event-driven, not an always-on loop (`src/main.ts`, policy in `src/core/wake.ts`):

| State | Frames |
|---|---|
| At rest | none |
| Pet wiggle, the 4 s fade, the credit message | up to 30 fps (the panel rate; faster displays are capped) |
| Still focus session | one frame per second, as the timer's displayed second changes |

Input, browser Back/Forward, returning to the app and the session tick each run a frame
immediately. Only an ongoing animation waits for `requestAnimationFrame`: a browser may hold
animation frames back when nothing on screen moves, and that once delayed the session tick by
about 9 s.

## Debug flags

- `?debug`: 30-second sessions. In the local multi-file build it also removes the offline cache
  instead of installing it, so every load runs the current build and load tests measure a real
  first visit. The deployed single file never touches caches (see below).
- `?stats`: live FPS and CPU time per frame on the lens. Reads no frames at rest, which is correct.
- `?logview`: the log drawn on the lens.
- `?swreset=1`: clears the offline cache, in the local multi-file build only.

The deployed single file never installs, resets or clears a service worker or cache. All apps on
magetechcorp.com share one origin, and the framework's reset removes every worker and cache on the
origin, which would include other apps'.

## Performance

Deployed as one HTML file (see the README's *Deploying to our server*), measured in headless
Chrome on the glasses' link (500 Kbps, 150 ms) with the CPU slowed 12x: **1 request, 32 KB**,
first paint 0.52 s, Wisp's first frame 1.13 s, slowest frame 15 ms, no long tasks. The single file
has no offline cache, like our other apps; the multi-file build's service worker made repeat
launches draw in about 0.25 s, if that is ever wanted.

The "Glasses Perf Scorecard" grades startup reliably (A). Its jank figure stayed at 45–60%
"dropped" across four very different builds, so it doesn't reflect Wisp's own frame work. Smoothness
still needs checking on the real glasses with `?stats`.

**Measure the production build, not `npm run dev`.** The dev server sends unbundled, unminified
source, about 6.8 MB in 38 requests.

## Persistence

`BrowserKeyValueStore` (namespace `wisp-web`): total focused seconds, last seen time, and a session
in progress. Nothing leaves the device. No backend.

## Assets

`public/favicon.png` only. The game itself is procedural, with no sound and no preloader.

## Scope / milestones

1. **Done: vertical slice.** Focus sessions, partial credit, growth stages, petting, wistful mood,
   persistence.
2. **Done: glasses QA and performance.** D-pad focus navigation, browser history, 18px text,
   PNG favicon, CSS renderer, event-driven frames.
3. Next candidates: a morning greeting, the day's growth at dusk, naming Wisp.

## Out of scope (for now)

Camera "share a moment" (single on-device frame), dusk dreams and memories, the rooted↔roaming
and steady↔spark evolution axes, archetypes, the phone journal, the den, and sound.
