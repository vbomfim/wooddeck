/**
 * `src/domain/layout/floating/y-stack-floating.beam-connection.test.ts`
 * — S27 (feat/joist-beam-connection) unit tests for the FLOATING
 * y-stack branch on `design.beamConnection` under Method A
 * (`floatingFraming: 'beams-and-joists'`).
 *
 * ## Contract under test
 *
 * `computeYStackFloating(design)` for Method A dispatches on
 * `design.beamConnection`:
 *
 *   - `'drop'` (default; pre-S27 behavior)
 *       joist BOTTOM sits on beam TOP.
 *       Stack (bottom-up): block → beam → joist → decking.
 *       Above-ground height = beam + joist + decking.
 *
 *   - `'flush'`
 *       joist TOP is level with beam TOP.
 *       Stack collapses one layer: block → beam ↔ joist → decking.
 *       Above-ground height = max(beam, joist) + decking.
 *
 * ## Method B is UNAFFECTED
 *
 * `'joists-on-blocks'` has NO beam layer, so `beamConnection` is
 * IGNORED under Method B — asserted below.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { MM_PER_FOOT } from '../../units';
import { lookupMaterial } from '../../materials-catalog';

import {
  computeMinFloatingHeightMm,
  computeYStackFloating,
} from './y-stack-floating';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};

function makeFloating(
  overrides: Partial<{
    beam: MaterialRef;
    joist: MaterialRef;
    decking: MaterialRef;
    heightMm: number;
    foundation: FoundationSpec;
    floatingFraming: 'beams-and-joists' | 'joists-on-blocks';
    beamConnection: 'drop' | 'flush';
  }> = {},
): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000027',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: {
      widthMm: 16 * MM_PER_FOOT,
      lengthMm: 14 * MM_PER_FOOT,
      heightMm: overrides.heightMm ?? 500,
    },
    structure: 'floating',
    floatingFraming: overrides.floatingFraming ?? 'beams-and-joists',
    beamConnection: overrides.beamConnection ?? 'drop',
    foundation: overrides.foundation ?? TUFFBLOCK_FOUNDATION,
    joist: { material: overrides.joist ?? PT_2X8, spacingMm: 406 },
    beam: { material: overrides.beam ?? PT_2X8 },
    decking: {
      material: overrides.decking ?? PT_54,
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

// ---------------------------------------------------------------------------
// Method A drop — pre-S27 semantics preserved
// ---------------------------------------------------------------------------

describe('computeYStackFloating — Method A + drop (pre-S27 default)', () => {
  it('joist bottom sits on beam top (joistBottomY === beamTopY)', () => {
    const stack = computeYStackFloating(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'drop' }),
    );
    expect(stack.joistBottomY).toBe(stack.beamTopY);
  });

  it('above-ground stack: block top → beam → joist → decking', () => {
    const stack = computeYStackFloating(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'drop' }),
    );
    expect(stack.blockTopY).toBe(0);
    expect(stack.beamBottomY).toBe(0);
    expect(stack.joistBottomY).toBe(stack.beamTopY);
    expect(stack.deckingBottomY).toBe(stack.joistTopY);
  });
});

// ---------------------------------------------------------------------------
// Method A flush — joist TOP level with beam TOP (new S27 behavior)
// ---------------------------------------------------------------------------

describe('computeYStackFloating — Method A + flush (new S27 behavior)', () => {
  it('joist TOP === beam TOP (tops level)', () => {
    const stack = computeYStackFloating(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'flush' }),
    );
    expect(stack.joistTopY).toBe(stack.beamTopY);
  });

  it('decking bottom rests on joist top (which equals beam top)', () => {
    const stack = computeYStackFloating(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'flush' }),
    );
    expect(stack.deckingBottomY).toBe(stack.joistTopY);
    expect(stack.deckingBottomY).toBe(stack.beamTopY);
  });

  it('beam bottom still sits on block top (y=0) — supports unchanged', () => {
    // The beam still bears on blocks below; only the JOIST placement
    // shifts so joistTop coincides with beamTop. The beam itself
    // does not float — it sits on the block grid exactly as in drop.
    const stack = computeYStackFloating(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'flush' }),
    );
    expect(stack.beamBottomY).toBe(0);
    expect(stack.blockTopY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Method A drop vs flush — height comparison + min-height dispatch
// ---------------------------------------------------------------------------

describe('computeYStackFloating — Method A drop vs flush height comparison', () => {
  it('flush deckingTopY < drop deckingTopY (flush stack is shorter by joistDepth given beam >= joist)', () => {
    // Opus #2 (S27 review-response) — use UNEQUAL depths (2×8
    // joist, 2×10 beam — the canonical valid unequal-flush combo
    // under `validateFlushBeamDepth`) so the TRUE formula
    // (`joistDepth`, not `min(joist,beam)`) is asserted. Under
    // equal depths min == joist and both formulas evaluate to the
    // same 184 mm, masking whether the code is correct.
    const drop = computeYStackFloating(
      makeFloating({
        floatingFraming: 'beams-and-joists',
        beamConnection: 'drop',
        joist: PT_2X8,
        beam: PT_2X10,
      }),
    );
    const flush = computeYStackFloating(
      makeFloating({
        floatingFraming: 'beams-and-joists',
        beamConnection: 'flush',
        joist: PT_2X8,
        beam: PT_2X10,
      }),
    );
    // In floating there are no posts to absorb the difference —
    // the walking surface (deckingTopY) drops.
    expect(flush.deckingTopY).toBeLessThan(drop.deckingTopY);
    // TRUE formula: drop stack = decking + joist + beam;
    // flush stack = decking + max(joist, beam) = decking + beam;
    // delta = joistDepth (2×8 = 184 mm).
    expect(drop.deckingTopY - flush.deckingTopY).toBe(drop.joistDepthMm);
    expect(drop.deckingTopY - flush.deckingTopY).toBe(184);
  });

  it('joistCenterY differs: flush joist is LOWER than drop joist by joistDepth', () => {
    // Opus #4 (S27 review-response) — the pre-review test title
    // read "HIGHER" while the assertion computed
    // `drop.joistCenter - flush.joistCenter === joistDepth`
    // (i.e. flush is LOWER). Title now matches the math.
    const drop = computeYStackFloating(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'drop' }),
    );
    const flush = computeYStackFloating(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'flush' }),
    );
    // Drop: joist bottom = beam top → joistCenter = beamTop + joistDepth/2
    // Flush: joist top    = beam top → joistCenter = beamTop − joistDepth/2
    // Delta = joistDepth (flush joist center is LOWER by
    // exactly joistDepth for any depth combo — the beam does NOT
    // enter this formula because the joist top pins to the beam
    // top in flush regardless of beam depth).
    expect(drop.joistCenterY - flush.joistCenterY).toBe(drop.joistDepthMm);
  });

  it('deckingBottomY = beamTopY in flush (the invariant the flush stack rests on)', () => {
    const flush = computeYStackFloating(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'flush' }),
    );
    expect(flush.deckingBottomY).toBe(flush.beamTopY);
  });
});

// ---------------------------------------------------------------------------
// computeMinFloatingHeightMm — dispatch on beamConnection under Method A
// ---------------------------------------------------------------------------

describe('computeMinFloatingHeightMm — Method A drop vs flush', () => {
  it('drop min = beam + joist + decking (unchanged pre-S27 formula)', () => {
    const design = makeFloating({
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
    });
    const min = computeMinFloatingHeightMm(design);
    const beam = lookupMaterial(PT_2X8.nominal, PT_2X8.species, PT_2X8.grade);
    const joist = lookupMaterial(PT_2X8.nominal, PT_2X8.species, PT_2X8.grade);
    const decking = lookupMaterial(PT_54.nominal, PT_54.species, PT_54.grade);
    expect(min).toBe(
      beam.actual.heightMm + joist.actual.heightMm + decking.actual.widthMm,
    );
  });

  it('flush min = max(beam, joist) + decking (shorter than drop)', () => {
    const design = makeFloating({
      floatingFraming: 'beams-and-joists',
      beamConnection: 'flush',
    });
    const min = computeMinFloatingHeightMm(design);
    const beam = lookupMaterial(PT_2X8.nominal, PT_2X8.species, PT_2X8.grade);
    const joist = lookupMaterial(PT_2X8.nominal, PT_2X8.species, PT_2X8.grade);
    const decking = lookupMaterial(PT_54.nominal, PT_54.species, PT_54.grade);
    expect(min).toBe(
      Math.max(beam.actual.heightMm, joist.actual.heightMm) + decking.actual.widthMm,
    );
  });

  it('flush min < drop min (regression pin — flush IS shorter)', () => {
    const dropMin = computeMinFloatingHeightMm(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'drop' }),
    );
    const flushMin = computeMinFloatingHeightMm(
      makeFloating({ floatingFraming: 'beams-and-joists', beamConnection: 'flush' }),
    );
    expect(flushMin).toBeLessThan(dropMin);
  });

  it('mixed depths (2×8 joist + 2×10 beam) — flush min = beamDepth + decking (beam is deeper)', () => {
    const design = makeFloating({
      floatingFraming: 'beams-and-joists',
      beamConnection: 'flush',
      beam: PT_2X10,
      joist: PT_2X8,
    });
    const min = computeMinFloatingHeightMm(design);
    const beam = lookupMaterial(PT_2X10.nominal, PT_2X10.species, PT_2X10.grade);
    const decking = lookupMaterial(PT_54.nominal, PT_54.species, PT_54.grade);
    // Flush hangs joist off the beam side; joist top level with
    // beam top; the beam extends beyond the joist bottom. Above-
    // ground = beam depth (the deeper member) + decking.
    expect(min).toBe(beam.actual.heightMm + decking.actual.widthMm);
  });
});

// ---------------------------------------------------------------------------
// Method B — beamConnection is IGNORED (no beam layer)
// ---------------------------------------------------------------------------

describe('computeYStackFloating — Method B ignores beamConnection', () => {
  it('Method B + drop and Method B + flush produce IDENTICAL y-stacks', () => {
    const dropB = computeYStackFloating(
      makeFloating({ floatingFraming: 'joists-on-blocks', beamConnection: 'drop' }),
    );
    const flushB = computeYStackFloating(
      makeFloating({ floatingFraming: 'joists-on-blocks', beamConnection: 'flush' }),
    );
    expect(flushB).toEqual(dropB);
  });

  it('Method B min-height IDENTICAL between drop and flush (field is ignored)', () => {
    const dropMinB = computeMinFloatingHeightMm(
      makeFloating({ floatingFraming: 'joists-on-blocks', beamConnection: 'drop' }),
    );
    const flushMinB = computeMinFloatingHeightMm(
      makeFloating({ floatingFraming: 'joists-on-blocks', beamConnection: 'flush' }),
    );
    expect(flushMinB).toBe(dropMinB);
  });
});
