/**
 * `src/domain/layout/y-stack.ts` — the single source-of-truth for the
 * VERTICAL (y-axis) stack of a wooddeck layout.
 *
 * Ticket #5 requires the layout engine to produce full 3-D placement in
 * the world frame established by `src/domain/model.ts` (right-handed;
 * +x=width, +y=up, +z=length; origin at ground-level center of footprint).
 * The y-axis vertical stack is common to joists, beams, posts, and
 * decking — putting the formulas in ONE module prevents the four sub-
 * modules from drifting apart on the "how tall is the deck built up?"
 * question.
 *
 * ## The stack (top-down, y decreasing)
 *
 *   1. Decking TOP           at y = footprint.heightMm            (= "the surface the user walks on")
 *   2. Decking CENTER        at y = heightMm - deckingThickness/2
 *   3. Decking BOTTOM        at y = heightMm - deckingThickness    (= joist TOP)
 *   4. Joist  CENTER         at y = deckingBottom - joistDepth/2
 *   5. Joist  BOTTOM         at y = deckingBottom - joistDepth     (= beam TOP)
 *   6. Beam   CENTER         at y = jaistBottom  - beamDepth/2
 *   7. Beam   BOTTOM         at y = beamTop      - beamDepth        (= post TOP)
 *   8. Post   CENTER         at y = postBottom + postHeight/2
 *   9. Post   BOTTOM         at y = 0                                (= footing TOP, ground plane)
 *  10. Footing CENTER        at y = -FOOTING_DEPTH_MM / 2            (footing extends into -y)
 *  11. Footing BOTTOM        at y = -FOOTING_DEPTH_MM
 *
 * `deckingThickness` = decking material `actual.widthMm` (the SMALLER
 * dressed dimension — boards are laid FLAT, so the visible face is the
 * heightMm and the vertical thickness is the widthMm; see the catalog
 * convention in `materials-catalog.ts`).
 *
 * `joistDepth` = joist material `actual.heightMm` (joists laid on-edge —
 * the LARGER dressed dimension resists gravity bending, matching
 * standard framing practice).
 *
 * `beamDepth` = beam material `actual.heightMm` (beams on-edge, same
 * reason).
 *
 * ## Height-zero edge case
 *
 * When `footprint.heightMm` is small enough that (deckingThickness +
 * joistDepth + beamDepth) is ≥ heightMm, `postHeight` clamps to 0. This
 * matches the ticket's height-zero edge case ("posts have zero y-extent;
 * footings still placed"). Above-ground stack members still get their
 * correct y-positions relative to the top; the y-stack simply stops
 * at the beam bottom, which happens to be at or below y=0.
 *
 * ## Framework/DOM ban
 *
 * This module lives under `src/domain/**` and imports NOTHING from
 * outside `src/domain/`. All numeric inputs come from `Material.actual`
 * (typed `Mm`), which is `number` under the hood — no external calls.
 */

import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign } from '../model';
import type { Mm } from '../units';

/**
 * Depth of an in-ground concrete footing pier — a fixed MVP default.
 * Real footings depend on frost-line data; MVP uses a conservative
 * 300 mm block for visualization. Refine in v2+ when a frost-line
 * lookup is available.
 */
export const FOOTING_DEPTH_MM: Mm = 300;

/**
 * Plan-view size (x and z) of the footing cube. Same MVP simplification
 * as `FOOTING_DEPTH_MM` — a "one-size-fits-all" 300 mm concrete pier.
 */
export const FOOTING_WIDTH_MM: Mm = 300;

export interface YStack {
  readonly deckingTopY: Mm; // = footprint.heightMm
  readonly deckingCenterY: Mm;
  readonly deckingBottomY: Mm; // = joist top y
  readonly deckingThicknessMm: Mm;
  readonly joistCenterY: Mm;
  readonly joistBottomY: Mm; // = beam top y
  readonly joistDepthMm: Mm;
  readonly beamCenterY: Mm;
  readonly beamBottomY: Mm; // = post top y
  readonly beamDepthMm: Mm;
  readonly postCenterY: Mm;
  readonly postHeightMm: Mm; // clamped to 0 when the stack overflows
  readonly footingCenterY: Mm; // = -FOOTING_DEPTH_MM / 2
  readonly footingTopY: Mm; // = 0
}

/**
 * Compute every y-stack anchor for a given design. Pure function; the
 * inputs are the design's material references (resolved via the catalog)
 * and the raw `footprint.heightMm`.
 *
 * @throws {Error} when any material reference in the design is not in
 *   the catalog. This is delegated from `lookupMaterial` — the layout
 *   engine catches it and re-throws as `LayoutError`.
 */
export function computeYStack(design: DeckDesign): YStack {
  const decking = lookupMaterial(
    design.decking.material.nominal,
    design.decking.material.species,
    design.decking.material.grade,
  );
  const joist = lookupMaterial(
    design.joist.material.nominal,
    design.joist.material.species,
    design.joist.material.grade,
  );
  const beam = lookupMaterial(
    design.beam.material.nominal,
    design.beam.material.species,
    design.beam.material.grade,
  );

  const deckingThicknessMm = decking.actual.widthMm;
  const joistDepthMm = joist.actual.heightMm;
  const beamDepthMm = beam.actual.heightMm;

  const deckingTopY = design.footprint.heightMm;
  const deckingBottomY = deckingTopY - deckingThicknessMm;
  const deckingCenterY = deckingTopY - deckingThicknessMm / 2;

  const joistBottomY = deckingBottomY - joistDepthMm;
  const joistCenterY = deckingBottomY - joistDepthMm / 2;

  const beamBottomY = joistBottomY - beamDepthMm;
  const beamCenterY = joistBottomY - beamDepthMm / 2;

  // Post height = distance from ground plane (y=0) to the underside of the
  // beam. Clamp to 0 for the height-0 edge case (see module header).
  const postHeightMm = Math.max(0, beamBottomY);
  const postCenterY = postHeightMm / 2;

  const footingTopY = 0;
  const footingCenterY = -FOOTING_DEPTH_MM / 2;

  return {
    deckingTopY,
    deckingCenterY,
    deckingBottomY,
    deckingThicknessMm,
    joistCenterY,
    joistBottomY,
    joistDepthMm,
    beamCenterY,
    beamBottomY,
    beamDepthMm,
    postCenterY,
    postHeightMm,
    footingCenterY,
    footingTopY,
  };
}
