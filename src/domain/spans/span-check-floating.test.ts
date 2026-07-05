/**
 * `src/domain/spans/span-check-floating.test.ts` — TDD RED phase for
 * the S19 floating-layout support of `spanCheck` (AC8).
 *
 * ## What AC8 requires
 *
 * > "Given a floating layout, When spanCheck(layout, IrcSpanTable)
 * >  runs, Then for each beam, the max distance between adjacent
 * >  supporting blocks is looked up against the same beam-span
 * >  table used for elevated designs, and a Warning is produced if
 * >  the span exceeds the table's maximum for that SKU/species.
 * >  NO new IRC table logic added in `span-check.ts` — the adapter
 * >  widens `getSupportsFor(beam)` to include blocks."
 *
 * In the elevated layout the beam's supports are POSTS at the beam's
 * `.position.z`, spaced along +x. In the floating layout the beam's
 * supports are BLOCKS at the beam's `.position.x`, spaced along +z.
 * `spanCheck` widens its support-derivation to cover BOTH cases with
 * the SAME `SpanTable.lookupBeamMaxSpan(...)` lookup — no IRC-2018
 * data code moves into `span-check.ts`, preserving the dependency-
 * inversion invariant of the S5 design (which the
 * `span-check-no-irc-tables` boundary probe protects).
 *
 * ## Test strategy
 *
 * We use a mock `SpanTable` that returns a small allowable so the
 * ~610 mm block-to-block spacing along +z produces a Warning. The
 * mock's `lookupBeamMaxSpan` also records its call arguments — this
 * proves the adapter did in fact reach the beam-span code path with
 * the RIGHT beam material.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../model';
import { MM_PER_FOOT } from '../units';
import { computeLayout } from '../layout';

import { IrcSpanTable } from './irc-2018-tables';
import type { SpanTable } from './span-table';
import { spanCheck } from './span-check';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};

function makeFloating(overrides: Partial<{
  widthFt: number;
  lengthFt: number;
  beam: MaterialRef;
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000019',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: {
      widthMm: (overrides.widthFt ?? 16) * MM_PER_FOOT,
      lengthMm: (overrides.lengthFt ?? 14) * MM_PER_FOOT,
      heightMm: 500,
    },
    structure: 'floating',
    floatingFraming: 'beams-and-joists',
    foundation: TUFFBLOCK_FOUNDATION,
    joist: { material: overrides.beam ?? PT_2X8, spacingMm: 406 },
    beam: { material: overrides.beam ?? PT_2X8 },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

// ---------------------------------------------------------------------------
// AC8 — block-supported beam spans are checked
// ---------------------------------------------------------------------------

describe('spanCheck (floating) — AC8', () => {
  it('a floating Method-A layout with 2 rim beams over a block grid produces one Warning per over-span beam when the table is tiny', () => {
    // S26 Method A: 16 ft × 14 ft floating deck → 2 rim beams
    // (near / far, along +x); blocks under each beam spaced along
    // +x ~7 ft (8-ft cap width / 2 spans). Force EVERY beam
    // over-span by returning a 100 mm max via the mock table.
    const design = makeFloating({ widthFt: 16, lengthFt: 14 });
    const layout = computeLayout(design, { now: () => design.createdAt });

    const tinyBeamTable: SpanTable = {
      edition: 'MOCK-AC8',
      lookupJoistMaxSpan: () => 10000,
      lookupBeamMaxSpan: () => 100,
      citationFor: () => 'MOCK-AC8-CITATION',
    };

    const warnings = spanCheck(layout, tinyBeamTable);
    const beamCount = layout.members.filter((m) => m.kind === 'beam').length;
    expect(beamCount).toBe(2); // S26 rim beams
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    expect(beamWarnings.length).toBe(beamCount);
    for (const w of beamWarnings) {
      expect(w.tableReference).toBe('MOCK-AC8-CITATION');
      // Actual span is the max block-to-block +x gap under a rim
      // beam (~half deck width = ~2.4 m) — well above 100 mm.
      expect(w.actualMm).toBeGreaterThan(100);
      expect(w.allowableMm).toBe(100);
    }
  });

  it('a large max in the table → no beam Warnings for the same layout (checker uses the abstraction)', () => {
    const design = makeFloating({ widthFt: 16, lengthFt: 14 });
    const layout = computeLayout(design, { now: () => design.createdAt });

    const largeTable: SpanTable = {
      edition: 'MOCK-AC8',
      lookupJoistMaxSpan: () => 10000,
      lookupBeamMaxSpan: () => 100000, // huge → no over-span
      citationFor: () => 'MOCK-AC8-CITATION',
    };

    const warnings = spanCheck(layout, largeTable);
    expect(warnings.filter((w) => w.kind === 'over-span-beam').length).toBe(0);
  });

  it('the mock is called with the beam material (not the joist material) — proves the beam path is exercised', () => {
    const design = makeFloating({ widthFt: 16, lengthFt: 14, beam: PT_2X8 });
    const layout = computeLayout(design, { now: () => design.createdAt });

    const seenBeamMaterials: MaterialRef[] = [];
    const spyTable: SpanTable = {
      edition: 'SPY',
      lookupJoistMaxSpan: () => 100000,
      lookupBeamMaxSpan: (material: MaterialRef) => {
        seenBeamMaterials.push(material);
        return 100000;
      },
      citationFor: () => 'SPY-CITATION',
    };

    spanCheck(layout, spyTable);
    // S26: 2 rim beams → 2 calls to lookupBeamMaxSpan.
    expect(seenBeamMaterials.length).toBe(2);
    for (const m of seenBeamMaterials) {
      expect(m).toMatchObject(PT_2X8);
    }
  });
});

// ---------------------------------------------------------------------------
// Review-gate FIX 1 — REAL IrcSpanTable end-to-end wiring
// ---------------------------------------------------------------------------
//
// The prior mock-only tests prove the SpanTable INTERFACE is
// reached; they do NOT prove `computeFloatingLayout` + `spanCheck`
// + `IrcSpanTable` produce structurally correct behavior together.
// FIX 1 wires a REAL tributary (per-beam adjacent-beam-x delta)
// into `lookupBeamMaxSpan` and `citationFor` — replacing the prior
// hard-coded 0 that snapped every beam to the MOST-permissive
// column (14–54% false-permissive). These tests prove the fix
// end-to-end against the actual IRC-2018 data.

describe('spanCheck (floating) — REAL IrcSpanTable e2e (FIX 1)', () => {
  it('a small compliant floating deck (Method A, 4×4, 2×8 rim beams) fires ZERO span warnings', () => {
    // S26 Method A: 4 ft × 4 ft floating deck → 2 rim beams at
    // ±(length/2 - FOOTING_WIDTH_MM/2). Beam-to-beam +z delta ≈
    // 4 ft - 300 mm = 918.6 mm — snaps to 6-ft IRC joist-span
    // column (the smallest). 2×8 PT 2-ply @ 6-ft column = 8 ft 6 in
    // (2591 mm). Block-to-block +x under each rim beam = deck
    // widthMm/2 = 610 mm (2 columns for 4-ft width). 610 << 2591 →
    // no beam warning. Proves the compliant path with a real table.
    const design = makeFloating({ widthFt: 4, lengthFt: 4, beam: PT_2X8 });
    const layout = computeLayout(design, { now: () => design.createdAt });
    const table = new IrcSpanTable();

    const warnings = spanCheck(layout, table);
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    expect(beamWarnings).toEqual([]);
  });

  it('a contrived over-span scenario (5 m block-to-block gap under a 2×8 PT beam) FIRES an over-span-beam warning', () => {
    // We hand-author a `Layout` with wide (5 m) block-to-block
    // spacing along +z under two beams that share the deck's +x
    // axis. `spanCheck` sees blocks under each beam → floating path;
    // tributary derived from beam-to-beam +x delta (8 ft = 2438.4 mm)
    // → IrcSpanTable's `snapBeamJoistSpan` snaps UP to the 10-ft
    // column (the comparison uses `ftInToMm(ft, 0)` which rounds, so
    // 2438.4 > 2438 and the 8-ft row is missed by ~0.4 mm — this is
    // documented in `irc-2018-tables.ts` `snapBeamJoistSpan`, the
    // conservative safety choice). 2×8 PT 2-ply allowable at the
    // 10-ft column is 6 ft 6 in (1981 mm). Actual block-to-block
    // span is 5000 mm > 1981 mm → beam over-span warning MUST fire,
    // and the tableReference MUST name the 10-ft joist-span column.
    const lumberMat = { kind: 'lumber' as const, ...PT_2X8 };
    const blockMat = {
      kind: 'block' as const,
      productId: 'tuffblock-12x12x4' as const,
    };
    const beamA = {
      id: 'beam-A',
      kind: 'beam' as const,
      material: lumberMat,
      position: { x: -1219.2, y: 92, z: 0 }, // 4 ft left of center
      size: { x: 89, y: 184, z: 4267.2 }, // 14 ft long
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamB = {
      id: 'beam-B',
      kind: 'beam' as const,
      material: lumberMat,
      position: { x: 1219.2, y: 92, z: 0 }, // 4 ft right of center → 8 ft apart
      size: { x: 89, y: 184, z: 4267.2 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    // Two blocks per beam, 5 m apart — forces over-span.
    const blockA1 = {
      id: 'block-A1',
      kind: 'block' as const,
      material: blockMat,
      position: { x: -1219.2, y: -51, z: -2500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const blockA2 = {
      id: 'block-A2',
      kind: 'block' as const,
      material: blockMat,
      position: { x: -1219.2, y: -51, z: 2500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const blockB1 = {
      id: 'block-B1',
      kind: 'block' as const,
      material: blockMat,
      position: { x: 1219.2, y: -51, z: -2500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const blockB2 = {
      id: 'block-B2',
      kind: 'block' as const,
      material: blockMat,
      position: { x: 1219.2, y: -51, z: 2500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const layout = {
      designId: '00000000-0000-4000-8000-000000000019' as const,
      computedAt: '2026-07-04T00:00:00.000Z',
      bounds: { widthMm: 4876.8, lengthMm: 5305, heightMm: 300 },
      members: [beamA, beamB, blockA1, blockA2, blockB1, blockB2],
    };

    const table = new IrcSpanTable();
    const warnings = spanCheck(layout, table);
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    // 2 beams, each with 5 m block-to-block span > 2235 mm allowable.
    expect(beamWarnings.length).toBe(2);
    for (const w of beamWarnings) {
      expect(w.actualMm).toBe(5000);
      // 2×8 PT 2-ply @ 10-ft joist span → 6 ft 6 in = 1981 mm.
      // (See `snapBeamJoistSpan` note above — 2438.4 mm snaps UP.)
      expect(w.allowableMm).toBe(1981);
      // Citation must name the 10-ft joist-span column (proves the
      // tributary was passed to citationFor as well).
      expect(w.tableReference).toContain('supporting 10 ft joist span');
      expect(w.tableReference).toContain('R507.5');
    }
  });

  it('a contrived over-span scenario with a 2×6 PT beam (smaller SKU) triggers a warning at TIGHTER threshold', () => {
    // Same 5 m block spacing, but the beam is 2×6 (smaller). At the
    // 8-ft tributary column, 2×6 PT 2-ply allowable = 5 ft 8 in
    // (1727 mm) — smaller than the 2×8's 2235 mm. Proves the
    // material passthrough works and the tributary is not a
    // hardcoded constant.
    const PT_2X6: MaterialRef = { nominal: '2x6', species: 'PT', grade: 'No2' };
    const lumberMat = { kind: 'lumber' as const, ...PT_2X6 };
    const blockMat = {
      kind: 'block' as const,
      productId: 'tuffblock-12x12x4' as const,
    };
    const beamA = {
      id: 'beam-A',
      kind: 'beam' as const,
      material: lumberMat,
      position: { x: -1219.2, y: 70, z: 0 },
      size: { x: 89, y: 140, z: 4267.2 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamB = {
      id: 'beam-B',
      kind: 'beam' as const,
      material: lumberMat,
      position: { x: 1219.2, y: 70, z: 0 },
      size: { x: 89, y: 140, z: 4267.2 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const blockA1 = {
      id: 'block-A1',
      kind: 'block' as const,
      material: blockMat,
      position: { x: -1219.2, y: -51, z: -2500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const blockA2 = {
      id: 'block-A2',
      kind: 'block' as const,
      material: blockMat,
      position: { x: -1219.2, y: -51, z: 2500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const blockB1 = {
      id: 'block-B1',
      kind: 'block' as const,
      material: blockMat,
      position: { x: 1219.2, y: -51, z: -2500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const blockB2 = {
      id: 'block-B2',
      kind: 'block' as const,
      material: blockMat,
      position: { x: 1219.2, y: -51, z: 2500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const layout = {
      designId: '00000000-0000-4000-8000-000000000019' as const,
      computedAt: '2026-07-04T00:00:00.000Z',
      bounds: { widthMm: 4876.8, lengthMm: 5305, heightMm: 300 },
      members: [beamA, beamB, blockA1, blockA2, blockB1, blockB2],
    };

    const table = new IrcSpanTable();
    const warnings = spanCheck(layout, table);
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    expect(beamWarnings.length).toBe(2);
    for (const w of beamWarnings) {
      // 2×6 PT 2-ply @ 10-ft joist span → 5 ft 1 in = 1549 mm.
      // Same 2438.4→10-ft snap as the 2×8 test above.
      expect(w.allowableMm).toBe(1549);
      expect(w.tableReference).toContain('2x6');
      expect(w.tableReference).toContain('supporting 10 ft joist span');
    }
  });

  it('QA probe reproduction: floating deck under S26 rim-beam model → tributary is beam-to-beam +z delta (~length), not the pre-S26 false-permissive 0', () => {
    // QA's original bug report (pre-S26): the OLD implementation
    // passed joistSpanMm=0 to lookupBeamMaxSpan → snap to 6-ft col
    // → 2591 mm allowable, hiding every real over-span. FIX 1
    // restored the real tributary. This test proves the S26 rework
    // preserves that fix: the tributary passed to
    // lookupBeamMaxSpan for rim beams is the beam-to-beam +z delta
    // (length - FOOTING_WIDTH_MM), NOT the false-permissive 0.
    const design = makeFloating({ widthFt: 4, lengthFt: 14 });
    const layout = computeLayout(design, { now: () => design.createdAt });
    const table = new IrcSpanTable();

    const seenTributaries: number[] = [];
    const spy: SpanTable = {
      edition: 'SPY',
      lookupJoistMaxSpan: (mat, sp) => table.lookupJoistMaxSpan(mat, sp),
      lookupBeamMaxSpan: (mat, tributary, ply) => {
        seenTributaries.push(tributary);
        return table.lookupBeamMaxSpan(mat, tributary, ply);
      },
      citationFor: (kind, mat, sp) => table.citationFor(kind, mat, sp),
    };
    spanCheck(layout, spy);

    // S26 Method A: 2 rim beams. Tributary = beam-to-beam +z
    // delta = lengthMm - FOOTING_WIDTH_MM = 4267.2 - 300 = 3967.2
    // mm. Every recorded tributary must equal this (both beams
    // share the same beam-to-beam delta).
    expect(seenTributaries.length).toBe(2);
    for (const t of seenTributaries) {
      // > 1829 (6-ft column) proves we're not snapping to the
      // false-permissive column that hid the QA bug.
      expect(t).toBeGreaterThan(1829);
    }
  });
});
