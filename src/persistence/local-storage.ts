/**
 * `src/persistence/local-storage.ts` — the `localStorage`-backed
 * adapter for the "current design" persistence slot.
 *
 * ## Interface (frozen — issue #7 §2)
 *
 *   - `STORAGE_KEY`                    — `"wooddeck:current-design:v1"`
 *   - `saveDesignToLocalStorage(D)`    — sync; may throw DeckFileError
 *   - `loadDesignFromLocalStorage()`   — never throws; returns null
 *     when no valid design is present
 *   - `clearDesignFromLocalStorage()`  — never throws; idempotent
 *
 * ## Why `save` throws but `load`/`clear` don't
 *
 * The state store (S8) needs to KNOW when a save failed — it will
 * disable autosave and prompt the user (ticket §5 Reliability). But
 * on app boot the loader runs before any UI is ready; a throw there
 * would take the whole shell down. Load and clear therefore MUST
 * fail silently and let the caller start with an empty default.
 *
 * ## Storage key freeze
 *
 * `STORAGE_KEY` is part of the on-disk contract. A rewrite is free
 * to reorganize the module, split it, rename it — but the string
 * value MUST stay `wooddeck:current-design:v1`. When the on-disk
 * shape changes (v2), a NEW key namespace ships alongside a
 * migration; the v1 slot stays untouched so downgrading is safe.
 *
 * ## Trust boundary
 *
 * `localStorage.getItem()` returns untrusted content — the user may
 * have edited it directly in DevTools, or a different app on the
 * same origin could have written to it. `loadDesignFromLocalStorage`
 * routes everything through `deserialize` (which runs Ajv schema
 * validation), so no attacker-controlled shape reaches the app.
 */
import type { DeckDesign } from '../domain/model';

import { DeckFileError } from './deck-file/errors';
import { deserialize, serialize } from './deck-file/schema-v2';

/**
 * The single localStorage slot for the current in-progress design.
 * Version suffix (`v1`) matches the `.deck` v1 envelope; a v2 file
 * format ships a NEW key so a downgrade cannot silently mis-parse.
 */
export const STORAGE_KEY = 'wooddeck:current-design:v1';

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Persist a design to `localStorage`. Synchronous — callers wrap the
 * invocation in a debounce (S8 state store, 500 ms per ticket §4).
 *
 * @throws DeckFileError code=`'storage-full'` if `setItem` throws
 *         QuotaExceededError (5–10 MB per origin on most browsers).
 * @throws DeckFileError code=`'storage-blocked'` if `localStorage` is
 *         unavailable (Safari private mode, sandboxed iframe) or
 *         `setItem` throws SecurityError.
 */
export function saveDesignToLocalStorage(design: DeckDesign): void {
  const storage = getStorageOrThrowBlocked();
  const payload = serialize(design);
  try {
    storage.setItem(STORAGE_KEY, payload);
  } catch (cause) {
    throw classifyStorageWriteError(cause);
  }
}

// ---------------------------------------------------------------------------
// Load — never throws
// ---------------------------------------------------------------------------

/**
 * Result of `loadDesignFromLocalStorage` — the parsed `DeckDesign`
 * plus the `migrated` boolean discriminator introduced in S18. When
 * `true`, the persisted slot held a v1 envelope that the loader
 * upgraded to v2 in-flight. S23's migration-toast UI will read this
 * seam; for now, callers may ignore the flag.
 */
export interface LoadFromLocalStorageResult {
  readonly design: DeckDesign;
  readonly migrated: boolean;
}

/**
 * Restore the last-saved design. Returns null when:
 *
 *   - the slot is absent (fresh install / cleared cache);
 *   - the stored value fails JSON parsing OR schema validation
 *     (corrupted / hand-edited);
 *   - `localStorage` is unavailable at all.
 *
 * Never throws — this is called during app boot before the error UI
 * is even mounted. The caller (S8 state store) treats null as "start
 * with a fresh default design"; a banner may inform the user (S12).
 *
 * The returned `migrated` flag lets callers surface an "upgraded from
 * a previous version" hint. Consumers that don't care about migration
 * status can destructure `{ design }` and drop `migrated`.
 */
export function loadDesignFromLocalStorage(): LoadFromLocalStorageResult | null {
  let raw: string | null;
  try {
    const storage = getStorageOrNull();
    if (storage === null) return null;
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    // Some browsers throw on getItem too (Safari private mode).
    // Silent-return is the contract.
    return null;
  }
  if (raw === null) return null;
  try {
    const { design, migrated } = deserialize(raw);
    return { design, migrated };
  } catch {
    // Any DeckFileError (invalid-json, schema-validation-failed,
    // unknown-schema, migration-failed) is treated as "nothing usable
    // stored" — the shell boots with a fresh design, not a partially-
    // decoded one.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Clear — never throws
// ---------------------------------------------------------------------------

/**
 * Remove the stored slot. Idempotent — safe to call when nothing is
 * stored. Silent-swallow behaviour matches load: this is invoked
 * during boot reset flows before any UI can surface an error.
 */
export function clearDesignFromLocalStorage(): void {
  try {
    const storage = getStorageOrNull();
    if (storage === null) return;
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* silent — contract per module header */
  }
}

// ---------------------------------------------------------------------------
// Internals — storage access + error classification
// ---------------------------------------------------------------------------

/**
 * Return the localStorage object, or null when it is unavailable.
 * Some browsers throw when you MERELY access `window.localStorage`
 * (Firefox with `dom.storage.enabled=false`, Safari private mode in
 * sandboxed iframes). The try/catch swallows the access-time throw.
 */
function getStorageOrNull(): Storage | null {
  try {
    // `globalThis` is safer than `window` — works in worker contexts
    // and in Node vitest env alike.
    const g = globalThis as { localStorage?: Storage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Access variant for the SAVE path — a null storage becomes a
 * `storage-blocked` DeckFileError, so the caller learns about the
 * failure instead of silently losing data.
 */
function getStorageOrThrowBlocked(): Storage {
  const storage = getStorageOrNull();
  if (storage === null) {
    throw new DeckFileError(
      'storage-blocked',
      'localStorage is not available in this browser (private mode, sandboxed iframe, or explicit block)',
    );
  }
  return storage;
}

/**
 * Map a browser storage write error to the appropriate DeckFileError
 * code. We recognize the two named DOMException variants; anything
 * else is conservatively treated as blocked (opaque failure surface
 * is worse than a mis-labelled but correct-shape error).
 */
function classifyStorageWriteError(cause: unknown): DeckFileError {
  const name = readErrorName(cause);
  if (name === 'QuotaExceededError') {
    return new DeckFileError(
      'storage-full',
      'localStorage quota exceeded — cannot autosave the current design',
      cause,
    );
  }
  if (name === 'SecurityError') {
    return new DeckFileError(
      'storage-blocked',
      'localStorage write blocked (private mode or permission policy)',
      cause,
    );
  }
  // Unknown write failures should surface as storage-blocked rather
  // than silently succeed. A future contributor can widen the codes
  // if a new well-known DOMException name shows up in the wild.
  return new DeckFileError(
    'storage-blocked',
    `localStorage write failed with unrecognized error: ${name}`,
    cause,
  );
}

function readErrorName(cause: unknown): string {
  if (cause !== null && typeof cause === 'object' && 'name' in cause) {
    const raw = cause.name;
    if (typeof raw === 'string') return raw;
  }
  return 'Unknown';
}
