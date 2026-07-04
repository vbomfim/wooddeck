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
 *          so the 500 ms is deterministic. Also: single
 *          `applyParameters` + advance 10× window → EXACTLY one
 *          `setItem` (pair-fix Review E: no delayed second fire
 *          proves the debounce is not subscription-recursive).
 *   - AC4  `downloadDeckFile()` serializes ONLY `design` — no
 *          camera/layer/unit fields. Verified by spying on the
 *          persistence-layer `downloadDeckFile` shim and asserting
 *          the arg is a raw `DeckDesign`, not an envelope wrapping
 *          UI state.
 *   - AC5  `loadFromFile(file)` replaces the bundle with the
 *          file's design plus its recomputed layout/warnings.
 *          Also clears `temporal` history (edge case).
 *   - AC6  Save fails with `code: "storage-full"` → uiStore
 *          `storageBanner === 'storage-full'`.
 *   - AC8  Fresh app load, no localStorage → `bundle.design`
 *          matches the default from `makeDefaultDesign`.
 *   - AC9  Stored design that recomputes to `LayoutError` on load
 *          → catch, seed default, set `status: 'error'` +
 *          `lastError`, ui-store banner set, temporal history
 *          cleared. No throw at mount. Pair-fix Review D: same
 *          treatment for ANY thrown error, not just `LayoutError`.
 *
 * ## Edge cases
 *
 *   - Invalid JSON in localStorage (persistence returns null) →
 *     seed default.
 *   - Undo across a file-load boundary → temporal history cleared
 *     on `loadFromFile` (issue #9 §4 Edge cases).
 *   - Undo across a successful storage-load boundary → temporal
 *     history cleared (pair-fix Review B).
 *   - Undo across the AC9 recovery boundary → temporal history
 *     cleared (pair-fix Review B).
 *   - `applyParameters` with a bad patch (unknown key /
 *     `ApplyParametersError`) → `status: 'error'`, previous
 *     bundle intact.
 *   - `LayoutError` from `applyParameters` (dimension below
 *     min-4-ft) → same graceful handling — no throw, previous
 *     bundle intact.
 *   - Non-Error thrown from `applyParameters` → wrapped as `Error`,
 *     never leaked (pair-fix Review I coverage of the defensive
 *     branch).
 *   - No `.subscribe(` calls on the design store from anywhere
 *     under `src/state/**` (pair-fix Review E belt-and-suspenders
 *     — a future refactor that reintroduces subscription-based
 *     autosave would fail RED here).
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). Every test resets the
 * store (`resetDesignStoreForTests`) and localStorage in `beforeEach`
 * so state does not bleed. Autosave uses fake timers by default;
 * tests that need real time-of-day flush the pending debounce first
 * (pair-fix Review G: timer hygiene) then switch modes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as appApi from '../application';
import type { DeepPartial } from '../application';
import { DeckFileError } from '../application';
import { LayoutError } from '../domain/layout';
import type { DeckDesign } from '../domain/model';
import { MM_PER_FOOT } from '../domain/units';
import { STORAGE_KEY, serialize } from '../persistence';

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

const DEFAULT_WIDTH_MM = DEFAULT_DESIGN_PARAMS.widthFt * MM_PER_FOOT;

/**
 * Small helper for AC5 tests that need to switch between fake and
 * real timers. Pair-fix Review G: any pending autosave scheduled
 * under fake timers MUST be flushed / cancelled before switching
 * to real timers so a native 500 ms setTimeout doesn't leak
 * across the test boundary.
 */
function switchToRealTimers(): void {
  flushAutosaveForTests();
  vi.useRealTimers();
}

function switchToFakeTimers(): void {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(FIXED_CREATED_AT));
}

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
    expect(typeof state.exportScreenshot).toBe('function');
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
      footprint: { widthMm: DEFAULT_WIDTH_MM + 100 },
    });
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_WIDTH_MM + 200 },
    });
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_WIDTH_MM + 300 },
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
    // fake-timer setups can stall on. Pair-fix Review G: flush any
    // pending fake-timer autosave FIRST so no native 500 ms timer
    // leaks across the mode switch.
    switchToRealTimers();
    await useDesignStore.getState().loadFromFile(file);
    switchToFakeTimers();

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
    switchToRealTimers();
    // The action returns a resolved Promise (it never rejects) —
    // failures are surfaced via state, not by throwing.
    await expect(useDesignStore.getState().loadFromFile(junkFile)).resolves.toBeUndefined();
    switchToFakeTimers();
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
    switchToRealTimers();
    await useDesignStore.getState().loadFromFile(file);
    switchToFakeTimers();

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
    expect(design.footprint.widthMm).toBe(DEFAULT_WIDTH_MM);
    expect(useDesignStore.getState().status).toBe('idle');
  });

  it('invalid JSON in localStorage → keeps default (persistence returns null → seed default)', () => {
    localStorage.setItem(STORAGE_KEY, 'this is not JSON at all');
    useDesignStore.getState().loadFromLocalStorage();
    const design = useDesignStore.getState().bundle.design;
    expect(design.footprint.widthMm).toBe(DEFAULT_WIDTH_MM);
    expect(useDesignStore.getState().status).toBe('idle');
  });

  it('valid stored design → loads it into bundle (round trip) AND clears temporal history', () => {
    // Seed some undoable history BEFORE the storage-load so we can
    // prove pair-fix Review B: the successful storage-load branch
    // clears zundo history so a stray undo() can't rewind to
    // pre-load state the user never edited.
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_WIDTH_MM + 200 },
    });
    expect(useDesignStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

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
    // Pair-fix Review B: undo history MUST be empty after a
    // successful storage-load.
    expect(useDesignStore.temporal.getState().pastStates).toEqual([]);
  });
});

describe('useDesignStore — AC9 boot-time load recovery', () => {
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
    expect(design.footprint.widthMm).toBe(DEFAULT_WIDTH_MM);
    // Status carries the error + last error is a LayoutError.
    expect(useDesignStore.getState().status).toBe('error');
    expect(useDesignStore.getState().lastError).toBeInstanceOf(LayoutError);
    // UI banner shows the AC9 discriminator (reuse of storageBanner
    // — documented in ui-store.ts).
    expect(useUiStore.getState().storageBanner).toBe('load-recompute-failed');
  });

  it('AC9 recovery clears temporal history (pair-fix Review B)', () => {
    // Seed some undoable history first so we can prove the recovery
    // path clears it — otherwise the user's first undo() would
    // rewind to a design they never saw AFTER the boot-time
    // "we couldn't load your saved design, starting fresh" banner.
    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_WIDTH_MM + 100 },
    });
    expect(useDesignStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    // Trigger the AC9 recovery path.
    const invalidStored = makeDefaultDesign(
      '55555555-5555-4555-8555-555555555555',
      '2026-07-03T09:00:00.000Z',
    );
    const belowMin = {
      ...invalidStored,
      footprint: { ...invalidStored.footprint, widthMm: 100 },
    };
    localStorage.setItem(STORAGE_KEY, serialize(belowMin));
    useDesignStore.getState().loadFromLocalStorage();

    // History cleared.
    expect(useDesignStore.temporal.getState().pastStates).toEqual([]);
  });

  it('non-LayoutError thrown from load use-case → same recovery (uniform catch, pair-fix Review D)', () => {
    // Pair-fix Review MEDIUM D: the previous implementation ONLY
    // handled `LayoutError` with a banner; any other error set
    // status silently (no banner). The new catch is uniform: any
    // thrown error → seed default + status:'error' + lastError +
    // banner + no throw. This test spies the application-layer
    // loader to throw a generic Error and asserts the store lands
    // in the same recovered state.
    const spy = vi
      .spyOn(appApi, 'loadDesignFromLocalStorage')
      .mockImplementation(() => {
        throw new Error('simulated infrastructure failure');
      });

    localStorage.setItem(STORAGE_KEY, 'anything — the spy intercepts before this matters');

    expect(() => {
      useDesignStore.getState().loadFromLocalStorage();
    }).not.toThrow();

    const design = useDesignStore.getState().bundle.design;
    expect(design.footprint.widthMm).toBe(DEFAULT_WIDTH_MM);
    expect(useDesignStore.getState().status).toBe('error');
    const err = useDesignStore.getState().lastError;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LayoutError);
    expect(err?.message).toBe('simulated infrastructure failure');
    // Banner is set — this is the key regression the review caught.
    expect(useUiStore.getState().storageBanner).toBe('load-recompute-failed');
    expect(useDesignStore.temporal.getState().pastStates).toEqual([]);

    spy.mockRestore();
  });

  it('non-Error thrown from load use-case → wrapped as Error, still recovers (defensive branch)', () => {
    // Belt-and-suspenders: even a non-Error throw (a raw string,
    // a plain object) must not corrupt state. Wrapping is done
    // inside the catch — this test exercises the `else` branch of
    // the `err instanceof Error ? err : new Error(...)` ternary.
    const spy = vi
      .spyOn(appApi, 'loadDesignFromLocalStorage')
      .mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'raw string error — not an Error instance';
      });

    expect(() => {
      useDesignStore.getState().loadFromLocalStorage();
    }).not.toThrow();

    const err = useDesignStore.getState().lastError;
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('non-Error thrown');
    expect(err?.message).toContain('raw string error');
    expect(useUiStore.getState().storageBanner).toBe('load-recompute-failed');

    spy.mockRestore();
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

  it('non-Error thrown from applyParameters use-case → wrapped Error, bundle intact (Review I)', () => {
    // Pair-fix Review I: prefer a real test over `/* c8 ignore */`
    // for the defensive non-Error catch branch. Mocking the
    // application-layer applyParameters to throw a raw string
    // exercises the `err instanceof Error === false` branch in
    // the store's `applyParameters` catch, so coverage tracks a
    // realistic path rather than skipping defensive code.
    const before = useDesignStore.getState().bundle;
    const spy = vi.spyOn(appApi, 'applyParameters').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 42; // a number, deliberately not an Error
    });

    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_WIDTH_MM + 10 },
    });

    const after = useDesignStore.getState();
    expect(after.status).toBe('error');
    expect(after.lastError).toBeInstanceOf(Error);
    expect(after.lastError?.message).toContain('non-Error thrown');
    expect(after.lastError?.message).toContain('42');
    // Bundle unchanged — the store did NOT partially corrupt state.
    expect(after.bundle).toBe(before);

    spy.mockRestore();
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
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(DEFAULT_WIDTH_MM);
    // History cleared.
    expect(useDesignStore.temporal.getState().pastStates).toEqual([]);
    // Status back to idle.
    expect(useDesignStore.getState().status).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// S16 issue #38 — applyRemediation action
// ---------------------------------------------------------------------------

describe('useDesignStore — applyRemediation action (S16 issue #38)', () => {
  // Local helper: build a RemediationOption suitable for whitebox
  // testing the store action. Semantics of the option itself are
  // exercised in `domain/spans/remediations.test.ts` — here we only
  // care that the store WIRES the delegator correctly.
  const spacingOption: import('../domain/spans').RemediationOption = {
    kind: 'reduce-joist-spacing',
    memberId: 'joist-0',
    patch: { kind: 'reduce-joist-spacing', newSpacingMm: 305 },
    summary: 'Reduce joist spacing to 12 in',
    currentAllowableMm: 3607,
    newAllowableMm: 5029,
    actualSpanMm: 4577,
    wouldClear: true,
    disabled: false,
    disabledReason: null,
  };

  it('AC9 — single applyRemediation call → EXACTLY ONE pastStates entry', () => {
    // Seed a non-default design so the option's target spacing (305)
    // differs from the current spacing (default 406) and the
    // resulting patch actually mutates state.
    resetDesignStoreForTests({ id: FIXED_ID, createdAt: FIXED_CREATED_AT });
    const historyBefore = useDesignStore.temporal.getState().pastStates.length;

    useDesignStore.getState().applyRemediation(spacingOption);

    const historyAfter = useDesignStore.temporal.getState().pastStates.length;
    // Exactly one new entry. If the action set(...)-ed twice
    // (e.g. once for status:'loading' then once for the bundle),
    // zundo would track BOTH — undoing would take two clicks
    // for one user action, which is the AC9 hazard.
    expect(historyAfter - historyBefore).toBe(1);
  });

  it('success → status:"idle", bundle mutated, lastError:null, schedules autosave', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const before = useDesignStore.getState().bundle;

    useDesignStore.getState().applyRemediation(spacingOption);

    const after = useDesignStore.getState();
    // Bundle updated — different reference AND spacing reflects patch.
    expect(after.bundle).not.toBe(before);
    expect(after.bundle.design.joist.spacingMm).toBe(305);
    // Status clean.
    expect(after.status).toBe('idle');
    expect(after.lastError).toBeNull();
    // Autosave scheduled (fires after debounce window).
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 1);
    expect(setItemSpy).toHaveBeenCalled();
  });

  it('AC10 — failure branch: bundle preserved, status:"error", lastError set', () => {
    const before = useDesignStore.getState().bundle;
    // Craft a synthetic option with an unsupported species — the
    // application-layer applyRemediation delegates to applyParameters
    // which will fail-lookup in the materials-catalog. The store's
    // catch MUST preserve `before.bundle` reference.
    const badOption: import('../domain/spans').RemediationOption = {
      kind: 'change-joist-species',
      memberId: 'joist-0',
      patch: {
        kind: 'change-joist-species',
        newSpecies: 'Ipe' as unknown as 'PT',
      },
      summary: 'Change joist species to Ipe (invalid)',
      currentAllowableMm: 3607,
      newAllowableMm: 0,
      actualSpanMm: 4577,
      wouldClear: false,
      disabled: false,
      disabledReason: null,
    };

    useDesignStore.getState().applyRemediation(badOption);

    const after = useDesignStore.getState();
    expect(after.status).toBe('error');
    expect(after.lastError).toBeInstanceOf(Error);
    // Bundle reference-equal to the pre-call bundle — no partial
    // corruption.
    expect(after.bundle).toBe(before);
  });

  it('non-Error thrown from apply use-case → wrapped Error, bundle intact', () => {
    // Same defensive branch we test in applyParameters — an
    // application-layer applyRemediation that throws a primitive
    // must be wrapped in an Error subclass so `lastError` is always
    // a real Error (S13 UI code destructures `.message`).
    const before = useDesignStore.getState().bundle;
    const spy = vi.spyOn(appApi, 'applyRemediation').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'boom';
    });

    useDesignStore.getState().applyRemediation(spacingOption);

    const after = useDesignStore.getState();
    expect(after.status).toBe('error');
    expect(after.lastError).toBeInstanceOf(Error);
    expect(after.lastError?.message).toContain('non-Error thrown');
    expect(after.lastError?.message).toContain('boom');
    expect(after.bundle).toBe(before);

    spy.mockRestore();
  });

  it('AC19 — ui-store (units, camera, layer visibility) UNCHANGED across apply', () => {
    const uiBefore = useUiStore.getState();
    useDesignStore.getState().applyRemediation(spacingOption);
    const uiAfter = useUiStore.getState();
    // Same reference identity — the design action MUST NOT touch
    // the ui-store. (Store separation is the S9 architectural
    // invariant; this is the pass-through assertion at the S16
    // seam.)
    expect(uiAfter.units).toBe(uiBefore.units);
    expect(uiAfter.cameraPreset).toBe(uiBefore.cameraPreset);
    expect(uiAfter.layerVisibility).toBe(uiBefore.layerVisibility);
  });
});

// ---------------------------------------------------------------------------
// Pair-fix Review E — autosave feedback-loop regression
// ---------------------------------------------------------------------------

describe('useDesignStore — pair-fix Review E: autosave has no feedback loop', () => {
  it('single applyParameters + advance 10× debounce window → setItem called EXACTLY once', () => {
    // The intent: prove a single mutation does NOT trigger a
    // recursive autosave. A subscription-based autosave (which
    // issue #9 §15 explicitly rules out) would fire, mutate the
    // state via a saved-marker, and re-fire — leading to an
    // extra setItem within the extended window. This test locks
    // that pattern out permanently: even after 10× the debounce
    // window, the count MUST stay at exactly one.
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    useDesignStore.getState().applyParameters({
      footprint: { widthMm: DEFAULT_WIDTH_MM + 10 },
    });

    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 10);

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(setItemSpy.mock.calls[0]?.[0]).toBe(STORAGE_KEY);
  });

  it('no design-store file under src/state/ contains a .subscribe( call on the design store', () => {
    // Belt-and-suspenders regression guard. If a future refactor
    // reintroduces the subscription-based autosave loop (issue #9
    // §15 forbids), this test fails RED before the runtime test
    // above has a chance to reveal an off-by-one debounce edge
    // case. Grep-based tests are a project-recognized pattern —
    // see span-check.test.ts for a similar convention.
    const stateDir = join(__dirname);
    const files = readdirSync(stateDir).filter(
      (f) =>
        f.endsWith('.ts') &&
        !f.endsWith('.test.ts') &&
        // Skip the barrel — it only re-exports, no runtime code.
        f !== 'index.ts',
    );
    for (const file of files) {
      const src = readFileSync(join(stateDir, file), 'utf-8');
      // The pattern we're forbidding: `useDesignStore.subscribe(...)`
      // OR any bare `.subscribe(` call. Real Zustand stores DO
      // expose `subscribe` — but state-layer INTERNAL code should
      // never call it (that's what the ticket flagged as a
      // feedback loop). External consumers (react components) use
      // hooks, not `.subscribe()`.
      const forbidden = /\.subscribe\s*\(/.test(src);
      expect(forbidden, `${file} uses .subscribe(...) — autosave feedback loop hazard`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// S14 issue #15 — exportScreenshot(canvas, filename)
// ---------------------------------------------------------------------------

describe('useDesignStore — exportScreenshot (S14 AC10)', () => {
  it('happy path: calls persistence to trigger an anchor click and stays status:idle', () => {
    // Route: exportScreenshot → application → persistence
    // (downloadCanvasScreenshot). We spy on document.createElement
    // to observe the anchor click that persistence makes.
    const clickSpy = vi.fn();
    const realCreate = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = realCreate(tag);
        if (tag === 'a') {
          (el as HTMLAnchorElement).click = clickSpy;
        }
        return el;
      });

    const canvas = {
      width: 800,
      height: 600,
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,fake'),
    } as unknown as HTMLCanvasElement;

    useDesignStore.getState().exportScreenshot(canvas, 'wooddeck-test.png');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const state = useDesignStore.getState();
    expect(state.status).toBe('idle');
    expect(state.lastError).toBeNull();

    createSpy.mockRestore();
  });

  it('zero-size canvas: sets status=error + lastError to a DeckFileError code=canvas-empty', () => {
    const canvas = {
      width: 0,
      height: 0,
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;

    useDesignStore.getState().exportScreenshot(canvas, 'wooddeck-empty.png');

    const state = useDesignStore.getState();
    expect(state.status).toBe('error');
    expect(state.lastError).not.toBeNull();
    // Import lazily to avoid circular test dep on the persistence
    // barrel; a `.name === 'DeckFileError'` check is enough.
    expect(state.lastError?.name).toBe('DeckFileError');
  });

  it('clears a stale error on a subsequent successful export', () => {
    // First call fails.
    const bad = {
      width: 0,
      height: 0,
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;
    useDesignStore.getState().exportScreenshot(bad, 'bad.png');
    expect(useDesignStore.getState().status).toBe('error');

    // Second call succeeds — status/lastError must reset.
    const clickSpy = vi.fn();
    const realCreate = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = realCreate(tag);
        if (tag === 'a') {
          (el as HTMLAnchorElement).click = clickSpy;
        }
        return el;
      });

    const good = {
      width: 800,
      height: 600,
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,fake'),
    } as unknown as HTMLCanvasElement;
    useDesignStore.getState().exportScreenshot(good, 'good.png');

    const state = useDesignStore.getState();
    expect(state.status).toBe('idle');
    expect(state.lastError).toBeNull();

    createSpy.mockRestore();
  });

  it('does NOT touch the bundle on error (screenshot is read-only)', () => {
    const before = useDesignStore.getState().bundle;
    const bad = {
      width: 0,
      height: 0,
      toDataURL: vi.fn(),
    } as unknown as HTMLCanvasElement;
    useDesignStore.getState().exportScreenshot(bad, 'x.png');
    expect(useDesignStore.getState().bundle).toBe(before);
  });
});

describe('design-store.downloadDeckFile — S14 UAT pair-fix FIX D', () => {
  // Before the pair-fix, downloadDeckFile was a naked
  // appDownloadDesign(...) call — any throw escaped to the caller
  // and the ui had no way to render the failure. Now the action
  // mirrors loadFromFile/exportScreenshot: on error → status
  // 'error' + lastError. Bundle is never mutated (read-only side
  // effect).

  it('when the download plumbing throws, status becomes "error" with a lastError', () => {
    // Force document.body.appendChild to throw when the anchor
    // is inserted — this is the last step before `.click()` in
    // persistence/file-io.ts, so it reliably simulates a real-
    // world failure (browser refuses to trigger download).
    const before = useDesignStore.getState().bundle;
    const realAppend = document.body.appendChild.bind(document.body);
    const appendSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node) => {
        if (
          node instanceof HTMLAnchorElement &&
          node.download.endsWith('.deck.json')
        ) {
          throw new Error('simulated appendChild failure');
        }
        return realAppend(node);
      });

    useDesignStore.getState().downloadDeckFile();

    const state = useDesignStore.getState();
    expect(state.status).toBe('error');
    expect(state.lastError).not.toBeNull();
    expect(state.lastError?.message).toContain('simulated');
    // Bundle unchanged — downloads MUST NOT mutate state.
    expect(state.bundle).toBe(before);

    appendSpy.mockRestore();
  });

  it('after a download error, a subsequent successful download clears status to idle', () => {
    // First: force an error.
    const realAppend = document.body.appendChild.bind(document.body);
    const appendSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementationOnce((node) => {
        if (
          node instanceof HTMLAnchorElement &&
          node.download.endsWith('.deck.json')
        ) {
          throw new Error('simulated appendChild failure');
        }
        return realAppend(node);
      });

    useDesignStore.getState().downloadDeckFile();
    expect(useDesignStore.getState().status).toBe('error');

    // Second: succeed. mockImplementationOnce reverts after one
    // call, so appendChild is real again. Stub anchor.click so we
    // don't actually navigate.
    const clickSpy = vi.fn();
    const realCreate = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = realCreate(tag);
        if (tag === 'a') {
          (el as HTMLAnchorElement).click = clickSpy;
        }
        return el;
      });

    useDesignStore.getState().downloadDeckFile();

    const state = useDesignStore.getState();
    expect(state.status).toBe('idle');
    expect(state.lastError).toBeNull();

    createSpy.mockRestore();
    appendSpy.mockRestore();
  });
});
