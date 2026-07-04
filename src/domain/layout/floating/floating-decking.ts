/**
 * `src/domain/layout/floating/floating-decking.ts` — position the
 * decking boards for a floating deck.
 *
 * ## Why a thin wrapper (and not `layoutDecking(design)` directly)
 *
 * The elevated `layoutDecking(design)` uses
 * `computeYStack(design).deckingCenterY` — i.e. anchors the decking
 * DOWN from `footprint.heightMm`. In the floating stack the anchor
 * comes from the BEAM TOP (`computeYStackFloating(design).deckingCenterY`),
 * which is derived UP from y=0 and does NOT depend on
 * `footprint.heightMm`.
 *
 * `decking-layout.ts` exposes a seam function
 * `layoutDeckingWithYCenter(design, yCenter)` that accepts an
 * explicit y-center. All other decking geometry (row count, gap,
 * flush-at-both-ends contract, material lookup) is shared with the
 * elevated path — a DRY win and an accidental-drift trap.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling `layout/`
 * modules and this floating-package's `y-stack-floating`.
 */

import type { DeckDesign, LayoutMember } from '../../model';

import { layoutDeckingWithYCenter } from '../decking-layout';

import { computeYStackFloating } from './y-stack-floating';

/**
 * Build the floating decking layer. Pure — same input yields
 * byte-equal output.
 *
 * @throws {Error} propagated from `computeYStackFloating` when the
 *   design's foundation is `posts-on-footings` (caller-contract
 *   violation) OR when the material catalog lookups fail (unknown
 *   triple / product id). Wrapped as `LayoutError` by the layout
 *   engine.
 */
export function layoutFloatingDecking(design: DeckDesign): readonly LayoutMember[] {
  const yStack = computeYStackFloating(design);
  return layoutDeckingWithYCenter(design, yStack.deckingCenterY);
}
