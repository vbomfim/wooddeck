/**
 * `src/ui/BomPanel.tsx` — S14 (issue #15) + S21 (issue #43) + S24
 * (issue #46) BOM panel.
 *
 * ## Responsibility (single)
 *
 * Render the bill of materials — three cooperating sections:
 *
 *   1. **Lumber** — one `<details>` per SKU (see `LumberRow`).
 *      Summary line = "{N} × {SKU} × {stockLength} — {offcut}
 *      total offcut". Body = a `<CutPlanTable>` with one row per
 *      packed board (Board # / Stock length / Cuts / Offcut).
 *      Native `<details>` gives keyboard + a11y for free (§10).
 *
 *   2. **Foundation** — a `<table>` of `<FoundationRow>` rows,
 *      one per catalog product (count + displayName).
 *
 *   3. **Footings** — a `<table>` of one row per
 *      (widthMm × depthMm) footing group (FIX 2 — poured concrete
 *      piers under elevated decks; carried over from S21 as-is).
 *
 * Empty layout → the "Empty layout" copy.
 *
 * ## Memoization (§9 — unchanged from S14)
 *
 * `useLayout()` returns the current layout reference. `useMemo(()
 * => deriveBom(layout, {}), [layout])` memoizes on that reference
 * so unit switches / camera-preset changes don't re-derive. NO
 * `useBom()` store selector — the derivation stays in-panel to
 * avoid touching `design-store` while other stories are in
 * flight.
 *
 * ## Unit switching (AC6 — preserved from S14)
 *
 * `useUiUnits()` gives the current display system. `LumberRow`
 * and `CutPlanTable` re-render with the flipped `units` prop and
 * every length is re-formatted from the SAME `Mm` source of
 * truth. `Mm` is never converted before storage.
 *
 * ## Accessibility (§10)
 *
 * Every section is a `<section aria-labelledby>` with a nested
 * `<h3>`. Every table has a `<caption>` (visually hidden) and
 * `<th scope="col">` on headers, `<th scope="row">` on row
 * headers. `<details>` provides native disclosure semantics
 * (SC 2.1.1, SC 4.1.2).
 *
 * ## Boundary
 *
 *   - `../state`                            — useLayout, useUiUnits.
 *   - `../domain/units` (formatLength)      — imperial/metric formatter.
 *   - `../domain/bom/derive-bom`            — pure BOM derivation (S21).
 *   - `./bom/LumberRow` / `./bom/CutPlanTable` /
 *     `./bom/FoundationRow`                 — sibling ui modules.
 *   - NO application / persistence          — hard rule.
 *
 * `src/ui/**` importing `src/domain/bom/**` is permitted by
 * dep-cruiser's `ui-allowlist` rule (`^src/(state|ui|domain)/`).
 * A boundary self-test probe (BLOCK-21d) verifies the reverse
 * (`src/domain/bom/**` → `src/ui/**`) FAILS.
 */
import { useMemo, type JSX } from 'react';

import { deriveBom, type BomResult } from '../domain/bom/derive-bom';
import { useDesign, useLayout, useUiUnits } from '../state';

import { FoundationRow } from './bom/FoundationRow';
import { HardwareRow } from './bom/HardwareRow';
import { LumberRow } from './bom/LumberRow';

// ---------------------------------------------------------------------------
// Copy constants
// ---------------------------------------------------------------------------

/**
 * The empty-layout copy. Exported so tests grep-import.
 *
 * S24 UAT pair-fix FIX 3 (AC5 alignment): the ticket §AC5 wording
 * is "No materials yet — adjust the parameters to generate a
 * design." (was "Empty layout — check your parameters." before,
 * which was a placeholder from the S14 skeleton).
 */
export const EMPTY_LAYOUT_TEXT =
  'No materials yet — adjust the parameters to generate a design.';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BomPanel(): JSX.Element {
  const layout = useLayout();
  const design = useDesign();
  const units = useUiUnits();

  // Memoize on the layout + beamConnection references — see
  // module header § Memoization. `deriveBom` is pure so this is
  // safe. Default options → kerfMm defaults to 3 mm inside
  // deriveBom. S27: pass `design.beamConnection` so the
  // `hardware` section (joist hangers) reflects the current
  // connection choice.
  const bom: BomResult = useMemo(
    () => deriveBom(layout, { beamConnection: design.beamConnection }),
    [layout, design.beamConnection],
  );

  const isEmpty =
    bom.lumber.length === 0 &&
    bom.foundation.length === 0 &&
    bom.footings.length === 0 &&
    bom.hardware.length === 0;

  return (
    <section aria-labelledby="wd-bom-panel__title" className="wd-bom-panel">
      <h2 id="wd-bom-panel__title">Bill of materials</h2>

      {isEmpty ? (
        <p className="wd-bom-panel__empty" role="status" aria-live="polite">
          {EMPTY_LAYOUT_TEXT}
        </p>
      ) : (
        <>
          {bom.lumber.length > 0 && <LumberSection bom={bom} units={units} />}
          {bom.foundation.length > 0 && <FoundationSection bom={bom} />}
          {bom.footings.length > 0 && <FootingsSection bom={bom} />}
          {bom.hardware.length > 0 && <HardwareSection bom={bom} />}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lumber section (S24 — list of <details> disclosures)
// ---------------------------------------------------------------------------

/**
 * The Lumber `<section aria-labelledby><h3>` container. Each SKU
 * is a `<li>` wrapping a `<LumberRow>`. The `<ul>` list semantics
 * help screen readers announce "list of N items" as the user tabs
 * into the region.
 */
function LumberSection({
  bom,
  units,
}: {
  bom: BomResult;
  units: 'imperial' | 'metric';
}): JSX.Element {
  return (
    <section
      aria-labelledby="wd-bom-panel__lumber-title"
      className="wd-bom-panel__section wd-bom-panel__section--lumber"
    >
      <h3 id="wd-bom-panel__lumber-title">Lumber</h3>
      <ul className="wd-bom-panel__lumber-list">
        {bom.lumber.map((section) => (
          <li key={section.sku} className="wd-bom-panel__lumber-list-item">
            <LumberRow section={section} units={units} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Foundation section — table of FoundationRow rows
// ---------------------------------------------------------------------------

function FoundationSection({ bom }: { bom: BomResult }): JSX.Element {
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
            <FoundationRow key={section.productId} section={section} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footings section (FIX 2 — carried over from S21 unchanged)
// ---------------------------------------------------------------------------

/**
 * One row per concrete-footing dimension group. Footings are
 * POURED CONCRETE — they never enter the cut-list packer (they
 * have no stock length; the volume calculation is out of scope for
 * MVP). A future story may enrich this with a concrete-yardage
 * estimate. Original S21 silently dropped footings from the BOM
 * entirely; the review gate flagged that as a HIGH-priority
 * correctness bug.
 */
function FootingsSection({ bom }: { bom: BomResult }): JSX.Element {
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

// ---------------------------------------------------------------------------
// Hardware section (S27 — joist hangers for flush-beam connection)
// ---------------------------------------------------------------------------

/**
 * One row per hardware SKU (S27 — currently joist hangers only,
 * emitted for `beamConnection: 'flush'`). Hangers are counted
 * (integer), not cut, so no unit formatting or pack table. The
 * SKU string is human-readable (`"Joist hangers (2×8)"`) so
 * homeowners can shop it directly.
 */
function HardwareSection({ bom }: { bom: BomResult }): JSX.Element {
  return (
    <section
      aria-labelledby="wd-bom-panel__hardware-title"
      className="wd-bom-panel__section wd-bom-panel__section--hardware"
    >
      <h3 id="wd-bom-panel__hardware-title">Hardware</h3>
      <table className="wd-bom-panel__table wd-bom-panel__table--hardware">
        <caption className="wd-bom-panel__caption">
          Hardware to purchase (joist hangers, brackets, fasteners).
        </caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {bom.hardware.map((section) => (
            <HardwareRow key={section.sku} section={section} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
