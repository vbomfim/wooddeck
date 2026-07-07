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
 *     and the `validateJoistSpacing` guard in `layout-shared.ts`
 *     rejects any design whose achievable `actualSpacing` would fall
 *     below `joistThicknessMm` (issue #25: pre-#25 the guard only
 *     checked the REQUESTED `spacingMm`, but with `spacingMm == thickness`
 *     and a narrow deck, `actualSpacing = usable/ceil(usable/spacingMm)`
 *     could come out just below `thickness` → ~1 mm overlap).
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

import { FOOTING_WIDTH_MM, computeYStack } from './y-stack';

/**
 * S27 review-response HIGH #1 — joist length dispatch.
 *
 * Under DROP framing the joist runs the FULL deck length and may
 * cantilever past the beams (a normal detail). Under FLUSH framing
 * the joist is HUNG OFF THE BEAM FACE via a joist hanger, so it
 * physically CANNOT extend past the beam — it ENDS at the beam
 * inner face. Both elevated `layoutBeams` and floating
 * `computeFloatingBeams` inset each beam center by
 * `FOOTING_WIDTH_MM / 2` from the corresponding z-end (so the
 * supporting footings/blocks stay inside the footprint), so the
 * clear span between beam INNER faces is:
 *
 *   nearBeamInnerZ = -lengthMm/2 + FOOTING_WIDTH_MM/2 + beamThickness/2
 *   farBeamInnerZ  = +lengthMm/2 - FOOTING_WIDTH_MM/2 - beamThickness/2
 *   clearSpanMm    = farBeamInnerZ - nearBeamInnerZ
 *                  = lengthMm - FOOTING_WIDTH_MM - beamThickness
 *
 * Extracted here so the elevated joist layer AND the floating
 * Method-A joist layer (`floating-joist-layout.ts`) share ONE
 * derivation — the invariant "flush joist = clear span between
 * beam inner faces" cannot drift between the two pipelines.
 *
 * The joist is CENTERED on the length axis (`position.z = 0`)
 * either way, so the caller does not need to know about which end
 * it is inspecting — the two end faces are symmetric about z=0.
 *
 * @throws {Error} from `lookupMaterial` when the beam material
 *   triple is not in the catalog. Only invoked for `'flush'`, so
 *   drop callers never trigger the lookup (unchanged perf).
 */
export function computeJoistLengthMm(design: DeckDesign): Mm {
  // Method B floating (`joists-on-blocks`) has NO beam layer —
  // `beamConnection` is IGNORED and the joist runs the full deck
  // length. This guard MUST come before the switch, because a
  // pathological Method-B design carrying `beamConnection: 'flush'`
  // would otherwise attempt to compute a "clear span" against
  // phantom beams. The visibility gate in `ParameterPanel` hides
  // the flush option for Method B, but a persisted `.deck` file
  // (or a future API) could still smuggle it in.
  const hasBeams =
    design.structure === 'elevated' ||
    (design.structure === 'floating' && design.floatingFraming === 'beams-and-joists');
  if (!hasBeams) return design.footprint.lengthMm;

  switch (design.beamConnection) {
    case 'drop':
      return design.footprint.lengthMm;
    case 'flush': {
      const beamMat = lookupMaterial(
        design.beam.material.nominal,
        design.beam.material.species,
        design.beam.material.grade,
      );
      const beamThicknessMm = beamMat.actual.widthMm;
      return design.footprint.lengthMm - FOOTING_WIDTH_MM - beamThicknessMm;
    }
    default:
      // Fall back to full length for any unknown value — the union
      // narrowing above should make this unreachable, but staying
      // defensive avoids a runtime `undefined` propagating into
      // `size.z`. `validateDesign` fails loud on the invariant
      // before this ever runs for a legitimate flush design.
      return design.footprint.lengthMm;
  }
}

/**
 * Compute joist positions for a design. Every returned joist:
 *   - has `kind: 'joist'`,
 *   - is centered on z=0,
 *   - has `size.z` = `computeJoistLengthMm(design)` — DROP uses the
 *     full deck length (may cantilever past the beams); FLUSH uses
 *     the clear span between the two beam inner faces (joists END
 *     at the beam face because they are hung from it via a joist
 *     hanger — a joist that passes THROUGH the beam is physically
 *     impossible). See `computeJoistLengthMm` above for the
 *     derivation.
 *   - sits at the y-position from `computeYStack(design).joistCenterY`
 *     (see y-stack.ts — this file only owns X placement + length).
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
  // S27 review-response HIGH #1 — dispatch length on beamConnection.
  // Drop keeps `footprint.lengthMm` byte-identical to pre-S27.
  const lengthMm = computeJoistLengthMm(design);

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
 *
 * ## Public surface (S26 — fix/floating-framing-joists)
 *
 * Exported so the floating-layout pipeline (which now honors
 * `design.joist.spacingMm` for both framing methods) can reuse the
 * IDENTICAL anchor formula — that way a floating joist grid has
 * byte-identical x-centers to the elevated joist grid for a given
 * width + spacing + thickness. Any drift between the two would be a
 * regression the "spacing not working" ticket was created to fix.
 */
export function computeJoistXCenters(
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
