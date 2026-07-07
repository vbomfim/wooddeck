/**
 * `src/ui/bom/CutPlanTable.tsx` — S24 issue #46 AC3.
 *
 * ## Responsibility (single)
 *
 * Render the per-board cut plan for ONE lumber SKU as an HTML
 * `<table>`. One `<tr>` per `PackedBoard`, columns:
 *
 *   | Board # (1-based) | Stock length | Cuts | Offcut |
 *
 * The parent (`LumberRow`) wraps this in a `<details>` so it
 * expands/collapses natively.
 *
 * ## AC3 — cuts sorted longest first
 *
 * `PackedBoard.cuts` from the packer is in PHYSICAL cut order
 * (from one end of the board — matches the carpenter's stop-block
 * workflow). For a DISPLAY table it's more useful to see the
 * longest cut first, so this component sorts a defensive copy
 * before rendering. Ties break by `memberId` ascending for
 * deterministic snapshots.
 *
 * ## Unit-aware (S24 UAT pair-fix FIX 1 — precision consistency)
 *
 *   - All length columns (stock length, cuts, offcut) use the
 *     DEFAULT (fine) precision. An earlier version used
 *     `precision: 'coarse'` on the stock-length column, which
 *     produced contradictory arithmetic in metric mode: a 16 ft
 *     board displayed stock 4.9 m, cut 4.877 m, offcut 0 mm.
 *     Fine precision renders imperial round stock as "16′ 0″"
 *     (no visible change; imperial coarse and fine happen to
 *     agree for whole-foot boards) and metric as "4.877 m",
 *     which matches the cut and offcut cells exactly.
 *
 * ## Boundary
 *
 *   - `../../domain/units` (formatLength, UnitSystem, Mm)
 *   - `../../domain/bom/pack-cut-list` (PackResult type)
 *   - NO state, NO scene, NO application.
 */
import type { JSX } from 'react';

import type { PackResult, PackedBoard, Cut } from '../../domain/bom/pack-cut-list';
import { formatLength, type UnitSystem } from '../../domain/units';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CutPlanTableProps {
  readonly pack: PackResult;
  /**
   * The SKU string this pack belongs to — surfaced in the table's
   * `<caption>` so a screen-reader user can identify which cut
   * plan is being announced (AC8).
   */
  readonly sku: string;
  readonly units: UnitSystem;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CutPlanTable({ pack, sku, units }: CutPlanTableProps): JSX.Element {
  return (
    <table className="wd-bom-panel__table wd-bom-panel__cut-plan">
      <caption className="wd-bom-panel__caption">
        Cut plan for {sku}: {pack.stockBoards.length} board
        {pack.stockBoards.length === 1 ? '' : 's'}.
      </caption>
      <thead>
        <tr>
          <th scope="col">Board</th>
          <th scope="col">Stock length</th>
          <th scope="col">Cuts</th>
          <th scope="col">Offcut</th>
        </tr>
      </thead>
      <tbody>
        {pack.stockBoards.map((board, index) => (
          <CutPlanRow
            // FIX 3 (S24 UAT pair-fix — Opus#5): stable key. `index`
            // as a key breaks if a future refactor re-orders boards
            // (splice pass moved boards in front of FFD boards; a
            // future refactor could re-sort). Compose from the
            // memberIds on the board (deterministic; boards on the
            // same run share memberIds — the FIX 0 splice can put
            // the SAME memberId on multiple boards, so we suffix
            // the index to keep the key globally unique).
            key={`${board.cuts.map((c) => c.memberId).join('|')}#${String(index)}`}
            board={board}
            boardNumber={index + 1}
            units={units}
          />
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Sub-row (kept co-located; not exported — LumberRow talks to the
// table, not to individual rows)
// ---------------------------------------------------------------------------

function CutPlanRow({
  board,
  boardNumber,
  units,
}: {
  board: PackedBoard;
  boardNumber: number;
  units: UnitSystem;
}): JSX.Element {
  return (
    <tr>
      <th scope="row">{boardNumber}</th>
      {/*
        FIX 1 (S24 UAT pair-fix): stock length now renders at the
        DEFAULT (fine) precision, matching cuts + offcut. See
        module header. The prior `precision: 'coarse'` produced
        contradictory metric arithmetic ("4.9 m stock, 4.877 m
        cut, 0 mm offcut" doesn't add up).
      */}
      <td>{formatLength(board.stockLengthMm, units)}</td>
      <td>{formatCuts(board.cuts, units)}</td>
      <td>{formatLength(board.offcutMm, units)}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a board's cuts as a comma-separated string, LONGEST FIRST.
 *
 *   - Defensive-copies (`cuts` is `readonly` — never mutate).
 *   - Ties break by `memberId` ascending so the snapshot is
 *     deterministic across runs (unstable sort would occasionally
 *     swap two equal-length cuts and reduce diff-review signal).
 *   - Uses the default `'fine'` precision — member lengths are
 *     arbitrary and precision matters.
 *
 * Joiner is `", "` — the comma is a natural pause for screen
 * readers reading the cell contents.
 */
function formatCuts(cuts: readonly Cut[], units: UnitSystem): string {
  const sorted = [...cuts].sort(compareCutsDesc);
  return sorted.map((c) => formatLength(c.lengthMm, units)).join(', ');
}

/** Descending length, tie-break by memberId asc. Stable across runs. */
function compareCutsDesc(a: Cut, b: Cut): number {
  if (a.lengthMm !== b.lengthMm) return b.lengthMm - a.lengthMm;
  if (a.memberId < b.memberId) return -1;
  if (a.memberId > b.memberId) return 1;
  /* istanbul ignore next -- memberIds are unique in practice (packer
   * consumes each member exactly once); the equal-length-AND-equal-id
   * branch is a defensive tie-break to keep the comparator total. */
  return 0;
}
