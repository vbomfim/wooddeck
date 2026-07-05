/**
 * `LayerTogglePanel.test.tsx` — S14 issue #15 AC1..AC3 + S26 issue #48
 * AC1..AC8 (Blocks + Blocking toggle rows).
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
 *
 *   ## S26 additions (issue #48)
 *
 *   - AC1 (S26): the panel renders EIGHT checkboxes now — the six
 *     original layers plus "Blocks" and "Blocking".
 *   - AC2 (S26): clicking "Blocks" toggles `layerVisibility.blocks`;
 *     clicking "Blocking" toggles `layerVisibility.blocking`.
 *   - AC3 (S26): layer toggles are NOT undoable — zundo is attached
 *     only to `useDesignStore`, not `useUiStore`. Verifying the
 *     current-convention alignment (ticket §17 Q1 proposal).
 *   - AC4 (S26): the two new checkboxes are keyboard-operable via
 *     Space (native `<input type=checkbox>` semantics).
 *   - AC8 (S26): the toggles ALWAYS render, even when a design has
 *     zero blocks in its layout — the UI stays consistent regardless
 *     of design mode.
 *   - Exhaustiveness (deferred from S22): every `keyof LayerVisibility`
 *     has a matching row in `LAYER_ITEMS` — guards against a future
 *     9th layer being added to the union but forgotten in the panel.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useDesignStore, resetDesignStoreForTests } from '../state/design-store';
import type { LayerVisibility } from '../state/ui-store';
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
        blocks: true,
        blocking: true,
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
          blocks: true,
          blocking: true,
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
  // was exercised, leaving other slice-mapping wires unverified.
  // `it.each` fans over EVERY LayerVisibility key so a bug that
  // mis-maps (e.g. the "Beams" checkbox writes to
  // `layerVisibility.posts`) fails a specific parameterised test.
  it.each(LAYER_ITEMS)(
    'clicking the $label checkbox flips ONLY layerVisibility.$key',
    async ({ key, label }) => {
      const user = userEvent.setup();
      render(<LayerTogglePanel />);

      // Snapshot every slice so we can assert the OTHERS are unchanged.
      const before = { ...useUiStore.getState().layerVisibility };
      await user.click(screen.getByRole('checkbox', { name: label }));
      const after = useUiStore.getState().layerVisibility;

      // The clicked slice flips.
      expect(after[key]).toBe(!before[key]);

      // Every OTHER slice stays exactly as it was.
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

// ---------------------------------------------------------------------------
// S26 issue #48 — Blocks + Blocking toggle rows
// ---------------------------------------------------------------------------

describe('<LayerTogglePanel /> — S26 blocks + blocking toggles (AC1 rendering)', () => {
  it('LAYER_ITEMS contains exactly EIGHT rows (six original + blocks + blocking)', () => {
    expect(LAYER_ITEMS).toHaveLength(8);
  });

  it('renders a "Blocks" checkbox (AC1)', () => {
    render(<LayerTogglePanel />);
    expect(screen.getByRole('checkbox', { name: 'Blocks' })).toBeInTheDocument();
  });

  it('renders a "Blocking" checkbox (AC1)', () => {
    render(<LayerTogglePanel />);
    expect(screen.getByRole('checkbox', { name: 'Blocking' })).toBeInTheDocument();
  });

  it('renders a total of eight checkboxes in the panel (AC1)', () => {
    render(<LayerTogglePanel />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
  });

  it('places blocks/blocking right after footings, in ticket-§2 order (AC1)', () => {
    // The panel iterates LAYER_ITEMS to render rows — the array
    // order IS the visual order. Ticket §2: environment → decking
    // → joists → beams → posts → footings → blocks → blocking.
    const orderedKeys = LAYER_ITEMS.map((item) => item.key);
    expect(orderedKeys).toEqual([
      'environment',
      'decking',
      'joists',
      'beams',
      'posts',
      'footings',
      'blocks',
      'blocking',
    ]);
  });
});

describe('<LayerTogglePanel /> — S26 blocks + blocking toggles (AC2 dispatch)', () => {
  it('clicking "Blocks" flips ONLY layerVisibility.blocks (true→false, AC2)', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel />);

    const before = { ...useUiStore.getState().layerVisibility };
    expect(before.blocks).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: 'Blocks' }));

    const after = useUiStore.getState().layerVisibility;
    expect(after.blocks).toBe(false);
    // Every other slice, including `blocking`, is untouched.
    for (const key of Object.keys(before) as (keyof LayerVisibility)[]) {
      if (key === 'blocks') continue;
      expect(after[key]).toBe(before[key]);
    }
  });

  it('clicking "Blocking" flips ONLY layerVisibility.blocking (true→false, AC2)', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel />);

    const before = { ...useUiStore.getState().layerVisibility };
    expect(before.blocking).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: 'Blocking' }));

    const after = useUiStore.getState().layerVisibility;
    expect(after.blocking).toBe(false);
    // Every other slice, including `blocks`, is untouched.
    for (const key of Object.keys(before) as (keyof LayerVisibility)[]) {
      if (key === 'blocking') continue;
      expect(after[key]).toBe(before[key]);
    }
  });

  it('two clicks on "Blocks" round-trips the slice (true→false→true, AC2)', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel />);
    const box = screen.getByRole('checkbox', { name: 'Blocks' });

    await user.click(box);
    expect(useUiStore.getState().layerVisibility.blocks).toBe(false);
    await user.click(box);
    expect(useUiStore.getState().layerVisibility.blocks).toBe(true);
  });
});

describe('<LayerTogglePanel /> — S26 blocks + blocking toggles (AC3 undo neutrality)', () => {
  // Ticket §17 Q1 proposal: "match current behavior (whatever it
  // is for the other 6 toggles)". Verifying: zundo is attached
  // ONLY to `useDesignStore` (see `src/state/design-store.ts:374`
  // — `temporal<DesignStoreShape, ...>` wrapper). `useUiStore` has
  // NO `.temporal` field. Therefore, layer toggles — including the
  // new blocks/blocking ones — are NOT undoable, matching the
  // existing six-toggle convention. This test locks that in so a
  // future refactor that accidentally routes ui-state through
  // zundo (or vice-versa) trips a specific assertion.

  it('useUiStore exposes NO .temporal middleware (AC3, current convention)', () => {
    expect(
      (useUiStore as unknown as { temporal?: unknown }).temporal,
    ).toBeUndefined();
  });

  it('toggling "Blocks" does NOT push a new entry onto design-store zundo history (AC3)', async () => {
    const user = userEvent.setup();
    // Reset design store so temporal history is clean.
    resetDesignStoreForTests();
    const historyBefore =
      useDesignStore.temporal.getState().pastStates.length;

    render(<LayerTogglePanel />);
    await user.click(screen.getByRole('checkbox', { name: 'Blocks' }));

    const historyAfter =
      useDesignStore.temporal.getState().pastStates.length;
    expect(historyAfter).toBe(historyBefore);
  });

  it('toggling "Blocking" does NOT push a new entry onto design-store zundo history (AC3)', async () => {
    const user = userEvent.setup();
    resetDesignStoreForTests();
    const historyBefore =
      useDesignStore.temporal.getState().pastStates.length;

    render(<LayerTogglePanel />);
    await user.click(screen.getByRole('checkbox', { name: 'Blocking' }));

    const historyAfter =
      useDesignStore.temporal.getState().pastStates.length;
    expect(historyAfter).toBe(historyBefore);
  });
});

describe('<LayerTogglePanel /> — S26 blocks + blocking toggles (AC4 keyboard)', () => {
  it('Space on a focused "Blocks" checkbox toggles the slice (AC4, native semantics)', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel />);

    const box = screen.getByRole('checkbox', { name: 'Blocks' });
    box.focus();
    expect(box).toHaveFocus();

    await user.keyboard(' ');
    expect(useUiStore.getState().layerVisibility.blocks).toBe(false);
  });

  it('Space on a focused "Blocking" checkbox toggles the slice (AC4)', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel />);

    const box = screen.getByRole('checkbox', { name: 'Blocking' });
    box.focus();
    expect(box).toHaveFocus();

    await user.keyboard(' ');
    expect(useUiStore.getState().layerVisibility.blocking).toBe(false);
  });
});

describe('<LayerTogglePanel /> — S26 blocks + blocking toggles (AC8 empty layers)', () => {
  it('renders "Blocks" and "Blocking" even for a default design with zero blocks in its layout (AC8)', () => {
    // Reset the design store to its default bundle. The MVP default
    // is a floating (post-on-footing) deck — layout has zero
    // `blocks`/`blocking` members. The toggle rows MUST still
    // render (UI stays consistent regardless of design mode).
    act(() => {
      resetDesignStoreForTests();
    });

    render(<LayerTogglePanel />);
    expect(screen.getByRole('checkbox', { name: 'Blocks' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Blocking' })).toBeInTheDocument();
  });
});

describe('<LayerTogglePanel /> — LAYER_ITEMS exhaustiveness (deferred from S22)', () => {
  it('LAYER_ITEMS covers every key of LayerVisibility (guards against a future 9th layer)', () => {
    // If a future story adds a 9th key to `LayerVisibility` but
    // forgets to add a matching row to `LAYER_ITEMS`, the panel
    // silently drops the toggle — this runtime guard catches it.
    // A companion COMPILE-TIME guard lives in
    // `layer-toggle-items.ts` (`_ITEMS_ARE_EXHAUSTIVE`).
    const uiKeys = Object.keys(
      useUiStore.getState().layerVisibility,
    ) as (keyof LayerVisibility)[];
    const itemKeys = LAYER_ITEMS.map((i) => i.key);
    expect(new Set(itemKeys)).toEqual(new Set(uiKeys));
    expect(itemKeys).toHaveLength(uiKeys.length);
  });
});
