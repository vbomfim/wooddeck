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
import { lookupFoundationProduct } from '../foundation-catalog';
import { lookupMaterial } from '../materials-catalog';
import { validateFoundationCombination } from '../compat-matrix';
import type { SpanTable } from '../spans/span-table';
import { MM_PER_FOOT, type Mm } from '../units';

import { layoutBeams } from './beam-layout';
import { layoutBlockingBetweenJoists } from './blocking-layout';
import { layoutDecking } from './decking-layout';
import { computeFloatingLayout } from './floating/floating-layout';
import { computeJoistXCenters, layoutJoists } from './joist-layout';
import { layoutPostsAndBlocks, layoutPostsAndFootings } from './post-layout';
import {
  LayoutError,
  MAX_DECK_DIMENSION_MM,
  MIN_DECK_DIMENSION_MM,
  validateFlushBeamDepth,
  validateJoistSpacing,
} from './layout-shared';
import { FOOTING_WIDTH_MM, MIN_POST_HEIGHT_MM, computeFramingStackMm, computeYStack } from './y-stack';

// Re-export the shared symbols so the pre-S19 public API surface
// (`import { LayoutError, MIN_DECK_DIMENSION_MM } from './layout-engine'`)
// remains unchanged for existing callers. See `layout-shared.ts`
// module header for the cycle-break rationale.
export { LayoutError, MAX_DECK_DIMENSION_MM, MIN_DECK_DIMENSION_MM };

// -----------------------------------------------------------------
// `MIN_DECK_DIMENSION_MM` and `LayoutError` were extracted to
// `layout-shared.ts` in S19 to break the cycle
// `layout-engine.ts → floating/floating-layout.ts → layout-engine.ts`
// (`dependency-cruiser`'s `no-circular` rule fired otherwise). Both
// symbols are re-exported at the top of this file so the public API
// is byte-identical to the pre-S19 signature.
// -----------------------------------------------------------------

/**
 * Options for `computeLayout`. `now` is INJECTED so tests can lock in
 * a deterministic `computedAt` timestamp (AC7).
 *
 * `spanTable` is INJECTED (Code Review Fix #4) so the floating
 * Method-B path can derive a SPAN-SAFE default row count when
 * `foundation.blockRowsHint` is absent. Threaded straight through
 * to `computeFloatingLayout` → `computeMethodB` → `resolveMethodBGrid`;
 * ELEVATED and Method-A layouts ignore this field (byte-identical
 * before/after).
 */
export interface ComputeLayoutOptions {
  /**
   * A clock returning an ISO-8601 timestamp for `Layout.computedAt`.
   * Called EXACTLY ONCE per `computeLayout` invocation. Defaults to
   * `() => new Date().toISOString()`.
   */
  readonly now?: () => string;
  /**
   * Optional IRC span table. When provided, `computeMethodB`
   * derives a span-safe default row count from the joist's
   * allowable — a fresh Method-B deck at any typical size does
   * NOT start over-spanned. When absent (or when the joist
   * material isn't in the catalog), the layout falls back to the
   * 1220 mm-derived count (byte-identity with pre-fix consumers).
   */
  readonly spanTable?: SpanTable;
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
 *      ↑ blockHeightMm             ← ONLY for elevated + deck-blocks (S20);
 *                                    zero-effect on posts-on-footings
 *      ↑ MIN_POST_HEIGHT_MM        ← minimum positive post extent
 *      ↑ beamDepthMm                ← full beam depth (drop-beam)
 *      ↑ joistDepthMm               ← full joist depth (sits on beam)
 *      ↑ deckingThicknessMm         ← decking board thickness
 *     y = heightMm                 ← walking surface
 *
 * For `foundation.type === 'posts-on-footings'`:
 *
 *   MIN = deckingThicknessMm + joistDepthMm + beamDepthMm
 *       + MIN_POST_HEIGHT_MM
 *
 * For `foundation.type === 'deck-blocks'` (S20 — AC6):
 *
 *   MIN = deckingThicknessMm + joistDepthMm + beamDepthMm
 *       + MIN_POST_HEIGHT_MM + product.actual.heightMm
 *
 * The deck-blocks branch adds exactly the block's actual height — the
 * block sits ON grade and lifts the whole framing stack by its own
 * height. `tuffblocks` under elevated is rejected earlier by the
 * FR-030 compat matrix, so it never reaches this function on the
 * elevated dispatch path (floating designs go through
 * `computeMinFloatingHeightMm`).
 *
 * Depends on the design's material triple (thicker joist ⇒ higher
 * minimum). Exported so S13's height input can call it directly to
 * decide its slider/spinner minimum.
 *
 * @throws {LayoutError} if any of the decking / joist / beam material
 *   triples are not in the catalog (wrapped from `lookupMaterial`);
 *   also thrown for an unknown foundation product id (wrapped from
 *   `lookupFoundationProduct`).
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
  const framingStackMm = computeFramingStackMm({
    beamConnection: design.beamConnection,
    deckingThicknessMm: decking.actual.widthMm,
    joistDepthMm: joist.actual.heightMm,
    beamDepthMm: beam.actual.heightMm,
  });

  // S20 — elevated + deck-blocks lifts the framing stack by the
  // block's actual height. Other foundation types (posts-on-footings,
  // floating variants) have no block-height contribution here — the
  // floating pipeline has its own `computeMinFloatingHeightMm`.
  if (design.foundation.type === 'deck-blocks' && design.structure === 'elevated') {
    // Defensive guard (S20 review-gate FIX 4d) — consistency with the
    // caller-contract throws in `layoutPostsAnd{Footings,Blocks}`.
    // The enclosing `if` already narrows `structure` to `'elevated'`,
    // but an explicit re-check documents the intent and fires loudly
    // if a future refactor drops the compound condition. Keep as
    // belt-and-braces per the S20 Trust-Boundaries rule.
    //
    // Cast to `string` because TS narrows `design.structure` to
    // `never` once the enclosing `if` proves it is `'elevated'` —
    // proving the assertion is TS-unreachable today. The runtime
    // check still catches the case where the enclosing condition is
    // ever loosened (which is exactly the scenario the guard exists
    // to defend).
    const structureAtRuntime: string = design.structure;
    if (structureAtRuntime !== 'elevated') {
      throw new LayoutError(
        `computeMinStructuralHeightMm: the block-adjusted branch is only ` +
          `valid for structure === 'elevated' (got '${structureAtRuntime}'). ` +
          `Floating decks use computeMinFloatingHeightMm — see ` +
          `src/domain/layout/floating/y-stack-floating.ts.`,
      );
    }
    let product;
    try {
      product = lookupFoundationProduct(design.foundation.product.productId);
    } catch (err) {
      throw new LayoutError(
        `computeMinStructuralHeightMm failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    return framingStackMm + product.actual.heightMm;
  }
  return framingStackMm;
}

/**
 * Turn a `DeckDesign` into a complete `Layout` render contract. See
 * module header for the coordinate frame, error contract, and
 * determinism guarantee.
 *
 * ## Structure × foundation dispatch (Epic 2 S20)
 *
 * Two gates run BEFORE the layout math:
 *
 *   1. **Compat matrix (FR-030)** — `validateFoundationCombination`
 *      rejects the two illegal combos (`elevated`+`tuffblocks` and
 *      `floating`+`posts-on-footings`) as a `LayoutError` carrying
 *      the compat-matrix reason string. This is the single choke-
 *      point every ingress (`readDeckFile`, `loadFromLocalStorage`,
 *      `applyParameters`) inherits — none of those paths need to
 *      call the matrix themselves.
 *   2. **Support gate** — all four compat-legal combos are
 *      implemented as of S20: `elevated`+`posts-on-footings` (S17),
 *      `elevated`+`deck-blocks` (S20 — this ticket),
 *      `floating`+`deck-blocks` (S19), and
 *      `floating`+`tuffblocks` (S19). Exhaustive dispatch with a
 *      `never`-typed default catches any future variant that lands
 *      without a branch here.
 *
 * @throws {LayoutError} when the design is invalid, when the
 *   structure × foundation combo is FR-030-illegal, or when the
 *   design references an unknown material.
 */
export function computeLayout(
  design: DeckDesign,
  options?: ComputeLayoutOptions,
): Layout {
  // ---- Gate 1: FR-030 compat matrix ---------------------------------------
  // Reject the two illegal combos with the compat-matrix reason string
  // before any material lookup happens. A LayoutError here surfaces to
  // the state layer as "keep the previous good layout + show a banner"
  // (see the module header's error contract).
  const compat = validateFoundationCombination({
    structure: design.structure,
    foundation: design.foundation,
  });
  if (!compat.ok) {
    throw new LayoutError(compat.reason);
  }

  // ---- Gate 2: support-gate dispatch --------------------------------------
  // Every compat-legal combo has a branch. A `never`-typed default on
  // both switches catches a future StructureMode or FoundationSpec.type
  // variant without a branch here, so the layout engine fails-compile
  // until the missing path is filled in.
  switch (design.structure) {
    case 'elevated':
      switch (design.foundation.type) {
        case 'posts-on-footings':
          return computeElevatedPostsOnFootingsLayout(design, options);
        case 'deck-blocks':
          return computeElevatedDeckBlocksLayout(design, options);
        case 'tuffblocks':
          // Unreachable — compat gate above already rejected this
          // combo. Kept explicit so the exhaustive default doesn't
          // widen `never` to include it if the compat matrix ever
          // relaxes.
          throw new LayoutError(
            'Elevated + tuffblocks is not a supported combination (FR-030).',
          );
        default: {
          const _exhaustive: never = design.foundation;
          return _exhaustive;
        }
      }
    case 'floating':
      switch (design.foundation.type) {
        case 'posts-on-footings':
          // Unreachable per the compat gate — see note above.
          throw new LayoutError(
            'Floating + posts-on-footings is not a supported combination (FR-030).',
          );
        case 'deck-blocks':
          return computeFloatingLayout(design, options);
        case 'tuffblocks':
          return computeFloatingLayout(design, options);
        default: {
          const _exhaustive: never = design.foundation;
          return _exhaustive;
        }
      }
    default: {
      const _exhaustive: never = design.structure;
      return _exhaustive;
    }
  }
}

/**
 * Compute the layout for the ONLY supported combo in this branch —
 * `structure === 'elevated'` + `foundation.type === 'posts-on-footings'`.
 * This is the legacy S4 code path, unchanged aside from being
 * extracted behind the S17 support-gate dispatch above.
 */
function computeElevatedPostsOnFootingsLayout(
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
    // Issue #72 — solid blocking between joists per IRC R502.7.1.
    // Uses the SAME `computeJoistXCenters` helper the joist layer
    // used above, so blocking cannot drift from joists. The
    // elevated y-anchor comes from `computeYStack.joistCenterY`
    // (co-planar with joists). See `./blocking-layout.ts` for the
    // row rule and per-member geometry.
    const blocking = computeBlockingFromDesign(design);

    // Order intentionally matches the y-stack top-to-bottom / structural
    // order (decking-boards, joists, blocking [co-planar with joists],
    // beams, posts, footings). AC7's determinism assertion is deep-equal
    // on the array, so keeping the order stable here is important.
    const members: LayoutMember[] = [
      ...boards,
      ...joists,
      ...blocking,
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
 * Elevated-pipeline adapter to the shared
 * {@link layoutBlockingBetweenJoists} helper. Extracted so both
 * elevated variants (`posts-on-footings` and `deck-blocks`) share
 * ONE derivation of the joist geometry a blocking row depends on
 * — a future change to the elevated y-stack cannot silently drift
 * blocking off the joist plane.
 *
 * ## Why not thread joists' fields directly
 *
 * The `LayoutMember` shape carries `position.y` and `size.y` but
 * not the raw material triple, so we still need a
 * `lookupMaterial(design.joist.material)` call to recover the
 * dressed thickness / depth. And we still need
 * `computeYStack(design).joistCenterY` for the y-anchor (reading
 * it off a joist member's `position.y` would work, but at the
 * cost of the "single source of truth: y-stack" invariant that
 * every layer honors). So the cleanest form re-derives the four
 * scalars from the same helpers the joist layer used, and passes
 * them into `layoutBlockingBetweenJoists`. Byte-identical output.
 *
 * @throws {Error} from `lookupMaterial` when the joist material
 *   triple is not in the catalog. The layout-engine wraps this as
 *   `LayoutError` at the outer boundary.
 */
function computeBlockingFromDesign(design: DeckDesign): readonly LayoutMember[] {
  const joistMat = lookupMaterial(
    design.joist.material.nominal,
    design.joist.material.species,
    design.joist.material.grade,
  );
  const joistThicknessMm = joistMat.actual.widthMm;
  const joistDepthMm = joistMat.actual.heightMm;
  const widthMm = design.footprint.widthMm;
  const spacingMm = design.joist.spacingMm;
  const joistXCenters = computeJoistXCenters(widthMm, spacingMm, joistThicknessMm);
  const joistCenterY = computeYStack(design).joistCenterY;

  return layoutBlockingBetweenJoists({
    joistXCenters,
    joistCenterY,
    joistThicknessMm,
    joistDepthMm,
    lengthMm: design.footprint.lengthMm,
    material: { kind: 'lumber', ...design.joist.material },
  });
}

/**
 * Compute the layout for `structure === 'elevated'` + `foundation.type
 * === 'deck-blocks'` (S20). Mirrors the shape of
 * `computeElevatedPostsOnFootingsLayout` — same validation, same
 * decking/joist/beam pipeline, same top-to-bottom member order —
 * with two differences:
 *
 *   1. `layoutPostsAndBlocks(design, beams)` replaces
 *      `layoutPostsAndFootings(design, beams)`. Posts are re-anchored
 *      to sit ON TOP of the block (see `post-layout.ts` `layoutPostsAndBlocks`
 *      module doc); the emitted foundation members are `block`s
 *      carrying a real `{kind:'block', productId}` material, NOT the
 *      concrete-lumber-placeholder `footing`s.
 *   2. `members` order is `[boards, joists, beams, posts, blocks]`
 *      (blocks in the trailing foundation slot, mirroring the
 *      posts-on-footings `[..., posts, footings]` order — matches the
 *      y-stack top-to-bottom convention).
 *
 * `Layout.bounds` still equals `design.footprint` — blocks sit on
 * grade (y ∈ [0, blockHeightMm]) and stay inside the horizontal
 * footprint (the Oldcastle 279 mm block is narrower than the 300 mm
 * FOOTING_WIDTH_MM anchor that insets posts from the deck edges), so
 * no true-AABB math is required. S19's `computeFloatingBoundsFromMembers`
 * only applies to floating layouts where blocks overhang the
 * footprint on x/z. If a future block product exceeds
 * FOOTING_WIDTH_MM on any horizontal axis, the bounds contract here
 * must be revisited.
 */
function computeElevatedDeckBlocksLayout(
  design: DeckDesign,
  options?: ComputeLayoutOptions,
): Layout {
  validateDesign(design);
  const now = options?.now ?? defaultNow;

  // Bounds-contract runtime assertion (S20 review-gate FIX 4e) —
  // `Layout.bounds` for elevated + deck-blocks equals
  // `design.footprint` on the assumption that every catalog block
  // fits INSIDE the horizontal footprint (`product.actual.widthMm <
  // FOOTING_WIDTH_MM` AND `product.actual.depthMm < FOOTING_WIDTH_MM`
  // — posts are inset from the footprint edge by FOOTING_WIDTH_MM/2,
  // so blocks narrower than that anchor stay inside on x/z). A
  // future block product that exceeds either dimension would
  // overhang the footprint, violating the invariant, and would
  // require porting `computeFloatingBoundsFromMembers` from S19
  // (see `floating/floating-layout.ts`).
  //
  // We assert loudly at the orchestrator entry so a catalog addition
  // that breaks the invariant fails at layout time — instead of
  // silently emitting a `bounds` that's smaller than the actual
  // member AABB (which would corrupt every downstream renderer /
  // BOM / bounds-based query).
  if (design.foundation.type !== 'deck-blocks') {
    // Dispatcher bug — computeLayout should only route deck-blocks
    // designs here. Defensive throw for the same reason the sibling
    // guards in layoutPostsAnd{Footings,Blocks} throw.
    throw new LayoutError(
      `computeElevatedDeckBlocksLayout: expected foundation.type === ` +
        `'deck-blocks', got '${design.foundation.type}'. Dispatch bug in ` +
        `computeLayout — see src/domain/layout/layout-engine.ts.`,
    );
  }
  const foundationProduct = lookupFoundationProduct(
    design.foundation.product.productId,
  );
  if (
    foundationProduct.actual.widthMm >= FOOTING_WIDTH_MM ||
    foundationProduct.actual.depthMm >= FOOTING_WIDTH_MM
  ) {
    throw new LayoutError(
      `computeElevatedDeckBlocksLayout: block product ` +
        `'${foundationProduct.productId}' has width=` +
        `${foundationProduct.actual.widthMm} mm / depth=` +
        `${foundationProduct.actual.depthMm} mm, one of which is >= ` +
        `FOOTING_WIDTH_MM (${FOOTING_WIDTH_MM} mm). Under this condition ` +
        `the block would overhang the footprint on x or z, so ` +
        `Layout.bounds = design.footprint (the current invariant) ` +
        `would be smaller than the true member AABB. Port ` +
        `computeFloatingBoundsFromMembers from S19 (see ` +
        `src/domain/layout/floating/floating-layout.ts) to recompute ` +
        `bounds from the emitted members instead of relying on the ` +
        `footprint. See S20 review-gate FIX 4e.`,
    );
  }

  try {
    const joists = layoutJoists(design);
    const beams = layoutBeams(design);
    const { posts, blocks } = layoutPostsAndBlocks(design, beams);
    const boards = layoutDecking(design);
    // Issue #72 — solid blocking between joists per IRC R502.7.1.
    // Same helper as the elevated + posts-on-footings pipeline —
    // both elevated paths share the y-stack, so the derivation is
    // identical.
    const blocking = computeBlockingFromDesign(design);

    const members: LayoutMember[] = [
      ...boards,
      ...joists,
      ...blocking,
      ...beams,
      ...posts,
      ...blocks,
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
    throw new LayoutError(
      `computeLayout failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
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

  // feat/block-spacing HIGH #1 defense-in-depth — bound the
  // upper end of the footprint. Without an upper cap, a deck
  // sized close to the pre-cap `Mm` schema maximum (1000000 mm =
  // 1 km) would instance millions of layout members before any
  // downstream cap fires (Method A block grid, Method B block
  // grid, joist array, decking boards). Mirror the schema-side
  // cap here so a pre-persistence path (in-memory patch, test
  // fixture) hits the same guard, with a clear error naming both
  // the offending value and the allowable ceiling.
  if (widthMm > MAX_DECK_DIMENSION_MM) {
    throw new LayoutError(
      `Invalid deck width: widthMm=${widthMm} exceeds the maximum of ${MAX_DECK_DIMENSION_MM} mm ` +
        `(${MAX_DECK_DIMENSION_MM / MM_PER_FOOT}′). Deck sizes above this ceiling are ` +
        `outside the MVP layout engine's supported range.`,
    );
  }
  if (lengthMm > MAX_DECK_DIMENSION_MM) {
    throw new LayoutError(
      `Invalid deck length: lengthMm=${lengthMm} exceeds the maximum of ${MAX_DECK_DIMENSION_MM} mm ` +
        `(${MAX_DECK_DIMENSION_MM / MM_PER_FOOT}′). Deck sizes above this ceiling are ` +
        `outside the MVP layout engine's supported range.`,
    );
  }

  // Joist-spacing min: shared with the floating pipeline via the
  // extracted `validateJoistSpacing` helper. Rejects non-finite,
  // ≤0, and sub-thickness spacings — see `layout-shared.ts` for
  // the full failure-mode enumeration. Extracted in S26 so the
  // floating orchestrator can apply the identical guard (before
  // S26 only the elevated path did, but the S26 rework made
  // floating share `computeJoistXCenters` — the same DoS pathway
  // now exists in both).
  validateJoistSpacing(design);

  // S27 review-response HIGH #2 — flush-beam depth guard. A flush
  // stack with `joistDepth > beamDepth` puts the joist bottom BELOW
  // the beam bottom (physically impossible — the joist has no beam
  // to hang from). Must run BEFORE `computeMinStructuralHeightMm`
  // so the caller sees the *specific* remediation, not the generic
  // height-below-minimum message. Elevated always has 2 beams so no
  // extra structure guard is needed here (the check itself no-ops
  // for `beamConnection === 'drop'`).
  validateFlushBeamDepth(design);

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
