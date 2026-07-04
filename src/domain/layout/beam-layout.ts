/**
 * `src/domain/layout/beam-layout.ts` — position the two beams that
 * carry the joists.
 *
 * ## Convention: drop-beam, one board per beam, flush with the deck ends
 *
 *   - The MVP produces EXACTLY 2 beams — one at each z-end of the deck
 *     (`beam-near` at −z, `beam-far` at +z). This matches the ticket
 *     §4 "two beams (one at each end)" simplification. Intermediate
 *     beams are v2+ (out of scope).
 *
 *   - "Drop-beam" convention: joists sit ON TOP of the beams (not
 *     hung off their sides via hangers). Consequently the beam's TOP
 *     y-face coincides with the joist's BOTTOM y-face — computed in
 *     `computeYStack` (see y-stack.ts).
 *
 *   - Beams run PERPENDICULAR to joists. Since joists run along +z,
 *     beams run along +x, and one beam spans the full deck WIDTH.
 *     A single dressed-lumber board per beam is the MVP simplification;
 *     real construction commonly doubles or triples 2×10 / 2×12 stock
 *     but that's a v2+ enrichment.
 *
 *   - "Inset from the deck ends" — each beam's CENTER is offset from
 *     the corresponding footprint z-edge by `FOOTING_WIDTH_MM / 2` so
 *     that the beam's associated posts and footings (which sit at the
 *     same z as the beam) fit entirely inside the footprint on z. The
 *     joists cantilever past the beams by
 *     `(FOOTING_WIDTH_MM/2 - beamThickness/2)` at each end (typically
 *     ~131 mm for a 2×10 beam + 300 mm footing) — a normal residential
 *     detail. Rationale for tying the inset to `FOOTING_WIDTH_MM/2`:
 *     AC2 requires EVERY member (footings included) to fit inside
 *     `bounds`, and the footing is the widest member on z among the
 *     beam-carried stack.
 *
 * ## Why the beam material is used with `actual.widthMm` = z-thickness
 * ## and `actual.heightMm` = y-depth
 *
 * Beams are laid ON EDGE — the LARGER dressed dimension (`heightMm` in
 * `Material.actual`, e.g. 235 mm for a 2×10) is vertical (resists
 * bending), and the SMALLER dimension (`widthMm`, e.g. 38 mm for a
 * 2×10) is the thickness along +z. This is the same convention used
 * for joists (see joist-layout.ts) — flipping it would silently break
 * the drop-beam y-stack math.
 */

import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign, LayoutMember } from '../model';

import { FOOTING_WIDTH_MM, computeYStack } from './y-stack';

/**
 * Stable ids for the two beams. Exported so `post-layout.ts` (and any
 * future scene/BOM code) can look up posts under a beam by label
 * without regex-parsing `beam.id`. Adding a third beam in v2+ would
 * mean adding a new label here and updating the two consumers.
 */
export const BEAM_IDS = {
  near: 'beam-near',
  far: 'beam-far',
} as const;

/**
 * Label ("near" | "far") a beam by its id — the inverse of BEAM_IDS.
 * Returns `null` for unknown ids so the caller can fail loudly rather
 * than fabricating a nonsense post id.
 */
export type BeamLabel = 'near' | 'far';

export function beamLabelForId(beamId: string): BeamLabel | null {
  if (beamId === BEAM_IDS.near) return 'near';
  if (beamId === BEAM_IDS.far) return 'far';
  return null;
}

export function layoutBeams(design: DeckDesign): LayoutMember[] {
  const beamMat = lookupMaterial(
    design.beam.material.nominal,
    design.beam.material.species,
    design.beam.material.grade,
  );
  const thicknessMm = beamMat.actual.widthMm;
  const depthMm = beamMat.actual.heightMm;
  const widthMm = design.footprint.widthMm;
  const halfLengthMm = design.footprint.lengthMm / 2;

  const y = computeYStack(design).beamCenterY;
  // Inset the beam by FOOTING_WIDTH_MM/2 from each z-end so the associated
  // footings (which live at the same z as the beam) fit inside the footprint
  // on z (AC2). Joists cantilever past the beams by the residual —
  // (FOOTING_WIDTH_MM/2 − beamThickness/2). See module header for rationale.
  const inset = FOOTING_WIDTH_MM / 2;
  const nearZ = -halfLengthMm + inset;
  const farZ = +halfLengthMm - inset;

  return [
    {
      id: BEAM_IDS.near,
      kind: 'beam',
      // S17: stamp the lumber variant of the widened MemberMaterialRef.
      material: { kind: 'lumber', ...design.beam.material },
      position: { x: 0, y, z: nearZ },
      size: { x: widthMm, y: depthMm, z: thicknessMm },
      rotation: { x: 0, y: 0, z: 0 },
    },
    {
      id: BEAM_IDS.far,
      kind: 'beam',
      material: { kind: 'lumber', ...design.beam.material },
      position: { x: 0, y, z: farZ },
      size: { x: widthMm, y: depthMm, z: thicknessMm },
      rotation: { x: 0, y: 0, z: 0 },
    },
  ];
}
