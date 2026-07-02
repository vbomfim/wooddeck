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
 * Species / material type. `"PT"` = pressure-treated softwood (SPF or
 * Southern Pine, treated with copper azole / similar), `"Cedar"` =
 * naturally rot-resistant Western Red Cedar, `"Composite"` = wood-
 * plastic composite decking (Trex / TimberTech / Fiberon family).
 * Composite is NOT graded — it uses `Grade: "NA"` (see below).
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
 */
export interface Material {
  readonly nominal: LumberNominal;
  readonly species: Species;
  readonly grade: Grade;
  readonly actual: { readonly widthMm: Mm; readonly heightMm: Mm };
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
  readonly footprint: {
    readonly widthMm: Mm;
    readonly lengthMm: Mm;
    readonly heightMm: Mm;
  };
  readonly joist: {
    readonly material: MaterialRef;
    readonly spacingMm: Mm; // e.g. 406 mm ≈ 16" o.c.
  };
  readonly beam: { readonly material: MaterialRef };
  readonly post: { readonly material: MaterialRef };
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

// ==========================================================
// Layout — the render contract (produced by S4, consumed by S10)
// ==========================================================

/**
 * The five drawable primitives. Scene components render each `kind`
 * with its own material and, when applicable, warning overlay. The
 * literal set is exhaustive on purpose — pattern-matches (`switch`
 * with `noFallthroughCasesInSwitch: true` + `never` default) will
 * fail-compile if a new kind is added without updating the scene.
 */
export type MemberKind = 'joist' | 'beam' | 'post' | 'footing' | 'board';

/**
 * A single drawable member with FULL 3D placement in millimeters.
 * The layout engine (S4) computes every field — the scene performs
 * ZERO geometry math (FR-005 + Code Review Guardian finding #3).
 *
 *   - `id`       is stable across a re-layout of the same design so
 *                warnings + React reconciliation stay keyed correctly.
 *   - `position` is the geometric CENTER of the member (matches
 *                three.js `Object3D.position` semantics).
 *   - `size`     is the FULL EXTENT along each axis (three.js
 *                `BoxGeometry` uses full-extent widths, so no ×2
 *                needed in the scene).
 *   - `rotation` is radians. For MVP framing the values are usually
 *                all zero (axis-aligned members), but the field is
 *                present so post-MVP diagonals / stairs / attached
 *                decks do not need a schema change.
 */
export interface LayoutMember {
  readonly id: string;
  readonly kind: MemberKind;
  readonly material: MaterialRef;
  readonly position: { readonly x: Mm; readonly y: Mm; readonly z: Mm };
  readonly size: { readonly x: Mm; readonly y: Mm; readonly z: Mm };
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Complete render contract for one deck. Immutable — regenerated
 * every time the source `DeckDesign` changes. `designId` matches
 * `DeckDesign.id` so consumers can correlate warnings, tooltips,
 * and layer visibility state to the source design.
 */
export interface Layout {
  readonly designId: string;
  readonly computedAt: string; // ISO-8601
  readonly bounds: {
    readonly widthMm: Mm;
    readonly lengthMm: Mm;
    readonly heightMm: Mm;
  };
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
