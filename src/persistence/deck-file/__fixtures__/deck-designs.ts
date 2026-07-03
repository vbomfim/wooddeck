/**
 * Shared fixtures for the persistence layer's unit tests. Imported ONLY
 * by files under `src/persistence/**` whose name ends in `.test.ts`.
 *
 * ## What lives here
 *
 * - `GOLDEN_DECK_DESIGN` — the same hand-crafted design used by
 *   `src/domain/model.test.ts` (kept in sync verbatim so a byte-level
 *   round-trip failure in one layer surfaces in the other).
 * - `SECOND_GOLDEN_DECK_DESIGN` — a second, structurally different
 *   design used to prove `localStorage` overwrite / clear tests are
 *   really discriminating between values.
 * - `deckDesignArb` — re-exported from
 *   `src/domain/__testing__/deck-design-arb.ts`, the SINGLE source of
 *   truth used by both S3 and S6 property tests. Duplicating the
 *   generator previously created a catalog-drift risk (Opus #3 / Dev #7
 *   review finding); the shared module retires it.
 *
 * ## Why NOT re-export from `src/domain/model.test.ts`
 *
 * Test files are excluded from `dependency-cruiser`'s graph
 * (`.dependency-cruiser.cjs` → `exclude.path`) and Vitest's collection
 * pattern would try to double-run any file matching `*.test.ts`. A
 * plain `.ts` under `__testing__/` (domain) or `__fixtures__/`
 * (persistence) sidesteps both.
 */
import type { DeckDesign } from '../../../domain/model';

// Re-export the shared generator so the persistence tests keep their
// existing import path (`./__fixtures__/deck-designs`). The single
// source of truth lives in the domain layer.
export {
  deckDesignArb,
  ptCedarNo2Arb,
  compositeDeckingArb,
  deckingMaterialArb,
} from '../../../domain/__testing__/deck-design-arb';

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

