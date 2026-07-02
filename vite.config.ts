/// <reference types="vitest/config" />
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
export default defineConfig({
  plugins: [react()],
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
