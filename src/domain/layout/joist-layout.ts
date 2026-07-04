/**
 * `src/domain/layout/joist-layout.ts` — position every joist in the
 * MVP freestanding-rectangular deck.
 *
 * ## Coordinate frame
 *
 * Uses the world frame documented in `src/domain/model.ts`
 * "LAYOUT COORDINATE FRAME":
 *
 *   +x = deck WIDTH   (joists are spaced across this axis)
 *   +y = UP           (gravity opposes +y)
 *   +z = deck LENGTH  (joists run PARALLEL to this axis)
 *
 * Origin is the ground-level center of the footprint. Joists therefore
 * live in `x ∈ [-widthMm/2, +widthMm/2]`, `z ∈ [-lengthMm/2, +lengthMm/2]`,
 * and their vertical position is set by `computeYStack` (see y-stack.ts).
 *
 * ## The joist-count formula
 *
 *   joistCount = ceil((widthMm - joistThicknessMm) / spacingMm) + 1
 *
 * Rationale — the "even-spaced" placement strategy:
 *
 *   - Place joist #0 with its −x face flush on the LEFT edge of the
 *     footprint (`x_center = -widthMm/2 + thickness/2`).
 *   - Place joist #(N−1) — the LAST joist — with its +x face flush on
 *     the RIGHT edge of the footprint (`x_center = +widthMm/2 - thickness/2`).
 *   - Place joists #1..#N−2 EVENLY spaced between the two anchors, so
 *     every bay has the same on-center pitch
 *     `actualSpacing = (widthMm - thickness) / (N - 1)`.
 *   - `N` is chosen minimally such that `actualSpacing ≤ spacingMm` —
 *     which gives `N = ceil((widthMm - thickness) / spacingMm) + 1`.
 *
 * With this construction:
 *
 *   - Every bay is exactly `actualSpacing`; there is NO ragged
 *     "remainder bay" at the end.
 *   - `actualSpacing ≤ spacingMm` by construction (usually strictly
 *     less; equal iff `widthMm − thickness` is an exact multiple of
 *     `spacingMm`).
 *   - No two joists overlap for any legal input — the algorithm
 *     mathematically cannot place joists closer than `actualSpacing`,
 *     and `actualSpacing ≥ thicknessMm` for every realistic
 *     `widthMm/spacingMm` combination (the MIN_DECK_DIMENSION_MM
 *     guard in `layout-engine.ts` ensures this).
 *
 * ## Ticket-formula reconciliation
 *
 * Issue #5 §AC1 states the formula as `ceil(widthMm / spacingMm) + 1`
 * but also states the numeric expected answer as `10` for widthMm=3660,
 * spacingMm=406. Arithmetically `ceil(9.014) + 1 = 11`, not 10. Since the
 * ticket's numeric answer is the true acceptance criterion, this
 * implementation adopts the physically-consistent formula
 * `ceil((widthMm - thicknessMm) / spacingMm) + 1` (which yields 10 for
 * the reference case) and documents the discrepancy here for the PR
 * reviewer. The full autonomous-decision write-up lives in the PR body
 * under "Autonomous decisions".
 *
 * ## `bayRemainderStrategy`
 *
 * The `DeckDesign.layout.bayRemainderStrategy` field is accepted by
 * the schema (both `"extra-bay-at-end"` and `"centered"`) but the MVP
 * ALWAYS uses the even-spaced (centered) placement described above,
 * because "extra-bay-at-end" is degenerate for widths whose remainder
 * against `spacingMm` is smaller than a joist thickness (it would
 * collide the flush-right joist with the last on-spacing joist). The
 * schema field is preserved so the `.deck` v1 envelope reserves it —
 * see model.ts — and a `TODO(post-MVP)` will re-visit whether
 * "extra-bay-at-end" is worth implementing under a size-guarded
 * fallback.
 */

import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign, LayoutMember } from '../model';
import type { Mm } from '../units';

import { computeYStack } from './y-stack';

/**
 * Compute joist positions for a design. Every returned joist:
 *   - has `kind: 'joist'`,
 *   - runs the full length of the deck (`size.z = footprint.lengthMm`),
 *   - is centered on z=0,
 *   - sits at the y-position from `computeYStack(design).joistCenterY`
 *     (see y-stack.ts — this file only owns X placement).
 *
 * @throws {Error} from `lookupMaterial` when the joist material triple
 *   is not in the catalog. The layout engine wraps this as `LayoutError`.
 */
export function layoutJoists(design: DeckDesign): LayoutMember[] {
  const joistMat = lookupMaterial(
    design.joist.material.nominal,
    design.joist.material.species,
    design.joist.material.grade,
  );
  const thicknessMm = joistMat.actual.widthMm;
  const depthMm = joistMat.actual.heightMm;
  const widthMm = design.footprint.widthMm;
  const spacingMm = design.joist.spacingMm;
  const lengthMm = design.footprint.lengthMm;

  const xCenters = computeJoistXCenters(widthMm, spacingMm, thicknessMm);
  // Delegate y-placement to the shared y-stack — the single source of
  // truth for vertical stacking (see y-stack.ts). Keeping the lookup
  // there guarantees joist / beam / decking y-coordinates can NEVER
  // drift apart in this module.
  const yCenter = computeYStack(design).joistCenterY;

  return xCenters.map<LayoutMember>((x, i) => ({
    id: `joist-${i}`,
    kind: 'joist',
    // S17: LayoutMember.material is the widened MemberMaterialRef;
    // stamp the lumber variant.
    material: { kind: 'lumber', ...design.joist.material },
    position: { x, y: yCenter, z: 0 },
    size: { x: thicknessMm, y: depthMm, z: lengthMm },
    rotation: { x: 0, y: 0, z: 0 },
  }));
}

/**
 * Pure geometry helper — the even-spaced anchor pattern.
 *
 * Algorithm:
 *   - Anchor centers at `flushLeftCenter = -widthMm/2 + thicknessMm/2` and
 *     `flushRightCenter = +widthMm/2 - thicknessMm/2`.
 *   - The usable span between anchors is `widthMm - thicknessMm`.
 *   - `bayCount = ceil(usableSpan / spacingMm)` — smallest number of
 *     bays that fits the usable span with no bay exceeding `spacingMm`.
 *   - `actualSpacing = usableSpan / bayCount` (≤ spacingMm by construction).
 *   - Place `bayCount + 1` joists at `flushLeftCenter + i * actualSpacing`
 *     for `i ∈ [0, bayCount]`. `i = 0` is flush-left, `i = bayCount` is
 *     flush-right; internal joists fall on a uniform grid.
 *
 * This avoids the "extra-bay-at-end" degeneracy where widths with a
 * tiny remainder (e.g. `widthMm = k*spacingMm + 1mm`) would collide
 * the flush-right joist with the last on-spacing joist — a real bug we
 * hit during property testing (fast-check counterexample W=8167,
 * S=508 produced two joists 1mm apart on-center).
 *
 * Complexity: O(joistCount). No hidden allocations beyond the result.
 */
function computeJoistXCenters(
  widthMm: Mm,
  spacingMm: Mm,
  thicknessMm: Mm,
): number[] {
  const flushLeftCenter = -widthMm / 2 + thicknessMm / 2;
  const usableSpan = widthMm - thicknessMm;
  const bayCount = Math.ceil(usableSpan / spacingMm);
  const actualSpacing = usableSpan / bayCount;
  const centers: number[] = [];
  for (let i = 0; i <= bayCount; i++) {
    centers.push(flushLeftCenter + i * actualSpacing);
  }
  return centers;
}
