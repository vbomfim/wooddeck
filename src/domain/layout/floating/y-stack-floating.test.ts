/**
 * `src/domain/layout/floating/y-stack-floating.test.ts` — TDD RED
 * phase for the floating-model y-stack helper (S19, AC9).
 *
 * ## Contract under test
 *
 * `computeYStackFloating(design)` returns every y-anchor a floating
 * layout consumer needs:
 *
 *   1. Block top face at y=0 (i.e. block CENTER at y = -blockHeight/2)
 *   2. Beam bottom face at y=0 (beams rest ON blocks), beam CENTER at
 *      y = beamHeight/2, beam top at y = beamHeight
 *   3. Decking bottom face at y = beamHeight (decking rests ON beams),
 *      decking CENTER at y = beamHeight + deckingThickness/2, decking
 *      top at y = beamHeight + deckingThickness
 *
 * `computeMinFloatingHeightMm(design)` returns the minimum legal
 * `footprint.heightMm` for a floating deck (AC9). This is the ABOVE-
 * GROUND stack height — blocks live BELOW y=0 and do NOT contribute
 * to visible deck height:
 *
 *     MIN = beam.actual.heightMm + decking.actual.widthMm
 *
 * (where `decking.actual.widthMm` is the decking board's THICKNESS —
 * boards laid flat, so the smaller dressed dimension is vertical; see
 * `decking-layout.ts` module header for the convention.)
 *
 * NO minimum-post-height component (unlike the elevated y-stack —
 * see `y-stack.ts`'s `MIN_POST_HEIGHT_MM`). Floating decks have no
 * posts by definition (AC1 zero-post invariant).
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
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};

/**
 * Build a minimal floating `DeckDesign` for y-stack testing. Any
 * dimension that y-stack doesn't consume (footprint width/length,
 * joist spacing, orientation) uses a benign default so the test's
 * intent is clear at the call-site.
 */
function makeFloating(overrides: Partial<{
  beam: MaterialRef;
  decking: MaterialRef;
  heightMm: number;
  foundation: FoundationSpec;
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000019',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: {
      widthMm: 16 * MM_PER_FOOT,
      lengthMm: 14 * MM_PER_FOOT,
      heightMm: overrides.heightMm ?? 300,
    },
    structure: 'floating',
    foundation: overrides.foundation ?? TUFFBLOCK_FOUNDATION,
    joist: { material: overrides.beam ?? PT_2X8, spacingMm: 406 },
    beam: { material: overrides.beam ?? PT_2X8 },
    decking: {
      material: overrides.decking ?? PT_54,
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

// ---------------------------------------------------------------------------
// computeMinFloatingHeightMm — AC9
// ---------------------------------------------------------------------------

describe('computeMinFloatingHeightMm — AC9 (no post extent)', () => {
  it('2x8 PT beam + 5/4x6 PT decking → beam.height + decking.thickness', () => {
    const design = makeFloating();
    const beam = lookupMaterial('2x8', 'PT', 'No2'); // actual heightMm=184
    const decking = lookupMaterial('5/4x6', 'PT', 'No2'); // actual widthMm=25
    expect(computeMinFloatingHeightMm(design)).toBe(
      beam.actual.heightMm + decking.actual.widthMm,
    );
  });

  it('does NOT include MIN_POST_HEIGHT_MM (no posts in floating)', () => {
    const design = makeFloating();
    const beam = lookupMaterial('2x8', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    // If the implementation accidentally reused the elevated helper's
    // MIN_POST_HEIGHT_MM (25 mm), the minimum would be 25 mm larger.
    // Guard against that regression here.
    const bareStack = beam.actual.heightMm + decking.actual.widthMm;
    expect(computeMinFloatingHeightMm(design)).toBe(bareStack);
    expect(computeMinFloatingHeightMm(design)).toBeLessThan(bareStack + 25);
  });

  it('scales with a thicker beam (2x10 → 235 + 25 = 260 mm)', () => {
    const design = makeFloating({
      beam: { nominal: '2x10', species: 'PT', grade: 'No2' },
    });
    const beam = lookupMaterial('2x10', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    expect(computeMinFloatingHeightMm(design)).toBe(
      beam.actual.heightMm + decking.actual.widthMm,
    );
  });
});

// ---------------------------------------------------------------------------
// computeYStackFloating — the six anchor positions
// ---------------------------------------------------------------------------

describe('computeYStackFloating — anchor positions', () => {
  it('block top at y=0, block center at y = -blockHeight/2', () => {
    const design = makeFloating();
    const stack = computeYStackFloating(design);
    // TuffBlock actual heightMm = 102 mm (see foundation-catalog).
    expect(stack.blockHeightMm).toBe(102);
    expect(stack.blockTopY).toBe(0);
    expect(stack.blockCenterY).toBe(-51);
  });

  it('beam bottom at y=0 (on top of block), beam center at beam.height/2, beam top at beam.height', () => {
    const design = makeFloating();
    const stack = computeYStackFloating(design);
    const beam = lookupMaterial('2x8', 'PT', 'No2');
    expect(stack.beamBottomY).toBe(0);
    expect(stack.beamCenterY).toBe(beam.actual.heightMm / 2);
    expect(stack.beamTopY).toBe(beam.actual.heightMm);
    expect(stack.beamDepthMm).toBe(beam.actual.heightMm);
  });

  it('decking bottom at beam top, decking center = beamTop + deckingThickness/2, decking top = beamTop + deckingThickness', () => {
    const design = makeFloating();
    const stack = computeYStackFloating(design);
    const beam = lookupMaterial('2x8', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    expect(stack.deckingBottomY).toBe(beam.actual.heightMm);
    expect(stack.deckingCenterY).toBe(beam.actual.heightMm + decking.actual.widthMm / 2);
    expect(stack.deckingTopY).toBe(beam.actual.heightMm + decking.actual.widthMm);
    expect(stack.deckingThicknessMm).toBe(decking.actual.widthMm);
  });

  it('Oldcastle block foundation produces the correct blockHeightMm (178 mm)', () => {
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
// Error contract — unknown material triple
// ---------------------------------------------------------------------------

describe('computeYStackFloating — error contract', () => {
  it('throws when the beam material triple is not in the catalog', () => {
    const design = makeFloating();
    const bad: DeckDesign = {
      ...design,
      beam: {
        material: {
          nominal: '2x8',
          species: 'Cedar',
          // Grade='Select' is not in the catalog for 2x8 Cedar.
          grade: 'Select',
        },
      },
    };
    expect(() => computeYStackFloating(bad)).toThrow(/Unknown material/i);
  });

  it('throws when the foundation is posts-on-footings (floating helper misuse)', () => {
    // Guard: y-stack-floating expects a block-based foundation. Calling
    // it with posts-on-footings is a caller bug — fail loudly, not
    // silently. Mirrors the defensive throw in `layoutPostsAndFootings`.
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
