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
import { IrcSpanTable } from '../domain/spans';
import { MM_PER_FOOT } from '../domain/units';
import { STORAGE_KEY, serialize } from '../persistence';
import { V1_FIXTURE_A } from '../persistence/deck-file/__fixtures__/v1-envelopes';

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

  // S25 pair-fix (QA G1): add-support-row mutation persists across
  // the recompute; zundo captures ONE undo entry that restores the
  // previous foundation (no `blockRowsHint`). This is the store
  // integration test — the domain remediation + application
  // application-parameters seam is proven in their own tests.
  it('S25 — applyRemediation(add-support-row) persists blockRowsHint AND zundo undo restores prior foundation', () => {
    // Seed a floating tuffblocks bundle directly (bypasses the
    // default seed which is elevated + posts-on-footings — an
    // add-support-row remediation on that combo would be a NO-OP
    // per FR-030 / the domain producer's guards). Bundle is
    // computed via applyParameters against a hand-built floating
    // design so layout + warnings match a real user's state.
    const seedDesign: import('../domain/model').DeckDesign = {
      id: FIXED_ID,
      createdAt: FIXED_CREATED_AT,
      footprint: {
        widthMm: 12 * MM_PER_FOOT,
        lengthMm: 12 * MM_PER_FOOT,
        heightMm: 500,
      },
      structure: 'floating',
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      joist: {
        material: { nominal: '2x8', species: 'PT', grade: 'No2' },
        spacingMm: 406,
      },
      beam: { material: { nominal: '2x8', species: 'PT', grade: 'No2' } },
      decking: {
        material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
        orientation: 'parallel-to-width',
      },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    };
    // Use the app's public applyParameters (with an empty patch) to
    // compute the layout + warnings the same way a real edit
    // would. Any subsequent test-only bundle mutation is handled
    // via setState directly, but here we produce a compute-consistent
    // bundle to seed with.
    const seedBundle = appApi.applyParameters(
      seedDesign,
      // Empty patch triggers computeLayoutAndCheck on `seedDesign`
      // verbatim (the seed has no `blockRowsHint`; the layout
      // derives the row count from S19).
      {},
      new IrcSpanTable(),
    );
    // Reset zundo so we start from a clean history.
    useDesignStore.temporal.getState().clear();
    useDesignStore.setState({
      bundle: seedBundle,
      status: 'idle',
      lastError: null,
    });
    useDesignStore.temporal.getState().clear();

    // Snapshot the pre-remediation foundation. Must NOT carry
    // `blockRowsHint` (proves the undo restore below is meaningful).
    const before = useDesignStore.getState().bundle;
    if (before.design.foundation.type !== 'tuffblocks') {
      throw new Error('seed sanity: expected tuffblocks foundation');
    }
    expect(before.design.foundation.blockRowsHint).toBeUndefined();

    // Construct the add-support-row option that mimics what the
    // domain producer would emit for this deck. Only the `patch`
    // is load-bearing at the store seam — the presentation fields
    // are pass-through.
    const addSupportOption: import('../domain/spans').RemediationOption = {
      kind: 'add-support-row',
      memberId: 'beam-0',
      patch: {
        kind: 'add-support-row',
        targetBeamId: 'beam-0',
        currentRows: 3,
        proposedRows: 4,
      },
      summary: 'Add a row of blocks (3 → 4)',
      currentAllowableMm: 2400,
      newAllowableMm: 2400,
      actualSpanMm: 3048,
      wouldClear: true,
      disabled: false,
      disabledReason: null,
    };

    useDesignStore.getState().applyRemediation(addSupportOption);

    // Post-remediation: foundation.blockRowsHint MUST equal
    // proposedRows and persist across the store's recompute.
    const after = useDesignStore.getState();
    expect(after.status).toBe('idle');
    expect(after.lastError).toBeNull();
    if (after.bundle.design.foundation.type !== 'tuffblocks') {
      throw new Error('post-remediation: expected tuffblocks foundation');
    }
    expect(after.bundle.design.foundation.blockRowsHint).toBe(4);
    // Reference-inequality proves the immutable-update path fired.
    expect(after.bundle).not.toBe(before);

    // zundo captured exactly ONE past state (the pre-remediation
    // bundle). Undo restores the prior foundation.
    const past = useDesignStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);
    useDesignStore.temporal.getState().undo();
    const restored = useDesignStore.getState().bundle;
    if (restored.design.foundation.type !== 'tuffblocks') {
      throw new Error('post-undo: expected tuffblocks foundation');
    }
    // The restored foundation must NOT carry the hint — undo
    // brought us back to the pre-remediation state.
    expect(restored.design.foundation.blockRowsHint).toBeUndefined();
    // Reference-equality with the pre-remediation bundle proves
    // zundo's undo restores structurally-identical state.
    expect(restored).toBe(before);
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

// ---------------------------------------------------------------------------
// S23 — v1→v2 migration surface (design-store → ui-store bridge)
// ---------------------------------------------------------------------------
//
// The S18 loader returns `{bundle, migrated}` on both file and
// storage load paths. S18 threaded `migrated` through the loader
// chain but explicitly DROPPED it at the design-store — the
// pre-existing store code destructures `{bundle}` and ignores the
// flag. S23 wires the flag: when `migrated === true`, the store
// action calls `useUiStore.getState().notifyMigrationHappened()`
// which bumps a monotonic event id (S23 pair-fix — see
// `ui-store.ts` for the discrete-event rationale). The
// `<MigrationToast>` component then surfaces the info via a
// visibility predicate keyed on that counter.
//
// This is an ACTION-to-ACTION cross-store call (design → ui via
// `.getState()`) — the two stores' STATE stays disjoint. Mirrors
// the AC6 `setStorageBanner` precedent (design-side save failure
// surfaces via ui-side banner slot).

describe('useDesignStore — S23 loadFromFile bumps migration event id', () => {
  it('loadFromFile with a v1 envelope increments useUiStore.migrationEventId', async () => {
    // V1_FIXTURE_A.rawJson is a canonical v1-shape envelope; the
    // application loader migrates it in-flight and returns
    // `{bundle, migrated: true}`. The design-store MUST bump the
    // event counter so a toast appears (and — for a second v1 load
    // — restarts the timer).
    const eventBefore = useUiStore.getState().migrationEventId;

    const file = new File([V1_FIXTURE_A.rawJson], 'v1.deck.json', {
      type: 'application/json',
    });
    switchToRealTimers();
    await useDesignStore.getState().loadFromFile(file);
    switchToFakeTimers();

    // The load succeeded (bundle swapped to the migrated design) AND
    // the migration event counter bumped.
    expect(useDesignStore.getState().status).toBe('idle');
    expect(useUiStore.getState().migrationEventId).toBe(eventBefore + 1);
    // Belt-and-suspenders: the bundle is now a valid v2 design.
    // The migration stamps structure:'elevated' + posts-on-footings.
    expect(useDesignStore.getState().bundle.design.structure).toBe('elevated');
    expect(useDesignStore.getState().bundle.design.foundation.type).toBe(
      'posts-on-footings',
    );
  });

  it('loadFromFile with a v2 envelope does NOT bump migrationEventId', async () => {
    // Native v2 envelope → migrated:false → the counter must NOT bump.
    // The ticket §AC6 pins this: only v1-migrated loads trigger the
    // toast.
    const v2Design = makeDefaultDesign(
      '33333333-3333-4333-8333-333333333333',
      '2026-07-03T12:00:00.000Z',
    );
    const file = new File([serialize(v2Design)], 'v2.deck.json', {
      type: 'application/json',
    });
    const eventBefore = useUiStore.getState().migrationEventId;
    switchToRealTimers();
    await useDesignStore.getState().loadFromFile(file);
    switchToFakeTimers();

    expect(useDesignStore.getState().status).toBe('idle');
    expect(useUiStore.getState().migrationEventId).toBe(eventBefore);
  });

  it('loadFromFile FAILURE (bad JSON) leaves migrationEventId untouched', async () => {
    // A DeckFileError path lands in status='error' — no migration
    // took place, so the counter must not spuriously bump.
    const junk = new File(['not json'], 'bad.deck.json', {
      type: 'application/json',
    });
    const eventBefore = useUiStore.getState().migrationEventId;
    switchToRealTimers();
    await useDesignStore.getState().loadFromFile(junk);
    switchToFakeTimers();

    expect(useDesignStore.getState().status).toBe('error');
    expect(useUiStore.getState().migrationEventId).toBe(eventBefore);
  });
});

describe('useDesignStore — S23 loadFromLocalStorage bumps migration event id', () => {
  it('loadFromLocalStorage with a v1 slot increments migrationEventId', () => {
    // Seed a v1 envelope directly into localStorage — the loader
    // will accept it, migrate to v2, and return migrated:true.
    localStorage.setItem(STORAGE_KEY, V1_FIXTURE_A.rawJson);
    const eventBefore = useUiStore.getState().migrationEventId;

    useDesignStore.getState().loadFromLocalStorage();

    expect(useDesignStore.getState().status).toBe('idle');
    expect(useUiStore.getState().migrationEventId).toBe(eventBefore + 1);
    expect(useDesignStore.getState().bundle.design.structure).toBe('elevated');
  });

  it('loadFromLocalStorage with a v2 slot does NOT bump migrationEventId', () => {
    // Native v2 in storage — no migration, no toast.
    const v2Design = makeDefaultDesign(
      '44444444-4444-4444-8444-444444444444',
      '2026-07-03T13:00:00.000Z',
    );
    localStorage.setItem(STORAGE_KEY, serialize(v2Design));
    const eventBefore = useUiStore.getState().migrationEventId;

    useDesignStore.getState().loadFromLocalStorage();

    expect(useDesignStore.getState().status).toBe('idle');
    expect(useUiStore.getState().migrationEventId).toBe(eventBefore);
  });

  it('loadFromLocalStorage with NO slot does NOT bump migrationEventId', () => {
    // The null-slot branch keeps the default bundle and returns
    // early — the counter stays put.
    localStorage.clear();
    const eventBefore = useUiStore.getState().migrationEventId;

    useDesignStore.getState().loadFromLocalStorage();

    expect(useUiStore.getState().migrationEventId).toBe(eventBefore);
  });
});

// ---------------------------------------------------------------------------
// S23 pair-fix — QA Guardian gap-fill G3: structure/foundation
// switch + undo restores EXACT prior design with no orphan keys.
//
// This locks two invariants together:
//   1. zundo's `pastStates` restore is structural (deep-equal to
//      the pre-switch design — same bundle reference in fact).
//   2. The atomic re-stamp in `applyParameters` (S23 discriminator
//      REPLACE) produces a foundation subtree with ONLY the
//      variant's own allowed keys — no orphan `post`/`footing`
//      lingering on a block variant, no orphan `product` on a
//      posts-on-footings variant. The pre-pair-fix REPLACE path
//      guarded only top-level `FORBIDDEN_KEYS`; a stale-spread
//      caller could smuggle orphan variant keys through.
// ---------------------------------------------------------------------------

describe('useDesignStore — S23 QA G3: structure switch + undo has no orphan keys', () => {
  it('elevated+posts → floating+tuffblocks, then undo restores the prior design exactly (deep-equal, no orphan keys)', () => {
    // Baseline: default elevated + posts-on-footings design.
    resetDesignStoreForTests();
    const before = useDesignStore.getState().bundle;
    expect(before.design.structure).toBe('elevated');
    expect(before.design.foundation.type).toBe('posts-on-footings');
    // Sanity — a posts-on-footings foundation carries EXACTLY the
    // FR-026 variant keys.
    expect(Object.keys(before.design.foundation).sort()).toEqual(
      ['footing', 'post', 'type'].sort(),
    );

    // Act — atomic S23 re-stamp to floating + tuffblocks. The
    // discriminator switches; the REPLACE branch materialises the
    // new foundation subtree with only the tuffblocks variant's
    // allowed keys (`type`, `product`).
    useDesignStore.getState().applyParameters({
      structure: 'floating',
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
    });

    const afterSwitch = useDesignStore.getState().bundle;
    expect(afterSwitch.design.structure).toBe('floating');
    expect(afterSwitch.design.foundation.type).toBe('tuffblocks');
    // NO orphan keys — the tuffblocks foundation must NOT carry
    // `post` or `footing` (left over from the prior posts-on-
    // footings variant). This is the S23 pair-fix #1 invariant:
    // the REPLACE branch's variant-shape check would have thrown
    // ApplyParametersError if a stale-spread patch had been
    // constructed, but here we assert the successful path lands
    // clean.
    const foundationKeys = Object.keys(afterSwitch.design.foundation).sort();
    expect(foundationKeys).toEqual(['product', 'type'].sort());
    expect('post' in afterSwitch.design.foundation).toBe(false);
    expect('footing' in afterSwitch.design.foundation).toBe(false);

    // zundo captured exactly ONE past state (the pre-switch bundle).
    const past = useDesignStore.temporal.getState().pastStates;
    expect(past.length).toBe(1);

    // Act — undo restores the prior design.
    useDesignStore.temporal.getState().undo();

    const restored = useDesignStore.getState().bundle;
    // Reference equality with the original bundle — zundo restored
    // the exact object, not a re-materialised copy. This proves
    // "no orphan keys" beyond structural equality: the same
    // reference by definition has the same keys.
    expect(restored).toBe(before);
    // Belt-and-suspenders — deep-equal on the foundation subtree.
    expect(restored.design.foundation).toEqual(before.design.foundation);
    // And the exact key-set of the restored foundation is the
    // posts-on-footings triple with NO tuffblocks-shaped
    // leftovers (no `product`, no `blockRowsHint`).
    expect(Object.keys(restored.design.foundation).sort()).toEqual(
      ['footing', 'post', 'type'].sort(),
    );
    expect('product' in restored.design.foundation).toBe(false);
    expect('blockRowsHint' in restored.design.foundation).toBe(false);
    expect('blockColsHint' in restored.design.foundation).toBe(false);
  });

  it('floating+tuffblocks (with hints) → elevated+posts, then undo restores hints exactly', () => {
    // Seed a floating+tuffblocks design that carries S25 block
    // hints — the hint keys are FR-026-optional on block variants
    // and MUST round-trip through undo without loss.
    resetDesignStoreForTests();
    useDesignStore.getState().applyParameters({
      structure: 'floating',
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
        blockRowsHint: 3,
        blockColsHint: 5,
      },
    });
    // Reset undo history so the seed doesn't count.
    useDesignStore.temporal.getState().clear();

    const before = useDesignStore.getState().bundle;
    expect(before.design.foundation.type).toBe('tuffblocks');
    if (before.design.foundation.type !== 'tuffblocks') return;
    expect(before.design.foundation.blockRowsHint).toBe(3);
    expect(before.design.foundation.blockColsHint).toBe(5);

    // Switch to elevated + posts. This drops the block hints
    // (they're not part of the posts-on-footings variant shape).
    useDesignStore.getState().applyParameters({
      structure: 'elevated',
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
      foundation: {
        type: 'posts-on-footings',
        post: {
          nominal: '6x6',
          species: 'PT',
          grade: 'No2',
        },
        footing: {
          widthMm: 300,
          depthMm: 300,
        },
      },
    });
    const afterSwitch = useDesignStore.getState().bundle.design;
    expect(afterSwitch.foundation.type).toBe('posts-on-footings');
    // Orphan-key check on the FORWARD switch: elevated+posts must
    // NOT carry `product` / `blockRowsHint` / `blockColsHint`.
    expect('product' in afterSwitch.foundation).toBe(false);
    expect('blockRowsHint' in afterSwitch.foundation).toBe(false);
    expect('blockColsHint' in afterSwitch.foundation).toBe(false);

    // Undo restores the tuffblocks bundle — hints exactly restored.
    useDesignStore.temporal.getState().undo();
    const restored = useDesignStore.getState().bundle.design;
    expect(restored.foundation.type).toBe('tuffblocks');
    if (restored.foundation.type !== 'tuffblocks') return;
    expect(restored.foundation.blockRowsHint).toBe(3);
    expect(restored.foundation.blockColsHint).toBe(5);
    // Deep-equal round-trip.
    expect(restored.foundation).toEqual(before.design.foundation);
  });
});
