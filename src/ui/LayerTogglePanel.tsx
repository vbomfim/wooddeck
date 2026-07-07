/**
 * `src/ui/LayerTogglePanel.tsx` — S14 issue #15 AC1..AC3 + AC12
 * (extended by S26 issue #48 for blocks + blocking rows).
 *
 * ## Responsibility (single)
 *
 * The rightPanel's first section:
 *
 *   1. One labelled checkbox per `LayerVisibility` key, bound to
 *      `useUiStore.layerVisibility`. The set of rows is driven by
 *      `LAYER_ITEMS` — adding a layer to the union + a row there
 *      lights up automatically here.
 *   2. A "Show all" / "Hide all" pair that flips every layer in
 *      one action.
 *   3. Five preset-view buttons (Orbit / Top / Front / Side / Iso)
 *      that call `useUiStore.setCameraPreset(<value>)`.
 *
 * The Open Question in issue #15 §17 ("preset buttons here or in
 * a separate viewport toolbar?") was resolved in-favour-of THIS
 * panel — consolidating "everything view-related" here matches
 * the ticket's MVP intent. Post-MVP a viewport toolbar can lift
 * the presets out; the store contract stays identical.
 *
 * ## Interaction latency (AC12)
 *
 * The store selector reads a single slice
 * (`useLayerVisibility()`) so the panel re-renders only when the
 * layer map itself changes. Handlers call `getState()` at click
 * time (not the memoized selector reference) to avoid the
 * `react-hooks/exhaustive-deps` false positive that
 * destructuring the setter would trigger. Match the
 * `UnitSwitcher` pattern. SC-002 requires ≤100 ms click →
 * `<group visible>` — the S10 layer components already own that
 * budget; this panel adds no extra work beyond a single Zustand
 * `set(...)`.
 *
 * ## Accessibility (§10)
 *
 *   - Each checkbox is inside a `<label>` (implicit binding — no
 *     `htmlFor`/`id` needed, but keeps screen readers happy).
 *   - The Show/Hide button pair is in a `<div role="group"
 *     aria-label="Layer bulk actions">` so screen readers
 *     announce them as one control.
 *   - The preset buttons live in a `<div role="group"
 *     aria-label="Camera view presets">` with `aria-pressed` on
 *     each button reflecting `preset === value` — the active
 *     preset is announced as "pressed".
 *   - The panel itself is a `<section aria-labelledby>` so the
 *     complementary `<aside>` landmark can announce its title
 *     via a nested `<h2>` (see AppShell landmark test).
 *
 * ## Boundary
 *
 *   - `../state`               — useUiStore, useLayerVisibility, useCameraPreset.
 *   - `react` (JSX)            — types.
 *   - NO domain / application  — pure UI toggles.
 *   - NO scene / persistence   — hard rule.
 */
import type { JSX } from 'react';

import {
  useCameraPreset,
  useLayerVisibility,
  useUiStore,
} from '../state';

import { LAYER_ITEMS, PRESET_ITEMS } from './layer-toggle-items';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The layer-checkbox + bulk-action + preset-view panel. See module
 * header for the ordering + a11y contract. The checkbox rows are
 * driven by `LAYER_ITEMS` — one row per `LayerVisibility` key.
 */
export function LayerTogglePanel(): JSX.Element {
  const visibility = useLayerVisibility();
  const preset = useCameraPreset();

  return (
    <section
      aria-labelledby="wd-layer-toggle-panel__title"
      className="wd-layer-toggle-panel"
    >
      <h2 id="wd-layer-toggle-panel__title">Layers &amp; view</h2>

      {/*
       * One checkbox per `LayerVisibility` key (driven by
       * `LAYER_ITEMS`). Each label wraps its input so the click
       * target extends over the full row (no htmlFor/id plumbing).
       * `aria-label` on the checkbox is redundant with the wrapping
       * label text but keeps axe-core happy in case a future CSS
       * change hides the label text visually.
       */}
      <div className="wd-layer-toggle-panel__checks">
        {LAYER_ITEMS.map((item) => (
          <label
            key={item.key}
            className="wd-layer-toggle-panel__check"
          >
            <input
              type="checkbox"
              checked={visibility[item.key]}
              aria-label={item.label}
              onChange={(): void => {
                // getState() at click time — same rationale as
                // UnitSwitcher (avoids a stale closure on hot reload
                // and dodges the react-hooks/exhaustive-deps lint
                // hit from destructuring `setUiStore(s => s.toggleLayer)`).
                useUiStore.getState().toggleLayer(item.key);
              }}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>

      {/*
       * Bulk actions. `role="group"` groups the two buttons as one
       * control for screen readers.
       */}
      <div
        className="wd-layer-toggle-panel__bulk"
        role="group"
        aria-label="Layer bulk actions"
      >
        <button
          type="button"
          className="wd-layer-toggle-panel__bulk-btn"
          onClick={(): void => {
            useUiStore.getState().showAllLayers();
          }}
        >
          Show all
        </button>
        <button
          type="button"
          className="wd-layer-toggle-panel__bulk-btn"
          onClick={(): void => {
            useUiStore.getState().hideAllLayers();
          }}
        >
          Hide all
        </button>
      </div>

      {/*
       * Five camera preset buttons. `aria-pressed` reflects the
       * active preset so a screen reader announces it as
       * "pressed" — the same pattern UnitSwitcher uses. Layout as
       * a horizontal `role="group"` matches the "toolbar" idiom
       * without needing `role="toolbar"` (which triggers extra
       * arrow-key expectations we don't implement in MVP).
       */}
      <div
        className="wd-layer-toggle-panel__presets"
        role="group"
        aria-label="Camera view presets"
      >
        {PRESET_ITEMS.map((item) => (
          <button
            key={item.value}
            type="button"
            className="wd-layer-toggle-panel__preset-btn"
            aria-pressed={preset === item.value}
            onClick={(): void => {
              useUiStore.getState().setCameraPreset(item.value);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
