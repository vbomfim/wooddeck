/**
 * Unit tests for `src/state/hooks.ts`.
 *
 * Every hook is a one-liner arrow over a store selector, so the
 * tests are simple:
 *
 *   1. Return the current slice on first render.
 *   2. Re-render on the tracked slice changing.
 *   3. Do NOT re-render on an untracked slice changing (the
 *      "granularity" claim in NFR §9).
 *
 * The design store's `useDesignStatus` returns a fresh `{status,
 * lastError}` object per render — that's tested by simply asserting
 * the destructured values, not object identity.
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). `renderHook` from
 * `@testing-library/react` sets up a minimal React root; `act`
 * wraps the store mutations so the useSyncExternalStore adapter
 * flushes before assertions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  useCameraPreset,
  useDesign,
  useDesignStatus,
  useLayerVisibility,
  useLayout,
  useLayoutBounds,
  useStorageBanner,
  useUiUnits,
  useWarnings,
} from './hooks';
import { resetDesignStoreForTests, useDesignStore } from './design-store';
import { useUiStore } from './ui-store';

const FIXED_ID = '00000000-0000-4000-8000-0000000abcde';
const FIXED_CREATED_AT = '2026-07-03T10:00:00.000Z';

const UI_INITIAL_STATE = useUiStore.getInitialState();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(FIXED_CREATED_AT));
  localStorage.clear();
  resetDesignStoreForTests({ id: FIXED_ID, createdAt: FIXED_CREATED_AT });
  useUiStore.setState(UI_INITIAL_STATE, true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- design-store hooks ----------------------------------------------------

describe('useDesign()', () => {
  it('returns the current design and tracks bundle mutations', () => {
    const { result } = renderHook(() => useDesign());
    expect(result.current.id).toBe(FIXED_ID);
    act(() => {
      useDesignStore.getState().applyParameters({
        footprint: { widthMm: 4000 },
      });
    });
    expect(result.current.footprint.widthMm).toBe(4000);
  });
});

describe('useLayout()', () => {
  it('returns the computed layout, updating when bundle mutates', () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current.designId).toBe(FIXED_ID);
    act(() => {
      useDesignStore.getState().applyParameters({
        footprint: { widthMm: 4100 },
      });
    });
    // designId is stable across parameter mutations (same design id).
    expect(result.current.designId).toBe(FIXED_ID);
    // But the bounds now reflect the widened footprint.
    expect(result.current.bounds.widthMm).toBe(4100);
  });
});

// PR#29 pair-fix iter 1 — Fix G. DeckScene needs a granular hook
// that reads ONLY the layout.bounds slice — not the whole layout —
// so a warnings-only mutation (which recomputes the layout object
// but leaves bounds numerically unchanged) does NOT re-render the
// scene shell. Zustand's default equality is referential; the
// design store writes a NEW bundle on every mutation, so we rely on
// the store using stable references for the bounds slice OR the
// consumer opting into shallow equality. This hook simply reads the
// slice and the S9 CameraRig useMemo does the numeric-value dep
// pinning downstream (Fix F).
describe('useLayoutBounds()', () => {
  it('returns the current bounds object with the initial-design dimensions', () => {
    const { result } = renderHook(() => useLayoutBounds());
    expect(result.current).toBeDefined();
    expect(typeof result.current.widthMm).toBe('number');
    expect(typeof result.current.lengthMm).toBe('number');
    expect(typeof result.current.heightMm).toBe('number');
  });

  it('re-renders when the footprint changes (bounds slice update)', () => {
    const { result } = renderHook(() => useLayoutBounds());
    const initialWidth = result.current.widthMm;
    act(() => {
      useDesignStore.getState().applyParameters({
        footprint: { widthMm: initialWidth + 500 },
      });
    });
    expect(result.current.widthMm).toBe(initialWidth + 500);
  });

  it('DOES NOT re-render when only ui-store mutates (cross-store granularity)', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useLayoutBounds();
    });
    const baseline = renderCount;
    expect(result.current).toBeDefined();
    act(() => {
      useUiStore.getState().setCameraPreset('top');
      useUiStore.getState().setUnits('metric');
    });
    expect(renderCount).toBe(baseline);
  });
});

describe('useWarnings()', () => {
  it('returns the current warnings array', () => {
    const { result } = renderHook(() => useWarnings());
    expect(Array.isArray(result.current)).toBe(true);
  });
});

describe('useDesignStatus()', () => {
  it('returns {status, lastError}', () => {
    const { result } = renderHook(() => useDesignStatus());
    expect(result.current.status).toBe('idle');
    expect(result.current.lastError).toBeNull();
  });
});

// ---- ui-store hooks --------------------------------------------------------

describe('useUiUnits()', () => {
  it('returns the current unit preference', () => {
    const { result } = renderHook(() => useUiUnits());
    expect(result.current).toBe('imperial');
    act(() => {
      useUiStore.getState().setUnits('metric');
    });
    expect(result.current).toBe('metric');
  });
});

describe('useCameraPreset()', () => {
  it('returns the current camera preset', () => {
    const { result } = renderHook(() => useCameraPreset());
    expect(result.current).toBe('orbit');
    act(() => {
      useUiStore.getState().setCameraPreset('top');
    });
    expect(result.current).toBe('top');
  });
});

describe('useLayerVisibility()', () => {
  it('returns the current visibility map', () => {
    const { result } = renderHook(() => useLayerVisibility());
    expect(result.current.joists).toBe(true);
    act(() => {
      useUiStore.getState().toggleLayer('joists');
    });
    expect(result.current.joists).toBe(false);
  });
});

describe('useStorageBanner()', () => {
  it('returns null when there is no active banner', () => {
    const { result } = renderHook(() => useStorageBanner());
    expect(result.current).toBeNull();
  });

  it.each(['storage-full', 'storage-blocked', 'load-recompute-failed'] as const)(
    'returns the current banner code (%s)',
    (code) => {
      const { result } = renderHook(() => useStorageBanner());
      act(() => {
        useUiStore.getState().setStorageBanner(code);
      });
      expect(result.current).toBe(code);
    },
  );
});

// ---- granularity: hook A does NOT re-render on hook B's slice change -----

describe('granularity — cross-store isolation', () => {
  it('useDesign does NOT re-render when ui-store setUnits changes', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useDesign();
    });
    const baseline = renderCount;
    expect(result.current.id).toBe(FIXED_ID);

    // Change the ui-store — a granular selector on the design store
    // should ignore this entirely.
    act(() => {
      useUiStore.getState().setUnits('metric');
      useUiStore.getState().setCameraPreset('top');
      useUiStore.getState().toggleLayer('joists');
    });

    expect(renderCount).toBe(baseline);
  });

  it('useUiUnits does NOT re-render when design bundle mutates', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useUiUnits();
    });
    const baseline = renderCount;
    expect(result.current).toBe('imperial');

    act(() => {
      useDesignStore.getState().applyParameters({
        footprint: { widthMm: 4000 },
      });
    });

    expect(renderCount).toBe(baseline);
  });
});
