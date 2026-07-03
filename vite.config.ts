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
        // Function form (portable across Vite's rollup/rolldown backends):
        // group heavy 3D deps into their own chunks so the future r3f scene
        // can be lazy-loaded via React.lazy() in Story S9 without dragging
        // three/drei into the initial bundle.
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/three/')) return 'three';
          if (
            id.includes('node_modules/@react-three/fiber') ||
            id.includes('node_modules/@react-three/drei')
          ) {
            return 'r3f';
          }
          return undefined;
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
