// ESLint flat config for wooddeck.
//
// - typescript-eslint **recommendedTypeChecked** rule set + `projectService`
//   so type-aware rules (no-floating-promises, no-misused-promises, etc.)
//   actually run against every .ts/.tsx file. The type-aware analyzer is
//   slower than parser-only but the codebase is small and the safety
//   payoff on a strict TS 6 greenfield is worth it.
// - React Hooks + React Refresh (Vite HMR) rules.
// - Prettier compatibility (`eslint-config-prettier` last — disables
//   stylistic rules that would fight the formatter).
// - **`src/domain/**` override** that hard-bans DOM globals AND framework
//   imports (react/react-dom/three/@react-three/*/@testing-library/*/jsdom).
//   This mirrors the `.dependency-cruiser.cjs` framework-ban rule with
//   defence-in-depth: even if the dep-cruiser rule were misconfigured,
//   ESLint would still catch the leak (spec § NFR-010).
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Browser-only globals that MUST NOT appear in `src/domain/**` — spec §
// NFR-010 requires the domain layer to be unit-testable with no DOM.
// Keep this list narrow and browser-only; do not include names that are
// also Node built-ins (e.g. `URL`, `fetch` post-Node-18) unless we
// consciously want to ban them.
const BROWSER_ONLY_GLOBALS = [
  'document',
  'window',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLDocument',
  'Element',
  'Node',
  'Event',
  'EventTarget',
  'XMLHttpRequest',
  'WebSocket',
  'alert',
  'confirm',
  'prompt',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
  'PerformanceObserver',
  'Storage',
  'FileReader',
  'Image',
  'CustomEvent',
];

const FRAMEWORK_IMPORT_PATTERNS = [
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'three',
  'three/*',
  '@react-three/*',
  '@testing-library/*',
  'jsdom',
  'jsdom/*',
];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '.vite', 'scripts/**/tmp/**'] },

  // Type-aware config for source .ts/.tsx
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      parserOptions: {
        // `projectService: true` = the new (typescript-eslint 8) fast
        // auto-detection of the nearest tsconfig; avoids maintaining a
        // separate `project` array as new files land.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Domain layer override — enforce spec § NFR-010 (no framework, no DOM).
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...BROWSER_ONLY_GLOBALS.map((name) => ({
          name,
          message:
            `spec § NFR-010: '${name}' is a DOM/browser global and must not appear in src/domain/**. ` +
            `Move DOM-touching code to src/scene/, src/ui/, or src/persistence/.`,
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: FRAMEWORK_IMPORT_PATTERNS.map((pattern) => ({
            group: [pattern],
            message:
              'spec § NFR-010: src/domain/** MUST stay framework-free (no react/three/DOM/test libs). ' +
              'Move the framework-touching code to the appropriate adapter layer.',
          })),
        },
      ],
    },
  },

  // Config files (JS, ESM) — parser-only, no type-aware rules.
  {
    files: ['*.{js,cjs,mjs}', 'scripts/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  prettier,
);
