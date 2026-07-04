/**
 * `src/ui/bom/LumberRow.tsx` — S24 issue #46 AC1, AC2, AC7.
 *
 * ## Responsibility (single)
 *
 * Render ONE lumber SKU's summary + expandable cut plan. The
 * summary line reads:
 *
 *   "{count} × {sku} × {stockLength} — {totalOffcut} total offcut"
 *
 * The disclosure body is a `<CutPlanTable />`. Native `<details>`
 * + `<summary>` provides all the a11y and keyboard behaviour for
 * free (WCAG 2.2 SC 2.1.1, SC 4.1.2 — see ticket §10).
 *
 * ## AC2 — expansion state persists per SKU (S24 pair-fix FIX 2)
 *
 * Native `<details>` is uncontrolled — its `open` state lives in
 * the DOM node itself. Since `<BomPanel>` keys each row by
 * `section.sku`, React reuses the SAME DOM node across re-renders
 * for a stable SKU → the user's "expanded" or "collapsed" choice
 * PERSISTS as long as that SKU is present in the BOM. The state
 * is only lost when the SKU disappears (e.g. user switches from
 * PT No.2 to KD SPF #2 in the parameter panel) — at which point
 * React unmounts the old node and mounts a fresh one, which
 * starts collapsed.
 *
 * This is the desired UX: a user who's inspecting the cut plan
 * for 2×8 PT joists doesn't want it to collapse every time they
 * nudge the deck width. An earlier version of this comment
 * incorrectly claimed `<details>` state was NOT preserved across
 * re-derives — that was wrong; React's reconciliation preserves
 * DOM nodes for stable keys, which is the whole point of keying
 * rows by SKU.
 *
 * ## AC1 — stock length in the summary
 *
 * The pack uses ONE stock length per SKU for the FFD portion
 * (§16). Spliced boards (FIX 0 pair-fix) also use the maxStock
 * length, so every board in a lumber section shares the same
 * `stockLengthMm`. `firstBoardStockLength()` grabs it from
 * `stockBoards[0]` and asserts (via `assertSingleStockLength()`)
 * that the whole pack agrees — a mixed-stock pack would be an
 * invariant violation and should fail loud.
 *
 * ## Boundary
 *
 *   - `../../domain/units`             — formatLength, UnitSystem.
 *   - `../../domain/bom/derive-bom`    — BomSection_Lumber type.
 *   - `./CutPlanTable`                  — sibling ui/bom module.
 *   - NO state, scene, application.
 */
import type { JSX } from 'react';

import type { BomSection_Lumber } from '../../domain/bom/derive-bom';
import { formatLength, type UnitSystem, type Mm } from '../../domain/units';

import { CutPlanTable } from './CutPlanTable';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LumberRowProps {
  readonly section: BomSection_Lumber;
  readonly units: UnitSystem;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LumberRow({ section, units }: LumberRowProps): JSX.Element {
  const stockLengthMm = firstBoardStockLength(section);
  // FIX 1 (S24 UAT pair-fix — metric precision consistency):
  // stock length used to render at 'coarse' precision (4.9 m for
  // a 16 ft board), while cuts and offcuts render at fine
  // precision (4.877 m, 0 mm). That produced contradictory
  // arithmetic in the cut plan ("stock 4.9 m, cut 4.877 m, offcut
  // 0 mm" doesn't add up). Drop the `precision` override — the
  // default is fine, which renders imperial round stock as
  // "16′ 0″" (no visible change) and metric as "4.877 m" (matches
  // cuts and offcuts exactly).
  const stockText = formatLength(stockLengthMm, units);
  const offcutText = formatLength(section.pack.totalOffcutMm, units);

  return (
    <details className="wd-bom-panel__lumber-row">
      <summary className="wd-bom-panel__lumber-row-summary">
        {section.pack.totalStockBoards} × {section.sku} × {stockText}
        {' — '}
        {offcutText} total offcut
      </summary>
      <CutPlanTable pack={section.pack} sku={section.sku} units={units} />
    </details>
  );
}

// ---------------------------------------------------------------------------
// Invariant helpers
// ---------------------------------------------------------------------------

/**
 * Return `section.pack.stockBoards[0].stockLengthMm` or throw with
 * a descriptive error naming the offending SKU. See module header
 * "AC1 — stock length in the summary" for the invariant contract.
 *
 * S24 UAT pair-fix FIX 3 (Opus#3): also assert that EVERY board
 * in the pack shares that stock length. Emitting a mixed-stock
 * pack from `packCutList` would indicate a producer bug — surface
 * it here with a message naming the SKU rather than let the
 * summary line silently lie about the shopping list. Note: the
 * FIX 0 splice pass uses `maxStockMm` for every spliced board, so
 * a spliced-and-FFD pack (spliced boards + FFD boards) still
 * satisfies "single stock length" — the FFD portion also selects
 * the smallest stock ≥ longest remaining cut, which for a mixed
 * pack that contains an oversize cut IS the maxStockMm.
 */
function firstBoardStockLength(section: BomSection_Lumber): Mm {
  const [firstBoard] = section.pack.stockBoards;
  /* istanbul ignore next -- invariant: lumber sections always have ≥1 stock board */
  if (firstBoard === undefined) {
    throw new Error(
      `LumberRow: lumber section '${section.sku}' has no packed boards — ` +
        `invariant violation. deriveBom should never emit an empty pack for ` +
        `a SKU with cuts.`,
    );
  }
  // FIX 3 (Opus#3): mixed-stock-length guard. In the current
  // pipeline, a pack always uses a single stock length (see the
  // JSDoc above). If a future refactor breaks that assumption
  // without updating the summary rendering, fail loud rather than
  // silently mislabel the shopping list.
  const uniqueStockLengths = new Set(section.pack.stockBoards.map((b) => b.stockLengthMm));
  if (uniqueStockLengths.size > 1) {
    const sorted = [...uniqueStockLengths].sort((a, b) => a - b);
    throw new Error(
      `LumberRow: lumber section '${section.sku}' has boards with mixed stock ` +
        `lengths [${sorted.map((v) => String(v)).join(', ')}] — the summary line ` +
        `renders a single stockLength and would misrepresent the shopping ` +
        `list. Every board in a section's pack must share stockLengthMm.`,
    );
  }
  return firstBoard.stockLengthMm;
}
