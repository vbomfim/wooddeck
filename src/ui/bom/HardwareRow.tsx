/**
 * `src/ui/bom/HardwareRow.tsx` — S27
 * (feat/joist-beam-connection).
 *
 * ## Responsibility (single)
 *
 * Render ONE hardware item as a `<tr>` for embedding in a
 * `<table>` inside `BomPanel`. Row header: the hardware SKU (safe
 * to render as text). Data cell: the integer count.
 *
 * The parent (`BomPanel`) supplies the enclosing `<table>` +
 * `<thead>` — this row makes NO assumption about the surrounding
 * columns beyond the (Item, Count) pair.
 *
 * ## XSS defence
 *
 * `sku` is a plain React child (textContent-only). React escapes
 * every string child by default; no `dangerouslySetInnerHTML`.
 *
 * ## Boundary
 *
 *   - `../../domain/bom/derive-bom` — BomSection_Hardware type.
 *   - NO state, scene, application, units. Hardware items are
 *     COUNTED (integer) — nothing to unit-format.
 */
import type { JSX } from 'react';

import type { BomSection_Hardware } from '../../domain/bom/derive-bom';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HardwareRowProps {
  readonly section: BomSection_Hardware;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HardwareRow({ section }: HardwareRowProps): JSX.Element {
  return (
    <tr>
      <th scope="row">{section.sku}</th>
      <td>{section.count}</td>
    </tr>
  );
}
