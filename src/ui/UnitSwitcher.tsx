/**
 * `src/ui/UnitSwitcher.tsx` — S13 issue #14 AC5 + §10 a11y.
 *
 * ## Responsibility (single)
 *
 * Toggle `useUiStore.units` between `'imperial'` and `'metric'`.
 * DISPLAY-ONLY — never touches the design store (AC5 invariant).
 *
 * ## Shape (two `aria-pressed` buttons in a group)
 *
 * The ticket §10 accessibility contract is "two-state button with
 * `aria-pressed`". Rather than one toggle, we render TWO buttons
 * inside a labelled `<div role="group">`:
 *
 *   - Each button has `aria-pressed={units === self}`.
 *   - The group has `aria-label="Display units"` so screen readers
 *     announce the pair together as one control.
 *
 * This shape is friendlier than a single toggle for keyboard users
 * ("imperial" vs "metric" is explicit, not implicit) AND matches
 * the pattern axe-core's `aria-toggle-field-name` rule expects.
 *
 * ## Boundary
 *
 * Reads/writes `useUiStore` only. No design-store touch (AC5). No
 * domain, application, persistence, or scene imports.
 */
import type { JSX } from 'react';
import { useUiStore } from '../state/ui-store';

/**
 * The unit-switcher pair. Reads `units` with a scoped selector so
 * the component re-renders only when the active unit changes (not
 * when an unrelated ui-store slice like `cameraPreset` mutates).
 */
export function UnitSwitcher(): JSX.Element {
  const units = useUiStore((s) => s.units);

  return (
    <div
      className="wd-unit-switcher"
      role="group"
      aria-label="Display units"
    >
      <button
        type="button"
        className="wd-unit-switcher__btn"
        aria-pressed={units === 'imperial'}
        onClick={(): void => {
          // Idempotent — flipping from imperial to imperial is a
          // no-op; the store still writes the same value which is
          // referentially equal and skipped by Zustand.
          //
          // `getState()` at click time (not at render time) is the
          // pattern from `StorageBanner.tsx`'s `ResetToDefaultButton`
          // — it avoids the `unbound-method` lint hit that
          // `useUiStore(s => s.setUnits)` would trigger by
          // destructuring the setter reference.
          useUiStore.getState().setUnits('imperial');
        }}
      >
        Imperial
      </button>
      <button
        type="button"
        className="wd-unit-switcher__btn"
        aria-pressed={units === 'metric'}
        onClick={(): void => {
          useUiStore.getState().setUnits('metric');
        }}
      >
        Metric
      </button>
    </div>
  );
}
