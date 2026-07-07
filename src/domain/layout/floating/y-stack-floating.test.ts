/**
 * `src/domain/layout/floating/y-stack-floating.test.ts` — the
 * y-stack unit tests, S26 (fix/floating-framing-joists).
 *
 * ## Contract under test
 *
 * `computeYStackFloating(design)` returns every y-anchor a floating
 * layout consumer needs. The stack VARIES by `design.floatingFraming`:
 *
 *   - Method A (`'beams-and-joists'`, default): block → beam →
 *     joist → decking.
 *   - Method B (`'joists-on-blocks'`): block → joist → decking
 *     (beam layer collapses to zero-thickness).
 *
 * `computeMinFloatingHeightMm(design)` returns the minimum legal
 * `footprint.heightMm` for a floating deck (S26 rework). This is
 * the ABOVE-GROUND stack height — blocks live BELOW y=0 and do NOT
 * contribute to visible deck height:
 *
 *   - Method A: `beam.height + joist.height + decking.thickness`
 *   - Method B: `joist.height + decking.thickness`
 *
 * NO minimum-post-height component (unlike the elevated y-stack —
 * see `y-stack.ts`'s `MIN_POST_HEIGHT_MM`). Floating decks have no
 * posts by definition.
 */
import { describe, expect, it } from 'vitest';

import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { MM_PER_FOOT } from '../../units';

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

function makeFloating(overrides: Partial<{
  beam: MaterialRef;
  joist: MaterialRef;
  decking: MaterialRef;
  heightMm: number;
  foundation: FoundationSpec;
  floatingFraming: 'beams-and-joists' | 'joists-on-blocks';
  beamConnection: 'drop' | 'flush';
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000019',
    createdAt: '2026-07-04T00:00:00.000Z',
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
// computeMinFloatingHeightMm — Method A
// ---------------------------------------------------------------------------

describe('computeMinFloatingHeightMm — Method A (beams + joists)', () => {
  it('2x8 beam + 2x8 joist + 5/4x6 decking → 184 + 184 + 25 = 393 mm', () => {
    const design = makeFloating({ floatingFraming: 'beams-and-joists' });
    const beam = lookupMaterial('2x8', 'PT', 'No2');
    const joist = lookupMaterial('2x8', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    expect(computeMinFloatingHeightMm(design)).toBe(
      beam.actual.heightMm + joist.actual.heightMm + decking.actual.widthMm,
    );
  });

  it('scales with a thicker beam (2x10 beam) — the JOIST + decking are unchanged', () => {
    const design = makeFloating({
      beam: PT_2X10,
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
    });
    const beam = lookupMaterial('2x10', 'PT', 'No2');
    const joist = lookupMaterial('2x8', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    expect(computeMinFloatingHeightMm(design)).toBe(
      beam.actual.heightMm + joist.actual.heightMm + decking.actual.widthMm,
    );
  });
});

// ---------------------------------------------------------------------------
// computeMinFloatingHeightMm — Method B
// ---------------------------------------------------------------------------

describe('computeMinFloatingHeightMm — Method B (joists on blocks)', () => {
  it('2x8 joist + 5/4x6 decking → 184 + 25 = 209 mm (NO beam)', () => {
    const design = makeFloating({ floatingFraming: 'joists-on-blocks' });
    const joist = lookupMaterial('2x8', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    expect(computeMinFloatingHeightMm(design)).toBe(
      joist.actual.heightMm + decking.actual.widthMm,
    );
  });

  it('Method B height is STRICTLY LESS than Method A height for the same joist + decking (beam layer omitted)', () => {
    const a = makeFloating({ floatingFraming: 'beams-and-joists' });
    const b = makeFloating({ floatingFraming: 'joists-on-blocks' });
    expect(computeMinFloatingHeightMm(b)).toBeLessThan(
      computeMinFloatingHeightMm(a),
    );
  });
});

// ---------------------------------------------------------------------------
// computeYStackFloating — anchor positions (Method A)
// ---------------------------------------------------------------------------

describe('computeYStackFloating — anchors (Method A)', () => {
  it('block top at y=0, block center at y = -blockHeight/2', () => {
    const design = makeFloating();
    const stack = computeYStackFloating(design);
    expect(stack.blockHeightMm).toBe(102); // TuffBlock 12x12x4
    expect(stack.blockTopY).toBe(0);
    expect(stack.blockCenterY).toBe(-51);
  });

  it('beam bottom at y=0 (on block), beam center at beam.height/2, beam top at beam.height', () => {
    const design = makeFloating();
    const stack = computeYStackFloating(design);
    const beam = lookupMaterial('2x8', 'PT', 'No2');
    expect(stack.beamBottomY).toBe(0);
    expect(stack.beamCenterY).toBe(beam.actual.heightMm / 2);
    expect(stack.beamTopY).toBe(beam.actual.heightMm);
    expect(stack.beamDepthMm).toBe(beam.actual.heightMm);
  });

  it('joist bottom at beam top, joist center at beam.top + joist.height/2, joist top at beam.top + joist.height', () => {
    const design = makeFloating();
    const stack = computeYStackFloating(design);
    const beam = lookupMaterial('2x8', 'PT', 'No2');
    const joist = lookupMaterial('2x8', 'PT', 'No2');
    expect(stack.joistBottomY).toBe(beam.actual.heightMm);
    expect(stack.joistCenterY).toBe(
      beam.actual.heightMm + joist.actual.heightMm / 2,
    );
    expect(stack.joistTopY).toBe(beam.actual.heightMm + joist.actual.heightMm);
    expect(stack.joistDepthMm).toBe(joist.actual.heightMm);
  });

  it('decking bottom at joist top, decking center = joistTop + deckingThickness/2', () => {
    const design = makeFloating();
    const stack = computeYStackFloating(design);
    const beam = lookupMaterial('2x8', 'PT', 'No2');
    const joist = lookupMaterial('2x8', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    const joistTopY = beam.actual.heightMm + joist.actual.heightMm;
    expect(stack.deckingBottomY).toBe(joistTopY);
    expect(stack.deckingCenterY).toBe(joistTopY + decking.actual.widthMm / 2);
    expect(stack.deckingTopY).toBe(joistTopY + decking.actual.widthMm);
    expect(stack.deckingThicknessMm).toBe(decking.actual.widthMm);
  });
});

// ---------------------------------------------------------------------------
// computeYStackFloating — anchor positions (Method B)
// ---------------------------------------------------------------------------

describe('computeYStackFloating — anchors (Method B, joists-on-blocks)', () => {
  it('beam layer collapses (beamDepthMm=0; beamTopY = beamBottomY = 0)', () => {
    const design = makeFloating({ floatingFraming: 'joists-on-blocks' });
    const stack = computeYStackFloating(design);
    expect(stack.beamDepthMm).toBe(0);
    expect(stack.beamBottomY).toBe(0);
    expect(stack.beamTopY).toBe(0);
    expect(stack.beamCenterY).toBe(0);
  });

  it('joist bottom flush with block top (y=0); joist center at joist.height/2', () => {
    const design = makeFloating({ floatingFraming: 'joists-on-blocks' });
    const stack = computeYStackFloating(design);
    const joist = lookupMaterial('2x8', 'PT', 'No2');
    expect(stack.joistBottomY).toBe(0);
    expect(stack.joistCenterY).toBe(joist.actual.heightMm / 2);
    expect(stack.joistTopY).toBe(joist.actual.heightMm);
  });

  it('decking bottom at joist top; decking rests DIRECTLY on joists (no beam layer)', () => {
    const design = makeFloating({ floatingFraming: 'joists-on-blocks' });
    const stack = computeYStackFloating(design);
    const joist = lookupMaterial('2x8', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    expect(stack.deckingBottomY).toBe(joist.actual.heightMm);
    expect(stack.deckingCenterY).toBe(
      joist.actual.heightMm + decking.actual.widthMm / 2,
    );
    expect(stack.deckingTopY).toBe(joist.actual.heightMm + decking.actual.widthMm);
  });
});

// ---------------------------------------------------------------------------
// Oldcastle foundation still resolves correctly
// ---------------------------------------------------------------------------

describe('computeYStackFloating — other foundations', () => {
  it('Oldcastle deck-blocks foundation → blockHeightMm=178 mm', () => {
    const design = makeFloating({
      foundation: {
        type: 'deck-blocks',
        product: { productId: 'oldcastle-11x11x7' },
      },
    });
    const stack = computeYStackFloating(design);
    expect(stack.blockHeightMm).toBe(178);
    expect(stack.blockCenterY).toBe(-89);
  });
});

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

describe('computeYStackFloating — error contract', () => {
  it('throws when the beam material triple is not in the catalog', () => {
    const design = makeFloating();
    const bad: DeckDesign = {
      ...design,
      beam: {
        material: { nominal: '2x8', species: 'Cedar', grade: 'Select' },
      },
    };
    expect(() => computeYStackFloating(bad)).toThrow(/Unknown material/i);
  });

  it('throws when the foundation is posts-on-footings (floating helper misuse)', () => {
    const bad: DeckDesign = {
      ...makeFloating(),
      foundation: {
        type: 'posts-on-footings',
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        footing: { widthMm: 300, depthMm: 300 },
      },
    };
    expect(() => computeYStackFloating(bad)).toThrow(
      /posts-on-footings|floating/i,
    );
  });
});
