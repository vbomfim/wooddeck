/**
 * `src/domain/layout/blocking-layout.ts` — the SHARED pure helper
 * that emits solid blocking members between adjacent joists for
 * lateral restraint per IRC R502.7 / R502.7.1.
 *
 * ## Why one helper, called by TWO pipelines
 *
 * Both the elevated pipeline (`layout-engine.ts` → `layoutJoists`)
 * and the floating pipeline (`floating/floating-layout.ts` → both
 * `computeMethodA` and `computeMethodB`, via `layoutFloatingJoists`)
 * produce joists with the SAME x-anchor formula (both call
 * `computeJoistXCenters` — see `joist-layout.ts`). The physical
 * "blocking between joists" concept is identical in both worlds —
 * only the y-anchor differs (elevated: `computeYStack.joistCenterY`;
 * floating: `computeYStackFloating.joistCenterY`).
 *
 * Rather than repeat the emitter body in two places (and risk drift
 * — e.g. one path forgetting to switch off "interior only" or
 * emitting a member at ±L/2), this module exposes ONE pure
 * function that takes primitive inputs and returns
 * `LayoutMember[]`. Each pipeline derives the correct y-anchor
 * from its own y-stack and passes it in. Same math, one seam.
 *
 * ## IRC R502.7 / R502.7.1 — where the row rule comes from
 *
 *   - R502.7 requires **lateral restraint at supports** — the deck
 *     ends are already restrained by the rim joist / ledger (for
 *     elevated) or by the rim beam (for floating Method A). This
 *     helper does NOT emit end-rows because those ends are
 *     already restrained.
 *   - R502.7.1 requires **on-center spacing ≤ 8 ft** for solid
 *     blocking used as lateral restraint. Constant:
 *     `MAX_BLOCKING_SPACING_MM = 2438` mm (8 ft × 304.8 mm/ft ≈
 *     2438.4 mm — rounded down to an integer for exact-arithmetic
 *     ceil-count semantics on the typical 8/10/12/14/16 ft deck
 *     lengths).
 *
 * ## Row placement along +z (deck LENGTH)
 *
 *   - Interior rows only — no row at `±L/2`.
 *   - Row count:
 *     `N = max(1, ceil(lengthMm / MAX_BLOCKING_SPACING_MM) - 1)`.
 *     - Threshold: whenever there are ≥ 2 joists (i.e. ≥ 1 bay),
 *       ALWAYS emit at least 1 mid-span row. The `max(1, ...)`
 *       floor is deliberately conservative / DIY-friendly — a
 *       tiny 4-ft deck otherwise gets `ceil(4ft/8ft)-1 = 0` rows
 *       and would ship with no bracing at all.
 *     - For L ≤ MAX (≤ 8 ft): `ceil(L/MAX) = 1` → `N = max(1, 0)
 *       = 1` (one mid-span row at z=0).
 *     - For L > MAX (> 8 ft): `N = ceil(L/MAX) - 1`, giving
 *       `L/(N+1) ≤ MAX` by construction.
 *     - The threshold: a deck length strictly ≤ `2 × MAX = 4876`
 *       mm gets N=1; longer decks roll over. A 12 ft deck
 *       (3657.6 mm) resolves to N=1; a 16 ft deck (4876.8 mm)
 *       lands 0.8 mm past the threshold and resolves to N=2 —
 *       deliberately conservative because `MAX = 2438` is 0.4 mm
 *       shy of the exact 8 ft = 2438.4 mm. Extra rows waste a
 *       small amount of lumber but NEVER violate R502.7.1.
 *   - Row z-positions: `z_k = -L/2 + k * L / (N + 1)` for
 *     `k = 1..N`. Adjacent-row pitch is exactly `L / (N + 1)`;
 *     the "end gap" (between the rim and the first / last row)
 *     is also `L / (N + 1)` — every gap is uniform.
 *
 * ## Per-member geometry (between joist i and joist i+1 at row z_k)
 *
 *   - `position.x` = `(xCenters[i] + xCenters[i+1]) / 2` (bay midpoint).
 *   - `position.y` = `joistCenterY` (co-planar with joists).
 *   - `position.z` = `z_k` (interior row station).
 *   - `size.x` = `xCenters[i+1] - xCenters[i] - joistThicknessMm`
 *     (the CLEAR gap between the two joist inner faces — the
 *     blocking end face lands EXACTLY on the joist face, no
 *     overlap and no gap).
 *   - `size.y` = `joistDepthMm` (full-depth solid blocking — same
 *     stock as the joist, stood on edge just like the joist).
 *   - `size.z` = `joistThicknessMm` (the blocking is the same
 *     nominal 2× as the joist and is oriented with its thickness
 *     along +z — a real carpenter would cut a joist offcut to
 *     length and toe-nail it in).
 *   - `rotation` = `{x:0, y:0, z:0}` (axis-aligned MVP framing).
 *   - `material` = the caller-provided lumber material (typically
 *     `{ kind: 'lumber', ...design.joist.material }`) — routed
 *     through the shared per-kind color cache to render EMERALD
 *     (`MATERIAL_KIND_COLORS.blocking`) in `BlockingLayer`.
 *
 * ## Edge cases
 *
 *   - `joistXCenters.length < 2` (i.e. 0 or 1 joists) → return an
 *     empty array. No adjacent bay exists, so nothing to place
 *     blocking between. Fail-loud is the CALLER's responsibility;
 *     this helper stays graceful because upstream validation
 *     already rejects <2-joist designs (`validateJoistSpacing`).
 *
 * ## Stable ids
 *
 *   `blocking-r{row}-b{bay}` where `row ∈ [0, N-1]` (0 = first
 *   interior row, most-negative z) and `bay ∈ [0, N_bays-1]`
 *   (0 = leftmost bay between joist 0 and joist 1). Deterministic
 *   for a given input — golden fixtures and warning-overlay
 *   reconciliation rely on this.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain types
 * (`../model`, `../units`) — no react, no three, no state store.
 * Boundary enforced by `.dependency-cruiser.cjs` `domain-*` rules
 * and the `scripts/boundary-selftest.mjs` probes.
 */

import type { LayoutMember, LumberMemberMaterial } from '../model';
import type { Mm } from '../units';

/**
 * Maximum on-center spacing between rows of solid blocking, per
 * IRC R502.7.1: 8 ft = 2438.4 mm, rounded down to 2438 mm for
 * exact-arithmetic ceil-count semantics on typical deck lengths.
 *
 * Exported so the property tests + spec docs can reference the
 * SAME source-of-truth constant (no duplicated magic numbers).
 */
export const MAX_BLOCKING_SPACING_MM = 2438;

/**
 * Pure input contract for {@link layoutBlockingBetweenJoists}.
 *
 * All fields are REQUIRED — the helper does no optional-field
 * defaulting because ambiguity at a domain boundary is a bug.
 * Both callers (elevated + floating) derive every field from
 * their own upstream helpers (see module header).
 */
export interface BlockingLayoutInput {
  /**
   * The x-center coordinates of every joist in the deck, in mm,
   * in +x-ascending order. Typically produced by
   * `computeJoistXCenters(width, spacing, thickness)` from
   * `../joist-layout.ts` — the SHARED helper both the elevated
   * and floating joist layers already use, so blocking cannot
   * drift from joists.
   */
  readonly joistXCenters: readonly number[];

  /**
   * The y-center of the joists in mm — comes from the pipeline's
   * y-stack (`computeYStack.joistCenterY` for elevated;
   * `computeYStackFloating.joistCenterY` for floating). Blocking
   * is co-planar with joists.
   */
  readonly joistCenterY: Mm;

  /**
   * The joist's dressed thickness (smaller cross-section
   * dimension) in mm. Blocking's `size.z` equals this, so
   * blocking has the same nominal 2× profile as the joist.
   */
  readonly joistThicknessMm: Mm;

  /**
   * The joist's dressed depth (larger cross-section dimension) in
   * mm — the "on-edge" dimension. Blocking's `size.y` equals this
   * for FULL-DEPTH solid blocking per IRC R502.7.1.
   */
  readonly joistDepthMm: Mm;

  /**
   * The deck LENGTH in mm (`design.footprint.lengthMm`). Row
   * z-positions are computed as evenly-spread interior rows in
   * `z ∈ (-lengthMm/2, +lengthMm/2)`. Uses the FOOTPRINT length
   * (not the joist size.z — which is a shorter clear-span under
   * flush framing) so blocking is placed relative to the deck's
   * end-support planes (rim joist / ledger / rim beam), which is
   * what IRC R502.7 constrains.
   */
  readonly lengthMm: Mm;

  /**
   * The lumber material tag stamped onto every emitted blocking
   * member. Typically `{ kind: 'lumber', ...design.joist.material }`
   * — real carpentry uses joist offcuts. The `LumberMemberMaterial`
   * discriminant is required so `derive-bom.ts` folds the
   * blocking length into the same SKU bin as the joist.
   */
  readonly material: LumberMemberMaterial;
}

/**
 * Emit solid blocking members between every pair of adjacent
 * joists, at evenly-spread interior rows along +z. Pure — same
 * input yields byte-equal output.
 *
 * See module header for the row rule (IRC R502.7 / R502.7.1),
 * the per-member geometry, and the edge-case contract.
 *
 * @param input see {@link BlockingLayoutInput}.
 * @returns an array of `LayoutMember` with `kind === 'blocking'`.
 *   Empty when `joistXCenters.length < 2` (no adjacent bay).
 */
export function layoutBlockingBetweenJoists(
  input: BlockingLayoutInput,
): readonly LayoutMember[] {
  const {
    joistXCenters,
    joistCenterY,
    joistThicknessMm,
    joistDepthMm,
    lengthMm,
    material,
  } = input;

  // <2 joists → no adjacent bay to place blocking between. Return
  // early with an empty array (fail-loud is the caller's
  // responsibility — a valid design always has ≥ 2 joists).
  const bays = joistXCenters.length - 1;
  if (bays < 1) return [];

  // Row count — IRC R502.7.1 (≤ 8 ft o.c.) with a DIY-friendly
  // "at least 1 mid-span row" floor. See module header for the
  // derivation.
  const rows = Math.max(1, Math.ceil(lengthMm / MAX_BLOCKING_SPACING_MM) - 1);

  // Evenly-spread interior row z-positions: k=1..rows, so the
  // outermost rows sit `L/(N+1)` from each end (never at ±L/2).
  const rowStep = lengthMm / (rows + 1);
  const halfL = lengthMm / 2;

  const out: LayoutMember[] = [];
  for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
    // z_k = -L/2 + (k) * L/(N+1) for k = 1..N. `rowIdx = 0`
    // corresponds to k=1 (most-negative z).
    const z = -halfL + (rowIdx + 1) * rowStep;
    for (let bay = 0; bay < bays; bay++) {
      const leftCenter = joistXCenters[bay]!;
      const rightCenter = joistXCenters[bay + 1]!;
      const midX = (leftCenter + rightCenter) / 2;
      const clearGap = rightCenter - leftCenter - joistThicknessMm;
      out.push({
        id: `blocking-r${rowIdx}-b${bay}`,
        kind: 'blocking',
        material,
        position: { x: midX, y: joistCenterY, z },
        size: { x: clearGap, y: joistDepthMm, z: joistThicknessMm },
        rotation: { x: 0, y: 0, z: 0 },
      });
    }
  }

  return out;
}
