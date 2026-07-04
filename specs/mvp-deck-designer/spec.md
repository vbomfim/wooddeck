# Feature Specification: MVP Wood Deck Designer

**Feature Branch**: `feat/mvp-deck-designer`
**Created**: 2026-07-02
**Status**: Draft
**Input**: User description: "A browser-only, client-side app that lets a DIY homeowner visualize a freestanding rectangular wood deck in 3D. Enter width × length × height, joist spacing, board size, and species/material; the app auto-lays out framing (joists, beams, posts, footings) and decking, renders it in 3D with orbit/zoom/pan, and lets the user toggle individual layers to 'see underneath.' Includes IRC-style span-table warnings. Save/load locally, download `.deck` JSON, PNG screenshot. No backend, no auth."

**Owner**: @vbomfim
**Last updated**: 2026-07-04
**Issue tracker**: (populated when the epic issue is created — see Decomposition)
**Tickets**: Epic #1 · Stories #2–#16 (S1–S15) · #38 (S16) · **Epic 2 (Phase F): #39 (S17), #40 (S18), #41 (S19), #42 (S20), #43 (S21), #44 (S22), #45 (S23), #46 (S24), #47 (S25), #48 (S26)** — see Decomposition

> **2026-07-04 amendment (Epic 2 — Foundations, Floating Model & Cut-List BOM):** MVP scope has been expanded — additively — before the umbrella `feat/mvp-deck-designer → main` PR. Three additions land under this spec:
>
> 1. **Foundation TYPE options** — the user picks one of three foundation systems: (a) the existing posts-on-poured-concrete-footings model, (b) precast concrete deck blocks (Oldcastle 11″×11″×7″), or (c) TuffBlock instant foundation blocks (12″×12″×4″ plastic pyramids). The existing model is preserved as the default; the two block products are added, each with its own dimensions, on-grade placement, and lumber-slot geometry.
> 2. **Construction MODEL** — the user picks one of two structural approaches: (a) `elevated` (the existing posts→beams→joists→decking stack) or (b) `floating` (a ground-level deck sitting on a grid of foundation blocks with beams + short blocking pieces + decking, no posts). Both models coexist; the user chooses per design.
> 3. **Cut-list-optimized BOM** — the Bill of Materials packs member cut-lengths into stock lumber lengths (a 1-D cutting-stock / first-fit-decreasing bin-pack) and reports total stock boards. Blocks are counted separately, as fixed-dimension precast products.
>
> The additions require a **`.deck` schema v2** (additive discriminated union for `foundation`, new `structure` enum, extended `MemberMaterialRef` for lumber-vs-block on `LayoutMember`, two new `MemberKind` values `block` + `blocking`) with a **v1→v2 migration** so old `.deck` files continue to load. New FRs FR-026 through FR-032 codify the behavior; new user stories US6 and US7 codify the value; the Decomposition tree adds ten new stories (S17–S26) shipping before the umbrella PR. This amendment supersedes S16's Open Question Q1 — "add support" is now modelable through the new foundation model. See the Decomposition and System Impact sections for the full delta.

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

### User Story 6 — "Pick the foundation that suits my yard" (Priority: P1 — added 2026-07-04)

The DIY homeowner's yard reality dictates the foundation. Some users have flat, well-drained ground and want an on-grade deck they can install in an afternoon (TuffBlocks under a floating frame). Some users want a low but stable installation without digging (precast concrete deck blocks under posts). Some users need a raised deck over uneven ground (posts on poured concrete footings — the existing model). The app must let the user pick the foundation TYPE and see the design change accordingly.

**Why this priority**: The current model bakes in one foundation choice (posts on footings), which is only one of three common DIY residential-deck patterns. Without the choice, the app cannot represent the two most-common ground-level installations (deck blocks, TuffBlocks) — and the "add support" remediation from S16 has no design surface to target.

**Independent Test**: With a rendered deck, switching the foundation TYPE selector in the ParameterPanel from "Posts on poured footings" to "TuffBlock instant foundation" replaces the footings with pyramidal blocks in the 3D view within 500 ms; the BOM updates to count blocks (product SKU) instead of footings (concrete volume). Switching back returns to the original design without data loss.

**Acceptance Scenarios**:

1. **Given** the default design (posts on footings), **When** the user selects "Precast concrete deck blocks (Oldcastle 11×11×7)" from the foundation-type selector, **Then** the footings disappear and 11×11×7 concrete deck blocks appear under each post at grade (block top at y=0), the 3D scene updates within 500 ms, and the BOM lists the block count with the product SKU.
2. **Given** a design using deck blocks, **When** the user selects "Posts on poured concrete footings" from the foundation-type selector, **Then** the design returns to the original posts-and-footings layout with no other parameter loss (footprint, joist SKU, spacing, etc. all preserved).
3. **Given** a `.deck` v1 file on disk (produced by the previous MVP build with posts-on-footings only), **When** the user opens it in a build that supports schema v2, **Then** the loader migrates the design to `foundation.type = 'posts-on-footings'` transparently and the deck renders identically to how it rendered in the previous build.

---

### User Story 7 — "Build a floating deck on TuffBlocks" (Priority: P1 — added 2026-07-04)

The homeowner wants a low, ground-level "floating" deck built on a grid of TuffBlocks — no posts, no digging. The frame is a grid of beams (2×8 stock) resting on the blocks, with short blocking pieces bracing between beams, and decking on top. The user picks the "Floating" construction model in the ParameterPanel and sees the 3D scene switch from the elevated posts→beams→joists stack to a low block-grid + beams + blocking + decking stack. The BOM correctly counts the block grid (by product SKU), the full-length beams, and — critically — packs the short blocking offcuts into stock 2×8 lengths so the BOM reports "N × 2×8×16 ft" rather than a raw list of every offcut.

**Why this priority**: This is a distinct construction pattern with wide DIY appeal (a Home Depot / TuffBlock reference build). Without it, the tool cannot represent the deck the user drew in the design brief (see the hand-drawn floating-deck example in this spec's amendment context) and misses the audience of homeowners who explicitly do NOT want to dig footings or set posts.

**Independent Test**: With the parameter panel, switching the construction MODEL from "Elevated" to "Floating" replaces the posts + drop-beams layout with a block-grid + beams-on-blocks + blocking layout within 500 ms; the BOM shows the block count separately and packs blocking offcuts into stock 2×8s (a mini worked example: 14×16″ + 2×14″ + 18×6″ blocking totals 360″ / 30 ft → 2 additional 2×8×16 stock boards, on top of the full-length beams).

**Acceptance Scenarios**:

1. **Given** the default (elevated + posts + footings) design, **When** the user selects "Floating" as the construction MODEL AND "TuffBlock" as the foundation TYPE, **Then** the 3D scene renders a grid of TuffBlocks at grade, full-length 2×8 beams resting on the blocks along the length axis, short 2×8 blocking members between beams, and decking on top; no posts and no footings appear.
2. **Given** a floating-deck design, **When** the user opens the BOM panel, **Then** the panel lists: (a) block count with the product SKU (e.g. "27 × TuffBlock 12×12×4"), (b) full-length beams grouped by stock length (e.g. "13 × 2×8×16 ft"), (c) blocking members packed into ADDITIONAL stock 2×8×16 boards via a first-fit-decreasing bin-pack (e.g. "2 × 2×8×16 ft (blocking)"), and (d) a total stock-board line summing (b) + (c).
3. **Given** a floating-deck design, **When** the user toggles the Blocks layer OFF and the Beams layer ON, **Then** the floating frame is visible without the block grid; toggling any layer never causes a re-layout or a shader recompile (existing NFR-002 preserved).
4. **Given** a floating-deck design, **When** the user selects "Posts on poured concrete footings" as the foundation TYPE, **Then** the app either (a) surfaces a validation error explaining that footings are only compatible with the `elevated` MODEL, OR (b) auto-switches the MODEL back to `elevated` — behavior defined in the FR-030 open question. The design MUST NOT enter an incoherent state.

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
- **FR-025**: For every over-span warning the Warnings panel MUST surface at least one selectable REMEDIATION OPTION — a concrete design change that, if applied, would clear or reduce the warning. Each option MUST show (a) a plain-English label naming the change (e.g. "Upgrade joists to 2×10"), (b) the resulting allowable span in the user's active unit system, and (c) whether the option would fully clear the warning. Applying an option MUST route through the existing `applyParameters` use-case so the change participates in undo/redo, autosave, and full re-layout + re-check. Remediation OPTIONS are computed by a pure domain function (unit-testable in isolation); the "apply" action is a store method. When no MVP-modelable option can clear the warning, the panel MUST tell the user why (e.g. "already at the largest stocked joist size") and MUST NOT silently offer no remediation. *(Origin: user report — "when I change length to 16' it gives me warnings ... but doesn't upgrade the project"; user preference — "reduce spacing, add support, or another option, and a button to fix based on the selected option.")*
- **FR-016**: System MUST display a non-dismissable disclaimer banner reading substantially "Planning aid, not an engineering document — consult a licensed professional or your local building department." The disclaimer MUST render on first paint. *(Ref: Code Review Guardian "Honorable mention"; user answer D12.)*

**Foundation types & construction model (added 2026-07-04 — Epic 2)**

- **FR-026** *(Foundation TYPE — additive discriminated union)*: The persisted `DeckDesign` MUST carry a `foundation` field that is a discriminated union of at least three variants: `{ type: 'posts-on-footings', post: MaterialRef, footing: FootingSpec }` (the pre-amendment default), `{ type: 'deck-blocks', product: BlockRef }` (precast concrete deck blocks, on-grade), and `{ type: 'tuffblocks', product: BlockRef }` (TuffBlock instant foundation blocks, on-grade). Adding a fourth variant post-MVP MUST NOT require a `.deck` schema bump provided the loader treats unknown `foundation.type` as an unknown-schema failure per FR-019 and provided any new variant is added under a schema-version bump.
- **FR-027** *(Construction MODEL — additive enum)*: The persisted `DeckDesign` MUST carry a `structure` field with the enum values `'elevated'` (the pre-amendment default: posts→beams→joists→decking) and `'floating'` (a ground-level frame resting on a block grid: blocks→beams→blocking→decking; no posts). Both models MUST coexist in the codebase — the layout engine dispatches on `structure` and runs one of two independently-testable layout paths. `structure = 'floating'` MUST NOT be combinable with `foundation.type = 'posts-on-footings'` — the compatibility matrix is enforced at the domain-model / apply-parameters boundary and surfaced as a `LayoutError` (or an equivalent typed error) when the combination is invalid. The default MUST remain `structure = 'elevated'` + `foundation.type = 'posts-on-footings'` for backward compatibility with every pre-amendment fixture and every migrated v1 `.deck` file.
- **FR-028** *(Foundation-block catalog — new product category)*: The materials domain MUST include a new **foundation-block catalog** — distinct from the lumber catalog — that stocks at least the two initial block products: (a) `oldcastle-11x11x7` — the Home Depot Oldcastle 11″×11″×7″ grey concrete deck block, with a lumber cross-slot accepting 2× stock and a center pocket accepting a 4×4 post; (b) `tuffblock-12x12x4` — the 12″×12″×4″ plastic pyramidal TuffBlock with joist / beam slots. Each block record MUST carry: a stable SKU, actual mm dimensions (width, depth, height), material class (concrete-precast, polypropylene), placement mode (on-grade), and the lumber cross-section(s) the block's slot accepts. The `LayoutMember.material` field MUST be extended to a discriminated union `MemberMaterialRef = LumberRef | BlockRef` (tag: `kind: 'lumber' | 'block'`) so consumers can pattern-match on member material type without SKU string parsing.
- **FR-029** *(Floating-deck layout engine — parallel to the elevated engine)*: When `structure = 'floating'`, the layout engine MUST produce a `Layout` with two new `MemberKind` values in addition to the existing five (`joist`, `beam`, `post`, `footing`, `board`): `block` (an on-grade foundation block from the foundation-block catalog) and `blocking` (a short lumber offcut braced perpendicularly between beams for lateral rigidity). The floating-model layout MUST: (a) place a grid of blocks on grade under every beam-to-beam intersection, at a spacing bounded by the beam's tributary-load allowable span from the S5 span-check tables (blocks are supports); (b) place full-length beams resting on the block grid along one deck axis (the axis is a design parameter, defaulting to the length axis); (c) place blocking members between adjacent beams in short runs (typical intervals derived from residential-carpentry practice, e.g. every 48″–96″ along the beam axis, bounded by the joist / bracing span tables); (d) place decking on top, oriented perpendicular to the beams by default. Posts and footings MUST NOT appear in a floating layout. Existing FR-002 (auto-layout) and FR-005 (individual-member geometry) apply uniformly to both models.
- **FR-030** *(Foundation-type × construction-model compatibility matrix)*: The valid combinations are (a) `structure = 'elevated'` × `foundation.type ∈ { 'posts-on-footings', 'deck-blocks' }` — an elevated deck may rest posts on either poured footings or on-grade deck blocks (blocks-under-posts is a common short-height installation); (b) `structure = 'floating'` × `foundation.type ∈ { 'deck-blocks', 'tuffblocks' }` — a floating deck rests DIRECTLY on the block grid (no posts). `structure = 'floating'` × `foundation.type = 'posts-on-footings'` is INVALID and MUST be rejected at the apply-parameters boundary with a message naming the invalid combination. `structure = 'elevated'` × `foundation.type = 'tuffblocks'` is INVALID for MVP (TuffBlock is designed for ground-level decks; the standard product does NOT rate for post-supported construction) and MUST be rejected with a message naming the reason. UI selectors MUST show invalid options in a disabled state with the reason surfaced as text (FR-025 pattern), NOT silently omit them.
- **FR-031** *(Cut-list-optimized BOM — 1-D bin-pack)*: The BomPanel MUST, for every lumber SKU + species + grade group in the layout, pack the member cut-lengths into standard stock lumber lengths (the stock lengths per SKU MUST come from the materials catalog; typical values: 8, 10, 12, 14, 16, 20 ft for 2× framing; 8, 10, 12, 14, 16, 18, 20 ft for 5/4 decking). The packing algorithm MUST use First-Fit-Decreasing (FFD) as an approximation of the 1-D cutting-stock problem — this is an NP-hard problem in general but FFD is well within acceptable waste for MVP-scale decks (< 500 members). The BOM MUST report, per SKU group: (a) total stock-board count, (b) breakdown by stock length (e.g. "13 × 2×8×16 ft"), and (c) an optional expandable per-board detail showing the offcuts each stock board is cut into (e.g. "Board 14: 16″ + 14″ + 6″ + 6″ + …, waste 8″"). Blocks (from FR-028) MUST be counted separately by product SKU — they are precast products, not lumber, and MUST NOT enter the cut-list pack. The pack MUST assume a fixed kerf (blade width, MVP: 3 mm) taken off each cut; kerf is deducted from the stock board's remaining usable length after each cut.
- **FR-032** *(Actionable "add support" remediation — supersedes S16 #38 Q1)*: The remediation-options set from FR-025 MUST include, when applicable, an `'add-support-row'` option that resolves an over-span warning by adding an intermediate row of foundation blocks (for `structure = 'floating'`) or an intermediate beam (post-MVP, tracked separately for `structure = 'elevated'`). When applied, the option MUST update the design so `spanCheck` re-runs against the new support geometry; if the new geometry still over-spans, a new warning is emitted (the remediation may only REDUCE, not necessarily clear — matching FR-025's `wouldClear` discipline). The option is DISABLED with a reason when the current design cannot accept an intermediate support (e.g. `structure = 'elevated'` in MVP where intermediate beams are not yet modelled) — in that case the remediation reason MUST surface the alternative (e.g. "Switch to Floating construction to enable intermediate support rows").

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
- **DeckFile (v2)** *(added 2026-07-04)*: The `.deck` on-disk envelope for the amended `DeckDesign` shape — `{schema: 2, generator: "wooddeck", generatorVersion, createdAt, design}` where the `design` payload carries the FR-026 `foundation` union, the FR-027 `structure` enum, and — inside `layout.members[*].material` — the FR-028 extended `MemberMaterialRef` discriminator. v1 files continue to load: the loader runs a v1→v2 migration transparently on parse, defaulting `structure = 'elevated'` and `foundation = { type: 'posts-on-footings', post: <v1.post.material>, footing: <FootingSpec derived from FOOTING_WIDTH_MM / FOOTING_DEPTH_MM constants> }`. v2 is the write default from the release that lands this amendment forward.
- **FoundationBlock** *(added 2026-07-04)*: A catalog record for a precast / manufactured on-grade foundation product — `{ productId: string, kind: 'block', category: 'concrete-precast' | 'polypropylene', actual: {widthMm, depthMm, heightMm}, placement: 'on-grade', acceptsLumber: readonly LumberNominal[] }`. Two initial products: `oldcastle-11x11x7` and `tuffblock-12x12x4`. Lives in a new `src/domain/foundation-catalog.ts` distinct from the lumber materials catalog because the two product classes have different dimensioning, purchase units (each block vs board-feet), and stock-length semantics (blocks have no stock-length concept).
- **CutListPack** *(added 2026-07-04)*: The output of the FR-031 bin-pack — `{ sku: LumberRef, stockLengthMm: Mm, boards: readonly PackedBoard[] }` where a `PackedBoard` is `{ cuts: readonly {label: string, lengthMm: Mm}[], wasteMm: Mm }`. Produced by a pure domain function `packCutList(members, stockLengths, kerfMm)` under `src/domain/bom/`. Consumed by `BomPanel` to render the per-SKU shopping list + optional per-board offcut breakdown.

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
- **SC-010** *(added 2026-07-04)*: A v1 `.deck` file round-trips through the amended loader — v1-load → migrate → v2-serialize → v2-load → recompute-layout — with the resulting rendered scene visually identical to the original v1 render. Verified by a golden fixture regression test.
- **SC-011** *(added 2026-07-04)*: For every design with ≤ 500 total lumber members, the FR-031 cut-list bin-pack completes in **≤ 50 ms** on the reference hardware, and the pack's total stock-board count is provably within 11/9 + 6/9 boards of the optimal solution (the FFD asymptotic worst-case bound; measured against a reference optimal-pack solver in a golden fixture set).

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
| Remediation (S16) | Actionable remediation options per span warning | #38 |
| **Foundations & Floating (Epic 2)** *(added 2026-07-04)* | **Foundation TYPE options + floating construction MODEL + cut-list BOM — all additive, ship before umbrella PR** | **S17 #39, S18 #40, S19 #41, S20 #42, S21 #43, S22 #44, S23 #45, S24 #46, S25 #47, S26 #48** |

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
    ├── S15 story/15-2d-plan-view           Read-only 2D top-down plan view
    └── S16 story/16-remediation-actions    Actionable remediation OPTIONS per warning (compute + apply)  (added post-S14 from user field-test; issue #38)

Epic 2 (added 2026-07-04) — Foundations, Floating Model & Cut-List BOM
├── Phase F — Foundations & Floating (ships BEFORE the umbrella PR)
│   │
│   │  Sub-phase F.1 — domain + persistence (unblock everything else)
│   ├── S17 story/17-foundation-model             Domain: foundation-catalog + foundation/structure model (schema v2 types + compat matrix)
│   ├── S18 story/18-deck-file-schema-v2          Persistence: .deck schema v2 + v1→v2 migration
│   │
│   │  Sub-phase F.2 — layout paths (parallel; both depend on S17)
│   ├── S19 story/19-floating-layout-engine       Domain: floating-deck layout engine (block grid + beams + blocking)
│   ├── S20 story/20-elevated-with-blocks         Domain: elevated-with-blocks adaptation (posts rest on deck-blocks)
│   │
│   │  Sub-phase F.3 — BOM (parallel with F.2; depends on S17)
│   ├── S21 story/21-cutlist-bom                  Domain: cut-list BOM (bin-pack) + stock-lengths in lumber catalog
│   │
│   │  Sub-phase F.4 — scene + UI (depend on F.2 + F.3)
│   ├── S22 story/22-blocks-blocking-scene        Scene: BlocksLayer + BlockingLayer + block geometries
│   ├── S23 story/23-foundation-ui                UI: StructureSelector + FoundationTypeSelector in ParameterPanel
│   ├── S24 story/24-bom-cutlist-ui               UI: BomPanel cut-list rendering (stock-boards + expandable offcuts)
│   ├── S25 story/25-add-support-remediation      Domain + UI: extend remediations with add-support-row (supersedes #38 Q1)
│   └── S26 story/26-layer-toggle-blocks          UI: LayerTogglePanel adds Blocks + Blocking toggles
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
  - **S16 (remediation actions)** depends on S5, S7, S8, S14. Added post-S14 in response to a user field-test observation (see FR-025). Ships BEFORE the umbrella `feat/mvp-deck-designer → main` PR so the MVP behavior for warnings is actionable, not advisory-only.

**Epic 2 (added 2026-07-04) — Phase F sequencing:**
- **F.1 — domain & persistence backbone (blocks everything else in F):**
  - **S17 (foundation model + catalog + compat matrix)** is the type-level linchpin. It touches `src/domain/model.ts` (adds `foundation` union + `structure` enum + extended `MemberMaterialRef`), adds `src/domain/foundation-catalog.ts`, and touches every module that reads/writes `DeckDesign`. Depends on: (nothing new — extends S3). Blocks S18, S19, S20, S21, S22, S23, S25.
  - **S18 (schema v2 + v1→v2 migration)** depends on S17 (needs the new types). Adds `docs/deck-file-schema-v2.json`, `src/persistence/deck-file/schema-v2.ts`, `src/persistence/deck-file/migrate-v1-to-v2.ts`, extends `deserialize` with the v1→migrate→v2 path AND a `case 2` branch, sets serialize's default write to v2. Blocks S23, S25.
- **F.2 — layout paths (parallel; both depend on S17):**
  - **S19 (floating-deck layout engine)** adds `src/domain/layout/floating-layout.ts`, extends `computeLayout` to branch on `design.structure`, adds `MemberKind = 'block' | 'blocking'` handling in the render contract, and updates `y-stack.ts` to a floating-model variant (no post extent; block extent below y=0). Adds a per-block span-check helper for block grid sizing. Blocks S22, S25.
  - **S20 (elevated-with-blocks)** extends the existing `layoutPostsAndFootings` to swap `footing` members for `block` members when `foundation.type in {'deck-blocks', 'tuffblocks'}` under `structure = 'elevated'`. Blocks S22, S25.
- **F.3 — cut-list BOM (parallel with F.2; depends on S17):**
  - **S21 (cut-list bin-pack + stock lengths)** adds `src/domain/bom/cut-list.ts` with a pure `packCutList` (first-fit-decreasing), extends `materials-catalog.ts` with `stockLengthsMm` per SKU, and MOVES `src/ui/bom/derive-bom.ts` → `src/domain/bom/derive-bom.ts` (the derivation is pure domain logic; the pragmatic S14 placement is now corrected under the epic's architectural cleanup). Blocks S24.
- **F.4 — scene + UI (depends on F.2 + F.3):**
  - **S22 (scene BlocksLayer + BlockingLayer)** adds two new scene-layer components + two new module-level geometries (`DECK_BLOCK_GEOMETRY`, `TUFFBLOCK_GEOMETRY` — the latter a hexagonal frustum). Depends on S19 + S20. Blocks S23, S26.
  - **S23 (foundation UI)** adds a StructureSelector + FoundationTypeSelector to the ParameterPanel, wires them to `applyParameters`, and surfaces the FR-030 compat-matrix errors inline. Depends on S17, S18, S22.
  - **S24 (BomPanel cut-list rendering)** extends `BomPanel` to render per-SKU stock-board totals + an expandable per-board offcut breakdown. Depends on S21.
  - **S25 (add-support-row remediation)** extends `computeRemediations` + `applyRemediation` with the FR-032 `add-support-row` option. Also PATCHES issue #38 to note that Q1 is resolved. Depends on S17, S19, S20 (needs the new layout paths so the applied remediation produces a valid re-layout). Ships alongside or after S23 so the UI surface exists.
  - **S26 (LayerTogglePanel + ui-store)** adds `blocks` + `blocking` visibility keys to `useUiStore.layerVisibility` and two new toggles in the LayerTogglePanel. Depends on S22.
- **S15 (2D plan view — pre-existing, issue #16)** is NOT blocked by Epic 2 and MAY ship in parallel; however, when Epic 2 lands S15 SHOULD be extended to render the new `block` + `blocking` member kinds in the 2D plan (a small follow-up either inside S15 or as a small addendum). This spec does not add a new story for that — the S15 ticket incorporates the extension when the developer picks it up post-Epic-2.
- **Umbrella PR (`feat/mvp-deck-designer → main`)** opens only after S15 + S16 + S17..S26 all land. The umbrella is the MVP release.

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

**Epic 2 (added 2026-07-04) — additions:**

| Component | Change type | Description |
|---|---|---|
| `src/domain/model.ts` | Modified | Adds `foundation` discriminated union + `structure` enum on `DeckDesign`. Adds `MemberMaterialRef = LumberRef \| BlockRef` (tagged union) on `LayoutMember`. Adds `MemberKind = ... \| 'block' \| 'blocking'`. |
| `src/domain/foundation-catalog.ts` | New | Fixed-dimension precast/manufactured on-grade product catalog. Two initial SKUs: `oldcastle-11x11x7`, `tuffblock-12x12x4`. |
| `src/domain/materials-catalog.ts` | Modified | Adds `stockLengthsMm: readonly Mm[]` per SKU (e.g. `2x8: [8, 10, 12, 14, 16, 20] ft`). |
| `src/domain/layout/floating-layout.ts` | New | The floating-model layout path — block grid + beams + blocking. |
| `src/domain/layout/layout-engine.ts` | Modified | `computeLayout` dispatches on `design.structure` to the elevated (existing) or floating (S19) path. Compat-matrix validation added to `validateDesign`. |
| `src/domain/layout/post-layout.ts` | Modified | When `foundation.type ∈ {'deck-blocks','tuffblocks'}` under elevated, footings are replaced by blocks (posts still present). |
| `src/domain/bom/cut-list.ts` | New | Pure `packCutList(members, stockLengthsMm, kerfMm)` — first-fit-decreasing bin-pack. |
| `src/domain/bom/derive-bom.ts` | Moved + Modified | Moved from `src/ui/bom/derive-bom.ts` (S14 pragmatic location) into the domain layer. Extended to emit per-SKU cut-list packs. Also emits a separate `foundation` section for `block`-kind members (product SKU + count). |
| `src/domain/spans/remediations.ts` | Modified | Adds `'add-support-row'` `RemediationKind` + `RemediationPatch` variant, consuming the new `structure` / `foundation` fields. |
| `src/persistence/deck-file/schema-v2.ts` | New | `.deck` v2 envelope + `serialize` (v2 write default) + `deserialize` case-2 branch. |
| `src/persistence/deck-file/migrate-v1-to-v2.ts` | New | Pure `migrateV1ToV2(v1Design)` — defaults `structure='elevated'` + `foundation.type='posts-on-footings'` + derives `FootingSpec` from the existing `FOOTING_WIDTH_MM`/`FOOTING_DEPTH_MM` constants. |
| `src/persistence/deck-file/errors.ts` | Modified | Adds `DeckFileErrorCode = ... \| 'migration-failed'`. |
| `docs/deck-file-schema-v2.json` | New | JSON Schema for the v2 envelope. |
| `src/scene/layers/BlocksLayer.tsx` | New | Renders `block`-kind members with product-specific geometry (`DECK_BLOCK_GEOMETRY` box or `TUFFBLOCK_GEOMETRY` hexagonal frustum). |
| `src/scene/layers/BlockingLayer.tsx` | New | Renders `blocking`-kind members (short 2× offcuts between beams). |
| `src/scene/layers/shared/geometries.ts` | Modified | Adds two new module-level geometries + disposal. |
| `src/scene/layers/DeckLayers.tsx` | Modified | Adds the two new layer components in the correct z-stack order (blocks before footings; blocking between joists and beams). |
| `src/ui/ParameterPanel.tsx` (and `src/ui/fields/`) | Modified | Adds StructureSelector + FoundationTypeSelector + block-product picker. |
| `src/ui/BomPanel.tsx` | Modified | Renders per-SKU stock-board totals + an expandable per-board offcut breakdown. Renders block foundation counts as a distinct section. |
| `src/ui/LayerTogglePanel.tsx` | Modified | Adds Blocks + Blocking toggles. |
| `src/ui/WarningsPanel.tsx` (via S25) | Modified | Renders the new `add-support-row` remediation option when computed. |
| `src/state/ui-store.ts` | Modified | `LayerVisibility` extended with `blocks: boolean, blocking: boolean`. |
| `src/state/default-design.ts` | Modified | Default seeds `structure='elevated'` + `foundation={type:'posts-on-footings', ...}` — preserving SC-004 golden-fixture behavior. |
| `.dependency-cruiser.cjs` | Modified | Extends `ui-allowlist` to admit `^src/domain/bom/` (BOM derivation moves into domain). |
| `scripts/boundary-selftest.mjs` | Modified | New probes for the block/blocking layer boundaries + the moved `derive-bom` location. |

### Affected contracts

| Contract | Change | Backward compatible? |
|---|---|---|
| `.deck` file (schema v1) | New | Frozen after first release. Any breaking change requires schema v2 + migration function. |
| `DeckDesign` in-memory type | New | Freely evolvable within v1 as long as `.deck` v1 serialization is preserved. |
| `Layout` render contract | New | Adapters (`scene/`) depend on this shape. Additive changes safe; renames or removals require coordinated updates across scene components. |
| `SpanTable` interface | New | Additive changes safe; the MVP ships one impl (`IrcSpanTable`). |
| localStorage key `wooddeck:current-design:v1` | New | Same versioning discipline as file format. |
| `.deck` file (schema v2) *(added 2026-07-04)* | New | Additive to v1. v1 files load through a v1→v2 migration. Serialize writes v2 from the release forward. Loader gate remains `switch (schema)` — any unknown version fails-loud. |
| `DeckDesign.foundation` (union) *(added)* | New | New required field. v1 loads default it to `{type: 'posts-on-footings', ...}`. |
| `DeckDesign.structure` (enum) *(added)* | New | New required field. v1 loads default it to `'elevated'`. |
| `LayoutMember.material` widening *(added)* | Modified | `MaterialRef` → `MemberMaterialRef = LumberRef \| BlockRef`. Every scene / BOM / span-check consumer must pattern-match on the discriminator. Backward-compatible at value level: existing lumber members carry `{kind:'lumber', ...}`. |

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

**Risks introduced by Epic 2 (added 2026-07-04):**
- **Schema drift risk (v1 vs v2).** A v1 file loaded by a v2 build must migrate cleanly; a v2 file loaded by a v1 build must fail-loud with `unknown-schema`. Mitigated by: (a) SC-010 v1-round-trip golden test, (b) the existing `KNOWN_SCHEMA_VERSIONS` `switch` gate, (c) a new `'migration-failed'` `DeckFileErrorCode` so any migration issue surfaces distinctly from a corrupt-file issue.
- **Compat-matrix drift risk.** The FR-030 compatibility rules (`structure` × `foundation.type`) are cross-cutting; a future story that adds a new foundation product must update the matrix or the app enters an incoherent state. Mitigated by: (a) an exhaustive-switch validator in the domain layer, (b) a golden fixture set covering every valid combination, (c) a boundary-lint self-test probe that fires when the matrix is bypassed.
- **BOM correctness risk.** FFD is a heuristic — it may over-count stock boards vs an optimal pack. Mitigated by: SC-011 (asymptotic-bound assertion vs a reference optimal solver in a golden set), and by the transparent per-board offcut breakdown in the UI so a user can spot-check the pack.
- **Scene complexity risk.** Two new geometries + two new layer components + a doubled `MemberKind` set expand the surface the "no geometry math in scene" test scans. Mitigated by: extending `no-geometry-math.test.ts` to cover the two new components; keeping `TUFFBLOCK_GEOMETRY` as a stable `CylinderGeometry(topR, botR, height, 6)` singleton (no per-instance math).
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

MVP scope is deliberately narrow (rectangular, freestanding, no attachments, no stairs, no railings, no multi-level) to preserve the "see what my deck will look like" outcome as the primary value. The 2026-07-04 amendment (Epic 2) BROADENS scope to include foundation-type choice + a floating construction model + a cut-list-optimized BOM — all still under the "rectangular / freestanding" umbrella. Explicitly declining scope for MVP:

- No stairs
- No railings / balusters
- No ledger board / house attachment
- No multi-level decks
- No terrain modeling
- No cost / pricing
- **~~No cut list / cut-optimization export~~** — **REVERSED 2026-07-04** by FR-031 (cut-list-optimized BOM in-panel; PDF/CSV export deferred)
- No 3D drag-editing (edits happen in the parameter panel; 2D plan is read-only in MVP)
- No cloud save / share links / accounts
- No PDF / OBJ / GLB export
- No mobile support
- **~~No intermediate beams (only two end beams)~~** — **PARTIALLY REVERSED 2026-07-04**: the floating model's beam grid supports intermediate beams; the elevated model retains the two-end-beam MVP simplification until a post-MVP story adds intermediate-beam support for `structure='elevated'` (tracked under FR-032's disabled-option reason).
- No terrain / slope compensation on the block grid (blocks are assumed to sit level on level ground; leveling is the user's real-world job — the model does not raise/lower individual blocks).

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
