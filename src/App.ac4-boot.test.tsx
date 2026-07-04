/**
 * `App.ac4-boot.test.tsx` — S12 pair-fix iter 1 Fix H
 * (Opus#8 + QA gap).
 *
 * ## Why this file exists (integration test, not unit)
 *
 * AC4 promises: "when a saved design cannot be recomputed on boot,
 * the app surfaces a `load-recompute-failed` banner with a 'Reset
 * to default' button that clears the banner + swaps in a fresh
 * default bundle."
 *
 * The previous test coverage was PIECEWISE:
 *   - `design-store.test` proved `loadFromLocalStorage()` sets the
 *     banner on a LayoutError.
 *   - `StorageBanner.test` proved the banner renders the right
 *     copy + a working reset button for each discriminator.
 *   - `App.test.tsx` proved the boot calls `loadFromLocalStorage`.
 *
 * NONE of them proved the FULL CHAIN: seed bad storage → boot →
 * see banner → click reset → banner disappears + fresh design.
 * This test locks that chain end-to-end. Regressions to any link
 * (autosave-key mismatch, missing reset wiring, banner not
 * clearing on reset) surface here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { serialize } from './persistence/deck-file/schema-v1';
import { STORAGE_KEY } from './persistence/local-storage';
import { FIXTURE_DESIGNS } from './domain/layout/__fixtures__/fixtures-data';
import { resetDesignStoreForTests, useDesignStore } from './state/design-store';
import { useUiStore } from './state/ui-store';

beforeEach(() => {
  window.localStorage.clear();
  act(() => {
    useUiStore.setState({ storageBanner: null });
  });
  resetDesignStoreForTests();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('<App /> — AC4 boot end-to-end (Fix H — Opus#8 + QA gap)', () => {
  it('seed bad design → boot → banner appears → click Reset → banner clears + fresh default', async () => {
    // ─── Arrange ───
    // Take a proven-valid fixture, then MUTATE the footprint to
    // widthMm=0 — passes schema validation (0 is a valid FIELD
    // value), fails layout recomputation (below MIN_DECK_DIMENSION_MM
    // = 4 ft). See apply-parameters.test.ts "propagates LayoutError
    // when the merged design has widthMm below the min".
    const validFixture = FIXTURE_DESIGNS[2]!.design;
    const badDesign = {
      ...validFixture,
      footprint: { ...validFixture.footprint, widthMm: 0 },
    };
    const payload = serialize(badDesign);
    window.localStorage.setItem(STORAGE_KEY, payload);

    // Import App AFTER seeding so no boot side-effect runs before
    // the storage is populated. (Vitest caches modules; a top-of-
    // file import would evaluate App's module before beforeEach
    // could seed. Dynamic import keeps the boot sequence in test-
    // controlled order.)
    const { App } = await import('./App');

    // ─── Act (boot) ───
    render(<App />);

    // ─── Assert (banner appears with the right copy + reset button) ───
    const banner = await screen.findByText(
      /couldn['’]t reopen your saved design — starting from a default/i,
    );
    expect(banner).toBeInTheDocument();
    // Disambiguate: the StorageBanner button reads "Reset to default"
    // (singular); the S14 ExportMenu adds a "Reset to defaults"
    // (plural) button in the rightPanel. Anchor to the exact
    // singular form so both are visible without conflict.
    const resetButton = screen.getByRole('button', { name: 'Reset to default' });
    expect(resetButton).toBeInTheDocument();

    // The design store also flipped to status='error' with a
    // LayoutError — assert that leaked into the observable state.
    expect(useDesignStore.getState().status).toBe('error');
    expect(useDesignStore.getState().lastError).not.toBeNull();

    // ─── Act (user clicks Reset) ───
    const user = userEvent.setup();
    await user.click(resetButton);

    // ─── Assert (banner cleared, design store reset to defaults) ───
    expect(
      screen.queryByText(
        /couldn['’]t reopen your saved design — starting from a default/i,
      ),
    ).not.toBeInTheDocument();
    // Reset also nulls the storageBanner in the ui store.
    expect(useUiStore.getState().storageBanner).toBeNull();
    // A fresh default bundle has status='idle' + no lastError.
    expect(useDesignStore.getState().status).toBe('idle');
    expect(useDesignStore.getState().lastError).toBeNull();
    // Sanity: the fresh default has a valid footprint (not
    // widthMm=0). Any non-zero value is fine — the specific
    // default is a domain concern, not this integration test's.
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBeGreaterThan(0);
  });
});
