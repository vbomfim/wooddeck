/**
 * `src/domain/layout/floating/floating-block-count.test.ts` —
 * feat/block-count-per-joist. Method B support control PIVOT from
 * a DISTANCE input (`blockSpacingMm`) to a COUNT input
 * (`blockRowsHint`).
 *
 * ## User story (UAT)
 *
 * The `blockSpacingMm` control from feat/block-spacing left the
 * user under-supported when the default derivation landed at only
 * 2 block rows (the perimeter-two floor) on a large deck — every
 * joist over-spanned and the whole deck went red. The user asked:
 * *"ask how many [blocks along each joist] and spread on
 * equivalent distance."* This test file pins the new behavior:
 *
 *   - `blockRowsHint` is the PRIMARY Method-B control. It sets
 *     the exact number of block ROWS along each joist.
 *   - Rows are spread EVENLY end-to-end via `computeAxisCenters`
 *     (outer rows at ±length/2, interior rows at equal spacing).
 *   - Columns stay pinned to joist x-centers — one block per
 *     joist per row. Total = numJoists × rows.
 *   - `blockRowsHint` wins over `blockSpacingMm` when both are
 *     set (`blockSpacingMm` is LEGACY / superseded).
 *   - The absent-hint default remains span-safe (the pre-existing
 *     `DEFAULT_METHOD_B_BLOCK_SPACING_MM` derivation is used —
 *     4 ft pitch — which produces the row counts the previous
 *     tests pin).
 *
 * ## Regression scope
 *
 * These tests are ORTHOGONAL to Method A + elevated + posts-on-
 * footings, which are byte-identical to pre-fix (see
 * `floating-block-spacing.test.ts` "blockSpacingMm ONLY affects
 * Method B" — the same invariant holds for `blockRowsHint`).
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';

import {
  computeFloatingLayout,
  MAX_METHOD_B_BLOCK_COUNT,
} from './floating-layout';
import { MIN_BLOCK_SPACING_MM } from './block-grid';

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
    id: '00000000-0000-4000-8000-0000000000c1',
    createdAt: '2026-07-05T00:00:00.000Z',
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
// (A) The COUNT control — `blockRowsHint` is the primary Method-B knob
// ---------------------------------------------------------------------------

describe('Method B — blockRowsHint sets the exact row count', () => {
  it('N=3 → exactly 3 block rows per joist; total = numJoists × 3', () => {
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockRowsHint: 3,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const zs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3)),
    );
    expect(zs.length).toBe(3);
    expect(blocks.length).toBe(joists.length * 3);
  });

  it('N=4 → exactly 4 rows, spread EVENLY end-to-end (outer at ±length/2, equal interior gaps)', () => {
    const lengthFt = 16;
    const design = makeMethodB({
      widthFt: 16,
      lengthFt,
      blockRowsHint: 4,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const halfLength = (lengthFt * MM_PER_FOOT) / 2;
    const zs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3)),
    ).sort((a, b) => a - b);
    // Perimeter: outer rows at ±length/2.
    expect(zs[0]).toBeCloseTo(-halfLength, 6);
    expect(zs[zs.length - 1]).toBeCloseTo(+halfLength, 6);
    expect(zs.length).toBe(4);
    // Interior gaps EQUAL — computeAxisCenters spreads evenly.
    const gaps: number[] = [];
    for (let i = 1; i < zs.length; i++) {
      gaps.push(zs[i]! - zs[i - 1]!);
    }
    const first = gaps[0]!;
    for (const g of gaps) {
      expect(g).toBeCloseTo(first, 6);
    }
  });

  it('columns still = joist x-centers (one block column per joist — no flying joists)', () => {
    const design = makeMethodB({
      widthFt: 20,
      lengthFt: 12,
      blockRowsHint: 5,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const uniqueBlockXs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.x * 1e3) / 1e3)),
    ).sort((a, b) => a - b);
    const joistXs = joists
      .map((j) => Math.round(j.position.x * 1e3) / 1e3)
      .sort((a, b) => a - b);
    expect(uniqueBlockXs.length).toBe(joistXs.length);
    for (let i = 0; i < joistXs.length; i++) {
      expect(uniqueBlockXs[i]!).toBeCloseTo(joistXs[i]!, 6);
    }
    // Total = numJoists × rows.
    expect(blocks.length).toBe(joistXs.length * 5);
  });

  it('increasing the count → more rows → shorter row pitch → tighter joist support span', () => {
    const dLow = makeMethodB({
      widthFt: 12,
      lengthFt: 20,
      blockRowsHint: 3,
    });
    const dHigh = makeMethodB({
      widthFt: 12,
      lengthFt: 20,
      blockRowsHint: 6,
    });
    const zsLow = Array.from(
      new Set(
        computeFloatingLayout(dLow)
          .members.filter((m) => m.kind === 'block')
          .map((b) => Math.round(b.position.z * 1e3) / 1e3),
      ),
    ).sort((a, b) => a - b);
    const zsHigh = Array.from(
      new Set(
        computeFloatingLayout(dHigh)
          .members.filter((m) => m.kind === 'block')
          .map((b) => Math.round(b.position.z * 1e3) / 1e3),
      ),
    ).sort((a, b) => a - b);
    expect(zsHigh.length).toBeGreaterThan(zsLow.length);
    // Row pitch shrinks: length/(rows-1) monotonically decreasing.
    const pitchLow = zsLow[1]! - zsLow[0]!;
    const pitchHigh = zsHigh[1]! - zsHigh[0]!;
    expect(pitchHigh).toBeLessThan(pitchLow);
  });
});

// ---------------------------------------------------------------------------
// (B) Precedence — blockRowsHint > blockSpacingMm
// ---------------------------------------------------------------------------

describe('Method B — precedence: blockRowsHint wins over blockSpacingMm', () => {
  it('both fields set → row count comes from blockRowsHint (blockSpacingMm ignored)', () => {
    // rowsHint=3 would give 3 rows regardless of what spacing
    // would have derived (1220 mm on a 16 ft deck → 5 rows).
    const dBoth = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
      blockRowsHint: 3,
    });
    const dRowsOnly = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockRowsHint: 3,
    });
    const nBoth = computeFloatingLayout(dBoth).members.filter(
      (m) => m.kind === 'block',
    ).length;
    const nRowsOnly = computeFloatingLayout(dRowsOnly).members.filter(
      (m) => m.kind === 'block',
    ).length;
    expect(nBoth).toBe(nRowsOnly);

    // Spacing ONLY design would produce a DIFFERENT count (5 rows).
    const dSpacingOnly = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: 1220,
    });
    const nSpacingOnly = computeFloatingLayout(dSpacingOnly).members.filter(
      (m) => m.kind === 'block',
    ).length;
    expect(nBoth).not.toBe(nSpacingOnly);
  });

  it('blockRowsHint set with a very tight blockSpacingMm → rowsHint still wins (no extra rows added)', () => {
    const dBoth = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockSpacingMm: MIN_BLOCK_SPACING_MM, // would derive ~17 rows
      blockRowsHint: 4,
    });
    const zs = new Set(
      computeFloatingLayout(dBoth)
        .members.filter((m) => m.kind === 'block')
        .map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    // Count is exactly what blockRowsHint asked for — 4, not 17.
    expect(zs.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// (C) Clamps — rowsHint bounded above by MAX_BLOCK_COUNT/numJoists AND
// by MIN_BLOCK_SPACING_MM gap, bounded below at 2 (perimeter floor)
// ---------------------------------------------------------------------------

describe('Method B — blockRowsHint clamps', () => {
  it('huge blockRowsHint clamped by MAX_METHOD_B_BLOCK_COUNT / numJoists (columns not dropped)', () => {
    // 16 ft @ 16" oc → 13 joists. Cap at 400 → maxRows = 30. A
    // huge hint (200) MUST clamp to ≤ 30 rows so total ≤ 400.
    const design = makeMethodB({
      widthFt: 16,
      lengthFt: 16,
      blockRowsHint: 200,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joists = layout.members.filter((m) => m.kind === 'joist');
    expect(blocks.length).toBeLessThanOrEqual(MAX_METHOD_B_BLOCK_COUNT);
    const rows = blocks.length / joists.length;
    expect(rows).toBeLessThanOrEqual(
      Math.floor(MAX_METHOD_B_BLOCK_COUNT / joists.length),
    );
  });

  it('huge blockRowsHint clamped by MIN_BLOCK_SPACING_MM gap (row pitch never < 300 mm)', () => {
    // 4 ft deck, huge hint. lengthMm=1219.2. rowsMaxByGap =
    // floor(1219.2 / 300) + 1 = 5. Hint=50 → clamp to 5.
    const design = makeMethodB({
      widthFt: 8,
      lengthFt: 4,
      blockRowsHint: 50,
    });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const zs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3)),
    ).sort((a, b) => a - b);
    // At most floor(1219.2 / 300) + 1 = 5 rows.
    expect(zs.length).toBeLessThanOrEqual(5);
    // Adjacent row gap ≥ MIN_BLOCK_SPACING_MM (with a nm tolerance).
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]! - zs[i - 1]!).toBeGreaterThanOrEqual(
        MIN_BLOCK_SPACING_MM - 1e-6,
      );
    }
  });

  it('blockRowsHint < 2 clamped up to 2 (perimeter floor)', () => {
    for (const bad of [-5, 0, 1]) {
      const design = makeMethodB({
        widthFt: 12,
        lengthFt: 12,
        blockRowsHint: bad,
      });
      const zs = new Set(
        computeFloatingLayout(design)
          .members.filter((m) => m.kind === 'block')
          .map((b) => Math.round(b.position.z * 1e3) / 1e3),
      );
      expect(zs.size).toBe(2);
    }
  });

  it('non-integer blockRowsHint is floored before clamping', () => {
    const design = makeMethodB({
      widthFt: 12,
      lengthFt: 12,
      blockRowsHint: 3.9, // → 3
    });
    const zs = new Set(
      computeFloatingLayout(design)
        .members.filter((m) => m.kind === 'block')
        .map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    expect(zs.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// (D) Absent-hint default — span-safe for a fresh design
// ---------------------------------------------------------------------------

describe('Method B — absent-hint default is span-safe', () => {
  it('12×12 ft (default deck size) with NO hint → produces a span-safe row count (≥ 3)', () => {
    // The absent-hint default derives from
    // DEFAULT_METHOD_B_BLOCK_SPACING_MM (1220 mm). On a 12 ft
    // deck (3657.6 mm) that yields ceil(3657.6/1220)+1 = 4 rows.
    // 4 rows → pitch ≈ 1219 mm, well within 2×8 PT No.2 @ 16"
    // o.c. (allowable ≈ 2565 mm).
    const design = makeMethodB({ widthFt: 12, lengthFt: 12 });
    const zs = new Set(
      computeFloatingLayout(design)
        .members.filter((m) => m.kind === 'block')
        .map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    expect(zs.size).toBeGreaterThanOrEqual(3);
    // Row pitch < 2400 mm — safely under the tightest IRC allow
    // for a 2×8 PT joist we ship.
    const zsArr = Array.from(zs).sort((a, b) => a - b);
    const pitch = zsArr[1]! - zsArr[0]!;
    expect(pitch).toBeLessThan(2400);
  });

  it('16×16 ft with NO hint → 5 rows (backward-compat with the pre-fix 1220 mm default)', () => {
    // Byte-identity with the current default: 16 ft → 5 rows.
    // This asserts we did NOT change the absent-hint behavior.
    const design = makeMethodB({ widthFt: 16, lengthFt: 16 });
    const zs = new Set(
      computeFloatingLayout(design)
        .members.filter((m) => m.kind === 'block')
        .map((b) => Math.round(b.position.z * 1e3) / 1e3),
    );
    expect(zs.size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// (E) Method A byte-identity — blockRowsHint MUST be a Method-B-only knob
// ---------------------------------------------------------------------------

describe('Method A / elevated are unaffected by blockRowsHint (byte-identity pin)', () => {
  function makeMethodA(rowsHint?: number): DeckDesign {
    const foundation: FoundationSpec =
      rowsHint !== undefined
        ? { ...TUFFBLOCK_FOUNDATION, blockRowsHint: rowsHint }
        : TUFFBLOCK_FOUNDATION;
    return {
      id: '00000000-0000-4000-8000-0000000000a2',
      createdAt: '2026-07-05T00:00:00.000Z',
      footprint: {
        widthMm: 16 * MM_PER_FOOT,
        lengthMm: 14 * MM_PER_FOOT,
        heightMm: 600,
      },
      structure: 'floating',
      floatingFraming: 'beams-and-joists', // Method A
      beamConnection: 'drop',
      foundation,
      joist: { material: PT_2X8, spacingMm: 406 },
      beam: { material: PT_2X8 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    };
  }

  it('Method A block member array is byte-identical with vs without blockRowsHint', () => {
    // Method A pins rows to the two rim beams — blockRowsHint has
    // NO seam in Method A. The layout MUST be byte-for-byte the
    // same whether the field is set or not.
    // NOTE: this pin extends the existing "Method A unaffected by
    // blockSpacingMm" pin — same principle applied to the count knob.
    const base = computeFloatingLayout(makeMethodA(undefined));
    const withHint = computeFloatingLayout(makeMethodA(5));
    const summarize = (l: typeof base): string =>
      JSON.stringify(
        l.members.map((m) => ({
          id: m.id,
          kind: m.kind,
          x: m.position.x,
          y: m.position.y,
          z: m.position.z,
        })),
      );
    expect(summarize(base)).toBe(summarize(withHint));
  });
});
