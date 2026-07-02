# Code Review Guardian — Architectural Impact Assessment (Verbatim)

_Consulted 2026-07-02 during PO Step 5b-arch. Findings folded into `specs/mvp-deck-designer/spec.md` sections **System Impact** and **Guardian Consultation Results → Code Review Guardian**._

---

## Summary

The proposed decomposition is **fundamentally sound** and applies Clean Architecture / Hexagonal principles well. The `domain/` isolation with pure `(DeckDesign) → Layout → Warning[]` pipeline is the correct testability wedge and the correct "hexagon core." The stack (r3f + Zustand + Vite + TS) is appropriate for a browser-only static SPA. However, there are **~8 concrete architectural risks** — three of them structural enough that fixing them costs an afternoon now vs. weeks in six months. Nothing is CRITICAL; three items are HIGH.

## Metrics

- Layers proposed: 5 (`domain / state / scene / ui / persistence`)
- Layers recommended: 6 (add `application/` — see finding #1)
- Public boundaries at risk: 2 (`domain/serialization.ts`, `domain/spans/span-tables.ts`)
- Structural risks to future evolution: 3 HIGH, 5 MEDIUM, 2 LOW

---

## Findings (10 total: 0 critical, 3 high, 5 medium, 2 low)

| # | Severity | Domain | Area | Issue | Source & Justification | Suggested Fix |
|---|----------|--------|------|-------|------------------------|---------------|
| 1 | 🟠 HIGH | Design | Layering | **Missing `application/` (use-case) layer.** Orchestrations like "load `.deck` → validate → replace store state → recompute layout" have no home. They will land in Zustand actions (god-store) or in `ui/` handlers (business logic in views). | `[CLEAN-ARCH]` — Use cases are a distinct layer between entities/domain and interface adapters. Skipping it forces the responsibility into the wrong layer. `[SOLID]` SRP: a store should hold state, not orchestrate multi-step business flows. | Add `src/application/` with use-case modules: `load-design.ts`, `save-design.ts`, `apply-parameters.ts`, `compute-layout.ts`. Zustand actions become thin wrappers that call use-cases and set state. UI calls use-cases directly for pure operations (e.g., screenshot). |
| 2 | 🟠 HIGH | Design | Boundaries | **`domain/serialization.ts` is in the wrong layer.** Serialization is knowledge of an **external wire format** (the `.deck` JSON). If it lives in `domain/`, the pure core knows about I/O and any file-format change ripples into the hexagon. | `[HEXAGONAL]` — Serialization is an adapter concern (a driven port). The domain must not know how it is persisted. `[DIP]` high-level policy should not depend on low-level details. | Move to `src/persistence/serialization.ts` (or `src/persistence/deck-file/schema-v1.ts`). Keep only pure entity types in `domain/`. Import direction: `persistence → domain`, never reversed. |
| 3 | 🟠 HIGH | Design | Contracts | **Scene-domain drift risk: `Layout` type is under-specified in the plan.** If layer components have to compute *any* geometry (thickness, taper, joist end-caps, warning outlines), tests will pass on the pure `Layout` while the scene renders something different. This is the #1 way pure-core architectures rot in practice. | `[HEXAGONAL]` — the domain output must be a complete contract. If adapters extend it, the seam is fake. `[CLEAN-ARCH]` "The Dependency Rule": inner layers know nothing of outer layers — corollary: outer layers must be able to render inner-layer output with zero business logic. | The `Layout` type must contain every drawable primitive with its full 3D placement in mm: `{id, kind, position: {x,y,z}, size: {x,y,z}, rotation}`. Scene components become pure `Layout → JSX` with only unit-scaling. Enforce with an ESLint rule banning `import` of `spans/` or `layout/` from any file under `scene/`. Add a "no math in scene" review checklist item. |
| 4 | 🟡 MEDIUM | Design | Coupling | **`span-check` and `span-tables` are tightly bound.** `span-check.ts` will `import` a concrete TS module. When IRC updates (2018 → 2024 → Canadian NBC) or a user wants to switch code editions, every call site must change. | `[DIP]` — `span-check` (high-level policy) should depend on a `SpanTable` interface, not a concrete data module. `[SOLID]` OCP: extending to a new code edition should not require modifying existing checker code. | Define `interface SpanTable { lookup(species, size, spacing): MaxSpanMm }`. Ship one implementation `IrcSpanTable` in `domain/spans/irc-2018-tables.ts`. `span-check(layout, material, table: SpanTable)`. Even if you only ever ship one implementation, the seam is now cheap. |
| 5 | 🟡 MEDIUM | Design | Domain modeling | **Lumber stored as raw mm dimensions loses SKU identity.** A "2×6 SPF #2" is a *product*, not a pair of dimensions. Storing `{width: 38.1, height: 139.7}` in the design throws away the shopping-list identity and creates round-trip drift (38.1 → 1.5" → 38.1). Downstream BOM export will need to reverse-engineer the SKU. | `[CLEAN-CODE]` — "Names should reveal intent." A `Board` with mm dimensions is a rectangle; a `Board` with a nominal SKU is a purchasable thing. `[SOLID]` SRP: the model conflates geometry with catalog identity. | Store lumber pieces as `{nominal: "2x6", species: "SPF", grade: "No2"}`. Actual mm dimensions are *derived* by the materials catalog. This kills the imperial round-trip problem entirely for materials and keeps mm-first for pure geometry (deck footprint, joist positions). |
| 6 | 🟡 MEDIUM | Design | Scene | **Mount/unmount for layer visibility will cause shader-compile jank and GPU-handle churn.** Toggling a layer off then on rebuilds geometry and recompiles materials (50–200ms per material on first mount is common in Three.js). r3f auto-disposes but does not prevent recompile. | `[PERF]` — repeated allocation/deallocation in a hot user-interaction path. Users will toggle layers many times per session (the core UX). | Keep the component-per-layer *file structure* (good organization, matches SRP). Implement visibility as `<group visible={showJoists}>` (Three.js `Object3D.visible` boolean). Meshes stay mounted; toggle is a single boolean write. Zero shader recompile, zero geometry rebuild. Bonus: fixes finding #7 automatically. |
| 7 | 🟡 MEDIUM | Design | Scene | **WarningOverlay must NOT depend on JoistsLayer being mounted.** If a user hides Joists but a joist is over-span, the highlight must still render. Under conditional-mount, `WarningOverlay` either needs to reach into `JoistsLayer` (boundary violation) or replicate the geometry. | `[HEXAGONAL]` — sibling scene components sharing render state creates hidden coupling. `[SOLID]` DIP: WarningOverlay should depend on the abstract `Warning[]` + `Layout`, not on peer components. | `WarningOverlay` reads `warnings: Warning[]` and `layout: Layout` from state and draws its **own** decoration meshes (outlines, badges) from the layout data. It never inspects sibling layer meshes. Its own visibility toggle is independent. Combined with finding #6, this Just Works. |
| 8 | 🟡 MEDIUM | Design | File format | **`{"schema": 1, "design": {...}}` is under-specified for a format users will keep in the wild.** No generator identity, no version, no timestamp, no JSON Schema, no load-time validation. First breaking change will be painful. | `[CLEAN-ARCH]` — persisted formats are external contracts and must be treated with the same rigor as public APIs. `[GOOGLE-ENG]` — file formats are one-way doors; ship the versioning scaffold on day one. | Ship v1 as: `{schema: 1, generator: "wooddeck", generatorVersion: "0.1.0", createdAt: <iso>, design: {...}}`. Ship a JSON Schema at `docs/deck-file-schema-v1.json`. `loadDeckFile` does a `switch(schema)` even with only case 1, so adding v2 is a migration function rather than a refactor. Freeze schema-1 semantics forever after first release; additions require schema-2 + migration. |
| 9 | 🟡 MEDIUM | Design | State | **No undo/redo scaffold from day one.** Zustand supports it trivially via `zundo` middleware; retrofitting after users learn the app is much harder because history-boundary decisions become breaking UX changes. | `[CLEAN-ARCH]` — command/action history is a cross-cutting concern that must be designed into the store from the start. `[GOOGLE-ENG]` "The Boy Scout Rule" cannot repair architectural absences after the fact. | Mount `zundo` on the design store on first commit. Actions that should NOT create history entries (e.g., camera moves — those live in UI store anyway) stay out of history naturally. UI can ship without an undo button in MVP; the store is ready when needed. |
| 10 | 🔵 LOW | Design | Domain | **`materials-catalog.ts` under `domain/` — data vs. code.** Fine for MVP (static, baked in), but if the catalog ever becomes user-editable (custom species, custom lumber sizes), it must become a repository behind a port. | `[HEXAGONAL]` — user-mutable reference data is a driven port, not domain content. `[CLEAN-ARCH]` — entities are stable; catalogs of what-exists are adapters. | For MVP, ship as-is. Add a comment noting the future migration path (`interface MaterialsCatalog { list(): Material[] }` with a `StaticMaterialsCatalog` impl). Zero code change now; costs seconds to plan. |

## Positive observations

- ✅ **Pure `domain/` with no React/Three.js imports** — textbook Hexagonal core. Correct.
- ✅ **Split design store vs. UI store** — saved `.deck` files won't accidentally serialize camera state. Correct SoC.
- ✅ **Layout engine split into joist / beam / post modules** — each has one responsibility. Correct SRP.
- ✅ **2D authoring + 3D read-only viewer** — avoids the notorious "drag-in-3D" UX rabbit hole for MVP. Sound scope call.
- ✅ **Vitest + Playwright + ESLint + Prettier + strict TS** — standard, well-supported toolchain, no red flags.
- ✅ **Static hosting on GH Pages** — zero backend eliminates an entire class of concerns (auth, secrets, DB, cloud IAM, backups). Cheapest possible operating posture.

---

## Answers to specific questions

### A. Component decomposition & module boundaries
- Correct split, but **missing `application/`** (finding #1). Two boundary leaks to fix: `serialization` (finding #2) and `span-tables` (finding #4).
- No bidirectional dependencies as drawn *if* you enforce the import direction with an ESLint boundary rule. Recommend `eslint-plugin-boundaries` or `dependency-cruiser` in CI from day one — cheap insurance against accidental leaks.
- `layout-engine` decomposition is right. `span-check` correctly lives **outside** layout (finding #4).
- Scene-per-layer is correct as **file structure**; wrong as **runtime mount strategy** (findings #6, #7).

### B. Millimeters as canonical unit
- **Yes, mm-first is correct** for pure geometry. The imperial round-trip concern is real but should be solved by (a) storing lumber as SKU not dimensions (finding #5) and (b) preserving the user's original imperial input string alongside the mm value for display purposes; math uses mm.
- **Branded types (`Length<'mm'>`) are not worth the ceremony** for a mm-only domain. They'd pay off if you had multiple length units in the domain (you don't) or pressure/angle types. Centralize conversion in `units.ts`, add an ESLint rule banning numeric literals in geometry code (`no-magic-numbers`), and rely on convention.
- **Round to 1 mm on input** (lossy). Humans can't measure below 1 mm; rationals add complexity for zero UX benefit.

### C. Stack fit
- Stack is well-chosen. Watch for: (a) Three.js bundle size — configure Vite for tree-shaking and code-split the 3D scene from the initial paint; (b) drei/r3f/three peer-dep version pinning — pin exact versions in `package.json`; (c) r3f components are **not testable in jsdom** (no WebGL) — test the domain, snapshot the pure `Layout`, don't try to snapshot rendered meshes.
- **Zustand is right-sized.** Redux Toolkit is overkill (no server state, no time travel); Context+useReducer would work but has coarser re-renders and couples state lifecycle to the React tree. Zustand + `zundo` (finding #9) covers current and near-future needs. Under-powered only if you later need multi-tab realtime sync — not on the MVP roadmap.

### D. Testability of geometry & span-table logic
- `(DeckDesign) → Layout → Warning[]` is an **excellent** seam — textbook Hexagonal port.
- **Required tests before shipping:**
  - ≥10 **golden fixtures** covering small/medium/large decks, spacing that divides evenly vs. remainders, minimum-viable and maximum-supported decks.
  - **Property tests with `fast-check`** for layout invariants: joist count formula holds; all joists inside footprint; no overlaps; width/length swap → rotated layout; monotonicity (bigger deck → ≥ joists).
  - **Span-check golden tests** citing the IRC table row in the test name (regulatory correctness trail); boundary tests at max span ± 1 mm; data-integrity test that the table has no gaps and is monotonic.
- **Yes, invest in `fast-check` from day one.** Setup cost <1 hour; the parameter space (5+ continuous inputs) guarantees you'll miss edge cases without it.
- **Scene drift is a real risk** (finding #3). Fix by making `Layout` a complete render contract + lint rule + review checklist.

### E. Scene-graph & layer design
- Component-per-layer is the right **file organization**; mount/unmount is the wrong **runtime toggle strategy** (findings #6, #7). Use `<group visible={flag}>`. Keeps meshes mounted, toggles at Three.js level, no shader recompile, and WarningOverlay works cleanly because it draws its own decoration independent of any layer's mount state.

### F. `.deck` file format
- Minimum viable schema envelope needs more fields on day one; see finding #8. Ship: `schema`, `generator`, `generatorVersion`, `createdAt`, `design`, plus a JSON Schema and a `switch(schema)` load path even with only case 1.

### G. Top 3 structural risks in 6 months
1. **Scene ↔ domain drift** (finding #3) — the pure-core architecture rots the moment a layer component computes geometry. Fix now with a complete `Layout` type and a lint boundary.
2. **Zustand store becomes a god-object** (finding #1) — orchestrations flow into actions because there's no `application/` layer. Fix now by adding the layer.
3. **`.deck` format calcification** (finding #8) — first breaking change becomes a migration nightmare because there's no version-switch scaffold and no validation. Fix now with envelope + JSON Schema + load-time validation.

**Honorable mention:** the IRC span disclaimer is a **legal-liability surface**. Make it non-dismissable in MVP and unit-test that `DisclaimerBanner` renders on first paint — regression protection against a future refactor accidentally hiding it.

---

## Recommended Actions (folded into the spec by the PO Guardian)

- [x] **Add `application/` layer** — Story #7, spec § System Impact → Affected components (finding #1)
- [x] **Move `serialization.ts` from `domain/` to `persistence/`** — Story #6 (finding #2)
- [x] **`Layout` type is the complete render contract; scene performs no geometry** — spec FR-005, FR-007, NFR-011; Stories #4, #10 (finding #3)
- [x] **Property-based tests with `fast-check`** — spec NFR-010, SC-004; Story #4 (answer D)
- [x] **Lumber stored by SKU/nominal** — spec FR-011, Assumptions; Story #3 (finding #5)
- [x] **Layer visibility via Three.js `visible`** — spec FR-007, NFR-002; Story #10 (finding #6)
- [x] **WarningOverlay independent of layer visibility** — spec FR-015; Story #11 (finding #7)
- [x] **`.deck` envelope + JSON Schema + load-time validation** — spec FR-018, FR-019, Assumptions; Story #6 (finding #8)
- [x] **`zundo` middleware from day one** — spec FR-024, Assumptions; Story #8 (finding #9)
- [x] **Boundary-enforcement lint in CI** — spec NFR-011; Story #1 (findings #1, #2, #3)
- [x] **Non-dismissable disclaimer with first-paint unit test** — spec FR-016, SC-007; Story #12 (honorable mention)

## For the Default Agent (once implementation begins)

- Set up the boundary-enforcement lint rule **before** the first `src/` file lands (Story #1).
- Author the `Layout` type first as a spec-owned artifact; every scene component reviews against it (Story #3, #4).
- Ship `zundo` and the `.deck` schema envelope in the same PRs as the first Zustand store and first persistence call (Stories #6, #8).
