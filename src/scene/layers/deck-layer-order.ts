/**
 * `src/scene/layers/deck-layer-order.ts` — the frozen composition
 * order for the six deck layers.
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
 *   3. posts        — vertical members from footing to beam
 *   4. beams        — horizontal supports carrying joists
 *   5. joists       — floor joists carrying decking
 *   6. decking      — top boards, the visually top-most primitives
 *
 * A raycast from the ISO camera hits `decking` FIRST because
 * decking is highest in y — the order matches the physical stack.
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
  'posts',
  'beams',
  'joists',
  'decking',
] as const satisfies readonly (keyof LayerVisibility)[]);
