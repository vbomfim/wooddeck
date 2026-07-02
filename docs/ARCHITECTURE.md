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

## 3. Import rules (enforced by `dependency-cruiser`)

Spec § NFR-011. Violation → CI failure → merge blocked.

| From          | May import from                       | May NOT import from                                                                                  |
| ------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `domain/`     | nothing (internal)                    | `application`, `persistence`, `state`, `scene`, `ui` — AND `react`, `react-dom`, `three`, `@react-three/*` (NFR-010) |
| `application/`| `domain/`                             | `persistence`, `state`, `scene`, `ui`                                                                |
| `persistence/`| `domain/`                             | `application`, `state`, `scene`, `ui`                                                                |
| `state/`      | `application/`, `domain/`             | `persistence` (called via application), `scene`, `ui`                                                |
| `scene/`      | `state/`, `domain/`                   | `application`, `persistence`, `ui`                                                                   |
| `ui/`         | `state/`, `application/`, `domain/`   | `scene/` internals, `persistence/` (go through `application`)                                        |

**Rationale for each:**

- **`domain → nothing`** — the core is portable, framework-free, and unit-testable in isolation. If a domain module needs a helper, add it under `domain/` or lift the helper out of `domain` entirely.
- **`domain → no react/three/DOM`** — spec § NFR-010. The layout engine must be provable with `fast-check` property tests that never mount a component.
- **`persistence → domain only`** — persistence produces / consumes the domain model. If it needs a use-case (e.g., migration on load), invert: expose a repository interface from `domain`, implement in `persistence`, wire in `application`.
- **`state → no persistence`** — stores react to user intent by calling application use-cases. Use-cases decide when to persist; the store does not know about `localStorage`.
- **`scene → no ui`** — the scene renders the world; the DOM overlay renders panels. They compose in `ui/App.tsx`, they do not reach into each other.
- **`ui → no scene internals`** — `ui/` may render `<DeckScene />` (the scene's public entry) but MUST NOT import from `scene/layers/*` or the r3f primitives directly. The scene owns its layer discipline.

Tests are exempt from the boundary rule (`.test.tsx` / `.spec.tsx` files can import across layers for fixtures and doubles); the rule targets production code paths.

## 4. Pinned 3D-stack version matrix

The `three` / `@react-three/fiber` / `@react-three/drei` triad ships breaking changes across minor releases and must move together. Per Code Review Guardian answer C (spec § 15), these three packages are **exact-pinned** in `package.json` (no `^`, no `~`). React and Vite peer versions are pinned looser but are constrained by drei/r3f peer requirements.

| Package                | Pinned version | Why exact |
| ---------------------- | -------------- | --------- |
| `three`                | **0.185.1**    | drei peer `>=0.159`, r3f peer `>=0.156`. Any minor bump has broken drei helpers historically. |
| `@react-three/fiber`   | **9.6.1**      | drei peer `^9.0.0`. r3f 9 introduced concurrent-render behavior changes; hold the point release. |
| `@react-three/drei`    | **10.7.7**     | drei 10 tracks r3f 9 + React 19. Helpers (Environment, OrbitControls) change signatures across minors. |
| `react`                | `^19.2.7`      | drei peer `^19`, r3f peer `>=19 <19.3`. Constrained to 19.2.x by r3f. |
| `react-dom`            | `^19.2.7`      | Match react version. |
| `@types/three`         | `^0.185.0`     | Match `three`. |

When bumping any of the three exact-pinned packages, verify the matrix (drei ↔ r3f ↔ three) is still supported by both drei's and r3f's peer declarations, then update this table.

## 5. Tooling

| Tool                  | Version (major) | Config                            |
| --------------------- | --------------- | --------------------------------- |
| Node.js               | 22 LTS (≥22.12) | `.nvmrc`, `package.json` engines  |
| npm                   | 10.x            | ships with Node                   |
| Vite                  | 8.x             | `vite.config.ts` (React plugin, manual chunks for `three` / `r3f`) |
| TypeScript            | 6.x, strict     | `tsconfig.json` (project references → `tsconfig.app.json`, `tsconfig.node.json`) |
| Vitest                | 4.x             | inline in `vite.config.ts`, `jsdom`, RTL, `@testing-library/jest-dom` |
| ESLint                | 10.x flat       | `eslint.config.js` + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-config-prettier` |
| Prettier              | 3.x             | `.prettierrc`                     |
| dependency-cruiser    | 18.x            | `.dependency-cruiser.cjs`         |
| fast-check            | 4.x             | staged for domain stories (S4/S5) |
| GitHub Actions        | `actions/setup-node@v6`, `actions/checkout@v7` (both `node24` runtime) | `.github/workflows/ci.yml` runs typecheck + lint + boundaries + test + build |

## 6. Component ownership (post-MVP roadmap)

Each `src/` sub-folder is owned by a specific story. This story (S1) creates only the folder skeleton with `.gitkeep`s; substantive code arrives in the ticket listed below.

| Folder            | Owning story  | Public entry point (when it lands) |
| ----------------- | ------------- | ---------------------------------- |
| `src/domain/`     | S2–S5         | `catalog`, `Layout`, `spanCheck`   |
| `src/application/`| S7            | `useCases/*`                       |
| `src/persistence/`| S6            | `localStorageRepo`, `deckFileIO`   |
| `src/state/`      | S8            | `designStore`, `uiStore`           |
| `src/scene/`      | S9–S11        | `DeckScene` (default export)       |
| `src/ui/`         | S12–S15       | `App` composition + panels         |

## 7. Change control

Any change that touches the layer boundaries (`.dependency-cruiser.cjs`) or the pinned 3D-stack versions REQUIRES an ADR (Architecture Decision Record) in `docs/adr/NNNN-*.md`. No ADR = no merge.
