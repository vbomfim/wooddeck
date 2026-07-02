/**
 * dependency-cruiser boundary rule for wooddeck.
 *
 * Enforces the layer discipline mandated by spec § NFR-011:
 *   domain      → nothing (internal); MUST NOT import react/three/DOM (NFR-010)
 *   application → domain
 *   persistence → domain
 *   state       → application + domain
 *   scene       → state + domain
 *   ui          → state + application + domain
 *
 * A violation exits `depcruise` non-zero and names the offending file.
 *
 * The `not.path` regex on each rule is a positive allow-list expressed
 * negatively — i.e., "the module we're importing must be OUTSIDE the
 * forbidden set." Non-`src/*` imports (node_modules, node built-ins,
 * relative-within-same-layer, `src/test/`) are handled by the `from`
 * scope: rules only fire when `from.path` matches the layer.
 *
 * Each rule below has a dedicated `name` so violation output tells you
 * exactly which boundary was crossed.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ---- domain: pure core; imports nothing from any other src/ layer ----
    {
      name: 'domain-no-siblings',
      severity: 'error',
      comment:
        'domain/ is the pure core. It MUST NOT import from any other src/ layer (application, persistence, state, scene, ui).',
      from: { path: '^src/domain/' },
      to: { path: '^src/(application|persistence|state|scene|ui)/' },
    },
    {
      name: 'domain-no-react-three-dom',
      severity: 'error',
      comment:
        'spec NFR-010: domain/ MUST be unit-testable with no React, Three.js, or DOM. Move framework/geometry code to scene/ or application/.',
      from: { path: '^src/domain/' },
      to: {
        path:
          '^(react|react-dom|three|@react-three/|@testing-library/|jsdom|@types/react)',
      },
    },

    // ---- application: use-cases; may only reach into domain ----
    {
      name: 'application-only-domain',
      severity: 'error',
      comment:
        'application/ orchestrates use-cases against domain only. It MUST NOT import from persistence, state, scene, or ui — those are adapters and consumers.',
      from: { path: '^src/application/' },
      to: { path: '^src/(persistence|state|scene|ui)/' },
    },

    // ---- persistence: adapter over domain; nothing else internal ----
    {
      name: 'persistence-only-domain',
      severity: 'error',
      comment:
        'persistence/ is an adapter that reads/writes the domain model. It MUST NOT import from application, state, scene, or ui.',
      from: { path: '^src/persistence/' },
      to: { path: '^src/(application|state|scene|ui)/' },
    },

    // ---- state: Zustand stores wiring application + domain ----
    {
      name: 'state-only-application-domain',
      severity: 'error',
      comment:
        'state/ (Zustand stores) may only depend on application/ and domain/. It MUST NOT import from persistence (persistence is called via application), scene, or ui.',
      from: { path: '^src/state/' },
      to: { path: '^src/(persistence|scene|ui)/' },
    },

    // ---- scene: r3f components consuming state + domain read models ----
    {
      name: 'scene-only-state-domain',
      severity: 'error',
      comment:
        'scene/ consumes the Layout render-contract from state/ + domain/. It MUST NOT import from application, persistence, or ui.',
      from: { path: '^src/scene/' },
      to: { path: '^src/(application|persistence|ui)/' },
    },

    // ---- ui: panels consuming state + application; NO scene reach-in ----
    {
      name: 'ui-no-scene-no-persistence',
      severity: 'error',
      comment:
        'ui/ (panels) may depend on state/, application/, and domain/. It MUST NOT reach into scene/ internals or persistence/ directly.',
      from: { path: '^src/ui/' },
      to: { path: '^src/(scene|persistence)/' },
    },

    // ---- generic hygiene ----
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
      comment: 'Files not reachable from an entry point are usually dead code or misplaced tests.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.[^/]+\\.json$',
          '(^|/)(babel|webpack|rollup|vite|vitest|jest|eslint|prettier|dependency-cruiser)\\.config\\.[^/]+$',
          '(^|/)src/test/',
          '(^|/)\\.gitkeep$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules'],
    },
    tsConfig: {
      fileName: 'tsconfig.app.json',
    },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    includeOnly: '^src/',
    exclude: {
      // Test files are allowed to import across layers (test doubles, fixtures).
      // Boundary rules apply to production code.
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
