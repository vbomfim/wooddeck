/**
 * `src/domain/bom/derive-bom-method-a-intermediate-beams.qa.test.ts` —
 * QA Guardian coverage for issue #75 (AC12 / FR-D) BOM TOTALS.
 *
 * The developer's `derive-bom.test.ts` proves no interior beam is
 * silently DROPPED (per-length `actual >= expected`). It does NOT prove
 * the TOTALS are right: the correct total beam LINEAL FOOTAGE and the
 * correct total BLOCK COUNT for the extra interior rows.
 *
 * This test isolates the beam SKU (beam nominal ≠ joist ≠ decking) so
 * the beam section's cut list contains EXACTLY the beams — letting us
 * assert exact totals rather than a lower bound.
 *
 * Tag: [AC-12] [COVERAGE]
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign } from '../model';
import { MM_PER_FOOT } from '../units';
import { computeLayout } from '../layout/layout-engine';
import { IrcSpanTable } from '../spans/irc-2018-tables';

import { deriveBom } from './derive-bom';

const IRC = new IrcSpanTable();

// 16×40 ft floating Method A DROP. 2×6 joists → several interior beam
// rows. Beam = 2×10 (DISTINCT nominal → the beam SKU section contains
// ONLY beams); decking = 5/4×6 (distinct again).
const DESIGN: DeckDesign = {
  id: '44444444-4444-4444-8444-000000000075',
  createdAt: '2026-07-05T00:00:00.000Z',
  footprint: { widthMm: 16 * MM_PER_FOOT, lengthMm: 40 * MM_PER_FOOT, heightMm: 3 * MM_PER_FOOT },
  structure: 'floating',
  floatingFraming: 'beams-and-joists',
  beamConnection: 'drop',
  foundation: { type: 'deck-blocks', product: { productId: 'oldcastle-11x11x7' } },
  joist: { material: { nominal: '2x6', species: 'PT', grade: 'No2' }, spacingMm: 406 },
  beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
  decking: { material: { nominal: '5/4x6', species: 'PT', grade: 'No2' }, orientation: 'parallel-to-width' },
  layout: { bayRemainderStrategy: 'extra-bay-at-end' },
};

describe('deriveBom — issue #75 Method A interior-beam TOTALS (lineal footage + block count) [AC-12][COVERAGE]', () => {
  it('beam SKU carries exactly N beams of full width, and the BOM block count = totalRows × cols', () => {
    const layout = computeLayout(DESIGN, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');

    // Precondition: interior rows were added (else this degenerates to
    // the pre-#75 2-rim shape).
    expect(beams.length).toBeGreaterThan(2);

    const bom = deriveBom(layout, {});

    // --- Beam lineal footage --------------------------------------------
    // Beam is 2×10 — a SKU no other member uses (joist 2×6, decking
    // 5/4×6, blocking 2×6). So the beam section's cuts ARE the beams.
    const beamSection = bom.lumber.find(
      (s) => s.nominal === '2x10' && s.species === 'PT' && s.grade === 'No2',
    );
    expect(beamSection).toBeDefined();
    const beamCuts = beamSection!.pack.stockBoards.flatMap((b) =>
      b.cuts.map((c) => c.lengthMm),
    );
    // Exactly one cut per beam.
    expect(beamCuts.length).toBe(beams.length);
    // Every beam runs the full deck width (+x).
    for (const len of beamCuts) {
      expect(len).toBeCloseTo(DESIGN.footprint.widthMm, 3);
    }
    // Total lineal footage = N beams × width — interior beams fully
    // accounted for, none double-counted or dropped.
    const totalBeamLineal = beamCuts.reduce((a, b) => a + b, 0);
    expect(totalBeamLineal).toBeCloseTo(
      beams.length * DESIGN.footprint.widthMm,
      3,
    );

    // --- Block count ----------------------------------------------------
    // All blocks are one product → one foundation line whose count is
    // the whole grid (one row of blocks under every beam row).
    const totalBomBlocks = bom.foundation.reduce((a, s) => a + s.count, 0);
    expect(totalBomBlocks).toBe(blocks.length);
    // And the grid is exactly totalRows × cols (rows == beam rows).
    const uniqueBlockXs = new Set(
      blocks.map((b) => Math.round(b.position.x * 1e3) / 1e3),
    );
    expect(totalBomBlocks).toBe(beams.length * uniqueBlockXs.size);
  });
});
