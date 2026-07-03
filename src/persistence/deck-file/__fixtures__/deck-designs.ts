/**
 * Shared fixtures + `fast-check` arbitraries for the persistence
 * layer's unit tests. Imported ONLY by files under `src/persistence/**`
 * whose name ends in `.test.ts` — this module is therefore expected to
 * appear as an orphan in `dependency-cruiser` (warn-only, matches the
 * existing `src/domain/layout/__fixtures__/fixtures-data.ts` pattern).
 *
 * ## What lives here
 *
 * - `GOLDEN_DECK_DESIGN` — the same hand-crafted design used by
 *   `src/domain/model.test.ts` (kept in sync verbatim so a byte-level
 *   round-trip failure in one layer surfaces in the other).
 * - `SECOND_GOLDEN_DECK_DESIGN` — a second, structurally different
 *   design used to prove `localStorage` overwrite / clear tests are
 *   really discriminating between values.
 * - `deckDesignArb` — a `fast-check` arbitrary that generates every
 *   `DeckDesign` shape S3 already property-tests (see
 *   `src/domain/model.test.ts` — this file is a straight port so the
 *   round-trip property test in S6 exercises the same value space).
 *
 * ## Why NOT re-export from `src/domain/model.test.ts`
 *
 * Test files are excluded from `dependency-cruiser`'s graph
 * (`.dependency-cruiser.cjs` → `exclude.path`) and Vitest's collection
 * pattern would try to double-run any file matching `*.test.ts`. A
 * plain `.ts` under `__fixtures__/` sidesteps both.
 */
import fc from 'fast-check';

import type { DeckDesign, LumberNominal, MaterialRef, Species } from '../../../domain/model';

// ---------------------------------------------------------------------------
// Golden fixtures — pinned literals
// ---------------------------------------------------------------------------

/**
 * Same value the S3 model tests use — kept byte-identical so a
 * regression in either the domain layer or the persistence layer
 * surfaces in the OTHER test suite too (belt + suspenders).
 */
export const GOLDEN_DECK_DESIGN: DeckDesign = {
  id: '018f4e7a-c1c5-4a3f-8f52-3a0f6c9d1e4b',
  createdAt: '2026-07-02T21:00:00.000Z',
  footprint: { widthMm: 3658, lengthMm: 4877, heightMm: 914 },
  joist: {
    material: { nominal: '2x8', species: 'PT', grade: 'No2' },
    spacingMm: 406,
  },
  beam: {
    material: { nominal: '2x10', species: 'PT', grade: 'No2' },
  },
  post: {
    material: { nominal: '6x6', species: 'PT', grade: 'No2' },
  },
  decking: {
    material: { nominal: '5/4x6', species: 'Composite', grade: 'NA' },
    orientation: 'parallel-to-width',
  },
  layout: { bayRemainderStrategy: 'extra-bay-at-end' },
};

/**
 * A second, structurally different design — used by localStorage tests
 * to prove `save(A)` then `save(B)` then `load()` returns B (not A) and
 * `clear()` really wipes the slot. Keeping this outside the property
 * test's value space avoids accidental collisions.
 */
export const SECOND_GOLDEN_DECK_DESIGN: DeckDesign = {
  id: '018f4e7a-c1c5-4a3f-8f52-3a0f6c9d1e4c',
  createdAt: '2026-07-03T09:15:30.000Z',
  footprint: { widthMm: 6100, lengthMm: 9144, heightMm: 1219 },
  joist: {
    material: { nominal: '2x10', species: 'Cedar', grade: 'No2' },
    spacingMm: 305,
  },
  beam: { material: { nominal: '2x12', species: 'Cedar', grade: 'No2' } },
  post: { material: { nominal: '4x4', species: 'PT', grade: 'No2' } },
  decking: {
    material: { nominal: '2x6', species: 'Cedar', grade: 'No2' },
    orientation: 'parallel-to-length',
  },
  layout: { bayRemainderStrategy: 'centered' },
};

// ---------------------------------------------------------------------------
// `fast-check` arbitrary — port of `src/domain/model.test.ts`
// ---------------------------------------------------------------------------

const NOMINALS_2X: readonly LumberNominal[] = ['2x6', '2x8', '2x10', '2x12'];
const POST_NOMINALS: readonly LumberNominal[] = ['4x4', '6x6'];
const DECKING_NOMINALS: readonly LumberNominal[] = ['2x6', '5/4x6'];
const PT_CEDAR: readonly Species[] = ['PT', 'Cedar'];

function ptCedarNo2Arb(nominals: readonly LumberNominal[]): fc.Arbitrary<MaterialRef> {
  return fc
    .record({
      nominal: fc.constantFrom(...nominals),
      species: fc.constantFrom(...PT_CEDAR),
    })
    .map(
      (r): MaterialRef => ({
        nominal: r.nominal,
        species: r.species,
        grade: 'No2',
      }),
    );
}

function compositeDeckingArb(): fc.Arbitrary<MaterialRef> {
  return fc.constantFrom(...DECKING_NOMINALS).map(
    (nominal): MaterialRef => ({
      nominal,
      species: 'Composite',
      grade: 'NA',
    }),
  );
}

const deckingMaterialArb: fc.Arbitrary<MaterialRef> = fc.oneof(
  ptCedarNo2Arb(DECKING_NOMINALS),
  compositeDeckingArb(),
);

/**
 * Generator that yields DeckDesigns spanning every catalog triple
 * S3 declares — used by AC1's round-trip property test (200 runs).
 */
export const deckDesignArb: fc.Arbitrary<DeckDesign> = fc
  .record({
    id: fc.uuid({ version: 4 }),
    createdAtEpochMs: fc.integer({ min: 0, max: 4102444800000 }), // ≤ year 2100
    widthMm: fc.integer({ min: 1000, max: 20000 }),
    lengthMm: fc.integer({ min: 1000, max: 20000 }),
    heightMm: fc.integer({ min: 0, max: 3000 }),
    joistMaterial: ptCedarNo2Arb(NOMINALS_2X),
    joistSpacingMm: fc.constantFrom(305, 406, 610), // 12" / 16" / 24" o.c.
    beamMaterial: ptCedarNo2Arb(NOMINALS_2X),
    postMaterial: ptCedarNo2Arb(POST_NOMINALS),
    deckingMaterial: deckingMaterialArb,
    orientation: fc.constantFrom('parallel-to-length' as const, 'parallel-to-width' as const),
    bayRemainderStrategy: fc.constantFrom(
      'extra-bay-at-end' as const,
      'centered' as const,
    ),
  })
  .map(
    (r): DeckDesign => ({
      id: r.id,
      createdAt: new Date(r.createdAtEpochMs).toISOString(),
      footprint: { widthMm: r.widthMm, lengthMm: r.lengthMm, heightMm: r.heightMm },
      joist: { material: r.joistMaterial, spacingMm: r.joistSpacingMm },
      beam: { material: r.beamMaterial },
      post: { material: r.postMaterial },
      decking: { material: r.deckingMaterial, orientation: r.orientation },
      layout: { bayRemainderStrategy: r.bayRemainderStrategy },
    }),
  );
