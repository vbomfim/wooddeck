/**
 * Barrel-surface test — ensures the frozen public API of
 * `src/state/index.ts` remains stable.
 *
 * Downstream layers (`src/scene/**` — S9–S11, `src/ui/**` — S12–S15)
 * import from THIS barrel; removing or renaming an export here is
 * a breaking change that requires a version bump on the state
 * package. The test enumerates every advertised symbol so a
 * rename ships red.
 */
import { describe, expect, it } from 'vitest';

import * as StateBarrel from './index';

describe('src/state/index.ts — frozen public surface', () => {
  it('exports the two Zustand stores', () => {
    expect(typeof StateBarrel.useDesignStore).toBe('function');
    expect(typeof StateBarrel.useUiStore).toBe('function');
  });

  it('exports the granular selector hooks', () => {
    // Every hook is a `function`. Missing / renamed export → TS
    // would fail to compile the destructure, then this typeof
    // check would fail even if the compile somehow passed.
    expect(typeof StateBarrel.useDesign).toBe('function');
    expect(typeof StateBarrel.useLayout).toBe('function');
    expect(typeof StateBarrel.useLayoutBounds).toBe('function');
    expect(typeof StateBarrel.useWarnings).toBe('function');
    expect(typeof StateBarrel.useDesignStatus).toBe('function');
    expect(typeof StateBarrel.useUiUnits).toBe('function');
    expect(typeof StateBarrel.useCameraPreset).toBe('function');
    expect(typeof StateBarrel.useLayerVisibility).toBe('function');
    expect(typeof StateBarrel.useStorageBanner).toBe('function');
  });

  it('exports the default-design factory + params', () => {
    expect(typeof StateBarrel.makeDefaultDesign).toBe('function');
    expect(StateBarrel.DEFAULT_DESIGN_PARAMS).toBeTypeOf('object');
    expect(Object.isFrozen(StateBarrel.DEFAULT_DESIGN_PARAMS)).toBe(true);
  });

  it('exports the AUTOSAVE_DEBOUNCE_MS constant', () => {
    expect(StateBarrel.AUTOSAVE_DEBOUNCE_MS).toBe(500);
  });

  it('does NOT re-export the test-only helpers', () => {
    // resetDesignStoreForTests and flushAutosaveForTests live in
    // design-store but are intentionally excluded from the barrel.
    // If they slip in, a component might reach for them and the
    // test surface would leak.
    expect('resetDesignStoreForTests' in StateBarrel).toBe(false);
    expect('flushAutosaveForTests' in StateBarrel).toBe(false);
  });
});
