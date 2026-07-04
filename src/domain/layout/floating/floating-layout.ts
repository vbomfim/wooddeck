/**
 * `src/domain/layout/floating/floating-layout.ts` — orchestrator for
 * the FLOATING deck layout pipeline (S19).
 *
 * ## Pipeline
 *
 *   1. `validateFloatingDesign` — mirror the elevated-path defensive
 *      checks (`MIN_DECK_DIMENSION_MM`, `computeMinFloatingHeightMm`)
 *      + a caller-contract guard (must be a `floating` design with
 *      a block-based foundation).
 *   2. `computeBlockGrid` → readonly LayoutMember[] (`block`)
 *   3. `computeFloatingBeams(design, blocks)` → readonly LayoutMember[] (`beam`)
 *   4. `computeBlocking({ beams, joistNominal, species, grade, maxSpacingMm })`
 *      → readonly LayoutMember[] (`blocking`)
 *   5. `layoutFloatingDecking(design)` → readonly LayoutMember[] (`board`)
 *   6. Assemble a `Layout` with `members = [...boards, ...blocking, ...beams, ...blocks]`
 *      — top-down order (matches the y-stack, consistent with the
 *      elevated `[boards, joists, beams, posts, footings]` convention).
 *
 * ## Parameters — parametric per user directive
 *
 *   - `BEAM_TO_BEAM_MAX_SPACING_MM = MAX_BEAM_SPAN_MM = 2438.4 mm` (8′)
 *   - `BLOCK_ROW_MAX_SPACING_MM = 610 mm` (24″, DIY residential norm)
 *   - `MAX_BLOCKING_SPACING_MM = 1220 mm` (48″, IRC blocking rule)
 *
 * All three are MODULE-LEVEL constants (not hardcoded literals in
 * the pipeline), so a future ticket that surfaces them per-material
 * or in the UI is a one-line replacement. NONE are consulted from
 * the elevated span tables — the S19 MVP treats them as fixed DIY
 * defaults matching the user's hand-drawn example.
 *
 * See the S19 handoff "Autonomous Decisions" table for the
 * rationale and reversibility of each value.
 *
 * ## Error contract
 *
 * `computeFloatingLayout` throws `LayoutError` for every failure
 * mode — mirrors the elevated orchestrator (`computeElevatedPostsOnFootingsLayout`).
 * Downstream helpers throw plain `Error` (for boundary / catalog
 * failures); this orchestrator wraps them as `LayoutError` with
 * `cause` so the state layer's `catch (err instanceof LayoutError)`
 * pattern works uniformly across structures.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules.
 */

import type { DeckDesign, Layout, LayoutMember } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';
import { LayoutError, MIN_DECK_DIMENSION_MM } from '../layout-shared';

import { computeBlockGrid } from './block-grid';
import { computeBlocking } from './blocking-layout';
import { computeFloatingBeams } from './floating-beam-layout';
import { layoutFloatingDecking } from './floating-decking';
import { computeMinFloatingHeightMm } from './y-stack-floating';

/**
 * Max cross-width spacing between adjacent BEAMS in a floating deck.
 * 8′ (2438.4 mm) matches the elevated `MAX_BEAM_SPAN_MM` and the
 * user's hand-drawn 16′-wide-3-beam example (16/8 = 2 spans → 3 beams).
 *
 * Autonomous decision — see S19 handoff. Reversible with a
 * one-value change once a span-table-derived value is available.
 */
export const BEAM_TO_BEAM_MAX_SPACING_MM: Mm = 8 * MM_PER_FOOT;

/**
 * Max along-length spacing between adjacent BLOCKS under a single
 * beam. 24″ (610 mm) is the DIY residential norm for closely-spaced
 * block foundations on 2× lumber. Matches the user's hand-drawn
 * 14′-long-8-blocks-per-beam example (14×305/24 ≈ 7 spans → 8 blocks).
 *
 * Autonomous decision — see S19 handoff. Reversible.
 */
export const BLOCK_ROW_MAX_SPACING_MM: Mm = 610;

/**
 * Max on-center spacing between blocking pieces between adjacent
 * beams. 48″ (1220 mm) matches IRC R502.7 blocking recommendations
 * for joists ≥ 2×8. User Q2 (ticket §17) confirmed this value is
 * NOT UI-configurable in the MVP.
 */
export const MAX_BLOCKING_SPACING_MM: Mm = 1220;

/**
 * Options for `computeFloatingLayout` — identical shape to the
 * elevated `ComputeLayoutOptions` so a caller (the layout-engine
 * dispatcher) can pass the same options through unchanged.
 */
export interface ComputeFloatingLayoutOptions {
  readonly now?: () => string;
}

/**
 * Turn a FLOATING `DeckDesign` into a complete `Layout` render
 * contract. See module header for the pipeline and error contract.
 *
 * ## Caller expectations
 *
 *   - `design.structure === 'floating'`
 *   - `design.foundation.type ∈ {'deck-blocks', 'tuffblocks'}`
 *
 * The layout-engine dispatcher enforces both via the compat matrix
 * BEFORE calling here; this function ALSO checks (fail-loud) so a
 * test / future caller that skips the dispatcher does not silently
 * produce nonsense.
 *
 * @throws {LayoutError} on any validation failure or downstream
 *   error (material catalog lookup, foundation catalog lookup,
 *   trust-boundary rejection in `computeBlockGrid`).
 */
export function computeFloatingLayout(
  design: DeckDesign,
  options?: ComputeFloatingLayoutOptions,
): Layout {
  validateFloatingDesign(design);
  const now = options?.now ?? defaultNow;

  try {
    // TypeScript narrowing — after `validateFloatingDesign` we know
    // `foundation.type !== 'posts-on-footings'`, so the extract is
    // safe. Assert via a local const so the compiler propagates the
    // narrowed type into `computeBlockGrid`'s `foundation` param.
    if (design.foundation.type === 'posts-on-footings') {
      // Belt-and-suspenders — the validator already threw. Kept so
      // TypeScript's control-flow narrowing knows `foundation` is
      // one of the two block variants below this line.
      throw new LayoutError(
        'computeFloatingLayout: internal invariant — reached ' +
          "post-validation with foundation.type === 'posts-on-footings'.",
      );
    }

    const blocks = computeBlockGrid({
      footprintMm: {
        widthMm: design.footprint.widthMm,
        lengthMm: design.footprint.lengthMm,
      },
      foundation: design.foundation,
      beamSpanMaxMm: BEAM_TO_BEAM_MAX_SPACING_MM,
      joistSpanMaxMm: BLOCK_ROW_MAX_SPACING_MM,
    });

    const beams = computeFloatingBeams(design, blocks);

    // Blocking uses the SAME material as the beam (per AC6). Pull
    // the triple off the design's beam spec — the material lookup
    // inside `computeBlocking` re-validates the triple is catalog-
    // known.
    const blocking = computeBlocking({
      beams,
      joistNominal: design.beam.material.nominal,
      species: design.beam.material.species,
      grade: design.beam.material.grade,
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });

    const boards = layoutFloatingDecking(design);

    // Order matches the y-stack top-to-bottom (boards on top,
    // blocks on bottom). AC7's determinism assertion is deep-equal
    // on the array, so keeping the order stable here is important.
    const members: LayoutMember[] = [
      ...boards,
      ...blocking,
      ...beams,
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
      `computeFloatingLayout failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

/**
 * Validate a floating design at the orchestrator boundary. Reuses
 * `MIN_DECK_DIMENSION_MM` (shared with the elevated path) and adds
 * the floating-specific `computeMinFloatingHeightMm` check.
 *
 * Explicitly does NOT re-run the elevated `validateDesign` — the
 * elevated validator checks joist spacing against joist thickness,
 * which is meaningful only for the elevated pipeline (floating has
 * no joist layer; the `design.joist` field is still present in the
 * shared `DeckDesign` type but its spacing is not honored by the
 * floating pipeline).
 *
 * See Developer Guardian Rules → Pre-compliance → Trust boundaries.
 */
function validateFloatingDesign(design: DeckDesign): void {
  if (design.structure !== 'floating') {
    throw new LayoutError(
      `computeFloatingLayout: expected design.structure === 'floating', ` +
        `got ${JSON.stringify(design.structure)}. This orchestrator is ` +
        `only valid for the S19 floating layout pipeline; the layout-engine ` +
        `dispatcher normally guards this. Direct callers must respect the ` +
        `structure invariant.`,
    );
  }
  if (design.foundation.type === 'posts-on-footings') {
    throw new LayoutError(
      `computeFloatingLayout: floating designs may not use ` +
        `foundation.type === 'posts-on-footings' (FR-030). ` +
        `Expected 'deck-blocks' or 'tuffblocks'.`,
    );
  }

  const { widthMm, lengthMm, heightMm } = design.footprint;

  if (!Number.isFinite(widthMm) || widthMm < MIN_DECK_DIMENSION_MM) {
    throw new LayoutError(
      `Invalid deck width: widthMm=${widthMm} is below the minimum of ${MIN_DECK_DIMENSION_MM} mm ` +
        `(${MIN_DECK_DIMENSION_MM / MM_PER_FOOT}′). Floating decks smaller than this are ` +
        `outside the MVP layout engine's supported range.`,
    );
  }
  if (!Number.isFinite(lengthMm) || lengthMm < MIN_DECK_DIMENSION_MM) {
    throw new LayoutError(
      `Invalid deck length: lengthMm=${lengthMm} is below the minimum of ${MIN_DECK_DIMENSION_MM} mm ` +
        `(${MIN_DECK_DIMENSION_MM / MM_PER_FOOT}′). Floating decks smaller than this are ` +
        `outside the MVP layout engine's supported range.`,
    );
  }

  let minHeightMm: Mm;
  try {
    minHeightMm = computeMinFloatingHeightMm(design);
  } catch (err) {
    throw new LayoutError(
      `computeFloatingLayout: unable to derive minimum floating height ` +
        `(likely an unknown material triple): ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (!Number.isFinite(heightMm) || heightMm < minHeightMm) {
    throw new LayoutError(
      `Invalid deck height: heightMm=${heightMm} must be ≥ ${minHeightMm} mm ` +
        `(beam depth + decking thickness) for a floating design with the ` +
        `chosen beam/decking materials. Below this, decking or beams would ` +
        `land below the deck surface. S13's UI height input MUST clamp its ` +
        `lower bound to computeMinFloatingHeightMm(design) for floating ` +
        `designs.`,
    );
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}
