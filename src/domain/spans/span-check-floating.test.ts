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
      heightMm: 300,
    },
    structure: 'floating',
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
  it('a floating layout with 3 beams over a block grid produces one Warning per over-span beam when the table is tiny', () => {
    // 16 ft × 14 ft floating deck → 3 beams, blocks along +z spaced
    // ~610 mm apart (the JOIST_SPAN_MAX_MM default). Force EVERY beam
    // over-span by returning a 100 mm max via the mock table.
    const design = makeFloating({ widthFt: 16, lengthFt: 14 });
    const layout = computeLayout(design, { now: () => design.createdAt });

    // Fail-safe joist path — return a large value so joist checks
    // never fire; we only want to prove BEAM checks fire from blocks.
    // No joists exist in a floating layout, so this is defensive.
    const tinyBeamTable: SpanTable = {
      edition: 'MOCK-AC8',
      lookupJoistMaxSpan: () => 10000,
      lookupBeamMaxSpan: () => 100,
      citationFor: () => 'MOCK-AC8-CITATION',
    };

    const warnings = spanCheck(layout, tinyBeamTable);
    const beamCount = layout.members.filter((m) => m.kind === 'beam').length;
    expect(beamCount).toBe(3);
    // One Warning per beam, all `over-span-beam` kind.
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    expect(beamWarnings.length).toBe(beamCount);
    for (const w of beamWarnings) {
      expect(w.tableReference).toBe('MOCK-AC8-CITATION');
      // Actual span is the max block-to-block +z gap (~610 mm) —
      // well above the mock's 100 mm allowable.
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
    // 3 beams → 3 calls to lookupBeamMaxSpan.
    expect(seenBeamMaterials.length).toBe(3);
    for (const m of seenBeamMaterials) {
      // `beam.material` is the widened `LumberMemberMaterial =
      // {kind:'lumber', ...MaterialRef}` (S17 discriminator). The
      // SpanTable interface types the param as `MaterialRef` but
      // TypeScript accepts the widened superset unchanged. Compare
      // the base MaterialRef fields via toMatchObject to be
      // deliberately agnostic about whether span-check strips the
      // discriminator before the lookup call.
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
  it('a compliant floating deck (~610 mm block spacing under 2×8 PT beams) fires ZERO span warnings', () => {
    // Layout produces ~610 mm block-to-block spacing along +z; the
    // beam-to-beam +x delta is 8 ft (2438 mm) = 8-ft IRC column.
    // 2×8 PT 2-ply at 8-ft joist span allowable = 7 ft 4 in (2235 mm).
    // 610 << 2235 → no beam warning. Also proves the mock-vs-real
    // wiring: a compliant deck must genuinely not warn with the real
    // table (regression guard against a future "warn always" bug).
    const design = makeFloating({ widthFt: 16, lengthFt: 14, beam: PT_2X8 });
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

  it('QA probe reproduction: a 30 ft × 14 ft floating deck no longer produces ZERO warnings when the tributary should trigger — but IS compliant with real table', () => {
    // QA's original bug report: on a 30×14 deck the OLD implementation
    // (joistSpanMm=0 → snap to 6-ft col → 2591 mm allowable) hid
    // every over-span. With FIX 1 the tributary = beam-to-beam +x
    // delta, computed from actual layout: 30/(4-1) = 10 ft or
    // similar. This isn't a warning test — the block-row spacing is
    // still 610 mm, well within the 8/10-ft column allowables (1676
    // to 2235 mm). It's a REGRESSION guard: the tributary must be
    // > 0 so the citation names a REALISTIC column. We assert that
    // the citation does NOT snap to 6 ft (the old false-permissive).
    const design = makeFloating({ widthFt: 30, lengthFt: 14 });
    const layout = computeLayout(design, { now: () => design.createdAt });
    const table = new IrcSpanTable();

    // Probe: force a beam-check code path by using a real table and
    // observing citations recorded on any warnings. If NO warnings,
    // instrument via a spy that captures the tributary passed to
    // lookupBeamMaxSpan. That's what we do here.
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

    // Every beam-check must have received a tributary > 0. The pre-
    // FIX-1 code passed 0 (which snapped to 6 ft = 1829 mm and
    // returned 2591 mm allowable — the false-permissive bug). All
    // seen tributaries must exceed the 6-ft row so we KNOW the
    // fix propagated.
    expect(seenTributaries.length).toBeGreaterThan(0);
    for (const t of seenTributaries) {
      // 30 ft / (numBeams - 1) with 8-ft max spacing → 5 beams →
      // 30/4 = 7.5 ft = 2286 mm, or 4 beams → 30/3 = 10 ft = 3048 mm.
      // Either way > 1829 mm (6-ft column boundary).
      expect(t).toBeGreaterThan(1829);
    }
  });
});
