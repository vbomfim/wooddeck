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
import {
  LayoutError,
  MAX_DECK_DIMENSION_MM,
  MIN_DECK_DIMENSION_MM,
} from '../layout-shared';

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
  blockRowsHint?: number;
}

/**
 * Method B floating fixture at a comfortable height (500 mm >
 * the Method-B stack of joistDepth + deckingThickness).
 */
function makeMethodB(overrides: Overrides = {}): DeckDesign {
  const widthMm = (overrides.widthFt ?? 16) * MM_PER_FOOT;
  const lengthMm = (overrides.lengthFt ?? 16) * MM_PER_FOOT;
  let foundation: FoundationSpec = TUFFBLOCK_FOUNDATION;
  if (overrides.blockSpacingMm !== undefined) {
    foundation = { ...foundation, blockSpacingMm: overrides.blockSpacingMm };
  }
  if (overrides.blockRowsHint !== undefined) {
    foundation = { ...foundation, blockRowsHint: overrides.blockRowsHint };
  }
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
    // LOW cleanup (Opus #9, feat/block-spacing review): round to
    // a mm-resolution key before Set-dedup. Raw float positions
    // can carry sub-mm drift from arithmetic — a naive `new Set()`
    // would spuriously classify two "identical" positions as
    // distinct, breaking the regularity assertion.
    const roundToMm = (v: number): number => Math.round(v * 1e3) / 1e3;
    const xs = new Set(blocks.map((b) => roundToMm(b.position.x)));
    const zs = new Set(blocks.map((b) => roundToMm(b.position.z)));
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

  it('HIGH #1 (review) — huge SCHEMA-LEGAL footprint at MIN spacing still respects the cap (100 × 100 ft)', () => {
    // Pre-fix (iterative decrement loop with MAX_CAP_ITER=200): a
    // 100 × 100 ft (30480 mm) deck at MIN_BLOCK_SPACING_MM=300
    // derives ~102 × 102 = 10404 blocks; the O(N) shrink loop
    // bails at 200 iterations having decremented cols+rows by 200
    // → ends around 6100 blocks, VIOLATING the cap. The
    // closed-form derivation (feat/block-spacing HIGH #1) picks
    // an effective spacing floor so the cap holds by construction
    // for EVERY schema-legal footprint.
    const design = makeMethodB({
      widthFt: 100, // MAX_DECK_DIMENSION_MM in ft
      lengthFt: 100,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeLessThanOrEqual(MAX_METHOD_B_BLOCK_COUNT);
    // Grid must remain sensible — perimeter-two floor preserved.
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  it('HIGH #1 (review) — a NON-SQUARE huge footprint keeps ≥2 per axis under the cap (12 × 100 ft)', () => {
    // 12 × 100 ft at MIN spacing wants ~5 × 102 = 510 blocks. The
    // closed-form must keep BOTH axes ≥ 2 (a degenerate 1 × N or
    // N × 1 grid would leave joists cantilevering off blocks).
    const design = makeMethodB({
      widthFt: 12,
      lengthFt: 100,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeLessThanOrEqual(MAX_METHOD_B_BLOCK_COUNT);
    const xs = new Set(blocks.map((b) => b.position.x));
    const zs = new Set(blocks.map((b) => b.position.z));
    expect(xs.size).toBeGreaterThanOrEqual(2);
    expect(zs.size).toBeGreaterThanOrEqual(2);
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

  // ---------------------------------------------------------------
  // SHOULD-FIX (QA MED#4): zero / negative blockSpacingMm clamps
  // to MIN — the layout NEVER throws on adversarial input. Pins
  // the trust-boundary guarantee at the top of resolveMethodBGrid.
  // ---------------------------------------------------------------
  it('SHOULD-FIX — zero blockSpacingMm clamps to MIN (grid stays sensible, no throw)', () => {
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 0,
    });
    // Compute must NOT throw; must produce ≥ 4 blocks (2×2 floor).
    expect(() => computeFloatingLayout(design)).not.toThrow();
    const blocks = computeFloatingLayout(design).members.filter(
      (m) => m.kind === 'block',
    );
    expect(blocks.length).toBeGreaterThanOrEqual(4);
  });

  it('SHOULD-FIX — negative blockSpacingMm (-1, -1000) clamps to MIN (equivalent grid, no throw)', () => {
    for (const bad of [-1, -1000]) {
      const design = makeMethodB({
        widthFt: 16,
        lengthFt: 16,
        blockSpacingMm: bad,
      });
      expect(() => computeFloatingLayout(design)).not.toThrow();
      const blocks = computeFloatingLayout(design).members.filter(
        (m) => m.kind === 'block',
      );
      // Same clamped behavior for every negative — hits MIN_BLOCK_SPACING_MM.
      expect(blocks.length).toBeGreaterThanOrEqual(4);
      // ≤ MAX_METHOD_B_BLOCK_COUNT (cap still holds).
      expect(blocks.length).toBeLessThanOrEqual(400);
    }
  });

  // ---------------------------------------------------------------
  // SHOULD-FIX (QA MED#3, review): PRECEDENCE — when BOTH
  // `blockSpacingMm` and the legacy `blockRowsHint` are set,
  // spacing wins (the resolver's PRIMARY path). Pins the ticket's
  // "blockSpacingMm > legacy hints" contract at the layout seam.
  // ---------------------------------------------------------------
  it('SHOULD-FIX — precedence: BOTH blockSpacingMm and blockRowsHint set → blockSpacingMm controls the grid', () => {
    // Design A: blockSpacingMm=1220, blockRowsHint=10 (a bogus
    // large hint the resolver MUST ignore).
    const dBoth = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
      blockRowsHint: 10,
    });
    // Design B: blockSpacingMm=1220 alone.
    const dSpacingOnly = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
    });
    const nBoth = computeFloatingLayout(dBoth).members.filter(
      (m) => m.kind === 'block',
    ).length;
    const nSpacingOnly = computeFloatingLayout(dSpacingOnly).members.filter(
      (m) => m.kind === 'block',
    ).length;
    // Precedence: adding the hint MUST NOT change the grid.
    expect(nBoth).toBe(nSpacingOnly);
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

// ---------------------------------------------------------------------------
// Review-gate follow-up (2026-07-05) — schema-legal fractional footprints
// must not crash on femtometre float drift from `computeAxisCenters`
// ---------------------------------------------------------------------------

describe('Method B float-drift regression — schema-legal fractional footprints must not throw', () => {
  it('reviewer repro (widthMm=10757.7662929877, lengthMm=10205.753894382558, blockSpacingMm=MIN) does not throw', () => {
    // Before the validator-tolerance fix, this footprint drove
    // `computeAxisCenters(10205.753894382558, 19)` — the post-cap
    // row count — to accumulate `-span/2 + (count-1)*step` to
    // 5102.876947191281 while `span/2 = 5102.876947191279`
    // (delta ≈ 1.82e-12 mm — a femtometre from `step * (count-1)`
    // vs `span` due to IEEE-754 rounding). `validateExplicitCenters`
    // rejected it with strict bounds → `LayoutError:
    // explicitRowZCenters[..] out of range`.
    const design = makeMethodB({
      widthFt: 10757.7662929877 / MM_PER_FOOT,
      lengthFt: 10205.753894382558 / MM_PER_FOOT,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    expect(() => computeFloatingLayout(design)).not.toThrow();
  });

  it('parametrized property — a spread of fractional schema-legal Method-B footprints at MIN spacing never throws', () => {
    // Deterministic pseudo-random cover of the fractional
    // width/length space. Every draw must be ≥ MIN_DECK_DIMENSION_MM
    // and ≤ MAX_DECK_DIMENSION_MM (schema-legal). At
    // MIN_BLOCK_SPACING_MM the closed-form cap engages for every
    // draw > ~4877 mm × ~4877 mm — exercising the post-cap
    // `computeAxisCenters` call that produced the drift.
    // Linear congruential PRNG (deterministic, no fast-check dep):
    let state = 0x1a2b3c4d;
    const rand = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const range = MAX_DECK_DIMENSION_MM - MIN_DECK_DIMENSION_MM;
    for (let i = 0; i < 48; i += 1) {
      const widthMm = MIN_DECK_DIMENSION_MM + rand() * range;
      const lengthMm = MIN_DECK_DIMENSION_MM + rand() * range;
      const design = makeMethodB({
        widthFt: widthMm / MM_PER_FOOT,
        lengthFt: lengthMm / MM_PER_FOOT,
        blockSpacingMm: MIN_BLOCK_SPACING_MM,
      });
      expect(
        () => computeFloatingLayout(design),
        `widthMm=${widthMm} lengthMm=${lengthMm}`,
      ).not.toThrow();
    }
  });

  it('float-drift is TOLERATED but a genuinely out-of-range explicit center is still REJECTED', () => {
    // The tolerance fix relaxes the bounds by EPS_MM (1e-6 mm), NOT by
    // a large slop. A center a MILLIMETRE outside the footprint half-
    // extent MUST still throw — that is a real callsite bug, not
    // float drift. Confirmed via a Method-A design whose S26 defensive
    // `explicitRowZCenters` check would fire on a truly rogue value.
    // (We can't easily inject an out-of-range center via the public
    // `computeFloatingLayout` API — those overrides are internal —
    // so this test lives in `block-grid.test.ts` as an invariant on
    // `computeBlockGrid` itself; here we just document the boundary
    // via a positive case: the reviewer repro is < 1e-11 mm outside
    // the bound and passes.)
    const design = makeMethodB({
      widthFt: 10757.7662929877 / MM_PER_FOOT,
      lengthFt: 10205.753894382558 / MM_PER_FOOT,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    // Sanity — the layout does produce blocks (grid non-empty).
    const blocks = computeFloatingLayout(design).members.filter(
      (m) => m.kind === 'block',
    );
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.length).toBeLessThanOrEqual(MAX_METHOD_B_BLOCK_COUNT);
  });
});

// ---------------------------------------------------------------------------
// Review-gate follow-up (2026-07-05) — floating validation must mirror the
// footprint MAX cap now enforced by the elevated `validateDesign`
// ---------------------------------------------------------------------------

describe('validateFloatingDesign mirrors MAX_DECK_DIMENSION_MM (defense-in-depth)', () => {
  it('floating design with widthMm > MAX_DECK_DIMENSION_MM throws LayoutError', () => {
    const design = makeMethodB({
      widthFt: MAX_DECK_DIMENSION_MM / MM_PER_FOOT + 1, // 1 ft over max
      lengthFt: 16,
    });
    expect(() => computeFloatingLayout(design)).toThrow(LayoutError);
    expect(() => computeFloatingLayout(design)).toThrow(/exceeds the maximum/i);
  });

  it('floating design with lengthMm > MAX_DECK_DIMENSION_MM throws LayoutError', () => {
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: MAX_DECK_DIMENSION_MM / MM_PER_FOOT + 1,
    });
    expect(() => computeFloatingLayout(design)).toThrow(LayoutError);
    expect(() => computeFloatingLayout(design)).toThrow(/exceeds the maximum/i);
  });

  it('floating design at exactly MAX_DECK_DIMENSION_MM is ACCEPTED (boundary)', () => {
    const design = makeMethodB({
      widthFt: MAX_DECK_DIMENSION_MM / MM_PER_FOOT,
      lengthFt: MAX_DECK_DIMENSION_MM / MM_PER_FOOT,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    expect(() => computeFloatingLayout(design)).not.toThrow();
  });
});
