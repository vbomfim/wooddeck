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
 * ## AC7 — collapsed by default
 *
 * Native `<details>` has no `open` attribute unless it is
 * explicitly set → EVERY pack starts collapsed regardless of board
 * count. Q1 (ticket §17): expanded state is NOT preserved across
 * re-derives — collapsing on every render keeps the UX
 * predictable and avoids stale-state hazards.
 *
 * ## AC1 — stock length in the summary
 *
 * The pack uses ONE stock length per SKU (§16). The invariant is
 * enforced by `deriveBom` — a lumber section only exists when at
 * least one member fed a cut into the packer, and `packCutList`
 * throws on empty `cuts`. So `pack.stockBoards[0]` is always
 * defined and its `stockLengthMm` is the pack's stock length.
 *
 * We ASSERT (fail-loud) on the missing invariant. A silent
 * fallback would hide a real regression (a producer that emitted
 * an empty pack for a non-empty SKU).
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
  const stockText = formatLength(stockLengthMm, units, { precision: 'coarse' });
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
  return firstBoard.stockLengthMm;
}
