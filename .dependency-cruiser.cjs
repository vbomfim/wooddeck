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
 *   ui          → only src/(ui|state|domain)/**      (S13 issue #14 loosened —
 *                    ui/ may consume domain/units, domain/materials-catalog,
 *                    and domain/model types; the dedicated `ui-no-domain-layout`
 *                    rule below still forbids ui/ → domain/layout/**)
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
  // S13 issue #14 (Boundary Resolution comment) LOOSENED the ui
  // allowlist to include `domain/`. Rationale: `ParameterPanel`
  // legitimately needs to parse / format lengths via `domain/units`,
  // discover valid SKUs via `domain/materials-catalog`, and read
  // domain TYPES (`DeckDesign`, `MaterialRef`, `LumberNominal`,
  // `Species`, `Grade`) via `domain/model`. Those three modules are
  // stateless VALUE-OBJECT helpers — importing them does NOT drag
  // business logic into JSX.
  //
  // What is STILL forbidden:
  //   - `application/` — panels must go through the state store
  //     (BLOCK-2s enforces).
  //   - `persistence/` — I/O flows through state + application only
  //     (BLOCK-2t enforces).
  //   - `scene/` — the shell is dumb and never reaches into the 3D
  //     subtree (BLOCK-2d enforces).
  //   - `domain/layout/**` — the layout engine's throw contract is
  //     surfaced through `useDesignStatus().lastError` from the
  //     store; the UI never PRE-COMPUTES a min/max locally. Enforced
  //     by the dedicated `ui-no-domain-layout` rule below +
  //     BLOCK-2v probe.
  //
  // Composition of `ui/` + `scene/` + `application/` still happens
  // at the root (`src/App.tsx`) — see docs/ARCHITECTURE.md § 3a.
  ui: '^src/(state|ui|domain)/',
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
    // This rule locks the outside-src/ surface down to exactly the two
    // checked-in JSON Schemas — `docs/deck-file-schema-v1.json` (S6) and
    // `docs/deck-file-schema-v2.json` (S18) — which `validator.ts`
    // legitimately imports as `with { type: 'json' }`.
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
        'persistence-allowlist) plus the checked-in JSON Schemas at ' +
        'docs/deck-file-schema-v1.json and docs/deck-file-schema-v2.json. ' +
        'Any other project-relative import from persistence/ is a boundary ' +
        'violation (Code Review GPT#5 hardening).',
      from: { path: '^src/persistence/' },
      to: {
        // The negative lookahead admits (a) any src/... path, (b) any
        // node_modules/... path, (c) either checked-in schema file.
        // Anything else that starts with an ASCII character is a
        // project-relative import outside the allowed surface — flag it.
        path: '^(?!src/|node_modules/|docs/deck-file-schema-v(?:1|2)\\.json$|node:)[A-Za-z0-9._-]',
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

    // ---- ui: MUST NOT reach into the layout engine ------------------------
    //
    // S13 issue #14 (Boundary Resolution comment §1 + §3). The ui
    // allowlist now permits `^src/domain/` so ParameterPanel can
    // import `domain/units`, `domain/materials-catalog`, and
    // `domain/model` (types). But `domain/layout/**` is a STRICT
    // exception: material-dependent minimums (structural height,
    // joist-spacing floor, 4 ft width/length floor, etc.) must NOT
    // be pre-computed in the UI. Instead, an invalid value flows
    // through `useDesignStore.getState().applyParameters(patch)`,
    // the store catches the `LayoutError` (with S4's UI-ready
    // messages), and the panel surfaces `useDesignStatus().lastError`
    // inline. That single-source-of-truth discipline forbids the
    // UI from importing ANY module under `src/domain/layout/`
    // (including `MIN_DECK_DIMENSION_MM` and
    // `computeMinStructuralHeightMm`) — which the loosened
    // `ui-allowlist` would otherwise permit.
    //
    // A boundary self-test probe (BLOCK-2v) exercises this rule
    // with a fixture violation so the gate can't silently degrade.
    {
      name: 'ui-no-domain-layout',
      severity: 'error',
      comment:
        'S13 issue #14 (Boundary Resolution §1): src/ui/** MUST NOT import from ' +
        'src/domain/layout/** — the layout engine\'s throw contract is surfaced via ' +
        'useDesignStatus().lastError from the state store; the UI never pre-computes ' +
        'a min/max locally. Rely on applyParameters → LayoutError → status:\'error\' ' +
        'and read lastError.message inline near the offending field.',
      from: { path: '^src/ui/' },
      to: { path: '^src/domain/layout(/|$)' },
    },

    // ---- ui: NO direct span-check / remediation compute ------------------
    //
    // S16 issue #38 §2 layering: the ui layer consumes remediation
    // options through the state store's `useRemediationsForWarning`
    // hook — which internally calls `domain/spans.computeRemediations`
    // and passes the module-scope `spanTable`. UI code must NOT
    // import `domain/spans/*` directly (bypassing the hook would
    // leak the span table + compute call site into presentation
    // code, and defeats the "state owns the compute seam" invariant).
    //
    // Types (`RemediationOption`, `RemediationKind`, `RemediationPatch`)
    // are re-exported by `state/index.ts` — the ui imports those
    // from `../state` and stays on the correct side of the boundary.
    //
    // A boundary self-test probe (BLOCK-2w) exercises this rule
    // with a fixture violation so the gate can't silently degrade.
    {
      name: 'ui-no-domain-spans',
      severity: 'error',
      comment:
        'S16 issue #38 §2 layering: src/ui/** MUST NOT import from src/domain/spans/** — ' +
        'remediation compute is reached through the state store hook ' +
        '`useRemediationsForWarning`, and option TYPES are re-exported via ' +
        '`state/index.ts`. Importing directly from domain/spans in a ui module leaks ' +
        'the span-table + compute call site into presentation code.',
      from: { path: '^src/ui/' },
      to: { path: '^src/domain/spans(/|$)' },
    },

    // ---- scene: layers must not couple to the layout engine ---------------
    //
    // S10 issue #11 explicitly forbids scene layer components from
    // importing `src/domain/layout/**`. Scene layers consume the
    // PRE-COMPUTED `Layout` from the state store — they never call
    // `computeLayout` (or any of its sub-functions). The per-layer
    // allowlist above only stops scene from reaching into `ui/`,
    // `application/`, `persistence/` — `domain/layout/` matches the
    // permitted `^src/domain/` prefix and would slip through without
    // this specific rule.
    //
    // A grep-based unit test in
    // `src/scene/layers/no-geometry-math.test.ts` is the third gate
    // (belt + suspenders — see BoxMember.tsx module header for the
    // finding-#3 pledge).
    {
      name: 'scene-no-domain-layout',
      severity: 'error',
      comment:
        'S10 issue #11: src/scene/** MUST NOT import from src/domain/layout/** — ' +
        'scene layers consume the pre-computed Layout from state only. Move any ' +
        'layout-engine coupling to state/application, then read the result via ' +
        'useLayout / useLayoutBounds.',
      from: { path: '^src/scene/' },
      to: { path: '^src/domain/layout(/|$)' },
    },

    // ---- scene: WarningOverlay is a PEER of layers, not a consumer -------
    //
    // S11 issue #12 §2 (Code Review Guardian finding #7): the
    // WarningOverlay draws its OWN highlight decoration and must
    // remain visible when a layer is toggled off. To make that
    // property STRUCTURAL (not just a code-review promise), the
    // overlay's source file + its highlight-primitive folder are
    // forbidden from importing ANY file under `src/scene/layers/`.
    // That includes the shared primitives (`BoxMember`,
    // `geometries.ts`, `materials.ts`) — the overlay owns a
    // self-contained highlight geometry + material stack so a
    // regression that reuses layer primitives (and thereby
    // couples visibility) is caught at CI, not review.
    //
    // A boundary self-test probe (BLOCK-2q) exercises this rule
    // with a fixture violation so the gate can't silently degrade.
    // A grep-based unit test at
    // `src/scene/highlights/no-geometry-math.test.ts` is the third
    // gate (belt + suspenders — matches the S10 layers pattern).
    //
    // MAINTENANCE NOTE — the `from.path` regex is FILENAME-SCOPED
    // (matches `WarningOverlay.tsx` + the `highlights/` folder).
    // If a future story renames `WarningOverlay.tsx` (e.g. to
    // `WarningsOverlay.tsx`) OR introduces a NEW peer decorator
    // outside `highlights/` (e.g. `overlays/SelectionOverlay.tsx`),
    // update the regex + the BLOCK-2q fixture together. A larger
    // future refactor might reorganize into `src/scene/overlays/`
    // — track that separately; this comment is a reminder not a
    // TODO for THIS story.
    {
      name: 'warning-overlay-no-layers',
      severity: 'error',
      comment:
        'S11 issue #12 finding #7: WarningOverlay + highlights/ MUST NOT import from ' +
        'src/scene/layers/**. The overlay is a peer of the layers — not a consumer — so ' +
        'toggling a layer off can never accidentally hide a highlight. Move any shared ' +
        'primitive you need into src/scene/highlights/ (self-contained copy).',
      from: { path: '^src/scene/(WarningOverlay\\.tsx|highlights/)' },
      to: { path: '^src/scene/layers/' },
    },


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
