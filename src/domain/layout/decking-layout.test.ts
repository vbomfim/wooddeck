/**
 * Unit tests for `src/domain/layout/decking-layout.ts` — TDD RED phase.
 *
 * MVP conventions covered:
 *   - Boards are perpendicular to joists by default (parallel to +x); when
 *     `orientation === 'parallel-to-length'` boards are parallel to +z.
 *   - 3 mm gap between boards (BOARD_GAP_MM constant).
 *   - Boards span the full footprint dimension perpendicular to their own
 *     long axis: full width in default orientation, full length in flipped.
 *   - The LAST board may be narrower (no ripping in MVP): its face-width
 *     equals the remainder after all full-width boards + gaps.
 *   - Board top is flush with `footprint.heightMm`.
 */
import { describe, expect, it } from 'vitest';

import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign } from '../model';

import { BOARD_GAP_MM, layoutDecking } from './decking-layout';

function makeDesign(overrides: Partial<{
  widthMm: number;
  lengthMm: number;
  heightMm: number;
  orientation: DeckDesign['decking']['orientation'];
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    createdAt: '2026-07-02T00:00:00.000Z',
    footprint: {
      widthMm: overrides.widthMm ?? 3660,
      lengthMm: overrides.lengthMm ?? 4880,
      heightMm: overrides.heightMm ?? 914,
    },
    structure: 'elevated',
    foundation: {
      type: 'posts-on-footings',
      post: { nominal: '6x6', species: 'PT', grade: 'No2' },
      footing: { widthMm: 300, depthMm: 300 },
    },
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: 406,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
    post: { material: { nominal: '6x6', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: overrides.orientation ?? 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

describe('decking-layout — constants', () => {
  it('BOARD_GAP_MM is 3 mm (MVP standard drainage/expansion gap)', () => {
    expect(BOARD_GAP_MM).toBe(3);
  });
});

describe('decking-layout — default orientation (parallel-to-width)', () => {
  const deckingMat = lookupMaterial('5/4x6', 'PT', 'No2');
  const faceWidth = deckingMat.actual.heightMm; // 140 mm — the visible board face width
  const thickness = deckingMat.actual.widthMm; // 25 mm — the vertical thickness laid flat

  it('every board runs the full width along +x', () => {
    const design = makeDesign({ widthMm: 3660 });
    for (const b of layoutDecking(design)) expect(b.size.x).toBe(3660);
  });

  it('boards are laid flat: size.y = board thickness (25 mm)', () => {
    for (const b of layoutDecking(makeDesign())) expect(b.size.y).toBe(thickness);
  });

  it('non-last boards have size.z = board face-width (140 mm)', () => {
    const boards = layoutDecking(makeDesign({ lengthMm: 4880 }));
    // All but the last are full-width.
    for (const b of boards.slice(0, -1)) expect(b.size.z).toBe(faceWidth);
  });

  it('board count = ceil(lengthMm / (faceWidth + gap))', () => {
    // 4880 / (140+3) = 4880/143 = 34.126 → ceil = 35 boards
    const boards = layoutDecking(makeDesign({ lengthMm: 4880 }));
    expect(boards).toHaveLength(35);
  });

  it('board top face is flush with footprint.heightMm on y', () => {
    const design = makeDesign({ heightMm: 914 });
    for (const b of layoutDecking(design)) {
      // Center y = heightMm - thickness/2.
      expect(b.position.y).toBeCloseTo(914 - thickness / 2, 6);
    }
  });

  it('boards are laid contiguously from z=-length/2 with a 3 mm gap between them', () => {
    const design = makeDesign({ lengthMm: 4880 });
    const boards = layoutDecking(design);
    // First board's -z face at z = -length/2 → center = -length/2 + faceWidth/2.
    expect(boards[0]!.position.z).toBeCloseTo(-4880 / 2 + faceWidth / 2, 6);
    // Each subsequent board is offset by (faceWidth + gap), UNTIL the last one
    // which may be smaller.
    for (let i = 1; i < boards.length - 1; i++) {
      const gap = boards[i]!.position.z - boards[i - 1]!.position.z;
      expect(gap).toBeCloseTo(faceWidth + BOARD_GAP_MM, 6);
    }
  });

  it('the last board carries the remainder (may be narrower or slightly wider, no ripping)', () => {
    const design = makeDesign({ lengthMm: 4880 });
    const boards = layoutDecking(design);
    const last = boards.at(-1)!;
    // Last board's size.z is > 0. Post Fix C the last board can be up to
    // (faceWidth + BOARD_GAP_MM) since it absorbs the perimeter remainder
    // to keep the far edge flush with the footprint.
    expect(last.size.z).toBeGreaterThan(0);
    expect(last.size.z).toBeLessThanOrEqual(faceWidth + BOARD_GAP_MM);
  });

  it('Fix C: FIRST board near face is at footprint near edge (-length/2)', () => {
    const design = makeDesign({ lengthMm: 4880 });
    const boards = layoutDecking(design);
    const first = boards[0]!;
    const nearFace = first.position.z - first.size.z / 2;
    expect(nearFace).toBeCloseTo(-4880 / 2, 6);
  });

  it('Fix C: LAST board far face is FLUSH with footprint far edge (+length/2)', () => {
    // Regression test for GPT-MED#3 — previously up to BOARD_GAP_MM was
    // left as an air-gap at the far end. Under Fix C the last board
    // absorbs the remainder and its far face lies at +length/2 exactly.
    const design = makeDesign({ lengthMm: 4880 });
    const boards = layoutDecking(design);
    const last = boards.at(-1)!;
    const farFace = last.position.z + last.size.z / 2;
    expect(farFace).toBeCloseTo(4880 / 2, 6);
  });

  it('Fix C: near-face flush and far-face flush for a variety of lengths (including remainder-inducing)', () => {
    // Includes GPT-MED#3's original repro (length 1287 previously ended at 1284).
    // Any length ≥ MIN_DECK_DIMENSION_MM: 4 ft = 1219.2 mm.
    for (const lengthMm of [1220, 1287, 2000, 2438, 3660, 4880, 6096, 12192]) {
      const design = makeDesign({ lengthMm });
      const boards = layoutDecking(design);
      const first = boards[0]!;
      const last = boards.at(-1)!;
      const nearFace = first.position.z - first.size.z / 2;
      const farFace = last.position.z + last.size.z / 2;
      expect(nearFace, `lengthMm=${lengthMm} near face`).toBeCloseTo(-lengthMm / 2, 6);
      expect(farFace, `lengthMm=${lengthMm} far face`).toBeCloseTo(lengthMm / 2, 6);
    }
  });

  it('boards do not overlap along z', () => {
    const boards = layoutDecking(makeDesign({ lengthMm: 4880 }));
    for (let i = 1; i < boards.length; i++) {
      const prev = boards[i - 1]!;
      const cur = boards[i]!;
      const prevTop = prev.position.z + prev.size.z / 2;
      const curBottom = cur.position.z - cur.size.z / 2;
      // 3 mm gap → curBottom = prevTop + 3.
      expect(curBottom).toBeGreaterThanOrEqual(prevTop);
    }
  });

  it('every board has zero rotation and carries the decking material', () => {
    const design = makeDesign();
    for (const b of layoutDecking(design)) {
      expect(b.rotation).toEqual({ x: 0, y: 0, z: 0 });
      // S17 MemberMaterialRef widening — decking boards are
      // stamped `{kind:'lumber', ...design.decking.material}`.
      expect(b.material).toEqual({ kind: 'lumber', ...design.decking.material });
      expect(b.kind).toBe('board');
    }
  });

  it('every board has a stable, unique, non-empty id (board-<index>)', () => {
    const boards = layoutDecking(makeDesign());
    const ids = boards.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^board-\d+$/);
  });
});

describe('decking-layout — orientation flip (parallel-to-length)', () => {
  const deckingMat = lookupMaterial('5/4x6', 'PT', 'No2');
  const faceWidth = deckingMat.actual.heightMm; // 140 mm

  it('boards run along +z (full length) when orientation = parallel-to-length', () => {
    const design = makeDesign({
      widthMm: 3660,
      lengthMm: 4880,
      orientation: 'parallel-to-length',
    });
    for (const b of layoutDecking(design)) expect(b.size.z).toBe(4880);
  });

  it('board count with flipped orientation = ceil(widthMm / (faceWidth + gap))', () => {
    // 3660 / 143 = 25.59 → ceil = 26 boards
    const design = makeDesign({ widthMm: 3660, orientation: 'parallel-to-length' });
    expect(layoutDecking(design)).toHaveLength(26);
  });

  it('non-last flipped boards have size.x = face-width (140 mm)', () => {
    const boards = layoutDecking(
      makeDesign({ widthMm: 3660, orientation: 'parallel-to-length' }),
    );
    for (const b of boards.slice(0, -1)) expect(b.size.x).toBe(faceWidth);
  });

  it('flipped boards are laid from x=-width/2 with 3 mm gap between them', () => {
    const boards = layoutDecking(
      makeDesign({ widthMm: 3660, orientation: 'parallel-to-length' }),
    );
    expect(boards[0]!.position.x).toBeCloseTo(-3660 / 2 + faceWidth / 2, 6);
    for (let i = 1; i < boards.length - 1; i++) {
      const gap = boards[i]!.position.x - boards[i - 1]!.position.x;
      expect(gap).toBeCloseTo(faceWidth + BOARD_GAP_MM, 6);
    }
  });

  it('Fix C: FIRST flipped board near face is at -width/2', () => {
    const boards = layoutDecking(
      makeDesign({ widthMm: 3660, orientation: 'parallel-to-length' }),
    );
    const first = boards[0]!;
    const nearFace = first.position.x - first.size.x / 2;
    expect(nearFace).toBeCloseTo(-3660 / 2, 6);
  });

  it('Fix C: LAST flipped board far face is FLUSH with +width/2', () => {
    const boards = layoutDecking(
      makeDesign({ widthMm: 3660, orientation: 'parallel-to-length' }),
    );
    const last = boards.at(-1)!;
    const farFace = last.position.x + last.size.x / 2;
    expect(farFace).toBeCloseTo(3660 / 2, 6);
  });

  it('Fix C: near/far flush across a variety of widths (flipped orientation)', () => {
    for (const widthMm of [1220, 1287, 2000, 2438, 3660, 4880, 6096, 12192]) {
      const design = makeDesign({ widthMm, orientation: 'parallel-to-length' });
      const boards = layoutDecking(design);
      const first = boards[0]!;
      const last = boards.at(-1)!;
      const nearFace = first.position.x - first.size.x / 2;
      const farFace = last.position.x + last.size.x / 2;
      expect(nearFace, `widthMm=${widthMm} near face`).toBeCloseTo(-widthMm / 2, 6);
      expect(farFace, `widthMm=${widthMm} far face`).toBeCloseTo(widthMm / 2, 6);
    }
  });
});

describe('decking-layout — determinism', () => {
  it('is deterministic — same design yields deeply-equal member arrays', () => {
    const design = makeDesign();
    expect(layoutDecking(design)).toEqual(layoutDecking(design));
  });
});
