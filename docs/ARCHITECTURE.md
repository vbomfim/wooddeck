# wooddeck — Architecture

**Companion to:** [`specs/mvp-deck-designer/spec.md`](../specs/mvp-deck-designer/spec.md)
**Enforced by:** [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs) (`npm run lint:boundaries`)
**Story ledger:** [`.github/tickets/`](../.github/tickets/)

This document is normative for **module layout, layer boundaries, and third-party version pins**. Anything here that contradicts the formal spec is a bug in this doc — the spec wins.

---

## 1. Guiding principles

- **Hexagonal / Clean Architecture.** Pure `domain` core, use-case `application` layer, `persistence` / `state` / `scene` / `ui` as adapters. Dependencies point inward.
- **Rewritable by Design.** Every component can be rewritten from its interface + tests alone. Enforced by (a) narrow public interfaces, (b) full test coverage of contracts, (c) `dependency-cruiser` boundary lint.
- **Testability first.** `domain` MUST run under Vitest with **no React, no Three.js, no DOM** (spec § NFR-010). Property-based tests (`fast-check`) are required for layout-engine invariants.

## 2. Layer diagram

```
                       ┌──────────────────────────────┐
                       │           ui/                │  React panels
                       │  (parameters, layers,        │  (S13, S14)
                       │   warnings, BOM, export)     │
                       └──────────┬────────┬──────────┘
                                  │        │
              ┌───────────────────▼─────┐  │
              │        scene/            │  │  r3f Canvas, camera,
              │  (DeckScene, layers,     │  │  6 layer components,
              │   WarningOverlay)        │  │  WarningOverlay (S9–S11)
              └────────┬─────────────────┘  │
                       │                    │
                  ┌────▼────────────────────▼────┐
                  │           state/               │  Zustand stores
                  │  (design store + UI store,     │  (S8) w/ zundo
                  │   two-store split)             │  for undo
                  └────────┬───────────────────────┘
                           │
                  ┌────────▼───────────────────────┐
                  │        application/            │  use-cases:
                  │  loadDeck, saveDeck,           │  (S7)
                  │  applyParameters,              │
                  │  computeLayout                 │
                  └────────┬────────────┬──────────┘
                           │            │
                  ┌────────▼──────┐  ┌──▼──────────────┐
                  │  persistence/ │  │    domain/       │
                  │  localStorage │  │  DeckDesign,     │  Pure core
                  │  + .deck file │  │  Layout, catalog,│  (S2–S6)
                  │  I/O (S6)     │  │  span checker    │
                  └───────┬───────┘  └──────────────────┘
                          │                   ▲
                          └───────────────────┘
                              persistence → domain only
```

## 3. Import rules (enforced by `dependency-cruiser` + ESLint)

Spec § NFR-011. Violation → CI failure → merge blocked. Rules are expressed as an **exact allowlist** in `.dependency-cruiser.cjs` (each layer may import ONLY the modules under its allowed set of `^src/**` prefixes) so any new top-level folder or any `src/` file outside the allowlist is flagged automatically.

| From          | May import from                                | May NOT import from                                                                                          |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `domain/`     | `src/domain/**` only                           | Every other `src/**` path — AND `react`, `react-dom`, `three`, `@react-three/*`, `@testing-library/*`, `jsdom` (NFR-010) |
| `application/`| `src/application/**`, `src/domain/**`          | Every other `src/**` path                                                                                    |
| `persistence/`| `src/persistence/**`, `src/domain/**`          | Every other `src/**` path                                                                                    |
| `state/`      | `src/state/**`, `src/application/**`, `src/domain/**` | Every other `src/**` path (including `persistence/` — go through `application`)                       |
| `scene/`      | `src/scene/**`, `src/state/**`, `src/domain/**` | Every other `src/**` path (including `application/`, `persistence/`, `ui/`)                                 |
| `ui/`         | `src/ui/**`, `src/state/**`, `src/application/**`, `src/domain/**` | Every other `src/**` path — **including all of `src/scene/**`** and all of `src/persistence/**`   |

**Rationale for each:**

- **`domain → only domain`** — the core is portable, framework-free, and unit-testable in isolation. If a domain module needs a helper, add it under `domain/` or lift the helper out of `domain` entirely.
- **`domain → no react/three/DOM`** — spec § NFR-010. The layout engine must be provable with `fast-check` property tests that never mount a component. Enforced BOTH by dep-cruiser (`domain-no-react-three-dom` rule) AND by an ESLint override on `src/domain/**` (`no-restricted-globals` + `no-restricted-imports`) so a misconfiguration in one gate is caught by the other.
- **`persistence → domain only`** — persistence produces / consumes the domain model. If it needs a use-case (e.g., migration on load), invert: expose a repository interface from `domain`, implement in `persistence`, wire in `application`.
- **`state → no persistence`** — stores react to user intent by calling application use-cases. Use-cases decide when to persist; the store does not know about `localStorage`.
- **`scene → no ui`** — the scene renders the world; the DOM overlay renders panels. They compose at the **root** (see § 3a), they do not reach into each other.
- **`ui → no scene, no persistence`** — `ui/` renders panels only. It MUST NOT import ANY module under `src/scene/` — not even the `DeckScene` facade. Composition happens at the root (see § 3a).

Tests (`.test.tsx` / `.spec.tsx`) are exempt from the boundary rule; they may import across layers for fixtures and doubles. The rule targets production code paths.

### 3a. Composition root — how `ui/` and `scene/` meet

Because `ui/` may not import `scene/`, the two are wired together **at the composition root** — a file that lives OUTSIDE every layer folder. Today that is `src/App.tsx` (the S1 placeholder). When S9 lands the scene shell and S12 lands the app-level UI shell, the composition will look like this:

```tsx
// src/App.tsx (composition root — outside every layer folder)
import { AppShell } from './ui/AppShell';     // ui/ knows nothing about scene/
import { DeckScene } from './scene/DeckScene'; // scene/ knows nothing about ui/

export function App(): JSX.Element {
  // The root passes the scene INTO the shell as a child. The shell
  // renders it in its layout slot without importing from scene/.
  return <AppShell scene={<DeckScene />} />;
}
```

Key properties:

- **`src/App.tsx` and `src/main.tsx` are NOT under any layer folder.** They are the only files allowed to import both `ui/` and `scene/` (or `application/` and `persistence/`, etc.).
- **The boundary lint enforces this by allowlist**, not by a hand-written exception list. A future `src/AppRoot.tsx` would be allowed by default; a `src/ui/AppShell.tsx` reaching into `src/scene/` would be flagged.
- **The scene is rendered as a `ReactNode` prop or `children`** in the UI shell. The shell may lay it out (position, size), style around it, and gate its visibility, but never construct or configure it.
- **This is the classic "composition root" pattern** (Mark Seemann): dependencies are wired at the outermost layer where all the concrete types are known; every inner layer stays free of the graph-construction concern.

If a future story genuinely needs a shared composition helper, put it in a new top-level folder (e.g. `src/composition/`) — the boundary rules will require an update to include it, which forces the discussion.

## 4. Pinned 3D-stack version matrix

The `three` / `@react-three/fiber` / `@react-three/drei` triad ships breaking changes across minor releases and must move together. Per Code Review Guardian answer C (spec § 15), these three packages are **exact-pinned** in `package.json` (no `^`, no `~`). React is pinned with a **tilde** (`~19.2.7`) so npm accepts patch bumps but blocks the 19.3 minor — required because r3f 9.x's `react` peer is `>=19 <19.3` and an accidental `^19` install would silently install React 19.3 the moment it releases and break r3f.

| Package                | Pinned version | Why exact / narrow |
| ---------------------- | -------------- | ------------------ |
| `three`                | **0.185.1**    | drei peer `>=0.159`, r3f peer `>=0.156`. Any minor bump has broken drei helpers historically. |
| `@react-three/fiber`   | **9.6.1**      | drei peer `^9.0.0`. r3f 9 introduced concurrent-render behavior changes; hold the point release. |
| `@react-three/drei`    | **10.7.7**     | drei 10 tracks r3f 9 + React 19. Helpers (Environment, OrbitControls) change signatures across minors. |
| `react`                | `~19.2.7`      | **r3f 9.x peer is `>=19 <19.3`.** Tilde blocks the 19.3 minor while accepting 19.2.x patches. Do NOT relax to `^19` — that would silently break r3f the moment 19.3 releases. |
| `react-dom`            | `~19.2.7`      | Match react version (same peer constraint). |
| `@types/react`         | `^19.2.17`     | DevDep — peer is loose. |
| `@types/react-dom`     | `^19.2.3`      | DevDep — peer is loose. |
| `@types/three`         | `^0.185.0`     | Match `three` minor. |

When bumping any of the three exact-pinned packages, verify the matrix (drei ↔ r3f ↔ three) is still supported by both drei's and r3f's peer declarations, and re-check the react peer window before considering a react bump. Update this table AND file an ADR under `docs/adr/`.

## 5. Tooling

| Tool                  | Version (major) | Config                            |
| --------------------- | --------------- | --------------------------------- |
| Node.js               | 22 LTS (≥22.13) | `.nvmrc`, `package.json` engines  |
| npm                   | 10.x            | ships with Node                   |
| Vite                  | 8.x             | `vite.config.ts` (React plugin, manual chunks for `three` / `r3f`) |
| TypeScript            | 6.x, strict     | `tsconfig.json` (project references → `tsconfig.app.json`, `tsconfig.node.json`) |
| Vitest                | 4.x             | inline in `vite.config.ts`, `jsdom`, RTL, `@testing-library/jest-dom` |
| ESLint                | 10.x flat + **type-checked** | `eslint.config.js` — `typescript-eslint` **recommendedTypeChecked** + `projectService: true`, React Hooks/Refresh, `eslint-config-prettier`, and a `src/domain/**` override banning DOM globals + framework imports (defence-in-depth for NFR-010) |
| Prettier              | 3.x             | `.prettierrc`                     |
| dependency-cruiser    | 18.x            | `.dependency-cruiser.cjs`         |
| fast-check            | 4.x             | staged for domain stories (S4/S5) |
| GitHub Actions        | `actions/setup-node@v6`, `actions/checkout@v7` (both `node24` runtime) | `.github/workflows/ci.yml` runs typecheck + lint + boundaries + **boundary self-test** + test + build; `timeout-minutes: 10`; `push` limited to `main` + `feat/**` (story branches run only on `pull_request`) |
| Boundary self-test    | `scripts/boundary-selftest.mjs` | Wired via `npm run test:boundaries`. Writes fixture violations, asserts each dep-cruiser and ESLint boundary rule fires (blocking issue #4). |

## 6. Component ownership (post-MVP roadmap)

Each `src/` sub-folder is owned by a specific story. This story (S1) creates only the folder skeleton with `.gitkeep`s; substantive code arrives in the ticket listed below.

| Folder            | Owning story  | Public entry point (when it lands) |
| ----------------- | ------------- | ---------------------------------- |
| `src/domain/`     | S2–S5         | `catalog`, `Layout`, `spanCheck`   |
| `src/application/`| S7            | `useCases/*`                       |
| `src/persistence/`| S6            | `localStorageRepo`, `deckFileIO`   |
| `src/state/`      | S8            | `designStore`, `uiStore`           |
| `src/scene/`      | S9–S11        | `DeckScene` (default export)       |
| `src/ui/`         | S12–S15       | `AppShell` composition + panels (does NOT import `src/scene/` — see § 3a) |

## 7. Change control

Any change that touches the layer boundaries (`.dependency-cruiser.cjs`) or the pinned 3D-stack versions REQUIRES an ADR (Architecture Decision Record) in `docs/adr/NNNN-*.md`. No ADR = no merge.
