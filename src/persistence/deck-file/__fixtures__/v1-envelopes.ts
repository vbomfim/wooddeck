/**
 * `__fixtures__/v1-envelopes.ts` — v1-shaped `.deck` payload corpus,
 * used ONLY by the v1→v2 migration tests (S18 AC2, AC3/SC-010).
 *
 * ## Why a separate corpus
 *
 * `GOLDEN_DECK_DESIGN` / `SECOND_GOLDEN_DECK_DESIGN` in
 * `./deck-designs.ts` have been updated to the post-S17 shape (they
 * carry `structure` and `foundation`). To exercise the migration we
 * need envelopes on-disk in the OLD shape — no `structure`, no
 * `foundation`. Those live here.
 *
 * ## Shape correspondence
 *
 * Every entry pairs:
 *   - `v1Envelope` — a fully-typed `DeckFileV1` (the pre-Epic-2
 *     envelope with a `V1LegacyDesign` in `design`).
 *   - `expectedV2Design` — the post-migration `DeckDesign` the v1→v2
 *     migration MUST produce. Consumers assert this deep-equals the
 *     result of `migrateV1ToV2(v1Envelope).design`.
 *
 * The `expectedV2Design` for each fixture is derived MECHANICALLY
 * from the v1 payload:
 *   - copy `id`, `createdAt`, `footprint`, `joist`, `beam`,
 *     `decking`, `layout` unchanged
 *   - stamp `structure: 'elevated'`
 *   - stamp `foundation: { type: 'posts-on-footings', post:
 *     v1.design.post.material, footing: { widthMm: 300, depthMm: 300 } }`
 *   - DROP the pre-S17 top-level `post` field (review-gate FIX 2:
 *     `foundation.post` is the single source of truth in v2)
 *
 * If you edit the migration defaults (S23 or later), update these
 * expectations in lockstep — the AC2 test pins the exact values.
 *
 * ## Serialized-JSON strings
 *
 * Each fixture also exposes a `rawJson` field — a canonical JSON
 * string of the v1 envelope, ready to hand to `deserialize`.
 * Generated once via `serializeAsV1(v1.design, { createdAt, ...})` so
 * the test file doesn't have to import `serializeAsV1` in every case.
 */
import type { DeckDesign } from '../../../domain/model';

import type { DeckFileV1, V1LegacyDesign } from '../envelope-types';
import { serializeAsV1 } from '../schema-v1';

import { V1_LEGACY_DESIGN } from './deck-designs';

// ---------------------------------------------------------------------------
// Migration defaults — mirror `migrate-v1-to-v2.ts`
// ---------------------------------------------------------------------------

const DEFAULT_FOOTING_WIDTH_MM = 300;
const DEFAULT_FOOTING_DEPTH_MM = 300;

// ---------------------------------------------------------------------------
// V1 legacy design values
// ---------------------------------------------------------------------------

/**
 * Corpus entry #1 — a 12'×16' PT-composite elevated deck, the
 * reference case from the S3/S6 golden fixtures BEFORE the S17
 * Epic 2 amendment landed. Review-gate FIX 5d: imported from the
 * shared `deck-designs.ts` fixture so this literal isn't duplicated
 * between the validator tests and the migration corpus.
 */
const V1_DESIGN_A: V1LegacyDesign = V1_LEGACY_DESIGN;

/**
 * Corpus entry #2 — a 20'×30' cedar deck, different material picks
 * so the migration test covers non-default post material references.
 */
const V1_DESIGN_B: V1LegacyDesign = {
  id: '018f4e7a-c1c5-4a3f-8f52-3a0f6c9d1e4c',
  createdAt: '2026-05-02T09:15:30.000Z',
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
// Public fixture entries
// ---------------------------------------------------------------------------

/**
 * A single migration test entry — the v1 envelope on disk, the raw
 * JSON string (ready for `deserialize`), and the expected post-
 * migration v2 design.
 */
export interface V1MigrationFixture {
  readonly label: string;
  readonly v1Envelope: DeckFileV1;
  readonly rawJson: string;
  readonly expectedV2Design: DeckDesign;
}

/**
 * Build a fixture entry from a v1 legacy design plus envelope
 * metadata. Extracted so every entry is derived by the SAME
 * mechanical transform — if the migration defaults drift, all
 * fixtures move in lockstep.
 */
function makeFixture(
  label: string,
  design: V1LegacyDesign,
  envelopeMeta: { readonly createdAt: string; readonly generatorVersion: string },
): V1MigrationFixture {
  const v1Envelope: DeckFileV1 = {
    schema: 1,
    generator: 'wooddeck',
    generatorVersion: envelopeMeta.generatorVersion,
    createdAt: envelopeMeta.createdAt,
    design,
  };
  const rawJson = serializeAsV1(design, {
    createdAt: envelopeMeta.createdAt,
    generatorVersion: envelopeMeta.generatorVersion,
  });
  const expectedV2Design: DeckDesign = {
    id: design.id,
    createdAt: design.createdAt,
    // FIX 2 — shallow-clone every nested plain-object slot so the
    // expected value matches migrateV1ToV2's no-aliasing discipline.
    footprint: { ...design.footprint },
    structure: 'elevated',
    // S26 (fix/floating-framing-joists) — v1→v2 migration stamps
    // the default framing method (see `migrateV1ToV2`). Placed
    // immediately after `structure` for field-order consistency
    // (S26 FIX #7 / Opus#6).
    floatingFraming: 'beams-and-joists',
    // S27 (feat/joist-beam-connection) — v1→v2 migration stamps
    // the classic drop-beam connection (joists on TOP of beams).
    // Every v1 file's implicit convention. See `migrateV1ToV2`.
    beamConnection: 'drop',
    foundation: {
      type: 'posts-on-footings',
      post: { ...design.post.material },
      footing: {
        widthMm: DEFAULT_FOOTING_WIDTH_MM,
        depthMm: DEFAULT_FOOTING_DEPTH_MM,
      },
    },
    joist: {
      material: { ...design.joist.material },
      spacingMm: design.joist.spacingMm,
    },
    beam: { material: { ...design.beam.material } },
    decking: {
      material: { ...design.decking.material },
      orientation: design.decking.orientation,
    },
    layout: { ...design.layout },
  };
  return { label, v1Envelope, rawJson, expectedV2Design };
}

export const V1_FIXTURE_A = makeFixture('12x16 PT-composite elevated', V1_DESIGN_A, {
  createdAt: '2026-05-01T12:00:00.000Z',
  generatorVersion: '0.9.0',
});

export const V1_FIXTURE_B = makeFixture('20x30 cedar elevated', V1_DESIGN_B, {
  createdAt: '2026-05-02T09:15:30.000Z',
  generatorVersion: '0.9.1',
});

/**
 * Every v1 corpus fixture — iterate here for SC-010 layout
 * equivalence tests so adding a fixture automatically joins the
 * regression fence.
 */
export const V1_FIXTURES: readonly V1MigrationFixture[] = [V1_FIXTURE_A, V1_FIXTURE_B];
