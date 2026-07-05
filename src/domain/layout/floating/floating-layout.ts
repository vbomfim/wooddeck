/**
 * `src/domain/layout/floating/floating-layout.ts` — orchestrator for
 * the FLOATING deck layout pipeline (S19 + S26 rework).
 *
 * ## S26 rework (fix/floating-framing-joists)
 *
 * Pre-S26 the floating pipeline had ONE model: an N×M block grid
 * carrying one beam per block column (beams running along +z), with
 * decking laid directly on beams. That model produced NO joists,
 * IGNORED `design.joist.spacingMm`, and had NO beam at the two z-
 * ends (rim beams).
 *
 * S26 replaces that single model with a dispatch on the new
 * `design.floatingFraming` discriminator:
 *
 *   - `'beams-and-joists'` (DEFAULT — Method A): the elevated
 *     framing (2 rim beams along +x, N joists along +z at
 *     `design.joist.spacingMm`) resting on a block grid sized to
 *     carry the rim beams. Same joist x-center formula as the
 *     elevated pipeline (`computeJoistXCenters`).
 *   - `'joists-on-blocks'` (Method B): joists rest DIRECTLY on
 *     blocks; NO beam layer. Block grid has one row per beam
 *     stand-in position along +z (bounded by joist span) and one
 *     column per joist x-center (a block under every joist for
 *     the honest MVP model — reversible per §PR body).
 *
 * ## Pipeline (Method A)
 *
 *   1. `validateFloatingDesign` — mirror the elevated defensive
 *      checks (`MIN_DECK_DIMENSION_MM`, `computeMinFloatingHeightMm`)
 *      + a caller-contract guard on structure + foundation type +
 *      FR-028 `acceptsLumber` compat.
 *   2. `computeFloatingRimBeams(design)` → 2 beams (near/far)
 *      along +x at z-ends (inset by `FOOTING_WIDTH_MM/2`).
 *   3. `layoutFloatingJoists(design)` → N joists at
 *      `design.joist.spacingMm` (reuses `computeJoistXCenters`
 *      from the elevated joist layer — byte-identical spacing).
 *   4. `computeBlockGrid` with `explicitRowZCenters = beam z's`
 *      and derived column count → M blocks under each rim beam.
 *   5. `layoutFloatingDecking(design)` → decking on joist top.
 *   6. Assemble in top-down order: `[boards, joists, beams, blocks]`.
 *
 * ## Pipeline (Method B)
 *
 *   1. `validateFloatingDesign` — same as Method A (min-height
 *      guard uses the lower Method-B stack).
 *   2. `layoutFloatingJoists(design)` → N joists at spacing.
 *   3. `computeBlockGrid` with `explicitColXCenters = joist x's`
 *      and `joistSpanMaxMm` for the row count → M rows × N cols
 *      supporting each joist along its length.
 *   4. `layoutFloatingDecking(design)` → decking on joist top.
 *   5. Assemble in top-down order: `[boards, joists, blocks]`.
 *
 * Blocking (between-beam bracing) was a Method-A-of-old artifact
 * predicated on beams running along +z. Rim beams along +x + real
 * joists along +z do not need the same lateral bracing (joists
 * self-brace at each rim beam). The S26 rework OMITS the blocking
 * layer from both methods and DELETES the `blocking-layout.ts`
 * module + its tests — a future ticket adding mid-joist blocking
 * per IRC R502.7.1 will reintroduce a re-scoped module rather
 * than resurrect the deleted one.
 *
 * ## Error contract
 *
 * `computeFloatingLayout` throws `LayoutError` for every failure
 * mode — mirrors the elevated orchestrator. Downstream helpers
 * throw plain `Error` (for boundary / catalog failures); this
 * orchestrator wraps them as `LayoutError` with `cause`.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules.
 */

import type { DeckDesign, Layout, LayoutMember } from '../../model';
import { lookupFoundationProduct } from '../../foundation-catalog';
import type { SpanTable } from '../../spans/span-table';
import { MM_PER_FOOT, type Mm } from '../../units';
import { assertNever } from '../../assert-never';
import {
  LayoutError,
  MIN_DECK_DIMENSION_MM,
  validateFlushBeamDepth,
  validateJoistSpacing,
} from '../layout-shared';
import { FOOTING_WIDTH_MM } from '../y-stack';

import { computeAxisCenters, blockCountForAxis, clampBlockSpacingMm, computeBlockGrid, MIN_BLOCK_SPACING_MM } from './block-grid';
import { computeFloatingRimBeams } from './floating-beam-layout';
import { layoutFloatingDecking } from './floating-decking';
import { layoutFloatingJoists } from './floating-joist-layout';
import { computeMinFloatingHeightMm } from './y-stack-floating';

/**
 * Max cross-width spacing between adjacent BLOCKS in the same row.
 * Method A: this bounds the column count under a rim beam so the
 * beam is well-supported (matches the elevated `MAX_BEAM_SPAN_MM`
 * DIY default; 8′ = 2438.4 mm).
 *
 * Kept as a module-level constant so a future ticket surfacing the
 * value in the UI / deriving it per-material is a one-line change.
 */
export const BLOCK_COL_MAX_SPACING_MM: Mm = 8 * MM_PER_FOOT;

/**
 * Legacy re-export — pre-S26 code used this name for the same 8′
 * bound (rationalized then as "beam-to-beam max"; the S26 model
 * has only two rim beams so the same 8′ is repurposed as the
 * block-column bound). Alias preserved for downstream imports
 * (e.g. the S25 remediation module reads this constant).
 */
export const BEAM_TO_BEAM_MAX_SPACING_MM: Mm = BLOCK_COL_MAX_SPACING_MM;

/**
 * PRACTICAL max along-length spacing between adjacent BLOCK ROWS
 * (Method B — bounds the row count supporting each joist).
 * 24″ (610 mm) is the DIY residential norm for closely-spaced
 * block foundations under 2× lumber.
 *
 * Autonomous decision — see S26 handoff. Reversible with a single
 * value change.
 */
export const BLOCK_ROW_MAX_SPACING_MM_PRACTICAL: Mm = 610;

/**
 * Legacy re-export — pre-FIX-1 code referenced this name.
 */
export const BLOCK_ROW_MAX_SPACING_MM: Mm = BLOCK_ROW_MAX_SPACING_MM_PRACTICAL;

/**
 * Retired constant (kept as a legacy export for source-compat).
 * Blocking is OMITTED from both S26 methods; this value has no
 * runtime consumer left in `floating-layout.ts`. It is preserved
 * here so a future ticket that resurrects between-joist blocking
 * has a stable import name to use.
 */
export const MAX_BLOCKING_SPACING_MM: Mm = 1220;

/**
 * feat/block-spacing — DEFAULT distance between adjacent foundation
 * blocks (grid PITCH, mm) applied when a Method B design does NOT
 * carry `foundation.blockSpacingMm`.
 *
 * ## Value rationale (1220 mm = 4 ft)
 *
 * 4 ft is a common DIY ground-level default: dense enough to keep
 * a 2× joist well within the IRC R507.6 allowable (2×8 PT No.2 @
 * 16″ o.c. is ~2565 mm allowable, well above 1220 mm), sparse
 * enough that a 16 × 16 ft deck produces a manageable 5 × 5 = 25
 * blocks (vs the pre-fix ~150 in the "one block per joist × many
 * rows" model). The DIY-carpentry norm places blocks/piers at 3
 * to 6 ft along the joist run — 4 ft sits comfortably in the
 * middle.
 *
 * ## Why not tighter (610 mm ≈ 24″)?
 *
 * A 24″ default gives 9 × 9 = 81 blocks on the same 16 ft deck.
 * That's still a big improvement over the pre-fix ~150, but it
 * doesn't match the "sensible ground-level" ticket guidance —
 * 24″ is the density used under a full-load rim beam (Method A),
 * NOT under a mid-joist support (which is what Method B blocks
 * are). The default MUST balance "reads well" with "isn't
 * needlessly dense."
 *
 * ## Why not looser (1830 mm = 6 ft)?
 *
 * A 6 ft default gives 3 × 3 = 9 blocks and pushes the joist
 * span to 6 ft (1830 mm) — still within the 2×8 @ 16″ o.c.
 * allowable (2565 mm) but tight for a 2×6 (1934 mm). The 1220 mm
 * default is safer against joist under-sizing.
 *
 * ## Reversibility
 *
 * Autonomous decision — reversible by editing this constant. If
 * the value changes, `floating-block-spacing.test.ts` PINS the
 * "16 × 16 ft → 25 blocks" expectation; a delta re-derives the
 * expected count.
 *
 * ## Safety net when the default over-spans
 *
 * The default is NOT auto-clamped to the design's IRC allowable
 * (which would require a `SpanTable` at layout time — not always
 * available; the `.deck` schema does not carry one). If a user
 * pairs the default 1220 mm with an under-sized joist and the
 * span exceeds the IRC allowable, `spanCheck` will surface an
 * `over-span-joist` warning (see
 * `span-check.ts::deriveJoistSpanFromBlocks`) — the existing
 * safety-critical machinery that already handles the previously-
 * pinned Method B model.
 */
export const DEFAULT_METHOD_B_BLOCK_SPACING_MM: Mm = 1220;

/**
 * feat/block-spacing — HARD CAP on the total block count a Method
 * B layout will ever emit, regardless of the user's requested
 * `foundation.blockSpacingMm` or the derived grid.
 *
 * ## Value rationale (400)
 *
 * 400 is generous enough that a physically-sensible user input
 * never trips it (a 40 × 40 ft deck at the tightest legal
 * spacing MIN_BLOCK_SPACING_MM=300 mm derives ~41 × 41 = 1681
 * blocks — that's 4× the cap, and physically absurd; a 30 × 30
 * ft deck at 610 mm ≈ 15 × 15 = 225 blocks — well under). The
 * cap defends against pathological inputs that would otherwise:
 *
 *   - stall the scene renderer (r3f instances a mesh per block)
 *   - explode the persisted `.deck` file
 *   - crush the BOM output
 *
 * When the derived grid exceeds the cap, `computeMethodB`
 * inflates the effective spacing (in a bounded loop) until the
 * total count drops back under the cap. The user-facing effect:
 * a design that would draw 1681 blocks silently caps to ≤ 400 —
 * the design is still layout-legal (just coarser than requested).
 *
 * Autonomous decision — reversible. If the cap changes, the
 * `blockSpacingMm below MIN clamps up` test in
 * `floating-block-spacing.test.ts` re-checks under-cap counts,
 * and the hard-cap test re-checks the invariant.
 */
export const MAX_METHOD_B_BLOCK_COUNT = 400;

/**
 * feat/block-spacing — Method B grid resolver. Pure — same input
 * yields same output.
 *
 * Turns a REQUESTED spacing + legacy hints (any of them possibly
 * absent) into `{ cols, rows }` for a Method B block grid on the
 * given footprint. The sequence:
 *
 *   1. **Primary path** — `foundation.blockSpacingMm` set and
 *      finite: clamp to
 *      `[MIN_BLOCK_SPACING_MM, MAX_BLOCK_SPACING_MM]`, then
 *      derive per-axis counts via `blockCountForAxis`
 *      (ceil-based so adjacent-gap ≤ spacing).
 *   2. **Legacy fallback** — `blockSpacingMm` absent/non-finite:
 *      derive counts from `DEFAULT_METHOD_B_BLOCK_SPACING_MM`
 *      (1220 mm), with `foundation.blockRowsHint` /
 *      `blockColsHint` (S25 / ticket #47) taking per-axis
 *      overrides. This preserves S25's `add-support-row`
 *      remediation behavior byte-identically — the remediation
 *      writes `blockRowsHint: currentRows + 1`, and the layout
 *      honors that when no spacingMm is set.
 *   3. **Cap** — if `cols * rows > MAX_METHOD_B_BLOCK_COUNT`,
 *      shrink the larger axis by 1 in a bounded loop until the
 *      total fits, respecting the perimeter-two minimum
 *      (cols ≥ 2 AND rows ≥ 2).
 *
 * ## Priority: blockSpacingMm > blockRowsHint / blockColsHint
 *
 * When BOTH are present, `blockSpacingMm` wins on both axes. This
 * is the "new user-facing field takes precedence over legacy
 * remediation-machinery hints" invariant. The S25 remediation
 * never combines them (it only writes the hint fields), so this
 * priority order does not regress any remediation behavior.
 *
 * ## Cap enforcement invariant
 *
 * Loop terminates because `cols + rows` strictly decreases each
 * iteration (or the perimeter-two floor stops us). When both
 * counts reach 2, total is 4 ≤ MAX_METHOD_B_BLOCK_COUNT and the
 * loop exits. Explicit MAX_CAP_ITER=200 bound defends against a
 * future arithmetic bug.
 */
function resolveMethodBGrid(
  widthMm: Mm,
  lengthMm: Mm,
  requestedSpacingMm: number | undefined,
  legacyRowsHint: number | undefined,
  legacyColsHint: number | undefined,
): { cols: number; rows: number } {
  let cols: number;
  let rows: number;

  if (
    requestedSpacingMm !== undefined &&
    Number.isFinite(requestedSpacingMm)
  ) {
    // Primary path — blockSpacingMm is the source of truth.
    const s =
      clampBlockSpacingMm(requestedSpacingMm) ??
      DEFAULT_METHOD_B_BLOCK_SPACING_MM;
    cols = blockCountForAxis(widthMm, s);
    rows = blockCountForAxis(lengthMm, s);
  } else {
    // Legacy fallback — default spacing, with S25 hint per-axis
    // overrides (preserves the add-support-row remediation
    // seam byte-identically).
    const defaultSpacing = DEFAULT_METHOD_B_BLOCK_SPACING_MM;
    cols =
      legacyColsHint !== undefined
        ? resolveHintCount(legacyColsHint, widthMm)
        : blockCountForAxis(widthMm, defaultSpacing);
    rows =
      legacyRowsHint !== undefined
        ? resolveHintCount(legacyRowsHint, lengthMm)
        : blockCountForAxis(lengthMm, defaultSpacing);
  }

  // Hard cap enforcement. Shrink the larger axis by 1 per
  // iteration; keep both axes ≥ perimeter-two (2). Loop bound
  // is defensive — cols + rows strictly decreases each step so
  // termination is guaranteed.
  const MAX_CAP_ITER = 200;
  let iter = 0;
  while (
    cols * rows > MAX_METHOD_B_BLOCK_COUNT &&
    (cols > 2 || rows > 2) &&
    iter < MAX_CAP_ITER
  ) {
    if (cols >= rows && cols > 2) {
      cols -= 1;
    } else if (rows > 2) {
      rows -= 1;
    } else {
      break;
    }
    iter += 1;
  }

  return { cols, rows };
}

/**
 * Legacy S25 hint → integer count, applying the SAME clamp
 * `computeBlockGrid.resolveGridCount` uses. Mirrors that helper
 * verbatim so the Method B fallback path stays byte-identical
 * to the pre-feat/block-spacing behavior for a hint-carrying
 * design.
 *
 *   - Non-finite → treated as "no hint" (caller substitutes the
 *     default derivation, never reaches this branch).
 *   - Clamped to `[2, floor(spanMm / MIN_BLOCK_SPACING_MM) + 1]`.
 *   - Non-integer values rounded DOWN before clamping (`Math.floor`).
 *
 * The `resolveGridCount` export from `block-grid.ts` cannot be
 * reused directly here because its second argument is `spanMm` and
 * its third is `maxSpacingMm` (used for the "no hint" fallback),
 * whereas our fallback here is `DEFAULT_METHOD_B_BLOCK_SPACING_MM`
 * — not the same semantics. Duplicating the ~4 lines of clamp
 * logic is cheaper than complicating the shared helper's contract.
 */
function resolveHintCount(hint: number, spanMm: Mm): number {
  if (!Number.isFinite(hint)) {
    return blockCountForAxis(spanMm, DEFAULT_METHOD_B_BLOCK_SPACING_MM);
  }
  const maxCount = Math.floor(spanMm / MIN_BLOCK_SPACING_MM) + 1;
  const asInt = Math.floor(hint);
  return Math.max(2, Math.min(asInt, maxCount));
}

/**
 * Options for `computeFloatingLayout` — extends the elevated
 * `ComputeLayoutOptions` shape with an OPTIONAL `spanTable` seam so
 * a future span-derived row spacing can be unit-tested against
 * either the real `IrcSpanTable` or a mock. Currently only used
 * for the FR-028 catalog lookup guard.
 */
export interface ComputeFloatingLayoutOptions {
  readonly now?: () => string;
  readonly spanTable?: SpanTable;
}

/**
 * Turn a FLOATING `DeckDesign` into a complete `Layout`. Dispatches
 * on `design.floatingFraming` — see module header.
 *
 * ## Caller expectations
 *
 *   - `design.structure === 'floating'`
 *   - `design.foundation.type ∈ {'deck-blocks', 'tuffblocks'}`
 *
 * The layout-engine dispatcher enforces both via the compat matrix
 * BEFORE calling here; this function ALSO checks (fail-loud) so a
 * test or future caller that skips the dispatcher does not silently
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
    if (design.foundation.type === 'posts-on-footings') {
      // Belt-and-suspenders — the validator already threw. Kept so
      // TypeScript's control-flow narrowing knows `foundation` is
      // one of the two block variants below this line.
      throw new LayoutError(
        'computeFloatingLayout: internal invariant — reached ' +
          "post-validation with foundation.type === 'posts-on-footings'.",
      );
    }

    // Exhaustive switch on `design.floatingFraming` — TypeScript's
    // control-flow narrowing proves the `default:` branch is
    // unreachable at compile time (via `assertNever(x: never)`);
    // it also fails LOUD at runtime if the union ever widens via
    // a bad `as` cast or corrupt persisted data. S26 FIX #7
    // (review-gate: Security#2) — replaces a two-branch ternary.
    let members: LayoutMember[];
    switch (design.floatingFraming) {
      case 'beams-and-joists':
        members = computeMethodA(design);
        break;
      case 'joists-on-blocks':
        members = computeMethodB(design);
        break;
      default:
        assertNever(
          design.floatingFraming,
          'computeFloatingLayout: design.floatingFraming',
        );
    }

    return {
      designId: design.id,
      computedAt: now(),
      bounds: computeFloatingBoundsFromMembers(members, design),
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
 * Method A layout — beams + joists on a supporting block grid.
 *
 * ## Block grid — Method A
 *
 *   - **Rows (along +z):** exactly 2, at the rim-beam z-centers
 *     (`±(lengthMm/2 − FOOTING_WIDTH_MM/2)`). Passed as
 *     `explicitRowZCenters` so `computeBlockGrid` bypasses the
 *     derived row-count formula and places blocks directly under
 *     the two rim beams.
 *   - **Columns (along +x):** derived from
 *     `ceil(widthMm / BLOCK_COL_MAX_SPACING_MM) + 1` (subject to
 *     `blockColsHint`) — bounds the block-to-block +x gap to keep
 *     each rim beam well-supported.
 *
 * The `explicitRowZCenters` override does not force the column
 * count — a user's `blockColsHint` still applies exactly as it did
 * pre-S26 (the S25 UI seam is unchanged).
 */
function computeMethodA(design: DeckDesign): LayoutMember[] {
  if (design.foundation.type === 'posts-on-footings') {
    // Narrowing shim — unreachable in practice (validated above).
    throw new LayoutError('unreachable: posts-on-footings in Method A');
  }
  const halfLengthMm = design.footprint.lengthMm / 2;
  // Rim beams inset by half a footing/block width from each z-end
  // (mirrors elevated `layoutBeams`). Rows of blocks sit UNDER
  // each rim beam so the beam-to-block bearing is direct.
  const beamInset = FOOTING_WIDTH_MM / 2;
  const nearZ = -halfLengthMm + beamInset;
  const farZ = +halfLengthMm - beamInset;

  const blocks = computeBlockGrid({
    footprintMm: {
      widthMm: design.footprint.widthMm,
      lengthMm: design.footprint.lengthMm,
    },
    foundation: design.foundation,
    beamSpanMaxMm: BLOCK_COL_MAX_SPACING_MM,
    // `joistSpanMaxMm` is unused when `explicitRowZCenters` is
    // supplied, but the validator still requires it > 0. Pass the
    // same block-col cap defensively.
    joistSpanMaxMm: BLOCK_COL_MAX_SPACING_MM,
    explicitRowZCenters: [nearZ, farZ],
  });

  const beams = computeFloatingRimBeams(design);
  const joists = layoutFloatingJoists(design);
  const boards = layoutFloatingDecking(design);

  // Top-down order (mirrors the y-stack): boards on top, blocks
  // on bottom. AC7's determinism assertion is deep-equal on the
  // array, so keeping the order stable here is important.
  return [...boards, ...joists, ...beams, ...blocks];
}

/**
 * Method B layout — joists directly on blocks; NO beam layer.
 *
 * ## Block grid — Method B (feat/block-spacing rework)
 *
 *   - **User-controlled grid pitch** — the user sets
 *     `foundation.blockSpacingMm` (mm); the layout builds a
 *     REGULAR grid at that pitch on BOTH axes, anchored so the
 *     outer blocks lie at the footprint edges (same
 *     `computeAxisCenters` anchor formula Method A uses).
 *   - **Absent field** — apply DEFAULT_METHOD_B_BLOCK_SPACING_MM
 *     (1220 mm ≈ 4 ft) so a user who hasn't set the field yet
 *     still sees a sensible ground-level grid.
 *   - **Per-axis count** — `blockCountForAxis(span, spacing) =
 *     max(2, ceil(span / spacing) + 1)` → adjacent-gap ≤ spacing
 *     invariant guaranteed.
 *   - **Clamp** — user input is clamped to
 *     `[MIN_BLOCK_SPACING_MM (300 mm), MAX_BLOCK_SPACING_MM
 *     (2438.4 mm ≈ 8 ft)]` in `clampBlockSpacingMm`.
 *   - **Hard cap** — total block count is capped at
 *     MAX_METHOD_B_BLOCK_COUNT (400); the resolver widens the
 *     effective spacing (bounded loop) until the count fits.
 *
 * ## Why this replaces the pre-fix "one block per joist" model
 *
 * Pre-fix the block columns were pinned to the joist x-centers
 * (`explicitColXCenters = joists.map(j => j.position.x)`),
 * producing N columns × M rows = ~150 blocks on a 16 ft × 16 ft
 * deck at 16″ o.c. joist spacing. The UAT report ("adds too many
 * blocks; ask the distance between blocks") drove the rework:
 * decouple block count from joist count, expose the grid pitch
 * as a user parameter.
 *
 * ## Joists no longer sit exactly on a block column
 *
 * A subtle consequence of the rework: joist x-centers no longer
 * align with block columns (they're at
 * `computeJoistXCenters(design)` spacing; blocks are at the grid
 * pitch). The design remains an "illustrative / planning" model
 * (per ticket guidance) — a real build would shim between joist
 * and block where the two disagree. `spanCheck` still derives the
 * joist's between-supports span from the block grid's row pitch
 * (see `deriveJoistSpanFromBlocks` in `span-check.ts`), so the
 * IRC safety check remains intact.
 */
function computeMethodB(design: DeckDesign): LayoutMember[] {
  if (design.foundation.type === 'posts-on-footings') {
    throw new LayoutError('unreachable: posts-on-footings in Method B');
  }
  const widthMm = design.footprint.widthMm;
  const lengthMm = design.footprint.lengthMm;

  // Resolve the effective grid (spacing → cols × rows), applying
  // default / clamp / hard-cap AND (legacy fallback) the S25
  // blockRowsHint / blockColsHint when blockSpacingMm is absent.
  // See resolveMethodBGrid docstring for the priority order.
  const { cols, rows } = resolveMethodBGrid(
    widthMm,
    lengthMm,
    design.foundation.blockSpacingMm,
    design.foundation.blockRowsHint,
    design.foundation.blockColsHint,
  );

  // Anchor centers via computeAxisCenters — outer blocks sit at
  // ±spanMm/2 (byte-consistent with Method A's rim-beam anchoring).
  const xCenters = computeAxisCenters(widthMm, cols);
  const zCenters = computeAxisCenters(lengthMm, rows);

  const blocks = computeBlockGrid({
    footprintMm: { widthMm, lengthMm },
    foundation: design.foundation,
    // `beamSpanMaxMm` / `joistSpanMaxMm` are unused when explicit
    // centers are supplied (validator still requires > 0). Pass
    // MIN_BLOCK_SPACING_MM defensively — any positive value works.
    beamSpanMaxMm: MIN_BLOCK_SPACING_MM,
    joistSpanMaxMm: MIN_BLOCK_SPACING_MM,
    explicitColXCenters: xCenters,
    explicitRowZCenters: zCenters,
  });

  const joists = layoutFloatingJoists(design);
  const boards = layoutFloatingDecking(design);
  // Order: boards → joists → blocks. No beam layer.
  return [...boards, ...joists, ...blocks];
}

/**
 * Compute `Layout.bounds` for a floating layout as the axis-aligned
 * bounding box of every produced member.
 *
 * Rationale — the elevated pipeline sets `bounds = design.footprint`
 * because posts + footings sit within the footprint on x/z and
 * above/below-grade y is bounded by `heightMm`. Floating designs
 * violate both: outer blocks overhang the footprint by ~½ block on
 * each side (`block-grid.ts` module header AC4), and blocks extend
 * BELOW y=0 by `product.actual.heightMm`. Reporting
 * `design.footprint` would clip outer blocks + subgrade extent out
 * of the S22 camera framing.
 *
 * Fallback — a member-less layout is impossible for a valid design
 * (every method emits ≥1 block + joist + board), but as a
 * defensive guard we fall back to `design.footprint` so the
 * function never returns `NaN`/`-Infinity` fields.
 */
function computeFloatingBoundsFromMembers(
  members: readonly LayoutMember[],
  design: DeckDesign,
): Layout['bounds'] {
  if (members.length === 0) {
    return {
      widthMm: design.footprint.widthMm,
      lengthMm: design.footprint.lengthMm,
      heightMm: design.footprint.heightMm,
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const m of members) {
    const halfX = m.size.x / 2;
    const halfY = m.size.y / 2;
    const halfZ = m.size.z / 2;
    if (m.position.x - halfX < minX) minX = m.position.x - halfX;
    if (m.position.x + halfX > maxX) maxX = m.position.x + halfX;
    if (m.position.y - halfY < minY) minY = m.position.y - halfY;
    if (m.position.y + halfY > maxY) maxY = m.position.y + halfY;
    if (m.position.z - halfZ < minZ) minZ = m.position.z - halfZ;
    if (m.position.z + halfZ > maxZ) maxZ = m.position.z + halfZ;
  }
  return {
    widthMm: maxX - minX,
    lengthMm: maxZ - minZ,
    heightMm: maxY - minY,
  };
}

/**
 * Validate a floating design at the orchestrator boundary. Reuses
 * `MIN_DECK_DIMENSION_MM` (shared with the elevated path) and adds
 * the floating-specific `computeMinFloatingHeightMm` check (which
 * now varies by `floatingFraming`).
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

  // FIX #2 (S26 review-gate) — joist-spacing DoS + overlap guard.
  // Shared with the elevated orchestrator via `validateJoistSpacing`
  // in `layout-shared.ts`. MUST run BEFORE any joist-layout call
  // (both Method A and Method B feed spacingMm into
  // `computeJoistXCenters` → `Math.ceil(x / spacingMm)`; a zero /
  // NaN / negative value there hangs the anchor loop). Pre-S26 the
  // floating pipeline skipped this guard because it did not use
  // `computeJoistXCenters` — S26 makes both methods share the
  // joist layer, so the guard must apply to both.
  validateJoistSpacing(design);

  // S27 review-response HIGH #2 — flush-beam depth guard. Only
  // applies to Method A (Method A has 2 rim beams; Method B has NO
  // beam layer so `beamConnection` is ignored — flush-vs-drop is
  // meaningless without a beam to hang from). Must run BEFORE
  // `computeMinFloatingHeightMm` so the caller sees the specific
  // remediation instead of the generic height message.
  if (design.floatingFraming === 'beams-and-joists') {
    validateFlushBeamDepth(design);
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
        `(the ${design.floatingFraming === 'beams-and-joists' ? 'beam + joist + decking' : 'joist + decking'} stack) ` +
        `for a floating design with the chosen materials. Below this, decking ` +
        `or framing would land below the deck surface. S13's UI height input ` +
        `MUST clamp its lower bound to computeMinFloatingHeightMm(design) for ` +
        `floating designs.`,
    );
  }

  // ---- FR-028 acceptsLumber compat -------------------------------------
  // Each foundation-block product declares the lumber nominals it is
  // rated to bear (see `foundation-catalog.ts` `acceptsLumber`). Pairing
  // a block with an unsupported beam / joist nominal is physically
  // invalid — the manufacturer has not sized the block for that load
  // path. Fail-loud here BEFORE the block-grid + framing math consume
  // the pair.
  //
  // Method B has NO beam layer, so the compat check falls to the joist
  // nominal (the joist is what the block bears directly). Method A
  // still checks the beam nominal (the block bears the beam, not the
  // joist).
  let product;
  try {
    product = lookupFoundationProduct(design.foundation.product.productId);
  } catch (err) {
    throw new LayoutError(
      `computeFloatingLayout: unknown foundation product ` +
        `${JSON.stringify(design.foundation.product.productId)}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const loadNominal =
    design.floatingFraming === 'beams-and-joists'
      ? design.beam.material.nominal
      : design.joist.material.nominal;
  const loadLabel =
    design.floatingFraming === 'beams-and-joists' ? 'beam' : 'joist';
  if (!product.acceptsLumber.includes(loadNominal)) {
    throw new LayoutError(
      `Foundation-block × ${loadLabel}-nominal mismatch (FR-028): ` +
        `${product.displayName} (${product.productId}) accepts ` +
        `${product.acceptsLumber.join(', ')} lumber, ` +
        `but design.${loadLabel} is ${loadNominal}. Choose a ${loadLabel} ` +
        `nominal the block is rated to bear, or select a foundation-block ` +
        `product whose acceptsLumber includes ${loadNominal}.`,
    );
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}
