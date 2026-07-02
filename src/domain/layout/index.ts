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
export { MAX_BEAM_SPAN_MM, layoutPostsAndFootings } from './post-layout';
export type { PostAndFootingResult } from './post-layout';
export { BOARD_GAP_MM, layoutDecking } from './decking-layout';
export { FOOTING_DEPTH_MM, FOOTING_WIDTH_MM } from './y-stack';
