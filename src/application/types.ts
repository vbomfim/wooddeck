/**
 * `src/application/types.ts` — shared type contracts for the
 * application layer.
 *
 * ## Purpose
 *
 * Two types are exported:
 *
 *   - `DesignBundle` — the composite return value of every "load" or
 *     "apply" use-case. Every consumer of a use-case needs the design,
 *     its computed layout, AND the span-check warnings simultaneously
 *     (issue #8 §17 trade-off decision), so bundling them into a
 *     single object simplifies the state-store marshalling in S8
 *     ("action becomes a one-liner").
 *   - `DeepPartial<T>` — a recursive partial used by `applyParameters`
 *     for path-based patches. Kept in the shared module so future
 *     use-cases (e.g. an S18 preset-application flow) can reuse the
 *     exact same partial shape.
 *
 * ## Why NOT include `DeepPartial` in `apply-parameters.ts`
 *
 * Keeping the type in `types.ts` lets the `barrel` (`./index.ts`) and
 * the use-case (`./apply-parameters.ts`) both import from a single
 * place, so a future rename / refinement of the partial shape happens
 * in ONE file. The alternative (declare in `apply-parameters.ts`,
 * re-export from `index.ts`) works but doubles the surface a rewrite
 * has to keep in sync.
 *
 * ## Type-only module
 *
 * Every export is a `type` / `interface` — this file compiles to an
 * empty JavaScript module. It satisfies the `src/application/**` layer
 * rules trivially (no runtime; no DOM; no domain logic).
 *
 * ## `DesignBundle` shape freeze
 *
 * The three fields — `design`, `layout`, `warnings` — are the frozen
 * contract every state-store consumer marshals into React state (S8).
 * A rename would ripple into every store action and every UI selector,
 * so treat this shape as an API contract on par with the `.deck` file
 * envelope from S6.
 */

import type { DeckDesign, Layout, Warning } from '../domain/model';

/**
 * The composite result returned by every "load", "apply", or
 * "recompute" use-case in the application layer.
 *
 *   - `design`   — the (possibly newly-merged) `DeckDesign` that
 *                  produced the layout.
 *   - `layout`   — the layout render contract from `computeLayout`.
 *   - `warnings` — the span-check findings from `spanCheck`.
 *
 * Consumers ALWAYS need all three together: the state store snapshots
 * the design (for undo), the scene renders the layout, and the
 * warnings panel lists the findings. Splitting these into three
 * separate return values would force every consumer to reconstruct
 * the bundle by hand.
 *
 * Field order matches issue #8 §2 "Interface Contract" verbatim.
 */
export interface DesignBundle {
  design: DeckDesign;
  layout: Layout;
  warnings: Warning[];
}

/**
 * Recursive partial — every field of `T` and every field of every
 * nested object may be present or absent independently.
 *
 * Semantics for `applyParameters`:
 *
 *   - Missing key   → keep the value from `current` unchanged.
 *   - Present key with object value → recurse (merge deeply).
 *   - Present key with primitive / union value → replace outright.
 *
 * We DO NOT need an array-branch here because `DeckDesign` contains no
 * array fields. If a future domain type introduces one (e.g. an
 * `edits[]` history), extend this type to preserve array replacement
 * semantics — an array patch should REPLACE, not merge element-by-
 * element, per the S8 store contract (undo/redo snapshots must
 * refer to full arrays).
 */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;
