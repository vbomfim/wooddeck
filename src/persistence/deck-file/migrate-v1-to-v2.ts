/**
 * `src/persistence/deck-file/migrate-v1-to-v2.ts` — pure migration
 * from a parsed v1 envelope to a v2 envelope.
 *
 * ## Contract (S18 issue #40 §4 AC2, AC3, AC6)
 *
 * `migrateV1ToV2(v1)` accepts a validated `DeckFileV1` and returns a
 * `DeckFileV2` populated with the Epic 2 defaults:
 *
 *   - `structure: 'elevated'`   (FR-027 default — a v1 file had
 *                                joists on beams on posts, i.e. an
 *                                elevated deck by definition).
 *   - `foundation: { type: 'posts-on-footings', post: <v1.design.post.material>,
 *                    footing: { widthMm: 300, depthMm: 300 } }`
 *     (FR-026 default — matches FOOTING_WIDTH_MM / FOOTING_DEPTH_MM,
 *     the same values `makeDefaultDesign` stamps for a new design.)
 *
 * Layout ordinal-equivalence (SC-010): `computeLayout(migrated.design)`
 * MUST deep-equal `computeLayout(the-same-design-as-if-authored-with-
 * elevated+posts-on-footings)`. The migration adds fields the pre-
 * Epic-2 layout engine did not read, so this equivalence follows by
 * construction — the S18 test suite asserts it via a golden fixture.
 *
 * ## Failure mode — `'migration-failed'` (AC6)
 *
 * The function is TOTAL over the type: given a well-typed `DeckFileV1`
 * the migration cannot fail. But the loader path is
 * `deserialize(json) → v1-validate → migrateV1ToV2 → v2-validate`, and
 * the "well-typed" precondition only holds at the boundary. If the
 * migration ever grows a normalization step that could throw (e.g.
 * "resolve v1 material SKU against S17 catalog"), it MUST throw
 * `DeckFileError('migration-failed', …)`; the loader wraps any other
 * exception into the same code. The ticket calls this out explicitly:
 * "if v1.post references an unknown SKU per AC6, let the loader catch
 * and map to `migration-failed`".
 *
 * ## Purity
 *
 * The function has NO I/O, NO clock reads, NO random. Given the same
 * input it returns a deep-equal output. The `createdAt` field on the
 * migrated envelope is COPIED from the v1 envelope — the migration
 * does NOT re-stamp the file with the current time. Rationale: users
 * expect "I loaded a v1 file" not "I created a v2 file today"; the
 * on-disk metadata records provenance, not upgrade wall time.
 */
import type { DeckDesign, FoundationSpec } from '../../domain/model';

import type { DeckFileV1, DeckFileV2, V1LegacyDesign } from './envelope-types';

// ---------------------------------------------------------------------------
// Constants — mirror `src/state/default-design.ts`
// ---------------------------------------------------------------------------

/**
 * FR-026 default poured-footing footprint (width). Matches the
 * `FOOTING_WIDTH_MM` constant that `makeDefaultDesign` stamps for a
 * fresh design. Kept as a module-scope constant so a future update
 * to the default (e.g. jurisdiction-specific 400 mm) is a one-line
 * change here and in `default-design.ts` (searchable via grep for
 * `FOOTING_WIDTH_MM`).
 */
const DEFAULT_FOOTING_WIDTH_MM = 300;

/**
 * FR-026 default poured-footing depth. See `DEFAULT_FOOTING_WIDTH_MM`.
 */
const DEFAULT_FOOTING_DEPTH_MM = 300;

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Migrate a validated v1 envelope to a v2 envelope by filling in the
 * Epic 2 defaults.
 *
 * @param v1 A `DeckFileV1` already validated by `validateDeckFile`.
 * @returns A `DeckFileV2` whose `design.structure` is `'elevated'`
 *          and whose `design.foundation` is a `posts-on-footings`
 *          spec built from the v1 `design.post.material`.
 *
 * Design field order matches the v2 `DeckDesign` type (see
 * `envelope-types.ts` and `model.ts`), pinning the byte-for-byte
 * round-trip contract (SC-006 v2 counterpart).
 */
export function migrateV1ToV2(v1: DeckFileV1): DeckFileV2 {
  const migratedDesign = migrateDesign(v1.design);
  const envelope: DeckFileV2 = {
    schema: 2,
    generator: v1.generator,
    generatorVersion: v1.generatorVersion,
    createdAt: v1.createdAt,
    design: migratedDesign,
  };
  return envelope;
}

/**
 * Migrate the design payload. Extracted so a unit test can exercise
 * it without the envelope wrapper, and so a future v1.5→v2 shim
 * (should we ever need one) can reuse the same defaulting.
 */
function migrateDesign(v1Design: V1LegacyDesign): DeckDesign {
  const foundation: FoundationSpec = {
    type: 'posts-on-footings',
    post: v1Design.post.material,
    footing: {
      widthMm: DEFAULT_FOOTING_WIDTH_MM,
      depthMm: DEFAULT_FOOTING_DEPTH_MM,
    },
  };

  // Field order MATCHES the S17 `DeckDesign` interface in model.ts —
  // `structure` and `foundation` slot between `footprint` and `joist`.
  // `JSON.stringify` preserves insertion order, so this ordering is
  // load-bearing for the v2 round-trip byte-identity test.
  const v2Design: DeckDesign = {
    id: v1Design.id,
    createdAt: v1Design.createdAt,
    footprint: v1Design.footprint,
    structure: 'elevated',
    foundation,
    joist: v1Design.joist,
    beam: v1Design.beam,
    post: v1Design.post,
    decking: v1Design.decking,
    layout: v1Design.layout,
  };
  return v2Design;
}
