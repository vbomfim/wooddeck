#!/usr/bin/env node
/**
 * `scripts/check-build-artifacts.mjs` — SC-009 code-split + TTI-budget guard.
 *
 * ## Why this script exists
 *
 * S9 (issue #10) established a code-split contract: the r3f + three
 * bundle (~500 KB before gzip) MUST NOT be on the TTI-blocking
 * critical path so SC-009's 3 s TTI budget is achievable. S12 lands
 * the lazy import (`React.lazy(() => import('./scene/DeckScene'))`)
 * and the AppShell; NOW is when the artifact guard is meaningful.
 *
 * ## The regression this guard exists to catch
 *
 * The S12 first-pass artifact check ONLY looked at the shell FILE
 * size (`index-*.js` gzipped < budget) and rubber-stamped the split.
 * A live browser UAT (S12 review pair-fix iter 1, GPT#1/Opus#3)
 * revealed the check was a false positive:
 *
 *   1. The shell `index-*.js` chunk contained a STATIC ESM import
 *      of `r3f-*.js` — because Rolldown 1.x's naive `manualChunks`
 *      hoisted React into the r3f chunk (the shell needed React,
 *      therefore had to import r3f statically). `React.lazy()` was
 *      a no-op — the browser evaluated the whole r3f bundle on TTI.
 *   2. `dist/index.html` emitted a `<link rel="modulepreload">` for
 *      the r3f chunk, so even if #1 had been fixed, the browser
 *      would still eagerly fetch r3f during initial page load.
 *
 * Both #1 and #2 defeat the code-split. The FIX (in `vite.config.ts`)
 * is Rolldown's `advancedChunks.groups` with priorities — react-vendor
 * (priority 20) claims React/scheduler/zustand/use-sync-external-store
 * BEFORE r3f (priority 10) can, so r3f only contains three + @react-
 * three. This script asserts BOTH conditions hold in the built output.
 *
 * ## Invariants checked
 *
 *   1. `dist/assets/` contains the expected named chunks:
 *      - `index-*.js` (shell entry)
 *      - `react-vendor-*.js` (React + scheduler + zustand)
 *      - `r3f-*.js` (three + @react-three)
 *      - `DeckScene-*.js` (proves `React.lazy()` split fired)
 *   2. The shell `index-*.js` chunk has NO static ESM import of
 *      r3f or three chunks. (Parses `import ... from './r3f-*.js'`.)
 *   3. `dist/index.html` has NO `<link rel="modulepreload">` for
 *      r3f or three chunks. (Parses `<link>` tags.)
 *   4. Total INITIAL JS (shell + everything the shell transitively
 *      static-imports, per the resolved import graph in the built
 *      output) is under {@link INITIAL_JS_GZIP_BUDGET_BYTES}.
 *   5. Sanity: no three.js identifiers survive minification in
 *      the shell chunk (backup grep in case the import parser is
 *      fooled by unusual syntax).
 *
 * ## Budgets
 *
 * See `INITIAL_JS_GZIP_BUDGET_BYTES` and `SHELL_JS_GZIP_BUDGET_BYTES`
 * for rationale and raise-conditions.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = resolve(ROOT, 'dist');
const DIST_ASSETS = resolve(DIST, 'assets');

// ---------------------------------------------------------------------------
// SC-009 budgets
// ---------------------------------------------------------------------------

/**
 * Maximum acceptable gzipped size for the shell `index-*.js`
 * chunk (the entry that contains our app code, minus vendor deps),
 * in bytes. Shell = ~50 KB gz today; 100 KB gives headroom for
 * S13/S14 panels without permitting a runaway.
 *
 * Raising this constant is a DELIBERATE decision: update the
 * comment + note the reason in the commit message.
 */
const SHELL_JS_GZIP_BUDGET_BYTES = 100 * 1024;

/**
 * Maximum acceptable gzipped size for TOTAL INITIAL JS — the
 * shell chunk PLUS everything it statically imports (react-vendor
 * + runtime today). This is the number that actually matters for
 * SC-009 TTI (a 4G connection has to fetch + parse ALL of it
 * before React hydrates). The prior check only budgeted the shell
 * file, which is why the S12 pair-fix caught a case where the
 * shell was 100 KB but total initial JS was 340 KB (r3f had been
 * silently hoisted onto the critical path).
 *
 * Budget rationale: SC-009 targets ≤3 s TTI on a 4G phone. 175 KB
 * gz ≈ 250 ms transfer + ~500 ms parse+eval on a mid-tier device
 * ≈ 750 ms JS overhead, leaving 2.25 s for network round-trips,
 * DOM construction, and React hydration. Current usage ≈112 KB gz,
 * so ~63 KB gz of slack for S13/S14.
 */
const INITIAL_JS_GZIP_BUDGET_BYTES = 175 * 1024;

// Chunks that MUST be lazy — i.e. no static import from the shell
// entry, and no modulepreload hint in index.html.
const LAZY_CHUNK_PATTERNS = [
  /^r3f-.*\.js$/, // three + @react-three (~235 KB gz)
  /^three-.*\.js$/, // reserved: if we ever split three separately
  /^DeckScene-.*\.js$/, // scene composition root
  /^layers-.*\.js$/, // scene layer bundle
  /^WarningOverlay-.*\.js$/, // scene warning overlay
];

// Stable r3f/three named exports that survive minification —
// tripwire against a manualChunks regression that silently
// merges three into the shell.
const SHELL_FORBIDDEN_SYMBOLS = [
  'PerspectiveCamera', // three
  'OrbitControls', // drei / three-stdlib
  'useThree', // r3f fiber
  'useFrame', // r3f fiber
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find one file in `dist/assets/` whose name starts with `prefix`
 * and ends with `.js` (not `.js.map`). Throws if there is not
 * exactly ONE match — vite hash suffixes vary but there should be
 * exactly one chunk per named group at build time.
 */
function findChunk(files, prefix) {
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

/**
 * Extract the set of ESM static-import targets from a built JS
 * chunk. Rolldown emits imports as `import{...}from"./name.js"`
 * (double-quoted) or `import"./name.js"` for side-effect only;
 * both are matched. Returns the basenames referenced.
 */
function parseStaticImports(source) {
  const targets = new Set();
  // `import ... from '...'` (with any binding form on the LHS)
  const fromRx = /import\s*(?:[^'"()]*?)\s*from\s*['"]([^'"]+)['"]/g;
  // Bare `import '...';` (side-effect)
  const bareRx = /import\s*['"]([^'"]+)['"]/g;
  for (const rx of [fromRx, bareRx]) {
    let m;
    while ((m = rx.exec(source)) !== null) {
      // Strip any leading `./` — we compare basenames.
      targets.add(basename(m[1]));
    }
  }
  return targets;
}

/**
 * Extract the set of `<link rel="modulepreload">` hrefs from an
 * HTML document. Returns the basenames referenced.
 */
function parseModulePreloads(html) {
  const targets = new Set();
  // Attribute order isn't guaranteed. Match modulepreload links
  // and pull their href out with a second regex.
  const linkRx = /<link\b[^>]*rel=(?:"|')modulepreload(?:"|')[^>]*>/g;
  const hrefRx = /href=(?:"|')([^"']+)(?:"|')/;
  let m;
  while ((m = linkRx.exec(html)) !== null) {
    const href = hrefRx.exec(m[0]);
    if (href) targets.add(basename(href[1]));
  }
  return targets;
}

function matchesAny(name, patterns) {
  return patterns.some((p) => p.test(name));
}

function fail(message, hint) {
  console.error(`[artifacts] ${message}`);
  if (hint) console.error(`           ${hint}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Verify dist/ exists — otherwise the caller forgot to build.
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

  // 2. Locate the required chunks.
  const shellFile = findChunk(files, 'index-');
  const reactVendorFile = findChunk(files, 'react-vendor-');
  const r3fFile = findChunk(files, 'r3f-');
  const sceneFile = findChunk(files, 'DeckScene-');

  const shellPath = resolve(DIST_ASSETS, shellFile);
  const shellText = await readFile(shellPath, 'utf-8');

  // 3. Shell must NOT statically import any lazy chunk.
  const shellImports = parseStaticImports(shellText);
  const shellLazyImports = [...shellImports].filter((name) =>
    matchesAny(name, LAZY_CHUNK_PATTERNS),
  );
  if (shellLazyImports.length > 0) {
    fail(
      `Shell chunk ${shellFile} STATICALLY imports lazy chunk(s): ${shellLazyImports.join(', ')}`,
      "This means React.lazy() didn't actually split — the heavy 3D stack is on the TTI-blocking critical path. Check `vite.config.ts` `advancedChunks.groups`: a shared dep (React/zustand/use-sync-external-store) probably got hoisted into r3f. See the script header for the S12 regression story.",
    );
  }

  // 4. index.html must NOT modulepreload any lazy chunk.
  const html = await readFile(resolve(DIST, 'index.html'), 'utf-8');
  const preloads = parseModulePreloads(html);
  const preloadedLazy = [...preloads].filter((name) => matchesAny(name, LAZY_CHUNK_PATTERNS));
  if (preloadedLazy.length > 0) {
    fail(
      `dist/index.html has \`<link rel="modulepreload">\` for lazy chunk(s): ${preloadedLazy.join(', ')}`,
      'Even though the shell doesn\'t statically import these, the browser will eagerly fetch them on initial page load — undermining the code-split. Rolldown auto-emits modulepreload hints for every chunk transitively reachable from the entry\'s STATIC imports; the fact that r3f appears here means it\'s still a static dep. Recheck `vite.config.ts` `advancedChunks.groups`.',
    );
  }

  // 5. Backup: grep the shell for known three/r3f identifiers that
  // survive minification. Belt-and-braces in case the import
  // parser is fooled by unusual syntax.
  const leakedSymbols = SHELL_FORBIDDEN_SYMBOLS.filter((sym) => shellText.includes(sym));
  if (leakedSymbols.length > 0) {
    fail(
      `Shell chunk ${shellFile} contains three/r3f identifiers: ${leakedSymbols.join(', ')}`,
      "manualChunks/advancedChunks may have split the entry point, but three/r3f code is still landing in the shell. Verify that all scene/* imports go through `React.lazy(() => import('./scene/...'))` — a static top-level import bypasses the split.",
    );
  }

  // 6. Compute per-chunk gzip sizes AND total initial-load size.
  // Initial load = shell + everything the shell transitively
  // static-imports. Walk the graph via `parseStaticImports` until
  // fixpoint, staying within `dist/assets/`.
  const knownChunks = new Set(
    files.filter((f) => f.endsWith('.js') && !f.endsWith('.js.map')),
  );
  const initialLoad = new Set([shellFile]);
  const queue = [shellFile];
  while (queue.length > 0) {
    const current = queue.shift();
    const text = await readFile(resolve(DIST_ASSETS, current), 'utf-8');
    for (const target of parseStaticImports(text)) {
      if (knownChunks.has(target) && !initialLoad.has(target)) {
        initialLoad.add(target);
        queue.push(target);
      }
    }
  }

  const initialSizes = [];
  let totalInitialGzip = 0;
  for (const chunk of initialLoad) {
    const size = await readGzippedSize(resolve(DIST_ASSETS, chunk));
    initialSizes.push({ chunk, gzip: size });
    totalInitialGzip += size;
  }

  const shellGzip = await readGzippedSize(shellPath);
  const r3fGzip = await readGzippedSize(resolve(DIST_ASSETS, r3fFile));
  const sceneGzip = await readGzippedSize(resolve(DIST_ASSETS, sceneFile));
  const reactVendorGzip = await readGzippedSize(resolve(DIST_ASSETS, reactVendorFile));

  console.log('[artifacts] Chunk sizes (gzipped):');
  console.log(
    `  shell            ${shellFile}: ${(shellGzip / 1024).toFixed(2)} KB (budget: ${SHELL_JS_GZIP_BUDGET_BYTES / 1024} KB)`,
  );
  console.log(`  react-vendor     ${reactVendorFile}: ${(reactVendorGzip / 1024).toFixed(2)} KB`);
  console.log(`  r3f  (lazy)      ${r3fFile}: ${(r3fGzip / 1024).toFixed(2)} KB`);
  console.log(`  scene (lazy)     ${sceneFile}: ${(sceneGzip / 1024).toFixed(2)} KB`);
  console.log('[artifacts] Initial-load JS (shell + static imports, gzipped):');
  for (const { chunk, gzip } of initialSizes) {
    console.log(`  ${chunk}: ${(gzip / 1024).toFixed(2)} KB`);
  }
  console.log(
    `  TOTAL: ${(totalInitialGzip / 1024).toFixed(2)} KB (budget: ${INITIAL_JS_GZIP_BUDGET_BYTES / 1024} KB)`,
  );

  // 7. Enforce shell budget.
  if (shellGzip > SHELL_JS_GZIP_BUDGET_BYTES) {
    fail(
      `SC-009 FAIL: shell gzipped size (${(shellGzip / 1024).toFixed(2)} KB) exceeds budget of ${SHELL_JS_GZIP_BUDGET_BYTES / 1024} KB.`,
      'Either code-split the offending imports out of the shell, or (if the growth is intentional) raise SHELL_JS_GZIP_BUDGET_BYTES + document the reason.',
    );
  }

  // 8. Enforce total initial-load budget.
  if (totalInitialGzip > INITIAL_JS_GZIP_BUDGET_BYTES) {
    fail(
      `SC-009 FAIL: total initial JS (${(totalInitialGzip / 1024).toFixed(2)} KB) exceeds budget of ${INITIAL_JS_GZIP_BUDGET_BYTES / 1024} KB.`,
      'Something new is being static-imported by the shell — check the list of chunks above. Either lazy-import the offender, or (if intentional) raise INITIAL_JS_GZIP_BUDGET_BYTES + document.',
    );
  }

  console.log('[artifacts] All build-artifact invariants satisfied. ✅');
}

main().catch((err) => {
  console.error(`[artifacts] Unexpected error: ${String(err instanceof Error ? err.stack : err)}`);
  process.exit(3);
});
