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
 *   - `actualSpacingMm < joistThicknessMm` (issue #25) — even when
 *     the REQUESTED spacing is legal (`>= thickness`), the even-spaced
 *     algorithm in `computeJoistXCenters` may compute
 *     `actualSpacing = (widthMm - thickness) / ceil((widthMm - thickness) / spacingMm)`
 *     which can be strictly LESS than `thickness` when the requested
 *     spacing is at/near the thickness and the deck width is narrow
 *     (e.g. widthMm=1220, spacingMm=38, thickness=38 → actualSpacing=
 *     36.94 mm → adjacent joists overlap by ~1 mm). This was a real
 *     layout-correctness bug the AC3 property test caught
 *     intermittently — the flake in issue #25. The strengthened check
 *     rejects the design at the trust boundary so the pipeline can
 *     never emit an overlapping layout.
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

  // Issue #25 — tighter check on the ACHIEVABLE spacing.
  //
  // The requested `spacingMm` is legal at this point (≥ thickness),
  // but the even-spaced anchor algorithm in `computeJoistXCenters`
  // computes:
  //   usable       = widthMm - joistThicknessMm
  //   bayCount     = ceil(usable / spacingMm)
  //   actualSpacing = usable / bayCount
  // With `spacingMm == joistThicknessMm` AND `usable` NOT an exact
  // multiple of `spacingMm`, `actualSpacing < joistThicknessMm` — the
  // algorithm packs one MORE joist than fits at the requested
  // pitch, and the resulting on-center distance is smaller than the
  // joists themselves → adjacent joists physically overlap.
  //
  // The tolerance `EPS_MM` matches the AC3 property test's `EPS` so
  // "actualSpacing == thickness exactly" (touching face-to-face) is
  // NOT falsely rejected — floats produced by `usable / bayCount`
  // can carry sub-nanometre rounding error even when the math is
  // exact.
  //
  // Guard on `usable > 0` for defensive robustness: the elevated
  // pipeline validates widthMm ≥ MIN_DECK_DIMENSION_MM (~1219.2 mm)
  // BEFORE this helper runs, so `usable = widthMm - thickness` is
  // always > 0 in practice. But `validateJoistSpacing` is exported
  // as a shared helper, and a future caller (or a hostile .deck
  // file entering through a different boundary) could invoke it
  // with a degenerate width. `usable ≤ 0` would produce a negative
  // `bayCount` and division-by-zero — safer to no-op the tightening
  // check on unreachable geometry and let the width guard fail loud.
  const widthMm = design.footprint.widthMm;
  const usableSpanMm = widthMm - joistThicknessMm;
  if (usableSpanMm > 0) {
    const bayCount = Math.ceil(usableSpanMm / spacingMm);
    const actualSpacingMm = usableSpanMm / bayCount;
    const EPS_MM = 1e-6;
    if (actualSpacingMm + EPS_MM < joistThicknessMm) {
      throw new LayoutError(
        `Joist spacing ${spacingMm} mm too tight for deck width ${widthMm} mm — ` +
          `evenly spacing ${bayCount + 1} joists across the ${usableSpanMm} mm ` +
          `usable span places them ${actualSpacingMm.toFixed(3)} mm on-center, ` +
          `less than the ${joistThicknessMm} mm joist thickness (adjacent joists ` +
          `would overlap). Increase the joist spacing OR choose a joist with ` +
          `smaller thickness OR increase the deck width. Typical values: ` +
          `305 mm (12″), 406 mm (16″), 508 mm (20″), 610 mm (24″).`,
      );
    }
  }
}

/**
 * S27 review-response HIGH #2 — flush-beam physical-plausibility guard.
 *
 * In FLUSH framing, the joist hangs OFF THE BEAM FACE via a joist
 * hanger (top-flange or face-mount), so the joist bottom is at
 * `beamTop − joistDepth`. When `joistDepth > beamDepth`, the joist
 * physically extends BELOW the beam bottom — impossible to hang
 * off a beam that isn't tall enough. Pre-S27-review the y-stack
 * silently produced this geometry (e.g. 2×10 joist + 2×8 beam
 * flush → joistBottomY = −51 mm at the min-height boundary — a
 * joist underground).
 *
 * The invariant only applies when the design HAS beams AND the
 * joists are hung off them:
 *
 *   - `beamConnection === 'flush'`
 *   - `structure === 'elevated'` (2 beams always) OR
 *     `structure === 'floating' && floatingFraming === 'beams-and-joists'`
 *     (Method A — 2 rim beams). Method B (`joists-on-blocks`) has
 *     NO beam layer and this check MUST NOT fire — that's why the
 *     caller (validateFloatingDesign) guards on `floatingFraming`.
 *
 * The error message names both depths and prescribes the two
 * remediations (deeper beam OR switch to drop) so the
 * ParameterPanel banner (surfaced via `useDesignStatus().lastError`)
 * is directly actionable — no separate UI code needed.
 *
 * @throws {LayoutError} when the invariant is violated, or when a
 *   material lookup fails (wrapped with `cause`).
 */
export function validateFlushBeamDepth(design: DeckDesign): void {
  if (design.beamConnection !== 'flush') return;
  let joistDepthMm: Mm;
  let beamDepthMm: Mm;
  try {
    joistDepthMm = lookupMaterial(
      design.joist.material.nominal,
      design.joist.material.species,
      design.joist.material.grade,
    ).actual.heightMm;
    beamDepthMm = lookupMaterial(
      design.beam.material.nominal,
      design.beam.material.species,
      design.beam.material.grade,
    ).actual.heightMm;
  } catch (err) {
    throw new LayoutError(
      `Invalid framing material for flush-beam depth check: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (joistDepthMm > beamDepthMm) {
    throw new LayoutError(
      `Flush-beam framing requires the beam to be at least as deep as the joist ` +
        `(the joist hangs from the beam face via a hanger, so a deeper joist ` +
        `would extend below the beam bottom). Got joist depth ${joistDepthMm} mm ` +
        `(${design.joist.material.nominal}) > beam depth ${beamDepthMm} mm ` +
        `(${design.beam.material.nominal}). Choose a beam nominal that is at ` +
        `least as deep as the joist, or switch to Drop beam (joists rest on ` +
        `top of the beam).`,
    );
  }
}
