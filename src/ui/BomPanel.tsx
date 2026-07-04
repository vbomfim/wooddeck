/**
 * `src/ui/BomPanel.tsx` — S14 issue #15 AC6 + AC7.
 *
 * ## Responsibility (single)
 *
 * Render the bill of materials — a table with one row per grouped
 * `BomLine` (see `./bom/derive-bom.ts` for the grouping rule).
 * Empty layout → the "Empty layout — check your parameters"
 * message.
 *
 * ## Memoization (§9)
 *
 * The BOM derivation is a linear scan over `layout.members`
 * (~50 members for a typical 12×16 deck), so raw performance is
 * not a concern. What IS a concern is REFERENTIAL STABILITY: an
 * unrelated store mutation (unit switch, camera preset) must NOT
 * trigger a BOM recompute. `useLayout()` returns the current
 * layout reference from the store's bundle; that reference
 * changes ONLY when the design mutates. `useMemo(() =>
 * deriveBom(layout), [layout])` memoizes on the layout reference,
 * matching the ticket §9 requirement.
 *
 * ## Unit switching (AC7)
 *
 * `useUiUnits()` returns the user's current display system.
 * `formatLength(mm, system)` (from `../domain/units`) produces
 * the canonical string — `12′ 0″` for imperial 3658 mm, `3.658 m`
 * for metric. The underlying `Mm` value in the store never
 * changes; only the rendered STRING flips. This mirrors the
 * ParameterPanel's unit-switching contract.
 *
 * ## Accessibility (§10)
 *
 *   - `<section aria-labelledby>` with a nested `<h2>` — same
 *     landmark pattern as every other panel.
 *   - `<table>` with `<caption>`, `<thead>` / `<tbody>`, and
 *     `<th scope="col">` on every header cell (§10 rule).
 *   - Column headers: Kind / SKU / Species / Count / Each length
 *     / Total. When a column is not applicable for a row (e.g. no
 *     eachLength for footings; no total for framing) the cell
 *     renders an em-dash "—" with `aria-label="not applicable"`
 *     so screen readers don't spell out the punctuation.
 *
 * ## Boundary
 *
 *   - `../state`                     — useLayout, useUiUnits.
 *   - `../domain/units` (formatLength) — reused imperial/metric formatter.
 *   - `./bom/derive-bom`             — the pure derivation.
 *   - NO application / persistence   — hard rule.
 */
import { useMemo, type JSX } from 'react';

import type { MemberKind } from '../domain/model';
import { formatLength } from '../domain/units';

import { deriveBom, type BomLine } from './bom/derive-bom';
import { useLayout, useUiUnits } from '../state';

// ---------------------------------------------------------------------------
// Copy constants
// ---------------------------------------------------------------------------

/**
 * The empty-layout copy. Exported so tests grep-import.
 */
export const EMPTY_LAYOUT_TEXT =
  'Empty layout — check your parameters.';

/**
 * The em-dash rendered in cells where the value is not applicable
 * to that row (e.g. no eachLength on footings). `aria-label="not
 * applicable"` so screen readers announce meaning instead of
 * punctuation.
 */
const NOT_APPLICABLE = '—';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Human-readable label for each `MemberKind`. Extracted so a
 * future rename (e.g. `board` → `deck-board`) touches one place.
 * Uses a `Record<MemberKind, string>` for the exhaustive-check.
 *
 * ## S17 — MemberKind widening
 *
 * `block` (foundation block placement — S22) and `blocking`
 * (between-joist blocking members — S24+) are stubbed with
 * provisional labels. The BOM UI does not yet render block/
 * blocking rows (they are excluded upstream by `deriveBom`
 * which currently only emits joist/beam/post/footing/board
 * rows); the labels exist so the exhaustive `Record<MemberKind, string>`
 * check compiles.
 */
const KIND_LABEL: Record<MemberKind, string> = {
  joist: 'Joist',
  beam: 'Beam',
  post: 'Post',
  footing: 'Footing',
  board: 'Board',
  block: 'Foundation block',
  blocking: 'Blocking',
};

/**
 * A stable per-row key. Combines the same fields the grouping
 * uses, so React's reconciliation matches rows across renders
 * even if the layout re-computes.
 */
function rowKey(line: BomLine): string {
  const eachPart = line.eachLengthMm === undefined ? '-' : String(line.eachLengthMm);
  return `${line.kind}|${line.nominal}|${line.species}|${eachPart}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BomPanel(): JSX.Element {
  const layout = useLayout();
  const units = useUiUnits();

  // Memoize on the layout reference — see module header §
  // Memoization. `deriveBom` is pure so this is safe.
  const rows = useMemo(() => deriveBom(layout), [layout]);

  const isEmpty = rows.length === 0;

  return (
    <section
      aria-labelledby="wd-bom-panel__title"
      className="wd-bom-panel"
    >
      <h2 id="wd-bom-panel__title">Bill of materials</h2>

      {isEmpty ? (
        <p className="wd-bom-panel__empty" role="status" aria-live="polite">
          {EMPTY_LAYOUT_TEXT}
        </p>
      ) : (
        <table className="wd-bom-panel__table">
          <caption className="wd-bom-panel__caption">
            Materials required for the current design, grouped by SKU and length.
          </caption>
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">SKU</th>
              <th scope="col">Species</th>
              <th scope="col">Count</th>
              <th scope="col">Each length</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((line) => (
              <tr key={rowKey(line)}>
                <th scope="row">{KIND_LABEL[line.kind]}</th>
                <td>{line.nominal}</td>
                <td>{line.species}</td>
                <td>{line.count}</td>
                <td>
                  {line.eachLengthMm !== undefined ? (
                    formatLength(line.eachLengthMm, units)
                  ) : (
                    <span aria-label="not applicable">{NOT_APPLICABLE}</span>
                  )}
                </td>
                <td>
                  {line.totalLinearMm !== undefined ? (
                    // Coarse precision on totals — nobody buys
                    // fractional-inch decking in linear feet, so
                    // "180 ft" or "54.8 m" is the shopping-cart
                    // unit. Precision option is passed as a
                    // {precision} object per formatLength's shape.
                    formatLength(line.totalLinearMm, units, { precision: 'coarse' })
                  ) : (
                    <span aria-label="not applicable">{NOT_APPLICABLE}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
