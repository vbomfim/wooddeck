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
              │   WarningOverlay +       │  │  WarningOverlay (S9–S11)
              │   highlights/)           │  │  PEER of layers, not consumer
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

If a future story genuinely needs a shared composition helper, put it in a new top-level folder (e.g. `src/composition`) — the boundary rules will require an update to include it, which forces the discussion.

## 3b. Scene coordinate frame & units (S10 pinned)

The scene is authored at **millimeter world scale** — `1 three.js unit = 1 mm`. Every `LayoutMember.position` / `size` field (see `domain/model.ts` "LAYOUT COORDINATE FRAME") flows into `<mesh position={[...]}` / `scale={[...]}` **unchanged** — no conversion, no rescale.

**Frame (right-handed, Euler XYZ, radians):**

| Axis | Direction | Convention |
| ---- | --------- | ---------- |
| +x   | width     | horizontal along the deck's short side |
| +y   | up        | `y = 0` is the ground plane; deck framing lives at positive `y` |
| +z   | length    | horizontal along the deck's long side |

**Origin:** the ground-level footprint center. Positive `y` is up; the environment layer's ground plane sits at `y = 0`; footings extend into `-y`.

**Consequences for scene code:**

- Camera near / far planes in `src/scene/camera-presets.ts` are mm-scaled (`CAMERA_NEAR_MM` / `CAMERA_FAR_MM`); default r3f `near=0.1 / far=1000` would clip every deck member.
- `src/scene/layers/shared/BoxMember.tsx` renders every rectangular member as a `<boxGeometry args={[1,1,1]}/>` scaled by `member.size`. Full-extent (not half-extent) matches `THREE.BoxGeometry`'s `(width, height, depth)` constructor convention.
- `src/scene/DeckScene.tsx` mounts the Canvas at mm world scale; the `## Scene coordinate frame & units` note in that file's module header pins the same statement at the code entry point.
- No layer file may derive coordinates arithmetically from `member.position`, `member.size`, or `member.rotation` — the layout engine (`src/domain/layout/**`) owns every derivation. Enforced by `src/scene/layers/no-geometry-math.test.ts` + the `scene-no-domain-layout` dep-cruiser rule.

## 3c. WarningOverlay is a peer of layers (S11 finding #7)

`src/scene/WarningOverlay.tsx` + everything under `src/scene/highlights/**` **MUST NOT** import from `src/scene/layers/**` — not the layer components, not the shared primitives (`BoxMember`, `layers/shared/geometries.ts`, `layers/shared/materials.ts`). The overlay is a **peer** of the layers in the scene graph, not a consumer.

**Why the boundary is structural, not conventional:**

- **AC2 independence.** The whole point of the story: a joist's over-span highlight must remain visible when the user toggles the Joists layer off. Reusing a layer's mesh (or its shared primitives) would create a coupling that any future refactor could invisibly turn into a visibility dependency. A hard boundary makes the property un-regressable.
- **Rewritability.** Both components stay rewritable from their interfaces alone. Someone rewriting the layers cannot silently break the overlay, and vice versa.

**Enforcement (three gates, defense in depth):**

1. **dep-cruiser rule** `warning-overlay-no-layers` in `.dependency-cruiser.cjs` forbids `^src/scene/(WarningOverlay\.tsx|highlights/)` → `^src/scene/layers/`.
2. **Boundary self-test** `BLOCK-2q` in `scripts/boundary-selftest.mjs` writes a fixture violation and asserts the dep-cruiser rule fires with a non-zero exit + the rule name in the report.
3. **Grep guard** `src/scene/highlights/no-geometry-math.test.ts` scans every non-test file under `src/scene/highlights/**` plus `src/scene/WarningOverlay.tsx` for (a) inline arithmetic on `member.position/size/rotation` (the finding #3 discipline) AND (b) any relative import whose specifier ends in `layers` or `layers/<anything>`.

**Highlight style choice (AC3 § 17 open question resolution).**

The S11 ticket §17 offered three highlight-style options: (a) translucent bounding box, (b) wireframe outline, (c) glow shader. We chose **(a) translucent red bounding box** — `MeshBasicMaterial` (unlit for consistent brightness regardless of scene lighting), `color=0xff0000`, `transparent=true`, `opacity=0.35`, `depthTest=false`, `depthWrite=false`, `side=DoubleSide`, plus a mesh `renderOrder=999` so the highlight sorts last in the transparent pass and draws on top of every opaque primitive. The three property pins are exported from `src/scene/highlights/highlight-primitives.ts` (`HIGHLIGHT_COLOR_HEX`, `HIGHLIGHT_OPACITY`, `HIGHLIGHT_RENDER_ORDER`) so a future palette tweak stays in one place. See `src/scene/highlights/highlight-primitives.ts` module header for the trade-offs.

**Warnings-visible flag decision (S11 §17).**

The ticket §2 mentioned `useUiStore.layerVisibility.warnings` for future extensibility. We do **NOT** add a `warnings` key to `LayerVisibility` — that would disrupt `DECK_LAYER_ORDER` and the S8/S10 tests that assert the exact six-key layer set (`environment` / `decking` / `joists` / `beams` / `posts` / `footings`). For MVP the overlay renders **always-on** (ticket §2: "no toggle UI required, but the flag exists for future extensibility"). No separate `warningsVisible` field either — YAGNI until a user story demands one. A future story that wants a toggle should add a **distinct** `warningsVisible: boolean` (default `true`) to `useUiStore` **outside** the `layerVisibility` record and bind the overlay group's `visible` to it.

**S12 composition contract.**

S12's AppShell composes the scene as:

```tsx
<DeckScene>
  <DeckLayers />
  <WarningOverlay />
</DeckScene>
```

The overlay MUST mount **after** `<DeckLayers />` so its highlights sort last in the scene-graph traversal AND draw last in the transparent-material pass. Combined with the highlight's `depthTest=false` + high `renderOrder`, this guarantees the decoration renders visually on top (AC3).

**Accessibility (WCAG 2.2 § 10 accessible surface).**

The 3D highlight is a visual indicator. Users who cannot see it rely on the **WarningsPanel (S14)** for the same information — the panel is the accessible surface. The overlay is a redundant visual cue on top of the accessible-first text listing, not a replacement for it.

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
| `src/persistence/`| S6            | `serialize` / `deserialize`, `saveDesignToLocalStorage` / `loadDesignFromLocalStorage` / `clearDesignFromLocalStorage`, `downloadDeckFile` / `readDeckFile`, `STORAGE_KEY`, `DeckFileError` (barrel `src/persistence/index.ts`) |
| `src/state/`      | S8            | `designStore`, `uiStore`           |
| `src/scene/`      | S9–S11        | `DeckScene` (default export)       |
| `src/ui/`         | S12–S15       | `AppShell` composition + panels (does NOT import `src/scene/` — see § 3a) |

## 7. Change control

Any change that touches the layer boundaries (`.dependency-cruiser.cjs`) or the pinned 3D-stack versions REQUIRES an ADR (Architecture Decision Record) in `docs/adr/NNNN-*.md`. No ADR = no merge.
