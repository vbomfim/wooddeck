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

export { LayoutError, MAX_DECK_DIMENSION_MM, MIN_DECK_DIMENSION_MM, MIN_JOIST_SPACING_MM, computeLayout } from './layout-engine';
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
  MAX_METHOD_A_BEAM_ROWS,
  MAX_METHOD_A_BLOCK_COUNT,
  MIN_BEAM_ROW_GAP_MM,
  clampMethodABeamRows,
  computeFloatingLayout,
  resolveMethodABeamRows,
} from './floating/floating-layout';
export type { ComputeFloatingLayoutOptions } from './floating/floating-layout';
export { computeBlockGrid, MIN_BLOCK_SPACING_MM } from './floating/block-grid';
export type { BlockGridInput } from './floating/block-grid';
export { computeFloatingBeams } from './floating/floating-beam-layout';
export type { ComputeFloatingBeamsOptions } from './floating/floating-beam-layout';
export { layoutFloatingJoists } from './floating/floating-joist-layout';
export { layoutFloatingDecking } from './floating/floating-decking';
export {
  computeMinFloatingHeightMm,
  computeYStackFloating,
} from './floating/y-stack-floating';
export type { FloatingYStack } from './floating/y-stack-floating';

// -----------------------------------------------------------------
// Issue #72 — blocking between joists (IRC R502.7 / R502.7.1)
// -----------------------------------------------------------------
//
// `MAX_BLOCKING_SPACING_MM` is exported from the ACTIVE helper
// `./blocking-layout` (= 2438 mm = 8 ft, per IRC R502.7.1). Do
// NOT re-export the identically-named legacy constant from
// `./floating/floating-layout` (= 1220 mm = 4 ft) — that is the
// pre-#72 legacy value with no runtime consumer, and was deleted
// as part of PR #73 review MEDIUM #4 to eliminate the name
// collision. See `./index.barrel.test.ts` for the regression pin.
export {
  MAX_BLOCKING_SPACING_MM,
  layoutBlockingBetweenJoists,
} from './blocking-layout';
export type { BlockingLayoutInput } from './blocking-layout';
