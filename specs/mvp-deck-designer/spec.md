# Feature Specification: MVP Wood Deck Designer

**Feature Branch**: `feat/mvp-deck-designer`
**Created**: 2026-07-02
**Status**: Draft
**Input**: User description: "A browser-only, client-side app that lets a DIY homeowner visualize a freestanding rectangular wood deck in 3D. Enter width × length × height, joist spacing, board size, and species/material; the app auto-lays out framing (joists, beams, posts, footings) and decking, renders it in 3D with orbit/zoom/pan, and lets the user toggle individual layers to 'see underneath.' Includes IRC-style span-table warnings. Save/load locally, download `.deck` JSON, PNG screenshot. No backend, no auth."

**Owner**: @vbomfim
**Last updated**: 2026-07-02
**Issue tracker**: (populated when the epic issue is created — see Decomposition)
**Tickets**: (populated when story issues are created — see Decomposition)

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — "See what my deck will look like" (Priority: P1)

A DIY homeowner is planning a rectangular, freestanding deck in their backyard. They open the app, type the width, length, and height (in feet/inches or meters), pick a decking board size and species, and immediately see a 3D rendering of the finished deck. They orbit around it, zoom in, and switch between top / front / side / isometric preset views to understand how it will look in place.

**Why this priority**: The visual mockup is the #1 job of the product. Everything else (BOM, warnings, save/load) is supporting infrastructure. If the 3D visual doesn't land, nothing else matters. Confirmed by the user: "see what my deck will look like."

**Independent Test**: With a fresh browser session, entering plausible defaults (e.g., 12 ft × 16 ft × 3 ft) produces a rendered 3D deck within 3 seconds; orbit / zoom / pan / preset views all work; nothing else is required to demonstrate value.

**Acceptance Scenarios**:

1. **Given** the user opens the app for the first time, **When** the initial parameter defaults load, **Then** a 3D deck renders in the viewer with orbit / zoom / pan enabled and preset view buttons visible.
2. **Given** a rendered deck, **When** the user changes width from 12 ft to 16 ft in the parameter panel, **Then** the 3D deck updates to reflect the new footprint within 500 ms.
3. **Given** a rendered deck, **When** the user clicks the "Top" preset view, **Then** the camera transitions to an overhead orthographic-style view within 500 ms.
4. **Given** a rendered deck, **When** the user drag-orbits, scroll-zooms, and middle-drag-pans, **Then** the camera responds smoothly with no visible stutter on a modern desktop browser.

---

### User Story 2 — "Peel back the layers to see the framing" (Priority: P1)

The same DIY homeowner wants to understand what's under the deck surface. They click the layer-toggle for "Decking" to hide the top boards and reveal the joists, beams, posts, and footings underneath. They can toggle any combination of the six layers (Environment/Ground, Decking, Joists, Beams, Posts, Footings) to see how the structure is put together.

**Why this priority**: This is the differentiating UX — the reason a homeowner would use this over a generic sketch tool. Confirmed by the user as core: "the 'see underneath / peel back layers' feature is the whole point. The layers must reveal actual framing members, not an abstract plate."

**Independent Test**: With a rendered deck, toggling each of the six layer switches shows/hides that layer instantly (< 100 ms), with no camera reset and no re-render jank.

**Acceptance Scenarios**:

1. **Given** a rendered deck with all layers visible, **When** the user toggles "Decking" off, **Then** the deck boards disappear and the joists, beams, posts, and footings are visible in their correct 3D positions.
2. **Given** any layer combination, **When** the user toggles a layer on/off, **Then** the change is visible within 100 ms with no shader-recompile jank.
3. **Given** a warning exists on a joist that is over-span, **When** the user hides the Joists layer, **Then** the warning highlight remains visible on that joist's position (the WarningOverlay is independent of layer visibility).

---

### User Story 3 — "Warn me if the deck won't hold" (Priority: P2)

The homeowner picks a 2×6 joist at 24" spacing over a 16 ft span. The app checks this against IRC-style span tables for the selected species and highlights the joists as over-span in the 3D view, and lists the specific warning ("Joist 2×6 @ 24" o.c., SPF, span 4877 mm exceeds allowable 3200 mm") in a Warnings panel. A prominent, non-dismissable disclaimer makes clear this is a planning aid, not an engineering document.

**Why this priority**: Without this the app is a pretty toy. With it, the app gives real design feedback. The user explicitly confirmed: "IRC-style span-table lookups ... implement a real feature, not just a stub."

**Independent Test**: Given a deliberately over-span parameter set (e.g., 2×6 joists at 24" o.c., 16 ft span, SPF), the affected joists are highlighted in 3D and a warning line appears in the Warnings panel citing the allowable span.

**Acceptance Scenarios**:

1. **Given** an over-span parameter set, **When** the deck renders, **Then** the over-span joists are visually highlighted in the 3D view AND listed in the Warnings panel with the allowable value and reference to the IRC table row.
2. **Given** the user opens the app, **When** the app renders, **Then** the disclaimer banner "Planning aid, not an engineering document — consult a licensed professional or your local building department" is visible and cannot be dismissed for the duration of the session.
3. **Given** the user changes parameters to bring spans within limits, **When** the deck re-renders, **Then** the warnings disappear.

---

### User Story 4 — "Save and come back later" (Priority: P2)

The homeowner refines their design across multiple sessions. Their work autosaves to the browser's local storage. They can also click "Download" to save a `.deck` JSON file to disk (to email to a friend, back up, or reload later) and "Open…" to load an existing `.deck` file.

**Why this priority**: A design tool that loses your work every session is unusable. Confirmed by the user: "local browser storage + downloadable .deck JSON file."

**Independent Test**: Enter parameters → close the tab → reopen the app → the deck loads with the last-used parameters. Download a `.deck` file → clear local storage → upload the file → the deck loads identically.

**Acceptance Scenarios**:

1. **Given** an unsaved design, **When** the user reloads the tab, **Then** the last design is restored from local storage.
2. **Given** a design in the app, **When** the user clicks "Download .deck," **Then** a JSON file named `wooddeck-{timestamp}.deck.json` is downloaded to disk.
3. **Given** a `.deck` file on disk, **When** the user selects "Open…" and picks the file, **Then** the design loads into the app and the 3D view updates to match.
4. **Given** a `.deck` file with an unsupported `schema` version, **When** the user tries to open it, **Then** the app shows a clear error message and refuses to load it (never partially-loads unknown schema).

---

### User Story 5 — "Take a picture and get a shopping list" (Priority: P3)

The homeowner wants a screenshot of their finished 3D view to send to a friend, and a bill of materials (counts of joists, beams, posts, footings, decking board count and total linear feet) to take to the lumber yard.

**Why this priority**: The user gets real utility from a shareable image and a shopping list, but neither is required for the core "see what my deck will look like" outcome.

**Independent Test**: Click "Export PNG" → a PNG of the current 3D view downloads. The BOM panel shows counts and total linear feet for each material type; the numbers match a manual tally of the on-screen model.

**Acceptance Scenarios**:

1. **Given** a rendered deck, **When** the user clicks "Export PNG," **Then** a PNG file of the current 3D view (at the current camera position, at the current canvas resolution) is downloaded.
2. **Given** a rendered deck, **When** the user opens the BOM panel, **Then** it lists: joist count (by nominal SKU and length), beam count (SKU and length), post count (SKU and height), footing count, decking board count and total linear feet.

---

### Edge Cases

- **Zero-sized or negative dimensions:** the parameter panel must clamp inputs to a sensible minimum (e.g., width ≥ 4 ft / 1220 mm) and refuse to render at 0.
- **Extreme dimensions:** the user could type "500 ft × 500 ft"; the app must not crash but should render or warn. A soft upper limit (e.g., 40 ft / 12 m per side) with an explanatory tooltip is acceptable.
- **Joist spacing that doesn't divide evenly:** the layout engine must handle remainders (either an extra shortened bay at one end, or a centered layout with two shortened bays). Documented behavior required.
- **Unit switch mid-design:** switching from imperial to metric must NOT alter the stored design (all values are canonical mm internally); only display formatting changes.
- **Local storage full or blocked:** the app must degrade gracefully — a warning banner appears, autosave is disabled for the session, but downloads still work.
- **`.deck` file with unknown schema version:** must refuse to load; must NOT partial-load and drop fields silently.
- **`.deck` file with corrupt JSON:** must show a clear parse-error message with no partial state change.
- **WebGL unsupported:** must show a "Your browser does not support WebGL 2" message with a link to browser-upgrade guidance; the 2D plan view and parameter panel remain usable.
- **Very large deck (e.g., 40 ft × 40 ft with 12" joist spacing):** must render within 3 s and maintain interactive frame rate (≥ 30 FPS) on a mid-range 2023 laptop.

---

## Requirements *(mandatory)*

### Functional Requirements

**Core rendering & interaction**

- **FR-001**: System MUST render a 3D visualization of a rectangular, freestanding deck built from the user-supplied parameters (width, length, height, joist size, joist spacing, decking board size, material species).
- **FR-002**: System MUST auto-lay out the structural members (joists, beams, posts, footings) and the decking boards from the user's parameters — the user does NOT place individual members.
- **FR-003**: System MUST provide 3D camera controls: free orbit (any angle), zoom in/out, and pan.
- **FR-004**: System MUST provide preset camera views: Top, Front, Side, Isometric.
- **FR-005**: System MUST render individual structural members (each joist, beam, post, footing) as distinct 3D geometry — not an abstract plate. This is required for FR-006.
- **FR-006**: System MUST support per-layer visibility toggling for at least these six layers: Environment/Ground, Decking, Joists, Beams, Posts, Footings.
- **FR-007**: Layer visibility MUST be implemented via Three.js `visible` flag (or equivalent `<group visible={…}>`) — NOT via React mount/unmount — to avoid shader-recompile jank on toggle. *(Ref: Code Review Guardian finding #6.)*

**Units**

- **FR-008**: System MUST store all lengths in canonical millimeters internally. Conversion between imperial and metric happens at the UI boundary only.
- **FR-009**: System MUST allow the user to switch the display unit system (imperial ft/in ↔ metric m/cm/mm) at runtime. Switching MUST NOT modify stored design values.
- **FR-010**: Display formatting MUST round to human-legible precision (e.g., 1 mm for metric, 1/8" for imperial).
- **FR-011**: Lumber pieces MUST be stored by nominal SKU + species + grade (e.g., `{nominal: "2x6", species: "SPF", grade: "No2"}`), NOT by raw mm dimensions. Actual mm dimensions are DERIVED via the materials catalog. *(Ref: Code Review Guardian finding #5.)*

**Materials & structure**

- **FR-012**: System MUST provide a static materials catalog containing at least: joist/beam sizes 2×6, 2×8, 2×10, 2×12; post sizes 4×4, 6×6; decking boards 5/4×6 and 2×6; species/type PT (pressure-treated), Cedar, Composite (as a material type without grading).
- **FR-013**: System MUST perform IRC-style span checks: for each joist and beam in the layout, compute whether its span is within the allowable span for its size, spacing, species, and grade. Members that exceed allowable span MUST be flagged.
- **FR-014**: System MUST highlight over-span members in the 3D view AND list them in a Warnings panel with the allowable value and a reference to the source table row.
- **FR-015**: The WarningOverlay MUST draw its own highlight geometry from the Layout data and MUST remain visible when the layer containing the flagged member is toggled off. *(Ref: Code Review Guardian finding #7.)*
- **FR-016**: System MUST display a non-dismissable disclaimer banner reading substantially "Planning aid, not an engineering document — consult a licensed professional or your local building department." The disclaimer MUST render on first paint. *(Ref: Code Review Guardian "Honorable mention"; user answer D12.)*

**Persistence & export**

- **FR-017**: System MUST autosave the current design to browser local storage after any parameter change (debounced ≤ 500 ms).
- **FR-018**: System MUST let the user download the current design as a `.deck` JSON file. The file MUST include, at minimum: `schema` (integer), `generator` (string, `"wooddeck"`), `generatorVersion` (semver string), `createdAt` (ISO-8601 timestamp), `design` (the DeckDesign entity). *(Ref: Code Review Guardian finding #8.)*
- **FR-019**: System MUST let the user upload a `.deck` file. The loader MUST validate against a JSON Schema for the file's declared `schema` version and reject unknown or invalid files with a clear error message.
- **FR-020**: System MUST let the user export the current 3D view as a PNG at the current canvas resolution.
- **FR-021**: System MUST provide an on-screen Bill of Materials (BOM) listing counts by SKU for joists, beams, posts, footings, and decking boards (with total linear feet/meters).

**Editing**

- **FR-022**: System MUST provide a parameter side panel for editing width, length, height, joist spacing, joist size (SKU), decking board size (SKU), species/material.
- **FR-023**: System MUST provide a read-only 2D top-down plan view alongside the 3D view. (Full 2D authoring/dragging is out of scope for MVP — see Section: Out of Scope.)
- **FR-024**: The design state store MUST support undo/redo scaffolding from day one, even if a UI undo button is not shipped in MVP. *(Ref: Code Review Guardian finding #9.)*

### Non-Functional Requirements

- **NFR-001** *(Performance)*: Parameter change → 3D re-render latency MUST be ≤ 500 ms p95 for decks up to 20 ft × 30 ft on a mid-range 2023 laptop (e.g., M1/M2 MacBook Air, i5 desktop).
- **NFR-002** *(Performance)*: Layer toggle → visible change MUST be ≤ 100 ms and MUST NOT cause shader recompile or geometry rebuild.
- **NFR-003** *(Performance)*: Interactive frame rate ≥ 30 FPS during orbit/zoom/pan on the same reference hardware, up to the max supported deck size.
- **NFR-004** *(Compatibility)*: MUST support the latest two versions of Chrome, Edge, Firefox, and Safari on desktop.
- **NFR-005** *(Compatibility)*: MUST work on desktop (primary). Tablet is a nice-to-have. Mobile is deferred.
- **NFR-006** *(Availability)*: N/A — static client-only app; hosted on a static host (GitHub Pages). No SLI/SLO. Availability = hosting provider's SLA.
- **NFR-007** *(Security)*: NONE of the following apply: authentication, authorization, user data collection, PII, third-party APIs, secrets management. See Section 6 in each ticket.
- **NFR-008** *(Privacy)*: No personal data collected, stored, or transmitted. Local storage keys contain only design geometry and preferences.
- **NFR-009** *(Accessibility)*: UI outside the 3D canvas MUST meet WCAG 2.2 Level AA (keyboard navigation, contrast, focus visible, semantic HTML). The 3D canvas itself is exempt from WCAG 2.2 rendering conformance but MUST have a text/2D equivalent (the BOM panel and 2D plan view) for keyboard/screen-reader users.
- **NFR-010** *(Testability)*: The `domain/` layer MUST be fully unit-testable with no React, Three.js, or DOM. Property-based tests with `fast-check` are REQUIRED for the layout engine invariants. *(Ref: Code Review Guardian answer D.)*
- **NFR-011** *(Maintainability)*: A boundary-enforcement lint (e.g., `eslint-plugin-boundaries` or `dependency-cruiser`) MUST run in CI to enforce: `domain/` imports nothing from `state/`, `scene/`, `ui/`, or `persistence/`; `scene/` imports nothing from `ui/`; `persistence/` imports only `domain/`. *(Ref: Code Review Guardian findings #1, #2, #3.)*

### Key Entities

- **DeckDesign**: The root persisted entity — deck footprint (width, length, height in mm), joist parameters (SKU, spacing_mm), decking board SKU, species/material, layout preferences. This is what a `.deck` file contains.
- **Layout**: The output of the layout engine — a *complete render contract*. Contains every drawable primitive with full 3D placement in mm: `Joist[]`, `Beam[]`, `Post[]`, `Footing[]`, `Board[]` (decking). Scene components consume Layout and perform zero geometry math. *(Ref: Code Review Guardian finding #3.)*
- **Joist / Beam / Post / Footing / Board**: Structural/surface members with a nominal SKU reference, position `{x, y, z}` (mm), size `{x, y, z}` (mm derived from SKU), rotation, and an id.
- **Material**: A catalog entry — nominal SKU + species/type + actual mm dimensions + optional physical properties (weight, cost placeholder).
- **SpanTable**: A lookup service abstraction — `lookup(species, size, spacing_mm) → maxSpanMm`. The MVP ships one implementation (`IrcSpanTable`) sourced from public IRC-2018 tables. *(Ref: Code Review Guardian finding #4.)*
- **Warning**: A structured record — `{memberId, kind: "over-span", actualMm, allowableMm, tableRowReference}`.
- **DeckFile (v1)**: The `.deck` on-disk envelope — `{schema: 1, generator: "wooddeck", generatorVersion, createdAt, design}`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can render a rectangular deck matching their target dimensions within **3 minutes** of opening the app for the first time (measured by manual usability run against three test personas — the user + two friends).
- **SC-002**: Toggling any of the six layers produces a visible change in **≤ 100 ms** and does not trigger a shader recompile (measured with the Three.js `WebGLProgram.getExtension('WEBGL_debug_shaders')` count and Chrome DevTools Performance panel).
- **SC-003**: For decks up to 20 ft × 30 ft, parameter-change → 3D re-render latency is **≤ 500 ms p95** on the reference hardware (measured with a scripted benchmark that changes each parameter 50 times and records timing).
- **SC-004**: The layout engine passes **≥ 10 golden-fixture tests** and **≥ 5 property tests** (fast-check) covering: joist count formula, all joists inside the footprint, no overlaps, width/length swap → rotated layout, monotonic joist count with increasing length. *(Ref: Code Review Guardian answer D.)*
- **SC-005**: The span-check engine passes **≥ 8 golden tests** citing the IRC-2018 table row in the test name (regulatory traceability), including boundary tests at max span ± 1 mm.
- **SC-006**: `.deck` file round-trip: given any generated design, `save → download → clear localStorage → load` produces an identical `DeckDesign` (byte-for-byte identical JSON after canonicalization).
- **SC-007**: The disclaimer banner renders on **first paint** in every UI end-to-end test and is not dismissable within a session (enforced by unit test).
- **SC-008**: CI blocks any PR that violates the layer-boundary import rules (`domain → state`, `scene → ui`, `persistence → domain-only`).
- **SC-009**: The app loads (Time to Interactive) in **≤ 3 s** on a fresh browser session on a 10 Mbps connection with the reference hardware.

---

## Assumptions

- **Target audience:** DIY homeowners. Structural terms (joist, beam, post, footing, span) are acceptable; deep engineering terms (moment, deflection ratio) are avoided in UI copy. *(User answer A1.)*
- **Ambient environment:** the deck sits on flat ground. No terrain modeling. No house-attachment / ledger board. No stairs, railings, or multi-level for MVP. *(User answer B3/B4/B5, I24.)*
- **Structural fidelity:** the app models individual framing members with buildable-accurate positions — the "peel back" UX depends on this. *(User answer B6.)*
- **Units:** both imperial and metric are switchable at runtime. Canonical internal unit is **millimeters** (integer where possible, rounded to 1 mm on input). Branded types are NOT used — a single `units.ts` module centralizes all conversion. *(User answer C7; Code Review Guardian answer B.)*
- **Lumber identity:** boards are stored by nominal SKU (`"2x6"`, `"SPF"`, `"No2"`), not by raw mm dimensions. Actual dimensions are derived via the materials catalog. *(Code Review Guardian finding #5.)*
- **Materials catalog:** static, checked-in TypeScript module for MVP. Not user-editable. Future migration to a repository-behind-a-port pattern is noted but out of scope. *(User answer C9; Code Review Guardian finding #10.)*
- **Cost / pricing:** NOT included in MVP. BOM counts only. Pricing may return as an optional feature later. *(User answer C10.)*
- **Span tables:** static, checked-in dataset sourced from public **IRC-2018** joist and beam span tables. Source documents, edition, and attribution live in `docs/span-tables/`. The `SpanTable` interface allows swap-in of other editions or NBC (Canadian) later. *(User answer D11; Code Review Guardian finding #4.)*
- **Disclaimer:** non-dismissable, on-first-paint. Prominent placement in the UI. *(User answer D12.)*
- **Authentication:** none. Fully client-side. *(User answer G22.)*
- **Persistence:** browser local storage + downloadable `.deck` JSON files. No cloud, no server. *(User answer F16.)*
- **Export:** PNG screenshot of the current 3D view + `.deck` JSON download for MVP. PDF / OBJ / GLB / CSV cut-list are later. *(User answer F17.)*
- **Sharing:** offline/local only. No share links for MVP. *(User answer F18.)*
- **Deployment target:** static hosting (GitHub Pages), online-only for MVP. The app is client-only so it will largely work offline anyway; PWA/offline is a later nice-to-have. *(User answer G21.)*
- **Browsers:** modern evergreen only — latest two of Chrome/Edge/Firefox/Safari on desktop. Tablet nice-to-have; mobile deferred. *(User answers G19, G20.)*
- **Rendering stack:** react-three-fiber + Three.js + @react-three/drei + Zustand + TypeScript (strict) + Vite. Testing: Vitest + fast-check for domain; Playwright deferred. *(User answer H23; Code Review Guardian answer C.)*
- **Undo/redo:** the design store uses `zundo` from day one, even if a UI undo button is not shipped in MVP. *(Code Review Guardian finding #9.)*
- **State partition:** two Zustand stores — one for the canonical `DeckDesign` (source of truth, serialized to `.deck` files), one for transient UI state (camera preset, layer visibility, unit-display mode). Saved designs never include UI state. *(Code Review Guardian positive observation.)*
- **File format versioning:** `.deck` files carry a `schema` integer, a `generator`, `generatorVersion`, and `createdAt` from v1. The loader is a `switch(schema)` even with only case 1. A JSON Schema for v1 lives in `docs/deck-file-schema-v1.json`. *(Code Review Guardian finding #8.)*
- **Timeline:** hobby/personal pace, no hard deadline. *(User answer J25.)*
- **License:** MIT. *(User answer J26.)*
- **Repository:** `vbomfim/wooddeck`, public. GitHub remote created before decomposition. *(User answer J27.)*

<!-- END OF SPEC KIT-COMPATIBLE CONTENT -->

---

## Decomposition

### Ticketing convention

The user works in a Feature/Story branching model:

- The **Feature branch** (`feat/mvp-deck-designer`) is an integration branch that eventually opens a PR into `main`.
- Each **Story branch** (`story/N-slug`) branches off the Feature branch and opens a PR back into the Feature branch (NOT into `main`).
- Every unit of work owns its own branch **and** its own git worktree so the push target is unambiguous.
- The Epic issue (this decomposition) is the Feature. Each child issue is a Story.

### Module map

| Module | Purpose | Stories |
|---|---|---|
| Foundation | Repository scaffold, tooling, CI, boundary lint | #1 |
| Domain — Types & Units | Canonical mm units + core entities + materials catalog | #2, #3 |
| Domain — Engine | Layout engine + span-check | #4, #5 |
| Persistence | `.deck` file format v1 + local storage + file I/O | #6 |
| Application | Use-case layer orchestrating domain + persistence + state | #7 |
| State | Zustand stores (design with `zundo` + UI) | #8 |
| Scene (3D) | r3f scene shell + camera + layers + warning overlay | #9, #10, #11 |
| UI Shell | App shell + non-dismissable disclaimer | #12 |
| UI Panels | Parameter panel, layer toggles, warnings, BOM, export menu | #13, #14 |
| UI Plan View | Read-only 2D top-down plan view | #15 |

### Story tree

```
Feature (Epic): feat/mvp-deck-designer — MVP Wood Deck Designer
│
├── Phase A — Foundation (blocks all others)
│   └── S1  story/1-project-scaffold        Project scaffold, tooling, CI, boundary lint
│
├── Phase B — Domain (depends on S1)
│   ├── S2  story/2-units-subsystem         Canonical mm + conversion + formatting
│   ├── S3  story/3-domain-model-catalog    Core entities + SKU-based Board + materials catalog
│   ├── S4  story/4-layout-engine           Layout engine + Layout render-contract + property tests
│   └── S5  story/5-span-tables-check       SpanTable interface + IRC-2018 impl + span-check
│
├── Phase C — Adapters (depends on Phase B)
│   ├── S6  story/6-file-format-persistence .deck v1 envelope + JSON Schema + localStorage + file I/O
│   ├── S7  story/7-application-usecases    Use-case layer (load, save, apply-parameters, compute-layout)
│   └── S8  story/8-state-stores            Zustand design store (with zundo) + UI store
│
├── Phase D — Rendering (depends on S8; S9 blocks S10 blocks S11)
│   ├── S9  story/9-3d-scene-shell          DeckScene <Canvas> + CameraRig + preset views
│   ├── S10 story/10-scene-layers           Six layer components + visibility via <group visible>
│   └── S11 story/11-warning-overlay        WarningOverlay independent of layer visibility
│
└── Phase E — UI (depends on Phase D; S12 hosts S13–S15)
    ├── S12 story/12-app-shell-disclaimer   AppShell + non-dismissable DisclaimerBanner + first-paint test
    ├── S13 story/13-parameter-panel        ParameterPanel + runtime unit switcher
    ├── S14 story/14-side-panels            Layer toggles + Warnings + BOM + Export menu (save/load/PNG/JSON)
    └── S15 story/15-2d-plan-view           Read-only 2D top-down plan view
```

### Sequencing and dependencies

- **Phase A** (S1) must complete first — everything else depends on the project scaffold and boundary lint being enforced from the first commit.
- **Phase B** stories can be developed in parallel once S1 lands:
  - S2 (units) is independent.
  - S3 (model + catalog) depends on S2 (uses mm types).
  - S4 (layout engine) depends on S3.
  - S5 (span-check) depends on S3 and S4 (it consumes `Layout`).
- **Phase C**:
  - S6 (persistence) depends on S3.
  - S7 (use-cases) depends on S4, S5, S6.
  - S8 (state stores) depends on S7 (stores wrap use-case calls).
- **Phase D** rendering:
  - S9 (scene shell) depends on S8.
  - S10 (layers) depends on S4 (Layout type) and S9 (scene shell).
  - S11 (WarningOverlay) depends on S5 (Warning type) and S10.
- **Phase E** UI:
  - S12 (shell + disclaimer) depends on S9.
  - S13 (parameter panel) depends on S2, S3, S8, S12.
  - S14 (side panels) depends on S8, S10, S11, S12.
  - S15 (2D plan view) depends on S4, S8, S12.

### Decomposition rationale

The decomposition follows Hexagonal / Clean Architecture layering: pure `domain` → `application` use-cases → `state` (Zustand adapter) → `scene` and `ui` (interface adapters). Each Phase B story is a pure, unit-testable module with no framework dependencies — this is the biggest testability win and is designed in from the start. Phase B stories can be developed in parallel by different contributors (or in parallel worktrees by a solo developer), maximizing throughput on the highest-value work. Phase D and E must be sequential because the scene and UI are visually integrated. Alternative rejected: a single "render everything" story covering S9–S11 was considered but rejected because layer-visibility toggling (US2) is the differentiating UX and warrants its own story with acceptance criteria and boundary rules (Code Review Guardian findings #6, #7). Split accepted.

---

## Guardian Consultation Results

### Security Guardian
- *(Not consulted for MVP — Step 5b judgement.)* Rationale: fully client-side app, no auth, no server, no PII, no secrets, no third-party APIs. If any of these change (e.g., adding a share-link feature or cloud save), Security Guardian consultation becomes required. The **only** security-adjacent surface is the `.deck` file loader parsing untrusted user input; that is captured under FR-019 (JSON Schema validation, reject unknown schema) and should be part of Story 6's review scope.

### Privacy Guardian
- *(Not consulted for MVP — Step 5b judgement.)* Rationale: no personal data collected, no PHI, no analytics, no telemetry, no third-party SDKs. Local storage contains only geometric parameters. If telemetry or share links are added, Privacy Guardian consultation becomes required.

### Platform Guardian
- *(Not consulted — no infrastructure, no Kubernetes, no networking, no cloud resources.)* Deployment target is GitHub Pages (static hosting). If a backend or CI-hosted preview environment is added, Platform Guardian consultation becomes required.

### Delivery Guardian
- **Deploy target = static hosting (GitHub Pages).** Deployment strategy = git-push-to-`main` → GitHub Actions builds → publishes to `gh-pages` branch. No blue-green, canary, or feature-flag machinery needed for MVP.
- **CI pipeline (required in Story 1):** typecheck, lint, boundary lint, unit tests (Vitest), build. E2E deferred until UI stories land.
- **Rollback:** revert the commit that triggered a bad deploy; static site is stateless.
- **Observability:** N/A for MVP — no server, no telemetry, no error reporting. The user can inspect their own DevTools console. Sentry or similar remains a future consideration.
- **SLIs/SLOs:** N/A — availability = hosting-provider SLA; no user counts to measure.

### Code Review Guardian (architectural impact)

The Code Review Guardian was consulted for architectural-impact assessment (Step 5b-arch) and returned **10 findings** (0 critical, 3 high, 5 medium, 2 low) plus 6 positive observations. Full verbatim report is preserved in the ticket handoff. Findings folded into this spec:

| # | Sev | Finding | Where folded into spec |
|---|---|---|---|
| 1 | HIGH | Missing `application/` layer — orchestrations would leak into stores or UI | System Impact → Affected components; Story tree S7 |
| 2 | HIGH | `serialization.ts` belongs in `persistence/`, not `domain/` | System Impact → Affected components; Story S6 |
| 3 | HIGH | `Layout` type must be a complete render contract; no math in scene | FR-005, FR-007; NFR-011; Story S4, S10 boundary rules |
| 4 | MED | `span-check` must depend on `SpanTable` interface, not concrete data | Key entity `SpanTable`; Story S5 |
| 5 | MED | Lumber must be stored by SKU, not raw mm dimensions | FR-011; Assumptions; Story S3 |
| 6 | MED | Layer visibility via `<group visible={…}>`, not mount/unmount | FR-007; NFR-002; Story S10 |
| 7 | MED | WarningOverlay must draw its own decoration independent of layers | FR-015; Story S11 |
| 8 | MED | `.deck` envelope needs generator/version/createdAt + JSON Schema | FR-018, FR-019; Assumptions; Story S6 |
| 9 | MED | Mount `zundo` on design store from day one | FR-024; Assumptions; Story S8 |
| 10 | LOW | Materials catalog fine for MVP; note repository-port path for future | Assumptions (noted); Story S3 (implementation note) |

Boundary-enforcement lint (`eslint-plugin-boundaries` or `dependency-cruiser`) added to Story 1's scope per findings #1/#2/#3.

---

## System Impact

### Affected components

| Component | Change type | Description |
|---|---|---|
| Repository `vbomfim/wooddeck` | New | Created public. First commit lands with Story 1 (scaffold). |
| `src/domain/` | New | Pure TS core: types, units, materials catalog, layout engine, span-check. No React, no Three.js. |
| `src/application/` | New | Use-case layer (Code Review Guardian finding #1). Thin orchestrations wired by state actions and UI handlers. |
| `src/persistence/` | New | `.deck` file schema + serialization + JSON Schema validation + local storage + file download/upload + PNG screenshot. `serialization.ts` moved here per finding #2. |
| `src/state/` | New | Two Zustand stores: `design-store.ts` (with `zundo` middleware) and `ui-store.ts`. |
| `src/scene/` | New | react-three-fiber scene: `DeckScene`, `CameraRig`, six `layers/*.tsx`, `WarningOverlay`. Consumes `Layout`; performs no geometry math (finding #3). |
| `src/ui/` | New | React shell: `AppShell`, `DisclaimerBanner`, `ParameterPanel`, `LayerTogglePanel`, `WarningsPanel`, `BomPanel`, `PlanView2D`, `ExportMenu`. |
| `.github/workflows/ci.yml` | New | Typecheck, lint, boundary lint, unit tests, build. Deploy job to `gh-pages` may be a later story. |
| `docs/ARCHITECTURE.md` | New | Records the layer boundaries and imports rule. |
| `docs/span-tables/` | New | Source PDFs / attribution / license notes for the IRC-2018 span data. |
| `docs/deck-file-schema-v1.json` | New | JSON Schema for the `.deck` v1 envelope. |
| `LICENSE` | New | MIT. |
| `README.md` | New | Project overview + disclaimer + build/run instructions. |

### Affected contracts

| Contract | Change | Backward compatible? |
|---|---|---|
| `.deck` file (schema v1) | New | Frozen after first release. Any breaking change requires schema v2 + migration function. |
| `DeckDesign` in-memory type | New | Freely evolvable within v1 as long as `.deck` v1 serialization is preserved. |
| `Layout` render contract | New | Adapters (`scene/`) depend on this shape. Additive changes safe; renames or removals require coordinated updates across scene components. |
| `SpanTable` interface | New | Additive changes safe; the MVP ships one impl (`IrcSpanTable`). |
| localStorage key `wooddeck:current-design:v1` | New | Same versioning discipline as file format. |

### Architectural deltas

- **New:** A pure hexagonal core (`domain/`) with an enforced import discipline. This assumption did not previously exist (greenfield); it becomes a load-bearing architectural invariant for the life of the project.
- **New:** UI is a *view* of application state; state is a *cache* of domain output. The 3D scene must be a pure consumer of `Layout` — no geometry decisions in `scene/`.
- **New:** Undo/redo is a first-class concern of the design store (via `zundo`) from day one, even before a UI surface exists.

### Backward compatibility and migration

- **Breaking changes:** None (greenfield).
- **Migration path:** N/A — no existing users or data.
- **Deprecation timeline:** N/A.

### Risk surface

**Risks introduced:**
- **`.deck` format calcification risk.** First breaking change to a shipped format is painful. Mitigated by shipping the version envelope + JSON Schema + `switch(schema)` loader on day one (FR-018, FR-019, Assumptions).
- **Scene ↔ domain drift risk.** The pure-core hexagonal design rots if scene components add geometry math. Mitigated by (a) `Layout` type as a complete render contract (FR-005), (b) boundary-enforcement lint (NFR-011), (c) explicit review checklist item in Story 10.
- **Legal-liability surface.** IRC span checks create an impression of engineering validation. Mitigated by FR-016 (non-dismissable disclaimer, on-first-paint) and SC-007 (unit-tested).
- **Three.js bundle size.** r3f + Three.js is ~500 KB gzipped. Mitigated by Vite's code-splitting; scene chunk lazy-loaded on first render.
- **WebGL requirement.** Users on very old browsers cannot use the 3D view. Mitigated by graceful "unsupported browser" fallback (Edge Case list) + read-only 2D plan view remains usable.

**Risks reduced:**
- Zero backend eliminates entire categories of risk: no auth, no secrets, no PII handling, no server ops, no third-party API failures, no CVE surface beyond frontend libraries.
- Static hosting eliminates infrastructure security posture from the review scope.

---

## Product Impact

### Positioning shift

Creates a new product where none existed — a **DIY-homeowner deck visualizer** with real structural feedback but explicitly not an engineering tool. Positioning: "Between a napkin sketch and a professional CAD package." Sets expectation that the app is a planning aid, not a permit-worthy engineering document — this framing is codified in the disclaimer (FR-016).

### Scope boundary changes

MVP scope is deliberately narrow (rectangular, freestanding, no attachments, no stairs, no railings, no multi-level) to preserve the "see what my deck will look like" outcome as the primary value. Explicitly declining scope for MVP:

- No stairs
- No railings / balusters
- No ledger board / house attachment
- No multi-level decks
- No terrain modeling
- No cost / pricing
- No cut list / cut-optimization export
- No 3D drag-editing (edits happen in the parameter panel; 2D plan is read-only in MVP)
- No cloud save / share links / accounts
- No PDF / OBJ / GLB export
- No mobile support

Every one of these is a plausible v2+ feature. The MVP contract is "prove the core visualization + peel-back-layers UX works, with real structural warnings."

### Roadmap dependencies

- **Unlocks:**
  - Stairs, railings, ledger board attachment → all become straightforward additions once the layout engine, layer scene-graph, and BOM are in place.
  - Alternative code editions (NBC / IRC-2024) → possible because `SpanTable` is an interface.
  - PWA / offline → straightforward because the app is already 100 % client-side.
  - Cost / BOM export → additive to the existing BOM panel.
- **Blocks or delays:** None — greenfield project blocks nothing.
- **Depends on:** Nothing external. Fully self-contained.

### User-facing communication

- **Internal stakeholders to inform:** N/A (solo hobby project).
- **External communication needed:** README + LICENSE + disclaimer are the entirety of external comms for MVP. Public repo visibility (`vbomfim/wooddeck` public) is the only public-facing surface.

---

## Appendix — References

- Code Review Guardian architectural-impact report (Step 5b-arch, 2026-07-02) — 10 findings, 6 positive observations. Verbatim report preserved in the ticket handoff to the orchestrator.
- User answers to PO clarifying questions (2026-07-02), sections A1–J27.
- IRC 2018 — International Residential Code, joist and beam span tables (to be attributed in `docs/span-tables/` before Story 5 ships).
- react-three-fiber documentation — https://docs.pmnd.rs/react-three-fiber
- Zustand documentation — https://github.com/pmndrs/zustand
- `zundo` (Zustand undo/redo middleware) — https://github.com/charkour/zundo
- fast-check (property-based testing) — https://github.com/dubzzz/fast-check
- dependency-cruiser (module-boundary linter) — https://github.com/sverweij/dependency-cruiser
- INVEST criteria — https://www.agilealliance.org/glossary/invest/
- Clean Architecture / Hexagonal Architecture — Robert C. Martin; Alistair Cockburn.
