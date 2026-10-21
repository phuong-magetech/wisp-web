# Wisp

A quiet focus companion for Meta Display Glasses: a small glowing creature on the lens, fed by
your focus. Built with Vite + TypeScript, drawn with CSS shapes (no WebGL). How the game works is
in [`docs/design.md`](docs/design.md).

## Requirements

- Node.js >= 18
- On Windows PowerShell, use `npm.cmd` and `npx.cmd` if running scripts is disabled
  (`npm.ps1 cannot be loaded`).

## Getting started

```bash
npm install
npm run dev     # open the printed localhost URL in a desktop browser
```

Controls (desktop): **← / →** choose Focus or Pet, **Enter** presses it (the stand-in for the
index pinch), **↑ / ↓** pets Wisp. Add `?debug` to the URL for 30-second focus sessions.

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server with hot reload. **Not** for performance tests: it serves unbundled source |
| `npm run typecheck` | Type-check (`tsc --noEmit`) |
| `npm test` | All unit tests: the game's plus the framework's |
| `npm run test:game` | Only this game's tests |
| `npm run test:framework` | Only the framework tests that shipped with the scaffold |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run validate` | Project rule checks (input, localization, network loads, logging, display, layers, drag) |
| `npm run deploy-file` | Build, then write **`dist/deploy/wisp.html`**: the one file to upload to our server |

## Project layout

```
src/
  index.html      page shell: the #world layer (Wisp's shapes) + the DOM HUD, inline boot glow
  style.css       additive-display theme (black page, 18px minimum text)
  main.ts         entry: wires renderer + input + game; event-driven frame scheduling
  models.ts       Wisp's shapes: radius, color, stacking order
  core/           gameplay: Game, FocusSession, growth/mood rules, WispMemory, wake policy
  config/         all tunable numbers
  hud/            DOM output: HUD, CssRenderer (draws Wisp), ScreenHistory (URLs + Back)
  i18n/           UI strings (en.json) + i18next bootstrap
  framework/      managed engine code from the plugin. Don't hand-edit
public/favicon.png  192x192 PNG favicon
scripts/          project checks, the single-file packager, make-deploy-file.mjs
docs/design.md    the design doc: controls, screens, rendering, frames, performance
```

## Deploying to our server

Wisp is hosted like our other glasses apps (e.g. `https://magetechcorp.com/sharp`): one
self-contained HTML file served at a path with no trailing slash.

1. `npm run deploy-file` (PowerShell: `npm.cmd run deploy-file`).
2. Upload `dist/deploy/wisp.html` and serve it at e.g. `https://magetechcorp.com/wisp`, the same
   way as sharp: `Content-Type: text/html`, gzip on, `Cache-Control: no-cache`.

The file has everything inlined (scripts, styles, the PNG favicon) and references no other file,
so it works at a path without a trailing slash. It makes one request (about 32 KB gzipped). As a
single file it doesn't install the offline cache. On the glasses, add `?stats` to the URL for live
FPS on the lens, or `?debug` for 30-second sessions.

The multi-file build in `dist/` (with `sw.js` for offline launches) and `vercel.json` came with the
template and aren't used for our server.

## Architecture

Gameplay is renderer- and input-agnostic: it talks only to the framework's `Renderer` and
`InputManager` interfaces, so it is unit-tested with fakes. See `CLAUDE.md` for the boundaries.

## License

**Your game is unlicensed** — no terms are imposed on the code you write. Add whatever license you
want, or none.

The one exception is `src/framework/`, the managed engine code this project was scaffolded with.
That is Meta-copyrighted and BSD-licensed, and its terms are in `src/framework/LICENSE`. Keep that
file, and any per-file notices your copy carries, if you redistribute the framework sources.
