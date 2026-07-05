/**
 * `src/domain/layout/layout-shared.ts` — shared error type,
 * validation constant, and validation HELPERS used by BOTH
 * `layout-engine.ts` (the top-level dispatcher) AND
 * `floating/floating-layout.ts` (the floating orchestrator).
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
 * ## S26 addition — `validateJoistSpacing`
 *
 * The elevated orchestrator has always rejected `spacingMm <= 0`
 * and `spacingMm < joistThicknessMm` (the second condition would
 * produce overlapping joists; the first produces `bayCount = ceil(x/0)
 * = Infinity` in `computeJoistXCenters` → non-terminating anchor
 * loop = DoS). Before S26 the floating orchestrator did NOT apply
 * this guard because pre-S26 floating did not use
 * `computeJoistXCenters`; S26 makes both methods share the joist
 * layer, so BOTH orchestrators must call this shared guard.
 *
 * Extracted here so any future third orchestrator (a hypothetical
 * tiered / cantilever variant) MUST call the same guard — the
 * invariant lives once.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only `./units` (a peer
 * domain module).
 */

import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign } from '../model';
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

/**
 * Validate the joist spacing on a `DeckDesign`. Rejects:
 *
 *   - non-finite (`NaN`, `Infinity`) — `computeJoistXCenters` divides
 *     by `spacingMm` to derive the bay count, so `NaN`/`Infinity`
 *     produce `bayCount = NaN`/`Infinity` and the anchor loop either
 *     no-ops or hangs.
 *   - `spacingMm <= 0` — same DoS pathway (division by zero →
 *     `Infinity` bay count → non-terminating loop).
 *   - `spacingMm < joistThicknessMm` — placing joists closer than
 *     the joist's own thickness produces OVERLAPPING joists, which
 *     the layout math cannot represent.
 *
 * The joist thickness is looked up from the materials catalog; a
 * catalog miss is surfaced as a `LayoutError` naming the material.
 *
 * Called by BOTH `validateDesign` (elevated) in `layout-engine.ts`
 * AND `validateFloatingDesign` in `floating-layout.ts`. Extracted
 * so the invariant lives once — a future third orchestrator MUST
 * call this helper.
 *
 * @throws {LayoutError} on any rejection.
 */
export function validateJoistSpacing(design: DeckDesign): void {
  let joistThicknessMm: Mm;
  try {
    const joistMaterial = lookupMaterial(
      design.joist.material.nominal,
      design.joist.material.species,
      design.joist.material.grade,
    );
    joistThicknessMm = joistMaterial.actual.widthMm;
  } catch (err) {
    throw new LayoutError(
      `Invalid joist material: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const spacingMm = design.joist.spacingMm;
  if (
    !Number.isFinite(spacingMm) ||
    spacingMm <= 0 ||
    spacingMm < joistThicknessMm
  ) {
    throw new LayoutError(
      `Invalid joist spacing: spacingMm=${spacingMm} must be finite, ` +
        `strictly positive, and ≥ the joist thickness of ${joistThicknessMm} mm ` +
        `(spacings smaller than the joist thickness would produce overlapping joists; ` +
        `spacings ≤ 0 or non-finite produce a non-terminating layout anchor loop). ` +
        `Typical values: 305 mm (12″), 406 mm (16″), 508 mm (20″), 610 mm (24″).`,
    );
  }
}
