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
 * feat/block-spacing HIGH #1 defense-in-depth — maximum viable
 * deck dimension (both width and length must be ≤ this).
 *
 * ## Value rationale (30480 mm = 100 ft)
 *
 * 100 ft covers every residential deck geometry the MVP is
 * designed for (largest existing golden fixture is ~6096 mm =
 * 20 ft) with a comfortable 5× headroom for a future rear-yard
 * mega-deck. It ALSO closes a pre-existing DoS on Method A + the
 * elevated layout: without a footprint cap, a `.deck` file with
 * `widthMm=1000000, lengthMm=1000000` (the `Mm` `$defs` maximum)
 * would instance millions of layout members before any downstream
 * cap fires. The persisted schema mirrors this bound (`docs/
 * deck-file-schema-v2.json` `Dimensions3D`), so a hostile file is
 * REJECTED at deserialize time.
 *
 * ## Interaction with the Method B block-count cap
 *
 * Combined with `MAX_METHOD_B_BLOCK_COUNT`, this cap makes the
 * Method B closed-form spacing floor
 * `sqrt(w*l / MAX_METHOD_B_BLOCK_COUNT)` bounded above by
 * `sqrt(MAX_DECK_DIMENSION_MM^2 / MAX_METHOD_B_BLOCK_COUNT) =
 * 30480/sqrt(400) = 1524 mm` — well within
 * `MAX_BLOCK_SPACING_MM (2438.4 mm)`, so a legal footprint at ANY
 * legal `blockSpacingMm` produces ≤ MAX_METHOD_B_BLOCK_COUNT
 * blocks without further iterative shrinking.
 *
 * Autonomous decision — reversible by editing this constant. If
 * the value grows, verify the closed-form spacing floor still
 * fits under MAX_BLOCK_SPACING_MM (raise the cap in tandem to
 * keep the block-count invariant tight-by-construction).
 */
export const MAX_DECK_DIMENSION_MM: Mm = 100 * MM_PER_FOOT;

/**
 * PR #73 review — GPT-5.5 HIGH #2 root fix.
 *
 * Minimum practical joist on-center spacing. Enforced at the
 * domain trust boundary in `validateJoistSpacing` (below), mirrored
 * in the persisted `.deck` schema v2 (`docs/deck-file-schema-v2.json`
 * on `joist.spacingMm`), and surfaced to the user in the
 * `ParameterPanel` joist-spacing hint.
 *
 * ## Value rationale (305 mm = 12″ o.c.)
 *
 * 305 mm is the codebase's canonical tightest sensible spacing.
 * Evidence:
 *   - `TABULATED_SPACINGS_MM = [305, 406, 610]` in
 *     `src/domain/remediations.ts` — the app's authoritative
 *     catalog of "typical" spacings.
 *   - The `reduce-joist-spacing` remediation FLOOR is 305 mm — the
 *     app's own auto-remediation loop refuses to go tighter.
 *   - 12″ o.c. is the tightest joist pitch used in residential
 *     framing per IRC prescriptive tables; below that is
 *     specialty framing (bridge decking) and out of MVP scope.
 *
 * ## What this bounds (both structural correctness AND DoS)
 *
 * 1. Blocking-member explosion. `layoutBlockingBetweenJoists`
 *    emits (bays × rows) = (joists−1) × rows members. Without
 *    a lower bound on spacing, a 100 ft × 100 ft deck at
 *    `spacingMm = joistThickness + 1` could theoretically yield
 *    ~800 joists × 12 rows = ~9,600 blocking members. At MIN
 *    305 the same deck caps at ~100 joists → ~1,200 blocking,
 *    proportionate to a 10,000 sq ft deck.
 * 2. Layout-time DoS (pre-existing). `computeJoistXCenters`
 *    already tolerated near-thickness spacing at the trust
 *    boundary; the resulting joist count grew as
 *    `O(width / thickness)`. This bound caps joist count too.
 * 3. Method B degenerate-exception (FR-035). Prior to this
 *    bound, `spacingMm=40` on a 100 × 100 ft footprint reached
 *    the "numJoists × 2 > MAX_METHOD_B_BLOCK_COUNT" exception
 *    in `resolveMethodBGrid`. With MIN=305 that pathological
 *    input is REJECTED at validation — the FR-035 exception
 *    code is retained as belt-and-braces, but is now
 *    unreachable via any legal design.
 *
 * ## Boundary is INCLUSIVE
 *
 * `spacingMm == 305` is ACCEPTED (the "tightest sensible" pitch);
 * `spacingMm == 304` is REJECTED. The check below reads
 * `spacingMm < MIN_JOIST_SPACING_MM` so the boundary is inclusive.
 *
 * Autonomous decision — reversible by editing this constant.
 * If lowered, verify (a) the blocking-member bound at
 * `MAX_DECK_DIMENSION_MM` remains proportionate; (b) the
 * `reduce-joist-spacing` remediation floor still matches (or
 * lower it in tandem); (c) any UI hint mentioning "12 in" is
 * updated.
 */
export const MIN_JOIST_SPACING_MM: Mm = 305;

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
  if (!Number.isFinite(spacingMm) || spacingMm <= 0) {
    throw new LayoutError(
      `Invalid joist spacing: spacingMm=${spacingMm} must be finite ` +
        `and strictly positive (spacings ≤ 0 or non-finite produce a ` +
        `non-terminating layout anchor loop). ` +
        `Typical values: 305 mm (12″), 406 mm (16″), 508 mm (20″), 610 mm (24″).`,
    );
  }

  // PR #73 review — GPT-5.5 HIGH #2 root fix.
  //
  // Enforce the practical MIN joist spacing at the trust boundary
  // BEFORE the thickness/actualSpacing checks so:
  //   (a) the friendlier "12″ min" message fires first for the
  //       common user-error case (someone enters a very small
  //       spacing), instead of the more technical thickness /
  //       overlap message; and
  //   (b) the pathological input path that used to reach the
  //       Method B FR-035 degenerate exception (`numJoists × 2 >
  //       MAX_METHOD_B_BLOCK_COUNT`) and the blocking-member
  //       explosion (`bays × rows` unbounded above) is CUT OFF
  //       here — bounding both structural-correctness AND DoS
  //       surfaces at a single seam.
  //
  // Kept AFTER `spacingMm <= 0` so a NaN / negative value gives
  // the (more accurate) "non-terminating loop" reason, not a
  // misleading "below 305" reason.
  //
  // The thickness (`< joistThicknessMm`) and issue-#25
  // actualSpacing checks BELOW are retained as defense-in-depth:
  // a future lowering of MIN_JOIST_SPACING_MM (or a caller that
  // bypasses this helper) must still catch overlapping joists.
  if (spacingMm < MIN_JOIST_SPACING_MM) {
    throw new LayoutError(
      `Joist spacing ${spacingMm} mm is below the ${MIN_JOIST_SPACING_MM} mm ` +
        `(12″) practical minimum — tighter spacings are not supported by this ` +
        `tool (they exceed the joist-count budget for large decks and fall ` +
        `outside IRC prescriptive framing tables). ` +
        `Typical values: 305 mm (12″), 406 mm (16″), 610 mm (24″).`,
    );
  }

  if (spacingMm < joistThicknessMm) {
    throw new LayoutError(
      `Invalid joist spacing: spacingMm=${spacingMm} must be ≥ the joist ` +
        `thickness of ${joistThicknessMm} mm (spacings smaller than the joist ` +
        `thickness would produce overlapping joists). ` +
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
