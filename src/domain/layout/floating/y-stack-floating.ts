/**
 * `src/domain/layout/floating/y-stack-floating.ts` — the single
 * source-of-truth for the VERTICAL (y-axis) stack of a **floating**
 * wooddeck layout (S19).
 *
 * ## Why a separate y-stack for floating
 *
 * The elevated y-stack (`../y-stack.ts`) derives every anchor from
 * `design.footprint.heightMm` — the walking surface is pinned at
 * `y = heightMm`, and everything else is placed downward from there
 * (decking, joists, beams, posts). That geometry ONLY makes sense
 * when there are posts to fill the gap between the beam bottom and
 * the ground.
 *
 * In the floating model there are NO posts. Blocks sit directly on
 * grade; beams sit on the blocks; decking sits on the beams. The
 * stack builds UPWARD from y=0, and `heightMm` is a derived value
 * (min = `beam.height + decking.thickness`), not the anchor.
 *
 * Sharing the elevated helper would either:
 *
 *   1. Silently produce nonsense (posts of zero height, beams
 *      floating in mid-air), or
 *   2. Force the caller to pre-compute `heightMm` from the block
 *      product and lumber dims — leaking the y-stack derivation into
 *      every caller. A dual-SoT drift trap the S18 review-gate FIX 2
 *      pattern specifically warns against.
 *
 * Instead this module owns the entire vertical stack for floating
 * layouts. Consumers call `computeYStackFloating(design)` and get
 * ready-to-use anchor y-positions.
 *
 * ## The stack (bottom-up, y increasing)
 *
 *   1. Block BOTTOM   at y = -blockHeightMm             (block extends into -y)
 *   2. Block CENTER   at y = -blockHeightMm / 2
 *   3. Block TOP      at y = 0                          (= ground plane / beam BOTTOM)
 *   4. Beam BOTTOM    at y = 0
 *   5. Beam CENTER    at y = beamDepthMm / 2
 *   6. Beam TOP       at y = beamDepthMm                (= decking BOTTOM)
 *   7. Decking BOTTOM at y = beamDepthMm
 *   8. Decking CENTER at y = beamDepthMm + deckingThicknessMm / 2
 *   9. Decking TOP    at y = beamDepthMm + deckingThicknessMm
 *
 * The block "extends" into -y from the ground plane because the
 * origin is the ground-level CENTER of the deck footprint (see
 * `model.ts` LAYOUT COORDINATE FRAME). This mirrors how footings
 * live in -y in the elevated stack — a familiar convention for
 * downstream consumers.
 *
 * ## `blockHeightMm` is derived from the design's foundation product
 *
 * Both floating-legal foundations (`deck-blocks` / `tuffblocks`)
 * carry a `product: FoundationBlockRef` field; the helper looks up
 * the product in `foundation-catalog.ts` for the concrete
 * `actual.heightMm`. `posts-on-footings` is REJECTED as caller
 * misuse (mirrors the defensive guard in `layoutPostsAndFootings`).
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only `./units`, `./model`
 * (type-only), `./materials-catalog`, `./foundation-catalog` —
 * every one under `src/domain/**`. No runtime DOM / framework
 * dependency.
 */

import { lookupFoundationProduct } from '../../foundation-catalog';
import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign } from '../../model';
import type { Mm } from '../../units';

/**
 * The y-anchor bundle for a floating layout. Every field is a
 * bottom-up-computed y position in the world frame documented in
 * `model.ts` LAYOUT COORDINATE FRAME (origin = ground-level center;
 * +y = up).
 *
 * Consumers should never re-derive one of these values from another
 * — always read the pre-computed field. That way a future
 * refactor that changes the stack (e.g. adds a shim between block
 * and beam) has ONE seam.
 */
export interface FloatingYStack {
  /** Block bottom face — extends into -y. */
  readonly blockBottomY: Mm;
  /** Block geometric center — `-blockHeightMm / 2`. */
  readonly blockCenterY: Mm;
  /** Block top face — flush with the ground plane at y=0. */
  readonly blockTopY: Mm;
  /** Block product's actual heightMm (from `foundation-catalog`). */
  readonly blockHeightMm: Mm;

  /** Beam bottom face — sits on the block top at y=0. */
  readonly beamBottomY: Mm;
  /** Beam geometric center — `beamDepthMm / 2`. */
  readonly beamCenterY: Mm;
  /** Beam top face — where decking rests. */
  readonly beamTopY: Mm;
  /** Beam actual heightMm (larger dressed dimension, on-edge). */
  readonly beamDepthMm: Mm;

  /** Decking bottom face — flush with the beam top. */
  readonly deckingBottomY: Mm;
  /** Decking geometric center. */
  readonly deckingCenterY: Mm;
  /**
   * Decking top face — the walking surface of the finished deck.
   * ALSO the minimum legal `footprint.heightMm` for a floating
   * design (see `computeMinFloatingHeightMm` below — same value,
   * different lookup path).
   */
  readonly deckingTopY: Mm;
  /**
   * Decking board thickness (SMALLER dressed dimension — boards
   * laid flat, per `materials-catalog.ts` convention shared with
   * the elevated y-stack).
   */
  readonly deckingThicknessMm: Mm;
}

/**
 * Compute every anchor position in the floating y-stack for a
 * given design. Pure function; results are byte-stable for a given
 * input (no clock, no RNG, no I/O).
 *
 * @throws {Error} if `design.foundation.type === 'posts-on-footings'`
 *   — caller-contract violation (this helper is only valid for
 *   floating designs). See module header.
 * @throws {Error} from `lookupMaterial` / `lookupFoundationProduct`
 *   when a design references an unknown material triple or block
 *   product. The layout-engine wraps these as `LayoutError` at the
 *   outer boundary.
 */
export function computeYStackFloating(design: DeckDesign): FloatingYStack {
  // Caller-contract guard — `floating` layouts are the only shape
  // this helper models. `posts-on-footings` has no `.product` field
  // so a silent proceed would throw an obscure "cannot read
  // productId" TypeError later; loud is better than silent.
  if (design.foundation.type === 'posts-on-footings') {
    throw new Error(
      `computeYStackFloating: expected a floating foundation ` +
        `(deck-blocks | tuffblocks), got 'posts-on-footings'. This helper ` +
        `is only valid for the S19 floating layout pipeline. ` +
        `See src/domain/layout/floating/y-stack-floating.ts.`,
    );
  }

  const product = lookupFoundationProduct(design.foundation.product.productId);
  const blockHeightMm = product.actual.heightMm;

  const beam = lookupMaterial(
    design.beam.material.nominal,
    design.beam.material.species,
    design.beam.material.grade,
  );
  const beamDepthMm = beam.actual.heightMm; // larger dressed dim, on-edge

  const decking = lookupMaterial(
    design.decking.material.nominal,
    design.decking.material.species,
    design.decking.material.grade,
  );
  const deckingThicknessMm = decking.actual.widthMm; // smaller dressed dim, laid flat

  const blockBottomY = -blockHeightMm;
  const blockCenterY = -blockHeightMm / 2;
  const blockTopY = 0;

  const beamBottomY = 0;
  const beamCenterY = beamDepthMm / 2;
  const beamTopY = beamDepthMm;

  const deckingBottomY = beamTopY;
  const deckingCenterY = beamTopY + deckingThicknessMm / 2;
  const deckingTopY = beamTopY + deckingThicknessMm;

  return {
    blockBottomY,
    blockCenterY,
    blockTopY,
    blockHeightMm,
    beamBottomY,
    beamCenterY,
    beamTopY,
    beamDepthMm,
    deckingBottomY,
    deckingCenterY,
    deckingTopY,
    deckingThicknessMm,
  };
}

/**
 * The minimum legal `footprint.heightMm` for a floating design —
 * AC9. The above-ground stack is exactly:
 *
 *     MIN = beam.actual.heightMm + decking.actual.widthMm
 *
 * NO `MIN_POST_HEIGHT_MM` component (floating decks have no posts;
 * see module header). Blocks live BELOW y=0 and do NOT contribute
 * to the visible above-ground height.
 *
 * The layout-engine's floating-path validator calls this to
 * reject designs whose `heightMm` is set below the physical stack
 * — matching the elevated `computeMinStructuralHeightMm` rejection
 * pattern.
 *
 * @throws {Error} from `lookupMaterial` when the design references
 *   an unknown material triple.
 */
export function computeMinFloatingHeightMm(design: DeckDesign): Mm {
  const beam = lookupMaterial(
    design.beam.material.nominal,
    design.beam.material.species,
    design.beam.material.grade,
  );
  const decking = lookupMaterial(
    design.decking.material.nominal,
    design.decking.material.species,
    design.decking.material.grade,
  );
  return beam.actual.heightMm + decking.actual.widthMm;
}
