/**
 * `src/domain/layout/floating/block-grid.test.ts` — TDD RED phase for
 * the floating block grid (S19, AC3 + AC4).
 *
 * ## What the grid is
 *
 * `computeBlockGrid` returns a flat `LayoutMember[]` where every
 * member has `kind: 'block'` and a `{kind:'block', productId}`
 * material stamp (see `MemberMaterialRef` in `model.ts`). Blocks are
 * arranged in a 2-D grid in the +x / +z plane:
 *
 *   - N COLUMNS along +x (deck WIDTH axis) — one column per beam
 *     the beam-layout will produce. Column count is bounded by the
 *     caller-supplied `beamSpanMaxMm` per AC3:
 *
 *         numCols = ceil(widthMm / beamSpanMaxMm) + 1
 *
 *   - M ROWS along +z (deck LENGTH axis) — supports under each
 *     beam. Row count is bounded by the caller-supplied
 *     `joistSpanMaxMm` per AC3:
 *
 *         numRows = ceil(lengthMm / joistSpanMaxMm) + 1
 *
 * Total block count = numCols × numRows.
 *
 * ## AC4 placement invariant
 *
 * Outermost block CENTERS sit at:
 *
 *   - x = ±widthMm/2         (flush at the deck's x-edges — column 0
 *                             and column numCols−1)
 *   - z = ±lengthMm/2        (flush at the deck's z-edges — row 0
 *                             and row numRows−1)
 *
 * Interior columns/rows are evenly spaced between the outer anchors.
 * This is the "outer blocks are directly under the rim beams"
 * requirement of AC4. Blocks do NOT extend outside the footprint
 * horizontally.
 *
 * ## Y-placement
 *
 * Every block sits on grade: `position.y = -block.actual.heightMm / 2`
 * (block TOP at y=0, block BOTTOM at y=-heightMm). See
 * `y-stack-floating.ts` module header for the full vertical stack.
 *
 * ## Stable ids
 *
 * `block-r{row}-c{col}` — row-major, 0-indexed. Ids are stable across
 * re-layouts for identical inputs so warning + reconciliation state
 * stays keyed correctly.
 */
import { describe, expect, it } from 'vitest';

import { lookupFoundationProduct } from '../../foundation-catalog';
import type { FoundationSpec } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';

import { computeBlockGrid } from './block-grid';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TUFFBLOCK_FOUNDATION: Extract<
  FoundationSpec,
  { type: 'deck-blocks' | 'tuffblocks' }
> = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};

const OLDCASTLE_FOUNDATION: Extract<
  FoundationSpec,
  { type: 'deck-blocks' | 'tuffblocks' }
> = {
  type: 'deck-blocks',
  product: { productId: 'oldcastle-11x11x7' },
};

// Reuse the elevated MAX_BEAM_SPAN_MM (2438.4) as the beam-column
// spacing so AC10's 3-beam count for 16-ft-wide deck is reproducible.
const BEAM_SPAN_MAX_MM: Mm = 8 * MM_PER_FOOT; // 2438.4 mm
// A conservative 24" o.c. block-under-beam spacing default matches the
// DIY residential-carpentry norm. Documented as an autonomous decision.
const JOIST_SPAN_MAX_MM: Mm = 610;

// ---------------------------------------------------------------------------
// AC3 — count formulas
// ---------------------------------------------------------------------------

describe('computeBlockGrid — AC3 count formulas', () => {
  it('16 ft × 12 ft with beamSpanMax=8ft, joistSpanMax=610 → 3 cols × 7 rows = 21 blocks', () => {
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 12 * MM_PER_FOOT };
    // width  4876.8 / 2438.4 = 2.0000 → ceil=2 → +1 = 3 cols
    // length 3657.6 / 610    = 5.9960 → ceil=6 → +1 = 7 rows
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    expect(blocks.length).toBe(3 * 7);
    const uniqueXs = new Set(blocks.map((b) => b.position.x));
    const uniqueZs = new Set(blocks.map((b) => b.position.z));
    expect(uniqueXs.size).toBe(3);
    expect(uniqueZs.size).toBe(7);
  });

  it('16 ft × 14 ft (the user example) with the AC10 defaults → 3 cols × 8 rows = 24 blocks', () => {
    // AC10: block count within [24, 30]. This test locks the exact
    // count for the reference config so a future formula tweak that
    // drifts outside [24, 30] fails loudly here.
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    // width  4876.8 / 2438.4 = 2.0000 → ceil=2 → +1 = 3 cols
    // length 4267.2 / 610    = 6.9954 → ceil=7 → +1 = 8 rows
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    expect(blocks.length).toBe(3 * 8);
    expect(blocks.length).toBeGreaterThanOrEqual(24);
    expect(blocks.length).toBeLessThanOrEqual(30);
  });

  it('very small 4 ft × 4 ft → 2 cols × 2 rows = 4 blocks (minimum grid)', () => {
    // width  1219.2 / 2438.4 = 0.5 → ceil=1 → +1 = 2 cols
    // length 1219.2 / 610    = 1.9987 → ceil=2 → +1 = 3 rows
    const footprintMm = { widthMm: 4 * MM_PER_FOOT, lengthMm: 4 * MM_PER_FOOT };
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    expect(blocks.length).toBe(2 * 3);
  });
});

// ---------------------------------------------------------------------------
// AC4 — outer blocks flush at footprint edges, interior evenly spaced
// ---------------------------------------------------------------------------

describe('computeBlockGrid — AC4 placement invariants', () => {
  it('outer block centers are at ±widthMm/2 (x-flush) and ±lengthMm/2 (z-flush)', () => {
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const xs = new Set(blocks.map((b) => b.position.x));
    const zs = new Set(blocks.map((b) => b.position.z));
    expect(xs).toContain(-footprintMm.widthMm / 2);
    expect(xs).toContain(+footprintMm.widthMm / 2);
    expect(zs).toContain(-footprintMm.lengthMm / 2);
    expect(zs).toContain(+footprintMm.lengthMm / 2);
  });

  it('interior x-positions are evenly spaced between the outer anchors', () => {
    const footprintMm = { widthMm: 20 * MM_PER_FOOT, lengthMm: 20 * MM_PER_FOOT };
    // width 6096 / 2438.4 = 2.5 → ceil=3 → +1 = 4 cols; centers at
    // -3048, -1016, +1016, +3048 (evenly spaced by 2032).
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const uniqueXs = [...new Set(blocks.map((b) => b.position.x))].sort(
      (a, b) => a - b,
    );
    expect(uniqueXs.length).toBe(4);
    const spacings = uniqueXs
      .slice(1)
      .map((x, i) => x - uniqueXs[i]!);
    // Every gap identical (within float epsilon).
    for (const s of spacings) {
      expect(s).toBeCloseTo(spacings[0]!, 5);
    }
  });

  it('every block position stays inside the footprint (|x| ≤ widthMm/2, |z| ≤ lengthMm/2)', () => {
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    for (const b of blocks) {
      expect(Math.abs(b.position.x)).toBeLessThanOrEqual(footprintMm.widthMm / 2);
      expect(Math.abs(b.position.z)).toBeLessThanOrEqual(footprintMm.lengthMm / 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Member shape — material stamp, y position, size, rotation
// ---------------------------------------------------------------------------

describe('computeBlockGrid — LayoutMember shape', () => {
  const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };

  it('every block has kind="block" and a {kind:"block",productId} material', () => {
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    for (const b of blocks) {
      expect(b.kind).toBe('block');
      expect(b.material.kind).toBe('block');
      if (b.material.kind === 'block') {
        expect(b.material.productId).toBe('tuffblock-12x12x4');
      }
    }
  });

  it('block size mirrors the catalog product actual dimensions (TuffBlock: 305 x 102 x 305)', () => {
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const product = lookupFoundationProduct('tuffblock-12x12x4');
    for (const b of blocks) {
      expect(b.size.x).toBe(product.actual.widthMm);
      expect(b.size.y).toBe(product.actual.heightMm);
      expect(b.size.z).toBe(product.actual.depthMm);
    }
  });

  it('block y-position sits on grade: y = -product.heightMm / 2 (block TOP at y=0)', () => {
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const product = lookupFoundationProduct('tuffblock-12x12x4');
    const expectedY = -product.actual.heightMm / 2;
    for (const b of blocks) {
      expect(b.position.y).toBe(expectedY);
    }
  });

  it('every block has all-zero rotation (axis-aligned)', () => {
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    for (const b of blocks) {
      expect(b.rotation).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('ids are stable, unique, and use the block-r{row}-c{col} pattern', () => {
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^block-r\d+-c\d+$/);
    }
    // Same input yields byte-equal ids (determinism)
    const again = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    expect(again.map((b) => b.id)).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// Foundation product switch — Oldcastle vs TuffBlock
// ---------------------------------------------------------------------------

describe('computeBlockGrid — foundation product switch', () => {
  it('Oldcastle foundation stamps productId="oldcastle-11x11x7" and uses its actual dims', () => {
    const footprintMm = { widthMm: 10 * MM_PER_FOOT, lengthMm: 10 * MM_PER_FOOT };
    const blocks = computeBlockGrid({
      footprintMm,
      foundation: OLDCASTLE_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    for (const b of blocks) {
      expect(b.material.kind).toBe('block');
      if (b.material.kind === 'block') {
        expect(b.material.productId).toBe('oldcastle-11x11x7');
      }
      expect(b.size.x).toBe(product.actual.widthMm);
      expect(b.size.y).toBe(product.actual.heightMm);
      expect(b.size.z).toBe(product.actual.depthMm);
      expect(b.position.y).toBe(-product.actual.heightMm / 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Trust boundary — reject invalid inputs (span-max ≤ 0, degenerate footprint)
// ---------------------------------------------------------------------------

describe('computeBlockGrid — trust-boundary defensive checks', () => {
  it('throws when beamSpanMaxMm ≤ 0 (would divide-by-zero or infinite loop)', () => {
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    expect(() =>
      computeBlockGrid({
        footprintMm,
        foundation: TUFFBLOCK_FOUNDATION,
        beamSpanMaxMm: 0,
        joistSpanMaxMm: JOIST_SPAN_MAX_MM,
      }),
    ).toThrow(/beamSpanMaxMm/i);
    expect(() =>
      computeBlockGrid({
        footprintMm,
        foundation: TUFFBLOCK_FOUNDATION,
        beamSpanMaxMm: -1,
        joistSpanMaxMm: JOIST_SPAN_MAX_MM,
      }),
    ).toThrow(/beamSpanMaxMm/i);
  });

  it('throws when joistSpanMaxMm ≤ 0', () => {
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    expect(() =>
      computeBlockGrid({
        footprintMm,
        foundation: TUFFBLOCK_FOUNDATION,
        beamSpanMaxMm: BEAM_SPAN_MAX_MM,
        joistSpanMaxMm: 0,
      }),
    ).toThrow(/joistSpanMaxMm/i);
  });

  it('throws when widthMm or lengthMm is ≤ 0', () => {
    const badWidth = {
      footprintMm: { widthMm: 0 as Mm, lengthMm: 14 * MM_PER_FOOT },
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    };
    expect(() => computeBlockGrid(badWidth)).toThrow(/widthMm|lengthMm/i);
  });
});
