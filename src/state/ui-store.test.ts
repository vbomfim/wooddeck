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

  it('starts with all eight layers visible (six original + S22 blocks + blocking)', () => {
    const lv = useUiStore.getState().layerVisibility;
    expect(lv).toEqual({
      environment: true,
      decking: true,
      joists: true,
      beams: true,
      posts: true,
      footings: true,
      blocks: true,
      blocking: true,
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

  it('starts with migrationEventId=0 and dismissedMigrationEventId=0 (S23 pair-fix — no event on cold boot)', () => {
    expect(useUiStore.getState().migrationEventId).toBe(0);
    expect(useUiStore.getState().dismissedMigrationEventId).toBe(0);
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
    expect(after.blocks).toBe(before.blocks);
    expect(after.blocking).toBe(before.blocking);
  });

  it('toggleLayer supports the S22 blocks + blocking keys', () => {
    // S22 (Epic 2 / FR-029) — two new layers wired to the same
    // `LayerVisibility` map. The toggle path is the same as every
    // other layer; this test proves the wiring picks up the new
    // keys without a special case.
    const before = useUiStore.getState().layerVisibility;
    act(() => {
      useUiStore.getState().toggleLayer('blocks');
    });
    const after1 = useUiStore.getState().layerVisibility;
    expect(after1.blocks).toBe(!before.blocks);
    expect(after1.blocking).toBe(before.blocking);
    act(() => {
      useUiStore.getState().toggleLayer('blocking');
    });
    const after2 = useUiStore.getState().layerVisibility;
    expect(after2.blocking).toBe(!before.blocking);
    // First toggle preserved.
    expect(after2.blocks).toBe(!before.blocks);
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

// ---------------------------------------------------------------------------
// S23 — migration EVENT counters (v1→v2 upgrade toast surface)
// ---------------------------------------------------------------------------
//
// The design store's `loadFromFile` / `loadFromLocalStorage`
// receive `{bundle, migrated}` from the application layer (S18).
// When `migrated === true` the on-disk file was a v1 envelope that
// was upgraded to v2 in-flight — the S23 UI needs to surface a
// one-time toast so the user learns the upgrade happened.
//
// ## Pair-fix discrete-event model (GPT MED #2 / Opus INFO)
//
// The pre-pair-fix design used `migrationJustHappened: boolean`.
// Zustand's default `Object.is` equality made a re-set of `true`
// while ALREADY `true` a NO-OP — so a fresh migration during a
// still-visible toast failed to restart the 8 s timer.
//
// The channel is now two monotonic counters:
//   - `migrationEventId: number`         — bumped on each migration
//   - `dismissedMigrationEventId: number` — bumped on each dismiss
// Toast is visible iff `migrationEventId > dismissedMigrationEventId`.

describe('useUiStore — migration event counters (S23 pair-fix v1→v2)', () => {
  it('starts at 0/0 on a fresh boot (no event has occurred)', () => {
    expect(useUiStore.getState().migrationEventId).toBe(0);
    expect(useUiStore.getState().dismissedMigrationEventId).toBe(0);
  });

  it('notifyMigrationHappened() bumps migrationEventId by 1 and leaves every other slice reference intact', () => {
    const before = useUiStore.getState();
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const after = useUiStore.getState();
    expect(after.migrationEventId).toBe(before.migrationEventId + 1);
    // Every other slice reference is preserved — the action must
    // NOT respray the whole state (anti-bloat guard, same
    // discipline as setUnits).
    expect(after.units).toBe(before.units);
    expect(after.cameraPreset).toBe(before.cameraPreset);
    expect(after.layerVisibility).toBe(before.layerVisibility);
    expect(after.storageBanner).toBe(before.storageBanner);
    expect(after.webglContextLost).toBe(before.webglContextLost);
    expect(after.dismissedMigrationEventId).toBe(before.dismissedMigrationEventId);
  });

  it('successive notifyMigrationHappened() calls are strictly monotonic (fresh event each time)', () => {
    // The KEY property. Two back-to-back migrations must produce
    // TWO distinguishable event ids so the MigrationToast's
    // useEffect fires twice (restarting the 8 s timer on the
    // second event).
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const first = useUiStore.getState().migrationEventId;
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const second = useUiStore.getState().migrationEventId;
    expect(second).toBeGreaterThan(first);
  });

  it('dismissMigration() sets dismissedMigrationEventId to current migrationEventId (toast hides)', () => {
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const before = useUiStore.getState();
    expect(before.migrationEventId > before.dismissedMigrationEventId).toBe(true);
    act(() => {
      useUiStore.getState().dismissMigration();
    });
    const after = useUiStore.getState();
    expect(after.dismissedMigrationEventId).toBe(after.migrationEventId);
    // The visibility predicate the toast uses is now false.
    expect(after.migrationEventId > after.dismissedMigrationEventId).toBe(false);
  });

  it('a new notifyMigrationHappened() AFTER a dismiss re-opens the toast (fresh event > dismissed)', () => {
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
      useUiStore.getState().dismissMigration();
    });
    expect(useUiStore.getState().migrationEventId).toBe(
      useUiStore.getState().dismissedMigrationEventId,
    );
    // Second migration — same-session, another v1 file loaded.
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const after = useUiStore.getState();
    expect(after.migrationEventId).toBeGreaterThan(after.dismissedMigrationEventId);
  });

  it('dismissMigration() with no outstanding event is a no-op (already-dismissed pointer stays put)', () => {
    // No prior notify — dismissed pointer stays at 0. The toast
    // predicate 0 > 0 is already false, so a stray dismiss must
    // not corrupt the counter (e.g. by decrementing).
    act(() => {
      useUiStore.getState().dismissMigration();
    });
    expect(useUiStore.getState().migrationEventId).toBe(0);
    expect(useUiStore.getState().dismissedMigrationEventId).toBe(0);
  });
});
