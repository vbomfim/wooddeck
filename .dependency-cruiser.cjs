/**
 * dependency-cruiser boundary rules for wooddeck.
 *
 * Enforces the layer discipline mandated by spec § NFR-011 as an EXACT
 * ALLOWLIST — each `from` layer may import ONLY the modules under its
 * declared allowed set of `^src/*` prefixes. Any `^src/...` import that
 * falls outside the allowed set fires the rule and blocks CI.
 *
 * Allowlist:
 *   domain      → only src/domain/**                 (+ external: no react/three/DOM per NFR-010)
 *   application → only src/(application|domain|persistence)/**
 *   persistence → only src/(persistence|domain)/**
 *   state       → only src/(state|application|domain)/**
 *   scene       → only src/(scene|state|domain)/**
 *   ui          → only src/(ui|state|application|domain)/**
 *
 * Why state does NOT include persistence (revised in S8 pair-fix): the
 * state store needs `instanceof DeckFileError` narrowing on save
 * failures (AC6: storage-full / storage-blocked → ui-store banner).
 * Rather than widen the state allowlist by one entry (which weakens
 * "state routes all I/O through application" from a machine-checked
 * rule to a grep convention), the application barrel now RE-EXPORTS
 * `DeckFileError` from `../persistence`. State imports it via
 * `../application` and the boundary rule stays tight. See
 * `src/application/index.ts` for the re-export.
 *
 * Note on the application → persistence edge: `application/` composes
 * domain use-cases with persistence-layer I/O (see S7 issue #8 §2).
 * Without this edge, `loadDesignFromFile` / `saveDesignToLocalStorage`
 * could not delegate through the persistence barrel — the whole point
 * of the application layer.
 *
 * `App.tsx` and `main.tsx` are the composition root and live OUTSIDE
 * every layer folder — so a layer that tries to reach into the root
 * (e.g. `import '../App'`) will be flagged. That prevents accidental
 * inverted composition.
 *
 * A **framework ban** rule ALSO forbids `domain/` from importing
 * `react` / `react-dom` / `three` / `@react-three/*` / `@testing-library/*`
 * / `jsdom` — belt-and-suspenders alongside the ESLint override on
 * `src/domain/**` (see `eslint.config.js`).
 *
 * PRIOR BUG NOTE (fixed): the earlier config had `options.includeOnly:
 * '^src/'`, which stripped npm packages from the graph entirely and
 * left `domain-no-react-three-dom` as a silent no-op. The graph must
 * INCLUDE npm edges (via `to.dependencyTypes: npm*`) for that rule
 * to fire. `doNotFollow: node_modules` still prevents recursion.
 *
 * A permanent self-test harness (`scripts/boundary-selftest.mjs`)
 * exercises every rule with fixture violations so the gate can never
 * silently degrade again.
 */

// Layer allowlist — each entry is an alternation used inside `pathNot`
// under a `to.path: '^src/'` clause. Kept alphabetical inside the group
// for readability.
const ALLOWED_SRC_PATHS = {
  domain: '^src/domain/',
  application: '^src/(application|domain|persistence)/',
  persistence: '^src/(persistence|domain)/',
  state: '^src/(application|domain|state)/',
  scene: '^src/(domain|scene|state)/',
  ui: '^src/(application|domain|state|ui)/',
};

// NPM package prefixes that domain/ must NEVER import (spec § NFR-010).
//
// IMPORTANT: dep-cruiser's `to.path` matches against the RESOLVED module
// path, not the raw import specifier. So `import 'react'` resolves to
// `node_modules/react/index.js`, and the regex must be anchored there.
// We keep an anchor at both the direct package dir (`node_modules/react/`)
// and any pnpm-style nested layout (`node_modules/**/node_modules/react/`)
// via a `(^|/)node_modules/` prefix so hoisted and nested installs both
// fire the rule. This bug was found by the S1 review self-test harness.
const FRAMEWORK_PACKAGES = [
  '(^|/)node_modules/react/',
  '(^|/)node_modules/react-dom/',
  '(^|/)node_modules/three/',
  '(^|/)node_modules/@react-three/',
  '(^|/)node_modules/@testing-library/',
  '(^|/)node_modules/jsdom/',
  '(^|/)node_modules/@types/react/',
  '(^|/)node_modules/@types/three/',
].join('|');

/**
 * Build an allowlist forbidden-rule for a layer:
 *   "if a file under src/<layer>/ imports something under src/ that is
 *   NOT under the allowed set, flag it."
 */
function allowlistRule(layer, allowedRegex) {
  return {
    name: `${layer}-allowlist`,
    severity: 'error',
    comment:
      `src/${layer}/ may import ONLY from its allowlist: ${allowedRegex}. ` +
      `Every other src/** import is a layer-boundary violation.`,
    from: { path: `^src/${layer}/` },
    to: {
      path: '^src/',
      pathNot: allowedRegex,
    },
  };
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ---- per-layer exact allowlists ----------------------------------------
    allowlistRule('domain', ALLOWED_SRC_PATHS.domain),
    allowlistRule('application', ALLOWED_SRC_PATHS.application),
    allowlistRule('persistence', ALLOWED_SRC_PATHS.persistence),
    allowlistRule('state', ALLOWED_SRC_PATHS.state),
    allowlistRule('scene', ALLOWED_SRC_PATHS.scene),
    allowlistRule('ui', ALLOWED_SRC_PATHS.ui),

    // ---- persistence: reaching outside src/ is restricted -----------------
    //
    // The `persistence-allowlist` rule above only governs `^src/` targets,
    // so an accidental `import '../../../scripts/build/foo.ts'` from
    // `src/persistence/**` would sail past it (finding Code Review GPT#5).
    // This rule locks the outside-src/ surface down to exactly one file:
    // the checked-in JSON Schema at `docs/deck-file-schema-v1.json`, which
    // `validator.ts` legitimately imports as `with { type: 'json' }`.
    //
    // NPM packages resolve to `node_modules/...` and are excluded by the
    // negative lookahead; Node core modules (`node:*`) do not appear in
    // the graph as `to.path` matches (they are `core` dependency type,
    // and dep-cruiser reports them with `node:` prefix — the negative
    // lookahead on `[^/]` also skips them).
    {
      name: 'persistence-non-src-imports',
      severity: 'error',
      comment:
        'src/persistence/** may only import project files under src/ (governed by ' +
        'persistence-allowlist) plus the checked-in JSON Schema at ' +
        'docs/deck-file-schema-v1.json. Any other project-relative import from ' +
        'persistence/ is a boundary violation (Code Review GPT#5 hardening).',
      from: { path: '^src/persistence/' },
      to: {
        // The negative lookahead admits (a) any src/... path, (b) any
        // node_modules/... path, (c) the exact schema file. Anything
        // else that starts with an ASCII character is a project-relative
        // import outside the allowed surface — flag it.
        path: '^(?!src/|node_modules/|docs/deck-file-schema-v1\\.json$|node:)[A-Za-z0-9._-]',
      },
    },

    // ---- framework ban (domain must stay React/Three/DOM-free) -------------
    {
      name: 'domain-no-react-three-dom',
      severity: 'error',
      comment:
        'spec § NFR-010: domain/ MUST be unit-testable with no React, Three.js, DOM, or ' +
        'test-framework helpers. Move framework/geometry code to scene/ or application/.',
      from: { path: '^src/domain/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-peer', 'npm-optional', 'npm-no-pkg', 'npm-unknown'],
        path: FRAMEWORK_PACKAGES,
      },
    },

    // ---- intra-domain dependency-inversion (Code Review Guardian PR#24 Opus#1)
    //
    // `src/domain/spans/span-check.ts` MUST depend on the `SpanTable`
    // INTERFACE only — never on the concrete `irc-2018-tables.ts`
    // module. The per-layer allowlist above does NOT catch this
    // (both files sit under src/domain/); this rule is the second
    // gate. A grep-based unit test in span-check.test.ts is the
    // third (belt + suspenders — see span-check.ts module header).
    {
      name: 'span-check-no-irc-tables',
      severity: 'error',
      comment:
        'span-check.ts must depend on the SpanTable interface only, ' +
        'never on irc-2018-tables.ts (Code Review Guardian PR#24 finding #4).',
      from: { path: '^src/domain/spans/(?:__selftest__/)?span-check\\.ts$' },
      to: { path: '^src/domain/spans/irc-2018-tables' },
    },

    // ---- generic hygiene ---------------------------------------------------
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies indicate a boundary or ownership problem.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Files not reachable from an entry point are usually dead code or misplaced tests.',
      from: {
        orphan: true,
        pathNot: [
          // Dotfiles and package-metadata JSON
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.[^/]+\\.json$',
          // Tooling configs
          '(^|/)(babel|webpack|rollup|vite|vitest|jest|eslint|prettier|dependency-cruiser)\\.config\\.[^/]+$',
          // Setup & placeholder files
          '(^|/)src/test/',
          '(^|/)\\.gitkeep$',
          // Composition root — only reachable from index.html, which
          // isn't part of the cruise graph.
          '^src/(App|main)\\.tsx$',
          // Public facades — imported via directory resolution.
          '(^|/)index\\.(ts|tsx)$',
          // Test-only helpers (shared arbitraries, fixture data) —
          // imported ONLY from *.test.ts, which are excluded from the
          // cruise, so these appear orphan from dep-cruiser's POV.
          // The `__testing__/` and `__fixtures__/` markers make the
          // intent unmistakable at grep time.
          '(^|/)__testing__/',
          '(^|/)__fixtures__/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: {
      // Boundary rules must observe the edge into node_modules to enforce
      // the framework ban — but recursing INTO node_modules is pointless
      // and slow, so we cut the traversal there.
      path: ['node_modules'],
    },
    tsConfig: {
      fileName: 'tsconfig.app.json',
    },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    // Historically this was `includeOnly: '^src/'` — that was a bug: it
    // stripped npm edges from the graph so the framework ban never
    // matched. Now we cruise the full graph and rely on `from.path`
    // scoping + `doNotFollow: node_modules` to keep the run fast.
    exclude: {
      // Test files may import across layers for fixtures/doubles.
      // Boundary rules apply to production code paths only.
      path: '\\.(test|spec)\\.(ts|tsx)$',
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
  },
};
