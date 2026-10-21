/**
 * Make the one file to upload to our own server (magetechcorp.com), from the single-file build.
 *
 * Usage: node scripts/make-deploy-file.mjs   (run after `npm run build` and `npm run package`)
 * Output: dist/deploy/wisp.html
 *
 * Our server serves each app as one HTML file at a path with no trailing slash (like /sharp), so
 * any relative URL in the page resolves against the site root. The packager's
 * `<link rel="manifest" href="manifest.webmanifest">` would therefore request
 * magetechcorp.com/manifest.webmanifest on every load and get a 404. The glasses don't need a
 * manifest, so this copy drops the link. Everything else (scripts, styles, the PNG favicon) is
 * already inlined. The game also skips its offline cache when run as a single file (see main.ts).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const source = join('dist', 'index.single.html');
const outDir = join('dist', 'deploy');
const out = join(outDir, 'wisp.html');

const html = readFileSync(source, 'utf8');
const manifestLink = /<link\s+rel="manifest"[^>]*>\s*/gi;
const cleaned = html.replace(manifestLink, '');

// Fail closed: the upload must not reference any other file.
const external = [...cleaned.matchAll(/\s(?:src|href)="(?!data:|#)([^"]+)"/gi)].map((m) => m[1]);
if (external.length > 0) {
  console.error(`[make-deploy-file] FAILED: page still references other files: ${external.join(', ')}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(out, cleaned);
console.log(`[make-deploy-file] wrote ${out} (${cleaned.length} bytes, no external files)`);
