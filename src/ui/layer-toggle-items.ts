/**
 * `src/ui/layer-toggle-items.ts` — data-only companion to
 * `LayerTogglePanel.tsx`.
 *
 * Keeps the panel component file "components-only" so the
 * `react-refresh/only-export-components` HMR rule stays happy
 * (arrays don't count as constant exports). Also exposes the
 * labels to tests without importing the panel module (which
 * would trigger the whole component render tree).
 */
import type { CameraPreset, LayerVisibility } from '../state';

/**
 * The eight MVP layer keys with wired UI toggles — plus their
 * user-facing labels. Order matches the ticket §2 field listing
 * (environment → decking → framing → footings → blocks → blocking).
 * Extracted as a module constant so tests can walk the list without
 * duplicating the copy.
 *
 * ## S26 addition — blocks + blocking rows (issue #48)
 *
 * S22 (Epic 2 / FR-029) added `blocks` and `blocking` to the
 * `LayerVisibility` union and wired their VISIBILITY at the scene
 * layer. S26 (this file) adds the matching CHECKBOX rows here —
 * the panel iterates `LAYER_ITEMS` to render one row per key, so
 * the two additions light up automatically. Placement is after
 * `footings` per ticket §2 (foundation-layer members grouped
 * together at the bottom of the toggle list).
 *
 * ## Type shape — `as const satisfies` (S26 pair-fix Review #1)
 *
 * Declared with `as const satisfies …` (NOT a widening `: readonly
 * { key: keyof LayerVisibility; label: string }[]` annotation) so
 * each element's `key` stays a LITERAL string type
 * (`'environment' | 'decking' | … | 'blocking'`) rather than being
 * widened to `keyof LayerVisibility`. The literal-preserving form
 * is what makes the `_ITEMS_ARE_EXHAUSTIVE` compile-time guard
 * below meaningful — without it,
 * `(typeof LAYER_ITEMS)[number]['key']` collapses to
 * `keyof LayerVisibility` regardless of the array's contents and
 * the guard silently succeeds even when rows are missing.
 * `satisfies` still enforces the shape (each row MUST match
 * `{ key: keyof LayerVisibility; label: string }`), so no type
 * safety is lost.
 */
export const LAYER_ITEMS = [
  { key: 'environment', label: 'Environment' },
  { key: 'decking', label: 'Decking' },
  { key: 'joists', label: 'Joists' },
  { key: 'beams', label: 'Beams' },
  { key: 'posts', label: 'Posts' },
  { key: 'footings', label: 'Footings' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'blocking', label: 'Blocking' },
] as const satisfies readonly { key: keyof LayerVisibility; label: string }[];

/**
 * Compile-time exhaustiveness guard — every `keyof LayerVisibility`
 * MUST appear in `LAYER_ITEMS`. If a future story adds a 9th key to
 * the union but forgets a row here, the type assignment below fails
 * to type-check (the missing key falls out of the `Exclude<...>`
 * and the `never`-assignability check trips). A companion RUNTIME
 * guard lives in `LayerTogglePanel.test.tsx` (`… exhaustiveness …`).
 *
 * The double-guard is deliberate: the type check catches the
 * mistake at compile time (fast feedback); the runtime test catches
 * it if someone weakens the `LAYER_ITEMS` type annotation (belt
 * AND braces).
 *
 * ## Verified live (S26 pair-fix Review #1)
 *
 * Empirically confirmed by temporarily adding a 9th key to
 * `LayerVisibility` — the assignment errors with the missing key
 * name in the diagnostic. The prior version's widening annotation
 * (`: readonly { key: keyof LayerVisibility; label: string }[]`)
 * made this guard a no-op; the current `as const satisfies` form
 * preserves the element-`key` literals and the guard now fires.
 */
type _MissingLayerItemKeys = Exclude<
  keyof LayerVisibility,
  (typeof LAYER_ITEMS)[number]['key']
>;
const _ITEMS_ARE_EXHAUSTIVE: _MissingLayerItemKeys extends never
  ? true
  : never = true;
// Reference the constant so `noUnusedLocals` doesn't flag it; the
// value is only meaningful at compile time, so a `void` discard is
// the least-surprising way to keep the compiler happy.
void _ITEMS_ARE_EXHAUSTIVE;

/**
 * The five preset-view buttons. Order: Orbit (the default free
 * camera) first, then the four orthographic projections — top,
 * front, side, iso.
 */
export const PRESET_ITEMS: readonly {
  value: CameraPreset;
  label: string;
}[] = [
  { value: 'orbit', label: 'Orbit' },
  { value: 'top', label: 'Top' },
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'iso', label: 'Iso' },
];
