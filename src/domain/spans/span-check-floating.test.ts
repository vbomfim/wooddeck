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
