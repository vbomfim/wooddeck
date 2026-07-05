/**
 * `src/domain/layout/floating/floating-joist-layout.ts` — the joist
 * layer for a floating deck (S26 — fix/floating-framing-joists).
 *
 * ## Why a floating-specific joist helper
 *
 * The elevated `layoutJoists(design)` in `../joist-layout.ts` computes
 * every joist's y from `computeYStack(design).joistCenterY`, which is
 * anchored to `footprint.heightMm` (top-down stack — see `../y-stack.ts`).
 * A floating deck stacks BOTTOM-UP from y=0 (see `./y-stack-floating.ts`)
 * so the y-anchor is different — but the x-center placement (spacing,
 * anchoring, count formula) is IDENTICAL to elevated. This module
 * reuses the shared `computeJoistXCenters` helper to guarantee no
 * spacing drift between the elevated and floating pipelines.
 *
 * ## Regression this fixes
 *
 * The pre-S26 floating pipeline emitted ZERO joists (the joist layer
 * was skipped entirely; decking rested directly on beams). Changing
 * `design.joist.spacingMm` had NO effect on the floating layout —
 * the "spacing not working" bug the fix/floating-framing-joists
 * ticket exists to fix. This module IS the fix.
 *
 * ## Contract
 *
 * `layoutFloatingJoists(design)` returns joist members whose:
 *   - `kind = 'joist'`
 *   - `material = { kind: 'lumber', ...design.joist.material }`
 *   - `position.x` = center from `computeJoistXCenters(width, spacing, thickness)`
 *     — byte-identical formula to the elevated joist layer
 *   - `position.y` = `computeYStackFloating(design).joistCenterY`
 *     — Method A: beam-top + joistDepth/2; Method B: blockTop + joistDepth/2
 *   - `position.z` = 0 (joist centered on the length axis)
 *   - `size.x` = joist thickness (2×N dressed widthMm — small edge)
 *   - `size.y` = joist depth  (2×N dressed heightMm — large edge, on-edge)
 *   - `size.z` = `design.footprint.lengthMm` (joist runs the full length)
 *   - `rotation = { x:0, y:0, z:0 }`
 *
 * ## Stable ids
 *
 * `joist-{i}` for i ∈ [0, N-1], where i=0 is the -x-flush joist and
 * i=N-1 is the +x-flush joist. Same convention as the elevated
 * `layoutJoists` so BOM aggregators and 2D plan-view code can treat
 * elevated and floating joist ids uniformly.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules.
 */

import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign, LayoutMember } from '../../model';

import { computeJoistLengthMm, computeJoistXCenters } from '../joist-layout';

import { computeYStackFloating } from './y-stack-floating';

/**
 * Build the floating joist layer. Pure — same input yields
 * byte-equal output. See module header for the field contract.
 *
 * @throws {Error} from `lookupMaterial` when the joist material
 *   triple is not in the catalog (wrapped as `LayoutError` by the
 *   layout engine).
 */
export function layoutFloatingJoists(design: DeckDesign): readonly LayoutMember[] {
  const joistMat = lookupMaterial(
    design.joist.material.nominal,
    design.joist.material.species,
    design.joist.material.grade,
  );
  const thicknessMm = joistMat.actual.widthMm;
  const depthMm = joistMat.actual.heightMm;
  const widthMm = design.footprint.widthMm;
  const spacingMm = design.joist.spacingMm;
  // S27 review-response HIGH #1 — same clear-span dispatch as the
  // elevated joist layer. For Method A + flush, joists END at the
  // rim-beam inner faces; for Method A + drop OR Method B they run
  // the full deck length (Method B has no beams so `beamConnection`
  // is irrelevant — `computeJoistLengthMm` returns full length for
  // any non-flush design, and Method B designs never carry
  // `beamConnection: 'flush'` in a validated pipeline).
  const lengthMm = computeJoistLengthMm(design);

  const xCenters = computeJoistXCenters(widthMm, spacingMm, thicknessMm);
  const yCenter = computeYStackFloating(design).joistCenterY;

  return xCenters.map<LayoutMember>((x, i) => ({
    id: `joist-${i}`,
    kind: 'joist',
    material: { kind: 'lumber', ...design.joist.material },
    position: { x, y: yCenter, z: 0 },
    size: { x: thicknessMm, y: depthMm, z: lengthMm },
    rotation: { x: 0, y: 0, z: 0 },
  }));
}
