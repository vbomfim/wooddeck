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
 * The six MVP layer keys with wired UI toggles — plus their
 * user-facing labels. Order matches the ticket §2 field listing
 * (environment → decking → framing → footings). Extracted as a
 * module constant so tests can walk the list without duplicating
 * the copy.
 *
 * ## S22 note — `blocks` + `blocking` NOT included yet
 *
 * S22 (Epic 2 / FR-029) added `blocks` and `blocking` to the
 * `LayerVisibility` union and wired their VISIBILITY at the scene
 * layer, but their toggle CHECKBOXES land in S26 (LayerTogglePanel
 * UI). Once S26 lands, add two more rows here — the panel iterates
 * `LAYER_ITEMS` to render one row per key.
 */
export const LAYER_ITEMS: readonly {
  key: keyof LayerVisibility;
  label: string;
}[] = [
  { key: 'environment', label: 'Environment' },
  { key: 'decking', label: 'Decking' },
  { key: 'joists', label: 'Joists' },
  { key: 'beams', label: 'Beams' },
  { key: 'posts', label: 'Posts' },
  { key: 'footings', label: 'Footings' },
];

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
