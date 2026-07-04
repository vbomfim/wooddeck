/**
 * `src/domain/layout/layout-shared.ts` — shared error type and
 * validation constant used by BOTH `layout-engine.ts` (the top-level
 * dispatcher) AND `floating/floating-layout.ts` (the floating
 * orchestrator).
 *
 * ## Why a separate module (extracted in S19)
 *
 * Before S19 both symbols lived in `layout-engine.ts`. When
 * `layout-engine.ts` was widened to dispatch to `computeFloatingLayout`
 * (from `./floating/floating-layout.ts`), and the floating
 * orchestrator itself needed `LayoutError` + `MIN_DECK_DIMENSION_MM`
 * (to fail-loud on trust-boundary violations), a cycle formed:
 *
 *   layout-engine.ts → floating/floating-layout.ts → layout-engine.ts
 *
 * `dependency-cruiser`'s `no-circular` rule failed CI. Extracting
 * the two shared symbols to this leaf module breaks the cycle:
 * both `layout-engine.ts` and `floating/floating-layout.ts` now
 * depend on `layout-shared.ts` (a leaf), and NEITHER depends on
 * the other transitively.
 *
 * `layout-engine.ts` re-exports both symbols so the pre-S19 public
 * API surface (`import { LayoutError } from './layout-engine'`) is
 * unchanged for existing callers.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only `./units` (a peer
 * domain module).
 */

import { MM_PER_FOOT, type Mm } from '../units';

/**
 * Minimum viable deck dimension (both width and length must be ≥ this).
 * Exactly 4 ft in mm — kept UNROUNDED so foot-multiple designs from the
 * UI (which multiplies user-facing feet × `MM_PER_FOOT`) pass validation
 * on their nose without a 0.2 mm rounding trap.
 * Smaller than 4 ft is unbuildable in practice (a single 4×4 post
 * already spans a meaningful fraction of the footprint) and the layout
 * math (2 joists minimum, 2 posts per beam minimum) starts producing
 * degenerate boxes.
 */
export const MIN_DECK_DIMENSION_MM: Mm = 4 * MM_PER_FOOT;

/**
 * `LayoutError` — thrown when a `DeckDesign` fails validation OR when
 * a downstream catalog lookup fails. Distinct from generic `Error` so
 * consumers can `catch (err) { if (err instanceof LayoutError) …}`
 * without a string-matching hack.
 */
export class LayoutError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LayoutError';
  }
}
