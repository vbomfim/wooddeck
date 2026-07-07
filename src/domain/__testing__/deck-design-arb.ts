/**
 * `src/domain/__testing__/deck-design-arb.ts` — SHARED `fast-check`
 * arbitrary that generates realistic `DeckDesign` values.
 *
 * ## Why this module exists (Opus #3 / GPT #7 / Dev #7)
 *
 * Both S3 (`src/domain/model.test.ts` — AC4 JSON round-trip property)
 * and S6 (`src/persistence/deck-file/schema-v1.test.ts` — AC1 envelope
 * round-trip property) need the SAME generator. Duplicating it in two
 * test files means:
 *   - a catalog change in S3 could silently diverge from the S6 arb,
 *     letting one property pass while the other misses the case;
 *   - any future consumer (S7 use-case tests, QA integration tests)
 *     would have a third copy to keep in sync.
 * Extracting to `__testing__/` gives BOTH callers a single source of
 * truth. The `__testing__/` name (rather than `__fixtures__/`) makes
 * the intent explicit — these are test doubles / generators, not
 * production data.
 *
 * ## Why `.ts` (not `.test.ts`)
 *
 * `vite.config.ts` collects tests via `include: 'src/**\/*.{test,spec}.{ts,tsx}'`.
 * A plain `.ts` file NEVER matches that glob, so Vitest does not try
 * to execute this module as a test — but any test file may `import`
 * from it. `dependency-cruiser` will see this module as an orphan
 * (test files are excluded from the cruise); the orphan warning is
 * suppressed via the `no-orphans` `pathNot` rule that covers the
 * `__testing__/` marker directory (see `.dependency-cruiser.cjs`).
 *
 * ## Layer boundary
 *
 * This module lives under `src/domain/` and imports only from
 * `../model` (domain-internal) and `fast-check` (npm). It therefore
 * satisfies the `domain-allowlist` rule (`^src/domain/`) and the
 * `domain-no-react-three-dom` framework ban (fast-check is not in
 * the banned list). It may be imported by test files under any
 * layer since the cruise excludes test files entirely.
 */
import fc from 'fast-check';

import type {
  DeckDesign,
  FoundationSpec,
  LumberNominal,
  MaterialRef,
  Species,
  StructureMode,
} from '../model';

// ---------------------------------------------------------------------------
// Catalog subsets — narrow to the triples actually present in the MVP
// ---------------------------------------------------------------------------
//
// Duplicating the catalog here (rather than importing the full one from
// `src/domain/materials-catalog.ts`) keeps this generator stable across
// catalog edits — a new species added to `Species` should NOT quietly
// enter the property-test value space until the arb is updated. Callers
// who want the newest catalog can extend this file explicitly.

const NOMINALS_2X: readonly LumberNominal[] = ['2x6', '2x8', '2x10', '2x12'];
const POST_NOMINALS: readonly LumberNominal[] = ['4x4', '6x6'];
const DECKING_NOMINALS: readonly LumberNominal[] = ['2x6', '5/4x6'];
const PT_CEDAR: readonly Species[] = ['PT', 'Cedar'];

// ---------------------------------------------------------------------------
// Material arbitraries
// ---------------------------------------------------------------------------

/**
 * Build a MaterialRef arbitrary restricted to the given nominal sizes,
 * always with (species ∈ {PT, Cedar}, grade = "No2"). Grade is pinned
 * so the generator only emits catalog-legal triples — matching how S3
 * / S4 fixtures constrain themselves.
 */
export function ptCedarNo2Arb(nominals: readonly LumberNominal[]): fc.Arbitrary<MaterialRef> {
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

/**
 * Composite decking arbitrary — always grade "NA" per the catalog.
 * Kept separate so the composite / lumber choice at `deckingMaterialArb`
 * is a clear `oneof`.
 */
export function compositeDeckingArb(): fc.Arbitrary<MaterialRef> {
  return fc.constantFrom(...DECKING_NOMINALS).map(
    (nominal): MaterialRef => ({
      nominal,
      species: 'Composite',
      grade: 'NA',
    }),
  );
}

/**
 * Combined decking-material arbitrary — either PT/Cedar No2 (dimensional
 * lumber decking) or Composite NA (synthetic decking).
 */
export const deckingMaterialArb: fc.Arbitrary<MaterialRef> = fc.oneof(
  ptCedarNo2Arb(DECKING_NOMINALS),
  compositeDeckingArb(),
);

// ---------------------------------------------------------------------------
// Top-level DeckDesign arbitrary
// ---------------------------------------------------------------------------

/**
 * Generator that yields `DeckDesign` values spanning the catalog
 * triples S3 declares. Consumed by:
 *
 *   - `src/domain/model.test.ts` — AC4 JSON round-trip property (200 runs).
 *   - `src/persistence/deck-file/schema-v1.test.ts` — AC1 envelope
 *     round-trip property (200 runs) + metadata-preserving byte-identity
 *     property (100 runs).
 *
 * Numeric ranges: `widthMm`/`lengthMm` cap at 20 m (larger than any
 * residential deck IRC allows), `heightMm` at 3 m (top of a 2-storey
 * post), joist spacing pinned to code-legal 12"/16"/24" values.
 *
 * ## S17 update — foundation + structure fields
 *
 * The generator ALWAYS emits `structure: 'elevated'` + `foundation:
 * { type: 'posts-on-footings', post: <same as top-level postMaterial>,
 * footing: { widthMm: 300, depthMm: 300 } }`. This mirrors the
 * pre-S17 semantic (every generated design is an elevated post-
 * supported deck) so the AC4 JSON round-trip property continues to
 * pass. The S6 persistence round-trip property test that uses this
 * arb DOES NOT exercise the new fields against the v1 Ajv schema;
 * S18 owns the schema/migration for `structure` and `foundation`.
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
  .map((r): DeckDesign => {
    // S17: seed elevated + posts-on-footings for every generated
    // design. See module docs above. Review-gate FIX 2 dropped the
    // top-level `design.post` field — `foundation.post` (a shallow
    // clone of the same MaterialRef) is now the single source of
    // truth for the post material.
    const structure: StructureMode = 'elevated';
    const foundation: FoundationSpec = {
      type: 'posts-on-footings',
      post: { ...r.postMaterial },
      footing: { widthMm: 300, depthMm: 300 },
    };
    return {
      id: r.id,
      createdAt: new Date(r.createdAtEpochMs).toISOString(),
      footprint: { widthMm: r.widthMm, lengthMm: r.lengthMm, heightMm: r.heightMm },
      structure,
      // S26 (fix/floating-framing-joists) — generator seeds
      // Method-A default `'beams-and-joists'`. Elevated ignores the
      // field so the byte-for-byte round-trip property still holds
      // for every generated design. Method-B path is generated
      // separately by targeted fixtures. Placed immediately after
      // `structure` for field-order consistency across all fixtures
      // (S26 FIX #7 / Opus#6).
      floatingFraming: 'beams-and-joists' as const,
      // S27 (feat/joist-beam-connection) — generator seeds the
      // `'drop'` default (joists on top of beams — matches every
      // pre-S27 fixture). The AC4 JSON round-trip property tests
      // structural stability, not geometry semantics; keeping the
      // arb pinned to drop preserves byte-identical Layout output
      // for every generated design. A future flush-specific arb
      // can be added when the ticket lands a flush-goldens suite.
      beamConnection: 'drop' as const,
      foundation,
      joist: { material: r.joistMaterial, spacingMm: r.joistSpacingMm },
      beam: { material: r.beamMaterial },
      decking: { material: r.deckingMaterial, orientation: r.orientation },
      layout: { bayRemainderStrategy: r.bayRemainderStrategy },
    };
  });
