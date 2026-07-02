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
 *   - The LAST board carries the remainder (MVP simplification "no
 *     ripping"). Its face-width is < faceWidth if the footprint length
 *     does not accept an integer number of full boards + gaps. First
 *     board is flush with the −z (or −x, when flipped) edge.
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
 * `ceil(…)` matches the "fit as many full boards as possible then one
 * remainder board" strategy: N-1 full-face-width boards plus 1 partial-
 * width remainder board equals `ceil(dim / (faceWidth + gap))`.
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
 * Layout N rows of boards along a linear span. N-1 rows are full face-
 * width; the last row is the remainder (< faceWidth). Board centers are
 * spaced by (faceWidth + gap) except the last, which sits flush with the
 * far end of the span.
 */
function layoutBoardRows(spanMm: Mm, faceWidthMm: Mm): BoardRow[] {
  const rows: BoardRow[] = [];
  let cursor = 0; // start of the next board along the axis
  while (cursor < spanMm) {
    const remaining = spanMm - cursor;
    const width = Math.min(faceWidthMm, remaining);
    rows.push({ faceWidth: width, center: cursor + width / 2 });
    cursor += width + BOARD_GAP_MM;
  }
  return rows;
}
