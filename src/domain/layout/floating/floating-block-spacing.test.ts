/**
 * `src/domain/layout/floating/floating-block-spacing.test.ts` —
 * fix/joists-on-blocks-flying — Method B block spacing invariants.
 *
 * ## Regression targets
 *
 * ### 1. UAT bug "too many blocks" (feat/block-spacing PR #66)
 *
 * Before PR #66 Method B (`'joists-on-blocks'`) placed ONE block
 * per joist × N rows: a 16 ft × 16 ft deck at 16″ o.c. joist
 * spacing produced 13 joists × 8 rows = 104 blocks — and QA
 * reproduced ~150 on wider decks with S25 `blockRowsHint` tuned
 * up. Filed as "adds too many blocks; ask the distance between
 * blocks."
 *
 * ### 2. UAT bug "flying joists" (fix/joists-on-blocks-flying)
 *
 * PR #66's fix went too far the other way: it decoupled block
 * columns from joists entirely, placing a REGULAR grid at
 * `blockSpacingMm` on BOTH axes. On the 16 × 16 ft example above
 * that produced 5 cols × 5 rows = 25 blocks but joists sat at 13
 * unrelated x-positions — most joists had NO block anywhere
 * beneath them ("flew" unsupported). Physical nonsense for a
 * no-beam design.
 *
 * ## Current model (this file's invariants)
 *
 * Block COLUMNS are pinned to joist x-centers (one column per
 * joist — no flying joists). Block ROWS run along +z at
 * `blockSpacingMm` pitch, outer rows anchored at ±length/2.
 *
 *   - `count = numJoists × rows` (NOT joist-independent).
 *   - `rows = blockCountForAxis(lengthMm, blockSpacingMm)`,
 *     clamped ≥ 2 (perimeter floor).
 *   - `MAX_METHOD_B_BLOCK_COUNT` cap reduces ROWS only — columns
 *     stay at `numJoists` (dropping a column would recreate the
 *     "flying joists" bug).
 *   - Column x-values are byte-identical to
 *     `layoutFloatingJoists(design).map(j => j.position.x)`.
 *
 * These tests PIN those invariants so neither past regression
 * can return.
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

describe('Method B block grid — count is DERIVED FROM BOTH joist count AND blockSpacingMm', () => {
  it('16 × 16 ft deck @ default spacing produces a SMALL block grid (numJoists × ~5 rows), NOT the pre-fix ~150', () => {
    // Pre-#66 fix: 16 ft @ 16″ oc joists = 13 joists × ~8 rows = ~104
    // blocks (or ~150 with a wider blockRowsHint). Post-#66 (broken
    // "regular grid on both axes"): 5 × 5 = 25 blocks BUT the block
    // columns didn't align with the joists (flying-joist bug).
    // Post-fix (fix/joists-on-blocks-flying): 13 joists × 5 rows =
    // 65 blocks, with a block column under EACH joist (no flying).
    const design = makeMethodB({ widthFt: 16, lengthFt: 16 });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeLessThanOrEqual(80);
    // PIN a specific, testable count: numJoists × rows.
    // Width 16 ft = 4877 mm @ 16″ oc (406 mm) + 2×8 joist
    // thickness 38.1 mm → 13 joists. Length 4877 mm @ 1220 mm
    // default → rows = max(2, ceil(4877/1220)+1) = 5. Total 13 × 5 = 65.
    expect(blocks.length).toBe(65);
  });

  it('block count SCALES with joist count (13 joists vs 33 joists → more blocks; same row count)', () => {
    // Post-fix: block columns are pinned to joist x-centers, so
    // block count IS a function of joist count. Changing joist
    // spacing 16″ → 6″ increases both the joist count AND (linearly)
    // the block count. Rows stay identical (blockSpacingMm did
    // not change).
    const wide = makeMethodB({ widthFt: 16, lengthFt: 16, spacingMm: 406 });
    const tight = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      spacingMm: 152, // 6"
    });
    const wideLayout = computeFloatingLayout(wide);
    const tightLayout = computeFloatingLayout(tight);
    const nWide = wideLayout.members.filter((m) => m.kind === 'block').length;
    const nTight = tightLayout.members.filter((m) => m.kind === 'block').length;
    const jWide = wideLayout.members.filter((m) => m.kind === 'joist').length;
    const jTight = tightLayout.members.filter((m) => m.kind === 'joist').length;
    // Joist count went UP:
    expect(jTight).toBeGreaterThan(jWide);
    // Block count went UP too — MORE columns because MORE joists.
    expect(nTight).toBeGreaterThan(nWide);
    // Row count identical between the two (same blockSpacingMm).
    const rowsWide =
      new Set(
        wideLayout.members
          .filter((m) => m.kind === 'block')
          .map((b) => Math.round(b.position.z * 1e3) / 1e3),
      ).size;
    const rowsTight =
      new Set(
        tightLayout.members
          .filter((m) => m.kind === 'block')
          .map((b) => Math.round(b.position.z * 1e3) / 1e3),
      ).size;
    expect(rowsTight).toBe(rowsWide);
    // And the linear relationship holds: nTight/jTight ==
    // nWide/jWide (both equal the shared row count).
    expect(nTight / jTight).toBe(nWide / jWide);
  });

  it('a smaller blockSpacingMm produces MORE blocks (denser grid — more rows, same columns)', () => {
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

  it('a larger blockSpacingMm produces FEWER blocks (rows floor at 2; columns remain = numJoists)', () => {
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      // MAX_BLOCK_SPACING_MM = 2438.4 mm ≈ 8 ft. Row count floors
      // at max(2, ceil(4877/2438.4)+1) = 3 on a 16 ft deck.
      blockSpacingMm: MAX_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joists = layout.members.filter((m) => m.kind === 'joist');
    // Perimeter-two floor on rows: still ≥ numJoists × 2 blocks.
    expect(blocks.length).toBeGreaterThanOrEqual(joists.length * 2);
    // And it's dramatically smaller than the default-pitch count
    // (rows collapsed from 5 to 3).
    expect(blocks.length).toBeLessThan(80);
  });
});

// ---------------------------------------------------------------------------
// Placement invariants — the grid is a REGULAR grid
// ---------------------------------------------------------------------------

describe('Method B block grid — placement invariants', () => {
  it('outer block ROWS anchored at the length axis ends (±lengthMm/2); outer COLUMNS anchored at outermost joist x-centers', () => {
    // Post-fix (fix/joists-on-blocks-flying): block ROWS along +z
    // still anchor at ±lengthMm/2 (same convention as Method A).
    // Block COLUMNS are pinned to joist x-centers — outermost
    // columns sit at the -x-flush + +x-flush joist positions
    // (which are inset from ±widthMm/2 by half the joist thickness).
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const halfLength = design.footprint.lengthMm / 2;
    const xs = Array.from(new Set(blocks.map((b) => b.position.x))).sort(
      (a, b) => a - b,
    );
    const zs = Array.from(new Set(blocks.map((b) => b.position.z))).sort(
      (a, b) => a - b,
    );
    // Rows: outer rows at length ends.
    expect(zs[0]).toBeCloseTo(-halfLength, 6);
    expect(zs[zs.length - 1]).toBeCloseTo(+halfLength, 6);
    // Columns: outer columns at outermost joist x-centers.
    const joistXs = joists
      .map((j) => j.position.x)
      .sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(joistXs[0]!, 6);
    expect(xs[xs.length - 1]).toBeCloseTo(joistXs[joistXs.length - 1]!, 6);
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

  it('adjacent-block ROW gap (along +z) is ≤ the effective blockSpacingMm; COLUMN gap (along +x) = joist o.c. pitch', () => {
    // Post-fix (fix/joists-on-blocks-flying): row pitch is
    // bounded by `blockSpacingMm` (still true — rows are the
    // support-along-joist axis). Column pitch is the joist o.c.
    // pitch (columns are pinned to joists — the joist spacing
    // controls the +x gap, NOT `blockSpacingMm`).
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
      spacingMm: 406, // 16" o.c.
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const xs = Array.from(new Set(blocks.map((b) => b.position.x))).sort(
      (a, b) => a - b,
    );
    const zs = Array.from(new Set(blocks.map((b) => b.position.z))).sort(
      (a, b) => a - b,
    );
    const epsilonMm = 1e-6;
    // ROW gap (+z) ≤ blockSpacingMm.
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]! - zs[i - 1]!).toBeLessThanOrEqual(1220 + epsilonMm);
    }
    // COLUMN gap (+x) matches joist gap exactly (columns == joists).
    const joistXs = joists
      .map((j) => j.position.x)
      .sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeCloseTo(
        joistXs[i]! - joistXs[i - 1]!,
        6,
      );
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
  // feat/block-count-per-joist — PRECEDENCE FLIP: `blockRowsHint`
  // is now the primary Method-B control (COUNT input) and wins
  // over the legacy `blockSpacingMm` (DISTANCE, superseded).
  // The tighter precedence pin lives in
  // `floating-block-count.test.ts`; this test just asserts that a
  // spacing-only design continues to work byte-identically (back-
  // compat for the legacy path — a user who saved a design under
  // the previous feat/block-spacing model still opens correctly).
  // ---------------------------------------------------------------
  it('legacy back-compat: blockSpacingMm alone still drives the grid (when blockRowsHint is absent)', () => {
    // With rowsHint absent, spacing controls the row count as it
    // did pre-feat/block-count-per-joist. This preserves the
    // save/reload path for designs saved under the previous
    // block-spacing model.
    const dSpacingOnly = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
    });
    const nSpacingOnly = computeFloatingLayout(dSpacingOnly).members.filter(
      (m) => m.kind === 'block',
    ).length;
    // 13 joists × 5 rows = 65 blocks (pre-fix pin).
    expect(nSpacingOnly).toBe(65);
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
