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
    // S25 pair-fix (QA G11): the LENGTH case was not previously
    // exercised — only width. The validator branches for lengthMm
    // are their own defensive check and MUST be covered
    // independently.
    const badLength = {
      footprintMm: { widthMm: 16 * MM_PER_FOOT, lengthMm: 0 as Mm },
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    };
    expect(() => computeBlockGrid(badLength)).toThrow(/lengthMm/i);
    // Negative lengthMm — same defensive branch.
    const negLength = {
      footprintMm: { widthMm: 16 * MM_PER_FOOT, lengthMm: -1 as Mm },
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    };
    expect(() => computeBlockGrid(negLength)).toThrow(/lengthMm/i);
  });
});

// ---------------------------------------------------------------------------
// S25 — foundation.blockRowsHint / .blockColsHint override the derived grid
//
// Ticket #47 AC3: "Given foundation.blockRowsHint = 5, When
// computeBlockGrid runs on a footprint that would otherwise derive 3
// rows, Then 5 rows are produced. Beams count matches (5 rows → 5
// beams for the width axis)."
//
// AC4: the hint is clamped to a safe range —
//   min = 2 (perimeter minimum)
//   max = floor(spanMm / MIN_BLOCK_SPACING_MM) + 1
// so a nonsense hint like 100 on a 12 ft deck does not spawn an
// absurd grid (12 ft = 3657.6 mm; MIN_BLOCK_SPACING_MM = 300 mm;
// max = floor(3657.6/300) + 1 = 13). AC4 is FLOOR-and-add-one so
// the max spacing between adjacent centers stays ≥ MIN_BLOCK_SPACING_MM
// (adjacent gap = spanMm / (count - 1)).
//
// The undefined-hint default behavior (S19 pre-S25 numbers) MUST
// stay byte-identical — see the "undefined hint" test below.
// ---------------------------------------------------------------------------

describe('computeBlockGrid — S25 foundation.blockRowsHint honored', () => {
  it('AC3 — blockRowsHint = 5 overrides the derived row count on a footprint that would derive 8 rows', () => {
    // Reference 16 ft × 14 ft with the AC10 defaults derives
    // 3 cols × 8 rows = 24 blocks (existing test). Setting the
    // hint to 5 must produce 3 × 5 = 15 blocks instead.
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    const foundation: Extract<
      FoundationSpec,
      { type: 'deck-blocks' | 'tuffblocks' }
    > = { ...TUFFBLOCK_FOUNDATION, blockRowsHint: 5 };
    const blocks = computeBlockGrid({
      footprintMm,
      foundation,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const uniqueZs = new Set(blocks.map((b) => b.position.z));
    expect(uniqueZs.size).toBe(5);
    // Cols unchanged (blockColsHint not set).
    const uniqueXs = new Set(blocks.map((b) => b.position.x));
    expect(uniqueXs.size).toBe(3);
    expect(blocks.length).toBe(3 * 5);
    // Outer rows still flush at ±lengthMm/2.
    expect(uniqueZs.has(-footprintMm.lengthMm / 2)).toBe(true);
    expect(uniqueZs.has(+footprintMm.lengthMm / 2)).toBe(true);
  });

  it('AC3 — blockRowsHint smaller than the derived count wins (2 rows on a 14 ft deck)', () => {
    // 14 ft length → derivation yields 8 rows. Hint = 2 → 2 rows.
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    const foundation: Extract<
      FoundationSpec,
      { type: 'deck-blocks' | 'tuffblocks' }
    > = { ...TUFFBLOCK_FOUNDATION, blockRowsHint: 2 };
    const blocks = computeBlockGrid({
      footprintMm,
      foundation,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const uniqueZs = new Set(blocks.map((b) => b.position.z));
    expect(uniqueZs.size).toBe(2);
    // Only two z anchors — the ±lengthMm/2 outer positions.
    expect([...uniqueZs].sort((a, b) => a - b)).toEqual([
      -footprintMm.lengthMm / 2,
      +footprintMm.lengthMm / 2,
    ]);
  });

  it('AC4 — hint below 2 is clamped to 2 (perimeter minimum)', () => {
    // 1 row is a degenerate grid (a single line of blocks under one
    // beam-line). Clamp to 2 — outer blocks flush at the edges.
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    for (const hint of [0, 1, -3]) {
      const foundation: Extract<
        FoundationSpec,
        { type: 'deck-blocks' | 'tuffblocks' }
      > = { ...TUFFBLOCK_FOUNDATION, blockRowsHint: hint };
      const blocks = computeBlockGrid({
        footprintMm,
        foundation,
        beamSpanMaxMm: BEAM_SPAN_MAX_MM,
        joistSpanMaxMm: JOIST_SPAN_MAX_MM,
      });
      const uniqueZs = new Set(blocks.map((b) => b.position.z));
      expect(uniqueZs.size).toBe(2);
    }
  });

  it('AC4 — hint above (floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1) is clamped', () => {
    // 12 ft length = 3657.6 mm; MIN_BLOCK_SPACING_MM = 300 mm;
    // max = floor(3657.6 / 300) + 1 = 12 + 1 = 13. Hint = 100 →
    // clamped to 13. Adjacent gap = 3657.6 / 12 = 304.8 mm ≥ 300 mm.
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 12 * MM_PER_FOOT };
    const foundation: Extract<
      FoundationSpec,
      { type: 'deck-blocks' | 'tuffblocks' }
    > = { ...TUFFBLOCK_FOUNDATION, blockRowsHint: 100 };
    const blocks = computeBlockGrid({
      footprintMm,
      foundation,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const uniqueZs = new Set(blocks.map((b) => b.position.z));
    expect(uniqueZs.size).toBe(13);
    // Adjacent gap check — the clamp is chosen so the gap stays ≥
    // MIN_BLOCK_SPACING_MM.
    const zSorted = [...uniqueZs].sort((a, b) => a - b);
    for (let i = 1; i < zSorted.length; i++) {
      expect(zSorted[i]! - zSorted[i - 1]!).toBeGreaterThanOrEqual(300 - 1e-6);
    }
  });

  it('undefined blockRowsHint preserves the pre-S25 derived count exactly (byte-stability)', () => {
    // The S19 fixtures + goldens rely on this — a foundation with
    // no hint field MUST match the pre-S25 derivation exactly.
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    const withoutHint = computeBlockGrid({
      footprintMm,
      foundation: TUFFBLOCK_FOUNDATION,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    // Existing "AC3 count formulas" test locks 3 × 8 = 24 for this
    // footprint. Re-assert here as a byte-stability guard.
    expect(withoutHint.length).toBe(24);
    // Explicit undefined must behave identically to omission.
    // `exactOptionalPropertyTypes: true` disallows `{...x:
    // undefined}` on a `readonly x?: number` slot at compile
    // time — we go through `unknown` for the intentional
    // "assert undefined is treated the same as missing" test.
    const withUndefined = computeBlockGrid({
      footprintMm,
      foundation: {
        ...TUFFBLOCK_FOUNDATION,
        ...({ blockRowsHint: undefined } as unknown as { blockRowsHint?: number }),
      },
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    expect(withUndefined).toEqual(withoutHint);
  });

  it('blockColsHint honored — 4 cols on a footprint that would derive 3', () => {
    // 16 ft width → derivation gives 3 cols. Hint = 4 → 4 cols.
    const footprintMm = { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT };
    const foundation: Extract<
      FoundationSpec,
      { type: 'deck-blocks' | 'tuffblocks' }
    > = { ...TUFFBLOCK_FOUNDATION, blockColsHint: 4 };
    const blocks = computeBlockGrid({
      footprintMm,
      foundation,
      beamSpanMaxMm: BEAM_SPAN_MAX_MM,
      joistSpanMaxMm: JOIST_SPAN_MAX_MM,
    });
    const uniqueXs = new Set(blocks.map((b) => b.position.x));
    expect(uniqueXs.size).toBe(4);
  });
});
