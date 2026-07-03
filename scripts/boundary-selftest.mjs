#!/usr/bin/env node
/**
 * Boundary-rule self-test harness for wooddeck.
 *
 * Purpose
 * -------
 * The boundary-lint gate is only as good as its rules. In S1 review,
 * `.dependency-cruiser.cjs` shipped with `options.includeOnly: '^src/'`,
 * which silently stripped npm packages from the graph and turned the
 * `domain-no-react-three-dom` rule into a no-op. Both Code Review
 * Guardian instances proved a `react` import from `src/domain/` passed
 * `npm run lint:boundaries` with exit 0.
 *
 * That MUST never happen again. This script writes intentional boundary
 * violations to a scratch area under `src/`, runs the appropriate lint
 * command, asserts a NON-ZERO exit **and** that the report names the
 * expected rule + fixture file, then deletes every fixture. If any
 * violation goes undetected the script exits non-zero and CI fails.
 *
 * How it works
 * ------------
 * Fixtures live under `src/<layer>/__selftest__/` — dep-cruiser cruises
 * `src/`, so the fixtures are seen by the same rules as production code.
 * The script uses spawnSync so a per-fixture pass or fail is deterministic.
 * A `try/finally` guarantees cleanup even if an assertion throws.
 *
 * Adding a new fixture
 * --------------------
 * Append an entry to the `FIXTURES` array below and re-run:
 *   npm run test:boundaries
 *
 * Every fixture MUST:
 *   - live under `src/**` so it is cruised
 *   - carry the `__selftest__` marker in its path (so it is skipped by
 *     production code review — grep hits are obvious)
 *   - be deleted by `cleanup()` (fixture directory is `rm -rf`ed)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * S12 pair-fix iter 1 — Fix E (GPT#4 SHOULD-FIX).
 *
 * `npx depcruise` / `npx eslint` were the previous invocation
 * shape. Those forms tell npm-exec to fall back to the network if
 * the local binary "looks missing" (a heuristic that periodically
 * misfires — most often after a partial cache clear or when npm
 * decides to reinstall its own bootstrap). The observed failure
 * mode: `npx` would try to install a placeholder `depcruise@1.0.0`
 * from a NON-EXISTENT registry entry, or would resolve the local
 * binary but fail with "Cannot find module 'chalk'" because it
 * picked up a stale node_modules layout during a race.
 *
 * The deterministic fix: point directly at the LOCAL binary
 * (`node_modules/.bin/…`), and fail FAST with a clear diagnostic
 * if it isn't present (rather than falling back to a network
 * install). CI must have already run `npm ci` — the binaries WILL
 * exist. If they don't, the environment is broken and the harness
 * should say so instead of masking the problem with a re-install.
 */
const DEPCRUISE_BIN = resolve(ROOT, 'node_modules', '.bin', 'depcruise');
const ESLINT_BIN = resolve(ROOT, 'node_modules', '.bin', 'eslint');

function assertLocalBinary(binPath, humanName) {
  if (!existsSync(binPath)) {
    console.error(
      `\n[boundary-selftest] FATAL: local ${humanName} binary not found at ${binPath}.\n` +
        `Run \`npm ci\` first. This harness deliberately does NOT fall\n` +
        `back to \`npx\` (which spuriously reddens CI when it attempts\n` +
        `a network re-install — the exact failure mode Fix E targets).\n`,
    );
    process.exit(2);
  }
}
assertLocalBinary(DEPCRUISE_BIN, 'dependency-cruiser');
assertLocalBinary(ESLINT_BIN, 'eslint');
// Every layer that MIGHT host a fixture OR a fixture target. `rm -rf` on
// setup + teardown makes cross-run pollution impossible.
const SELFTEST_DIRS = [
  resolve(ROOT, 'src', 'domain', '__selftest__'),
  resolve(ROOT, 'src', 'domain', 'spans', '__selftest__'),
  resolve(ROOT, 'src', 'application', '__selftest__'),
  resolve(ROOT, 'src', 'persistence', '__selftest__'),
  resolve(ROOT, 'src', 'state', '__selftest__'),
  resolve(ROOT, 'src', 'scene', '__selftest__'),
  resolve(ROOT, 'src', 'scene', 'highlights', '__selftest__'),
  resolve(ROOT, 'src', 'ui', '__selftest__'),
  // Non-src fixture target dir — used by BLOCK-2g to prove the
  // persistence-non-src-imports rule fires when persistence reaches
  // outside `src/` (into `scripts/`, `docs/`, etc.).
  resolve(ROOT, 'scripts', '__selftest__'),
];

/**
 * A fixture describes one intentional violation.
 *   - `label`: human-readable ID printed in the report
 *   - `path`: absolute path to the fixture file (must live under src/)
 *   - `contents`: file body — should contain the offending import(s)
 *   - `tool`: which lint to run — 'depcruise' or 'eslint'
 *   - `expectedRule`: substring that MUST appear in the lint output
 *     (guards against a "generic" catch-all failing for unrelated reasons)
 *   - `mustNameFile`: whether the report must also name the fixture file
 *     (usually true — false only when the tool reports directory-level)
 *   - `targets` (optional): additional files to create alongside the
 *     fixture (relative path + contents). Used when the offending import
 *     points into a layer whose target module doesn't yet exist in the
 *     S1 skeleton (e.g., `src/scene/**` and `src/persistence/**` only
 *     contain `.gitkeep`s until later stories). Without a resolvable
 *     target, dep-cruiser records `couldNotResolve: true` with a raw
 *     `../..` `resolved` path that fails to match `to.path: '^src/'`,
 *     and the allowlist rule silently misses the violation. Targets
 *     are cleaned up alongside the fixture.
 */
const FIXTURES = [
  {
    label: 'BLOCK-1a: domain imports react',
    path: 'src/domain/__selftest__/framework-react.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries
import * as React from 'react';
export const _ = React;
`,
    tool: 'depcruise',
    expectedRule: 'domain-no-react-three-dom',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-1b: domain imports three',
    path: 'src/domain/__selftest__/framework-three.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries
import * as THREE from 'three';
export const _ = THREE;
`,
    tool: 'depcruise',
    expectedRule: 'domain-no-react-three-dom',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-1c: domain imports @react-three/drei',
    path: 'src/domain/__selftest__/framework-drei.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries
import { Environment } from '@react-three/drei';
export const _ = Environment;
`,
    tool: 'depcruise',
    expectedRule: 'domain-no-react-three-dom',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-2a: domain reaches into src/App (composition root leak)',
    path: 'src/domain/__selftest__/allowlist-app.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { App } from '../../App';
export const _ = App;
`,
    tool: 'depcruise',
    expectedRule: 'domain-allowlist',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-2b: domain reaches into src/test/setup',
    path: 'src/domain/__selftest__/allowlist-testsetup.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import '../../test/setup';
export const _ = 'x';
`,
    tool: 'depcruise',
    expectedRule: 'domain-allowlist',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-2c: application reaches into src/App',
    path: 'src/application/__selftest__/allowlist-app.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { App } from '../../App';
export const _ = App;
`,
    tool: 'depcruise',
    expectedRule: 'application-allowlist',
    mustNameFile: true,
  },
  {
    // S7 issue #8 boundary rule: application/ MUST NOT import from
    // state/ (that would create a circular dep because state/ imports
    // application/). The allowlist rule fires when application/
    // reaches into state/.
    label: 'BLOCK-2h: application reaches into src/state (circular dep prevention)',
    path: 'src/application/__selftest__/allowlist-state.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubStore } from '../../state/__selftest__/target';
export const _ = stubStore;
`,
    targets: [
      {
        path: 'src/state/__selftest__/target.ts',
        contents: `// self-test target for BLOCK-2h — resolves the offending import
export const stubStore = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'application-allowlist',
    mustNameFile: true,
  },
  {
    // S7 issue #8 boundary rule: application/ MUST NOT import from
    // scene/ (application is I/O-free orchestration, no three.js).
    label: 'BLOCK-2i: application reaches into src/scene (framework leak)',
    path: 'src/application/__selftest__/allowlist-scene.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { StubDeckScene } from '../../scene/__selftest__/target';
export const _ = StubDeckScene;
`,
    targets: [
      {
        path: 'src/scene/__selftest__/target.ts',
        contents: `// self-test target for BLOCK-2i — resolves the offending import
export const StubDeckScene = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'application-allowlist',
    mustNameFile: true,
  },
  {
    // S7 issue #8 boundary rule: application/ MUST NOT import from
    // ui/ (application is view-free orchestration, no React).
    label: 'BLOCK-2j: application reaches into src/ui (view leak)',
    path: 'src/application/__selftest__/allowlist-ui.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubUi } from '../../ui/__selftest__/target';
export const _ = stubUi;
`,
    targets: [
      {
        path: 'src/ui/__selftest__/target.ts',
        contents: `// self-test target for BLOCK-2j — resolves the offending import
export const stubUi = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'application-allowlist',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-2d: ui reaches into src/scene',
    path: 'src/ui/__selftest__/allowlist-scene.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { StubDeckScene } from '../../scene/__selftest__/target';
export const _ = StubDeckScene;
`,
    targets: [
      {
        path: 'src/scene/__selftest__/target.ts',
        contents: `// self-test target for BLOCK-2d — resolves the offending import
export const StubDeckScene = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'ui-allowlist',
    mustNameFile: true,
  },
  {
    // S12 issue #13 boundary rule: ui/ MUST NOT import from
    // domain/. The dumb-view layer renders JSX from Zustand state
    // only; a `ui/` import of `../../domain/...` would drag business
    // logic (layout math, span-check) into the JSX render path.
    // Domain data flows through `state/` (which owns the DesignBundle);
    // panels read shaped view models from state hooks. Pair-fix with
    // BLOCK-2d (ui→scene), BLOCK-2s (ui→application), BLOCK-2t
    // (ui→persistence) — the four together lock down the dumb-view
    // boundary structurally, not by convention.
    label: 'BLOCK-2r: ui reaches into src/domain (business-logic leak)',
    path: 'src/ui/__selftest__/allowlist-domain.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubDomain } from '../../domain/__selftest__/ui-target';
export const _ = stubDomain;
`,
    targets: [
      {
        path: 'src/domain/__selftest__/ui-target.ts',
        contents: `// self-test target for BLOCK-2r — resolves the offending import
export const stubDomain = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'ui-allowlist',
    mustNameFile: true,
  },
  {
    // S12 issue #13 boundary rule: ui/ MUST NOT import from
    // application/. Use-cases are invoked via state store actions
    // (the store is the sole caller of the application layer); a
    // panel that reached directly into `application/` would bypass
    // the store, breaking undo/redo (zundo tracks store mutations)
    // and cross-store coordination (banner set on save-fail).
    label: 'BLOCK-2s: ui reaches into src/application (bypasses state store)',
    path: 'src/ui/__selftest__/allowlist-application.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubApp } from '../../application/__selftest__/ui-target';
export const _ = stubApp;
`,
    targets: [
      {
        path: 'src/application/__selftest__/ui-target.ts',
        contents: `// self-test target for BLOCK-2s — resolves the offending import
export const stubApp = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'ui-allowlist',
    mustNameFile: true,
  },
  {
    // S12 issue #13 boundary rule: ui/ MUST NOT import from
    // persistence/. Every persistence action flows through the state
    // store (which routes through application/); a panel reaching
    // directly into localStorage/file-io would bypass the AC6/AC9
    // storage banner + the autosave debounce. This fixture LOCKS IN
    // that separation.
    label: 'BLOCK-2t: ui reaches into src/persistence (I/O bypass)',
    path: 'src/ui/__selftest__/allowlist-persistence.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubPers } from '../../persistence/__selftest__/ui-target';
export const _ = stubPers;
`,
    targets: [
      {
        path: 'src/persistence/__selftest__/ui-target.ts',
        contents: `// self-test target for BLOCK-2t — resolves the offending import
export const stubPers = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'ui-allowlist',
    mustNameFile: true,
  },
  {
    // S8 issue #9 boundary rule: state/ MUST NOT import from scene/
    // (state is view-free — no three.js, no scene graph). This
    // fixture proves the state-allowlist rule fires when state
    // reaches into scene.
    label: 'BLOCK-2e: state reaches into src/scene (framework leak)',
    path: 'src/state/__selftest__/allowlist-scene.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { StubDeckScene } from '../../scene/__selftest__/target';
export const _ = StubDeckScene;
`,
    targets: [
      {
        path: 'src/scene/__selftest__/target.ts',
        contents: `// self-test target for BLOCK-2e — resolves the offending import
export const StubDeckScene = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'state-allowlist',
    mustNameFile: true,
  },
  {
    // PR#28 pair-fix iter 1 — Code Review Opus+GPT#C. After reverting
    // the S8 state→persistence allowlist widening (application/
    // barrel now re-exports DeckFileError so state doesn't need a
    // direct persistence edge), this fixture LOCKS IN the revert:
    // any future re-introduction of a persistence import from
    // state/ MUST fail lint:boundaries. The convention "state
    // routes all I/O through application" is now machine-checked
    // rather than a grep convention.
    label: 'BLOCK-2l: state reaches into src/persistence (routes bypass application)',
    path: 'src/state/__selftest__/allowlist-persistence.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { StubPersistence } from '../../persistence/__selftest__/state-target';
export const _ = StubPersistence;
`,
    targets: [
      {
        path: 'src/persistence/__selftest__/state-target.ts',
        contents: `// self-test target for BLOCK-2l — resolves the offending import
export const StubPersistence = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'state-allowlist',
    mustNameFile: true,
  },
  {
    // S8 issue #9 boundary rule: state/ MUST NOT import from ui/
    // (state is view-free — no React components, no view helpers).
    // This fixture proves the state-allowlist rule fires when state
    // reaches into ui.
    label: 'BLOCK-2k: state reaches into src/ui (view leak)',
    path: 'src/state/__selftest__/allowlist-ui.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubUi } from '../../ui/__selftest__/target';
export const _ = stubUi;
`,
    targets: [
      {
        path: 'src/ui/__selftest__/target.ts',
        contents: `// self-test target for BLOCK-2k — resolves the offending import
export const stubUi = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'state-allowlist',
    mustNameFile: true,
  },
  {
    // S9 issue #10 boundary rule: scene/ MUST NOT import from ui/
    // (scene is view-only, view-of-3D — no React DOM components,
    // no AppShell references). The dep-cruiser scene-allowlist
    // already excludes `ui/`; this fixture LOCKS THAT IN so a
    // future edit that widens the allowlist gets caught by CI.
    label: 'BLOCK-2m: scene reaches into src/ui (view leak)',
    path: 'src/scene/__selftest__/allowlist-ui.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubUi } from '../../ui/__selftest__/target';
export const _ = stubUi;
`,
    targets: [
      {
        path: 'src/ui/__selftest__/target.ts',
        contents: `// self-test target for BLOCK-2m — resolves the offending import
export const stubUi = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'scene-allowlist',
    mustNameFile: true,
  },
  {
    // S9 issue #10 boundary rule: scene/ MUST NOT import from
    // application/ (scene is a view layer — I/O and use-case
    // orchestration are the state store's job, mediated by the
    // application layer). A scene component that reached into
    // `application/` would blur the boundary between "read from
    // Zustand" and "invoke a use-case" — those are the state
    // store's actions, not scene concerns.
    label: 'BLOCK-2n: scene reaches into src/application (use-case leak)',
    path: 'src/scene/__selftest__/allowlist-application.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubApp } from '../../application/__selftest__/scene-target';
export const _ = stubApp;
`,
    targets: [
      {
        path: 'src/application/__selftest__/scene-target.ts',
        contents: `// self-test target for BLOCK-2n — resolves the offending import
export const stubApp = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'scene-allowlist',
    mustNameFile: true,
  },
  {
    // S9 issue #10 boundary rule: scene/ MUST NOT import from
    // persistence/ (persistence is I/O; scene must not touch
    // localStorage or the .deck file directly — all persistence
    // flows through the state store via the application layer).
    label: 'BLOCK-2o: scene reaches into src/persistence (I/O leak)',
    path: 'src/scene/__selftest__/allowlist-persistence.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (allowlist)
import { stubPers } from '../../persistence/__selftest__/scene-target';
export const _ = stubPers;
`,
    targets: [
      {
        path: 'src/persistence/__selftest__/scene-target.ts',
        contents: `// self-test target for BLOCK-2o — resolves the offending import
export const stubPers = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'scene-allowlist',
    mustNameFile: true,
  },
  {
    // PR#26 pair-fix iter 1 — Code Review GPT#5. The persistence-
    // allowlist rule only scopes on `^src/` targets, so a file under
    // `src/persistence/**` that imported a project-relative NON-src
    // path (e.g. `../../../scripts/build/foo.ts`, `../../package.json`)
    // would sail past it. The new `persistence-non-src-imports` rule
    // closes that hole: only `docs/deck-file-schema-v1.json` and npm /
    // node core packages are allowed outside `src/`. This fixture
    // proves the rule fires when persistence reaches into `scripts/`.
    label: 'BLOCK-2g: persistence reaches into scripts/ (non-src project file)',
    path: 'src/persistence/__selftest__/non-src-scripts.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (persistence-non-src-imports)
import { stubHelper } from '../../../scripts/__selftest__/persistence-target';
export const _ = stubHelper;
`,
    targets: [
      {
        path: 'scripts/__selftest__/persistence-target.ts',
        contents: `// self-test target for BLOCK-2g — resolves the offending import
export const stubHelper = 'stub';
`,
      },
    ],
    tool: 'depcruise',
    expectedRule: 'persistence-non-src-imports',
    mustNameFile: true,
  },
  {
    // S10 issue #11 boundary rule: scene/ MUST NOT import from
    // src/domain/layout/** — scene layers consume the pre-computed
    // Layout from state only. The generic `scene-allowlist` rule
    // permits `^src/domain/`, so this specific `scene-no-domain-
    // layout` rule closes the gap for the layout sub-tree. Fixture
    // proves the rule fires; the target `src/domain/layout/index.ts`
    // exists in-tree so no target directive is needed.
    label: 'BLOCK-2p: scene reaches into src/domain/layout (layout-engine leak)',
    path: 'src/scene/__selftest__/no-domain-layout.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (scene-no-domain-layout)
import { computeLayout } from '../../domain/layout';
export const _ = computeLayout;
`,
    tool: 'depcruise',
    expectedRule: 'scene-no-domain-layout',
    mustNameFile: true,
  },
  {
    // S11 issue #12 finding #7 boundary rule: the WarningOverlay
    // + `src/scene/highlights/**` MUST NOT import from
    // `src/scene/layers/**`. The generic `scene-allowlist` permits
    // any `^src/scene/` target — this specific rule closes the gap
    // by forbidding the layers sub-tree for the overlay + highlight
    // primitives. The fixture lives under
    // `src/scene/highlights/__selftest__/` so it exercises the
    // exact `from.path` regex the rule uses. Target module
    // (`src/scene/layers/index.ts`) exists in-tree from S10.
    label: 'BLOCK-2q: highlights/ reaches into src/scene/layers (overlay-layers coupling)',
    path: 'src/scene/highlights/__selftest__/no-layers.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (warning-overlay-no-layers)
import { BoxMember } from '../../layers';
export const _ = BoxMember;
`,
    tool: 'depcruise',
    expectedRule: 'warning-overlay-no-layers',
    mustNameFile: true,
  },
  {
    // Code Review Guardian PR#24 Opus finding #1 — the layer allowlist
    // does NOT catch intra-src/domain/spans/ imports. This fixture
    // proves the belt-and-suspenders `span-check-no-irc-tables` rule
    // fires when span-check imports the concrete IRC data module.
    // (We violate the rule from a copy of span-check inside
    // __selftest__/ so we don't have to briefly break the real
    // production module.)
    label: 'BLOCK-2f: span-check imports irc-2018-tables (intra-domain)',
    path: 'src/domain/spans/__selftest__/span-check.ts',
    contents: `// self-test fixture — MUST fail lint:boundaries (span-check-no-irc-tables)
import { IrcSpanTable } from '../irc-2018-tables';
export const _ = IrcSpanTable;
`,
    tool: 'depcruise',
    expectedRule: 'span-check-no-irc-tables',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-3a: domain uses `document` global',
    path: 'src/domain/__selftest__/dom-document.ts',
    contents: `// self-test fixture — MUST fail lint (no-restricted-globals)
export function leak(): string {
  return document.title;
}
`,
    tool: 'eslint',
    expectedRule: 'no-restricted-globals',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-3b: domain uses `window` global',
    path: 'src/domain/__selftest__/dom-window.ts',
    contents: `// self-test fixture — MUST fail lint (no-restricted-globals)
export function leak(): number {
  return window.innerWidth;
}
`,
    tool: 'eslint',
    expectedRule: 'no-restricted-globals',
    mustNameFile: true,
  },
  {
    label: 'BLOCK-3c: domain imports react (ESLint layer)',
    path: 'src/domain/__selftest__/eslint-react.ts',
    contents: `// self-test fixture — MUST fail lint (no-restricted-imports)
import * as React from 'react';
export const _ = React;
`,
    tool: 'eslint',
    expectedRule: 'no-restricted-imports',
    mustNameFile: true,
  },
];

// ---------------------------------------------------------------------------

function log(tag, msg) {
  const stamp = new Date().toISOString();
  process.stdout.write(`[${stamp}] [${tag}] ${msg}\n`);
}

function ensureCleanFixtureDirs() {
  for (const dir of SELFTEST_DIRS) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(fixture) {
  const abs = resolve(ROOT, fixture.path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, fixture.contents, 'utf8');
  const targetPaths = [];
  for (const target of fixture.targets ?? []) {
    const targetAbs = resolve(ROOT, target.path);
    mkdirSync(dirname(targetAbs), { recursive: true });
    writeFileSync(targetAbs, target.contents, 'utf8');
    targetPaths.push(targetAbs);
  }
  return { abs, targetPaths };
}

function runLint(tool, targetPath) {
  if (tool === 'depcruise') {
    // Fix E: local binary — no `npx` fallback. See top-of-file
    // comment for the flaky-npx failure history this replaces.
    return spawnSync(
      DEPCRUISE_BIN,
      ['--config', '.dependency-cruiser.cjs', 'src'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  }
  if (tool === 'eslint') {
    // Scope to the single fixture file so ESLint output stays focused.
    // Boundary rules for ESLint are the `src/domain/**` override which
    // applies regardless of the file path we lint here.
    return spawnSync(
      ESLINT_BIN,
      ['--no-warn-ignored', targetPath],
      { cwd: ROOT, encoding: 'utf8' },
    );
  }
  throw new Error(`Unknown lint tool: ${tool}`);
}

function assertViolation(fixture, result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const failures = [];

  if (result.status === 0) {
    failures.push(`expected non-zero exit, got 0 — lint did NOT flag the violation`);
  }
  if (!output.includes(fixture.expectedRule)) {
    failures.push(
      `expected report to name rule '${fixture.expectedRule}', but it was not found in output`,
    );
  }
  if (fixture.mustNameFile) {
    const filename = fixture.path.split('/').pop();
    if (!output.includes(filename)) {
      failures.push(`expected report to name file '${filename}', but it was not found in output`);
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      reason: failures.join('; '),
      output: output.trim(),
      exit: result.status,
    };
  }
  return { ok: true, exit: result.status };
}

// ---------------------------------------------------------------------------

let failed = 0;
let passed = 0;
const failedDetails = [];

log('setup', `Root: ${ROOT}`);
log('setup', `Fixtures to exercise: ${FIXTURES.length}`);

try {
  ensureCleanFixtureDirs();

  for (const fixture of FIXTURES) {
    const { abs, targetPaths } = writeFixture(fixture);
    log('run', `${fixture.label}`);
    log('run', `  file: ${fixture.path}`);
    if (targetPaths.length > 0) {
      log('run', `  targets: ${fixture.targets.map((t) => t.path).join(', ')}`);
    }
    log('run', `  tool: ${fixture.tool}   expected-rule: ${fixture.expectedRule}`);

    const result = runLint(fixture.tool, abs);
    const verdict = assertViolation(fixture, result);

    if (verdict.ok) {
      passed += 1;
      log('pass', `  ✔ caught (exit ${verdict.exit})`);
    } else {
      failed += 1;
      failedDetails.push({ label: fixture.label, reason: verdict.reason, output: verdict.output });
      log('FAIL', `  ✘ ${verdict.reason}`);
    }

    // Remove the fixture (and any targets it created) immediately so
    // cross-fixture interference — a later fixture picking up an earlier
    // one's resolved edges — is impossible.
    rmSync(abs, { force: true });
    for (const t of targetPaths) rmSync(t, { force: true });
  }
} finally {
  ensureCleanFixtureDirs();
  log('cleanup', 'All fixture directories removed.');
}

log('summary', `${passed}/${FIXTURES.length} fixtures caught by lint gates.`);

if (failed > 0) {
  process.stdout.write('\n=== SELF-TEST FAILURES ===\n');
  for (const detail of failedDetails) {
    process.stdout.write(`\n[${detail.label}]\n  reason: ${detail.reason}\n`);
    if (detail.output) {
      process.stdout.write(
        `  --- lint output ---\n${detail.output
          .split('\n')
          .map((line) => `  | ${line}`)
          .join('\n')}\n`,
      );
    }
  }
  process.stdout.write('\n');
  process.exit(1);
}

log('summary', 'All boundary rules fired as expected. Gates are healthy. ✅');
process.exit(0);
