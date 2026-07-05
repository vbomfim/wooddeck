/**
 * `src/domain/layout/floating/block-grid.ts` — pure computation of
 * the foundation block grid under a floating deck (S19 — AC3, AC4).
 *
 * ## What this module produces
 *
 * A flat `readonly LayoutMember[]` where every member has:
 *
 *   - `kind: 'block'`
 *   - `material: { kind: 'block', productId: <catalog id> }`
 *   - `position.y = -product.actual.heightMm / 2` (block extends
 *     BELOW the ground plane; top face flush with y=0)
 *   - `position.x / .z` on a 2-D grid in the +x / +z plane
 *   - `size.x / .y / .z` mirrors the catalog product's actual dims
 *
 * ## Grid geometry (AC3 + AC4)
 *
 *   - COLUMN count (blocks along +x, one column per beam):
 *
 *         numCols = ceil(widthMm / beamSpanMaxMm) + 1
 *
 *   - ROW count (blocks along +z, supports under each beam):
 *
 *         numRows = ceil(lengthMm / joistSpanMaxMm) + 1
 *
 *   - S25 override: if `foundation.blockRowsHint` /
 *     `foundation.blockColsHint` is set, that value replaces the
 *     derivation, CLAMPED to
 *     `[2, floor(spanMm / MIN_BLOCK_SPACING_MM) + 1]` so the
 *     adjacent-block gap stays ≥ MIN_BLOCK_SPACING_MM.
 *     `undefined` (or omitted) preserves the S19 derivation
 *     byte-identically — every golden fixture is unaffected.
 *
 *   - Outermost block CENTERS anchor at ±widthMm/2 on x and
 *     ±lengthMm/2 on z (AC4 "outer blocks directly under the rim
 *     beams"). Interior columns and rows are EVENLY spaced between
 *     the outer anchors.
 *
 * Total block count = numCols × numRows, row-major stamped with
 * stable ids `block-r{row}-c{col}`. The outermost block CENTERS lie
 * on the footprint edges, so each outer block extends
 * `product.actual.{width,depth}Mm / 2` OUTSIDE the deck on each
 * axis (a ~½-block overhang under the rim). This is by design
 * (matches AC4 "outer blocks are directly under the rim beams" —
 * the block bearing the rim beam has half its footprint outside
 * the deck perimeter). Review-gate FIX 3 propagates this overhang
 * into `Layout.bounds` so the scene camera frames the true extent
 * (see `floating-layout.ts` `computeFloatingBoundsFromMembers`).
 * If a future requirement pins blocks INSIDE the footprint, the
 * anchor formula is the single seam to change.
 *
 * ## Input contract
 *
 * `beamSpanMaxMm` and `joistSpanMaxMm` are supplied by the caller
 * (typically the `floating-layout.ts` orchestrator). This module
 * does NOT consult the span tables directly — that keeps
 * `block-grid.ts` a pure geometry generator (rewritable in
 * isolation from the S5 span-check subsystem).
 *
 * ## Trust boundary
 *
 * The input is not user-controlled BUT this module is called by the
 * layout dispatcher whose input DOES come from `.deck` file parsing
 * — a designed trust boundary. Consequently we validate:
 *
 *   - `widthMm > 0`, `lengthMm > 0`
 *   - `beamSpanMaxMm > 0` (division), `joistSpanMaxMm > 0`
 *   - reject invalid inputs with a typed error at the boundary
 *
 * See Developer Guardian Rules → Pre-compliance → Trust boundaries.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules.
 */

import { lookupFoundationProduct } from '../../foundation-catalog';
import type { FoundationSpec, LayoutMember } from '../../model';
import type { Mm } from '../../units';

/**
 * MINIMUM adjacent-block spacing (mm) permitted along either grid
 * axis. Used by S25 (ticket #47) to CLAMP a user-supplied
 * `foundation.blockRowsHint` / `blockColsHint` so an out-of-range
 * hint (e.g. `100` on a 12-ft deck) cannot spawn a grid dense
 * enough to be physically nonsensical (blocks overlapping,
 * over-detailed geometry, absurd BOM row counts).
 *
 * ## Value rationale (300 mm ≈ 12 in)
 *
 * 12 in is the tightest tabulated joist-spacing value in the IRC
 * R507.6 table and the tightest column in AWC DCA-6-2015. That
 * matches DIY carpentry practice: block-under-beam spacing this
 * tight is already at the density limit before you would
 * transition to a continuous footing rather than discrete blocks.
 * The clamp doesn't STOP the user from densifying to that limit;
 * it prevents `blockRowsHint = 100` from producing a grid whose
 * adjacent-block gap collapses toward 0 mm (which would then have
 * the outer blocks physically overlap on paper).
 *
 * Documented as an autonomous decision per Developer Guardian
 * rules — reversible by editing this constant. Increases (e.g.
 * to 400 mm) would need to be checked against the S19 goldens for
 * derived floating layouts (all currently ≥ 610 mm block-to-block
 * gap by construction, so a 400 mm clamp would not affect them).
 */
export const MIN_BLOCK_SPACING_MM: Mm = 300;

/**
 * Input for `computeBlockGrid`. `foundation` is narrowed to the two
 * floating-legal foundation variants (`deck-blocks` / `tuffblocks`)
 * — a `posts-on-footings` foundation has no `.product` field and is
 * therefore not representable here.
 *
 * The narrowing is expressed via `Extract` so a future addition to
 * `FoundationSpec` (e.g. a new block product variant) is
 * automatically eligible without touching this interface, provided
 * the new variant carries a `.product` field.
 */
export interface BlockGridInput {
  readonly footprintMm: { readonly widthMm: Mm; readonly lengthMm: Mm };
  readonly foundation: Extract<
    FoundationSpec,
    { type: 'deck-blocks' | 'tuffblocks' }
  >;
  /**
   * Max cross-width spacing between adjacent BEAMS (which are one
   * per block column). Derived by the caller from the beam's span
   * table (or a conservative DIY default in the S19 MVP). Must be
   * strictly positive.
   */
  readonly beamSpanMaxMm: Mm;
  /**
   * Max along-length spacing between adjacent BLOCKS under a single
   * beam. Derived by the caller from the beam-span table
   * (block-to-block = beam-to-block-support distance) or from a
   * conservative default. Must be strictly positive.
   */
  readonly joistSpanMaxMm: Mm;
  /**
   * S26 override — explicit column x-centers. When provided, the
   * caller has already computed the exact x-positions the blocks
   * should occupy (e.g. Method B aligns block columns to joist
   * x-centers). Bypasses `beamSpanMaxMm` + `blockColsHint` +
   * `computeAxisCenters` for this axis. When omitted, the axis
   * uses the derived + hinted anchor formula (S19 behavior).
   *
   * Trust boundary: every entry MUST be finite AND lie within
   * `[-widthMm/2, +widthMm/2]`. `validateInput` enforces this and
   * throws with a diagnostic message naming the offending
   * index + value if a caller passes NaN / ±Infinity / out-of-range
   * values. S26 FIX #7 (review-gate: Opus#5) — pre-fix, the JSDoc
   * *claimed* validation without actually performing any.
   */
  readonly explicitColXCenters?: readonly Mm[];
  /**
   * S26 override — explicit row z-centers. Same semantics as
   * `explicitColXCenters` for the length axis. Method A supplies
   * this to place blocks directly under the rim beams (at
   * ±(lengthMm/2 - FOOTING_WIDTH_MM/2)) instead of at
   * ±lengthMm/2.
   *
   * Trust boundary: every entry MUST be finite AND lie within
   * `[-lengthMm/2, +lengthMm/2]`; enforced by `validateInput`.
   */
  readonly explicitRowZCenters?: readonly Mm[];
}

/**
 * Build the block grid. Pure — same input yields byte-equal output.
 *
 * @throws {Error} when any of the numeric inputs is not strictly
 *   positive OR the foundation product id is not in the catalog.
 *   The layout engine wraps these as `LayoutError`.
 */
export function computeBlockGrid(input: BlockGridInput): readonly LayoutMember[] {
  validateInput(input);

  const { footprintMm, foundation, beamSpanMaxMm, joistSpanMaxMm } = input;
  const { widthMm, lengthMm } = footprintMm;

  const product = lookupFoundationProduct(foundation.product.productId);
  const productHeightMm = product.actual.heightMm;
  const productWidthMm = product.actual.widthMm;
  const productDepthMm = product.actual.depthMm;
  const yCenter = -productHeightMm / 2; // block TOP at y=0

  // S26 — honor explicit-center overrides first (used by Method A
  // to place rows under rim beams, and Method B to align columns
  // to joist x-positions). When absent, fall back to the S19
  // resolve-hint-or-derive path so the elevated + pre-S26 paths
  // stay byte-identical.
  const xCenters =
    input.explicitColXCenters !== undefined
      ? [...input.explicitColXCenters]
      : computeAxisCenters(
          widthMm,
          resolveGridCount(foundation.blockColsHint, widthMm, beamSpanMaxMm),
        );
  const zCenters =
    input.explicitRowZCenters !== undefined
      ? [...input.explicitRowZCenters]
      : computeAxisCenters(
          lengthMm,
          resolveGridCount(foundation.blockRowsHint, lengthMm, joistSpanMaxMm),
        );

  const members: LayoutMember[] = [];
  for (let row = 0; row < zCenters.length; row++) {
    for (let col = 0; col < xCenters.length; col++) {
      members.push({
        id: `block-r${row}-c${col}`,
        kind: 'block',
        material: { kind: 'block', productId: product.productId },
        position: {
          x: xCenters[col]!,
          y: yCenter,
          z: zCenters[row]!,
        },
        size: { x: productWidthMm, y: productHeightMm, z: productDepthMm },
        rotation: { x: 0, y: 0, z: 0 },
      });
    }
  }
  return members;
}

/**
 * Resolve the row/column count along ONE axis. If a hint is
 * provided AND finite AND an integer-ish positive number, clamp it
 * to `[2, floor(spanMm / MIN_BLOCK_SPACING_MM) + 1]` (S25 AC4).
 * Otherwise fall back to the S19 derivation
 * `ceil(spanMm / maxSpacingMm) + 1`.
 *
 * ## Public surface (S25 pair-fix)
 *
 * Exported so `domain/spans/remediations.ts::deriveCurrentRows`
 * can mirror the actual layout clamp when computing the base row
 * count for the `add-support-row` remediation — without this, a
 * `blockRowsHint: 0` (or any out-of-range value) would compute
 * `currentRows = 0` but the real layout produces 2 rows, and the
 * remediation would mislabel/no-op the fix. Direct-file import
 * from `spans → block-grid` is cycle-safe: this module imports
 * ZERO span modules.
 *
 * ## Clamp bounds
 *
 *   - Lower bound 2: a grid with a single row/column collapses the
 *     block layout into a single line of supports along one axis
 *     (nonsensical for a rectangular deck). AC4 in the ticket
 *     locks the perimeter-two minimum.
 *   - Upper bound `floor(spanMm / MIN_BLOCK_SPACING_MM) + 1`:
 *     adjacent-block center-to-center gap = `spanMm / (count − 1)`.
 *     For this to stay ≥ `MIN_BLOCK_SPACING_MM`, we need
 *     `count − 1 ≤ floor(spanMm / MIN_BLOCK_SPACING_MM)`, i.e.
 *     `count ≤ floor(spanMm / MIN_BLOCK_SPACING_MM) + 1`. Off-by-
 *     one careful: floor (not ceil) keeps the last honored count
 *     just at-or-above the min-gap threshold.
 *
 * ## Non-integer / NaN / negative hints
 *
 * Silently clamped to the safe range (min = 2). Non-integer values
 * are rounded down (via `Math.floor`) before clamping — the block
 * grid is a count, not a continuous quantity. `NaN` / non-finite
 * values are treated as "no hint" and fall through to the derivation.
 *
 * ## Range-safe clamp (S25 pair-fix / Opus LOW#7)
 *
 * The clamp uses `Math.max(2, Math.min(asInt, maxCount))` so a
 * pathologically tiny `spanMm` (below `MIN_BLOCK_SPACING_MM`) that
 * yields `maxCount = 1 < 2` still returns 2 — the perimeter-two
 * lower bound wins over the upper bound. `validateInput` already
 * rejects `spanMm ≤ 0`, so this is defence-in-depth for the
 * edge of the legal range.
 */
export function resolveGridCount(
  hint: number | undefined,
  spanMm: Mm,
  maxSpacingMm: Mm,
): number {
  if (hint === undefined || !Number.isFinite(hint)) {
    return Math.ceil(spanMm / maxSpacingMm) + 1;
  }
  const maxCount = Math.floor(spanMm / MIN_BLOCK_SPACING_MM) + 1;
  const asInt = Math.floor(hint);
  return Math.max(2, Math.min(asInt, maxCount));
}

/**
 * Compute N evenly-spaced centers along a linear axis such that the
 * OUTER centers lie at ±spanMm/2 (flush with the footprint edges).
 * For N=1 (a degenerate 1-column/row grid — should never happen for
 * a footprint above `MIN_DECK_DIMENSION_MM`) the single center is
 * at the origin. For N=2 the two centers are at ±spanMm/2 with no
 * interior points.
 *
 * ## Invariant
 *
 * `centers.length === N`; `centers[0] === -spanMm/2` (for N≥2);
 * `centers[N-1] === +spanMm/2` (for N≥2); adjacent-gap = spanMm /
 * (N-1) — constant.
 */
function computeAxisCenters(spanMm: Mm, count: number): number[] {
  if (count < 1) {
    // Should be unreachable — `computeBlockGrid` guards against
    // `spanMm ≤ 0`, and `ceil(positive/positive) + 1 ≥ 2`. Kept as
    // a belt-and-suspenders assertion.
    throw new Error(
      `computeAxisCenters: count must be ≥ 1 (got ${count})`,
    );
  }
  if (count === 1) {
    return [0];
  }
  const step = spanMm / (count - 1);
  const centers: number[] = [];
  for (let i = 0; i < count; i++) {
    centers.push(-spanMm / 2 + i * step);
  }
  return centers;
}

/**
 * Trust-boundary defensive check. Rejects any numeric input that
 * would produce a nonsensical grid (division-by-zero, NaN, negative
 * dims). See module header "Trust boundary" section.
 *
 * Uses `Number.isFinite` + strict comparison so `NaN`, `Infinity`,
 * and `-0` (as `.footprintMm.widthMm`) are all rejected.
 */
function validateInput(input: BlockGridInput): void {
  const { widthMm, lengthMm } = input.footprintMm;
  if (!Number.isFinite(widthMm) || widthMm <= 0) {
    throw new Error(
      `computeBlockGrid: invalid footprintMm.widthMm=${widthMm} (must be a positive finite number). ` +
        `The layout-engine's MIN_DECK_DIMENSION_MM guard should have rejected this design first.`,
    );
  }
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) {
    throw new Error(
      `computeBlockGrid: invalid footprintMm.lengthMm=${lengthMm} (must be a positive finite number). ` +
        `The layout-engine's MIN_DECK_DIMENSION_MM guard should have rejected this design first.`,
    );
  }
  if (!Number.isFinite(input.beamSpanMaxMm) || input.beamSpanMaxMm <= 0) {
    throw new Error(
      `computeBlockGrid: invalid beamSpanMaxMm=${input.beamSpanMaxMm} ` +
        `(must be a positive finite number; controls the # of block columns / beams).`,
    );
  }
  if (!Number.isFinite(input.joistSpanMaxMm) || input.joistSpanMaxMm <= 0) {
    throw new Error(
      `computeBlockGrid: invalid joistSpanMaxMm=${input.joistSpanMaxMm} ` +
        `(must be a positive finite number; controls the # of block rows under each beam).`,
    );
  }

  // S26 FIX #7 (review-gate: Opus#5) — validate the S26
  // "explicit-centers" overrides that the JSDoc claims are
  // "validated defensively below". Each entry must be finite AND
  // lie within the footprint half-extent so nonsense positions
  // (NaN, ±Infinity, or coordinates off the deck) cannot silently
  // emit blocks at bogus x/z. A caller with a legitimate override
  // (Method A rim-beam z-centers, Method B joist x-centers) is
  // always well inside these bounds.
  const halfWidth = widthMm / 2;
  const halfLength = lengthMm / 2;
  validateExplicitCenters(
    input.explicitColXCenters,
    halfWidth,
    'explicitColXCenters',
    'footprintMm.widthMm',
  );
  validateExplicitCenters(
    input.explicitRowZCenters,
    halfLength,
    'explicitRowZCenters',
    'footprintMm.lengthMm',
  );
}

/**
 * Shared helper for `explicitColXCenters` / `explicitRowZCenters`
 * defensive checks. Each entry must be finite (rejects NaN,
 * ±Infinity) and lie within the corresponding footprint
 * half-extent (`±halfExtentMm`). Throws with a message that
 * names the offending field + value so a callsite bug is
 * traceable.
 *
 * S26 FIX #7 (review-gate: Opus#5).
 */
function validateExplicitCenters(
  centers: readonly Mm[] | undefined,
  halfExtentMm: Mm,
  fieldName: 'explicitColXCenters' | 'explicitRowZCenters',
  extentFieldName: 'footprintMm.widthMm' | 'footprintMm.lengthMm',
): void {
  if (centers === undefined) return;
  for (let i = 0; i < centers.length; i += 1) {
    const value = centers[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `computeBlockGrid: invalid ${fieldName}[${i}]=${String(value)} ` +
          `(must be a finite number).`,
      );
    }
    if (value < -halfExtentMm || value > halfExtentMm) {
      throw new Error(
        `computeBlockGrid: ${fieldName}[${i}]=${value} out of range ` +
          `[${-halfExtentMm}, ${halfExtentMm}] (half of ${extentFieldName}).`,
      );
    }
  }
}
