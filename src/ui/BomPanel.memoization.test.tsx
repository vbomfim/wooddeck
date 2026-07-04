/**
 * `BomPanel.memoization.test.tsx` — S14 UAT pair-fix FIX J.5.
 *
 * Split from `BomPanel.test.tsx` because it requires `vi.mock`
 * of the `./bom/derive-bom` module to spy on the pure function.
 * A `vi.mock` in the main test file would poison every other
 * test in the same module.
 *
 * ## What this covers
 *
 * The BomPanel wraps its derivation in `useMemo(() =>
 * deriveBom(layout), [layout])`. That memoization is critical:
 *
 *   - Unit switches (AC7) mutate `useUiStore.units` — a boring
 *     re-render should NOT recompute the BOM.
 *   - Camera preset changes, layer toggles, warnings updates:
 *     none of them touch `layout`; none should trigger deriveBom.
 *
 * The prior BomPanel tests asserted the RENDERED STRUCTURE didn't
 * change on unit switch, but that was consistent with either
 * outcome (memoized OR recomputed → same rows either way, since
 * the layout is unchanged). This spy CATCHES the missed
 * memoization: if useMemo drops the [layout] dep or a future
 * refactor accidentally re-derives on every render, the spy
 * call-count regresses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// Wrap the real function with a spy so BomPanel still gets a
// correct BomLine[] AND we can count how many times it was
// called. `vi.hoisted` is not needed here — `vi.mock` factory
// runs before the import.
vi.mock('./bom/derive-bom', async () => {
  const actual = await vi.importActual<typeof import('./bom/derive-bom')>(
    './bom/derive-bom',
  );
  return {
    ...actual,
    deriveBom: vi.fn(actual.deriveBom),
  };
});

// Import AFTER vi.mock so the mock takes effect.
import { BomPanel } from './BomPanel';
import { deriveBom as mockedDeriveBom } from './bom/derive-bom';
import { resetDesignStoreForTests } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
  vi.mocked(mockedDeriveBom).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('<BomPanel /> — deriveBom memoization (FIX J.5)', () => {
  it('flipping units does NOT re-invoke deriveBom (layout ref unchanged)', () => {
    const { rerender } = render(<BomPanel />);
    // First render calls deriveBom at least once (may double
    // under StrictMode; either way it stabilises here).
    const callsAfterFirstRender = vi.mocked(mockedDeriveBom).mock.calls.length;
    expect(callsAfterFirstRender).toBeGreaterThan(0);

    // Flip units → useUiStore.units changes → BomPanel
    // re-renders (it subscribes to useUiUnits). But the layout
    // reference is unchanged, so useMemo([layout]) reuses the
    // cached rows and deriveBom is NOT called again.
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    rerender(<BomPanel />);

    const callsAfterUnitSwitch = vi.mocked(mockedDeriveBom).mock.calls.length;
    expect(callsAfterUnitSwitch).toBe(callsAfterFirstRender);
  });

  it('changing camera preset does NOT re-invoke deriveBom', () => {
    render(<BomPanel />);
    const before = vi.mocked(mockedDeriveBom).mock.calls.length;

    act(() => {
      useUiStore.setState({ cameraPreset: 'top' });
    });

    // Camera preset isn't even read by BomPanel — no re-render
    // occurs, so deriveBom certainly isn't recalled. Belt-and-
    // suspenders assertion for the memoization contract.
    expect(vi.mocked(mockedDeriveBom).mock.calls.length).toBe(before);
  });
});
