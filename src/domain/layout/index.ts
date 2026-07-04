/**
 * `src/domain/layout/index.ts` — the layout package's public facade.
 *
 * Consumers (application/, state/, scene/) import from this file, not
 * from the individual sub-modules. This keeps the internal file split
 * (joist / beam / post / decking) a free implementation detail — a
 * future refactor that merges or splits sub-modules is invisible to
 * callers.
 *
 * The ticket §2 "Interface Contract" lists these as the public API:
 *   - `computeLayout(design)` — orchestrator
 *   - `layoutJoists(design)` — direct-testable sub-function
 *   - `layoutBeams(design)` — direct-testable sub-function
 *   - `layoutPostsAndFootings(design, beams)` — direct-testable sub-function
 *   - `layoutDecking(design)` — direct-testable sub-function
 *   - `LayoutError` — the typed error thrown by `computeLayout`
 *
 * Constants that consumers may want to check (e.g. UI clamps on the
 * min-deck-dimension input control) are also re-exported.
 */

export { LayoutError, MIN_DECK_DIMENSION_MM, computeLayout } from './layout-engine';
export type { ComputeLayoutOptions } from './layout-engine';
export { layoutJoists } from './joist-layout';
export { layoutBeams } from './beam-layout';
export {
  MAX_BEAM_SPAN_MM,
  deriveStockedPostMaterial,
  layoutPostsAndBlocks,
  layoutPostsAndFootings,
} from './post-layout';
export type { PostAndBlockResult, PostAndFootingResult } from './post-layout';
export { BOARD_GAP_MM, layoutDecking, layoutDeckingWithYCenter } from './decking-layout';
export { FOOTING_DEPTH_MM, FOOTING_WIDTH_MM } from './y-stack';

// -----------------------------------------------------------------
// S20 — elevated + deck-blocks foundation (Epic 2)
// -----------------------------------------------------------------
export { computeBlocksUnderPosts } from './foundation/blocks-under-posts';
export type { BlocksUnderPostsInput } from './foundation/blocks-under-posts';

// -----------------------------------------------------------------
// S19 — floating layout engine (Epic 2)
// -----------------------------------------------------------------
export {
  BEAM_TO_BEAM_MAX_SPACING_MM,
  BLOCK_ROW_MAX_SPACING_MM,
  MAX_BLOCKING_SPACING_MM,
  computeFloatingLayout,
} from './floating/floating-layout';
export type { ComputeFloatingLayoutOptions } from './floating/floating-layout';
export { computeBlockGrid } from './floating/block-grid';
export type { BlockGridInput } from './floating/block-grid';
export { computeFloatingBeams } from './floating/floating-beam-layout';
export { computeBlocking } from './floating/blocking-layout';
export type { BlockingInput } from './floating/blocking-layout';
export { layoutFloatingDecking } from './floating/floating-decking';
export {
  computeMinFloatingHeightMm,
  computeYStackFloating,
} from './floating/y-stack-floating';
export type { FloatingYStack } from './floating/y-stack-floating';
