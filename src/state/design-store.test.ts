/**
 * Unit tests for `src/state/design-store.ts`.
 *
 * ## Coverage map (issue #9 acceptance criteria)
 *
 *   - AC1  Two disjoint stores — design store contains ONLY
 *          design + derived data + status; NO camera/layer/unit
 *          fields. (The mirror assertion lives in
 *          `ui-store.test.ts`.)
 *   - AC2  zundo middleware attached — `.temporal.getState()`
 *          exposes `undo`, `redo`, `clear`, `pastStates`. Three
 *          `applyParameters` calls put ≥ 3 entries in
 *          `pastStates`; `undo()` reverts to previous design.
 *   - AC3  Autosave debounced — 5 `applyParameters` calls within
 *          100 ms produce ≤ 1 `saveDesignToLocalStorage` invocation
 *          within 500 ms after the last. Uses `vi.useFakeTimers`
 *          so the 500 ms is deterministic.
 *   - AC4  `downloadDeckFile()` serializes ONLY `design` — no
 *          camera/layer/unit fields. Verified by spying on the
 *          persistence-layer `downloadDeckFile` shim and asserting
 *          the arg is a raw `DeckDesign`, not an envelope wrapping
 *          UI state.
 *   - AC5  `loadFromFile(file)` replaces the bundle with the
 *          file's design plus its recomputed layout/warnings.
 *   - AC6  Save fails with `code: "storage-full"` → uiStore
 *          `storageBanner === 'storage-full'`.
 *   - AC8  Fresh app load, no localStorage → `bundle.design`
 *          matches the default from `makeDefaultDesign`.
 *   - AC9  Stored design that recomputes to `LayoutError` on load
 *          → catch, seed default, set `status: 'error'` +
 *          `lastError`, ui-store banner set. No throw at mount.
 *
 * ## Edge cases
 *
 *   - Invalid JSON in localStorage (persistence returns null) →
 *     seed default.
 *   - Undo across a file-load boundary → temporal history cleared
 *     on `loadFromFile` (issue #9 §4 Edge cases).
 *   - `applyParameters` with a bad patch (unknown key /
 *     `ApplyParametersError`) → `status: 'error'`, previous
 *     bundle intact.
 *   - `LayoutError` from `applyParameters` (dimension below
 *     min-4-ft) → same graceful handling — no throw, previous
 *     bundle intact.
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). Every test resets the
 * store (`resetDesignStoreForTests`) and localStorage in `beforeEach`
 * so state does not bleed. Autosave uses fake timers by default;
 * tests that need real time-of-day sit `vi.useRealTimers()` in an
 * `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutError } from '../domain/layout';
import type { DeckDesign } from '../domain/model';
import { STORAGE_KEY, DeckFileError, serialize } from '../persistence';
import type { DeepPartial } from '../application';

import {
  useDesignStore,
  resetDesignStoreForTests,
  flushAutosaveForTests,
  AUTOSAVE_DEBOUNCE_MS,
} from './design-store';
import { useUiStore } from './ui-store';
import { makeDefaultDesign, DEFAULT_DESIGN_PARAMS } from './default-design';

const FIXED_ID = '00000000-0000-4000-8000-000000000abc';
const FIXED_CREATED_AT = '2026-07-03T10:00:00.000Z';

const UI_INITIAL_STATE = useUiStore.getInitialState();

beforeEach(() => {
  // Deterministic clock so `makeDefaultDesign`'s injected
  // `createdAt` is byte-stable.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(FIXED_CREATED_AT));

  // Wipe localStorage so autosave from previous tests can't leak in.
  localStorage.clear();

  // Reset both stores. The reset helper below is exported from
  // `design-store.ts` (test-only surface) — it re-seeds a default
  // bundle and clears zundo history + pending autosave in one call.
  resetDesignStoreForTests({ id: FIXED_ID, createdAt: FIXED_CREATED_AT });
  useUiStore.setState(UI_INITIAL_STATE, true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC1 — disjoint stores
// ---------------------------------------------------------------------------

describe('useDesignStore — AC1 disjoint state', () => {
  it('does NOT expose camera/layer/unit fields', () => {
    const state = useDesignStore.getState();
    // These fields live on ui-store — a leak here would be a
    // two-store discipline violation.
    expect(state).not.toHaveProperty('units');
    expect(state).not.toHaveProperty('cameraPreset');
    expect(state).not.toHaveProperty('layerVisibility');
    expect(state).not.toHaveProperty('storageBanner');
    expect(state).not.toHaveProperty('disclaimerAcknowledged');
  });

  it('exposes bundle / status / lastError + the five actions', () => {
    const state = useDesignStore.getState();
    expect(state).toHaveProperty('bundle');
    expect(state).toHaveProperty('status');
    expect(state).toHaveProperty('lastError');
    expect(typeof state.loadFromFile).toBe('function');
    expect(typeof state.loadFromLocalStorage).toBe('function');
    expect(typeof state.applyParameters).toBe('function');
    expect(typeof state.downloadDeckFile).toBe('function');
    expect(typeof state.reset).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC8 — initial state = default design
// ---------------------------------------------------------------------------

describe('useDesignStore — AC8 initial state', () => {
  it('bundle.design matches makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT)', () => {
    const design = useDesignStore.getState().bundle.design;
    const expected = makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT);
    // Compare the SHAPE — a full deep-equal on `design` implies
    // every field is the default, including footprint dimensions
    // and material references.
    expect(design).toEqual(expected);
  });

  it('bundle.layout is computed (non-empty members) and bundle.warnings is an array', () => {
    const bundle = useDesignStore.getState().bundle;
    expect(bundle.layout.members.length).toBeGreaterThan(0);
    expect(Array.isArray(bundle.warnings)).toBe(true);
  });

  it('status is "idle" and lastError is null', () => {
    const { status, lastError } = useDesignStore.getState();
    expect(status).toBe('idle');
    expect(lastError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC2 — zundo temporal middleware
// ---------------------------------------------------------------------------

describe('useDesignStore — AC2 zundo undo/redo scaffold', () => {
  it('exposes `.temporal.getState().undo / redo / clear` as functions', () => {
    const t = useDesignStore.temporal.getState();
    expect(typeof t.undo).toBe('function');
    expect(typeof t.redo).toBe('function');
    expect(typeof t.clear).toBe('function');
    expect(Array.isArray(t.pastStates)).toBe(true);
    expect(Array.isArray(t.futureStates)).toBe(true);
  });

  it('three applyParameters mutations put at least 3 entries in pastStates', () => {
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_DESIGN_PARAMS.widthFt * 304.8 + 100 },
    });
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_DESIGN_PARAMS.widthFt * 304.8 + 200 },
    });
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_DESIGN_PARAMS.widthFt * 304.8 + 300 },
    });
    const { pastStates } = useDesignStore.temporal.getState();
    expect(pastStates.length).toBeGreaterThanOrEqual(3);
  });

  it('undo() reverts to the previous design', () => {
    const beforeWidth = useDesignStore.getState().bundle.design.footprint.widthMm;
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: beforeWidth + 500 },
    });
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(beforeWidth + 500);
    useDesignStore.temporal.getState().undo();
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(beforeWidth);
  });

  it('tracks only bundle (partialize) — status/lastError transitions do NOT hit pastStates', () => {
    // Seed some history so pastStates count is > 0.
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: 4000 },
    });
    const historyLenBefore = useDesignStore.temporal.getState().pastStates.length;

    // A `set({status:'error', lastError:new Error()})` write MUST
    // NOT bump `pastStates` — the partialize hook restricts zundo to
    // the bundle field. Calling `setState` directly is a whitebox
    // probe: no public action writes status/lastError without also
    // writing bundle, but the partialize guard is worth asserting.
    useDesignStore.setState({ status: 'error', lastError: new Error('probe') });
    const historyLenAfter = useDesignStore.temporal.getState().pastStates.length;
    expect(historyLenAfter).toBe(historyLenBefore);
  });
});

// ---------------------------------------------------------------------------
// AC3 — autosave debounced (500 ms)
// ---------------------------------------------------------------------------

describe('useDesignStore — AC3 autosave debounced', () => {
  it(`5 applyParameters within 100 ms → 1 setItem within ${String(AUTOSAVE_DEBOUNCE_MS)} ms after last`, () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    // Start from a known baseline (no autosave from beforeEach's
    // resetDesignStoreForTests — the reset helper CLEARS the
    // pending autosave rather than firing it).
    expect(setItemSpy).not.toHaveBeenCalled();

    for (let i = 0; i < 5; i += 1) {
      useDesignStore.getState().applyParameters({
        footprint: { widthMm: 4000 + i * 10 },
      });
      // 20 ms between calls — total 80 ms elapsed after the loop.
      vi.advanceTimersByTime(20);
    }
    // Immediately after the burst — debounce timer not yet expired.
    expect(setItemSpy).not.toHaveBeenCalled();

    // Advance past the debounce window. Exactly ONE write should
    // land — the persistence layer's autosave slot.
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(setItemSpy.mock.calls[0]?.[0]).toBe(STORAGE_KEY);
  });

  it('autosave fires after reset()', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    useDesignStore.getState().reset();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  it('flushAutosaveForTests() forces the pending debounce to fire immediately', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: 4200 },
    });
    // Without flush, nothing happens yet.
    expect(setItemSpy).not.toHaveBeenCalled();
    flushAutosaveForTests();
    // Flush runs the pending save synchronously.
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC4 — downloadDeckFile serializes only design
// ---------------------------------------------------------------------------

describe('useDesignStore — AC4 downloadDeckFile omits UI state', () => {
  it('calls persistence.downloadDeckFile with a raw DeckDesign (no camera/layer/units)', async () => {
    // We can't easily spy on the internal persistence function
    // reference across module boundaries — instead we intercept the
    // Blob content by stubbing URL.createObjectURL and grabbing the
    // Blob's text. This is the same technique the persistence
    // layer's own tests use in `file-io.test.ts`.
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((obj: Blob | MediaSource) => `blob:mock-${String((obj as Blob).size)}`);
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    // Also stub HTMLAnchorElement.click so no real navigation
    // happens in jsdom.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    let capturedText = '';
    // The Blob text is set BEFORE URL.createObjectURL is called;
    // capture it inside the spy so we can inspect the payload later.
    createSpy.mockImplementation((obj: Blob | MediaSource) => {
      // Blob.text() is async — capture asynchronously and await
      // via Promise.resolve() in the caller below.
      const blob = obj as Blob;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      blob.text().then((t) => {
        capturedText = t;
      });
      return 'blob:mock';
    });

    useDesignStore.getState().downloadDeckFile();

    // Yield the microtask queue so the Blob.text() promise resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(capturedText) as unknown;
    expect(parsed).toBeTypeOf('object');
    const envelope = parsed as Record<string, unknown>;
    // The v1 envelope carries `schema`, `generator`, `generatorVersion`,
    // `createdAt`, `design`. NO ui-store fields should appear.
    expect(envelope).toHaveProperty('schema');
    expect(envelope).toHaveProperty('design');
    expect(envelope).not.toHaveProperty('units');
    expect(envelope).not.toHaveProperty('cameraPreset');
    expect(envelope).not.toHaveProperty('layerVisibility');
    expect(envelope).not.toHaveProperty('storageBanner');
    // The `design` sub-object itself must not carry ui state either.
    const design = envelope['design'] as Record<string, unknown>;
    expect(design).not.toHaveProperty('units');
    expect(design).not.toHaveProperty('cameraPreset');
    expect(design).not.toHaveProperty('layerVisibility');

    revokeSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AC5 — loadFromFile replaces bundle
// ---------------------------------------------------------------------------

describe('useDesignStore — AC5 loadFromFile replaces bundle', () => {
  it('resolves and replaces bundle.design with the file design + recomputed layout', async () => {
    // Build a valid .deck file that differs from the default so we
    // can prove the store swapped bundle.
    const otherDesign = makeDefaultDesign(
      '11111111-1111-4111-8111-111111111111',
      '2026-07-03T11:00:00.000Z',
    );
    // Mutate a value so the loaded bundle is distinguishable from
    // the default the store starts with.
    const alteredDesign = {
      ...otherDesign,
      footprint: { ...otherDesign.footprint, widthMm: 5000 },
    };
    const envelope = serialize(alteredDesign);
    const file = new File([envelope], 'test.deck.json', { type: 'application/json' });

    // Real timers here — File.text() awaits a microtask cycle that
    // fake-timer setups can stall on.
    vi.useRealTimers();
    await useDesignStore.getState().loadFromFile(file);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(FIXED_CREATED_AT));

    const bundle = useDesignStore.getState().bundle;
    expect(bundle.design.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(bundle.design.footprint.widthMm).toBe(5000);
    // Layout was recomputed for the new design (designId matches).
    expect(bundle.layout.designId).toBe('11111111-1111-4111-8111-111111111111');
    // Status returns to idle after successful load.
    expect(useDesignStore.getState().status).toBe('idle');
    expect(useDesignStore.getState().lastError).toBeNull();
  });

  it('DeckFileError (invalid-json) on load → status "error" + lastError set + no throw', async () => {
    const junkFile = new File(['not-json'], 'bad.deck.json', { type: 'application/json' });
    vi.useRealTimers();
    // The action returns a resolved Promise (it never rejects) —
    // failures are surfaced via state, not by throwing.
    await expect(useDesignStore.getState().loadFromFile(junkFile)).resolves.toBeUndefined();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(FIXED_CREATED_AT));
    expect(useDesignStore.getState().status).toBe('error');
    const err = useDesignStore.getState().lastError;
    expect(err).toBeInstanceOf(DeckFileError);
  });

  it('temporal history cleared on loadFromFile (edge case: no undo across load boundary)', async () => {
    // Seed some undoable history.
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: 4000 },
    });
    expect(useDesignStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    // Load a file — history MUST be cleared per issue #9 §4 Edge cases.
    const validDesign = makeDefaultDesign(
      '22222222-2222-4222-8222-222222222222',
      '2026-07-03T11:00:00.000Z',
    );
    const file = new File([serialize(validDesign)], 'ok.deck.json', {
      type: 'application/json',
    });
    vi.useRealTimers();
    await useDesignStore.getState().loadFromFile(file);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(FIXED_CREATED_AT));

    expect(useDesignStore.temporal.getState().pastStates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC6 — save storage-full → ui-store banner
// ---------------------------------------------------------------------------

describe('useDesignStore — AC6 storage-full → ui-store banner', () => {
  it('setItem throwing QuotaExceededError sets storageBanner="storage-full"', () => {
    // Stub Storage.prototype.setItem to throw a QuotaExceededError
    // (matches how a real browser reports full quota — the
    // persistence layer's classifier maps this to
    // `DeckFileError code:"storage-full"`).
    const err = new Error('quota exceeded');
    err.name = 'QuotaExceededError';
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw err;
    });

    useDesignStore.getState().applyParameters({
      footprint: { widthMm: 4000 },
    });
    // Force the debounced autosave to run so we exercise the save
    // path this test cares about.
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);

    expect(useUiStore.getState().storageBanner).toBe('storage-full');
  });

  it('setItem throwing SecurityError sets storageBanner="storage-blocked"', () => {
    const err = new Error('blocked');
    err.name = 'SecurityError';
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw err;
    });

    useDesignStore.getState().applyParameters({
      footprint: { widthMm: 4000 },
    });
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);

    expect(useUiStore.getState().storageBanner).toBe('storage-blocked');
  });
});

// ---------------------------------------------------------------------------
// loadFromLocalStorage — AC8 fallback + AC9 recompute failure
// ---------------------------------------------------------------------------

describe('useDesignStore — loadFromLocalStorage AC8 fallback', () => {
  it('no localStorage entry → keeps the default bundle (no throw)', () => {
    // Note: beforeEach already sets the default bundle; this asserts
    // the loadFromLocalStorage action does not corrupt it when the
    // slot is empty.
    localStorage.clear();
    useDesignStore.getState().loadFromLocalStorage();
    const design = useDesignStore.getState().bundle.design;
    expect(design.footprint.widthMm).toBe(DEFAULT_DESIGN_PARAMS.widthFt * 304.8);
    expect(useDesignStore.getState().status).toBe('idle');
  });

  it('invalid JSON in localStorage → keeps default (persistence returns null → seed default)', () => {
    localStorage.setItem(STORAGE_KEY, 'this is not JSON at all');
    useDesignStore.getState().loadFromLocalStorage();
    const design = useDesignStore.getState().bundle.design;
    expect(design.footprint.widthMm).toBe(DEFAULT_DESIGN_PARAMS.widthFt * 304.8);
    expect(useDesignStore.getState().status).toBe('idle');
  });

  it('valid stored design → loads it into bundle (round trip)', () => {
    const stored = makeDefaultDesign(
      '33333333-3333-4333-8333-333333333333',
      '2026-07-03T09:00:00.000Z',
    );
    const alteredStored = {
      ...stored,
      footprint: { ...stored.footprint, widthMm: 6000 },
    };
    localStorage.setItem(STORAGE_KEY, serialize(alteredStored));
    useDesignStore.getState().loadFromLocalStorage();
    const design = useDesignStore.getState().bundle.design;
    expect(design.id).toBe('33333333-3333-4333-8333-333333333333');
    expect(design.footprint.widthMm).toBe(6000);
  });
});

describe('useDesignStore — AC9 boot-time LayoutError recovery', () => {
  it('stored design that recomputes to LayoutError → default seeded, banner set, no throw', () => {
    // The stored design PARSES + SCHEMA-VALIDATES (S6 allows any
    // strategy value; MIN_DECK_DIMENSION_MM is enforced by S4 at
    // compute time). We craft a design with widthMm below the
    // MIN_DECK_DIMENSION_MM guard so computeLayoutAndCheck throws
    // `LayoutError` and the AC9 path is exercised.
    const invalidStored = makeDefaultDesign(
      '44444444-4444-4444-8444-444444444444',
      '2026-07-03T09:00:00.000Z',
    );
    // widthMm = 100 mm ≈ 4 inches — far below the 4 ft min → engine throws.
    const belowMin = {
      ...invalidStored,
      footprint: { ...invalidStored.footprint, widthMm: 100 },
    };
    // Bypass the persistence layer's schema (which accepts any
    // positive number for widthMm) by writing an already-serialized
    // envelope directly — the schema does not clamp min values.
    localStorage.setItem(STORAGE_KEY, serialize(belowMin));

    // The load MUST NOT throw — that would take the app down at boot.
    expect(() => {
      useDesignStore.getState().loadFromLocalStorage();
    }).not.toThrow();

    // Bundle is seeded from the DEFAULT design, not from the stored
    // (broken) one.
    const design = useDesignStore.getState().bundle.design;
    expect(design.footprint.widthMm).toBe(DEFAULT_DESIGN_PARAMS.widthFt * 304.8);
    // Status carries the error + last error is a LayoutError.
    expect(useDesignStore.getState().status).toBe('error');
    expect(useDesignStore.getState().lastError).toBeInstanceOf(LayoutError);
    // UI banner shows the AC9 discriminator (reuse of storageBanner
    // — documented in ui-store.ts).
    expect(useUiStore.getState().storageBanner).toBe('load-recompute-failed');
  });
});

// ---------------------------------------------------------------------------
// applyParameters — error branches
// ---------------------------------------------------------------------------

describe('useDesignStore — applyParameters error handling', () => {
  it('ApplyParametersError (unknown key) → status "error", previous bundle intact', () => {
    const before = useDesignStore.getState().bundle;
    // The runtime unknown-key path is what we're exercising. Force
    // the type system through `unknown` + a `DeepPartial<DeckDesign>`
    // recast — this satisfies the store's TS signature but delivers
    // a runtime-invalid key so `applyParameters` throws
    // `ApplyParametersError` per S7's contract.
    const badPatch = { notARealField: 42 } as unknown as DeepPartial<DeckDesign>;
    useDesignStore.getState().applyParameters(badPatch);

    const after = useDesignStore.getState();
    expect(after.status).toBe('error');
    expect(after.lastError).not.toBeNull();
    // Bundle unchanged — the store did NOT partially corrupt state.
    expect(after.bundle).toBe(before);
  });

  it('LayoutError (widthMm below MIN_DECK_DIMENSION_MM) → status "error", bundle intact', () => {
    const before = useDesignStore.getState().bundle;
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: 10 }, // way below 4 ft min
    });

    const after = useDesignStore.getState();
    expect(after.status).toBe('error');
    expect(after.lastError).toBeInstanceOf(LayoutError);
    expect(after.bundle).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('useDesignStore — reset()', () => {
  it('re-seeds bundle from default and clears temporal history', () => {
    // Mutate, verify past states, then reset.
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: 4200 },
    });
    expect(useDesignStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    useDesignStore.getState().reset();

    // Default width restored.
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(
      DEFAULT_DESIGN_PARAMS.widthFt * 304.8,
    );
    // History cleared.
    expect(useDesignStore.temporal.getState().pastStates).toEqual([]);
    // Status back to idle.
    expect(useDesignStore.getState().status).toBe('idle');
  });
});
