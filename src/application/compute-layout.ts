/**
 * `src/application/compute-layout.ts` — the pure orchestrator that
 * composes the S4 layout engine with the S5 span-check into a single
 * call.
 *
 * ## Purpose
 *
 * Every consumer that needs a warned-up layout (S8 store on every
 * design edit, `loadDesignFromFile` in `./load-design.ts`,
 * `applyParameters` in `./apply-parameters.ts`) needs BOTH the layout
 * (for rendering) AND the warnings (for the panel + overlays). Rather
 * than force each consumer to hand-compose the two domain calls in
 * the right order, this file bundles them.
 *
 * The use-case is intentionally trivial — issue #8 §2 calls this
 * "orchestration only". Domain logic stays in `../domain/layout` and
 * `../domain/spans`; this file just wires them together.
 *
 * ## Function shape returns `{ layout, warnings }` (not `DesignBundle`)
 *
 * This is a deliberate contract choice from issue #8 §2:
 *
 * ```ts
 * export function computeLayoutAndCheck(
 *   design: DeckDesign,
 *   table: SpanTable
 * ): { layout: Layout; warnings: Warning[] };
 * ```
 *
 * The caller (usually `loadDesignFromFile` / `applyParameters`) then
 * wraps that pair together with the `design` argument into a full
 * `DesignBundle`. Returning `DesignBundle` from here would force
 * every intermediate consumer to also carry `design` — which the
 * caller already has. Keeping the return shape lean means:
 *
 *   - The state store can call `computeLayoutAndCheck` directly on a
 *     recompute triggered by (say) an S18 preset swap without
 *     re-passing `design` back to itself, and
 *   - The barrel's `DesignBundle` export remains the SINGLE authority
 *     on the "load / apply" return shape.
 *
 * ## Line budget
 *
 * Issue #8 §15 caps every use-case at 40 lines. This function is 4
 * lines — well under budget. A rewrite that adds branches (e.g. skip
 * span-check when a flag is set) MUST justify the extra complexity in
 * the ticket; a caller that wants no warnings can drop the field.
 *
 * ## Error propagation
 *
 * `computeLayout` throws `LayoutError` for invalid designs (see
 * `../domain/layout/layout-engine.ts` module header). This function
 * does not catch that error — consumers (state store) match on
 * `err instanceof LayoutError` to preserve the previous good layout.
 * `spanCheck` NEVER throws (see its module header — a missing
 * SpanTable row becomes a fail-safe `Warning`).
 */

import type { DeckDesign, Layout, Warning } from '../domain/model';
import { computeLayout } from '../domain/layout';
import { type SpanTable, spanCheck } from '../domain/spans';

/**
 * Compose the layout engine with the span-checker. Pure function —
 * no side effects, no clock reads beyond the one `computeLayout`
 * already performs for `Layout.computedAt`.
 *
 * @throws {LayoutError} propagated from `computeLayout` when the
 *   design is invalid or references an unknown catalog material.
 */
export function computeLayoutAndCheck(
  design: DeckDesign,
  table: SpanTable,
): { layout: Layout; warnings: Warning[] } {
  // Thread the `SpanTable` into `computeLayout` (Code Review
  // Fix #4) so the Method-B span-safe default row-count derivation
  // has access to the joist's IRC allowable. Without this the
  // default falls back to the 1220 mm-derived count — span-safe
  // for typical decks but starts over-spanned on very large legal
  // decks (60–75 ft). The span-check still runs unchanged.
  const layout = computeLayout(design, { spanTable: table });
  const warnings = spanCheck(layout, table);
  return { layout, warnings };
}
