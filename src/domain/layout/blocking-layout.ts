/**
 * `src/domain/layout/blocking-layout.ts` — the SHARED pure helper
 * that emits solid blocking members between adjacent joists for
 * lateral restraint per IRC R502.7 / R502.7.1.
 *
 * ## Why one helper, called by TWO pipelines
 *
 * Both the elevated pipeline (`layout-engine.ts` → `layoutJoists`)
 * and the floating pipeline (`floating/floating-layout.ts` → both
 * `computeMethodA` and `computeMethodB`, via `layoutFloatingJoists`)
 * produce joists with the SAME x-anchor formula (both call
 * `computeJoistXCenters` — see `joist-layout.ts`). The physical
 * "blocking between joists" concept is identical in both worlds —
 * only the y-anchor differs (elevated: `computeYStack.joistCenterY`;
 * floating: `computeYStackFloating.joistCenterY`).
 *
 * Rather than repeat the emitter body in two places (and risk drift
 * — e.g. one path forgetting to switch off "interior only" or
 * emitting a member at ±L/2), this module exposes ONE pure
 * function that takes primitive inputs and returns
 * `LayoutMember[]`. Each pipeline derives the correct y-anchor
 * from its own y-stack and passes it in. Same math, one seam.
 *
 * ## IRC R502.7 / R502.7.1 — where the row rule comes from
 *
 *   - R502.7 requires **lateral restraint at supports** — i.e.
 *     the joist ENDS need to be tied (rim joist / band board /
 *     ledger / rim beam). This helper does NOT emit end-rows
 *     because it is scoped to INTERIOR bridging only. End
 *     restraint is:
 *       - **Elevated** — provided by the rim joist / ledger at
 *         each end (part of the elevated framing model).
 *       - **Floating Method A** (`beams-and-joists`) — provided
 *         by the two rim beams the layout emits along the near
 *         / far edges.
 *       - **Floating Method B** (`joists-on-blocks`) — NOT YET
 *         provided; Method B currently has no rim/band member.
 *         Adding a joist-depth band across the joist ends for
 *         Method B is tracked in **issue #74** (deferred from
 *         PR #73 to keep #72 scoped to interior bridging).
 *   - R502.7.1 requires **on-center spacing ≤ 8 ft** for solid
 *     blocking used as INTERIOR lateral restraint / anti-rotation
 *     bridging (which is exactly what this helper emits).
 *     Constant: `MAX_BLOCKING_SPACING_MM = 2438` mm (8 ft × 304.8
 *     mm/ft ≈ 2438.4 mm — rounded down to an integer for
 *     exact-arithmetic ceil-count semantics on typical
 *     8/10/12/14/16 ft deck lengths).
 *
 * ## Row placement along +z (deck LENGTH)
 *
 *   - Interior rows only — no row at `±L/2`.
 *   - Row count:
 *     `N = max(1, ceil(lengthMm / MAX_BLOCKING_SPACING_MM) - 1)`.
 *     - Threshold: whenever there are ≥ 2 joists (i.e. ≥ 1 bay),
 *       ALWAYS emit at least 1 mid-span row. The `max(1, ...)`
 *       floor is deliberately conservative / DIY-friendly — a
 *       tiny 4-ft deck otherwise gets `ceil(4ft/8ft)-1 = 0` rows
 *       and would ship with no bracing at all.
 *     - For L ≤ MAX (≤ 8 ft): `ceil(L/MAX) = 1` → `N = max(1, 0)
 *       = 1` (one mid-span row at z=0).
 *     - For L > MAX (> 8 ft): `N = ceil(L/MAX) - 1`, giving
 *       `L/(N+1) ≤ MAX` by construction.
 *     - The threshold: a deck length strictly ≤ `2 × MAX = 4876`
 *       mm gets N=1; longer decks roll over. A 12 ft deck
 *       (3657.6 mm) resolves to N=1; a 16 ft deck (4876.8 mm)
 *       lands 0.8 mm past the threshold and resolves to N=2 —
 *       deliberately conservative because `MAX = 2438` is 0.4 mm
 *       shy of the exact 8 ft = 2438.4 mm. Extra rows waste a
 *       small amount of lumber but NEVER violate R502.7.1.
 *   - Row z-positions: `z_k = -L/2 + k * L / (N + 1)` for
 *     `k = 1..N`. Adjacent-row pitch is exactly `L / (N + 1)`;
 *     the "end gap" (between the rim and the first / last row)
 *     is also `L / (N + 1)` — every gap is uniform.
 *
 * ## Per-member geometry (between joist i and joist i+1 at row z_k)
 *
 *   - `position.x` = `(xCenters[i] + xCenters[i+1]) / 2` (bay midpoint).
 *   - `position.y` = `joistCenterY` (co-planar with joists).
 *   - `position.z` = `z_k` (interior row station).
 *   - `size.x` = `xCenters[i+1] - xCenters[i] - joistThicknessMm`
 *     (the CLEAR gap between the two joist inner faces — the
 *     blocking end face lands EXACTLY on the joist face, no
 *     overlap and no gap).
 *   - `size.y` = `joistDepthMm` (full-depth solid blocking — same
 *     stock as the joist, stood on edge just like the joist).
 *   - `size.z` = `joistThicknessMm` (the blocking is the same
 *     nominal 2× as the joist and is oriented with its thickness
 *     along +z — a real carpenter would cut a joist offcut to
 *     length and toe-nail it in).
 *   - `rotation` = `{x:0, y:0, z:0}` (axis-aligned MVP framing).
 *   - `material` = the caller-provided lumber material (typically
 *     `{ kind: 'lumber', ...design.joist.material }`) — routed
 *     through the shared per-kind color cache to render EMERALD
 *     (`MATERIAL_KIND_COLORS.blocking`) in `BlockingLayer`.
 *
 * ## Edge cases
 *
 *   - `joistXCenters.length < 2` (i.e. 0 or 1 joists) → return an
 *     empty array. No adjacent bay exists, so nothing to place
 *     blocking between. Fail-loud is the CALLER's responsibility;
 *     this helper stays graceful because upstream validation
 *     already rejects <2-joist designs (`validateJoistSpacing`).
 *   - **Zero-width bay (clear gap ≤ EPS)** — `validateJoistSpacing`
 *     admits `actualSpacing == joistThickness` (adjacent joists
 *     touching face-to-face). In that case the CLEAR gap between
 *     joist faces is zero, and the bay is physically DEGENERATE.
 *     The helper SKIPS any bay whose `clearGap ≤ CLEAR_GAP_EPS_MM`
 *     — fail-safe, not a throw — so no invisible zero-width mesh
 *     and no zero-length BOM cut is ever emitted. See
 *     `CLEAR_GAP_EPS_MM` docstring for how the tolerance stays
 *     in lock-step with the upstream validator.
 *
 * ## Member-count bounds — PR #73 review MEDIUM #2
 *
 * The emitted count is `rows × openBays` where
 *   - `rows = max(1, ceil(lengthMm / 2438) − 1)`. With the
 *     `MAX_DECK_DIMENSION_MM = 30480 mm` cap the elevated /
 *     floating pipelines enforce on `lengthMm`, `rows ≤ ceil(30480
 *     / 2438) − 1 = 12`.
 *   - `openBays ≤ joistXCenters.length − 1`. Joist count is bounded
 *     by `widthMm / joistThickness ≤ 30480 / 38 ≈ 802`. However,
 *     any bay whose clear gap ≤ EPS is SKIPPED by the zero-width
 *     guard above, so the pathological "joists touching, ~800
 *     bays" case emits ~0 blocking (not ~800).
 * At realistic joist spacing (12″ = 305 mm; 16″ = 406 mm; 24″ = 610
 * mm) a maximally-wide 30480 mm deck has ~50 to ~100 open bays,
 * so a maximally-long 30480 mm deck emits ~600 to ~1200 blocking
 * members — proportionate to a legally-huge (~10,000 sq ft) deck.
 * NO arbitrary numeric cap is applied here: silently dropping rows
 * on a legal large deck would be silent under-bracing (worse than
 * the DoS an arbitrary cap would defend against). The zero-width
 * guard + the upstream footprint cap together bound the count
 * without introducing a lying UI.
 *
 * ## Stable ids
 *
 *   `blocking-r{row}-b{bay}` where `row ∈ [0, N-1]` (0 = first
 *   interior row, most-negative z) and `bay ∈ [0, N_bays-1]`
 *   (0 = leftmost bay between joist 0 and joist 1). Deterministic
 *   for a given input — golden fixtures and warning-overlay
 *   reconciliation rely on this.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain types
 * (`../model`, `../units`) — no react, no three, no state store.
 * Boundary enforced by `.dependency-cruiser.cjs` `domain-*` rules
 * and the `scripts/boundary-selftest.mjs` probes.
 */

import type { LayoutMember, LumberMemberMaterial } from '../model';
import type { Mm } from '../units';

/**
 * Maximum on-center spacing between rows of solid blocking, per
 * IRC R502.7.1: 8 ft = 2438.4 mm, rounded down to 2438 mm for
 * exact-arithmetic ceil-count semantics on typical deck lengths.
 *
 * Exported so the property tests + spec docs can reference the
 * SAME source-of-truth constant (no duplicated magic numbers).
 */
export const MAX_BLOCKING_SPACING_MM = 2438;

/**
 * Tolerance for the "clear gap ≤ 0" degenerate-bay guard, in mm.
 *
 * Kept in strict lock-step with `EPS_MM = 1e-6` in
 * `layout-shared.ts::validateJoistSpacing`. Both seams answer the
 * same physical question ("is the on-center joist spacing ≥ the
 * joist thickness?") and MUST agree on where the threshold is:
 *
 *   - `validateJoistSpacing` REJECTS a design when
 *     `actualSpacing + EPS_MM < joistThickness`, i.e. it ADMITS
 *     `actualSpacing == joistThickness` (adjacent joists touching
 *     face-to-face; clear gap == 0).
 *   - THIS helper, receiving an admitted design, SKIPS any bay
 *     whose clear gap ≤ `EPS_MM` — because there is physically no
 *     room to nail a noggin between two touching joists, so
 *     emitting a `size.x == 0` invisible mesh + zero-length BOM
 *     cut would be a lying UI.
 *
 * Same EPS on both sides means "how close to zero counts as zero"
 * is answered identically at both ends of the pipeline. If you
 * ever loosen either seam, loosen BOTH — or the two will disagree
 * about what a degenerate design looks like.
 */
const CLEAR_GAP_EPS_MM = 1e-6;

/**
 * Pure input contract for {@link layoutBlockingBetweenJoists}.
 *
 * All fields are REQUIRED — the helper does no optional-field
 * defaulting because ambiguity at a domain boundary is a bug.
 * Both callers (elevated + floating) derive every field from
 * their own upstream helpers (see module header).
 */
export interface BlockingLayoutInput {
  /**
   * The x-center coordinates of every joist in the deck, in mm,
   * in +x-ascending order. Typically produced by
   * `computeJoistXCenters(width, spacing, thickness)` from
   * `../joist-layout.ts` — the SHARED helper both the elevated
   * and floating joist layers already use, so blocking cannot
   * drift from joists.
   */
  readonly joistXCenters: readonly number[];

  /**
   * The y-center of the joists in mm — comes from the pipeline's
   * y-stack (`computeYStack.joistCenterY` for elevated;
   * `computeYStackFloating.joistCenterY` for floating). Blocking
   * is co-planar with joists.
   */
  readonly joistCenterY: Mm;

  /**
   * The joist's dressed thickness (smaller cross-section
   * dimension) in mm. Blocking's `size.z` equals this, so
   * blocking has the same nominal 2× profile as the joist.
   */
  readonly joistThicknessMm: Mm;

  /**
   * The joist's dressed depth (larger cross-section dimension) in
   * mm — the "on-edge" dimension. Blocking's `size.y` equals this
   * for FULL-DEPTH solid blocking per IRC R502.7.1.
   */
  readonly joistDepthMm: Mm;

  /**
   * The deck LENGTH in mm (`design.footprint.lengthMm`). Row
   * z-positions are computed as evenly-spread interior rows in
   * `z ∈ (-lengthMm/2, +lengthMm/2)`. Uses the FOOTPRINT length
   * (not the joist size.z — which is a shorter clear-span under
   * flush framing) so blocking is placed relative to the deck's
   * end-support planes (rim joist / ledger / rim beam), which is
   * what IRC R502.7 constrains.
   */
  readonly lengthMm: Mm;

  /**
   * The lumber material tag stamped onto every emitted blocking
   * member. Typically `{ kind: 'lumber', ...design.joist.material }`
   * — real carpentry uses joist offcuts. The `LumberMemberMaterial`
   * discriminant is required so `derive-bom.ts` folds the
   * blocking length into the same SKU bin as the joist.
   */
  readonly material: LumberMemberMaterial;
}

/**
 * Emit solid blocking members between every pair of adjacent
 * joists, at evenly-spread interior rows along +z. Pure — same
 * input yields byte-equal output.
 *
 * See module header for the row rule (IRC R502.7 / R502.7.1),
 * the per-member geometry, and the edge-case contract.
 *
 * @param input see {@link BlockingLayoutInput}.
 * @returns an array of `LayoutMember` with `kind === 'blocking'`.
 *   Empty when `joistXCenters.length < 2` (no adjacent bay).
 */
export function layoutBlockingBetweenJoists(
  input: BlockingLayoutInput,
): readonly LayoutMember[] {
  const {
    joistXCenters,
    joistCenterY,
    joistThicknessMm,
    joistDepthMm,
    lengthMm,
    material,
  } = input;

  // <2 joists → no adjacent bay to place blocking between. Return
  // early with an empty array (fail-loud is the caller's
  // responsibility — a valid design always has ≥ 2 joists).
  const bays = joistXCenters.length - 1;
  if (bays < 1) return [];

  // Row count — IRC R502.7.1 (≤ 8 ft o.c.) with a DIY-friendly
  // "at least 1 mid-span row" floor. See module header for the
  // derivation.
  const rows = Math.max(1, Math.ceil(lengthMm / MAX_BLOCKING_SPACING_MM) - 1);

  // Evenly-spread interior row z-positions: k=1..rows, so the
  // outermost rows sit `L/(N+1)` from each end (never at ±L/2).
  const rowStep = lengthMm / (rows + 1);
  const halfL = lengthMm / 2;

  const out: LayoutMember[] = [];
  for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
    // z_k = -L/2 + (k) * L/(N+1) for k = 1..N. `rowIdx = 0`
    // corresponds to k=1 (most-negative z).
    const z = -halfL + (rowIdx + 1) * rowStep;
    for (let bay = 0; bay < bays; bay++) {
      const leftCenter = joistXCenters[bay]!;
      const rightCenter = joistXCenters[bay + 1]!;
      const midX = (leftCenter + rightCenter) / 2;
      const clearGap = rightCenter - leftCenter - joistThicknessMm;
      // Degenerate-bay guard — see `CLEAR_GAP_EPS_MM` docstring.
      // `validateJoistSpacing` admits `actualSpacing ==
      // joistThickness` (clear gap = 0). Skipping the bay is
      // fail-SAFE: no invisible zero-width mesh, no zero-length
      // BOM cut, and no crash. The row loop continues so open
      // bays in the same row still emit blocking normally.
      if (clearGap <= CLEAR_GAP_EPS_MM) continue;
      out.push({
        id: `blocking-r${rowIdx}-b${bay}`,
        kind: 'blocking',
        material,
        position: { x: midX, y: joistCenterY, z },
        size: { x: clearGap, y: joistDepthMm, z: joistThicknessMm },
        rotation: { x: 0, y: 0, z: 0 },
      });
    }
  }

  return out;
}

/**
 * Bay descriptor for {@link layoutBlockingBetweenJoistsPerBay} — one
 * per bay between two adjacent BEAM z-centers under flush framing.
 * The producer in `floating-joist-layout.ts::computeBayClearGapsMm`
 * emits values with the SAME shape; keeping them structurally
 * compatible means the orchestrator can pass the resolver output
 * through unchanged.
 */
export interface BlockingBayInput {
  /** Bay midpoint on +z (the row center inside this bay). */
  readonly midZ: Mm;
  /**
   * CLEAR span between the two enclosing beam FACES on +z.
   * Row count for this bay uses this value (per IRC R502.7.1) so
   * blocking rows sit ONLY inside the bay (never on the beam
   * itself — an interior beam under flush shares the joist
   * plane and would AABB-clash with a whole-deck-length row).
   */
  readonly clearSpanMm: Mm;
}

/**
 * Pure input contract for {@link layoutBlockingBetweenJoistsPerBay}
 * (issue #77 §2 C6). Mirrors {@link BlockingLayoutInput} but scoped
 * to a LIST of bays instead of a single deck-length row rule.
 *
 * See the module header §6 (issue #77) for the rationale: under
 * `flush + interior`, the joist plane and the beam plane overlap in
 * y (`beamDepthMm ≥ joistDepthMm` per `validateFlushBeamDepth`), so
 * a whole-deck-length blocking row at a z that coincides with an
 * interior beam would AABB-clash with the beam. Per-bay placement
 * guarantees blocking always sits STRICTLY inside a bay, between
 * two beam faces.
 */
export interface BlockingLayoutPerBayInput {
  readonly joistXCenters: readonly number[];
  readonly joistCenterY: Mm;
  readonly joistThicknessMm: Mm;
  readonly joistDepthMm: Mm;
  /**
   * The bays to place blocking within, in +z-ascending order.
   * Produced by `computeBayClearGapsMm(beamZCentersSorted,
   * beamThicknessMm)` in `floating-joist-layout.ts`.
   */
  readonly bays: readonly BlockingBayInput[];
  readonly material: LumberMemberMaterial;
}

/**
 * Issue #77 — per-BAY blocking layout for flush + interior beams.
 *
 * For each bay `k`, applies the SAME IRC R502.7.1 row rule
 * `N_k = max(1, ceil(bayClearSpan / MAX_BLOCKING_SPACING_MM) − 1)`
 * that `layoutBlockingBetweenJoists` uses on the whole deck
 * length, but SCOPED to the bay's `clearSpanMm`. Rows sit at
 * `midZ + k' × (clearSpanMm / (N_k + 1))` for `k' = 1..N_k`,
 * i.e. evenly spread INSIDE the bay — never on a beam.
 *
 * Per-member geometry is IDENTICAL to the whole-deck emitter
 * (x-clear-gap × joist-depth × joist-thickness at the bay's mid-z-
 * row-station). Deterministic ids `blocking-bay-{bay}-r{row}-b{joistBay}`
 * — the `bay-` prefix disambiguates from the whole-deck-length ids
 * (`blocking-r{row}-b{col}`) so a mixed layout (unlikely, but
 * defensive) cannot collide.
 *
 * Byte-identity note: DROP and flush-2-beam paths do NOT call this
 * helper — they continue to use `layoutBlockingBetweenJoists` with
 * the whole-deck-length row rule (byte-identical to pre-#77).
 *
 * The degenerate-bay guard (`CLEAR_GAP_EPS_MM`) applies here too —
 * a bay whose clear gap between joists is ≤ EPS is SKIPPED. Fail-
 * safe. The row loop continues so any OPEN bay in the same
 * (bay, row) combination still emits blocking normally.
 *
 * @param input see {@link BlockingLayoutPerBayInput}.
 * @returns array of `LayoutMember` with `kind === 'blocking'`.
 *   Empty when `joistXCenters.length < 2` OR `bays.length === 0`.
 */
export function layoutBlockingBetweenJoistsPerBay(
  input: BlockingLayoutPerBayInput,
): readonly LayoutMember[] {
  const {
    joistXCenters,
    joistCenterY,
    joistThicknessMm,
    joistDepthMm,
    bays,
    material,
  } = input;

  const joistBays = joistXCenters.length - 1;
  if (joistBays < 1) return [];
  if (bays.length === 0) return [];

  const out: LayoutMember[] = [];
  for (let bayIdx = 0; bayIdx < bays.length; bayIdx++) {
    const bay = bays[bayIdx]!;
    // Defensive — a non-positive clear span cannot host any
    // blocking rows. Under the pipeline this is guaranteed by
    // `MIN_BEAM_ROW_GAP_MM > FOOTING_WIDTH_MM`, but a direct
    // caller with a degenerate bay should get an empty response
    // instead of a NaN row count.
    /* c8 ignore next */
    if (bay.clearSpanMm <= 0) continue;
    // IRC R502.7.1 row count scoped to THIS bay's span.
    const rows = Math.max(
      1,
      Math.ceil(bay.clearSpanMm / MAX_BLOCKING_SPACING_MM) - 1,
    );
    const rowStep = bay.clearSpanMm / (rows + 1);
    // Row stations sit inside the bay's z-extent:
    // `midZ − clearSpan/2` is the front face; rows are `k' × step`
    // in from there for `k' = 1..rows`.
    const bayFront = bay.midZ - bay.clearSpanMm / 2;
    for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
      const z = bayFront + (rowIdx + 1) * rowStep;
      for (let joistBay = 0; joistBay < joistBays; joistBay++) {
        const leftCenter = joistXCenters[joistBay]!;
        const rightCenter = joistXCenters[joistBay + 1]!;
        const midX = (leftCenter + rightCenter) / 2;
        const clearGap = rightCenter - leftCenter - joistThicknessMm;
        if (clearGap <= CLEAR_GAP_EPS_MM) continue;
        out.push({
          id: `blocking-bay-${String(bayIdx)}-r${String(rowIdx)}-b${String(joistBay)}`,
          kind: 'blocking',
          material,
          position: { x: midX, y: joistCenterY, z },
          size: { x: clearGap, y: joistDepthMm, z: joistThicknessMm },
          rotation: { x: 0, y: 0, z: 0 },
        });
      }
    }
  }
  return out;
}
