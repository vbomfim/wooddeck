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
 * ## The stack (top-down, y decreasing) — DEPENDS ON `beamConnection`
 *
 * ### `beamConnection: 'drop'` (default, MVP pre-S27 behavior)
 *
 * Joist BOTTOM rests on beam TOP. Beam sits UNDER the joists,
 * classic drop-beam construction. The stack is:
 *
 *   1. Decking TOP           at y = footprint.heightMm            (= walking surface)
 *   2. Decking BOTTOM        at y = heightMm - deckingThickness    (= joist TOP)
 *   3. Joist  BOTTOM         at y = deckingBottom - joistDepth     (= beam TOP)
 *   4. Beam   BOTTOM         at y = joistBottom  - beamDepth        (= post TOP)
 *   5. Post   BOTTOM         at y = 0                                (= footing TOP)
 *
 * Above-ground stack depth = deckingThickness + joistDepth + beamDepth.
 *
 * ### `beamConnection: 'flush'` (S27 new)
 *
 * Joist TOP is LEVEL with beam TOP — joists are hung on the SIDE of
 * the beam with joist hangers. The beam extends DOWNWARD beside the
 * joist ends. The decking still rests on the joist top (= beam top).
 *
 *   1. Decking TOP           at y = footprint.heightMm            (= walking surface)
 *   2. Decking BOTTOM        at y = heightMm - deckingThickness    (= joist TOP = beam TOP)
 *   3. Joist  BOTTOM         at y = deckingBottom - joistDepth
 *   4. Beam   BOTTOM         at y = deckingBottom - beamDepth       (= post TOP)
 *   5. Post   BOTTOM         at y = 0                                (= footing TOP)
 *
 * Above-ground stack depth = deckingThickness + max(joistDepth, beamDepth).
 * The joist and beam OVERLAP vertically by min(joistDepth, beamDepth).
 *
 * Note: for equal joist / beam depths (the typical case) the flush
 * stack is exactly `joistDepth` shorter than the drop stack, so the
 * posts extend `joistDepth` LOWER for the same walking-surface
 * height.
 *
 * Below-decking footing anchors are unchanged:
 *
 *  6. Footing CENTER        at y = -FOOTING_DEPTH_MM / 2
 *  7. Footing BOTTOM        at y = -FOOTING_DEPTH_MM
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
 * When `footprint.heightMm` is small enough that the framing stack
 * (drop: deckingThickness + joistDepth + beamDepth; flush:
 * deckingThickness + max(joistDepth, beamDepth)) is ≥ heightMm,
 * `postHeight` clamps to 0 or negative. This matches the ticket's
 * height-zero edge case ("posts have zero y-extent; footings still
 * placed"). Above-ground stack members still get their correct
 * y-positions relative to the top; the y-stack simply stops at the
 * beam bottom, which happens to be at or below y=0.
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
import { assertNever } from '../assert-never';

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

/**
 * Minimum positive post height (y-extent) enforced by the layout engine.
 *
 * Rationale: at any deck height where `beamBottomY < MIN_POST_HEIGHT_MM`
 * the framing would either land underground (violating "all above-ground
 * members have y ∈ [0, heightMm]") or produce zero-extent posts (violating
 * AC6 "nonzero size on all 3 axes"). Rather than clamping silently, the
 * engine's `validateDesign` rejects such designs with a `LayoutError`
 * that names the minimum height. `MIN_POST_HEIGHT_MM = 25` (≈ 1″) is
 * the smallest post size that is renderable in the 3D scene without
 * being visually degenerate — well below any realistic residential deck
 * (a typical raised deck's posts are 300–3000 mm tall).
 *
 * S13 (height input UI) MUST clamp its lower bound to
 * `computeMinStructuralHeightMm(design)` (exported from `layout-engine.ts`).
 */
export const MIN_POST_HEIGHT_MM: Mm = 25;

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

  // Dispatch on `beamConnection` — the ONE seam that separates
  // classic "drop beam" (joists rest on beam) from "flush beam"
  // (joists hung on beam side; joist and beam TOPS level, joist
  // hangers bear the load). See module header for the full
  // ASCII stack diagram for both branches.
  //
  // Exhaustive switch — TypeScript's control-flow analysis
  // guarantees the `default:` branch is unreachable via
  // `assertNever`; a corrupt persisted value that widens the
  // union will fail loud at runtime instead of silently drifting
  // through with `undefined` positions.
  let joistBottomY: Mm;
  let joistCenterY: Mm;
  let beamBottomY: Mm;
  let beamCenterY: Mm;
  switch (design.beamConnection) {
    case 'drop':
      // MVP pre-S27 behavior — joist bottom on beam top.
      // Beam extends DOWNWARD from the joist bottom; the two
      // members are stacked, not overlapping.
      joistBottomY = deckingBottomY - joistDepthMm;
      joistCenterY = deckingBottomY - joistDepthMm / 2;
      beamBottomY = joistBottomY - beamDepthMm;
      beamCenterY = joistBottomY - beamDepthMm / 2;
      break;
    case 'flush':
      // S27 new — joist TOP flush with beam TOP. Beam still on
      // edge, but its top coincides with the joist top (=
      // decking bottom). The two members OVERLAP vertically by
      // `min(joistDepth, beamDepth)`; the stack is
      // correspondingly shorter, so the post height GROWS by
      // that overlap for the same walking-surface height.
      joistBottomY = deckingBottomY - joistDepthMm;
      joistCenterY = deckingBottomY - joistDepthMm / 2;
      beamBottomY = deckingBottomY - beamDepthMm;
      beamCenterY = deckingBottomY - beamDepthMm / 2;
      break;
    default:
      assertNever(design.beamConnection, 'computeYStack: design.beamConnection');
  }

  // Post height = distance from ground plane (y=0) to the underside of
  // the beam. For a design that passed `validateDesign` this is
  // guaranteed to be ≥ MIN_POST_HEIGHT_MM (i.e. strictly positive).
  //
  // The `layoutEngine`'s validator rejects any design whose heightMm
  // would drop the beam underneath the ground plane; direct callers of
  // this helper (i.e. tests exercising sub-layouts without going
  // through `computeLayout`) are responsible for the same invariant.
  // No silent clamping — the value is passed through as-is so a
  // violation is loud and traceable.
  const postHeightMm = beamBottomY;
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

/**
 * S27 review-response HIGH #3 — compute the framing-stack contribution
 * to the minimum structural height in ONE place, dispatched on
 * `beamConnection`. Both `layout-engine.computeMinStructuralHeightMm`
 * (elevated) and any future caller MUST derive their min-height from
 * the same helper — the min IS the y-stack, just with the post
 * collapsed to `MIN_POST_HEIGHT_MM`.
 *
 *   - `'drop'`  (unchanged from pre-S27):
 *       `decking + joist + beam + MIN_POST`
 *       — joist stacks ON TOP of beam, no overlap.
 *   - `'flush'` (S27 new):
 *       `decking + max(joistDepth, beamDepth) + MIN_POST`
 *       — joist and beam OVERLAP vertically (tops flush); the taller
 *       of the two dictates the stack. `validateFlushBeamDepth`
 *       guarantees `beamDepth >= joistDepth` for flush, so this is
 *       equivalent to `decking + beamDepth + MIN_POST` in practice —
 *       but computing it as `max(...)` documents the geometry
 *       correctly and stays correct even if a future caller applies
 *       this helper before validation.
 *
 * Pure function on primitives so it is trivially unit-testable and
 * has no material-catalog dependency (callers do the lookup).
 */
export function computeFramingStackMm(input: {
  readonly beamConnection: DeckDesign['beamConnection'];
  readonly deckingThicknessMm: Mm;
  readonly joistDepthMm: Mm;
  readonly beamDepthMm: Mm;
}): Mm {
  const { beamConnection, deckingThicknessMm, joistDepthMm, beamDepthMm } = input;
  switch (beamConnection) {
    case 'drop':
      return deckingThicknessMm + joistDepthMm + beamDepthMm + MIN_POST_HEIGHT_MM;
    case 'flush':
      return (
        deckingThicknessMm + Math.max(joistDepthMm, beamDepthMm) + MIN_POST_HEIGHT_MM
      );
    default:
      assertNever(beamConnection, 'computeFramingStackMm: beamConnection');
  }
}
