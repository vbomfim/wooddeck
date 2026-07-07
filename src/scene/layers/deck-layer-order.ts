/**
 * `src/scene/layers/deck-layer-order.ts` — the frozen composition
 * order for the eight deck layers.
 *
 * ## Why this constant lives in its own file
 *
 * `eslint-plugin-react-refresh` warns when a file exports
 * BOTH a React component AND a non-component value — HMR can only
 * hot-reload safely when a file's exports are homogeneous. To keep
 * `DeckLayers.tsx` HMR-clean while still exposing the pinned
 * ordering for S12 (AppShell) and the test suite, we split the
 * constant into this dedicated module.
 *
 * ## Frozen order contract (see `DeckLayers.tsx` module header)
 *
 *   1. environment  — ground plane at y = 0
 *   2. footings     — concrete piers, extend into -y
 *   3. blocks       — foundation blocks (S22)
 *   4. posts        — vertical members from footing to beam
 *   5. beams        — horizontal supports carrying joists
 *   6. blocking     — solid noggins between joists (#72; IRC R502.7)
 *   7. joists       — floor joists carrying decking
 *   8. decking      — top boards, the visually top-most primitives
 *
 * A raycast from the ISO camera hits `decking` FIRST because
 * decking is highest in y — the order matches the physical stack.
 *
 * ## S22 addition (Epic 2 / FR-029)
 *
 * `blocks` sits BETWEEN footings and posts:
 *
 *   - Elevated + deck-blocks: the block replaces the footing as the
 *     post's base (block on top of the ground plane, post on top of
 *     the block). Rendering blocks BEFORE posts lets a top-down
 *     raycast hit the post first (posts are taller and cover the
 *     block).
 *   - Floating: no posts exist; the block sits below the beam plane
 *     (y is negative). Rendering blocks BEFORE beams keeps the
 *     stack order intuitive (block THEN what sits on it).
 *
 * ## Issue #72 — `blocking` sits BETWEEN beams and joists
 *
 *   - Solid lumber noggins between ADJACENT JOISTS (not beams) at
 *     interior mid-span row(s), per IRC R502.7 / R502.7.1
 *     (≤ 8 ft o.c., ≥ 1 interior row when there are ≥ 2 joists).
 *   - Same y-plane as the joists it restrains
 *     (`computeYStack.joistCenterY`), so the raycast tiebreak with
 *     `joists` is irrelevant — placing blocking BEFORE joists in
 *     the render order matches the mental model ("blocking IN THE
 *     joist plane, then the joists themselves").
 *
 * ## Type-safety AND runtime immutability
 *
 * The `as const satisfies readonly (keyof LayerVisibility)[]`
 * clause pins two invariants at compile time:
 *
 *   - Every entry is a `keyof LayerVisibility` literal — a typo
 *     like `"joistx"` errors here.
 *   - The array is `readonly` — mutation through the exported
 *     reference is a type error.
 *
 * Wrapping the whole thing in `Object.freeze` adds runtime
 * immutability — a consumer that ignores the type system (e.g. a
 * plain-JS test, or a `Reflect.set` call) cannot silently reorder
 * the sequence. GPT review #4 flagged this — the type-level
 * `readonly` is defense-in-depth compile-time; `Object.freeze` is
 * defense-in-depth runtime.
 */
import type { LayerVisibility } from '../../state';

export const DECK_LAYER_ORDER = Object.freeze([
  'environment',
  'footings',
  'blocks',
  'posts',
  'beams',
  'blocking',
  'joists',
  'decking',
] as const satisfies readonly (keyof LayerVisibility)[]);
