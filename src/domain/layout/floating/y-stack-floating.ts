/**
 * `src/domain/layout/floating/y-stack-floating.ts` — the single
 * source-of-truth for the VERTICAL (y-axis) stack of a **floating**
 * wooddeck layout.
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
 * grade; framing sits on the blocks; decking sits on top of the
 * framing. The stack builds UPWARD from y=0.
 *
 * ## S26 — two framing methods
 *
 * The pre-S26 floating pipeline had ONE stack: block → beam →
 * decking (no joist layer). S26 (fix/floating-framing-joists) adds
 * a joist layer for BOTH methods and lets the user pick:
 *
 *   - Method A (`'beams-and-joists'`, DEFAULT):
 *
 *         y = deckingTop
 *           ↑ decking thickness
 *           ↑ joist depth
 *           ↑ beam depth        ← beam bottom flush with block top
 *         y = 0                  ← ground plane / block top
 *           ↓ block height
 *
 *     Above-ground min height = beam.depth + joist.depth +
 *     decking.thickness.
 *
 *   - Method B (`'joists-on-blocks'`):
 *
 *         y = deckingTop
 *           ↑ decking thickness
 *           ↑ joist depth      ← joist bottom flush with block top
 *         y = 0
 *           ↓ block height
 *
 *     Above-ground min height = joist.depth + decking.thickness.
 *
 * The `beamDepthMm` field is 0 for Method B (there is no beam
 * layer) so downstream consumers switching on `design.floatingFraming`
 * don't have to special-case a missing field. When both methods
 * are simultaneously needed (e.g. UI preview), read the anchor
 * fields (`joistCenterY`, `beamCenterY`, `deckingCenterY`) and let
 * the y-value tell the truth.
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
 * Pure `src/domain/**` module. Imports only `../units`, `../model`
 * (type-only), `../materials-catalog`, `../foundation-catalog` —
 * every one under `src/domain/**`. No runtime DOM / framework
 * dependency.
 */

import { lookupFoundationProduct } from '../../foundation-catalog';
import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign } from '../../model';
import type { Mm } from '../../units';
import { assertNever } from '../../assert-never';

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

  /**
   * Beam bottom face. Method A: 0 (sits on block top). Method B:
   * equal to `beamTopY` — the layer collapses to zero-thickness
   * because there is no beam.
   */
  readonly beamBottomY: Mm;
  /**
   * Beam geometric center — the y a beam member would use if the
   * method produced beams. Method B: same as `joistCenterY` (the
   * beam layer has zero extent — see `beamDepthMm`).
   */
  readonly beamCenterY: Mm;
  /**
   * Beam top face — where the joist bottom rests in Method A.
   * Method B: equal to `beamBottomY` (zero-thickness layer).
   */
  readonly beamTopY: Mm;
  /**
   * Beam depth on +y. Method A: beam material's actual heightMm
   * (on-edge). Method B: 0 — the stack skips the beam layer.
   */
  readonly beamDepthMm: Mm;

  /** Joist bottom face — flush with the beam top (Method A) or the block top (Method B). */
  readonly joistBottomY: Mm;
  /** Joist geometric center. */
  readonly joistCenterY: Mm;
  /** Joist top face — where the decking rests. */
  readonly joistTopY: Mm;
  /** Joist actual heightMm (larger dressed dimension, on-edge). */
  readonly joistDepthMm: Mm;

  /** Decking bottom face — flush with the joist top. */
  readonly deckingBottomY: Mm;
  /** Decking geometric center. */
  readonly deckingCenterY: Mm;
  /**
   * Decking top face — the walking surface of the finished deck.
   * ALSO the minimum legal `footprint.heightMm` for a floating
   * design of this method (see `computeMinFloatingHeightMm` — same
   * value, different lookup path).
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
 * Dispatches on `design.floatingFraming`:
 *
 *   - `'beams-and-joists'` (Method A) — full stack, joists on beams.
 *   - `'joists-on-blocks'` (Method B) — collapsed stack, joists on blocks.
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
  const joist = lookupMaterial(
    design.joist.material.nominal,
    design.joist.material.species,
    design.joist.material.grade,
  );
  const decking = lookupMaterial(
    design.decking.material.nominal,
    design.decking.material.species,
    design.decking.material.grade,
  );

  // Exhaustive switch on `design.floatingFraming` — Method A
  // includes a beam layer between blocks and joists; Method B
  // skips the beam layer (`beamDepthMm = 0` collapses the stack).
  // TypeScript's control-flow narrowing proves the `default:`
  // branch is unreachable at compile time (via `assertNever`);
  // it also fails LOUD at runtime if the union widens via a bad
  // cast or corrupt persisted data. S26 FIX #7 (Security#2) —
  // replaces a two-branch ternary.
  let beamDepthMm: Mm;
  switch (design.floatingFraming) {
    case 'beams-and-joists':
      beamDepthMm = beam.actual.heightMm;
      break;
    case 'joists-on-blocks':
      beamDepthMm = 0;
      break;
    default:
      assertNever(
        design.floatingFraming,
        'computeMinFloatingHeightMm: design.floatingFraming',
      );
  }
  const joistDepthMm = joist.actual.heightMm;
  const deckingThicknessMm = decking.actual.widthMm;

  const blockBottomY = -blockHeightMm;
  const blockCenterY = -blockHeightMm / 2;
  const blockTopY = 0;

  const beamBottomY = 0;
  const beamTopY = beamDepthMm;
  const beamCenterY = beamDepthMm / 2;

  const joistBottomY = beamTopY;
  const joistTopY = joistBottomY + joistDepthMm;
  const joistCenterY = joistBottomY + joistDepthMm / 2;

  const deckingBottomY = joistTopY;
  const deckingCenterY = joistTopY + deckingThicknessMm / 2;
  const deckingTopY = joistTopY + deckingThicknessMm;

  return {
    blockBottomY,
    blockCenterY,
    blockTopY,
    blockHeightMm,
    beamBottomY,
    beamCenterY,
    beamTopY,
    beamDepthMm,
    joistBottomY,
    joistCenterY,
    joistTopY,
    joistDepthMm,
    deckingBottomY,
    deckingCenterY,
    deckingTopY,
    deckingThicknessMm,
  };
}

/**
 * The minimum legal `footprint.heightMm` for a floating design.
 *
 * Method A: `beam.height + joist.height + decking.thickness`
 * Method B: `joist.height + decking.thickness`
 *
 * NO `MIN_POST_HEIGHT_MM` component (floating decks have no posts).
 * Blocks live BELOW y=0 and do NOT contribute to the visible
 * above-ground height.
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
  const stack = computeYStackFloating(design);
  return stack.beamDepthMm + stack.joistDepthMm + stack.deckingThicknessMm;
}
