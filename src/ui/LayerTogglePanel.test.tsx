/**
 * `LayerTogglePanel.test.tsx` — S14 issue #15 AC1..AC3.
 *
 * ## Coverage
 *
 *   - AC1: renders `<h2>Layers & view</h2>` (AppShell rightPanel
 *     landmark invariant).
 *   - AC1: renders one labelled checkbox per LayerVisibility key.
 *   - AC1: checkbox state reflects `useUiStore.layerVisibility`.
 *   - AC2: clicking a checkbox calls `toggleLayer(<name>)` (store
 *     state flips).
 *   - AC3: "Show all" and "Hide all" flip every layer at once.
 *   - AC4: five preset buttons render, with `aria-pressed` on the
 *     active preset; clicking one calls `setCameraPreset(<value>)`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { resetDesignStoreForTests } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { LayerTogglePanel } from './LayerTogglePanel';
import { LAYER_ITEMS, PRESET_ITEMS } from './layer-toggle-items';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({
      units: 'imperial',
      storageBanner: null,
      cameraPreset: 'orbit',
      layerVisibility: {
        environment: true,
        decking: true,
        joists: true,
        beams: true,
        posts: true,
        footings: true,
      },
    });
  });
});

afterEach(() => {
  cleanup();
});

describe('<LayerTogglePanel /> — heading + checkboxes (AC1)', () => {
  it('renders the "Layers & view" h2 (AppShell rightPanel landmark invariant)', () => {
    render(<LayerTogglePanel />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent(/layers.*view/i);
  });

  it('renders one checkbox per LayerVisibility key with the right initial state', () => {
    render(<LayerTogglePanel />);
    for (const item of LAYER_ITEMS) {
      const box = screen.getByRole('checkbox', { name: item.label });
      expect(box).toBeChecked();
    }
  });

  it('reflects an initially hidden layer as unchecked', () => {
    act(() => {
      useUiStore.setState({
        layerVisibility: {
          environment: true,
          decking: true,
          joists: false, // hidden
          beams: true,
          posts: true,
          footings: true,
        },
      });
    });
    render(<LayerTogglePanel />);
    expect(screen.getByRole('checkbox', { name: 'Joists' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Decking' })).toBeChecked();
  });
});

describe('<LayerTogglePanel /> — checkbox toggles (AC2)', () => {
  // S14 UAT pair-fix — FIX E. Previously only the Joists checkbox
  // was exercised, leaving five slice-mapping wires unverified.
  // `it.each` fans over ALL six LayerVisibility keys so a bug
  // that mis-maps (e.g. the "Beams" checkbox writes to
  // `layerVisibility.posts`) fails a specific parameterised test.
  it.each(LAYER_ITEMS)(
    'clicking the $label checkbox flips ONLY layerVisibility.$key',
    async ({ key, label }) => {
      const user = userEvent.setup();
      render(<LayerTogglePanel />);

      // Snapshot every slice so we can assert five are unchanged.
      const before = { ...useUiStore.getState().layerVisibility };
      await user.click(screen.getByRole('checkbox', { name: label }));
      const after = useUiStore.getState().layerVisibility;

      // The clicked slice flips.
      expect(after[key]).toBe(!before[key]);

      // The FIVE others stay exactly as they were.
      for (const other of LAYER_ITEMS) {
        if (other.key === key) continue;
        expect(after[other.key]).toBe(before[other.key]);
      }
    },
  );
});

describe('<LayerTogglePanel /> — bulk actions (AC3)', () => {
  it('"Hide all" sets every layer to false', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel />);

    await user.click(screen.getByRole('button', { name: /hide all/i }));

    for (const item of LAYER_ITEMS) {
      expect(useUiStore.getState().layerVisibility[item.key]).toBe(false);
    }
  });

  it('"Show all" sets every layer to true (after hiding first)', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel />);

    await user.click(screen.getByRole('button', { name: /hide all/i }));
    await user.click(screen.getByRole('button', { name: /show all/i }));

    for (const item of LAYER_ITEMS) {
      expect(useUiStore.getState().layerVisibility[item.key]).toBe(true);
    }
  });
});

describe('<LayerTogglePanel /> — camera presets (AC4)', () => {
  it('renders the five preset buttons in ticket order', () => {
    render(<LayerTogglePanel />);
    for (const item of PRESET_ITEMS) {
      expect(screen.getByRole('button', { name: item.label })).toBeInTheDocument();
    }
  });

  it('marks the active preset with aria-pressed=true and others with false', () => {
    act(() => {
      useUiStore.setState({ cameraPreset: 'top' });
    });
    render(<LayerTogglePanel />);
    expect(screen.getByRole('button', { name: 'Top' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Orbit' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking a preset button updates the store cameraPreset', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel />);
    await user.click(screen.getByRole('button', { name: 'Iso' }));
    expect(useUiStore.getState().cameraPreset).toBe('iso');
  });

  // S14 UAT pair-fix — FIX F. Previously only the Iso preset was
  // clicked, so a wire that maps every button to `iso` would have
  // passed. `it.each` fans over all five presets so the store
  // action-argument is asserted per-preset.
  it.each(PRESET_ITEMS)(
    'clicking the $label preset button sets cameraPreset to $value',
    async ({ value, label }) => {
      const user = userEvent.setup();
      // Start with a preset that is DIFFERENT from the one under
      // test so a broken action (e.g. a no-op) can't accidentally
      // match the "before" value.
      const seed = value === 'orbit' ? 'iso' : 'orbit';
      act(() => {
        useUiStore.setState({ cameraPreset: seed });
      });
      render(<LayerTogglePanel />);
      await user.click(screen.getByRole('button', { name: label }));
      expect(useUiStore.getState().cameraPreset).toBe(value);
    },
  );
});
