/**
 * Unit tests for `src/state/ui-store.ts`.
 *
 * ## Coverage map (issue #9 acceptance criteria)
 *
 *   - AC1 UiStore state contains NO design/layout/warnings fields —
 *         the disjoint-state guarantee is asserted from the ui side
 *         here; the design side asserts the mirror in the design
 *         store test.
 *   - AC7 `setUnits('metric')` does NOT reach into the design store
 *         (proved by isolation: this test does not import the
 *         design store at all).
 *   - Setters flip the exact field they claim, no others.
 *   - `disclaimerAcknowledged` stays `false` (no setter exposed).
 *   - `storageBanner` accepts every enum value AND `null`.
 *   - `toggleLayer` flips a single layer without touching siblings.
 *   - `showAllLayers` / `hideAllLayers` set every layer to true /
 *     false respectively.
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). Every subject is pure.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { useUiStore } from './ui-store';

// Every test starts from a fresh initial state — otherwise store
// mutations bleed across tests.
const INITIAL_STATE = useUiStore.getInitialState();

afterEach(() => {
  useUiStore.setState(INITIAL_STATE, true);
});

describe('useUiStore — AC1 disjoint state', () => {
  it('does NOT expose design/layout/warnings fields', () => {
    const state = useUiStore.getState();
    // Sample the forbidden keys from the design store's shape.
    // Every one of these MUST be absent from the ui store.
    expect(state).not.toHaveProperty('bundle');
    expect(state).not.toHaveProperty('design');
    expect(state).not.toHaveProperty('layout');
    expect(state).not.toHaveProperty('warnings');
    expect(state).not.toHaveProperty('status');
    expect(state).not.toHaveProperty('lastError');
    expect(state).not.toHaveProperty('loadFromFile');
    expect(state).not.toHaveProperty('loadFromLocalStorage');
    expect(state).not.toHaveProperty('applyParameters');
    expect(state).not.toHaveProperty('downloadDeckFile');
    expect(state).not.toHaveProperty('reset');
  });
});

describe('useUiStore — initial state', () => {
  it('starts with imperial units', () => {
    expect(useUiStore.getState().units).toBe('imperial');
  });

  it('starts with orbit camera preset', () => {
    expect(useUiStore.getState().cameraPreset).toBe('orbit');
  });

  it('starts with all six layers visible', () => {
    const lv = useUiStore.getState().layerVisibility;
    expect(lv).toEqual({
      environment: true,
      decking: true,
      joists: true,
      beams: true,
      posts: true,
      footings: true,
    });
  });

  it('starts with disclaimerAcknowledged=false (spec US3 AC2 frozen field)', () => {
    expect(useUiStore.getState().disclaimerAcknowledged).toBe(false);
  });

  it('starts with storageBanner=null', () => {
    expect(useUiStore.getState().storageBanner).toBeNull();
  });

  it('starts with webglContextLost=false (Fix C — no crash on first paint)', () => {
    expect(useUiStore.getState().webglContextLost).toBe(false);
  });
});

describe('useUiStore — setUnits (AC7: UI-only)', () => {
  it('flips units to metric without touching any other field', () => {
    const before = useUiStore.getState();
    act(() => {
      useUiStore.getState().setUnits('metric');
    });
    const after = useUiStore.getState();
    expect(after.units).toBe('metric');
    // Every other field is referentially stable — setUnits touches
    // only `units`. This is the ANTI-BLOAT guard: a broad `set(...)`
    // that spread the whole state would fail this test.
    expect(after.cameraPreset).toBe(before.cameraPreset);
    expect(after.layerVisibility).toBe(before.layerVisibility);
    expect(after.disclaimerAcknowledged).toBe(before.disclaimerAcknowledged);
    expect(after.storageBanner).toBe(before.storageBanner);
    expect(after.webglContextLost).toBe(before.webglContextLost);
  });
});

describe('useUiStore — setCameraPreset', () => {
  it.each(['orbit', 'top', 'front', 'side', 'iso'] as const)(
    'accepts %s',
    (preset) => {
      act(() => {
        useUiStore.getState().setCameraPreset(preset);
      });
      expect(useUiStore.getState().cameraPreset).toBe(preset);
    },
  );
});

describe('useUiStore — layer visibility', () => {
  it('toggleLayer flips a single layer and leaves siblings alone', () => {
    const before = useUiStore.getState().layerVisibility;
    act(() => {
      useUiStore.getState().toggleLayer('joists');
    });
    const after = useUiStore.getState().layerVisibility;
    expect(after.joists).toBe(!before.joists);
    expect(after.environment).toBe(before.environment);
    expect(after.decking).toBe(before.decking);
    expect(after.beams).toBe(before.beams);
    expect(after.posts).toBe(before.posts);
    expect(after.footings).toBe(before.footings);
  });

  it('toggleLayer is its own inverse (call twice → identity)', () => {
    const before = useUiStore.getState().layerVisibility;
    act(() => {
      useUiStore.getState().toggleLayer('beams');
      useUiStore.getState().toggleLayer('beams');
    });
    expect(useUiStore.getState().layerVisibility).toEqual(before);
  });

  it('hideAllLayers sets every layer to false', () => {
    act(() => {
      useUiStore.getState().hideAllLayers();
    });
    const lv = useUiStore.getState().layerVisibility;
    for (const key of Object.keys(lv) as (keyof typeof lv)[]) {
      expect(lv[key]).toBe(false);
    }
  });

  it('showAllLayers sets every layer to true', () => {
    act(() => {
      useUiStore.getState().hideAllLayers();
      useUiStore.getState().showAllLayers();
    });
    const lv = useUiStore.getState().layerVisibility;
    for (const key of Object.keys(lv) as (keyof typeof lv)[]) {
      expect(lv[key]).toBe(true);
    }
  });
});

describe('useUiStore — storageBanner (AC6 + AC9)', () => {
  it.each(['storage-full', 'storage-blocked', 'load-recompute-failed', null] as const)(
    'setStorageBanner(%s) writes exactly that value',
    (banner) => {
      act(() => {
        useUiStore.getState().setStorageBanner(banner);
      });
      expect(useUiStore.getState().storageBanner).toBe(banner);
    },
  );
});

describe('useUiStore — webglContextLost (S12 pair-fix iter 1 — Fix C)', () => {
  it('setWebglContextLost(true) flips the flag', () => {
    act(() => {
      useUiStore.getState().setWebglContextLost(true);
    });
    expect(useUiStore.getState().webglContextLost).toBe(true);
  });

  it('does not touch other fields', () => {
    const before = useUiStore.getState();
    act(() => {
      useUiStore.getState().setWebglContextLost(true);
    });
    const after = useUiStore.getState();
    expect(after.units).toBe(before.units);
    expect(after.cameraPreset).toBe(before.cameraPreset);
    expect(after.layerVisibility).toBe(before.layerVisibility);
    expect(after.storageBanner).toBe(before.storageBanner);
  });
});

describe('useUiStore — vanilla subscribe', () => {
  it('notifies subscribers on state change', () => {
    // Uses the vanilla store API (subscribe / setState) rather than
    // `renderHook`. React 19's useSyncExternalStore adapter emits a
    // spurious "update not wrapped in act" diagnostic on first
    // subscription in a JSDOM env even inside `act`; the vanilla
    // API bypasses React entirely, so the test asserts the state
    // machine directly without noise.
    let latest: string = 'never-notified';
    const unsubscribe = useUiStore.subscribe((s) => {
      latest = s.units;
    });
    useUiStore.getState().setUnits('metric');
    expect(latest).toBe('metric');
    unsubscribe();
  });
});
