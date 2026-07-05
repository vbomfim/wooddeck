/**
 * `src/domain/layout/floating/floating-beam-layout.ts` — position the
 * beams of a floating deck for Method A (`'beams-and-joists'`).
 *
 * ## Contract (S26 rework — fix/floating-framing-joists; **widened for
 * issue #75 — feat/method-a-intermediate-beams**)
 *
 * `computeFloatingBeams(design, options?)` returns N ≥ 2 beam
 * members along the WIDTH axis, spread EVENLY between the two rim
 * insets on +z. When `options.numRows` is not supplied the function
 * falls back to `N = 2` (byte-identical to the pre-#75
 * `computeFloatingRimBeams` behavior). When `options.numRows` is 3
 * or more the layout gains `N − 2` INTERIOR beams (ids
 * `beam-mid-0`..`beam-mid-{N-3}` in emit order) between the two
 * rim beams — mid-span support for joists that would otherwise
 * over-span the deck length.
 *
 * The pre-S26 floating beam layout emitted ONE beam per BLOCK COLUMN
 * running along +z (deck length). That model produced NO beam at
 * the two z-ends and had NO joists on top — decking rested directly
 * on beams at whatever gap the block grid gave. The S26 rework
 * replaces that with the standard "rim-beams + joists on top"
 * framing every DIY floating-deck tutorial describes; #75 adds the
 * automatic mid-span beam rows a span-safe DIY deck actually needs.
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
 *   - `position.z = -halfLengthMm + inset + k × step` for
 *     `k = 0..N-1`, where `step = (2 × (halfLengthMm - inset)) /
 *     (N - 1)` and `inset = FOOTING_WIDTH_MM / 2`. Rim beams
 *     (k=0 and k=N-1) sit at ±(halfLengthMm - inset); interior
 *     beams (k=1..N-2) sit evenly between them.
 *   - `rotation = { x:0, y:0, z:0 }`
 *
 * ## Stable ids — issue #75
 *
 * `BEAM_IDS.near = 'beam-near'` for the −z beam, `BEAM_IDS.far =
 * 'beam-far'` for the +z beam. INTERIOR beams use
 * `beam-mid-{k-1}` for `k = 1..N-2` (so the first interior beam
 * closest to `beam-near` is `beam-mid-0`). Rim ids stay STABLE
 * so BOM aggregation (`derive-bom.ts`), PlanView2D, and the
 * WarningsPanel tests that grep `beam-near`/`beam-far` remain
 * unaffected. Downstream helpers that iterate all beams (e.g.
 * `spanCheck`) don't need to know the id shape — they see a beam
 * either way.
 *
 * ## Backwards-compatible alias
 *
 * `computeFloatingRimBeams(design)` is retained as a `@deprecated`
 * wrapper that calls `computeFloatingBeams(design)` (no options,
 * so `numRows` defaults to 2). Every pre-#75 call site keeps
 * working byte-identically until it migrates to the new name.
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
 * Interior-beam id builder (issue #75). Kept as a small pure
 * helper so a future rename (e.g. `beam-interior-K`) is a
 * single-file change and every consumer that greps for the
 * pattern can key off ONE regex source.
 */
function interiorBeamId(midIndex: number): string {
  return `beam-mid-${midIndex}`;
}

/**
 * Options bag for {@link computeFloatingBeams}. Kept small and
 * discriminator-free so a future field (e.g. `explicitRowZCenters`)
 * is an additive change with no call-site impact.
 */
export interface ComputeFloatingBeamsOptions {
  /**
   * Total beam-row count `N ≥ 2`. When omitted, defaults to `2`
   * (pre-#75 byte-identical behavior). Non-finite / non-positive
   * values are treated as "omitted".
   */
  readonly numRows?: number;
}

/**
 * Build the N ≥ 2 beams of a Method-A floating deck. Pure — same
 * input yields byte-equal output.
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
export function computeFloatingBeams(
  design: DeckDesign,
  options?: ComputeFloatingBeamsOptions,
): readonly LayoutMember[] {
  if (design.floatingFraming !== 'beams-and-joists') {
    throw new Error(
      `computeFloatingBeams: this helper is only valid for ` +
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

  // Resolve the row count. Non-finite / non-positive / < 2 fall
  // back to 2 — matches the pre-#75 rim-only behavior.
  const rawNum = options?.numRows;
  const totalRows =
    rawNum !== undefined && Number.isFinite(rawNum) && rawNum >= 2
      ? Math.floor(rawNum)
      : 2;

  const beams: LayoutMember[] = [];
  const step = totalRows > 1 ? (farZ - nearZ) / (totalRows - 1) : 0;

  for (let k = 0; k < totalRows; k++) {
    // Stable id assignment (FR-C):
    //   k === 0            → 'beam-near'
    //   k === totalRows-1  → 'beam-far'
    //   otherwise          → 'beam-mid-{k-1}'
    // Emit order is left-to-right along +z. For N=2 this is
    // BYTE-IDENTICAL to the pre-#75 `[near, far]` output.
    const id =
      k === 0
        ? BEAM_IDS.near
        : k === totalRows - 1
          ? BEAM_IDS.far
          : interiorBeamId(k - 1);
    beams.push({
      id,
      kind: 'beam',
      material: { kind: 'lumber', ...design.beam.material },
      position: { x: 0, y: yCenter, z: nearZ + k * step },
      size: { x: widthMm, y: depthMm, z: thicknessMm },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  return beams;
}

/**
 * @deprecated Retained as a backwards-compatible alias for
 * `computeFloatingBeams(design)` (defaults `numRows = 2`). New code
 * MUST call `computeFloatingBeams` directly and pass `numRows`
 * from `resolveMethodABeamRows(...).totalRows` to opt in to the
 * span-safe intermediate beam rows added in issue #75.
 */
export function computeFloatingRimBeams(
  design: DeckDesign,
): readonly LayoutMember[] {
  return computeFloatingBeams(design);
}
