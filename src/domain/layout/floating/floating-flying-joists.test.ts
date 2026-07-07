/**
 * `src/domain/layout/floating/floating-flying-joists.test.ts` —
 * fix/joists-on-blocks-flying — TDD RED for the "no flying
 * joists" invariant.
 *
 * ## Regression target — the UAT bug ("joists fly")
 *
 * feat/block-spacing (PR #66) reworked Method B ("joists on
 * blocks") to place a REGULAR grid at pitch `blockSpacingMm` on
 * BOTH axes. That decoupled the block COLUMNS from the joist
 * x-centers: on a 16 × 16 ft deck at 16″ o.c. joists + 1220 mm
 * default block spacing, joists sit at ~13 x-positions but block
 * columns land at 5 unrelated grid positions. Most joists have
 * NO block under them anywhere along their length — they "fly."
 *
 * A no-beam "joists on blocks" deck (Method B) is only physically
 * sensible if there is a block DIRECTLY under EACH joist. That
 * pre-#66 invariant was `explicitColXCenters = joists.map(j => j.position.x)`.
 * This fix restores it. The user-facing `blockSpacingMm` field
 * now controls the ROW pitch (support spacing ALONG each joist,
 * bounding joist span between supports) — which is the
 * span-relevant dimension anyway.
 *
 * ## What these tests pin
 *
 * 1. Every joist has ≥ 2 blocks directly beneath it (a block
 *    whose x == joist.position.x within EPS, at ≥ 2 distinct z
 *    rows). This is the core "no flying joists" invariant —
 *    RED before fix (columns at grid pitch ≠ joist x's), GREEN
 *    after (columns == joist x's).
 * 2. Block COLUMN x-set === joist x-set (set equality within EPS).
 * 3. Block count = numJoists × numRows.
 * 4. `blockSpacingMm` controls the ROW pitch (rows along +z);
 *    smaller pitch → more rows → more blocks (columns held
 *    fixed at numJoists).
 * 5. Cap enforcement reduces ROWS only (columns = numJoists,
 *    fixed). Perimeter-two floor (rows ≥ 2) preserved. Even a
 *    100 × 100 ft footprint at MIN spacing terminates
 *    deterministically and stays bounded by the hard cap OR the
 *    degenerate "numJoists × 2" floor.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';

import { lookupMaterial } from '../../materials-catalog';
import {
  computeFloatingLayout,
  DEFAULT_METHOD_B_BLOCK_SPACING_MM,
  MAX_METHOD_B_BLOCK_COUNT,
} from './floating-layout';
import {
  MAX_BLOCK_SPACING_MM,
  MIN_BLOCK_SPACING_MM,
} from './block-grid';
import { computeJoistXCenters } from '../joist-layout';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
} as const satisfies FoundationSpec;

/** Match tolerance for float-position comparisons (mm). */
const POS_EPS_MM = 1e-6;

interface Overrides {
  widthFt?: number;
  lengthFt?: number;
  spacingMm?: Mm;
  blockSpacingMm?: Mm;
  joist?: MaterialRef;
}

function makeMethodB(overrides: Overrides = {}): DeckDesign {
  const widthMm = (overrides.widthFt ?? 16) * MM_PER_FOOT;
  const lengthMm = (overrides.lengthFt ?? 16) * MM_PER_FOOT;
  let foundation: FoundationSpec = TUFFBLOCK_FOUNDATION;
  if (overrides.blockSpacingMm !== undefined) {
    foundation = { ...foundation, blockSpacingMm: overrides.blockSpacingMm };
  }
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: { widthMm, lengthMm, heightMm: 500 },
    structure: 'floating',
    floatingFraming: 'joists-on-blocks',
    beamConnection: 'drop',
    foundation,
    joist: {
      material: overrides.joist ?? PT_2X8,
      spacingMm: overrides.spacingMm ?? 406, // 16" o.c.
    },
    beam: { material: PT_2X8 },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

/** Joist thickness = actual widthMm of the joist material. */
function joistThicknessMm(mat: MaterialRef): number {
  return lookupMaterial(mat.nominal, mat.species, mat.grade).actual.widthMm;
}

/**
 * Independent joist x-center reference — mirrors what the joist
 * layer computes. Used to prove block columns and joist positions
 * agree WITHOUT reading the joists back from the layout.
 */
function expectedJoistXs(design: DeckDesign): number[] {
  return computeJoistXCenters(
    design.footprint.widthMm,
    design.joist.spacingMm,
    joistThicknessMm(design.joist.material),
  );
}

// ---------------------------------------------------------------------------
// The core fix — EVERY joist has ≥ 2 blocks directly beneath it
// ---------------------------------------------------------------------------

describe('Method B — NO FLYING JOISTS: every joist has ≥ 2 blocks under it', () => {
  it('16 × 16 ft @ 16" oc joists + default spacing — every joist has ≥ 2 blocks (a column) directly beneath it', () => {
    // Pre-fix: columns at 5 grid positions ≠ 13 joist x-positions
    // → most joists had ZERO blocks anywhere on their length.
    // Post-fix: 13 columns pinned to the 13 joist x-centers →
    // every joist has a column of ≥ 2 blocks under it.
    const design = makeMethodB({ widthFt: 16, lengthFt: 16 });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(joists.length).toBeGreaterThan(0);
    for (const joist of joists) {
      const blocksUnder = blocks.filter(
        (b) => Math.abs(b.position.x - joist.position.x) <= POS_EPS_MM,
      );
      // A column under each joist is ≥ 2 blocks (perimeter-two
      // floor at each z-end — see FR-035 rows ≥ 2 invariant).
      expect(
        blocksUnder.length,
        `joist ${joist.id} at x=${joist.position.x} has ${blocksUnder.length} blocks under it (want ≥ 2)`,
      ).toBeGreaterThanOrEqual(2);
      // Blocks under one joist share ≥ 2 distinct z rows.
      const zs = new Set(blocksUnder.map((b) => Math.round(b.position.z * 1e3) / 1e3));
      expect(zs.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('block column x-set === joist x-set (set equality within EPS)', () => {
    // This is the direct assertion: column x's == joist x's. It
    // will FAIL on the pre-fix code (columns at grid pitch,
    // joists at o.c. pitch — the two sets don't match).
    const design = makeMethodB({ widthFt: 16, lengthFt: 20 });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joistXs = joists
      .map((j) => Math.round(j.position.x * 1e6) / 1e6)
      .sort((a, b) => a - b);
    const blockColXs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.x * 1e6) / 1e6)),
    ).sort((a, b) => a - b);
    expect(blockColXs).toEqual(joistXs);
  });

  it('block column x-set matches the shared computeJoistXCenters output (same helper the joist layer uses)', () => {
    // Cross-check via the shared helper — proves blocks + joists
    // consume the SAME source of truth for x-centers.
    const design = makeMethodB({ widthFt: 12, lengthFt: 14, spacingMm: 610 });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const blockColXs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.x * 1e6) / 1e6)),
    ).sort((a, b) => a - b);
    const expected = expectedJoistXs(design)
      .map((x) => Math.round(x * 1e6) / 1e6)
      .sort((a, b) => a - b);
    expect(blockColXs).toEqual(expected);
  });

  it('changing joist spacing changes the block column count (columns follow joists, not blockSpacingMm)', () => {
    // A tighter joist spacing yields MORE joists → MORE block
    // columns. Confirms the causal relationship: columns are
    // driven by joists, NOT by blockSpacingMm.
    const wide = makeMethodB({ widthFt: 16, lengthFt: 16, spacingMm: 610 }); // 24" o.c.
    const tight = makeMethodB({ widthFt: 16, lengthFt: 16, spacingMm: 305 }); // 12" o.c.
    const wideBlocks = computeFloatingLayout(wide).members.filter(
      (m) => m.kind === 'block',
    );
    const tightBlocks = computeFloatingLayout(tight).members.filter(
      (m) => m.kind === 'block',
    );
    const wideColX = new Set(
      wideBlocks.map((b) => Math.round(b.position.x * 1e6) / 1e6),
    );
    const tightColX = new Set(
      tightBlocks.map((b) => Math.round(b.position.x * 1e6) / 1e6),
    );
    expect(tightColX.size).toBeGreaterThan(wideColX.size);
  });
});

// ---------------------------------------------------------------------------
// Block count is a function of BOTH joist count AND blockSpacingMm (rows)
// ---------------------------------------------------------------------------

describe('Method B — block count = numJoists × numRows', () => {
  it('16 × 16 ft @ 16" oc joists + default spacing → numJoists × numRows blocks', () => {
    const design = makeMethodB({ widthFt: 16, lengthFt: 16 });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const zs = new Set(
      blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    // block count == numJoists × numRows (regular grid).
    expect(blocks.length).toBe(joists.length * zs.size);
  });

  it('blockSpacingMm controls the ROW count (smaller pitch → more rows → more blocks); columns held fixed at numJoists', () => {
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
    const nCoarse = computeFloatingLayout(coarse);
    const nFine = computeFloatingLayout(fine);
    const coarseBlocks = nCoarse.members.filter((m) => m.kind === 'block');
    const fineBlocks = nFine.members.filter((m) => m.kind === 'block');
    // Column count (unique x) is IDENTICAL between the two — the
    // joist count did not change.
    const coarseColX = new Set(
      coarseBlocks.map((b) => Math.round(b.position.x * 1e6) / 1e6),
    );
    const fineColX = new Set(
      fineBlocks.map((b) => Math.round(b.position.x * 1e6) / 1e6),
    );
    expect(fineColX.size).toBe(coarseColX.size);
    // Row count went UP (more supports along +z).
    const coarseZ = new Set(
      coarseBlocks.map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    const fineZ = new Set(
      fineBlocks.map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    expect(fineZ.size).toBeGreaterThan(coarseZ.size);
    expect(fineBlocks.length).toBeGreaterThan(coarseBlocks.length);
  });

  it('at DEFAULT_METHOD_B_BLOCK_SPACING_MM, adjacent-block ROW gap (along +z) is ≤ the spacing', () => {
    // Row pitch = lengthMm / (rows-1). With rows =
    // blockCountForAxis(len, spacing) = max(2, ceil(len/spacing)+1),
    // the pitch invariant is pitch ≤ spacing. This is the
    // span-relevant invariant (bounds joist span between supports).
    const design = makeMethodB({
      widthFt: 20,
      lengthFt: 16,
      blockSpacingMm: DEFAULT_METHOD_B_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const zs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3)),
    ).sort((a, b) => a - b);
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]! - zs[i - 1]!).toBeLessThanOrEqual(
        DEFAULT_METHOD_B_BLOCK_SPACING_MM + POS_EPS_MM,
      );
    }
  });

  it('outer rows are anchored at the length axis ends (±lengthMm/2)', () => {
    const design = makeMethodB({
      widthFt: 14,
      lengthFt: 18,
      blockSpacingMm: 1220,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const zs = Array.from(
      new Set(blocks.map((b) => b.position.z)),
    ).sort((a, b) => a - b);
    const halfLength = design.footprint.lengthMm / 2;
    expect(zs[0]).toBeCloseTo(-halfLength, 6);
    expect(zs[zs.length - 1]).toBeCloseTo(+halfLength, 6);
  });
});

// ---------------------------------------------------------------------------
// Cap enforcement — reduces ROWS only (columns pinned to joists)
// ---------------------------------------------------------------------------

describe('Method B — hard cap reduces ROWS only; columns stay pinned to joists', () => {
  it('MAX_METHOD_B_BLOCK_COUNT is not exceeded even at pathological MIN spacing + large footprint', () => {
    // 40 × 40 ft at MIN=300 wants ~41 columns × 42 rows = ~1722
    // blocks. Post-cap: cap by reducing rows only; columns still
    // equal the joist count (fixed by joist spacing).
    const design = makeMethodB({
      widthFt: 40,
      lengthFt: 40,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeLessThanOrEqual(MAX_METHOD_B_BLOCK_COUNT);
  });

  it('cap enforcement keeps the perimeter-two floor (rows ≥ 2) even for huge footprints', () => {
    // 100 × 100 ft at MIN spacing — the pathological corner. The
    // cap MUST leave ≥ 2 rows (a single row of blocks would leave
    // the joists cantilevering off a single support line — not a
    // deck).
    const design = makeMethodB({
      widthFt: 100,
      lengthFt: 100,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const zs = new Set(
      blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    expect(zs.size).toBeGreaterThanOrEqual(2);
  });

  it('cap enforcement does NOT drop any columns (every joist still has a support column)', () => {
    // Even under the tightest cap, the "columns = joists"
    // invariant HOLDS — you cannot skip a joist just because you
    // ran out of block budget. If numJoists × 2 > cap, rows stay
    // at 2 (degenerate but bounded — only reachable with
    // physically absurd inputs).
    const design = makeMethodB({
      widthFt: 40,
      lengthFt: 40,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // Column set matches joist set exactly.
    const joistXs = new Set(
      joists.map((j) => Math.round(j.position.x * 1e6) / 1e6),
    );
    const blockColXs = new Set(
      blocks.map((b) => Math.round(b.position.x * 1e6) / 1e6),
    );
    expect(blockColXs.size).toBe(joistXs.size);
    for (const x of joistXs) {
      expect(blockColXs.has(x)).toBe(true);
    }
  });

  it('degenerate case: numJoists × 2 > MAX is now UNREACHABLE via validated designs — MIN_JOIST_SPACING_MM=305 (PR #73 review)', () => {
    // FR-035 degenerate exception — the ONE code path where the
    // perimeter-two floor (rows ≥ 2) supersedes the hard cap
    // (total ≤ MAX_METHOD_B_BLOCK_COUNT). Pre-PR-#73 this case
    // was reachable with pathologically-tight joist spacing on a
    // near-max footprint:
    //   `{ widthFt: 100, lengthFt: 100, spacingMm: 40 }` →
    //   ~763 joists × 2 rows = 1526 blocks > 400 cap.
    //
    // PR #73 review (GPT-5.5 HIGH #2 root fix) added a practical
    // MIN_JOIST_SPACING_MM = 305 mm (12″ o.c.) guard at
    // `validateJoistSpacing`. That guard now GATES OUT the
    // pathological input BEFORE it reaches the block-cap logic:
    // spacingMm=40 fails validation, `computeFloatingLayout`
    // throws `LayoutError`, and the degenerate-exception code
    // path is UNREACHABLE via any legal design.
    //
    // The FR-035 exception code in `resolveMethodBGrid` is
    // RETAINED as defense-in-depth (belt-and-braces) so a future
    // consumer that bypasses the MIN guard still gets a bounded
    // failure, not an OOM. This test now proves the OUTER guard
    // rejects the pathological input up front.
    const design = makeMethodB({
      widthFt: 100,
      lengthFt: 100,
      spacingMm: 40, // just above 2×8 thickness (38 mm), well below MIN=305
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });

    // OUTER guard: MIN_JOIST_SPACING_MM=305 rejects at validation.
    expect(() => computeFloatingLayout(design)).toThrowError(/305|spacing/i);

    // Sanity: the largest LEGAL spacing (MIN=305) on the same
    // 100×100 ft footprint yields a bounded, cap-respecting
    // layout — confirms the MIN guard is enough to keep the
    // pathological corner out of reach for every legal input.
    const legalDesign = makeMethodB({
      widthFt: 100,
      lengthFt: 100,
      spacingMm: 305,
      blockSpacingMm: MIN_BLOCK_SPACING_MM,
    });
    expect(() => computeFloatingLayout(legalDesign)).not.toThrow();
    const layout = computeFloatingLayout(legalDesign);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joists = layout.members.filter((m) => m.kind === 'joist');
    // At MIN, joists = 101 → blocks = joists × 2 = 202 (or fewer
    // if the row-cap allows more rows and the col-cap kicks in).
    // The important bound: total blocks stay under the
    // no-OOM 2000-block sanity ceiling.
    expect(joists.length).toBeLessThanOrEqual(101);
    expect(blocks.length).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// Regression pin — Method A + elevated + posts-on-footings unchanged
// ---------------------------------------------------------------------------

describe('Method A + elevated regression pin — this fix ONLY touches Method B', () => {
  it('Method A (beams-and-joists) block positions are unchanged when blockSpacingMm is set', () => {
    // Byte-identical Method A output regardless of blockSpacingMm.
    const baseFoundation: FoundationSpec = TUFFBLOCK_FOUNDATION;
    const withSpacingFoundation: FoundationSpec = {
      ...baseFoundation,
      blockSpacingMm: 600,
    };
    const baseA: DeckDesign = {
      id: '00000000-0000-4000-8000-0000000000f2',
      createdAt: '2026-07-05T00:00:00.000Z',
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
    const withSpacing: DeckDesign = {
      ...baseA,
      foundation: withSpacingFoundation,
    };
    const layoutBase = computeFloatingLayout(baseA);
    const layoutWith = computeFloatingLayout(withSpacing);
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
// Sanity — MAX blockSpacingMm still yields the minimum row grid without
// dropping any columns
// ---------------------------------------------------------------------------

describe('Method B — MAX blockSpacingMm keeps ≥ 2 rows AND all joist columns', () => {
  it('at MAX blockSpacingMm on a 16 × 16 ft deck: cols == numJoists, rows ≥ 2', () => {
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: MAX_BLOCK_SPACING_MM,
    });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const xs = new Set(
      blocks.map((b) => Math.round(b.position.x * 1e6) / 1e6),
    );
    const zs = new Set(
      blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    expect(xs.size).toBe(joists.length);
    expect(zs.size).toBeGreaterThanOrEqual(2);
  });
});
