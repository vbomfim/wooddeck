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

  const numCols = Math.ceil(widthMm / beamSpanMaxMm) + 1;
  const numRows = Math.ceil(lengthMm / joistSpanMaxMm) + 1;

  const xCenters = computeAxisCenters(widthMm, numCols);
  const zCenters = computeAxisCenters(lengthMm, numRows);

  const members: LayoutMember[] = [];
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
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
}
