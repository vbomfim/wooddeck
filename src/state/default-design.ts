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
 * ## Frozen parameter set — issue #9 AC8
 *
 * The ticket calls out the exact defaults:
 *
 *     footprint  : 12 ft × 16 ft × 3 ft
 *     joists     : 2×8 PT No2, 406 mm (16″) o.c.
 *     beams      : 2×8 PT No2  (same nominal as joists — economical)
 *     posts      : 6×6 PT No2  (standard raised-deck post size)
 *     decking    : 5/4×6 PT No2, parallel to width
 *     bay layout : extra-bay-at-end (matches every fixture default)
 *
 * These values MUST compute a valid `Layout` (no `LayoutError`) —
 * verified by `default-design.test.ts`. In particular the
 * min-structural-height guard (S4 `computeMinStructuralHeightMm`)
 * for this material stack is well below 914 mm (= 3 ft), so the
 * default is safely inside the legal envelope.
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
 * The frozen 5-tuple of default design parameters — issue #9 AC8.
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
  lengthFt: 16,
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
