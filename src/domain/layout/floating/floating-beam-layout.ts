/**
 * `src/domain/layout/floating/floating-beam-layout.ts` — position the
 * rim beams of a floating deck for Method A (`'beams-and-joists'`).
 *
 * ## Contract (S26 rework — fix/floating-framing-joists)
 *
 * `computeFloatingRimBeams(design)` returns EXACTLY 2 beam members
 * — one at each z-end of the deck — mirroring the elevated
 * `layoutBeams` convention (`../beam-layout.ts`) but anchored to the
 * FLOATING y-stack (beam bottom flush with block top at y=0) instead
 * of the elevated y-stack (beam bottom flush with post top).
 *
 * The pre-S26 floating beam layout emitted ONE beam per BLOCK COLUMN
 * running along +z (deck length). That model produced NO beam at
 * the two z-ends and had NO joists on top — decking rested directly
 * on beams at whatever gap the block grid gave. The S26 rework
 * replaces that with the standard "rim-beams + joists on top"
 * framing every DIY floating-deck tutorial describes.
 *
 * Every emitted beam:
 *
 *   - `kind = 'beam'`
 *   - `material = { kind: 'lumber', ...design.beam.material }`
 *   - `size.x = footprint.widthMm` (beam runs the full deck WIDTH,
 *     perpendicular to joists)
 *   - `size.y = beam actual heightMm` (on-edge)
 *   - `size.z = beam actual widthMm` (small dressed dim on +z —
 *     matches `../beam-layout.ts` convention)
 *   - `position.x = 0` (centered on the width axis)
 *   - `position.y = beamCenterY` from `computeYStackFloating`
 *   - `position.z = ±(lengthMm/2 - inset)` — beams inset from
 *     each z-end by `FOOTING_WIDTH_MM/2` so the supporting blocks
 *     (which are the same catalog size as the elevated FOOTING) fit
 *     entirely inside the footprint on z. Same inset formula as
 *     the elevated `layoutBeams`, byte-identical for the shared
 *     product width.
 *   - `rotation = { x:0, y:0, z:0 }`
 *
 * ## Stable ids — MATCH the elevated convention
 *
 * `BEAM_IDS.near = 'beam-near'` for the −z beam, `BEAM_IDS.far =
 * 'beam-far'` for the +z beam. Reusing the elevated labels keeps
 * downstream consumers (BOM, plan view, warning panel) agnostic of
 * the framing method — a "rim beam" is a "rim beam" whether the
 * deck is elevated or floating.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules.
 */

import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign, LayoutMember } from '../../model';

import { BEAM_IDS } from '../beam-layout';
import { FOOTING_WIDTH_MM } from '../y-stack';

import { computeYStackFloating } from './y-stack-floating';

// Re-export the elevated `BEAM_IDS` so callers importing the
// floating beam layout have symmetric access to the id constants
// without pulling from two modules.
export { BEAM_IDS } from '../beam-layout';

/**
 * Build the two rim beams of a Method-A floating deck. Pure —
 * same input yields byte-equal output.
 *
 * ## Caller expectations
 *
 *   - `design.structure === 'floating'`
 *   - `design.foundation.type ∈ {'deck-blocks', 'tuffblocks'}`
 *   - `design.floatingFraming === 'beams-and-joists'` — Method B
 *     designs have NO beam layer and should NOT call this function.
 *     The orchestrator dispatches on `floatingFraming` before
 *     invoking; a direct-caller violation is programmer error and
 *     we fail loud below.
 *
 * @throws {Error} when the beam material triple is not in the
 *   catalog OR when the caller passes a Method-B design. Wrapped
 *   as `LayoutError` by the layout engine.
 */
export function computeFloatingRimBeams(design: DeckDesign): readonly LayoutMember[] {
  if (design.floatingFraming !== 'beams-and-joists') {
    throw new Error(
      `computeFloatingRimBeams: this helper is only valid for ` +
        `design.floatingFraming === 'beams-and-joists' (Method A). ` +
        `Method B ('joists-on-blocks') has NO beam layer. See ` +
        `src/domain/layout/floating/floating-layout.ts for the ` +
        `dispatch table.`,
    );
  }
  const beamMat = lookupMaterial(
    design.beam.material.nominal,
    design.beam.material.species,
    design.beam.material.grade,
  );
  const thicknessMm = beamMat.actual.widthMm; // small dressed dim → +z
  const depthMm = beamMat.actual.heightMm; // large dressed dim → +y
  const widthMm = design.footprint.widthMm;
  const halfLengthMm = design.footprint.lengthMm / 2;

  const yCenter = computeYStackFloating(design).beamCenterY;
  // Inset the beam by FOOTING_WIDTH_MM/2 from each z-end so the
  // block that supports the rim beam fits inside the footprint on
  // z. Mirror of the elevated `layoutBeams` inset formula — see
  // `../beam-layout.ts` module header for the rationale.
  const inset = FOOTING_WIDTH_MM / 2;
  const nearZ = -halfLengthMm + inset;
  const farZ = +halfLengthMm - inset;

  return [
    {
      id: BEAM_IDS.near,
      kind: 'beam',
      material: { kind: 'lumber', ...design.beam.material },
      position: { x: 0, y: yCenter, z: nearZ },
      size: { x: widthMm, y: depthMm, z: thicknessMm },
      rotation: { x: 0, y: 0, z: 0 },
    },
    {
      id: BEAM_IDS.far,
      kind: 'beam',
      material: { kind: 'lumber', ...design.beam.material },
      position: { x: 0, y: yCenter, z: farZ },
      size: { x: widthMm, y: depthMm, z: thicknessMm },
      rotation: { x: 0, y: 0, z: 0 },
    },
  ];
}
