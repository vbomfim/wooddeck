/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// wooddeck Vite config
// - React plugin (JSX, HMR)
// - Code-splitting readiness: manualChunks groups the (future) 3D stack so
//   the eventual r3f Canvas chunk lazy-loads independently of the shell UI.
//   The scene itself is not yet mounted (that's Story 9); this config just
//   ensures the split points are in place when it lands.
// - Vitest config lives here (no separate vitest.config.ts) to keep a single
//   source of truth for tsconfig, path aliases, and env — see WD-S1 decision.
// - `__WOODDECK_VERSION__` is a build-time constant injected via `define`
//   so `src/persistence/deck-file/schema-v1.ts` can stamp every generated
//   `.deck` file with the producing wooddeck version WITHOUT importing
//   `package.json` at runtime (that would leak devDependency metadata
//   into the client bundle). The token is declared as an ambient global
//   in `src/persistence/deck-file/schema-v1.ts`; a `globalThis` fallback
//   handles the (should-be-unreachable) case where the define didn't run.
const configDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(configDir, 'package.json'), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    __WOODDECK_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    // Pair-fix iter 1 — Nit L. Every three.js API surface must
    // resolve to the SAME module instance. Without dedupe, npm has
    // multiple three copies (stats-gl@2.4.2 pins three@0.170.0
    // while everything else pins 0.185.1) → console warnings
    // "Multiple instances of Three.js" AND — more insidiously —
    // `instanceof PerspectiveCamera` returning FALSE under test
    // even when the object IS a PerspectiveCamera (different
    // module = different constructor identity). The alias forces
    // ANY import of `three` to resolve to the top-level 0.185.1
    // instance; dedupe backs that up for indirect resolvers.
    dedupe: ['three'],
    alias: {
      three: resolve(configDir, 'node_modules/three'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Chunk strategy — pair-fix iter 1 (S12 review, GPT#1/Opus#3).
        //
        // Original naive `manualChunks(id)` returned 'r3f' for three/
        // @react-three and undefined for everything else. Rolldown 1.x's
        // automatic chunker then hoisted React, scheduler, zustand, and
        // use-sync-external-store into the r3f chunk (r3f is the biggest
        // consumer). Result: the shell entry STATICALLY imported r3f
        // (`import{d as a,p as o,u as s}from"./r3f-*.js"` in
        // dist/assets/index-*.js), `React.lazy(() => import(DeckScene))`
        // was a no-op, and index.html modulepreloaded ~235KB gzip of
        // three.js at TTI.
        //
        // Even after switching to per-id manualChunks that assigned React
        // to a 'react-vendor' chunk, Rolldown still promoted the shared
        // React internals to the r3f chunk (a known Rolldown 1.x
        // limitation with `manualChunks` — see
        // https://github.com/vitejs/vite/issues/17348 and Rolldown's
        // migration notes recommending `advancedChunks.groups` instead).
        //
        // The fix: use Rolldown's first-class `advancedChunks.groups`
        // with PRIORITIES. Higher-priority groups claim modules first,
        // and matching modules are REMOVED from lower-priority groups.
        // - react-vendor (prio 20) — React runtime, scheduler,
        //   zustand vanilla+react hooks, use-sync-external-store.
        //   Needed by shell for TTI, and by r3f — but shell must own it.
        // - r3f (prio 10) — three + @react-three/fiber + drei.
        //   ONLY loaded when React.lazy(() => import('./scene/DeckScene'))
        //   fires (i.e. after first paint).
        //
        // The artifact guard (scripts/check-build-artifacts.mjs) asserts
        // (a) shell has no static import of r3f/three chunks and
        // (b) index.html has no modulepreload of r3f/three, so a
        // regression that re-hoists r3f to the shell breaks CI.
        //
        // NOTE on the `three` chunk vs `r3f` chunk: pre-S12 comment
        // claimed three would emit as its own `three-*.js` chunk;
        // rolldown never did (three is a static dep of r3f with a
        // 1:1 loading pattern, so it always co-loaded). We now
        // co-locate them intentionally: they always ship together,
        // so an extra HTTP round-trip is pure cost.
        advancedChunks: {
          groups: [
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/,
              priority: 20,
            },
            {
              name: 'r3f',
              test: /[\\/]node_modules[\\/](three|@react-three)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
    },
  },
});
