/**
 * `src/ui/bom/FoundationRow.tsx` — S24 issue #46 AC4.
 *
 * ## Responsibility (single)
 *
 * Render ONE foundation product as a `<tr>` for embedding in a
 * `<table>` inside `BomPanel`. Row header: the catalog's
 * `displayName` (safe to render as text — no HTML). Data cell:
 * the integer count.
 *
 * The parent (`BomPanel`) supplies the enclosing `<table>` +
 * `<thead>` — this row makes NO assumption about the surrounding
 * columns beyond the (Product, Count) pair.
 *
 * ## XSS defence
 *
 * `displayName` is a plain React child (textContent-only). React
 * escapes every string child by default — a hostile string like
 * `"<img src=x onerror=alert(1)>"` renders as literal text, never
 * as a live element. No `dangerouslySetInnerHTML`, ever.
 *
 * ## Boundary
 *
 *   - `../../domain/bom/derive-bom` — BomSection_Foundation type.
 *   - NO state, scene, application, units. Foundation blocks are
 *     COUNTED (integer) — nothing to unit-format.
 */
import type { JSX } from 'react';

import type { BomSection_Foundation } from '../../domain/bom/derive-bom';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FoundationRowProps {
  readonly section: BomSection_Foundation;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FoundationRow({ section }: FoundationRowProps): JSX.Element {
  return (
    <tr>
      <th scope="row">{section.displayName}</th>
      <td>{section.count}</td>
    </tr>
  );
}
