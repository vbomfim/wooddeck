/**
 * `src/persistence/blocking-roundtrip.test.ts` — QA Guardian
 * coverage for issue #72 acceptance: a saved + reloaded design
 * recomputes IDENTICAL blocking (deterministic round-trip).
 *
 * ## Why the persistence layer (not domain)
 *
 * Persistence stores the DESIGN, never the computed layout — the
 * layout (and therefore the blocking) is RECOMPUTED on load. So the
 * "persistence round-trip is stable" acceptance reduces to: does
 * `computeLayout(deserialize(serialize(design)).design)` produce the
 * SAME blocking members as `computeLayout(design)`? This lives in
 * `src/persistence/**` because the layer rules permit
 * persistence → domain imports (a domain test may NOT import
 * persistence).
 *
 * Tag: [AC-7] [REGRESSION]
 */
import { describe, expect, it } from 'vitest';

import { computeLayout } from '../domain/layout/layout-engine';
import type { DeckDesign, LayoutMember } from '../domain/model';
import { MM_PER_FOOT } from '../domain/units';

import { deserialize, serialize } from './deck-file/schema-v2';

function blockingOf(design: DeckDesign): readonly LayoutMember[] {
  // Fixed clock so `computedAt` never perturbs equality.
  const layout = computeLayout(design, { now: () => design.createdAt });
  return layout.members.filter((m) => m.kind === 'blocking');
}

/** A representative elevated + a representative floating design.
 *  Both exercise the blocking emitter through the persistence seam. */
const ELEVATED: DeckDesign = {
  id: '11111111-1111-4111-8111-000000000072',
  createdAt: '2026-07-05T00:00:00.000Z',
  footprint: { widthMm: 16 * MM_PER_FOOT, lengthMm: 20 * MM_PER_FOOT, heightMm: 914 },
  structure: 'elevated',
  floatingFraming: 'beams-and-joists',
  beamConnection: 'drop',
  foundation: {
    type: 'posts-on-footings',
    post: { nominal: '6x6', species: 'PT', grade: 'No2' },
    footing: { widthMm: 300, depthMm: 300 },
  },
  joist: { material: { nominal: '2x10', species: 'PT', grade: 'No2' }, spacingMm: 406 },
  beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
  decking: { material: { nominal: '5/4x6', species: 'PT', grade: 'No2' }, orientation: 'parallel-to-width' },
  layout: { bayRemainderStrategy: 'extra-bay-at-end' },
};

const FLOATING_B: DeckDesign = {
  id: '22222222-2222-4222-8222-000000000072',
  createdAt: '2026-07-05T00:00:01.000Z',
  footprint: { widthMm: 16 * MM_PER_FOOT, lengthMm: 14 * MM_PER_FOOT, heightMm: 500 },
  structure: 'floating',
  floatingFraming: 'joists-on-blocks',
  beamConnection: 'drop',
  foundation: { type: 'tuffblocks', product: { productId: 'tuffblock-12x12x4' } },
  joist: { material: { nominal: '2x8', species: 'PT', grade: 'No2' }, spacingMm: 406 },
  beam: { material: { nominal: '2x8', species: 'PT', grade: 'No2' } },
  decking: { material: { nominal: '5/4x6', species: 'PT', grade: 'No2' }, orientation: 'parallel-to-width' },
  layout: { bayRemainderStrategy: 'extra-bay-at-end' },
};

describe('issue #72 — blocking survives a persistence round-trip unchanged [AC-7][REGRESSION]', () => {
  for (const [name, design] of [
    ['elevated posts-on-footings', ELEVATED],
    ['floating Method B', FLOATING_B],
  ] as const) {
    it(`${name}: serialize → deserialize → recompute yields deep-equal blocking`, () => {
      const before = blockingOf(design);
      expect(before.length).toBeGreaterThan(0);

      const reloaded = deserialize(serialize(design)).design;
      const after = blockingOf(reloaded);

      // Deterministic: the reloaded design must recompute byte-equal
      // blocking (same ids, positions, sizes, material).
      expect(after).toEqual(before);
    });
  }

  it('the reloaded design is deep-equal to the original (no field lost through the .deck envelope)', () => {
    const reloaded = deserialize(serialize(ELEVATED)).design;
    expect(reloaded).toEqual(ELEVATED);
  });
});
