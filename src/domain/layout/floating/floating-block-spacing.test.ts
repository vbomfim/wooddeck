/**
 * `src/domain/layout/floating/floating-block-spacing.test.ts` —
 * feat/block-spacing — TDD RED for user-controllable Method B
 * block spacing.
 *
 * ## Regression target — the UAT bug ("too many blocks")
 *
 * Before this ticket Method B (`'joists-on-blocks'`) placed ONE
 * block per joist × N rows: a 16 ft × 16 ft deck at 16″ o.c. joist
 * spacing produced 13 joists × 8 rows = 104 blocks — and QA
 * reproduced ~150 on wider decks with the S25 blockRowsHint tuned
 * up. The user (a DIY homeowner) reported it as "adds too many
 * blocks; ask the distance between blocks."
 *
 * The fix: Method B now places a REGULAR GRID at pitch
 * `blockSpacingMm` (both axes), with the outer blocks anchored at
 * the footprint edges (same anchor formula `computeAxisCenters`
 * uses for Method A). Column count and row count both derive from
 * the SAME spacing: `count = round(span / spacing) + 1` (min 2),
 * so a 16 × 16 ft deck at the 1220 mm default produces
 * 5 cols × 5 rows = 25 blocks — 4× to 6× fewer than pre-fix.
 *
 * These tests PIN the invariants so the pre-fix ~150 model cannot
 * return: block count is small, block count is a function of
 * spacing (NOT joist count), and Method A / elevated layouts are
 * UNAFFECTED by the new field.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';

import { computeFloatingLayout, DEFAULT_METHOD_B_BLOCK_SPACING_MM, MAX_METHOD_B_BLOCK_COUNT } from './floating-layout';
import { MAX_BLOCK_SPACING_MM, MIN_BLOCK_SPACING_MM } from './block-grid';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
} as const satisfies FoundationSpec;

interface Overrides {
  widthFt?: number;
  lengthFt?: number;
  spacingMm?: Mm;
  blockSpacingMm?: Mm;
}

/**
 * Method B floating fixture at a comfortable height (500 mm >
 * the Method-B stack of joistDepth + deckingThickness).
 */
function makeMethodB(overrides: Overrides = {}): DeckDesign {
  const widthMm = (overrides.widthFt ?? 16) * MM_PER_FOOT;
  const lengthMm = (overrides.lengthFt ?? 16) * MM_PER_FOOT;
  const baseFoundation = TUFFBLOCK_FOUNDATION;
  const foundation: FoundationSpec =
    overrides.blockSpacingMm !== undefined
      ? { ...baseFoundation, blockSpacingMm: overrides.blockSpacingMm }
      : baseFoundation;
  return {
    id: '00000000-0000-4000-8000-0000000000b2',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: { widthMm, lengthMm, heightMm: 500 },
    structure: 'floating',
    floatingFraming: 'joists-on-blocks',
    beamConnection: 'drop',
    foundation,
    joist: { material: PT_2X8, spacingMm: overrides.spacingMm ?? 406 },
    beam: { material: PT_2X8 },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

// ---------------------------------------------------------------------------
// The core regression pin — the "16×16 ~150 blocks" bug is dead
// ---------------------------------------------------------------------------

describe('Method B block grid — count is DERIVED FROM SPACING, not from joist count', () => {
  it('16 × 16 ft deck @ default spacing produces a SMALL block grid (≤ 36), NOT the pre-fix ~150', () => {
    // Pre-fix: 16 ft @ 16″ oc joists = 13 joists × ~8 rows = ~104
    // blocks (or ~150 with a wider blockRowsHint). Post-fix at
    // the 1220 mm default: ~5 cols × ~5 rows = 25 blocks.
    const design = makeMethodB({ widthFt: 16, lengthFt: 16 });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeLessThanOrEqual(36);
    // Also PIN a specific, testable count: a 16 × 16 ft footprint
    // = 4877 × 4877 mm. count = round(4877 / 1220) + 1 = 5 per
    // axis → 25 total blocks.
    expect(blocks.length).toBe(25);
  });

  it('block count is INDEPENDENT of joist spacing (13 joists vs 33 joists → same block grid)', () => {
    // Change joist spacing 16″ → 6″ (33 joists on a 16 ft deck).
    // Pre-fix: cols scaled with joist count. Post-fix: cols
    // depend only on blockSpacingMm — must stay identical.
    const wide = makeMethodB({ widthFt: 16, lengthFt: 16, spacingMm: 406 });
    const tight = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      spacingMm: 152, // 6"
    });
    const nWide = computeFloatingLayout(wide).members.filter(
      (m) => m.kind === 'block',
    ).length;
    const nTight = computeFloatingLayout(tight).members.filter(
      (m) => m.kind === 'block',
    ).length;
    // Joist count DID change:
    const jWide = computeFloatingLayout(wide).members.filter(
      (m) => m.kind === 'joist',
    ).length;
    const jTight = computeFloatingLayout(tight).members.filter(
      (m) => m.kind === 'joist',
    ).length;
    expect(jTight).toBeGreaterThan(jWide);
    // Block count did NOT:
    expect(nTight).toBe(nWide);
  });

  it('a smaller blockSpacingMm produces MORE blocks (denser grid)', () => {
    const coarse = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1800,
    });
    const fine = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 600,
    });
    const nCoarse = computeFloatingLayout(coarse).members.filter(
      (m) => m.kind === 'block',
    ).length;
    const nFine = computeFloatingLayout(fine).members.filter(
      (m) => m.kind === 'block',
    ).length;
    expect(nFine).toBeGreaterThan(nCoarse);
  });

  it('a larger blockSpacingMm produces FEWER blocks (sparser grid, floor at 2 × 2 = 4)', () => {
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      // 2438 mm → 16 ft / 2438 = 2.0 → count = round(2.0) + 1 = 3.
      // Slightly wider: 4000 mm → 16 ft / 4000 = 1.22 → 2 per axis.
      blockSpacingMm: MAX_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // Sparse grid still respects the perimeter-two minimum:
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    // And it's dramatically smaller than pre-fix:
    expect(blocks.length).toBeLessThanOrEqual(16);
  });
});

// ---------------------------------------------------------------------------
// Placement invariants — the grid is a REGULAR grid
// ---------------------------------------------------------------------------

describe('Method B block grid — placement invariants', () => {
  it('outer blocks are anchored at the footprint edges (±widthMm/2, ±lengthMm/2)', () => {
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const halfWidth = design.footprint.widthMm / 2;
    const halfLength = design.footprint.lengthMm / 2;
    const xs = Array.from(new Set(blocks.map((b) => b.position.x))).sort(
      (a, b) => a - b,
    );
    const zs = Array.from(new Set(blocks.map((b) => b.position.z))).sort(
      (a, b) => a - b,
    );
    expect(xs[0]).toBeCloseTo(-halfWidth, 6);
    expect(xs[xs.length - 1]).toBeCloseTo(+halfWidth, 6);
    expect(zs[0]).toBeCloseTo(-halfLength, 6);
    expect(zs[zs.length - 1]).toBeCloseTo(+halfLength, 6);
  });

  it('the grid is REGULAR (all blocks lie at cartesian product of the unique x and z sets)', () => {
    const design = makeMethodB({
      widthFt: 20,
      lengthFt: 12,
      blockSpacingMm: 1220,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const xs = new Set(blocks.map((b) => b.position.x));
    const zs = new Set(blocks.map((b) => b.position.z));
    // block count === (unique x count) × (unique z count) — the
    // hallmark of a regular grid (no missing / extra cells).
    expect(blocks.length).toBe(xs.size * zs.size);
  });

  it('adjacent-block gap (both axes) is ≤ the effective blockSpacingMm', () => {
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const xs = Array.from(new Set(blocks.map((b) => b.position.x))).sort(
      (a, b) => a - b,
    );
    const zs = Array.from(new Set(blocks.map((b) => b.position.z))).sort(
      (a, b) => a - b,
    );
    // Gap between two adjacent xs (or zs) is `span / (count-1)`.
    // With `count = round(span / spacing) + 1` (ceil-flavoured),
    // that gap is ≤ spacing (the anchor formula guarantees it).
    // Small epsilon for float division.
    const epsilonMm = 1e-6;
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(1220 + epsilonMm);
    }
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]! - zs[i - 1]!).toBeLessThanOrEqual(1220 + epsilonMm);
    }
  });
});

// ---------------------------------------------------------------------------
// Clamp + cap — bounds and safety
// ---------------------------------------------------------------------------

describe('Method B block grid — clamp + cap defensive bounds', () => {
  it('blockSpacingMm below MIN_BLOCK_SPACING_MM is clamped up (grid stays sensible)', () => {
    const design = makeMethodB({
      widthFt: 8,
      lengthFt: 8,
      blockSpacingMm: 50, // well below MIN=300
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // Without a clamp: 8 ft / 50 mm ≈ 49 → 50×50 = 2500 blocks.
    // With clamp to 300 mm: 8 ft / 300 ≈ 8 → 9×9 = 81 blocks.
    // And within the hard cap regardless.
    expect(blocks.length).toBeLessThanOrEqual(MAX_METHOD_B_BLOCK_COUNT);
    expect(blocks.length).toBeLessThan(200);
  });

  it('blockSpacingMm above MAX_BLOCK_SPACING_MM is clamped down (grid keeps ≥ perimeter-two)', () => {
    const design = makeMethodB({
      widthFt: 8,
      lengthFt: 8,
      blockSpacingMm: 100000, // absurd
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // Perimeter-two minimum: 2 × 2 = 4 blocks.
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  it('total block count NEVER exceeds MAX_METHOD_B_BLOCK_COUNT (hard cap)', () => {
    // Pathological input: tiny spacing on a large deck. Even after
    // clamping spacingMm up to MIN=300, on a 40×40 ft deck that
    // yields ~41×41 = ~1681 blocks — MUST be capped.
    const design = makeMethodB({
      widthFt: 40,
      lengthFt: 40,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeLessThanOrEqual(MAX_METHOD_B_BLOCK_COUNT);
  });

  it('non-finite blockSpacingMm (NaN / Infinity) falls back to the default', () => {
    // NaN → default; Infinity → default. Both must produce a
    // sensible grid, not throw and not explode.
    const dNaN = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: Number.NaN,
    });
    const dInf = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: Number.POSITIVE_INFINITY,
    });
    const dDefault = makeMethodB({ widthFt: 16, lengthFt: 16 });
    const nNaN = computeFloatingLayout(dNaN).members.filter(
      (m) => m.kind === 'block',
    ).length;
    const nInf = computeFloatingLayout(dInf).members.filter(
      (m) => m.kind === 'block',
    ).length;
    const nDefault = computeFloatingLayout(dDefault).members.filter(
      (m) => m.kind === 'block',
    ).length;
    expect(nNaN).toBe(nDefault);
    expect(nInf).toBe(nDefault);
  });
});

// ---------------------------------------------------------------------------
// Default value — Method B without user input
// ---------------------------------------------------------------------------

describe('Method B block grid — default when foundation.blockSpacingMm is absent', () => {
  it('DEFAULT_METHOD_B_BLOCK_SPACING_MM is the ground-level 1220 mm (4 ft) default', () => {
    expect(DEFAULT_METHOD_B_BLOCK_SPACING_MM).toBe(1220);
  });

  it('absent field ≡ presenting the default value explicitly (same block grid)', () => {
    const dAbsent = makeMethodB({ widthFt: 12, lengthFt: 14 });
    const dExplicit = makeMethodB({
      widthFt: 12,
      lengthFt: 14,
      blockSpacingMm: DEFAULT_METHOD_B_BLOCK_SPACING_MM,
    });
    const bAbsent = computeFloatingLayout(dAbsent).members.filter(
      (m) => m.kind === 'block',
    );
    const bExplicit = computeFloatingLayout(dExplicit).members.filter(
      (m) => m.kind === 'block',
    );
    expect(bAbsent.length).toBe(bExplicit.length);
    // Positions match block-for-block (same grid).
    const posA = bAbsent
      .map((b) => `${b.position.x.toFixed(3)},${b.position.z.toFixed(3)}`)
      .sort();
    const posB = bExplicit
      .map((b) => `${b.position.x.toFixed(3)},${b.position.z.toFixed(3)}`)
      .sort();
    expect(posA).toEqual(posB);
  });
});

// ---------------------------------------------------------------------------
// Regression: Method A and elevated are UNAFFECTED by blockSpacingMm
// ---------------------------------------------------------------------------

describe('feat/block-spacing — blockSpacingMm ONLY affects Method B', () => {
  it('Method A (beams-and-joists) block count is UNCHANGED when blockSpacingMm is set', () => {
    // Method A pins block rows to the two rim beams and derives
    // columns from BLOCK_COL_MAX_SPACING_MM — blockSpacingMm has
    // NO seam in Method A. The block count MUST be identical.
    const baseFoundation: FoundationSpec = TUFFBLOCK_FOUNDATION;
    const withSpacingFoundation: FoundationSpec = {
      ...baseFoundation,
      blockSpacingMm: 600,
    };
    const baseA: DeckDesign = {
      id: '00000000-0000-4000-8000-0000000000a1',
      createdAt: '2026-07-04T00:00:00.000Z',
      footprint: {
        widthMm: 16 * MM_PER_FOOT,
        lengthMm: 14 * MM_PER_FOOT,
        heightMm: 600,
      },
      structure: 'floating',
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
      foundation: baseFoundation,
      joist: { material: PT_2X8, spacingMm: 406 },
      beam: { material: PT_2X8 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    };
    const withSpacing: DeckDesign = { ...baseA, foundation: withSpacingFoundation };
    const layoutBase = computeFloatingLayout(baseA);
    const layoutWith = computeFloatingLayout(withSpacing);
    // Byte-identical member arrays (member id + kind + position).
    const summarize = (l: typeof layoutBase): string =>
      JSON.stringify(
        l.members.map((m) => ({
          id: m.id,
          kind: m.kind,
          x: m.position.x,
          y: m.position.y,
          z: m.position.z,
        })),
      );
    expect(summarize(layoutBase)).toBe(summarize(layoutWith));
  });
});
