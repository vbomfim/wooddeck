/**
 * `src/ui/BomPanel.tsx` — S14 (issue #15) + S21 (issue #43) BOM panel.
 *
 * ## Responsibility (single)
 *
 * Render the bill of materials — a per-SKU LUMBER table with the
 * cut-list pack (S21) plus a FOUNDATION table for block-kind
 * products (also S21). Empty design → the "Empty layout" copy.
 *
 * S24 will enrich this rendering with per-board cut expansion
 * (offcut breakdown, per-board cut list); the S21 slice provides
 * the MINIMUM to consume the widened `BomResult` shape without
 * regressing the S14 landmark / a11y contract or the FIX J.5
 * memoization contract.
 *
 * ## Memoization (§9 — unchanged from S14)
 *
 * `useLayout()` returns the current layout reference from the
 * store bundle. `useMemo(() => deriveBom(layout), [layout])`
 * memoizes on that reference so unit switches / camera-preset
 * changes don't re-derive. `deriveBom` is pure (S21 moved it to
 * `domain/bom` — see module boundary § below).
 *
 * ## Unit switching (AC7 — unchanged from S14)
 *
 * `useUiUnits()` gives the current display system. All lengths
 * (stock length, cut length, offcut) are stored as `Mm` in the
 * BOM result; `formatLength(mm, system)` produces the display
 * string. No `Mm` value is ever converted BEFORE storage.
 *
 * ## Accessibility (§10 — unchanged from S14)
 *
 * Each section is a `<section aria-labelledby>` with a nested
 * `<h3>`, containing a `<table>` with `<caption>`, `<thead>` /
 * `<tbody>`, and `<th scope="col">` on every column header. Row
 * headers use `<th scope="row">`.
 *
 * ## Boundary
 *
 *   - `../state`                            — useLayout, useUiUnits.
 *   - `../domain/units` (formatLength)      — imperial/metric formatter.
 *   - `../domain/bom/derive-bom`            — pure BOM derivation (S21).
 *   - NO application / persistence         — hard rule.
 *
 * `src/ui/**` importing `src/domain/bom/**` is permitted by
 * dep-cruiser's `ui-allowlist` rule (`^src/(state|ui|domain)/`).
 * A boundary self-test probe (BLOCK-21u) verifies this path
 * PASSES; a companion probe (BLOCK-21d) verifies the reverse
 * (`src/domain/bom/**` → `src/ui/**`) FAILS.
 */
import { useMemo, type JSX } from 'react';

import { deriveBom, type BomResult } from '../domain/bom/derive-bom';
import { formatLength } from '../domain/units';
import { useLayout, useUiUnits } from '../state';

// ---------------------------------------------------------------------------
// Copy constants
// ---------------------------------------------------------------------------

/**
 * The empty-layout copy. Exported so tests grep-import.
 */
export const EMPTY_LAYOUT_TEXT = 'Empty layout — check your parameters.';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BomPanel(): JSX.Element {
  const layout = useLayout();
  const units = useUiUnits();

  // Memoize on the layout reference — see module header §
  // Memoization. `deriveBom` is pure so this is safe. Default
  // options → kerfMm defaults to 3 mm inside deriveBom.
  const bom: BomResult = useMemo(() => deriveBom(layout, {}), [layout]);

  const isEmpty =
    bom.lumber.length === 0 && bom.foundation.length === 0 && bom.footings.length === 0;

  return (
    <section aria-labelledby="wd-bom-panel__title" className="wd-bom-panel">
      <h2 id="wd-bom-panel__title">Bill of materials</h2>

      {isEmpty ? (
        <p className="wd-bom-panel__empty" role="status" aria-live="polite">
          {EMPTY_LAYOUT_TEXT}
        </p>
      ) : (
        <>
          {bom.lumber.length > 0 && (
            <LumberTable bom={bom} units={units} />
          )}
          {bom.foundation.length > 0 && (
            <FoundationTable bom={bom} />
          )}
          {bom.footings.length > 0 && (
            <FootingsTable bom={bom} />
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lumber sub-table (S21 minimal rendering — one row per SKU)
// ---------------------------------------------------------------------------

/**
 * One row per lumber SKU. Columns:
 *
 *   - SKU (e.g. `2x8 PT No2`) — <th scope="row">
 *   - Stock length (single value used for the pack — the FFD packer
 *     uses ONE stock length per pack, ticket §16)
 *   - Total stock boards (the shopping quantity)
 *   - Total offcut length (rough waste metric; S24 enriches with
 *     per-board breakdown)
 *
 * The S21 slice deliberately renders only the summary line. S24
 * will add an expandable per-board cut list underneath each row.
 */
function LumberTable({ bom, units }: { bom: BomResult; units: 'imperial' | 'metric' }): JSX.Element {
  return (
    <section
      aria-labelledby="wd-bom-panel__lumber-title"
      className="wd-bom-panel__section wd-bom-panel__section--lumber"
    >
      <h3 id="wd-bom-panel__lumber-title">Lumber</h3>
      <table className="wd-bom-panel__table wd-bom-panel__table--lumber">
        <caption className="wd-bom-panel__caption">
          Lumber to purchase, grouped by SKU with cut-list-optimized stock counts.
        </caption>
        <thead>
          <tr>
            <th scope="col">SKU</th>
            <th scope="col">Stock length</th>
            <th scope="col">Boards</th>
            <th scope="col">Offcut</th>
          </tr>
        </thead>
        <tbody>
          {bom.lumber.map((section) => {
            // The pack uses ONE stock length per pack (ticket §16).
            // First board's stockLengthMm is the pack's stock length.
            // Invariant: a lumber SECTION only exists when at least
            // one member fed cuts into the packer → at least one
            // board is always packed → `stockBoards[0]` exists.
            // (Enforced in `deriveBom` — every group has ≥1 cut,
            // and `packCutList` throws on empty `cuts`.) The old
            // fallback to `stockLengthsAvailableMm[0]` was dead
            // code and hid this invariant; asserting is clearer.
            const [firstBoard] = section.pack.stockBoards;
            /* istanbul ignore next -- invariant: lumber sections always have ≥1 stock board */
            if (firstBoard === undefined) {
              throw new Error(
                `BomPanel: lumber section '${section.sku}' has no packed ` +
                  `boards — invariant violation. deriveBom should never ` +
                  `emit an empty pack for a SKU with cuts.`,
              );
            }
            const stockLengthMm = firstBoard.stockLengthMm;
            return (
              <tr key={section.sku}>
                <th scope="row">{section.sku}</th>
                <td>{formatLength(stockLengthMm, units, { precision: 'coarse' })}</td>
                <td>{section.pack.totalStockBoards}</td>
                <td>{formatLength(section.pack.totalOffcutMm, units)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Foundation sub-table (S21 — one row per foundation product)
// ---------------------------------------------------------------------------

/**
 * One row per foundation product (AC6). Columns:
 *
 *   - Product (the catalog `displayName` — safe to render as-is)
 *     — <th scope="row">
 *   - Count (integer number of blocks to buy)
 */
function FoundationTable({ bom }: { bom: BomResult }): JSX.Element {
  return (
    <section
      aria-labelledby="wd-bom-panel__foundation-title"
      className="wd-bom-panel__section wd-bom-panel__section--foundation"
    >
      <h3 id="wd-bom-panel__foundation-title">Foundation</h3>
      <table className="wd-bom-panel__table wd-bom-panel__table--foundation">
        <caption className="wd-bom-panel__caption">
          Foundation products to purchase (blocks are counted, not cut).
        </caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {bom.foundation.map((section) => (
            <tr key={section.productId}>
              <th scope="row">{section.displayName}</th>
              <td>{section.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footings sub-table (FIX 2 — one row per (widthMm × depthMm) group)
// ---------------------------------------------------------------------------

/**
 * One row per concrete-footing dimension group (FIX 2 review-gate).
 * Columns:
 *
 *   - Footing (the synthetic `displayName` — dimension-derived,
 *     safe to render as-is) — <th scope="row">
 *   - Count (integer number of footings to pour)
 *
 * Footings are POURED CONCRETE — they never enter the cut-list
 * packer (they have no stock length; the volume calculation is
 * out of scope for S21). S24 may enrich this with a concrete-
 * yardage estimate. Original S21 silently dropped footings from
 * the BOM entirely; the review gate flagged that as a HIGH-
 * priority correctness bug.
 */
function FootingsTable({ bom }: { bom: BomResult }): JSX.Element {
  return (
    <section
      aria-labelledby="wd-bom-panel__footings-title"
      className="wd-bom-panel__section wd-bom-panel__section--footings"
    >
      <h3 id="wd-bom-panel__footings-title">Footings</h3>
      <table className="wd-bom-panel__table wd-bom-panel__table--footings">
        <caption className="wd-bom-panel__caption">
          Concrete footings to pour (dimensions from the foundation spec).
        </caption>
        <thead>
          <tr>
            <th scope="col">Footing</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {bom.footings.map((section) => {
            // Group key `(widthMm, depthMm)` is stable across
            // deriveBom calls — safe as a React key.
            const key = `${String(section.widthMm)}x${String(section.depthMm)}`;
            return (
              <tr key={key}>
                <th scope="row">{section.displayName}</th>
                <td>{section.count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
