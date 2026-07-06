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
 *   2. `computeFloatingBeams(design, { numRows })` → N ≥ 2 beams
 *      (near/far + interior mid-span beams) along +x at inset
 *      z positions (rims inset by `FOOTING_WIDTH_MM/2`).
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
 *      (one block column PER joist) and `explicitRowZCenters` at
 *      the user's `blockSpacingMm` pitch along +z → M rows × N
 *      cols supporting each joist along its length. Every joist
 *      has a full column of blocks beneath it (no flying joists —
 *      see `floating-flying-joists.test.ts`).
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

import type { DeckDesign, Layout, LayoutMember, MaterialRef } from '../../model';
import { lookupFoundationProduct } from '../../foundation-catalog';
import { lookupMaterial } from '../../materials-catalog';
import type { SpanTable } from '../../spans/span-table';
import { MM_PER_FOOT, type Mm } from '../../units';
import { assertNever } from '../../assert-never';
import { layoutBlockingBetweenJoists } from '../blocking-layout';
import { computeJoistXCenters } from '../joist-layout';
import {
  LayoutError,
  MAX_DECK_DIMENSION_MM,
  MIN_DECK_DIMENSION_MM,
  validateFlushBeamDepth,
  validateJoistSpacing,
} from '../layout-shared';
import { FOOTING_WIDTH_MM } from '../y-stack';

import { computeAxisCenters, blockCountForAxis, clampBlockSpacingMm, computeBlockGrid, MIN_BLOCK_SPACING_MM } from './block-grid';
import { computeFloatingBeams } from './floating-beam-layout';
import { layoutFloatingDecking } from './floating-decking';
import { layoutFloatingJoists } from './floating-joist-layout';
import { computeMinFloatingHeightMm, computeYStackFloating } from './y-stack-floating';

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

// NOTE: A pre-#72 stub `export const MAX_BLOCKING_SPACING_MM: Mm =
// 1220;` used to live here as a source-compat placeholder while
// blocking-between-joists was DORMANT. It was deleted as part of
// PR #73 review (GPT-5.5 MEDIUM #4): the name is now owned by the
// ACTIVE helper `../blocking-layout.ts` (value 2438 = 8 ft per IRC
// R502.7.1), and the barrel `../index.ts` re-exports it from
// there. Restoring a second const under the same name would
// re-create the value collision — do NOT re-add.

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
 * `span-check.ts::deriveMethodBJoistSpanFromBlockGrid`) — the existing
 * safety-critical machinery that already handles the previously-
 * pinned Method B model.
 */
export const DEFAULT_METHOD_B_BLOCK_SPACING_MM: Mm = 1220;

/**
 * fix/joists-on-blocks-flying — HARD CAP on the total block count
 * a Method B layout will ever emit, regardless of the user's
 * requested `foundation.blockSpacingMm` or the derived grid.
 *
 * ## Value rationale (400)
 *
 * 400 is generous enough that a physically-sensible user input
 * never trips it. Since block COLUMNS are now pinned to joist
 * x-centers (one column per joist), the cap is a function of
 * (numJoists, rows): a 40 × 40 ft deck at 16″ o.c. gives ~31
 * joists × 41 rows (at MIN spacing 300 mm) = ~1271 blocks — 3×
 * the cap. A more typical 20 × 20 ft at default 1220 mm spacing
 * gives 16 joists × 6 rows = 96 blocks — well under. The cap
 * defends against pathological inputs that would otherwise:
 *
 *   - stall the scene renderer (r3f instances a mesh per block)
 *   - explode the persisted `.deck` file
 *   - crush the BOM output
 *
 * When the derived grid exceeds the cap, `resolveMethodBGrid`
 * reduces the ROW count only — columns cannot be reduced because
 * every joist must have a support column beneath it (dropping a
 * column would recreate the "flying joists" bug PR #66 introduced).
 * The user-facing effect: coarser row spacing than requested, but
 * every joist stays supported.
 *
 * ## Degenerate exception (rows === 2 floor)
 *
 * If `numJoists × 2 > MAX_METHOD_B_BLOCK_COUNT` (only reachable
 * with pathological joist spacing on a near-max footprint), the
 * perimeter-two floor supersedes the cap and the total may exceed
 * MAX. Total stays bounded by `MAX_DECK_DIMENSION_MM × 2 /
 * MIN_JOIST_SPACING` × 2 (footprint × physics × perimeter rows) —
 * no OOM. See `resolveMethodBGrid` docstring and FR-035.
 *
 * Autonomous decision — reversible. If the cap changes, the hard-
 * cap tests in `floating-block-spacing.test.ts` and
 * `floating-flying-joists.test.ts` re-check the invariant.
 */
export const MAX_METHOD_B_BLOCK_COUNT = 400;

// ==========================================================
// feat/method-a-intermediate-beams (issue #75) constants + resolver
// ==========================================================

/**
 * issue #75 — Method A hard cap on beam-row count.
 *
 * ## Value rationale (20)
 *
 * A 40 ft deck at 24″ beam pitch = 20 rows is already implausibly
 * dense for a DIY residential deck. A 100 ft deck at 20 rows =
 * 5 ft pitch — DIY-generous. The cap is a defense-in-depth guard
 * against pathological span-safe derivations (e.g. a synthetic
 * span-table with a joist allowable near `MIN_BLOCK_SPACING_MM`
 * that would otherwise request 100+ rows). Combined with the
 * `MIN_BEAM_ROW_GAP_MM` gap floor + the block-count postcondition
 * in `clampMethodABeamRows`, worst-case total blocks stays
 * comfortably under the r3f instance budget.
 *
 * Autonomous decision — reversible by editing this constant.
 */
export const MAX_METHOD_A_BEAM_ROWS = 20;

/**
 * issue #75 — Practical FLOOR on the +z gap between adjacent
 * Method A beam rows.
 *
 * ## Value rationale (1000 mm ≈ 3.3 ft)
 *
 * Below this gap a beam row is denser than the joist bays under
 * it (typical DIY joist spacing is 305–610 mm; a beam row every
 * ~3.3 ft along the joist is already tighter than any span-table
 * requires for 2× lumber). Rows tighter than the floor add cost
 * (more beams + more blocks + more BOM) without a physics benefit.
 *
 * Enforced as `rowsMaxByGap = max(2, floor(lengthMm / MIN_BEAM_ROW_GAP_MM) + 1)`
 * in `clampMethodABeamRows`. Autonomous decision — reversible by
 * editing this constant.
 */
export const MIN_BEAM_ROW_GAP_MM: Mm = 1000;

/**
 * issue #75 — Method A hard cap on total block count
 * (`totalRows × cols`).
 *
 * ## Value rationale (200)
 *
 * Mirrors the intent of `MAX_METHOD_B_BLOCK_COUNT = 400` but
 * scaled to Method A's realistic footprint × row count product:
 * a 40 ft × 40 ft deck with 5 rows × 8 cols = 40 blocks (under
 * the cap); the theoretical worst case at 100×100 ft × strong
 * joist (`MAX_METHOD_A_BEAM_ROWS × ceil(30480 /
 * BLOCK_COL_MAX_SPACING_MM) + 1`) = 20 × 14 = 280 is bounded.
 *
 * **Review-gate follow-up (Opus HIGH + GPT HIGH + QA GAP-B):**
 * The cap now CLAMPS the row count at
 * `rowsMaxByCap = max(2, floor(MAX_METHOD_A_BLOCK_COUNT / cols))`
 * (mirroring Method B's `clampMethodBRows` — see FR-037 FR-A in
 * the spec), rather than throwing when the requested span-safe
 * row count would exceed it. On a schema-legal but genuinely huge
 * deck (e.g. 100×100 ft × 2×6 Cedar @ 24″) the clamp binds → the
 * resulting adjacent-beam-gap exceeds the joist allowable →
 * `deriveJoistSpanMm` reports the honest over-span → FR-F's
 * DISABLED add-support-row remediation surfaces the actionable
 * alternative. This is the intended graceful-degradation path;
 * throwing a developer-facing "Internal invariant violated"
 * error on user-reachable input was a bug. The postcondition
 * throw is RETAINED as an arithmetic-drift guard for a future
 * regression in the clamp math itself — genuinely unreachable
 * for any schema-legal design (hence `c8 ignore`).
 *
 * Autonomous decision — reversible.
 */
export const MAX_METHOD_A_BLOCK_COUNT = 200;

/**
 * issue #75 — Resolve the Method A total beam-row count and the
 * derived interior-row count from the deck length and (optionally)
 * a threaded-through `SpanTable`.
 *
 * ## Contract (mirrors `resolveMethodBGrid`'s span-safe branch)
 *
 * Two-branch derivation:
 *
 *   1. **SpanTable + material + spacing present AND `allowableMm > 0`.**
 *      `totalRows = max(2, ceil(supportSpanMm / allowableMm) + 1)`
 *      where `supportSpanMm = max(0, lengthMm − FOOTING_WIDTH_MM)`
 *      — the ACTUAL between-supports joist span (the two rims are
 *      each inset by `FOOTING_WIDTH_MM / 2`, so `farZ − nearZ =
 *      lengthMm − FOOTING_WIDTH_MM`; this is the same span that
 *      `deriveJoistSpanMm` in `span-check.ts` measures for the
 *      2-beam case). Using the inset span here keeps the resolver's
 *      geometry in lock-step with the checker's — a mismatch
 *      would over-build (extra beam rows) AND falsely reject flush
 *      designs that are actually span-safe with just the 2 rims
 *      in the `(allowable, allowable + FOOTING_WIDTH_MM]` boundary
 *      band (GPT MEDIUM #2 in the review-gate report).
 *
 *   2. **Fallback (any of table / material / spacing absent, OR
 *      `allowableMm === 0`).** Returns `totalRows = 2` —
 *      BYTE-IDENTICAL to the pre-#75 behavior so every existing
 *      Method A golden fixture and every callsite that does NOT
 *      thread the `SpanTable` through stays stable.
 *
 * The returned `totalRows` is CLAMPED via `clampMethodABeamRows`
 * against the DoS + gap + block-count ceilings. When the caller
 * passes `widthMm > 0` the block-count clamp binds (the dynamic
 * `floor(MAX/cols)` ceiling from `clampMethodABeamRows`); when
 * `widthMm` is absent (undefined / 0) only the row-cap +
 * row-gap ceilings apply — `computeMethodA` re-clamps with the
 * concrete `widthMm` at its own seam so the block-count ceiling
 * always binds where the layout is actually built.
 * `interiorRows = totalRows − 2` (always ≥ 0).
 *
 * Pure — same input yields byte-equal output. No side effects.
 */
export function resolveMethodABeamRows(
  lengthMm: Mm,
  spanTable?: SpanTable,
  joistMaterial?: MaterialRef,
  joistSpacingMm?: Mm,
  widthMm?: Mm,
): { totalRows: number; interiorRows: number } {
  let rowsReq = 2;
  if (
    spanTable !== undefined &&
    joistMaterial !== undefined &&
    joistSpacingMm !== undefined
  ) {
    const allowableMm = spanTable.lookupJoistMaxSpan(
      joistMaterial,
      joistSpacingMm,
    );
    if (allowableMm > 0) {
      // Support span = distance between the two rim beam centers
      // (each inset by FOOTING_WIDTH_MM/2 from the ±L/2 z-ends).
      // This equals `farZ − nearZ` in `computeMethodA` and is the
      // same quantity `deriveJoistSpanMm` measures for the 2-beam
      // case — the resolver MUST use the same geometry as the
      // checker or it drifts out of lock-step (GPT MEDIUM #2).
      const supportSpanMm = Math.max(0, lengthMm - FOOTING_WIDTH_MM);
      // Row pitch = supportSpanMm / (totalRows − 1) ≤ allowableMm
      //   ⇒ totalRows ≥ supportSpanMm / allowableMm + 1.
      // The `max(2, …)` floor covers the tiny-deck case where the
      // 2-rim pitch is already safe.
      rowsReq = Math.max(2, Math.ceil(supportSpanMm / allowableMm) + 1);
    }
  }
  const totalRows = clampMethodABeamRows(rowsReq, lengthMm, widthMm ?? 0);
  return { totalRows, interiorRows: totalRows - 2 };
}

/**
 * issue #75 — Clamp a requested Method A beam-row count into the
 * physically-realizable range.
 *
 * ## Ceilings (mirror `clampMethodBRows`)
 *
 *   - `rowsMaxByCap` — DYNAMIC block-count ceiling.
 *     When `widthMm > 0`, the row count is bounded so
 *     `cols × rows ≤ MAX_METHOD_A_BLOCK_COUNT` where
 *     `cols = ceil(widthMm / BLOCK_COL_MAX_SPACING_MM) + 1` (the
 *     same derivation `computeMethodA` uses). This CLAMPS
 *     gracefully on schema-legal-but-huge decks (e.g. 100×100 ft ×
 *     2×6 Cedar @ 24″: cap binds at ~14 rows instead of the
 *     span-safe 15+) — the too-large adjacent-beam gap surfaces
 *     via `deriveJoistSpanMm` as an HONEST `over-span-joist`
 *     warning, and FR-F's disabled remediation guides the user.
 *     When `widthMm === 0` (the resolver's pre-column-derivation
 *     call) only the constant `MAX_METHOD_A_BEAM_ROWS` ceiling
 *     applies; the block-count clamp binds at the second call
 *     from `computeMethodA` where `widthMm` is known. This
 *     mirrors `clampMethodBRows`'s dynamic
 *     `floor(MAX_METHOD_B_BLOCK_COUNT / numJoists)` seam — the
 *     axis differs (cols vs joists) but the shape is identical.
 *   - `rowsMaxByGap = max(2, floor(lengthMm / MIN_BEAM_ROW_GAP_MM) + 1)`
 *     — practical floor on the +z gap between adjacent beam rows
 *     (denser than a joist bay is wasteful).
 *   - `MAX_METHOD_A_BEAM_ROWS` — absolute hard ceiling defending
 *     against pathological synthetic span-tables (e.g. a test
 *     table with `allowableMm` near `MIN_BLOCK_SPACING_MM` that
 *     would otherwise request 100+ rows). Always applies.
 *
 * ## Postcondition (LOUD failure — genuine arithmetic-drift guard)
 *
 * When `widthMm > 0` and `rows > 2`, `cols × rows ≤
 * MAX_METHOD_A_BLOCK_COUNT` MUST hold. The `rows === 2`
 * degenerate corner is exempt — perimeter-two supersedes. This
 * is genuinely unreachable for any schema-legal design after the
 * dynamic `rowsMaxByCap` clamp above; retained as defense-in-depth
 * against a future arithmetic regression in the clamp math itself.
 * Hence `/* c8 ignore *\/`.
 */
export function clampMethodABeamRows(
  rowsReq: number,
  lengthMm: Mm,
  widthMm: Mm,
): number {
  // Dynamic block-count ceiling — mirrors `clampMethodBRows`.
  // When widthMm is 0, `cols` cannot be derived so we fall back
  // to the constant `MAX_METHOD_A_BEAM_ROWS` ceiling only.
  let rowsMaxByCap = MAX_METHOD_A_BEAM_ROWS;
  if (widthMm > 0) {
    const cols = Math.ceil(widthMm / BLOCK_COL_MAX_SPACING_MM) + 1;
    rowsMaxByCap = Math.max(
      2,
      Math.min(
        MAX_METHOD_A_BEAM_ROWS,
        Math.floor(MAX_METHOD_A_BLOCK_COUNT / cols),
      ),
    );
  }
  const rowsMaxByGap = Math.max(
    2,
    Math.floor(lengthMm / MIN_BEAM_ROW_GAP_MM) + 1,
  );
  const rows = Math.max(
    2,
    Math.min(Math.floor(rowsReq), rowsMaxByCap, rowsMaxByGap),
  );

  // Postcondition — arithmetic-drift guard only (see docstring).
  // Genuinely unreachable for any schema-legal input after the
  // dynamic clamp above; retained for defense-in-depth.
  if (widthMm > 0 && rows > 2) {
    const cols = Math.ceil(widthMm / BLOCK_COL_MAX_SPACING_MM) + 1;
    /* c8 ignore next 8 */
    if (cols * rows > MAX_METHOD_A_BLOCK_COUNT) {
      throw new LayoutError(
        `Internal invariant violated: Method A block count ${cols}×${rows} = ` +
          `${cols * rows} exceeds MAX_METHOD_A_BLOCK_COUNT ` +
          `(${MAX_METHOD_A_BLOCK_COUNT}) while rows > 2 (perimeter-two ` +
          `floor was not the reason for the overshoot).`,
      );
    }
  }

  return rows;
}

/**
 * feat/block-count-per-joist — schema-legal bounds on
 * `foundation.blockRowsHint` (COUNT — integer). Kept in sync with
 * `docs/deck-file-schema-v2.json` `FoundationSpecDeckBlocks.blockRowsHint`
 * / `FoundationSpecTuffBlocks.blockRowsHint`. Re-exported through
 * the `state` barrel so the UI count field can clamp at the
 * input boundary WITHOUT crossing `ui → domain/layout` directly.
 *
 * ## Values
 *
 *   - `MIN = 2` — perimeter-two floor: a rectangular deck cannot
 *     have fewer than 2 rows of blocks (outer rows anchored at
 *     ±length/2 by `computeAxisCenters`).
 *   - `MAX = 100` — a generous fixed ceiling well above any
 *     physically-sensible grid. The RUNTIME per-design ceiling is
 *     tighter (see `resolveMethodBGrid` — `min(MAX_METHOD_B_BLOCK_COUNT
 *     / numJoists, floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1)`);
 *     the 100 constant is the SCHEMA ceiling, mirroring the JSON
 *     schema max so a save/reload cannot poison the design.
 */
export const MIN_BLOCK_ROWS_HINT = 2;
export const MAX_BLOCK_ROWS_HINT = 100;

/**
 * feat/block-count-per-joist — Method B grid resolver. Pure —
 * same input yields same output.
 *
 * ## Priority (NEW — count-primary)
 *
 * Method B's row count now derives from a strict priority list:
 *
 *   1. **`blockRowsHint` (COUNT — PRIMARY control).** When
 *      present, the user's row count wins. Clamped to
 *      `[2, min(rowsMaxByCap, rowsMaxByGap)]` where
 *      `rowsMaxByCap = max(2, floor(MAX_METHOD_B_BLOCK_COUNT /
 *      numJoists))` (defense against pathological instance
 *      explosion) and `rowsMaxByGap = floor(lengthMm /
 *      MIN_BLOCK_SPACING_MM) + 1` (defense against sub-footprint
 *      row pitch). Non-integer hints are `Math.floor`-rounded
 *      before clamping.
 *   2. **`blockSpacingMm` (DISTANCE — LEGACY / superseded).** If
 *      `blockRowsHint` is absent, the pre-fix spacing path
 *      still applies for back-compat with designs saved under
 *      the feat/block-spacing model. The derived row count
 *      passes through the same cap-and-gap clamp.
 *   3. **Absent both** — a SPAN-SAFE default. When a `spanTable`
 *      is threaded through AND the joist material + spacing are
 *      known, the default row count = `max(legacyDefault,
 *      ceil(lengthMm / allowableMm) + 1)` where `allowableMm` is
 *      the joist's IRC allowable at its spacing (Code Review
 *      Fix #4). This keeps the row pitch ≤ IRC allowable so a
 *      fresh Method-B deck does NOT start over-spanned. When the
 *      table is not threaded through (byte-identity path for
 *      pre-fix consumers) OR the joist material is not in the
 *      catalog (allowable = 0), falls back to the
 *      `DEFAULT_METHOD_B_BLOCK_SPACING_MM = 1220 mm` (4 ft)
 *      derived count. `blockCountForAxis(lengthMm, DEFAULT)` on
 *      a 12 ft deck yields 4 rows at 1219 mm pitch — well within
 *      the IRC allowable for 2×8 PT No.2 @ 16″ o.c. joists
 *      (span-safe for the MVP joist catalog at typical deck
 *      sizes).
 *      When the deck is so large that the block-count cap
 *      prevents reaching the span-safe count, `spanCheck` fires
 *      the `over-span-joist` warning honestly — correct guidance
 *      (use beams / smaller deck / bigger joists).
 *
 * ## Why the flip? (UAT bug — under-supported / over-spanned)
 *
 * The previous model exposed `blockSpacingMm` (DISTANCE) as the
 * user knob. Users think in "how many blocks under each joist",
 * not in "how many millimeters between them". Combined with the
 * perimeter-two default floor, a large deck defaulted to only 2
 * block rows (at the ends) → every joist over-spanned by ~3× the
 * IRC allowable → the whole deck went red. The COUNT control
 * gives the user direct authority over the physical support
 * density.
 *
 * ## Columns are still pinned to joists (no flying joists)
 *
 * `cols = numJoists`. Every joist has a block column beneath it —
 * the fix/joists-on-blocks-flying invariant survives the pivot
 * unchanged. The `foundation.blockColsHint` model field REMAINS
 * on the schema for back-compat with pre-flying-joists .deck
 * files, but has been a genuine NO-OP for Method B since PR #66
 * (and is not surfaced by any UI control). Code Review Fix #C
 * (2026-07-05 diff review, Opus LOW) removed the no-op param
 * from this signature — the field lives on the model, but the
 * resolver never inspects it.
 *
 * ## Degenerate corner — `numJoists × 2 > MAX_METHOD_B_BLOCK_COUNT`
 *
 * Unchanged from pre-fix. Only reachable with pathological joist
 * spacing on a near-max footprint. Rows stay at 2 (perimeter-two
 * supersedes the cap); the postcondition assertion below allows
 * the overshoot when `rows === 2`.
 */
export function resolveMethodBGrid(
  widthMm: Mm,
  lengthMm: Mm,
  requestedSpacingMm: number | undefined,
  blockRowsHint: number | undefined,
  numJoists: number,
  spanTable?: SpanTable,
  joistMaterial?: MaterialRef,
  joistSpacingMm?: Mm,
): { cols: number; rows: number } {
  // `widthMm` is retained for API symmetry but no longer
  // influences the column count — columns are externally fixed
  // at `numJoists` (see docstring). Code Review Fix #C removed
  // the previously-vestigial `_legacyColsHint` parameter — it
  // was a genuine no-op that only served to lie about the API.
  void widthMm;

  const cols = numJoists;

  // Priority: blockRowsHint (COUNT) > blockSpacingMm (DISTANCE) > default.
  let rowsReq: number;
  if (
    blockRowsHint !== undefined &&
    Number.isFinite(blockRowsHint)
  ) {
    // Primary: user picked the row count directly. Floor non-int.
    rowsReq = Math.floor(blockRowsHint);
  } else if (
    requestedSpacingMm !== undefined &&
    Number.isFinite(requestedSpacingMm)
  ) {
    // Legacy back-compat: derive row count from spacing (pre-fix
    // model). Clamp spacing into the schema-legal range first.
    const s =
      clampBlockSpacingMm(requestedSpacingMm) ??
      DEFAULT_METHOD_B_BLOCK_SPACING_MM;
    rowsReq = blockCountForAxis(lengthMm, s);
  } else {
    // Absent-hint default. Two-step derivation (Code Review Fix #4):
    //   (1) Start from the 1220 mm-derived fallback count — the
    //       legacy "sensible pitch" number that was span-safe for
    //       the QA-verified matrix (≤40 ft decks, common joists).
    //   (2) If a `spanTable` is threaded through AND the joist
    //       material + spacing are known, compute the SPAN-SAFE
    //       minimum row count from the joist's IRC allowable
    //       (`ceil(lengthMm / allowableMm) + 1`) and take the
    //       LARGER of the two — so a very large deck (60–75 ft)
    //       doesn't start over-spanned. When the block-count cap
    //       later prevents reaching this count (huge deck), the
    //       span-check fires the over-span-joist warning honestly.
    //
    // The fallback path (no table, or catalog miss returning 0)
    // preserves byte-identity with pre-Code-Review-Fix-#4 layouts
    // when the pipeline doesn't thread the table through — every
    // existing golden fixture and layout snapshot stays stable.
    const legacyDefault = blockCountForAxis(
      lengthMm,
      DEFAULT_METHOD_B_BLOCK_SPACING_MM,
    );
    let spanSafeRows = legacyDefault;
    if (
      spanTable !== undefined &&
      joistMaterial !== undefined &&
      joistSpacingMm !== undefined
    ) {
      const allowableMm = spanTable.lookupJoistMaxSpan(
        joistMaterial,
        joistSpacingMm,
      );
      if (allowableMm > 0) {
        // Row pitch = lengthMm / (rows - 1) ≤ allowableMm
        //   ⇒ rows ≥ lengthMm / allowableMm + 1.
        spanSafeRows = Math.max(
          legacyDefault,
          Math.ceil(lengthMm / allowableMm) + 1,
        );
      }
    }
    rowsReq = spanSafeRows;
  }

  return { cols, rows: clampMethodBRows(rowsReq, numJoists, lengthMm) };
}

/**
 * Clamp a requested Method-B row count into the physically-
 * realizable range for a given joist count + deck length.
 *
 * ## Ceilings
 *
 *   - `rowsMaxByCap = max(2, floor(MAX_METHOD_B_BLOCK_COUNT / numJoists))`
 *     — defense against pathological instance explosion (each
 *     block is a THREE-render mesh; a runaway grid trashes both
 *     memory and framerate). The floor at 2 keeps the perimeter-
 *     two invariant intact even when `numJoists × 2` already
 *     overshoots the cap (rare — near-max footprint + tight
 *     joist spacing).
 *   - `rowsMaxByGap = max(2, floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1)`
 *     — defense against sub-footprint row pitch (a row denser
 *     than the block footprint would produce overlapping
 *     blocks).
 *
 * Both callsites — the resolver (`resolveMethodBGrid`) and the
 * remediation producer (`produceAddSupportRow`) — MUST use this
 * helper. Duplicating the math risks the remediation proposing
 * a count the resolver would clamp back (silent no-op, breaks
 * `wouldClear` — Code Review Fix #5).
 *
 * ## Postcondition (assertion)
 *
 * When `rows > 2`, `numJoists × rows ≤ MAX_METHOD_B_BLOCK_COUNT`
 * MUST hold. The `rows === 2` degenerate corner is exempt —
 * perimeter-two supersedes. A future arithmetic regression that
 * violates this fails LOUD.
 */
export function clampMethodBRows(
  rowsReq: number,
  numJoists: number,
  lengthMm: Mm,
): number {
  const cols = Math.max(1, numJoists);
  const rowsMaxByCap = Math.max(
    2,
    Math.floor(MAX_METHOD_B_BLOCK_COUNT / cols),
  );
  const rowsMaxByGap = Math.max(
    2,
    Math.floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1,
  );
  const rows = Math.max(2, Math.min(rowsReq, rowsMaxByCap, rowsMaxByGap));

  // Postcondition — see docstring. `cols` here is `numJoists`
  // (already ≥ 1 above), so this matches the resolver's original
  // invariant.
  /* c8 ignore next 5 */
  if (numJoists * rows > MAX_METHOD_B_BLOCK_COUNT && rows > 2) {
    throw new LayoutError(
      `Internal invariant violated: Method B block count ${numJoists}×${rows} = ` +
        `${numJoists * rows} exceeds MAX_METHOD_B_BLOCK_COUNT (${MAX_METHOD_B_BLOCK_COUNT}) ` +
        `while rows > 2 (perimeter-two floor was not the reason for the overshoot).`,
    );
  }

  return rows;
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
  validateFloatingDesign(design, options?.spanTable);
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
        members = computeMethodA(design, options?.spanTable);
        break;
      case 'joists-on-blocks':
        members = computeMethodB(design, options?.spanTable);
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
 * ## Block grid — Method A (**amended for issue #75**)
 *
 *   - **Rows (along +z):** N ≥ 2 rows spread EVENLY between the
 *     two rim insets. Rows are placed at
 *     `z_k = nearZ + k × (farZ − nearZ) / (totalRows − 1)` for
 *     `k = 0..totalRows-1`, where `totalRows` comes from
 *     {@link resolveMethodABeamRows} — 2 when no `SpanTable` is
 *     threaded through or the joist material is not in the catalog
 *     (byte-identical to pre-#75), otherwise the smallest N such
 *     that the row pitch is ≤ the joist's IRC allowable. Every
 *     beam row gets a block row directly under it
 *     (`explicitRowZCenters = [nearZ, ...interiorZs, farZ]`).
 *   - **Columns (along +x):** derived from
 *     `ceil(widthMm / BLOCK_COL_MAX_SPACING_MM) + 1` (subject to
 *     `blockColsHint`) — bounds the block-to-block +x gap to keep
 *     each beam row well-supported. Column derivation is UNCHANGED
 *     by #75 — the column count is a property of each beam row,
 *     not of the row count.
 *
 * The `explicitRowZCenters` override does not force the column
 * count — a user's `blockColsHint` still applies exactly as it did
 * pre-S26 (the S25 UI seam is unchanged).
 *
 * ## FR-E — flush + intermediate rejection
 *
 * When `beamConnection === 'flush' && interiorRows > 0`
 * `validateFloatingDesign` throws BEFORE dispatch. The MVP does
 * NOT support hanging joists off multiple interior beams (each
 * joist would need to be split into per-bay members); the
 * remediation-oriented error surfaces via `useDesignStatus().lastError`.
 */
function computeMethodA(
  design: DeckDesign,
  spanTable?: SpanTable,
): LayoutMember[] {
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

  // Issue #75 — resolve N ≥ 2 beam rows. Fallback (no table /
  // uncatalogued material) yields `totalRows = 2` (byte-identical
  // to pre-#75). Passing `widthMm` here lets the block-count clamp
  // in `clampMethodABeamRows` bind gracefully on schema-legal-but-
  // huge decks (100×100 ft × weak-joist etc.) — the too-large
  // adjacent-beam gap then surfaces via `deriveJoistSpanMm` as an
  // HONEST `over-span-joist` warning and FR-F's disabled
  // remediation guides the user. Post-review-gate fix (Opus HIGH +
  // GPT HIGH + QA GAP-B): previously threw a developer-facing
  // "Internal invariant violated" error on user-reachable inputs.
  const { totalRows: totalRowsClamped } = resolveMethodABeamRows(
    design.footprint.lengthMm,
    spanTable,
    design.joist.material,
    design.joist.spacingMm,
    design.footprint.widthMm,
  );
  // Row z-centers: outer rows at ±(lengthMm/2 - beamInset), interior
  // rows evenly interpolated. For N=2 this is `[nearZ, farZ]`
  // — byte-identical to the pre-#75 layout.
  const rowZCenters: number[] = [];
  if (totalRowsClamped === 2) {
    rowZCenters.push(nearZ, farZ);
  } else {
    const step = (farZ - nearZ) / (totalRowsClamped - 1);
    for (let k = 0; k < totalRowsClamped; k++) {
      rowZCenters.push(nearZ + k * step);
    }
  }

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
    explicitRowZCenters: rowZCenters,
  });

  const beams = computeFloatingBeams(design, { numRows: totalRowsClamped });
  const joists = layoutFloatingJoists(design);
  const boards = layoutFloatingDecking(design);
  // Issue #72 — solid blocking between joists per IRC R502.7.1.
  // Same shared helper the elevated pipeline uses; the floating
  // y-anchor comes from `computeYStackFloating.joistCenterY`
  // (co-planar with joists on the beam-top plane for Method A).
  // Blocking sits in the joist plane; intermediate beams sit in the
  // beam plane (a joist depth below) — different y-planes, so #75's
  // interior beams cannot collide with blocking (FR-036 interop —
  // §17 Q5 in issue #75).
  const blocking = computeFloatingBlockingFromDesign(design);

  // Top-down order (mirrors the y-stack): boards on top, blocks
  // on bottom. Blocking sits at the joist plane (interleaved with
  // joists). The determinism assertion is deep-equal on the
  // array, so keeping the order stable here is important (AC11).
  return [...boards, ...joists, ...blocking, ...beams, ...blocks];
}

/**
 * Method B layout — joists directly on blocks; NO beam layer.
 *
 * ## Block grid — Method B (fix/joists-on-blocks-flying, count-primary
 * after feat/block-count-per-joist)
 *
 *   - **Columns pinned to joists.** Block COLUMNS sit at the joist
 *     x-centers (`explicitColXCenters = joists.map(j => j.position.x)`),
 *     so EVERY joist has a column of blocks directly beneath it
 *     along its full length. `numJoists = numColumns` — one block
 *     column per joist. This is the "no flying joists" invariant
 *     (see `floating-flying-joists.test.ts`).
 *   - **Rows from the user's COUNT knob.** The row count is
 *     resolved by `resolveMethodBGrid` under COUNT-primary
 *     precedence:
 *       1. `foundation.blockRowsHint` (integer) — the primary
 *          user control.
 *       2. `foundation.blockSpacingMm` (mm) — LEGACY back-compat
 *          for designs saved under the pre-feat/block-count-per-
 *          joist model. Superseded when the count is set.
 *       3. Absent both — a span-safe default. When a `spanTable`
 *          is threaded through, the default = the minimum row
 *          count needed to keep the row pitch ≤ the joist's IRC
 *          allowable (`ceil(lengthMm / allowableMm) + 1`), so a
 *          fresh Method-B deck does NOT start over-spanned. When
 *          the table is not available, falls back to the 1220 mm-
 *          derived count.
 *     Outer rows anchored at `±lengthMm/2` (`computeAxisCenters`).
 *     Rows are then clamped by `clampMethodBRows` — see docstring
 *     for the two ceilings (block-count cap + adjacent-row gap).
 *   - **Total blocks = numJoists × rows.**
 *
 * ## What `blockSpacingMm` now means
 *
 * LEGACY. `foundation.blockSpacingMm` used to be the primary user
 * knob (pre-feat/block-count-per-joist). It now controls the row
 * count ONLY when `blockRowsHint` is absent (back-compat for
 * saved designs). The UI no longer exposes it.
 * `span-check.ts::deriveMethodBJoistSpanFromBlockGrid` still
 * derives the joist's between-supports span from the RENDERED
 * block-grid row pitch (irrespective of which knob produced it),
 * so an `over-span-joist` warning fires whenever the effective
 * pitch exceeds the IRC allowable for the joist material.
 *
 * ## Why the pre-fix (feat/block-spacing PR #66) model was broken
 *
 * PR #66 modelled Method B as a REGULAR grid at pitch
 * `blockSpacingMm` on BOTH axes. That decoupled block columns from
 * joist x-centers: on a 16 × 16 ft deck at 16″ o.c. joists + 1220
 * mm default spacing, joists sat at 13 x-positions but block columns
 * landed at 5 unrelated grid positions. Most joists had NO block
 * under them anywhere along their length — they "flew" (were
 * unsupported). This fix restores the pre-#66 column pinning while
 * keeping the user-controllable row pitch that #66 added — the best
 * of both models.
 *
 * ## Regression restored (from pre-#66)
 *
 * `explicitColXCenters = joists.map(j => j.position.x)` — reused
 * verbatim. The `layoutFloatingJoists` call runs BEFORE the block
 * grid so the block columns consume the EXACT positions the joist
 * layer produces (no re-derivation drift). `computeJoistXCenters` is
 * the shared helper both the elevated + floating joist layers use;
 * reading positions off the joist members is one step further from
 * drift than re-calling the helper.
 */
function computeMethodB(
  design: DeckDesign,
  spanTable?: SpanTable,
): LayoutMember[] {
  if (design.foundation.type === 'posts-on-footings') {
    throw new LayoutError('unreachable: posts-on-footings in Method B');
  }
  const widthMm = design.footprint.widthMm;
  const lengthMm = design.footprint.lengthMm;

  // Compute joists FIRST — block columns pin to the joist x-centers
  // so EVERY joist has a support column beneath it (fix for the
  // flying-joist regression from feat/block-spacing PR #66). Reading
  // positions off the joist members (rather than re-calling
  // `computeJoistXCenters`) guarantees no drift between what the
  // joist layer emits and what the block layer sees.
  const joists = layoutFloatingJoists(design);
  const joistXCenters = joists.map((j) => j.position.x);
  const numJoists = joistXCenters.length;

  // Resolve the row count — COUNT-primary precedence:
  //   blockRowsHint > blockSpacingMm > span-safe default.
  // The span-safe default is derived from the joist's IRC
  // allowable via the threaded-through `spanTable` (Code Review
  // Fix #4). Row count is then clamped by `clampMethodBRows` —
  // reduces rows only (columns are load-bearing and cannot be
  // dropped). See `resolveMethodBGrid` docstring.
  const { rows } = resolveMethodBGrid(
    widthMm,
    lengthMm,
    design.foundation.blockSpacingMm,
    design.foundation.blockRowsHint,
    numJoists,
    spanTable,
    design.joist.material,
    design.joist.spacingMm,
  );

  // Anchor z-centers via computeAxisCenters — outer rows sit at
  // ±lengthMm/2 (byte-consistent with Method A's rim-beam anchoring
  // convention).
  const zCenters = computeAxisCenters(lengthMm, rows);

  const blocks = computeBlockGrid({
    footprintMm: { widthMm, lengthMm },
    foundation: design.foundation,
    // `beamSpanMaxMm` / `joistSpanMaxMm` are unused when explicit
    // centers are supplied (validator still requires > 0). Pass
    // MIN_BLOCK_SPACING_MM defensively — any positive value works.
    beamSpanMaxMm: MIN_BLOCK_SPACING_MM,
    joistSpanMaxMm: MIN_BLOCK_SPACING_MM,
    explicitColXCenters: joistXCenters,
    explicitRowZCenters: zCenters,
  });

  const boards = layoutFloatingDecking(design);
  // Issue #72 — solid blocking between joists per IRC R502.7.1.
  // Method B joists rest directly on the block top (`beamDepthMm
  // = 0` in the floating y-stack), so `joistCenterY` sits
  // half-a-joist-depth above y=0 — blocking co-planar with the
  // joists honors the same "solid on-edge blocking between joists"
  // detail as Method A + the elevated pipeline.
  const blocking = computeFloatingBlockingFromDesign(design);
  // Order: boards → joists → blocking → blocks. No beam layer.
  return [...boards, ...joists, ...blocking, ...blocks];
}

/**
 * Floating-pipeline adapter to the shared
 * {@link layoutBlockingBetweenJoists} helper. Sibling of the
 * elevated `computeBlockingFromDesign` in `../layout-engine.ts`;
 * the only difference is the y-anchor source
 * (`computeYStackFloating` vs `computeYStack`). The x-anchor is
 * derived from the SAME `computeJoistXCenters` helper both joist
 * layers (elevated + floating Method A/B) already use, so
 * blocking cannot drift from joists.
 *
 * ## Method A vs Method B
 *
 * Both methods produce joists at `computeJoistXCenters` (see
 * `layoutFloatingJoists`), so the SAME derivation covers both.
 * The y-anchor `computeYStackFloating.joistCenterY` already
 * dispatches on `design.floatingFraming`: Method A joists sit on
 * beam-top, Method B joists sit on block-top. Blocking follows.
 *
 * @throws {Error} from `lookupMaterial` when the joist material
 *   triple is not in the catalog. `computeFloatingLayout` wraps
 *   this as `LayoutError`.
 */
function computeFloatingBlockingFromDesign(
  design: DeckDesign,
): readonly LayoutMember[] {
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
  const joistCenterY = computeYStackFloating(design).joistCenterY;

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
function validateFloatingDesign(
  design: DeckDesign,
  spanTable?: SpanTable,
): void {
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

  // feat/block-spacing review-gate follow-up (2026-07-05) — mirror
  // the elevated `validateDesign` MAX_DECK_DIMENSION_MM cap on the
  // floating path. Without this the schema-side 30480 mm cap is
  // the ONLY line of defense for floating designs entering through
  // in-memory patch / test-fixture paths (no persistence
  // round-trip → no Ajv). See FR-035 "defense-in-depth" clause.
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
    // Issue #75 (FR-E) — flush + intermediate beam rows are
    // REJECTED at validation. Method A #75 places intermediate
    // beam rows between the two rims to keep joists span-safe;
    // FLUSH framing hangs joists off the beam face via hangers,
    // so a joist can only span between TWO beam faces (its two
    // ends). Interior beams under flush would require SEGMENTED
    // joists (per-bay members) — a large geometric + BOM change
    // deferred to a follow-up story (§16 in issue #75). The
    // rejection is surfaced via `useDesignStatus().lastError`
    // — three actionable remediations named below.
    if (design.beamConnection === 'flush') {
      const { interiorRows } = resolveMethodABeamRows(
        design.footprint.lengthMm,
        spanTable,
        design.joist.material,
        design.joist.spacingMm,
        design.footprint.widthMm,
      );
      if (interiorRows > 0) {
        throw new LayoutError(
          `Flush beam connection combined with intermediate beam ` +
            `rows (${interiorRows} interior row${interiorRows === 1 ? '' : 's'}) is not ` +
            `supported in the MVP. Method A auto-adds interior beam rows to keep ` +
            `joists span-safe on this deck length, but flush framing hangs each ` +
            `joist off two beam faces — segmenting joists across interior beams ` +
            `is deferred to a follow-up story (see issue #75). Choose one of the ` +
            `three remediations: switch to "drop" beam connection (joists rest on ` +
            `top and run continuously over every beam row), reduce deck length ` +
            `until only the two rim beams are required, or switch to the "joists ` +
            `on blocks" framing method (no beam layer at all).`,
        );
      }
    }
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
