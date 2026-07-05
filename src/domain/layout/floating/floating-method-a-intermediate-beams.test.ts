/**
 * `src/domain/layout/floating/floating-method-a-intermediate-beams.test.ts`
 * — TDD RED for issue #75, "Method A (beams-and-joists): auto-add
 * span-safe intermediate beam rows so joists get mid-span support".
 *
 * ## Regression target
 *
 * Pre-#75 Method A emitted exactly 2 rim beams (near + far) and 2
 * rows of blocks (under each rim). Joists spanned the full deck
 * length. On any typical DIY-size deck (12×12 ft up to 40×40 ft)
 * with 2× joists the joist span exceeded the IRC allowable → every
 * joist over-spanned → UI went red → user rightly asked *"why is
 * there no blocks under the joists?"*.
 *
 * This file pins the new span-safe default behavior (FR-A..FR-H in
 * the ticket §4). The design shape / persisted `.deck` schema is
 * UNCHANGED — the layout OUTPUT gains N ≥ 2 beams (`beam-near`,
 * `beam-mid-0`..`beam-mid-{N-3}`, `beam-far`) plus one row of
 * blocks under EACH beam row.
 *
 * ## Coverage — AC1..AC15 from the ticket §18
 *
 * See per-`describe` block for the AC each group pins.
 *
 * ## Pre-comply: pure domain module — no react/three imports.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';
import { spanCheck } from '../../spans/span-check';
import { IrcSpanTable } from '../../spans/irc-2018-tables';
import type { SpanTable } from '../../spans/span-table';
import { LayoutError } from '../layout-shared';
import { FOOTING_WIDTH_MM } from '../y-stack';

import {
  MAX_METHOD_A_BEAM_ROWS,
  MIN_BEAM_ROW_GAP_MM,
  clampMethodABeamRows,
  computeFloatingLayout,
  resolveMethodABeamRows,
} from './floating-layout';
import { computeFloatingBeams } from './floating-beam-layout';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PT_2X6: MaterialRef = { nominal: '2x6', species: 'PT', grade: 'No2' };
const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
const CEDAR_2X6: MaterialRef = { nominal: '2x6', species: 'Cedar', grade: 'No2' };
const CEDAR_2X8: MaterialRef = { nominal: '2x8', species: 'Cedar', grade: 'No2' };
const CEDAR_2X10: MaterialRef = { nominal: '2x10', species: 'Cedar', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

// TuffBlock only accepts {2x6, 2x8}; Oldcastle accepts {2x6, 2x8, 2x10}.
// For 2×10 joist matrix cases we MUST use Oldcastle via deck-blocks.
const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};
const OLDCASTLE_FOUNDATION: FoundationSpec = {
  type: 'deck-blocks',
  product: { productId: 'oldcastle-11x11x7' },
};

interface FloatOverrides {
  widthFt?: number;
  lengthFt?: number;
  heightMm?: Mm;
  spacingMm?: Mm;
  joist?: MaterialRef;
  beam?: MaterialRef;
  beamConnection?: DeckDesign['beamConnection'];
  foundation?: FoundationSpec;
}

function makeMethodA(overrides: FloatOverrides = {}): DeckDesign {
  const widthMm = (overrides.widthFt ?? 16) * MM_PER_FOOT;
  const lengthMm = (overrides.lengthFt ?? 16) * MM_PER_FOOT;
  const joist = overrides.joist ?? PT_2X8;
  // Beam MUST be at least as deep as joist to satisfy the flush-
  // beam invariant when beamConnection === 'flush'; use the same
  // nominal as the joist (safe universal).
  const beam = overrides.beam ?? joist;
  return {
    id: '00000000-0000-4000-8000-000000000a75',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: {
      widthMm,
      lengthMm,
      heightMm: overrides.heightMm ?? 3 * MM_PER_FOOT,
    },
    structure: 'floating',
    floatingFraming: 'beams-and-joists',
    beamConnection: overrides.beamConnection ?? 'drop',
    foundation: overrides.foundation ?? TUFFBLOCK_FOUNDATION,
    joist: { material: joist, spacingMm: overrides.spacingMm ?? 406 },
    beam: { material: beam },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

/**
 * A mock SpanTable that always returns 0 for `lookupJoistMaxSpan`
 * — exercises the "uncatalogued joist material" fallback branch
 * without depending on a specific material triple's actual
 * catalog status.
 */
const ZERO_SPAN_TABLE: SpanTable = {
  edition: 'test-zero',
  lookupJoistMaxSpan: () => 0,
  lookupBeamMaxSpan: () => 0,
  citationFor: () => 'test-zero: no citation',
};

// ---------------------------------------------------------------------------
// C1 — resolveMethodABeamRows unit tests (FR-A + FR-A fallback)
// ---------------------------------------------------------------------------

describe('resolveMethodABeamRows — SpanTable + material path', () => {
  const IRC = new IrcSpanTable();

  it('deck length ≤ joist allowable → totalRows = 2 (no interior needed)', () => {
    // 2×8 PT No.2 @ 406 mm o.c. → IRC allowable ≈ 3556 mm; an 8 ft
    // deck (2438 mm) is well below → the rim-to-rim span is span-
    // safe with 2 rims only.
    const { totalRows, interiorRows } = resolveMethodABeamRows(
      8 * MM_PER_FOOT,
      IRC,
      PT_2X8,
      406,
    );
    expect(totalRows).toBe(2);
    expect(interiorRows).toBe(0);
  });

  it('deck length > joist allowable → totalRows = ceil(len/allowable)+1 (adds interior)', () => {
    // 16 ft length (4877 mm), 2×8 PT No.2 @ 406 mm → allowable
    // ~3556 mm. ceil(4877/3556) + 1 = 3. So 1 interior beam row.
    const { totalRows, interiorRows } = resolveMethodABeamRows(
      16 * MM_PER_FOOT,
      IRC,
      PT_2X8,
      406,
    );
    expect(totalRows).toBeGreaterThanOrEqual(3);
    expect(interiorRows).toBe(totalRows - 2);
  });

  it('40 ft deck × 2×6 PT joists @ 406 mm → adds multiple interior beams', () => {
    // 40 ft = 12192 mm; 2×6 PT No.2 @ 406 mm → allowable ~2743 mm.
    // ceil(12192/2743) + 1 = 6 rows → 4 interior.
    const { totalRows, interiorRows } = resolveMethodABeamRows(
      40 * MM_PER_FOOT,
      IRC,
      PT_2X6,
      406,
    );
    expect(interiorRows).toBeGreaterThanOrEqual(3);
    expect(totalRows).toBe(interiorRows + 2);
  });
});

describe('resolveMethodABeamRows — fallback paths (FR-A fallback)', () => {
  it('SpanTable is undefined → totalRows = 2 (byte-identical to pre-#75)', () => {
    const { totalRows, interiorRows } = resolveMethodABeamRows(
      40 * MM_PER_FOOT,
      undefined,
      PT_2X8,
      406,
    );
    expect(totalRows).toBe(2);
    expect(interiorRows).toBe(0);
  });

  it('joistMaterial is undefined → totalRows = 2', () => {
    const IRC = new IrcSpanTable();
    const { totalRows, interiorRows } = resolveMethodABeamRows(
      40 * MM_PER_FOOT,
      IRC,
      undefined,
      406,
    );
    expect(totalRows).toBe(2);
    expect(interiorRows).toBe(0);
  });

  it('joistSpacingMm is undefined → totalRows = 2', () => {
    const IRC = new IrcSpanTable();
    const { totalRows, interiorRows } = resolveMethodABeamRows(
      40 * MM_PER_FOOT,
      IRC,
      PT_2X8,
      undefined,
    );
    expect(totalRows).toBe(2);
    expect(interiorRows).toBe(0);
  });

  it('SpanTable returns 0 for the material (uncatalogued) → totalRows = 2', () => {
    const { totalRows, interiorRows } = resolveMethodABeamRows(
      40 * MM_PER_FOOT,
      ZERO_SPAN_TABLE,
      PT_2X8,
      406,
    );
    expect(totalRows).toBe(2);
    expect(interiorRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C2 — clampMethodABeamRows unit tests (cap + gap ceilings)
// ---------------------------------------------------------------------------

describe('clampMethodABeamRows — perimeter-two floor + cap + gap ceilings', () => {
  it('always floors at 2 (perimeter-two)', () => {
    expect(clampMethodABeamRows(0, 16 * MM_PER_FOOT, 16 * MM_PER_FOOT)).toBe(2);
    expect(clampMethodABeamRows(1, 16 * MM_PER_FOOT, 16 * MM_PER_FOOT)).toBe(2);
    expect(clampMethodABeamRows(-5, 16 * MM_PER_FOOT, 16 * MM_PER_FOOT)).toBe(2);
  });

  it('caps at MAX_METHOD_A_BEAM_ROWS = 20', () => {
    expect(MAX_METHOD_A_BEAM_ROWS).toBe(20);
    // Very generous length so rowsMaxByGap does NOT bind first.
    const bigLength = 100 * MM_PER_FOOT;
    expect(clampMethodABeamRows(999, bigLength, 12 * MM_PER_FOOT)).toBe(
      MAX_METHOD_A_BEAM_ROWS,
    );
  });

  it('honors MIN_BEAM_ROW_GAP_MM = 1000 mm gap ceiling', () => {
    expect(MIN_BEAM_ROW_GAP_MM).toBe(1000);
    // Length = 2000 mm → rowsMaxByGap = floor(2000/1000) + 1 = 3.
    // Length = 4000 mm → rowsMaxByGap = 5.
    expect(clampMethodABeamRows(20, 2000, 12 * MM_PER_FOOT)).toBe(3);
    expect(clampMethodABeamRows(20, 4000, 12 * MM_PER_FOOT)).toBe(5);
  });

  it('passes through in-range requests', () => {
    // 16 ft = 4877 mm → rowsMaxByGap = floor(4877/1000) + 1 = 5.
    // Request 3 → in-range → returns 3.
    expect(clampMethodABeamRows(3, 16 * MM_PER_FOOT, 16 * MM_PER_FOOT)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// C3 — computeFloatingBeams beam ids + geometry (AC5)
// ---------------------------------------------------------------------------

describe('computeFloatingBeams — beam ids match FR-C convention', () => {
  it('N=2 → [beam-near, beam-far] in emit order', () => {
    const design = makeMethodA({ widthFt: 12, lengthFt: 12 });
    // Force N=2 by passing no options (fallback path).
    const beams = computeFloatingBeams(design, { numRows: 2 });
    expect(beams.map((b) => b.id)).toEqual(['beam-near', 'beam-far']);
  });

  it('N=3 → [beam-near, beam-mid-0, beam-far]', () => {
    const design = makeMethodA({ widthFt: 12, lengthFt: 16 });
    const beams = computeFloatingBeams(design, { numRows: 3 });
    expect(beams.map((b) => b.id)).toEqual([
      'beam-near',
      'beam-mid-0',
      'beam-far',
    ]);
  });

  it('N=5 → beam-near, beam-mid-0..2, beam-far', () => {
    const design = makeMethodA({ widthFt: 12, lengthFt: 40 });
    const beams = computeFloatingBeams(design, { numRows: 5 });
    expect(beams.map((b) => b.id)).toEqual([
      'beam-near',
      'beam-mid-0',
      'beam-mid-1',
      'beam-mid-2',
      'beam-far',
    ]);
  });

  it('N=3 → beams evenly spread between rim insets (midpoint at 0)', () => {
    const lengthFt = 16;
    const design = makeMethodA({ widthFt: 12, lengthFt });
    const beams = computeFloatingBeams(design, { numRows: 3 });
    const halfLength = (lengthFt * MM_PER_FOOT) / 2;
    const inset = FOOTING_WIDTH_MM / 2;
    const nearZ = -halfLength + inset;
    const farZ = +halfLength - inset;
    expect(beams[0]!.position.z).toBeCloseTo(nearZ, 6);
    expect(beams[1]!.position.z).toBeCloseTo((nearZ + farZ) / 2, 6);
    expect(beams[2]!.position.z).toBeCloseTo(farZ, 6);
  });

  it('all N beams share the same y (single beam plane) and size (single material)', () => {
    const design = makeMethodA({ widthFt: 12, lengthFt: 20 });
    const beams = computeFloatingBeams(design, { numRows: 4 });
    for (let i = 1; i < beams.length; i++) {
      expect(beams[i]!.position.y).toBeCloseTo(beams[0]!.position.y, 6);
      expect(beams[i]!.size.x).toBeCloseTo(beams[0]!.size.x, 6);
      expect(beams[i]!.size.y).toBeCloseTo(beams[0]!.size.y, 6);
      expect(beams[i]!.size.z).toBeCloseTo(beams[0]!.size.z, 6);
    }
  });

  it('default (no options) → 2 rims (byte-identical to pre-#75)', () => {
    const design = makeMethodA({ widthFt: 12, lengthFt: 12 });
    const beams = computeFloatingBeams(design);
    expect(beams.map((b) => b.id)).toEqual(['beam-near', 'beam-far']);
  });
});

// ---------------------------------------------------------------------------
// C4 — computeMethodA wiring: one row of blocks under each beam row (FR-B, AC4)
// ---------------------------------------------------------------------------

describe('computeMethodA — one block row under every beam row (FR-B, AC4)', () => {
  const IRC = new IrcSpanTable();

  it('for a size that needs 3 beam rows, blocks form 3 unique z rows', () => {
    // 16×16 with 2×8 PT joists → totalRows = 3 (1 interior).
    const design = makeMethodA({ widthFt: 16, lengthFt: 16 });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(beams.length).toBeGreaterThanOrEqual(3);
    const beamZs = beams
      .map((b) => Math.round(b.position.z * 1e3) / 1e3)
      .sort((a, b) => a - b);
    const blockZs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3)),
    ).sort((a, b) => a - b);
    expect(blockZs.length).toBe(beams.length);
    // Each beam z must appear in blockZs (within 1 μm tolerance).
    for (let i = 0; i < beamZs.length; i++) {
      expect(blockZs[i]!).toBeCloseTo(beamZs[i]!, 6);
    }
  });

  it('total blocks = totalRows × cols', () => {
    const design = makeMethodA({ widthFt: 16, lengthFt: 16 });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // Derive cols from the unique x-positions of blocks (block
    // grid is a regular rectangular grid — every row has the
    // same column set).
    const uniqueXs = new Set(
      blocks.map((b) => Math.round(b.position.x * 1e3) / 1e3),
    );
    expect(blocks.length).toBe(beams.length * uniqueXs.size);
  });
});

// ---------------------------------------------------------------------------
// C5 — deriveJoistSpanMm max-adjacent gap (FR-D, AC6)
//
// The derivation is a PRIVATE helper inside span-check.ts; we
// verify its NEW behavior indirectly through `spanCheck` on layouts
// with 2 vs 3+ beams.
// ---------------------------------------------------------------------------

describe('deriveJoistSpanMm — max-adjacent gap for 3+ beams (FR-D, AC6)', () => {
  const IRC = new IrcSpanTable();

  it('2-beam layout → joist span = beam z-delta (byte-identical to pre-#75)', () => {
    // Force N=2 by not threading SpanTable (fallback path).
    const design = makeMethodA({ widthFt: 16, lengthFt: 16 });
    const layout = computeFloatingLayout(design); // no spanTable
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(2);
    // Verify the pre-#75 relation still holds — every joist gets a
    // span equal to `max(beam.z) − min(beam.z)`. Since Method A
    // rim beams are inset by FOOTING_WIDTH_MM/2 each, the span is
    // lengthMm − FOOTING_WIDTH_MM. Any over-span warning must
    // report `actualMm ≈ lengthMm − FOOTING_WIDTH_MM`.
    const warnings = spanCheck(layout, IRC);
    const joistWarn = warnings.find((w) => w.kind === 'over-span-joist');
    // On a 16×16 ft deck with 2 rim beams only and 2×8 joists, the
    // full-length joist span (~4722 mm) exceeds the ~3556 mm
    // allowable → warning fires.
    expect(joistWarn).toBeDefined();
    const expected =
      design.footprint.lengthMm - FOOTING_WIDTH_MM;
    expect(joistWarn!.actualMm).toBeCloseTo(expected, 1);
  });

  it('3+ beam layout → joist span = max adjacent gap (tighter than max−min)', () => {
    // 16×16 with SpanTable + PT_2X8 → 3 beams, evenly spread → adj
    // gap = (lengthMm − FOOTING_WIDTH_MM) / 2. Span-check should
    // report the adj-gap value (not the max−min).
    const design = makeMethodA({ widthFt: 16, lengthFt: 16 });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBeGreaterThanOrEqual(3);
    // If a joist warning happens to still fire (borderline deck),
    // its actualMm must be the ADJ-gap, not the full length.
    const warnings = spanCheck(layout, IRC);
    const joistWarn = warnings.find((w) => w.kind === 'over-span-joist');
    const beamZs = beams.map((b) => b.position.z).sort((a, b) => a - b);
    // Compute the max-adjacent gap.
    let maxAdj = 0;
    for (let i = 1; i < beamZs.length; i++) {
      const g = beamZs[i]! - beamZs[i - 1]!;
      if (g > maxAdj) maxAdj = g;
    }
    // The max-adj gap is STRICTLY less than the max−min (which
    // would be beamZs[N-1] − beamZs[0]).
    const maxMinusMin = beamZs[beamZs.length - 1]! - beamZs[0]!;
    expect(maxAdj).toBeLessThan(maxMinusMin);
    if (joistWarn !== undefined) {
      // If the check fires at all it reports the ADJ span.
      expect(joistWarn.actualMm).toBeCloseTo(maxAdj, 1);
      // And NOT the pre-fix max−min.
      expect(joistWarn.actualMm).not.toBeCloseTo(maxMinusMin, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// AC1 — parametrized regression matrix: no over-span-joist on FRESH
// Method A DROP designs across a realistic matrix.
// ---------------------------------------------------------------------------

interface Ac1Case {
  widthFt: number;
  lengthFt: number;
  joist: MaterialRef;
  spacingMm: Mm;
  /** For 2×10 we must use Oldcastle (TuffBlock only accepts 2×6/2×8). */
  foundation: FoundationSpec;
}

// {12×12, 16×16, 20×24, 30×30, 40×40 ft} × {2×6, 2×8, 2×10} × {PT, Cedar}
// = 30 cases. Every 2×10 case uses Oldcastle; 2×6/2×8 use TuffBlock.
const AC1_MATRIX: readonly Ac1Case[] = (
  [
    { w: 12, l: 12 },
    { w: 16, l: 16 },
    { w: 20, l: 24 },
    { w: 30, l: 30 },
    { w: 40, l: 40 },
  ] as const
).flatMap(({ w, l }) =>
  [
    { j: PT_2X6, f: TUFFBLOCK_FOUNDATION },
    { j: PT_2X8, f: TUFFBLOCK_FOUNDATION },
    { j: PT_2X10, f: OLDCASTLE_FOUNDATION },
    { j: CEDAR_2X6, f: TUFFBLOCK_FOUNDATION },
    { j: CEDAR_2X8, f: TUFFBLOCK_FOUNDATION },
    { j: CEDAR_2X10, f: OLDCASTLE_FOUNDATION },
  ].map(({ j, f }) => ({
    widthFt: w,
    lengthFt: l,
    joist: j,
    spacingMm: 406,
    foundation: f,
  })),
);

describe('AC1 — Method A DROP: ZERO over-span-joist on fresh designs across the matrix', () => {
  const IRC = new IrcSpanTable();

  it.each(AC1_MATRIX)(
    '$widthFt×$lengthFt ft, $joist.species $joist.nominal @ $spacingMm mm o.c. (DROP) → 0 over-span-joist',
    ({ widthFt, lengthFt, joist, spacingMm, foundation }) => {
      const design = makeMethodA({
        widthFt,
        lengthFt,
        joist,
        beam: joist, // symmetric beam (satisfies flush guard trivially)
        spacingMm,
        foundation,
        beamConnection: 'drop',
      });
      const layout = computeFloatingLayout(design, { spanTable: IRC });
      const warnings = spanCheck(layout, IRC);
      const overSpan = warnings.filter((w) => w.kind === 'over-span-joist');
      expect(overSpan).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// AC2 / AC3 — fallback: no SpanTable / uncatalogued material → byte-identical
// to pre-#75 (2 rims, 2 block rows).
// ---------------------------------------------------------------------------

describe('AC2 — no SpanTable threaded → Method A layout is byte-identical to pre-#75', () => {
  it('small deck below joist allowable: layout has 2 beams + 2 block rows only', () => {
    // 8×8 ft deck. Even with SpanTable the resolver would return
    // totalRows=2. Without SpanTable it MUST also return 2 (byte-
    // identical to pre-#75).
    const design = makeMethodA({ widthFt: 8, lengthFt: 8 });
    const layout = computeFloatingLayout(design); // no spanTable
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(beams.length).toBe(2);
    const blockZs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3)),
    );
    expect(blockZs.length).toBe(2);
  });

  it('large deck WITHOUT SpanTable → also 2 beams (byte-identical fallback)', () => {
    const design = makeMethodA({ widthFt: 40, lengthFt: 40 });
    const layout = computeFloatingLayout(design); // no spanTable
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(2);
  });
});

describe('AC3 — uncatalogued joist material → totalRows = 2 fallback', () => {
  it('SpanTable returns 0 for the material → 2 beams only', () => {
    const design = makeMethodA({ widthFt: 40, lengthFt: 40 });
    const layout = computeFloatingLayout(design, {
      spanTable: ZERO_SPAN_TABLE,
    });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC7 (FR-E) — flush + interiorRows>0 → LayoutError with 3 remediations
// ---------------------------------------------------------------------------

describe('AC7 (FR-E) — flush + intermediate beam rows are REJECTED at validation', () => {
  const IRC = new IrcSpanTable();

  it('16×16 flush Method A (which would need interior beams) → throws LayoutError', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8, // equal depth → flush guard passes
      beamConnection: 'flush',
    });
    expect(() =>
      computeFloatingLayout(design, { spanTable: IRC }),
    ).toThrowError(LayoutError);
  });

  it('the thrown message names flush + intermediate beam + all three remediations', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    let caught: unknown = null;
    try {
      computeFloatingLayout(design, { spanTable: IRC });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LayoutError);
    const msg = (caught as LayoutError).message.toLowerCase();
    expect(msg).toContain('flush');
    expect(msg).toContain('intermediate beam');
    // 3 remediations: drop, reduce deck length, joists on blocks
    expect(msg).toContain('drop');
    expect(msg).toContain('reduce deck length');
    expect(msg).toContain('joists on blocks');
  });

  it('flush design that does NOT need interior beams (small deck) is ACCEPTED', () => {
    // 8×8 ft → totalRows = 2 (no interior) → flush guard does
    // NOT fire (unchanged behavior).
    const design = makeMethodA({
      widthFt: 8,
      lengthFt: 8,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    expect(() =>
      computeFloatingLayout(design, { spanTable: IRC }),
    ).not.toThrow();
  });

  it('DROP design of the same size passes (flush is the only rejected combo)', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'drop',
    });
    expect(() =>
      computeFloatingLayout(design, { spanTable: IRC }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC9 — Method B and elevated layouts are BYTE-IDENTICAL to pre-#75
// ---------------------------------------------------------------------------

describe('AC9 — Method B layouts are byte-identical to pre-#75 (this fix is Method-A-only)', () => {
  const IRC = new IrcSpanTable();

  it('Method B on a 16×16 ft deck: no beams; layout depends on blockRowsHint / default (unchanged)', () => {
    const design: DeckDesign = {
      ...makeMethodA({ widthFt: 16, lengthFt: 16 }),
      floatingFraming: 'joists-on-blocks',
      beamConnection: 'drop',
    };
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(0);
    // No difference between the two callers (spanTable threaded or
    // not); the Method B pipeline was unchanged.
    const layoutNoTable = computeFloatingLayout(design);
    const summary = (l: typeof layout): string =>
      JSON.stringify(
        l.members.map((m) => ({
          id: m.id,
          kind: m.kind,
          x: m.position.x,
          y: m.position.y,
          z: m.position.z,
        })),
      );
    // The two Method B outputs are only guaranteed equal when the
    // SpanTable's derived count matches the no-table fallback (it
    // does for typical joists on 16 ft — pre-fix span-safe default
    // already lands on 5 rows for both paths). If the paths ever
    // diverge, this ASSERTION is intentionally a hard pin to catch
    // that divergence.
    expect(summary(layout)).toBe(summary(layoutNoTable));
  });
});

// ---------------------------------------------------------------------------
// AC11 — determinism (same input → deep-equal output).
// ---------------------------------------------------------------------------

describe('AC11 — Method A layout is deterministic (deep-equal on two calls)', () => {
  const IRC = new IrcSpanTable();

  it('two calls with 3-beam layout produce deep-equal layouts', () => {
    const design = makeMethodA({ widthFt: 16, lengthFt: 16 });
    const now = (): string => design.createdAt;
    const a = computeFloatingLayout(design, { spanTable: IRC, now });
    const b = computeFloatingLayout(design, { spanTable: IRC, now });
    expect(a).toEqual(b);
  });

  it('two calls with a 5-beam layout (40 ft, 2×6 PT) produce deep-equal layouts', () => {
    const design = makeMethodA({
      widthFt: 12,
      lengthFt: 40,
      joist: PT_2X6,
      beam: PT_2X6,
    });
    const now = (): string => design.createdAt;
    const a = computeFloatingLayout(design, { spanTable: IRC, now });
    const b = computeFloatingLayout(design, { spanTable: IRC, now });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// AC15 — fast-check property: span-safety invariant
// ---------------------------------------------------------------------------

describe('AC15 — property: resolveMethodABeamRows satisfies span-safety invariants', () => {
  const IRC = new IrcSpanTable();

  it('for every legal Method A design: totalRows ∈ [2, MAX_METHOD_A_BEAM_ROWS] AND (SpanTable path) pitch ≤ allowable', () => {
    // Choose from the catalog set — we need materials the IRC
    // table knows about so the SpanTable path is exercised on
    // most iterations. Sizes bounded to the schema-legal range.
    const lengthMmArb = fc.integer({
      min: Math.round(4 * MM_PER_FOOT),
      max: Math.round(60 * MM_PER_FOOT),
    });
    const spacingArb = fc.constantFrom<Mm>(305, 406, 508, 610);
    const joistArb = fc.constantFrom<MaterialRef>(
      PT_2X6,
      PT_2X8,
      PT_2X10,
      CEDAR_2X6,
      CEDAR_2X8,
      CEDAR_2X10,
    );
    fc.assert(
      fc.property(lengthMmArb, spacingArb, joistArb, (len, sp, j) => {
        const { totalRows, interiorRows } = resolveMethodABeamRows(
          len,
          IRC,
          j,
          sp,
        );
        expect(totalRows).toBeGreaterThanOrEqual(2);
        expect(totalRows).toBeLessThanOrEqual(MAX_METHOD_A_BEAM_ROWS);
        expect(interiorRows).toBe(totalRows - 2);
        // Span-safety invariant: if the SpanTable knows the
        // material AND totalRows > 2 (i.e., the SpanTable path
        // actually drove the count), then the row pitch must be
        // ≤ allowable (or the cap prevented reaching it).
        const allowable = IRC.lookupJoistMaxSpan(j, sp);
        if (allowable > 0 && totalRows > 2 && totalRows < MAX_METHOD_A_BEAM_ROWS) {
          const pitch = len / (totalRows - 1);
          expect(pitch).toBeLessThanOrEqual(allowable);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// AC12 — BOM smoke: interior beams + their blocks fold into the cut list
// (per-length parity — mirror of PR #73 pattern; the BOM module is not
// re-imported here to keep this file scoped to layout invariants; the
// full parity test lives in `src/domain/bom/derive-bom.test.ts` under
// the "Method A interior beams" describe block added in this PR).
// This test file pins the LAYOUT side: interior beams share the same
// material and length as the rim beams so they are guaranteed to be
// packed under the same SKU by the existing per-kind BOM rule.
// ---------------------------------------------------------------------------

describe('AC12 layout-side — interior beams share SKU + length with rim beams', () => {
  const IRC = new IrcSpanTable();

  it('every beam has size.x = footprint.widthMm and identical material', () => {
    const design = makeMethodA({ widthFt: 16, lengthFt: 40, joist: PT_2X6, beam: PT_2X6 });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBeGreaterThanOrEqual(3);
    for (const b of beams) {
      expect(b.size.x).toBeCloseTo(design.footprint.widthMm, 6);
      expect(b.material).toEqual({ kind: 'lumber', ...design.beam.material });
    }
  });
});
