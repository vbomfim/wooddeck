/**
 * `src/state/default-design.ts` — factory for the initial `DeckDesign`
 * used when the app boots with nothing in localStorage (AC8) OR when
 * `reset()` is invoked (design-store contract).
 *
 * ## Why this lives in `src/state/` and not `src/domain/`
 *
 * The default IS a policy decision: "what design does a first-time
 * user see?". That's not a domain-model concern (the domain is
 * SKU-and-geometry-agnostic about defaults) and not an application-
 * layer concern (the application layer is pure use-cases, no
 * seeding). The state store is the composition boundary that hands
 * every consumer a `DesignBundle` — so the seeding factory sits
 * alongside it.
 *
 * ## Frozen parameter set — issue #9 AC8 (revised)
 *
 * The ticket's original AC8 called for 12 ft × 16 ft × 3 ft. That
 * footprint over-spans 2×8 PT joists (allowable ≈3.6 m < actual
 * ≈4.6 m) and 2-ply 2×8 beams under the resulting post-gap, so
 * `spanCheck` emitted twelve red warnings on first paint —
 * contradicting AC8's "sensible default" spirit. Pair-fix review
 * (code review guardian, Opus + GPT concurring) resolved this by
 * shrinking the default footprint to 12 ft × 12 ft while keeping
 * the ticket's material choices. Empirical result via the probe:
 *
 *     12 ft × 12 ft, 2×8 PT No2 joists @ 406 mm, 2×8 PT beams,
 *     6×6 PT posts → spanCheck(...) === []  (zero warnings)
 *
 * The alternative — keep 12 × 16 and bump joists/beams to 2×12 —
 * also cleared warnings, but shipping the biggest joist SKU by
 * default felt over-specified for a starter deck. 12 × 12 is the
 * canonical "starter deck" size in the residential-carpentry world
 * (Home Depot / Lowe's catalog default, tutorials, etc.), and it
 * preserves the ticket's original 2×8 economical material set.
 * `default-design.test.ts` locks the invariant in place with a
 * permanent `spanCheck === []` regression assertion so future
 * material or spacing edits can't silently regress AC8.
 *
 *     footprint  : 12 ft × 12 ft × 3 ft
 *     joists     : 2×8 PT No2, 406 mm (16″) o.c.
 *     beams      : 2×8 PT No2  (same nominal as joists — economical)
 *     posts      : 6×6 PT No2  (standard raised-deck post size)
 *     decking    : 5/4×6 PT No2, parallel to width
 *     bay layout : extra-bay-at-end (matches every fixture default)
 *
 * `species: 'PT'` (Southern Pine, pressure-treated) is the only
 * option in the materials catalog today; earlier README drafts
 * mentioned SPF but no SPF SKU exists — so the default is
 * unambiguously PT No2. This also resolves the SPF→PT doc-drift
 * LOW noted in review.
 *
 * These values MUST compute a valid `Layout` (no `LayoutError`) AND
 * produce zero span-check warnings — both are verified by
 * `default-design.test.ts`.
 *
 * ## `id` and `createdAt` are injected, not baked in
 *
 * `makeDefaultDesign(id, createdAt)` accepts both fields so:
 *
 *   - The design-store can call it with `makeDeckDesignId()` +
 *     `new Date().toISOString()` for a real-user boot.
 *   - Tests can inject fixed values to keep golden-fixture
 *     comparisons byte-stable.
 *
 * This mirrors the pattern the S4 `computeLayout` uses for
 * `Layout.computedAt` (injected clock, tests lock in fixed value).
 */

import type { DeckDesign } from '../domain/model';
import { MM_PER_FOOT } from '../domain/units';

/**
 * The frozen 5-tuple of default design parameters — issue #9 AC8
 * (revised to 12×12 during pair-fix review; see module header).
 * Exported (rather than inlined into `makeDefaultDesign`) so tests
 * can assert the ticket-specified values directly, and so later
 * stories (S13 parameter panel, S14 defaults reset) can share the
 * SAME source of truth.
 *
 * The units in the parameter names use the vocabulary the ticket
 * uses (`Ft`, `Mm`) — millimeter conversion happens inside the
 * factory so no other module has to know `MM_PER_FOOT`.
 */
export const DEFAULT_DESIGN_PARAMS = Object.freeze({
  widthFt: 12,
  lengthFt: 12,
  heightFt: 3,
  joistSpacingMm: 406, // 16″ o.c. — the IRC-common joist spacing
  joistNominal: '2x8' as const,
  beamNominal: '2x8' as const,
  postNominal: '6x6' as const,
  deckingNominal: '5/4x6' as const,
  species: 'PT' as const,
  grade: 'No2' as const,
  deckingOrientation: 'parallel-to-width' as const,
  bayRemainderStrategy: 'extra-bay-at-end' as const,
});

/**
 * Build the default `DeckDesign` with the ticket-specified parameters.
 *
 * @param id        The design id. Callers pass `makeDeckDesignId()`
 *                  for real boots and a fixed UUID for tests.
 * @param createdAt The ISO-8601 creation timestamp. Callers pass
 *                  `new Date().toISOString()` for real boots and a
 *                  fixed string for tests.
 */
export function makeDefaultDesign(id: string, createdAt: string): DeckDesign {
  const {
    widthFt,
    lengthFt,
    heightFt,
    joistSpacingMm,
    joistNominal,
    beamNominal,
    postNominal,
    deckingNominal,
    species,
    grade,
    deckingOrientation,
    bayRemainderStrategy,
  } = DEFAULT_DESIGN_PARAMS;
  return {
    id,
    createdAt,
    footprint: {
      widthMm: widthFt * MM_PER_FOOT,
      lengthMm: lengthFt * MM_PER_FOOT,
      heightMm: heightFt * MM_PER_FOOT,
    },
    joist: {
      material: { nominal: joistNominal, species, grade },
      spacingMm: joistSpacingMm,
    },
    beam: { material: { nominal: beamNominal, species, grade } },
    post: { material: { nominal: postNominal, species, grade } },
    decking: {
      material: { nominal: deckingNominal, species, grade },
      orientation: deckingOrientation,
    },
    layout: { bayRemainderStrategy },
  };
}
