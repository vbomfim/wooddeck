/**
 * `src/domain/layout/decking-layout.ts` — lay out the surface decking
 * boards for the MVP freestanding-rectangular deck.
 *
 * ## Conventions
 *
 *   - Default orientation is `parallel-to-width` — boards run along +x
 *     (perpendicular to joists). `parallel-to-length` flips the axes:
 *     boards run along +z.
 *
 *   - Board face-width is the LARGER dressed dimension of the decking
 *     material (`heightMm` in `Material.actual`); board thickness is
 *     the SMALLER dressed dimension (`widthMm`). Rationale: boards are
 *     laid FLAT (face-up), so the visible surface width equals the
 *     larger dressed dim. 5/4×6 → face = 140 mm, thickness = 25 mm.
 *
 *   - Boards are separated by a fixed 3 mm gap for drainage /
 *     expansion — the ubiquitous residential-deck-carpentry default
 *     (`BOARD_GAP_MM`).
 *
 *   - The LAST board is positioned so its FAR face is flush with the
 *     footprint's far edge (`last.far === spanMm`). Its width is the
 *     remainder after all full-width boards + gaps; in the degenerate
 *     "the remainder happens to be exactly a full board width + one
 *     gap" case the LAST board is slightly wider than `faceWidthMm`
 *     (up to `faceWidthMm + BOARD_GAP_MM`), never narrower than the
 *     remainder. Nothing is ever ripped in the MVP. First board is
 *     flush at the −z (or −x, when flipped) near edge.
 *
 *   - Board top face is flush with `footprint.heightMm` (the y=heightMm
 *     plane is "the walking surface"). Y-position and thickness come
 *     from `computeYStack` (see y-stack.ts) so decking, joist, beam,
 *     and post heights cannot drift out of sync.
 *
 * ## Board-count formula
 *
 *   defaultOrientation:      boards laid along +z, spanning full +x
 *                            → boardCount = ceil(lengthMm / (faceWidth + gap))
 *   parallel-to-length:      boards laid along +x, spanning full +z
 *                            → boardCount = ceil(widthMm / (faceWidth + gap))
 *
 * Derivation: my `layoutBoardRows` places boards until
 * `cursor + pitch < spanMm` fails, having advanced `cursor` by `pitch =
 * (F + G)` each iteration. After k iterations `cursor = k*(F+G)`; the
 * loop exits when `(k+1)*(F+G) >= spanMm`, so `k = ceil(spanMm/(F+G))
 * − 1`. One final "remainder" board is always appended, so the total
 * `k + 1 = ceil(spanMm/(F+G))`. In the degenerate case where spanMm is
 * an exact multiple of pitch, the final board has width equal to the
 * trailing gap (`spanMm − k*(F+G) = G`) — still positive, still keeping
 * the far face flush with the footprint edge.
 */

import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign, LayoutMember } from '../model';
import type { Mm } from '../units';

import { computeYStack } from './y-stack';

/**
 * Uniform gap between adjacent decking boards. 3 mm is the MVP
 * standard drainage/expansion gap (equivalent to a 3/32" nail gap in
 * imperial carpentry). Fixed for MVP; can be surfaced as a user
 * setting in v2+.
 */
export const BOARD_GAP_MM: Mm = 3;

export function layoutDecking(design: DeckDesign): LayoutMember[] {
  const deckingMat = lookupMaterial(
    design.decking.material.nominal,
    design.decking.material.species,
    design.decking.material.grade,
  );
  const faceWidthMm = deckingMat.actual.heightMm; // 140 mm for 5/4×6
  const thicknessMm = deckingMat.actual.widthMm; // 25 mm for 5/4×6

  const yCenter = computeYStack(design).deckingCenterY;
  const orientation = design.decking.orientation;

  if (orientation === 'parallel-to-length') {
    return layoutParallelToLength(design, faceWidthMm, thicknessMm, yCenter);
  }
  return layoutParallelToWidth(design, faceWidthMm, thicknessMm, yCenter);
}

// ---------------------------------------------------------------------------
// Default orientation — boards run along +x (perpendicular to joists).
// Board rows advance along +z from -length/2 to +length/2.
// ---------------------------------------------------------------------------
function layoutParallelToWidth(
  design: DeckDesign,
  faceWidthMm: Mm,
  thicknessMm: Mm,
  yCenter: number,
): LayoutMember[] {
  const spanMm = design.footprint.lengthMm;
  const rowDims = layoutBoardRows(spanMm, faceWidthMm);

  return rowDims.map<LayoutMember>((row, i) => ({
    id: `board-${i}`,
    kind: 'board',
    material: design.decking.material,
    position: {
      x: 0,
      y: yCenter,
      // row.center is the row's center offset from -spanMm/2.
      z: -spanMm / 2 + row.center,
    },
    size: { x: design.footprint.widthMm, y: thicknessMm, z: row.faceWidth },
    rotation: { x: 0, y: 0, z: 0 },
  }));
}

// ---------------------------------------------------------------------------
// Flipped orientation — boards run along +z (parallel to joists).
// Board rows advance along +x from -width/2 to +width/2.
// ---------------------------------------------------------------------------
function layoutParallelToLength(
  design: DeckDesign,
  faceWidthMm: Mm,
  thicknessMm: Mm,
  yCenter: number,
): LayoutMember[] {
  const spanMm = design.footprint.widthMm;
  const rowDims = layoutBoardRows(spanMm, faceWidthMm);

  return rowDims.map<LayoutMember>((row, i) => ({
    id: `board-${i}`,
    kind: 'board',
    material: design.decking.material,
    position: {
      x: -spanMm / 2 + row.center,
      y: yCenter,
      z: 0,
    },
    size: { x: row.faceWidth, y: thicknessMm, z: design.footprint.lengthMm },
    rotation: { x: 0, y: 0, z: 0 },
  }));
}

interface BoardRow {
  /** Board face-width along the row-advance axis (last board may be < faceWidth). */
  readonly faceWidth: number;
  /** Row center measured from the start of the run (0..spanMm). */
  readonly center: number;
}

/**
 * Layout N rows of boards along a linear span. All rows except the
 * LAST are exactly `faceWidthMm` wide, separated by `BOARD_GAP_MM`
 * from the next row. The LAST row is positioned so its FAR face lies
 * flush with the far edge of the span (`row.far === spanMm`), and its
 * width is whatever remains — never larger than `faceWidthMm +
 * BOARD_GAP_MM` (see algorithm below).
 *
 * ## Flush-at-both-ends contract (GPT-MED#3 fix)
 *
 *   - `rows[0]`'s NEAR face is at 0 (the first board starts flush at
 *     the near edge of the span).
 *   - `rows.at(-1)`'s FAR face is at `spanMm` (the last board ends
 *     flush at the far edge — no perimeter gap).
 *
 * The previous implementation used `min(faceWidthMm, remaining)` while
 * advancing the cursor and left up to `BOARD_GAP_MM` of empty space at
 * the far end for spans in `(N*(F+G) - G + F, N*(F+G))`. That failure
 * mode was caught in code review — this rewrite makes the near AND
 * far edges of the decking flush with the footprint by design.
 *
 * ## Algorithm
 *
 *   1. Place N-1 full-width boards at pitch `(faceWidthMm + BOARD_GAP_MM)`
 *      starting at 0, provided a full-width board plus its trailing gap
 *      still fits inside the span. The loop guard is
 *      `cursor + faceWidthMm + BOARD_GAP_MM < spanMm`.
 *   2. Place a FINAL board that spans from `cursor` to `spanMm`. Its
 *      width is `spanMm - cursor ∈ (0, faceWidthMm + BOARD_GAP_MM]`.
 *
 * With this construction, the gap between the (N-1)th and Nth (last)
 * board's faces is exactly `BOARD_GAP_MM`, matching every internal
 * gap; the LAST board simply absorbs the perimeter remainder.
 */
function layoutBoardRows(spanMm: Mm, faceWidthMm: Mm): BoardRow[] {
  const rows: BoardRow[] = [];
  const pitch = faceWidthMm + BOARD_GAP_MM;

  // Guard the degenerate spanMm ≤ 0 case — layout-engine's
  // MIN_DECK_DIMENSION_MM validator makes this unreachable, but a
  // defensive early-out avoids an infinite loop if a future caller
  // slips past it.
  if (spanMm <= 0) return rows;

  let cursor = 0;
  // Place as many full-width boards as fit while still leaving room
  // for at least one more board (of any width) after the trailing gap.
  while (cursor + pitch < spanMm) {
    rows.push({ faceWidth: faceWidthMm, center: cursor + faceWidthMm / 2 });
    cursor += pitch;
  }
  // The FINAL board fills the remainder up to spanMm — its far face
  // lies flush with the footprint's far edge, satisfying the AC.
  const remainderWidth = spanMm - cursor;
  rows.push({ faceWidth: remainderWidth, center: cursor + remainderWidth / 2 });
  return rows;
}
