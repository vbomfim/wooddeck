/**
 * `src/domain/layout/layout-engine.ts` — the orchestrator that turns
 * a `DeckDesign` into a fully-populated `Layout` render contract.
 *
 * ## The world frame this engine produces coordinates in
 *
 * Every `LayoutMember.position` / `.size` / `.rotation` value is
 * expressed in the frame documented in `src/domain/model.ts`
 * "LAYOUT COORDINATE FRAME" section:
 *
 *   +x = deck WIDTH   (matches `DeckDesign.footprint.widthMm`)
 *   +y = UP           (gravity opposes +y — matches `.heightMm`)
 *   +z = deck LENGTH  (matches `.lengthMm`)
 *
 *   Origin (0,0,0) is the ground-level CENTER of the footprint.
 *   Above-ground framing lives in y ∈ [0, heightMm]; footings extend
 *   into −y. Rotation is Euler radians, `'XYZ'` order (three.js
 *   default; every MVP member is axis-aligned so the vector is
 *   `{x:0, y:0, z:0}`).
 *
 * A copy of this contract is intentionally reproduced here (per the
 * S4 ticket §15 "put the convention in a code comment at the top of
 * layout-engine.ts") — the model.ts version remains authoritative.
 *
 * ## Zero geometry math in the scene layer
 *
 * `computeLayout` produces coordinates that S10 (the three.js scene)
 * and S15 (the 2D plan view) render UNCHANGED. Every axis-flip, every
 * material-to-mm lookup, every stacking-offset calculation happens
 * here. This is the pure-core / hexagonal seam that keeps the scene
 * layer a thin adapter (FR-005 + Code Review Guardian finding #3).
 *
 * ## Determinism (AC7)
 *
 * `computeLayout` is a pure function of `(design, options)`. The ONLY
 * non-deterministic element is the ISO timestamp assigned to
 * `Layout.computedAt` — supplied by the `options.now` clock which
 * defaults to `() => new Date().toISOString()`. Tests inject a fixed
 * clock so byte-for-byte determinism holds.
 *
 * ## Error contract
 *
 * `computeLayout` throws `LayoutError` when the input `DeckDesign` is
 * unusable:
 *
 *   - `widthMm` / `lengthMm` below `MIN_DECK_DIMENSION_MM` (or ≤ 0)
 *   - `heightMm` below `computeMinStructuralHeightMm(design)` — the
 *     structural stack (decking + joist + beam depth + MIN_POST_HEIGHT_MM)
 *     would land underground if we allowed less; a zero-height design
 *     would produce zero-y-extent posts and negative-y beams. The
 *     error message includes the computed minimum so S13's UI can
 *     clamp its height input to a legal value.
 *   - `joist.spacingMm` below the joist material's actual thickness
 *     (spacings smaller than the joist thickness cause adjacent joists
 *     to overlap, violating AC3 for a "valid" design).
 *   - any material triple not in the catalog (re-thrown from the
 *     downstream `lookupMaterial` failure — never silently partially
 *     filled)
 *
 * Silent partial layouts are FORBIDDEN by the ticket. The scene layer
 * treats a `LayoutError` as "show a validation banner"; the state
 * layer catches it and preserves the previous good layout.
 */

import type { DeckDesign, Layout, LayoutMember } from '../model';
import { lookupMaterial } from '../materials-catalog';
import { MM_PER_FOOT, type Mm } from '../units';

import { layoutBeams } from './beam-layout';
import { layoutDecking } from './decking-layout';
import { layoutJoists } from './joist-layout';
import { layoutPostsAndFootings } from './post-layout';
import { MIN_POST_HEIGHT_MM } from './y-stack';

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
 * Options for `computeLayout`. `now` is INJECTED so tests can lock in
 * a deterministic `computedAt` timestamp (AC7). Default: real clock.
 */
export interface ComputeLayoutOptions {
  /**
   * A clock returning an ISO-8601 timestamp for `Layout.computedAt`.
   * Called EXACTLY ONCE per `computeLayout` invocation. Defaults to
   * `() => new Date().toISOString()`.
   */
  readonly now?: () => string;
}

// Re-export `MIN_POST_HEIGHT_MM` so consumers (S13's height input) can
// clamp their UI floor to the value the engine considers valid.
export { MIN_POST_HEIGHT_MM } from './y-stack';

/**
 * Compute the **minimum legal `heightMm`** for a given design, i.e.
 * the smallest deck height at which every above-ground member of the
 * layout would still lie in `y ∈ [0, heightMm]` and every post would
 * still have a positive y-extent.
 *
 * Derivation (bottom-up along the y-stack — see `y-stack.ts`):
 *
 *     y = 0                        ← ground plane
 *      ↑ MIN_POST_HEIGHT_MM        ← minimum positive post extent
 *      ↑ beamDepthMm                ← full beam depth (drop-beam)
 *      ↑ joistDepthMm               ← full joist depth (sits on beam)
 *      ↑ deckingThicknessMm         ← decking board thickness
 *     y = heightMm                 ← walking surface
 *
 * MIN = deckingThicknessMm + joistDepthMm + beamDepthMm + MIN_POST_HEIGHT_MM
 *
 * Depends on the design's material triple (thicker joist ⇒ higher
 * minimum). Exported so S13's height input can call it directly to
 * decide its slider/spinner minimum.
 *
 * @throws {LayoutError} if any of the decking / joist / beam material
 *   triples are not in the catalog (wrapped from `lookupMaterial`).
 */
export function computeMinStructuralHeightMm(design: DeckDesign): Mm {
  let decking, joist, beam;
  try {
    decking = lookupMaterial(
      design.decking.material.nominal,
      design.decking.material.species,
      design.decking.material.grade,
    );
    joist = lookupMaterial(
      design.joist.material.nominal,
      design.joist.material.species,
      design.joist.material.grade,
    );
    beam = lookupMaterial(
      design.beam.material.nominal,
      design.beam.material.species,
      design.beam.material.grade,
    );
  } catch (err) {
    throw new LayoutError(
      `computeMinStructuralHeightMm failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return (
    decking.actual.widthMm +
    joist.actual.heightMm +
    beam.actual.heightMm +
    MIN_POST_HEIGHT_MM
  );
}

/**
 * Turn a `DeckDesign` into a complete `Layout` render contract. See
 * module header for the coordinate frame, error contract, and
 * determinism guarantee.
 *
 * @throws {LayoutError} when the design is invalid or references an
 *   unknown material.
 */
export function computeLayout(
  design: DeckDesign,
  options?: ComputeLayoutOptions,
): Layout {
  validateDesign(design);
  const now = options?.now ?? defaultNow;

  try {
    const joists = layoutJoists(design);
    const beams = layoutBeams(design);
    const { posts, footings } = layoutPostsAndFootings(design, beams);
    const boards = layoutDecking(design);

    // Order intentionally matches the y-stack top-to-bottom / structural
    // order (decking-boards, joists, beams, posts, footings). AC7's
    // determinism assertion is deep-equal on the array, so keeping the
    // order stable here is important.
    const members: LayoutMember[] = [
      ...boards,
      ...joists,
      ...beams,
      ...posts,
      ...footings,
    ];

    return {
      designId: design.id,
      computedAt: now(),
      bounds: {
        widthMm: design.footprint.widthMm,
        lengthMm: design.footprint.lengthMm,
        heightMm: design.footprint.heightMm,
      },
      members,
    };
  } catch (err) {
    if (err instanceof LayoutError) throw err;
    // Any downstream throw (e.g. from `lookupMaterial` for an unknown
    // material triple) is wrapped as `LayoutError` with the original as
    // `cause` — preserves the diagnostic while giving callers a single
    // typed error to catch.
    throw new LayoutError(
      `computeLayout failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Validate the design at the layout-engine boundary. Checks:
 *
 *   1. widthMm / lengthMm ≥ MIN_DECK_DIMENSION_MM
 *   2. joist material triple in catalog + joist spacing ≥ joist thickness
 *   3. heightMm ≥ computeMinStructuralHeightMm(design)
 *
 * The joist / height checks look up materials in the catalog so
 * validation surface = "everything computeLayout can prove wrong up
 * front" — silent partial layouts are FORBIDDEN. These are
 * trust-boundary defensive checks (per Developer Guardian rules) —
 * they may look "impossible" given the strict `DeckDesign` type, but
 * the design enters the domain through `.deck` file parsing (S6)
 * which can hand off a technically-typed-correct value with
 * nonsensical numbers.
 */
function validateDesign(design: DeckDesign): void {
  const { widthMm, lengthMm, heightMm } = design.footprint;

  if (!Number.isFinite(widthMm) || widthMm < MIN_DECK_DIMENSION_MM) {
    throw new LayoutError(
      `Invalid deck width: widthMm=${widthMm} is below the minimum of ${MIN_DECK_DIMENSION_MM} mm ` +
        `(${MIN_DECK_DIMENSION_MM / MM_PER_FOOT}′). Freestanding decks smaller than this are ` +
        `outside the MVP layout engine's supported range.`,
    );
  }
  if (!Number.isFinite(lengthMm) || lengthMm < MIN_DECK_DIMENSION_MM) {
    throw new LayoutError(
      `Invalid deck length: lengthMm=${lengthMm} is below the minimum of ${MIN_DECK_DIMENSION_MM} mm ` +
        `(${MIN_DECK_DIMENSION_MM / MM_PER_FOOT}′). Freestanding decks smaller than this are ` +
        `outside the MVP layout engine's supported range.`,
    );
  }

  // Joist-spacing min: the joist material's actual thickness. Spacings
  // smaller than the joist thickness produce OVERLAPPING joists (they
  // are placed at ≥ actualSpacing centre-to-centre but each joist has
  // `thickness` extent on x). Fails AC3 silently otherwise; reject
  // loudly here so S13 can surface the min to the user. Look up the
  // joist material via the catalog — this also validates the material
  // triple, but if that fails we surface a specific LayoutError below.
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
  if (!Number.isFinite(design.joist.spacingMm) || design.joist.spacingMm < joistThicknessMm) {
    throw new LayoutError(
      `Invalid joist spacing: spacingMm=${design.joist.spacingMm} must be ≥ the joist ` +
        `thickness of ${joistThicknessMm} mm (spacings smaller than the joist thickness ` +
        `would produce overlapping joists). Typical values: 305 mm (12″), 406 mm (16″), ` +
        `508 mm (20″), 610 mm (24″).`,
    );
  }

  // Height min: the y-stack must fit above ground with strictly
  // positive posts. See `computeMinStructuralHeightMm` for the
  // derivation. Height=0 (and any short-height design that would push
  // framing underground) is REJECTED here rather than silently
  // clamping to a degenerate geometry.
  const minStructuralHeightMm = computeMinStructuralHeightMm(design);
  if (!Number.isFinite(heightMm) || heightMm < minStructuralHeightMm) {
    throw new LayoutError(
      `Invalid deck height: heightMm=${heightMm} must be ≥ ${minStructuralHeightMm} mm ` +
        `(the structural minimum for the chosen decking/joist/beam materials plus a ` +
        `${MIN_POST_HEIGHT_MM} mm minimum post extent). Below this, joists and beams ` +
        `would land underground and posts would have zero y-extent. S13's UI height ` +
        `input MUST clamp its lower bound to computeMinStructuralHeightMm(design).`,
    );
  }
}
