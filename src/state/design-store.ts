/**
 * `src/state/design-store.ts` — the Zustand store owning the canonical
 * `DesignBundle` (design + layout + warnings) plus the five write-side
 * actions the app needs.
 *
 * ## Two-store discipline (issue #9 §2 + Code Review Guardian finding #9)
 *
 * The design layer of wooddeck splits into TWO Zustand stores:
 *
 *   - THIS store (`useDesignStore`) owns everything that CAN be saved
 *     to a `.deck` file — the canonical `DeckDesign` and its derived
 *     `Layout` + `Warning[]` (bundled together as `DesignBundle` per
 *     S7 §2). Every mutation participates in undo/redo via the zundo
 *     `temporal` middleware.
 *   - `useUiStore` (see `./ui-store.ts`) owns transient VIEW state —
 *     camera preset, layer visibility, unit display mode, and the
 *     `storageBanner` reused for persistence-event notifications.
 *
 * Keeping the two stores disjoint at the STATE level is the frozen AC1
 * of issue #9. The design store DOES reach into the ui store's
 * `setStorageBanner` action to surface a save failure (AC6) and the
 * AC9 boot-time recompute failure — that's an ACTION-to-ACTION
 * cross-store call, not a state coupling.
 *
 * ## Actions are THIN (Code Review Guardian finding #1)
 *
 * Every action in this file is a wrapper: call an `application/*`
 * use-case, `set(...)` the result, schedule the autosave. No domain
 * logic (that lives in `src/domain/**`), no I/O beyond delegating to
 * `application/` and (for AC9 diagnostic instanceof) `persistence/`.
 * The ticket §2 lists the frozen contract; issue #9 §15 explicitly
 * flags "domain logic in the store" as a code-review reject reason.
 *
 * ## SpanTable is ONE module-scope instance
 *
 * The S7 use-cases (`loadDesignFromFile`, `applyParameters`,
 * `computeLayoutAndCheck`) all take a `SpanTable` on every call — the
 * Open Question in issue #8 resolved to "pass it at every call site
 * rather than a module singleton" so the domain stays swappable. The
 * state store owns the ONE `IrcSpanTable` instance for the app
 * lifetime and threads it through every use-case call. Re-instantiation
 * per action would be a small allocation churn AND break identity
 * (two `IrcSpanTable`s are deep-equal but not reference-equal).
 *
 * ## Autosave — debounced 500 ms (AC3)
 *
 * The debounce is a MODULE-scope `setTimeout` handle owned by this
 * file (not a subscription — issue #9 §15 explicitly rules out
 * subscriptions to avoid the feedback loop
 * "autosave → setState → autosave"). Every `applyParameters`,
 * `loadFromFile`, and `reset` action calls `scheduleAutosave()` at
 * the END of its update. `scheduleAutosave` cancels any prior
 * pending timer and schedules a fresh one — the standard trailing-
 * edge debounce shape. On the timer's `.fire()` the pending
 * `saveDesignToLocalStorage` call runs; on failure the ui-store
 * banner is set (AC6).
 *
 * Test-friendliness: `flushAutosaveForTests()` forces the pending
 * timer to fire synchronously; `resetDesignStoreForTests()` cancels
 * it and re-seeds the default bundle. Both live under a `ForTests`
 * suffix so a grep audit can find and remove test-only surface in
 * a future rewrite if the timing model changes.
 *
 * ## AC9 — boot-time LayoutError recovery
 *
 * `loadFromLocalStorage()` wraps the S7 application-layer loader in
 * a `try/catch`. When the loader propagates `LayoutError` (a stored
 * design that PARSES + SCHEMA-VALIDATES but fails
 * `computeLayoutAndCheck` under current rules), the catch:
 *
 *   1. Seeds `bundle` from the DEFAULT design (AC8 fallback).
 *   2. Sets `status: 'error'` + `lastError` so a developer console
 *      or a future diagnostic overlay can pick up the details.
 *   3. Calls `useUiStore.setStorageBanner('load-recompute-failed')`
 *      so S12's banner surfaces "we couldn't load your saved design
 *      — starting fresh".
 *   4. Does NOT re-throw — an unhandled rejection at boot would
 *      take the whole shell down. The pinned AC9 comment on issue
 *      #9 is unambiguous on this point.
 *
 * The reused banner discriminator is documented in `ui-store.ts`.
 *
 * ## Error handling — graceful, never crashing
 *
 * `applyParameters` and `loadFromFile` both catch every error the
 * application layer can produce (`ApplyParametersError`,
 * `LayoutError`, `DeckFileError`) and translate them into
 * `status: 'error' + lastError`. The previous bundle stays intact —
 * this is critical: an undo through an error branch MUST return the
 * user to a working state, not to a half-corrupted one.
 *
 * ## Boundary discipline
 *
 * This module imports from:
 *   - `zustand`, `zundo`                — middleware & store type
 *   - `../application`                  — use-case orchestrators
 *   - `../persistence`                  — instanceof DeckFileError (type narrowing on AC6)
 *   - `../domain/spans`                 — SpanTable instance
 *   - `../domain/id`                    — makeDeckDesignId
 *   - `../domain/layout`                — instanceof LayoutError (type narrowing on AC9)
 *   - `./ui-store`                      — sibling
 *   - `./default-design`                — seeding factory
 *
 * NEVER imports from `../scene/` or `../ui/` (enforced by
 * `.dependency-cruiser.cjs` `state-allowlist` + probe fixtures in
 * `scripts/boundary-selftest.mjs`).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';

import {
  ApplyParametersError,
  applyParameters as appApplyParameters,
  computeLayoutAndCheck,
  downloadDesign as appDownloadDesign,
  loadDesignFromFile as appLoadDesignFromFile,
  loadDesignFromLocalStorage as appLoadDesignFromLocalStorage,
  saveDesignToLocalStorage as appSaveDesignToLocalStorage,
  type DeepPartial,
  type DesignBundle,
} from '../application';
import { makeDeckDesignId } from '../domain/id';
import { LayoutError } from '../domain/layout';
import { IrcSpanTable } from '../domain/spans';
import type { DeckDesign } from '../domain/model';
import { DeckFileError } from '../persistence';

import { makeDefaultDesign } from './default-design';
import { useUiStore } from './ui-store';

// ---------------------------------------------------------------------------
// Module-scope constants
// ---------------------------------------------------------------------------

/**
 * The debounce window for autosave. 500 ms is the ticket §17
 * trade-off decision — "feels instant while avoiding storage
 * thrashing on drag-slider parameter changes." Exported so tests
 * can advance timers by exactly this window rather than duplicating
 * the magic number.
 */
export const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * The zundo history limit. Ticket §9 caps this to bound memory —
 * 50 entries is generous for typical editing (~50 slider drags
 * before the oldest is dropped) yet still small in RAM.
 */
const ZUNDO_HISTORY_LIMIT = 50;

/**
 * The ONE `SpanTable` instance the store owns for the app lifetime.
 * See module header for why this is module-scope rather than
 * per-action or module-singleton-via-import.
 */
const spanTable = new IrcSpanTable();

// ---------------------------------------------------------------------------
// Debounced autosave — module-scope timer + flush hooks
// ---------------------------------------------------------------------------

/**
 * The pending autosave timer handle (or `null` when no autosave is
 * queued). Module-scope so `applyParameters`, `loadFromFile`, and
 * `reset` share the SAME debounce window across all mutation types
 * — a load followed by an apply within 500 ms should still coalesce
 * to a single write.
 */
let pendingAutosave: ReturnType<typeof setTimeout> | null = null;

/**
 * Cancel any pending autosave. Called by `scheduleAutosave` to
 * implement the trailing-edge debounce, and by
 * `resetDesignStoreForTests` so a test's mutations do not spill
 * into the next test.
 */
function cancelAutosave(): void {
  if (pendingAutosave !== null) {
    clearTimeout(pendingAutosave);
    pendingAutosave = null;
  }
}

/**
 * Run the autosave immediately with the CURRENT store bundle.
 * Catches `DeckFileError` (storage-full / storage-blocked) and
 * routes it to `useUiStore.setStorageBanner` — the AC6 contract.
 * Any other error is re-thrown so it doesn't silently disappear
 * (defensive — the persistence layer's classifier maps every write
 * failure to a `DeckFileError`, so this branch should be
 * unreachable).
 */
function runAutosaveNow(): void {
  const design = useDesignStore.getState().bundle.design;
  try {
    appSaveDesignToLocalStorage(design);
  } catch (err) {
    if (err instanceof DeckFileError) {
      // AC6 codes: 'storage-full' | 'storage-blocked'. The banner
      // union in ui-store carries the same string values.
      if (err.code === 'storage-full' || err.code === 'storage-blocked') {
        useUiStore.getState().setStorageBanner(err.code);
        return;
      }
    }
    // A non-DeckFileError from persistence is unexpected — the
    // classifier wraps every DOMException. Re-throw so the failure
    // is loud rather than silently lost.
    throw err;
  }
}

/**
 * Schedule a debounced autosave. Called at the END of every
 * bundle-mutating action. Cancels any prior pending timer and
 * schedules a fresh 500 ms trailing-edge debounce.
 */
function scheduleAutosave(): void {
  cancelAutosave();
  pendingAutosave = setTimeout(() => {
    pendingAutosave = null;
    runAutosaveNow();
  }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Test-only surface — force any pending autosave to fire
 * synchronously and clear the timer. Used by AC3 tests that assert
 * on exact call counts within a window smaller than the debounce.
 *
 * Exported (not gated on `import.meta.env.DEV`) because Vitest runs
 * in a test env that has no dev/prod distinction; a rewrite that
 * removes the debounce could drop this helper without breaking any
 * caller outside a test file.
 */
export function flushAutosaveForTests(): void {
  if (pendingAutosave !== null) {
    clearTimeout(pendingAutosave);
    pendingAutosave = null;
    runAutosaveNow();
  }
}

// ---------------------------------------------------------------------------
// Default-bundle helpers
// ---------------------------------------------------------------------------

/**
 * Build a `DesignBundle` from the default design + a real id + real
 * clock. Kept private — the exported `resetDesignStoreForTests`
 * takes ids and timestamps as overrides for deterministic tests.
 */
function makeDefaultBundle(id: string, createdAt: string): DesignBundle {
  const design = makeDefaultDesign(id, createdAt);
  const { layout, warnings } = computeLayoutAndCheck(design, spanTable);
  return { design, layout, warnings };
}

/**
 * Boot-time default bundle. Uses real id + real clock — deterministic
 * tests replace this via `resetDesignStoreForTests` in `beforeEach`.
 */
const INITIAL_BUNDLE: DesignBundle = makeDefaultBundle(
  makeDeckDesignId(),
  new Date().toISOString(),
);

// ---------------------------------------------------------------------------
// Store shape (issue #9 §2 frozen contract)
// ---------------------------------------------------------------------------

export interface DesignStoreState {
  readonly bundle: DesignBundle;
  readonly status: 'idle' | 'loading' | 'error';
  readonly lastError: Error | null;
}

export interface DesignStoreActions {
  loadFromFile(file: File): Promise<void>;
  loadFromLocalStorage(): void;
  applyParameters(patch: DeepPartial<DeckDesign>): void;
  downloadDeckFile(): void;
  reset(): void;
}

/**
 * The FULL state type — union of read state and write actions.
 * `zundo`'s `partialize` narrows this to just the read state, so
 * only bundle+status+lastError land in `pastStates` (and further
 * we drop status/lastError so undo doesn't rewind transient error
 * flags — see the `partialize` config below).
 */
export type DesignStoreShape = DesignStoreState & DesignStoreActions;

// ---------------------------------------------------------------------------
// Store construction — zustand + zundo
// ---------------------------------------------------------------------------

export const useDesignStore = create(
  temporal<DesignStoreShape, [], [], { bundle: DesignBundle }>(
    (set, get) => ({
      // ---- state -------------------------------------------------
      bundle: INITIAL_BUNDLE,
      status: 'idle',
      lastError: null,

      // ---- actions -----------------------------------------------
      //
      // Every action is thin: call an application/* use-case,
      // set(...) the result, schedule autosave. No domain logic.

      async loadFromFile(file): Promise<void> {
        set({ status: 'loading', lastError: null });
        try {
          const bundle = await appLoadDesignFromFile(file, spanTable);
          set({ bundle, status: 'idle', lastError: null });
          // Undo across a load-file boundary is a distinct workflow
          // (the user chose to REPLACE the design) — clear history
          // per issue #9 §4 Edge cases.
          useDesignStore.temporal.getState().clear();
          scheduleAutosave();
        } catch (err) {
          // DeckFileError or LayoutError land here. Either way we
          // surface via state, not a throw — an unhandled rejection
          // at the file-input onChange would take the shell down.
          if (err instanceof Error) {
            set({ status: 'error', lastError: err });
            return;
          }
          set({
            status: 'error',
            lastError: new Error(`loadFromFile: non-Error thrown: ${String(err)}`),
          });
        }
      },

      loadFromLocalStorage(): void {
        try {
          const bundle = appLoadDesignFromLocalStorage(spanTable);
          if (bundle === null) {
            // No stored design — keep the current default. Do NOT
            // reset (that would clear undo history for no reason).
            return;
          }
          set({ bundle, status: 'idle', lastError: null });
        } catch (err) {
          // AC9: the S7 loader propagates `LayoutError` when the
          // stored design is now-invalid under current rules
          // (e.g. a min-width tightening). Recover to defaults +
          // banner. NO throw at boot.
          if (err instanceof LayoutError) {
            const defaultBundle = makeDefaultBundle(
              makeDeckDesignId(),
              new Date().toISOString(),
            );
            set({ bundle: defaultBundle, status: 'error', lastError: err });
            useUiStore.getState().setStorageBanner('load-recompute-failed');
            return;
          }
          // Any other error is unexpected — the persistence layer's
          // load path swallows DeckFileError already. Surface it in
          // state but do NOT throw (same reasoning as AC9).
          if (err instanceof Error) {
            set({ status: 'error', lastError: err });
            return;
          }
          set({
            status: 'error',
            lastError: new Error(
              `loadFromLocalStorage: non-Error thrown: ${String(err)}`,
            ),
          });
        }
      },

      applyParameters(patch): void {
        try {
          const bundle = appApplyParameters(get().bundle.design, patch, spanTable);
          set({ bundle, status: 'idle', lastError: null });
          scheduleAutosave();
        } catch (err) {
          // ApplyParametersError (structural), LayoutError
          // (dimensional / material). Preserve the previous bundle
          // — the user should be able to undo through the error.
          if (err instanceof ApplyParametersError || err instanceof LayoutError) {
            set({ status: 'error', lastError: err });
            return;
          }
          if (err instanceof Error) {
            set({ status: 'error', lastError: err });
            return;
          }
          set({
            status: 'error',
            lastError: new Error(`applyParameters: non-Error thrown: ${String(err)}`),
          });
        }
      },

      downloadDeckFile(): void {
        appDownloadDesign(get().bundle.design);
      },

      reset(): void {
        const bundle = makeDefaultBundle(
          makeDeckDesignId(),
          new Date().toISOString(),
        );
        set({ bundle, status: 'idle', lastError: null });
        useDesignStore.temporal.getState().clear();
        scheduleAutosave();
      },
    }),
    {
      limit: ZUNDO_HISTORY_LIMIT,
      // `partialize` restricts what zundo snapshots. We record ONLY
      // the bundle — status/lastError are transient UX flags whose
      // undo would be confusing ("undo went back to an error state
      // I already dismissed"). Actions are dropped implicitly by
      // typing partialize's return to a state subset.
      partialize: (state): { bundle: DesignBundle } => ({ bundle: state.bundle }),
      // Deep equality on bundle would be expensive per set(...) —
      // reference equality is enough: our reducers always produce
      // NEW bundle objects (immutable update).
      equality: (a, b): boolean => a.bundle === b.bundle,
    },
  ),
);

// ---------------------------------------------------------------------------
// Test-only reset helper
// ---------------------------------------------------------------------------

export interface ResetDesignStoreForTestsOptions {
  /** Override the id used to seed the default design. */
  readonly id?: string;
  /** Override the ISO-8601 createdAt used to seed the default. */
  readonly createdAt?: string;
}

/**
 * Test-only surface — replace the store's bundle with a freshly-
 * seeded default and clear both zundo history + pending autosave.
 * Callers pass fixed id + createdAt for byte-stable comparisons.
 *
 * Named with a `ForTests` suffix so a grep audit finds it. Excluded
 * from the auto-run-boot flow — real users never call this; a real
 * "reset" is `useDesignStore.getState().reset()`.
 */
export function resetDesignStoreForTests(options: ResetDesignStoreForTestsOptions = {}): void {
  cancelAutosave();
  const id = options.id ?? makeDeckDesignId();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const bundle = makeDefaultBundle(id, createdAt);
  // Partial update (no `replace: true`): keep the action closures
  // that zustand set up at store creation, but reset every read-side
  // slice. `replace: true` would wipe the actions and every next
  // `.applyParameters(...)` would TypeError.
  useDesignStore.setState({ bundle, status: 'idle', lastError: null });
  useDesignStore.temporal.getState().clear();
}
