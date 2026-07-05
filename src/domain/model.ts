/**
 * `src/domain/model.ts` — the canonical domain entities for wooddeck.
 *
 * ## Purpose
 *
 * This module is the SINGLE source-of-truth for the shape of every
 * persisted or in-memory design entity — `DeckDesign`, its
 * `MaterialRef` parts, the `Layout` render contract produced by S4,
 * the `Warning` produced by S5, and the `Material` catalog record
 * consumed by every downstream layer.
 *
 * It intentionally contains **NO runtime code** — no functions, no
 * side effects, no globals. Every export is a `type` / `interface`.
 * This has three consequences the reader must keep in mind:
 *
 *   1. The whole module compiles to an empty JavaScript file. It
 *      still ships as `.ts` (not `.d.ts`) so consumers `import type
 *      { … } from './model'` uniformly with the rest of the codebase.
 *   2. Because there is no runtime footprint, this file automatically
 *      satisfies the `src/domain/**` framework-free / DOM-free rule
 *      enforced by ESLint + dependency-cruiser (see
 *      `.dependency-cruiser.cjs` and `eslint.config.js`).
 *   3. Behavior lives elsewhere — in `layout-engine` (S4), `span-check`
 *      (S5), `persistence` (S6), and use-cases (S7). NEVER add a
 *      method to any interface in this file (spec § Assumptions:
 *      "anemic data types vs. class methods → A").
 *
 * ## Layout is defined here on purpose
 *
 * `Layout` / `LayoutMember` are produced by the S4 engine and consumed
 * by S10 scene components. Both are downstream of `model.ts`. Placing
 * the types here — rather than in the engine — lets scene components
 * import the render-contract shape WITHOUT depending on the engine at
 * all, preserving the boundary rule "domain/ may import ONLY from
 * domain/" (Clean Architecture dependency inversion). Ticket §2
 * explicitly calls this out: "Defined here so scene components can
 * import the type without depending on the engine."
 *
 * ## SKU-based lumber identity
 *
 * Boards and framing members carry a `MaterialRef` (nominal SKU +
 * species + grade), NOT raw millimeter dimensions. Actual mm sizes
 * are DERIVED via `materials-catalog.lookupMaterial(...)`. This
 * addresses Code Review Guardian finding #5 (raw mm loses shopping-list
 * identity and creates imperial round-trip drift) and matches FR-011.
 */

import type { Mm } from './units';

// ==========================================================
// SKU-based lumber identity
// ==========================================================

/**
 * Nominal lumber SKUs the MVP catalog supports. `"5/4x6"` is the
 * common decking board (actual 1" × 5.5"); `"4x4"` and `"6x6"` are
 * posts. Adding a new size is a spec change — update FR-012 and
 * `materials-catalog.ts` in the same commit.
 */
export type LumberNominal =
  | '2x6'
  | '2x8'
  | '2x10'
  | '2x12'
  | '4x4'
  | '6x6'
  | '5/4x6';

/**
 * Species / material CATEGORY — the user-facing "what am I buying?"
 * dimension. This is deliberately NOT the same enum span-tables key
 * on:
 *
 *   - `"PT"`        = pressure-treated softwood dimension lumber.
 *                     Typically Southern Yellow Pine (SYP) in the
 *                     Southeastern US / Hem-Fir in the West / SPF in
 *                     Canada. Treatment is copper azole / MCA class.
 *   - `"Cedar"`     = naturally rot-resistant Western Red Cedar.
 *   - `"Composite"` = wood-plastic composite decking (Trex /
 *                     TimberTech / Fiberon family). NON-STRUCTURAL
 *                     for MVP span purposes — composite is only used
 *                     as decking (5/4x6, 2x6-2x12 boards), never
 *                     framing.
 *
 * Composite is NOT graded — it uses `Grade: "NA"` (see below).
 *
 * ## IRC span-table mapping — deferred to S5
 *
 * The IRC-2018 joist and beam span tables (Table R502.3.1(1) etc.)
 * key on STRUCTURAL SPECIES GROUPS (SPF, SYP/Southern Pine, DF-L,
 * Hem-Fir, Redwood, Cedars), not on the material-category enum above.
 * The Species → structural-group mapping is INTENTIONALLY not
 * expressed in `model.ts` because:
 *
 *   1. The mapping depends on region + supplier (a "PT" board in
 *      Georgia is almost certainly SYP; in California it may be
 *      Hem-Fir), which is UI/region context S3 has no access to.
 *   2. The mapping is a policy decision (which structural group do
 *      you assume when the user picks "PT"?) that belongs with the
 *      span-check logic, not with the material catalog.
 *
 * Consequently S5 (`span-check`) owns the `Species → structural
 * species group` translation used at span-lookup time. Do NOT add
 * that mapping to this file.
 *
 * @todo S5: implement `Species → IRC structural species group` for
 *       span-table lookups. See `.github/tickets/05-span-check.md`.
 */
export type Species = 'PT' | 'Cedar' | 'Composite';

/**
 * Softwood grades per the American Softwood Lumber Standard PS 20.
 * `"NA"` is a *sentinel* used only for Composite, which has no grade
 * — it is a manufactured product, not a graded natural material.
 * The catalog throws when a Composite lookup is paired with any grade
 * other than `"NA"`, and vice-versa (see `materials-catalog.test.ts`).
 */
export type Grade = 'No1' | 'No2' | 'Select' | 'NA';

/**
 * A CATALOG record: a material fully described by its nominal SKU +
 * species + grade, with the DERIVED actual dimensions attached.
 * Consumers should NOT construct `Material` values directly — they
 * are produced by `materials-catalog.lookupMaterial(...)` from the
 * canonical dressed-size table. Constructing one manually risks
 * drifting from the catalog and breaking the FR-011 SKU-identity
 * guarantee.
 *
 * ## S21 addition — stockLengthsMm (FR-031)
 *
 * `stockLengthsMm` is the sorted (ascending), non-empty list of
 * standard stock-board lengths carried for the SKU at the reference
 * lumberyard (Home Depot Canada, verified 2026-07-04). The BOM's
 * cut-list bin-packer (`packCutList` in `src/domain/bom/`) reads
 * this field as its `stockLengthsMm` input — the catalog is the
 * single source of truth so the pack policy is PARAMETRIC on the
 * SKU. A future region-specific catalog can supply a different list
 * without changing the packer.
 */
export interface Material {
  readonly nominal: LumberNominal;
  readonly species: Species;
  readonly grade: Grade;
  readonly actual: { readonly widthMm: Mm; readonly heightMm: Mm };
  readonly stockLengthsMm: readonly Mm[];
}

/**
 * A REFERENCE to a catalog material — no derived dimensions attached.
 * This is what `DeckDesign` stores: the design carries the SKU
 * identity ("2×6 PT No2"), and any consumer that needs the actual
 * millimeters does a catalog lookup at use-time. That way a
 * catalog-side dimension revision propagates automatically without a
 * persisted-design migration.
 */
export interface MaterialRef {
  readonly nominal: LumberNominal;
  readonly species: Species;
  readonly grade: Grade;
}

// ==========================================================
// Foundation & structure model (Epic 2 / S17 / FR-026, FR-027)
// ==========================================================
//
// The MVP deck supports THREE foundation TYPES (posts-on-footings —
// the legacy S3/S4 model; precast concrete deck blocks; TuffBlock
// polypropylene blocks) and TWO construction MODELS (elevated — the
// legacy model; floating — new). The compatibility matrix that
// pairs a `structure` with a `foundation.type` lives in
// `compat-matrix.ts` (FR-030).
//
// `FoundationSpec` is a discriminated union tagged on `type` so
// downstream consumers can `switch(design.foundation.type)` with an
// exhaustive `default` that a `never` guard fail-compiles when a new
// variant is added (`noFallthroughCasesInSwitch: true`).
//
// See specs/mvp-deck-designer/spec.md § 2026-07-04 Epic 2 amendment
// for the full spec text.
// ==========================================================

/**
 * The two construction MODELS the MVP supports.
 *
 *   - `'elevated'` — traditional post-supported deck. Posts sit in
 *     poured footings or precast concrete blocks; joists rest on
 *     beams that rest on posts. This is the legacy S3/S4 model.
 *   - `'floating'` — ground-level deck resting directly on a grid of
 *     precast blocks (Oldcastle) or polypropylene pucks (TuffBlock).
 *     No posts; joists rest directly on the block grid. New in
 *     Epic 2 (S19).
 */
export type StructureMode = 'elevated' | 'floating';

/**
 * Stable id union for every foundation block product the MVP catalog
 * stocks. Kept in `model.ts` (not `foundation-catalog.ts`) so the
 * domain types form an acyclic dependency graph — `foundation-catalog`
 * IMPORTS this type, not the other way around.
 *
 * Adding a new product = add a literal here + a row to
 * `MVP_PRODUCTS` in `foundation-catalog.ts`. Downstream consumers
 * `switch(productId)` with an exhaustive `default: never` so an
 * omitted branch fails-compile.
 */
export type FoundationProductId = 'oldcastle-11x11x7' | 'tuffblock-12x12x4';

/**
 * Dimensions of a poured or precast footing. Kept as a small
 * standalone record rather than an inline object literal so a future
 * feature (footing depth override, per-post custom sizing) can add
 * fields without touching the `FoundationSpec` union. The MVP
 * default is `{ widthMm: 300, depthMm: 300 }` — matches the legacy
 * `FOOTING_WIDTH_MM` / `FOOTING_DEPTH_MM` constants in
 * `layout/y-stack.ts` (source of truth for S4's footing math).
 */
export interface FootingSpec {
  readonly widthMm: Mm;
  readonly depthMm: Mm;
}

/**
 * Reference to a catalog block product — mirrors the SKU-identity
 * pattern used for lumber (FR-011). The `productId` is a stable enum
 * literal; concrete dimensions are DERIVED via
 * `foundation-catalog.lookupFoundationProduct(id)` at use-time. That
 * way a catalog-side dimension revision propagates without a
 * persisted-design migration.
 */
export interface FoundationBlockRef {
  /** Stable id — key into the foundation catalog. */
  readonly productId: FoundationProductId;
}

/**
 * Discriminated union over the three foundation TYPES. The `type`
 * tag is stable — a rewrite MAY change other fields inside a variant
 * without touching the consumers as long as the tag stays.
 *
 *   - `'posts-on-footings'` — carries the post material and the
 *     footing dimensions. **This is the SINGLE source of truth for
 *     the elevated deck's post material.** The pre-S17 top-level
 *     `design.post` field was REMOVED during review-gate FIX 2 to
 *     eliminate a dual-SoT drift bug — every consumer that needs the
 *     post material MUST read `design.foundation.post` guarded by
 *     `design.foundation.type === 'posts-on-footings'`.
 *   - `'deck-blocks'`      — precast concrete deck blocks (e.g.
 *     Oldcastle). Carries a reference to the catalog product.
 *   - `'tuffblocks'`       — polypropylene instant-foundation pucks.
 *     Carries a reference to the catalog product. Only rated for
 *     ground-level (floating) construction — enforced by
 *     `compat-matrix.ts` (FR-030).
 *
 * ## Optional block-grid overrides (S25 / FR-032 — ticket #47)
 *
 * The `deck-blocks` / `tuffblocks` variants carry OPTIONAL
 * `blockRowsHint` / `blockColsHint` fields — dimensionless integers
 * that override the derived block-grid count under a floating deck.
 *
 * ## S26 per-method semantics
 *
 * After the S26 `floatingFraming` split, the effective hint depends
 * on which framing method the design uses:
 *
 *   - **Method A (`'beams-and-joists'`, DEFAULT)** — rows are
 *     PINNED to the two rim-beam z-positions (`explicitRowZCenters`
 *     is supplied by the layout engine). `blockRowsHint` is a
 *     **no-op** in this method (the beams dictate the row layout;
 *     more blocks along +z would sit under nothing structural).
 *     `blockColsHint` still controls the column count and bounds
 *     the +x block spacing under each rim beam.
 *   - **Method B (`'joists-on-blocks'`)** — columns are PINNED to
 *     the joist x-centers so every joist has a support column
 *     (`explicitColXCenters` is supplied). `blockColsHint` is a
 *     **no-op** in this method. `blockRowsHint` still controls the
 *     row count along +z, which directly shortens the joist span
 *     between supports.
 *
 * ## Legacy (elevated + `posts-on-footings`)
 *
 * NOT MEANINGFUL for `posts-on-footings` — the elevated post grid
 * is derived from beam-count math that has no equivalent "add a
 * row" degree of freedom in the MVP scope (the elevated variant of
 * add-support-row is deferred per ticket #47 §16, Q7).
 *
 * ## Base semantics (both methods)
 *
 *   - `blockRowsHint = N` → place EXACTLY N rows of blocks along
 *     +z (subject to the pinning rules above), regardless of the
 *     natural derivation (`ceil(lengthMm / joistSpanMaxMm) + 1`).
 *     Clamped by `computeBlockGrid` to
 *     `[2, floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1]` so an
 *     out-of-range hint never spawns a degenerate or absurd grid.
 *   - `blockColsHint = M` → same, along +x (mirror override for
 *     the beam-column axis).
 *   - `undefined` → S19 pre-S25 derivation preserved
 *     BYTE-IDENTICALLY. Every existing golden fixture and layout
 *     snapshot is stable when the hint is omitted.
 *
 * ## S25 remediation seam
 *
 * These fields are the seam the S25 `add-support-row` remediation
 * writes to when the user clicks "Add a row of blocks (N → N+1)"
 * in the WarningsPanel. **S26 rescope (FIX #4):** the remediation
 * is DISABLED under Method A + `over-span-beam` warnings because
 * `blockRowsHint` is a no-op there — see the alternative surfaced
 * via FR-032 (reduce joist spacing / heavier joist / switch to
 * Method B). Under Method B + `over-span-joist` warnings the
 * remediation is ENABLED and genuinely shortens the joist span
 * between supports.
 */
export type FoundationSpec =
  | { readonly type: 'posts-on-footings'; readonly post: MaterialRef; readonly footing: FootingSpec }
  | {
      readonly type: 'deck-blocks';
      readonly product: FoundationBlockRef;
      /** S25: override for the derived block-row count. See doc-block above. */
      readonly blockRowsHint?: number;
      /** S25: override for the derived block-column count. See doc-block above. */
      readonly blockColsHint?: number;
    }
  | {
      readonly type: 'tuffblocks';
      readonly product: FoundationBlockRef;
      /** S25: override for the derived block-row count. See doc-block above. */
      readonly blockRowsHint?: number;
      /** S25: override for the derived block-column count. See doc-block above. */
      readonly blockColsHint?: number;
    };

// ==========================================================
// LayoutMember material widening (Epic 2 / S17 / FR-026, FR-029)
// ==========================================================
//
// Prior to S17 every `LayoutMember.material` was a `MaterialRef`
// (lumber SKU triple). Epic 2 introduces block members (foundation
// pucks/blocks) whose "material" is a catalog block product, not a
// lumber triple. The widened `MemberMaterialRef` is a discriminated
// union tagged on `kind`:
//
//   - `{kind:'lumber',  nominal, species, grade}` — the previous shape,
//     wrapped in a tag. Every existing joist/beam/post/decking
//     producer stamps this variant.
//   - `{kind:'block',   productId}` — a foundation block (added in
//     S19/S20 members). BOM + scene consumers switch on `.kind`
//     before reading lumber-specific fields.
//
// Consumers reading `.material.nominal` on a `LayoutMember` MUST
// guard with `if (member.material.kind === 'lumber')` (or use
// `getLumberRef` below). The `.material.*` fields on `DeckDesign`
// (design.joist.material, design.beam.material, etc.) remain the
// narrower `MaterialRef` — only LAYOUT members are widened.
// ==========================================================

/**
 * The lumber variant of `MemberMaterialRef` — same shape as the
 * pre-S17 `MaterialRef`, tagged for the discriminated union.
 */
export interface LumberMemberMaterial {
  readonly kind: 'lumber';
  readonly nominal: LumberNominal;
  readonly species: Species;
  readonly grade: Grade;
}

/**
 * The block variant of `MemberMaterialRef` — carries a product id
 * that a consumer can pass through `lookupFoundationProduct` to
 * derive dimensions or a display name.
 */
export interface BlockMemberMaterial {
  readonly kind: 'block';
  readonly productId: FoundationProductId;
}

/**
 * The widened `LayoutMember.material` type. Discriminated on
 * `.kind`. Adding a new variant is a spec change and must be paired
 * with an exhaustive `default: never` update at every consumer's
 * `switch` (compile-enforced via `noFallthroughCasesInSwitch`).
 *
 * ## Consumer pattern
 *
 * Consumers reading lumber-specific fields (nominal / species /
 * grade) MUST guard with a discriminant check:
 *
 * ```ts
 * if (member.material.kind === 'lumber') {
 *   const size = lookupMaterial(
 *     member.material.nominal,
 *     member.material.species,
 *     member.material.grade,
 *   );
 * }
 * ```
 *
 * A convenience helper `getLumberRef(m)` is available in
 * `member-material.ts` when the consumer wants a `LumberMemberMaterial
 * | null` value rather than a `switch`.
 */
export type MemberMaterialRef = LumberMemberMaterial | BlockMemberMaterial;

// ==========================================================
// Shared geometry helpers
// ==========================================================

/**
 * Overall extent of a rectangular volume in millimeters — the shape
 * shared by `DeckDesign.footprint` (design intent) and `Layout.bounds`
 * (actual axis-aligned bounding box of the produced layout).
 *
 * Field names use the DECK-DIMENSION vocabulary (width / length /
 * height) rather than raw axis labels (x / y / z) so the design-time
 * entity reads naturally regardless of the coordinate frame the
 * layout engine renders in. See "LAYOUT COORDINATE FRAME" below for
 * the axis mapping the render side commits to.
 */
export interface Dimensions3D {
  readonly widthMm: Mm;
  readonly lengthMm: Mm;
  readonly heightMm: Mm;
}

// ==========================================================
// Canonical design entity — the SOURCE OF TRUTH
// ==========================================================

/**
 * The root persisted entity. Serialized to `.deck` JSON files (S6),
 * fed into the layout engine (S4), and rendered by the scene (S10).
 *
 * Property order matters: `JSON.stringify` emits properties in
 * insertion order, and the AC4 byte-for-byte round-trip test asserts
 * a specific canonical order. Fixture authors must construct
 * `DeckDesign` literals with fields in the order declared here.
 *
 * `readonly` throughout — mutations MUST go through a state store
 * that produces a NEW `DeckDesign` value (S8), so `zundo` undo/redo
 * can snapshot cleanly and persistence sees a stable identity.
 */
export interface DeckDesign {
  readonly id: string; // RFC 4122 v4 UUID (see id.ts)
  readonly createdAt: string; // ISO-8601 timestamp
  readonly footprint: Dimensions3D;
  /**
   * Epic 2 / S17 addition (FR-027) — construction model. `'elevated'`
   * matches the legacy S3/S4 post-supported model; `'floating'` is
   * ground-level construction (S19). See `StructureMode` for the
   * semantic meaning.
   */
  readonly structure: StructureMode;
  /**
   * Floating-framing method (S26 — the fix/floating-framing-joists
   * ticket). Selects HOW a floating deck is framed on top of its
   * block grid. Only meaningful when `structure === 'floating'` —
   * the elevated pipeline IGNORES this field entirely (elevated
   * framing is fixed: joists on rim beams on posts).
   *
   * ## Method A — `'beams-and-joists'` (default)
   *
   * Elevated-style framing resting on blocks. The framing plane
   * carries EXACTLY 2 rim beams (near/far) running along +x at
   * each z-end, mirrored from the elevated `layoutBeams`. Joists
   * run along +z on top of the beams, spaced across +x at
   * `design.joist.spacingMm` — identical count/pitch to the
   * elevated `layoutJoists`. Blocks sit under the two rim beams.
   *
   * y-stack (bottom-up): block → beam → joist → decking.
   *
   * This is the DEFAULT because it is the framing method every
   * DIY floating-deck tutorial (Simpson, Home Depot, TuffBlock
   * install guide) describes — rim beams distribute load laterally
   * across the block grid, joists at the user's chosen o.c.
   * spacing support the decking.
   *
   * ## Method B — `'joists-on-blocks'`
   *
   * Beam-less framing. Joists run along +z at
   * `design.joist.spacingMm` DIRECTLY on top of the block grid.
   * No beams. Blocks are arranged in rows along the joist length
   * (bounded by the joist's allowable span) with columns aligned
   * to the joist x-positions — each joist bears on a column of
   * blocks. Lower profile than Method A (saves one lumber layer).
   *
   * y-stack (bottom-up): block → joist → decking.
   *
   * Both methods honor `design.joist.spacingMm` (the pre-S26 bug
   * ignored spacing entirely — decking rested directly on widely-
   * spaced beams). Both use the shared `computeJoistXCenters`
   * helper so floating joist pitch is byte-identical to elevated
   * joist pitch for a given width + spacing.
   *
   * See `src/domain/layout/floating/floating-layout.ts` for the
   * dispatch site and `src/ui/fields/FloatingFramingSelector.tsx`
   * for the user-facing selector.
   *
   * ## Placement rationale (S26 FIX #7)
   *
   * This field is a **sub-discriminator** of `structure` — its
   * meaning is defined only when `structure === 'floating'`. Placed
   * IMMEDIATELY AFTER `structure` in the interface, in
   * `default-design.ts`, in the model.test golden fixture, and in
   * all test/property fixtures so a code-reader encounters the
   * qualifier alongside the field it qualifies. Field-order
   * consistency (Opus#6) is enforced by convention across those
   * files; a byte-order test in `model.test.ts` locks the JSON
   * key order.
   */
  readonly floatingFraming: FloatingFraming;
  /**
   * Epic 2 / S17 addition (FR-026) — foundation TYPE + parameters.
   * Discriminated on `.type` so an omitted branch in a downstream
   * `switch` fails-compile. See `FoundationSpec`.
   *
   * The `structure`/`foundation.type` pair is validated by
   * `compat-matrix.ts` (FR-030); illegal combinations (e.g.
   * `floating` + `posts-on-footings`) are rejected at validation
   * time with a user-legible reason.
   */
  readonly foundation: FoundationSpec;
  readonly joist: {
    readonly material: MaterialRef;
    readonly spacingMm: Mm; // e.g. 406 mm ≈ 16" o.c.
  };
  readonly beam: { readonly material: MaterialRef };
  readonly decking: {
    readonly material: MaterialRef;
    readonly orientation: 'parallel-to-length' | 'parallel-to-width';
  };
  /**
   * Layout preferences — not user-editable in the MVP but declared
   * here so the `.deck` v1 envelope reserves the field. Adding a new
   * strategy value is a spec change and must be paired with a
   * migration in S6.
   */
  readonly layout: {
    readonly bayRemainderStrategy: 'extra-bay-at-end' | 'centered';
  };
}

/**
 * The two S26 floating-framing methods. Exported as a named type
 * alias so the UI selector, application-layer patch handlers,
 * persistence schemas, and property-based test arbitraries can
 * refer to the union by name (never inline the literal union — a
 * future third method would require re-fanning-out otherwise).
 */
export type FloatingFraming = 'beams-and-joists' | 'joists-on-blocks';

// ==========================================================
// LAYOUT COORDINATE FRAME — the binding contract for S4 & S10
// ==========================================================
//
// Every `LayoutMember.position` / `.size` / `.rotation` value below
// is expressed in the following canonical world frame. S4 (layout
// engine) PRODUCES values in this frame; S10 (three.js scene) and
// S15 (2D plan view) CONSUME them unchanged. Any deviation is a
// spec break — do not "helpfully" swap axes downstream.
//
// ## Axis mapping (right-handed — three.js default)
//     +x  →  DECK WIDTH    (matches `DeckDesign.footprint.widthMm`)
//     +y  →  UP / HEIGHT   (gravity opposes +y — matches
//                            `DeckDesign.footprint.heightMm`)
//     +z  →  DECK LENGTH   (matches `DeckDesign.footprint.lengthMm`)
//
// three.js's default camera and helpers assume this exact
// right-handed frame with +y up, so no per-scene axis-flipping is
// needed. Rationale for width→x rather than length→x: `x` reads as
// the "horizontal on-screen" axis in the front elevation view, and
// deck width is the dimension a homeowner sees when facing the
// deck from the house.
//
// ## Origin
//   `(0, 0, 0)` is the GROUND-LEVEL CENTER of the deck footprint —
//   the point directly below the geometric middle of the deck
//   surface, at the ground plane. Consequently:
//     - `LayoutMember.position.x` ranges over `[-widthMm/2, +widthMm/2]`
//     - `LayoutMember.position.z` ranges over `[-lengthMm/2, +lengthMm/2]`
//     - `LayoutMember.position.y` ranges over `[0, footprint.heightMm]`
//       for above-ground framing; footings extend into `-y`.
//   Rationale for centering horizontally: camera orbit + preset
//   views (top / front / iso) behave symmetrically with no
//   recentering pass. Rationale for y=0 at the ground plane: it
//   matches user intuition ("the deck sits ON the ground") and lets
//   S9's ground plane render at y=0 with no offset.
//
// ## Rotation
//   `LayoutMember.rotation` is Euler angles in RADIANS, applied in
//   `'XYZ'` order — three.js's `Object3D.rotation` default. For MVP
//   framing every member is axis-aligned, so all three components
//   are typically `0`; the field is present so post-MVP diagonals /
//   stairs / attached decks do not need a schema migration.
//
// ## Why this section lives in `model.ts`
//   S4 (producer) and S10 / S15 (consumers) both need this
//   contract. Placing it in the engine would force the scene to
//   import from S4 (violating the domain-only import graph for
//   scene per NFR-011). Placing it in the scene would give the
//   engine no shared reference. It belongs at the type boundary —
//   here.
// ==========================================================

// ==========================================================
// Layout — the render contract (produced by S4, consumed by S10)
// ==========================================================

/**
 * The seven drawable primitives. Scene components render each `kind`
 * with its own material and, when applicable, warning overlay. The
 * literal set is exhaustive on purpose — pattern-matches (`switch`
 * with `noFallthroughCasesInSwitch: true` + `never` default) will
 * fail-compile if a new kind is added without updating the scene.
 *
 * Epic 2 / S17 widening (FR-026, FR-029):
 *   - `'block'`    — a foundation block/puck (foundation pad in the
 *     floating model or in the elevated + deck-blocks combination).
 *     Rendered by S22 layers; produced by S19/S20 layout math.
 *   - `'blocking'` — short lumber block installed between joists
 *     for lateral bracing. Produced by S19's floating-layout math.
 */
export type MemberKind = 'joist' | 'beam' | 'post' | 'footing' | 'board' | 'block' | 'blocking';

/**
 * A single drawable member with FULL 3D placement in millimeters.
 * The layout engine (S4) computes every field — the scene performs
 * ZERO geometry math (FR-005 + Code Review Guardian finding #3).
 *
 * All spatial fields are expressed in the world frame documented in
 * the "LAYOUT COORDINATE FRAME" section above (right-handed;
 * +x=width, +y=up, +z=length; origin at ground-level center of
 * footprint; Euler XYZ order).
 *
 *   - `id`       is stable across a re-layout of the same design so
 *                warnings + React reconciliation stay keyed correctly.
 *   - `position` is the geometric CENTER of the member (matches
 *                three.js `Object3D.position` semantics), in the
 *                world frame above.
 *   - `size`     is the FULL EXTENT along each world axis (three.js
 *                `BoxGeometry` uses full-extent widths, so no ×2
 *                needed in the scene). `size.x` is thus the extent
 *                along DECK WIDTH, `size.y` along HEIGHT, `size.z`
 *                along DECK LENGTH.
 *   - `rotation` is Euler radians in `'XYZ'` order — usually all
 *                zero for MVP axis-aligned framing.
 */
export interface LayoutMember {
  readonly id: string;
  readonly kind: MemberKind;
  readonly material: MemberMaterialRef;
  readonly position: { readonly x: Mm; readonly y: Mm; readonly z: Mm };
  readonly size: { readonly x: Mm; readonly y: Mm; readonly z: Mm };
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Complete render contract for one deck. Immutable — regenerated
 * every time the source `DeckDesign` changes. `designId` matches
 * `DeckDesign.id` so consumers can correlate warnings, tooltips,
 * and layer visibility state to the source design.
 *
 * `bounds` is the axis-aligned bounding box of every member in the
 * world frame documented above. `bounds.widthMm` / `.lengthMm` /
 * `.heightMm` therefore align with the +x / +z / +y world axes
 * respectively (see "LAYOUT COORDINATE FRAME").
 */
export interface Layout {
  readonly designId: string;
  readonly computedAt: string; // ISO-8601
  readonly bounds: Dimensions3D;
  readonly members: readonly LayoutMember[];
}

// ==========================================================
// Warning — produced by S5 span-check
// ==========================================================

/**
 * A structured span-check finding. The scene overlays warnings on top
 * of the offending member (keyed by `memberId`), and the Warnings
 * panel (S13) lists them with the regulatory `tableReference` for
 * traceability. `actualMm` > `allowableMm` by construction — a
 * finding is only emitted when a limit is exceeded.
 *
 * The `kind` union is deliberately SMALL (joist / beam span only)
 * — MVP does not model post buckling or footing bearing. Adding a
 * new `kind` is a spec change and must be paired with an update to
 * S5 + S10 (warning overlay + panel).
 */
export interface Warning {
  readonly memberId: string;
  readonly kind: 'over-span-joist' | 'over-span-beam';
  readonly actualMm: Mm;
  readonly allowableMm: Mm;
  readonly tableReference: string; // e.g. "IRC-2018 Table R502.3.1(1) — SPF No2 2x6 @ 406 mm o.c."
  readonly message: string; // human-readable
}
