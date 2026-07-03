#!/usr/bin/env node
/**
 * `scripts/check-build-artifacts.mjs` — S9-deferred SC-009 guard.
 *
 * ## Why this script exists
 *
 * S9 (issue #10) established a code-split contract: the r3f + three
 * bundle (~500 KB before gzip) MUST land in a SEPARATE `dist/` chunk
 * from the shell UI so TTI can meet SC-009's 3 s target. S9 shipped
 * without a build-artifacts test because `App.tsx` didn't yet
 * lazy-import `DeckScene` (nothing to enforce). S12 lands the lazy
 * import (via `React.lazy(() => import('./scene/DeckScene'))`) — so
 * NOW is when the artifacts test is meaningful.
 *
 * ## Invariants checked
 *
 * After `npm run build`, `dist/assets/` MUST contain:
 *
 *   1. A `r3f-*.js` chunk (the r3f + three bundle — gate against
 *      regressions in `vite.config.ts` `manualChunks`).
 *   2. A `DeckScene-*.js` chunk (proves the `React.lazy(() =>
 *      import('./scene/DeckScene'))` in App.tsx split the scene
 *      into its own chunk).
 *   3. An `index-*.js` chunk (the shell) whose GZIPPED SIZE is
 *      under {@link SHELL_JS_GZIP_BUDGET_BYTES}.
 *   4. The shell chunk must NOT bundle three/r3f — asserted by a
 *      simple string-grep for `THREE.PerspectiveCamera` / similar
 *      identifiers inside the shell chunk.
 *
 * ## SC-009 shell budget
 *
 * The gzipped size cap for the shell `index-*.js` is currently
 * {@link SHELL_JS_GZIP_BUDGET_BYTES} bytes (150 KB) — chosen to
 * leave slack for the S13/S14 panels while keeping TTI well under
 * SC-009's 3 s on a 4G connection (150 KB ≈ 200 ms transfer + 300
 * ms parse+eval on a mid-tier phone ≈ 500 ms TTI budget spent on
 * JS, leaving 2.5 s for React hydration + first paint).
 *
 * If the budget is intentionally raised in a future PR, update
 * this constant + the accompanying comment; the raise is a
 * DELIBERATE decision, not a silent regression.
 *
 * ## Why a node script, not a vitest test
 *
 * A vitest test would either (a) need to run AFTER `npm run build`
 * (vitest is INSIDE the CI test step, which runs BEFORE build) or
 * (b) invoke `vite build` internally (slow, hides errors). A plain
 * node script invoked as its own CI step is the cleanest split of
 * concerns — see `.github/workflows/ci.yml`.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST_ASSETS = resolve(ROOT, 'dist', 'assets');

// ---------------------------------------------------------------------------
// SC-009 budget — see module header for the rationale.
// ---------------------------------------------------------------------------

/**
 * Maximum acceptable gzipped size for the shell `index-*.js`
 * chunk, in bytes. Chosen to keep SC-009 TTI ≤ 3 s on a 4G
 * connection with slack for S13/S14 panels. 150 KB gzipped ≈
 * 500 ms JS transfer + parse + eval on a mid-tier device.
 *
 * If you raise this, update the module-header comment + note the
 * reason in the commit message.
 */
const SHELL_JS_GZIP_BUDGET_BYTES = 150 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find one file in `dist/assets/` whose name starts with `prefix`
 * and ends with `.js` (not `.js.map`). Throws if there is not
 * exactly ONE match — vite hash suffixes vary but there should be
 * exactly one chunk per manual-chunk name at build time.
 */
async function findChunk(files, prefix) {
  const matches = files.filter(
    (f) => f.startsWith(prefix) && f.endsWith('.js') && !f.endsWith('.js.map'),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one \`dist/assets/${prefix}*.js\` chunk, found ${matches.length}: ${matches.join(', ')}`,
    );
  }
  return matches[0];
}

async function readGzippedSize(path) {
  const buf = await readFile(path);
  return gzipSync(buf).length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Verify dist/assets exists — otherwise the caller forgot to
  // build.
  try {
    const s = await stat(DIST_ASSETS);
    if (!s.isDirectory()) {
      throw new Error(`${DIST_ASSETS} exists but is not a directory`);
    }
  } catch (err) {
    console.error(
      `[artifacts] dist/assets not found — run \`npm run build\` first.\n${String(err)}`,
    );
    process.exit(2);
  }

  const files = await readdir(DIST_ASSETS);

  // 2. Locate the three chunks we require by name prefix.
  const shellFile = await findChunk(files, 'index-');
  const r3fFile = await findChunk(files, 'r3f-');
  const sceneFile = await findChunk(files, 'DeckScene-');

  // 3. Shell must NOT drag three/r3f into its bundle. Grep for a
  // handful of identifiers that survive minification — three's
  // `PerspectiveCamera` and r3f's `useThree` are both stable
  // named-export identifiers. If they appear in the shell chunk,
  // the manual-chunk split has regressed.
  const shellText = await readFile(resolve(DIST_ASSETS, shellFile), 'utf-8');
  const leakedThreeSymbols = ['PerspectiveCamera', 'OrbitControls', 'THREE.Mesh'].filter((sym) =>
    shellText.includes(sym),
  );
  if (leakedThreeSymbols.length > 0) {
    console.error(
      `[artifacts] Shell chunk ${shellFile} leaks three.js symbols: ${leakedThreeSymbols.join(', ')}`,
    );
    console.error(
      '           This means the vite manualChunks split has regressed and the shell now drags three/r3f into the initial bundle.',
    );
    process.exit(1);
  }

  // 4. Assert the shell chunk stays under budget.
  const shellGzip = await readGzippedSize(resolve(DIST_ASSETS, shellFile));
  const r3fGzip = await readGzippedSize(resolve(DIST_ASSETS, r3fFile));
  const sceneGzip = await readGzippedSize(resolve(DIST_ASSETS, sceneFile));

  console.log('[artifacts] Chunk sizes (gzipped):');
  console.log(`  shell  ${shellFile}: ${(shellGzip / 1024).toFixed(2)} KB (budget: ${SHELL_JS_GZIP_BUDGET_BYTES / 1024} KB)`);
  console.log(`  r3f    ${r3fFile}: ${(r3fGzip / 1024).toFixed(2)} KB (separate chunk ✓)`);
  console.log(`  scene  ${sceneFile}: ${(sceneGzip / 1024).toFixed(2)} KB (separate chunk ✓)`);

  if (shellGzip > SHELL_JS_GZIP_BUDGET_BYTES) {
    console.error(
      `[artifacts] SC-009 FAIL: shell gzipped size (${shellGzip} B = ${(shellGzip / 1024).toFixed(2)} KB) exceeds budget of ${SHELL_JS_GZIP_BUDGET_BYTES} B = ${SHELL_JS_GZIP_BUDGET_BYTES / 1024} KB.`,
    );
    console.error(
      '           Either code-split the offending imports out of the shell, or (if the growth is intentional) raise SHELL_JS_GZIP_BUDGET_BYTES in scripts/check-build-artifacts.mjs and document the reason.',
    );
    process.exit(1);
  }

  console.log('[artifacts] All build-artifact invariants satisfied. ✅');
}

main().catch((err) => {
  console.error(`[artifacts] Unexpected error: ${String(err instanceof Error ? err.stack : err)}`);
  process.exit(3);
});
