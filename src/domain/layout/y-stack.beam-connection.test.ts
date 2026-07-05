/**
 * `src/domain/layout/y-stack.beam-connection.test.ts` — S27
 * (feat/joist-beam-connection) unit tests for the ELEVATED y-stack
 * branch on `design.beamConnection`.
 *
 * ## Contract under test
 *
 * `computeYStack(design)` dispatches on `design.beamConnection`:
 *
 *   - `'drop'` (default; pre-S27 behavior)
 *       joist BOTTOM sits ON TOP of beam TOP
 *       (`joistBottomY === beamTopY`)
 *       Stack: decking → joists → beams → posts → footings.
 *
 *   - `'flush'`
 *       joist TOP is level with beam TOP
 *       (`joistTopY === beamTopY`)
 *       The beam extends DOWNWARD beside the joist ends, hung by
 *       joist hangers. Stack is SHORTER than drop by the
 *       joist-in-beam overlap; the beam bottom drops accordingly
 *       so posts / footings still bear the beam bottom.
 *
 * ## Regression pin — drop MUST stay byte-identical to pre-S27
 *
 * Every pre-S27 golden fixture (`__fixtures__/*.json`) was
 * generated under the implicit "drop" convention. The `'drop'`
 * branch below computes byte-identical numbers to the
 * pre-S27 formula, so those fixtures remain valid.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, MaterialRef } from '../model';
import { MM_PER_FOOT } from '../units';
import { lookupMaterial } from '../materials-catalog';

import { computeYStack } from './y-stack';

const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
const PT_6X6: MaterialRef = { nominal: '6x6', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

function makeElevated(
  overrides: Partial<{
    beamConnection: 'drop' | 'flush';
    beam: MaterialRef;
    joist: MaterialRef;
    heightMm: number;
  }> = {},
): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000027',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: {
      widthMm: 12 * MM_PER_FOOT,
      lengthMm: 14 * MM_PER_FOOT,
      heightMm: overrides.heightMm ?? 3 * MM_PER_FOOT, // 914 mm
    },
    structure: 'elevated',
    floatingFraming: 'beams-and-joists',
    beamConnection: overrides.beamConnection ?? 'drop',
    foundation: {
      type: 'posts-on-footings',
      post: PT_6X6,
      footing: { widthMm: 300, depthMm: 300 },
    },
    joist: { material: overrides.joist ?? PT_2X10, spacingMm: 406 },
    beam: { material: overrides.beam ?? PT_2X10 },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

// ---------------------------------------------------------------------------
// drop — pre-S27 semantics preserved
// ---------------------------------------------------------------------------

describe('computeYStack — beamConnection: "drop" (pre-S27 default)', () => {
  it('joist BOTTOM sits on beam TOP (joistBottomY === beamTopY)', () => {
    const design = makeElevated({ beamConnection: 'drop' });
    const stack = computeYStack(design);
    // beamTop is not a stored field; it is beamCenterY + beamDepth/2.
    const beamTopY = stack.beamCenterY + stack.beamDepthMm / 2;
    expect(stack.joistBottomY).toBe(beamTopY);
  });

  it('decking BOTTOM sits on joist TOP (deckingBottomY === joistTopY)', () => {
    const design = makeElevated({ beamConnection: 'drop' });
    const stack = computeYStack(design);
    const joistTopY = stack.joistCenterY + stack.joistDepthMm / 2;
    expect(stack.deckingBottomY).toBe(joistTopY);
  });

  it('decking TOP === footprint.heightMm (walking surface pinned)', () => {
    const design = makeElevated({ beamConnection: 'drop', heightMm: 914 });
    const stack = computeYStack(design);
    expect(stack.deckingTopY).toBe(914);
  });
});

// ---------------------------------------------------------------------------
// flush — joist tops LEVEL with beam tops (S27 new behavior)
// ---------------------------------------------------------------------------

describe('computeYStack — beamConnection: "flush" (new S27 behavior)', () => {
  it('joist TOP is level with beam TOP (joistTopY === beamTopY)', () => {
    const design = makeElevated({ beamConnection: 'flush' });
    const stack = computeYStack(design);
    const joistTopY = stack.joistCenterY + stack.joistDepthMm / 2;
    const beamTopY = stack.beamCenterY + stack.beamDepthMm / 2;
    expect(joistTopY).toBe(beamTopY);
  });

  it('decking BOTTOM still rests on joist TOP (decking on joist top, not on beam)', () => {
    const design = makeElevated({ beamConnection: 'flush' });
    const stack = computeYStack(design);
    const joistTopY = stack.joistCenterY + stack.joistDepthMm / 2;
    expect(stack.deckingBottomY).toBe(joistTopY);
  });

  it('decking BOTTOM equals beam TOP (both equal joist top — the tops are all coincident)', () => {
    const design = makeElevated({ beamConnection: 'flush' });
    const stack = computeYStack(design);
    const beamTopY = stack.beamCenterY + stack.beamDepthMm / 2;
    expect(stack.deckingBottomY).toBe(beamTopY);
  });

  it('beam BOTTOM = beamTop - beamDepth (unchanged relative to beam center)', () => {
    // Even in flush the beam is still on-edge, full depth downward
    // from its top. The DIFFERENCE from drop is where beamTop sits
    // (level with joistTop, not below joistBottom).
    const design = makeElevated({ beamConnection: 'flush' });
    const stack = computeYStack(design);
    const beamTopY = stack.beamCenterY + stack.beamDepthMm / 2;
    expect(stack.beamBottomY).toBe(beamTopY - stack.beamDepthMm);
  });

  it('walking surface (deckingTopY) still pinned to footprint.heightMm', () => {
    // Pinning the walking surface is the invariant that keeps user
    // input meaningful. The flush stack shortens by shifting the
    // BEAM up (and its posts/footings), not the deck surface down.
    const design = makeElevated({ beamConnection: 'flush', heightMm: 914 });
    const stack = computeYStack(design);
    expect(stack.deckingTopY).toBe(914);
  });
});

// ---------------------------------------------------------------------------
// drop vs flush — the flush stack is SHORTER by the joist/beam overlap
// ---------------------------------------------------------------------------

describe('computeYStack — drop vs flush height comparison', () => {
  // Opus #2 (S27 review-response) — use UNEQUAL depths (2×8 joist,
  // 2×10 beam) so the drop-vs-flush deltas are NOT a coincidence
  // of equal-depth arithmetic. Under `validateFlushBeamDepth` the
  // valid unequal-flush combo is `beam depth >= joist depth`,
  // so 2×8 joist + 2×10 beam is the canonical unequal test case.
  const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
  const UNEQUAL = { joist: PT_2X8, beam: PT_2X10 } as const;

  it('flush post height > drop post height by joistDepth (the joist collapses into the beam window)', () => {
    // Both designs have the same footprint.heightMm — the walking
    // surface is pinned. In DROP the framing extends beam+joist
    // BELOW the decking; in FLUSH the joist collapses into the
    // beam's y-range (tops flush), so the framing depth shrinks
    // by exactly `joistDepth` (given beam >= joist). The post
    // picks up the difference (grows taller).
    const drop = computeYStack(makeElevated({ beamConnection: 'drop', ...UNEQUAL }));
    const flush = computeYStack(makeElevated({ beamConnection: 'flush', ...UNEQUAL }));
    const joist = lookupMaterial(PT_2X8.nominal, PT_2X8.species, PT_2X8.grade);
    // TRUE formula (Opus #2): the delta is EXACTLY the joist depth
    // — NOT `min(joist, beam)`. `min(joist, beam) == joist` here
    // only because beam > joist (the valid flush invariant); the
    // pre-review test used equal depths so both formulas evaluated
    // to the same 235 mm, masking whether the code was actually
    // correct.
    expect(flush.postHeightMm - drop.postHeightMm).toBe(joist.actual.heightMm);
    // Sanity check — 2×8 joist depth is 184 mm.
    expect(flush.postHeightMm - drop.postHeightMm).toBe(184);
  });

  it('flush stack (deckingTop - beamBottom) is SHORTER than drop stack by joistDepth', () => {
    const drop = computeYStack(makeElevated({ beamConnection: 'drop', ...UNEQUAL }));
    const flush = computeYStack(makeElevated({ beamConnection: 'flush', ...UNEQUAL }));
    const dropStackDepth = drop.deckingTopY - drop.beamBottomY;
    const flushStackDepth = flush.deckingTopY - flush.beamBottomY;
    expect(flushStackDepth).toBeLessThan(dropStackDepth);
    // TRUE formula (Opus #2): drop stack = decking + joist + beam;
    // flush stack = decking + max(joist, beam) = decking + beam
    // (given beam >= joist). Delta = joistDepth.
    expect(dropStackDepth - flushStackDepth).toBe(drop.joistDepthMm);
    // Explicit numeric pin: 2×8 joist = 184 mm.
    expect(dropStackDepth - flushStackDepth).toBe(184);
  });

  it('deckingTopY (walking surface) equal across drop & flush for identical footprint', () => {
    // The walking surface is a user-set invariant; drop/flush only
    // changes what happens BELOW it.
    const drop = computeYStack(makeElevated({ beamConnection: 'drop', ...UNEQUAL }));
    const flush = computeYStack(makeElevated({ beamConnection: 'flush', ...UNEQUAL }));
    expect(drop.deckingTopY).toBe(flush.deckingTopY);
  });

  it('deckingBottomY equal across drop & flush (decking rides joist top in both)', () => {
    const drop = computeYStack(makeElevated({ beamConnection: 'drop', ...UNEQUAL }));
    const flush = computeYStack(makeElevated({ beamConnection: 'flush', ...UNEQUAL }));
    expect(drop.deckingBottomY).toBe(flush.deckingBottomY);
  });

  it('joistCenterY equal across drop & flush (joist rides beneath decking in both)', () => {
    // Same joist depth + same decking bottom → same joist center.
    // Drop puts the BEAM below the joist; flush puts the BEAM
    // LEVEL with the joist. The joist itself does not move.
    const drop = computeYStack(makeElevated({ beamConnection: 'drop', ...UNEQUAL }));
    const flush = computeYStack(makeElevated({ beamConnection: 'flush', ...UNEQUAL }));
    expect(drop.joistCenterY).toBe(flush.joistCenterY);
  });

  it('beamCenterY differs: flush beam is HIGHER than drop beam by joistDepth', () => {
    const drop = computeYStack(makeElevated({ beamConnection: 'drop', ...UNEQUAL }));
    const flush = computeYStack(makeElevated({ beamConnection: 'flush', ...UNEQUAL }));
    // TRUE formula (Opus #2): the beam floats up by the joist
    // depth (its top now coincides with the joist top, i.e. the
    // decking bottom, rather than sitting UNDER the joist).
    expect(flush.beamCenterY - drop.beamCenterY).toBe(drop.joistDepthMm);
    // Sanity numeric pin: 2×8 joist = 184 mm.
    expect(flush.beamCenterY - drop.beamCenterY).toBe(184);
  });
});

// ---------------------------------------------------------------------------
// Regression pin — the drop layout numbers themselves have not
// drifted. A single hand-computed golden per key field. If the
// numeric formula ever changes for drop, this test fires FIRST
// (before the JSON goldens' larger blast radius).
// ---------------------------------------------------------------------------

describe('computeYStack — drop numeric regression pin (2×10 joist/beam, 5/4×6 decking, 3ft height)', () => {
  const dropStack = computeYStack(makeElevated({ beamConnection: 'drop' }));

  // heightMm = 3 * MM_PER_FOOT = 914.4 mm (footprint.heightMm).
  // 5/4x6 PT decking → actual widthMm=25 (thickness).
  // 2x10 PT joist   → actual heightMm=235 (depth on-edge).
  // 2x10 PT beam    → actual heightMm=235 (depth on-edge).

  it('deckingTopY === 914.4', () => {
    expect(dropStack.deckingTopY).toBeCloseTo(914.4, 5);
  });
  it('deckingBottomY === 889.4', () => {
    expect(dropStack.deckingBottomY).toBeCloseTo(914.4 - 25, 5);
  });
  it('joistBottomY === 654.4', () => {
    expect(dropStack.joistBottomY).toBeCloseTo(914.4 - 25 - 235, 5);
  });
  it('beamBottomY === 419.4', () => {
    expect(dropStack.beamBottomY).toBeCloseTo(914.4 - 25 - 235 - 235, 5);
  });
  it('postHeightMm === beamBottomY (post fills gap to ground)', () => {
    expect(dropStack.postHeightMm).toBe(dropStack.beamBottomY);
  });
});
