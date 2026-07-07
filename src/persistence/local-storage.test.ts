/**
 * Unit tests for `src/persistence/local-storage.ts` — the persistent
 * adapter that saves/loads the current `DeckDesign` via `localStorage`.
 *
 * ## Coverage map (issue #7 acceptance criteria)
 *
 *   - AC7  save + load round-trip (deep-equal).
 *   - AC8  QuotaExceededError → `DeckFileError code:"storage-full"`.
 *   - Edge: SecurityError / unavailable storage → `"storage-blocked"`.
 *   - `loadDesignFromLocalStorage` returns null on absent, invalid JSON,
 *     or schema-validation failure — NEVER throws (contract in ticket
 *     §2 interface).
 *   - `clearDesignFromLocalStorage` really removes the slot.
 *   - `STORAGE_KEY` is frozen to `wooddeck:current-design:v1`.
 *
 * ## Test env
 *
 * Vitest default env for wooddeck is jsdom — jsdom implements
 * `Storage` and `localStorage` natively. Where a test needs to
 * simulate a browser behaviour jsdom doesn't (quota exceeded,
 * SecurityError from `setItem`), the test uses `vi.spyOn` on
 * `Storage.prototype` so the mock is scoped and cleanly restored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STORAGE_KEY,
  clearDesignFromLocalStorage,
  loadDesignFromLocalStorage,
  saveDesignToLocalStorage,
} from './local-storage';
import { DeckFileError } from './deck-file/errors';
import { GOLDEN_DECK_DESIGN, SECOND_GOLDEN_DECK_DESIGN } from './deck-file/__fixtures__/deck-designs';

// Isolate every test so a leaked storage entry from a prior run
// can't cross-contaminate.
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// Frozen constant
// ---------------------------------------------------------------------------

describe('STORAGE_KEY', () => {
  it('is the frozen value `wooddeck:current-design:v1`', () => {
    // Ticket §12 says this key ships once and any on-disk shape
    // change gets a new namespace. If a rewrite drifts this string,
    // every persisted design across every user's browser becomes
    // invisible — this test is the last line of defence.
    expect(STORAGE_KEY).toBe('wooddeck:current-design:v1');
  });
});

// ---------------------------------------------------------------------------
// AC7 — save + load round-trip
// ---------------------------------------------------------------------------

describe('saveDesignToLocalStorage / loadDesignFromLocalStorage — AC7', () => {
  it('load returns { design, migrated:false } for a v2 save (S18)', () => {
    saveDesignToLocalStorage(GOLDEN_DECK_DESIGN);
    const loaded = loadDesignFromLocalStorage();
    expect(loaded).not.toBeNull();
    expect(loaded!.design).toEqual(GOLDEN_DECK_DESIGN);
    expect(loaded!.migrated).toBe(false);
  });

  it('overwrites the slot on a second save (last-write wins)', () => {
    saveDesignToLocalStorage(GOLDEN_DECK_DESIGN);
    saveDesignToLocalStorage(SECOND_GOLDEN_DECK_DESIGN);
    const loaded = loadDesignFromLocalStorage();
    expect(loaded).not.toBeNull();
    expect(loaded!.design).toEqual(SECOND_GOLDEN_DECK_DESIGN);
  });

  it('writes to `STORAGE_KEY` a v2-shaped envelope (S18 AC10 — save defaults to v2)', () => {
    saveDesignToLocalStorage(GOLDEN_DECK_DESIGN);
    // The stored value is the FULL serialized envelope, not the raw
    // design — that way `load` can validate before accepting.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw?.startsWith('{"schema":2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC8 — quota exceeded → storage-full
// ---------------------------------------------------------------------------

describe('saveDesignToLocalStorage — AC8 storage-full', () => {
  it('throws DeckFileError code=storage-full when setItem throws QuotaExceededError', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      // jsdom provides `DOMException` — use it if available for
      // realism; fall back to a plain Error with the well-known name.
      const err =
        typeof DOMException === 'function'
          ? new DOMException('quota exceeded', 'QuotaExceededError')
          : Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
      throw err;
    });
    try {
      saveDesignToLocalStorage(GOLDEN_DECK_DESIGN);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      expect((err as DeckFileError).code).toBe('storage-full');
      // The underlying DOMException should be chained via .cause so
      // devs can see it in stack traces.
      expect((err as DeckFileError).cause).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Edge — SecurityError / storage unavailable → storage-blocked
// ---------------------------------------------------------------------------

describe('saveDesignToLocalStorage — storage-blocked', () => {
  it('throws code=storage-blocked when setItem throws SecurityError (private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err =
        typeof DOMException === 'function'
          ? new DOMException('storage blocked', 'SecurityError')
          : Object.assign(new Error('storage blocked'), { name: 'SecurityError' });
      throw err;
    });
    try {
      saveDesignToLocalStorage(GOLDEN_DECK_DESIGN);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      expect((err as DeckFileError).code).toBe('storage-blocked');
    }
  });

  it('classifies unrecognized setItem errors as storage-blocked (defensive)', () => {
    // Some future browser could invent a new DOMException name — the
    // safe fallback is to disable autosave, not silently succeed.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('mystery'), { name: 'NewMysteryError' });
    });
    try {
      saveDesignToLocalStorage(GOLDEN_DECK_DESIGN);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      expect((err as DeckFileError).code).toBe('storage-blocked');
      expect((err as DeckFileError).message).toContain('NewMysteryError');
    }
  });

  it('classifies non-Error thrown values (e.g. a bare string) as storage-blocked', () => {
    // `readErrorName` returns 'Unknown' when the caught value has no
    // `.name` — this exercises that branch AND the unrecognized-name
    // fallback in one shot.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a plain string, not an Error';
    });
    try {
      saveDesignToLocalStorage(GOLDEN_DECK_DESIGN);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      expect((err as DeckFileError).code).toBe('storage-blocked');
    }
  });

  it('throws code=storage-blocked when localStorage itself is unavailable', () => {
    // Simulate a browser where accessing `window.localStorage` throws
    // (e.g. sandboxed iframe, tightened cookie policy).
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('storage disabled', 'SecurityError');
      },
    });
    try {
      expect(() => saveDesignToLocalStorage(GOLDEN_DECK_DESIGN)).toThrowError(
        expect.objectContaining({ code: 'storage-blocked' }),
      );
    } finally {
      // Restore so subsequent tests can use jsdom's localStorage.
      if (orig) {
        Object.defineProperty(window, 'localStorage', orig);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// loadDesignFromLocalStorage — never throws
// ---------------------------------------------------------------------------

describe('loadDesignFromLocalStorage — resilience', () => {
  it('returns null when the slot is absent', () => {
    // localStorage was cleared in beforeEach — no entry set.
    expect(loadDesignFromLocalStorage()).toBeNull();
  });

  it('returns null when the stored value is invalid JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-json {');
    expect(loadDesignFromLocalStorage()).toBeNull();
  });

  it('returns null when the stored value fails schema validation', () => {
    // A valid v1 envelope but with a design missing footprint.
    const bad = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: { id: 'not-a-uuid' },
    });
    window.localStorage.setItem(STORAGE_KEY, bad);
    expect(loadDesignFromLocalStorage()).toBeNull();
  });

  it('returns null when the stored value has an unknown schema', () => {
    // Fabricate an envelope with a schema value outside KNOWN_SCHEMA_VERSIONS.
    // Using schema=999 directly (not `.replace`) since the emitted
    // envelope now has `schema:2`, not `schema:1`.
    const rogue = JSON.stringify({
      schema: 999,
      generator: 'wooddeck',
      generatorVersion: '9.9.9',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    window.localStorage.setItem(STORAGE_KEY, rogue);
    expect(loadDesignFromLocalStorage()).toBeNull();
  });

  it('returns null (and does NOT throw) when localStorage getItem throws', () => {
    // A browser with unusual policies (Safari private, some iframes)
    // may throw on getItem. The contract is: load never throws.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError');
    });
    expect(() => loadDesignFromLocalStorage()).not.toThrow();
    expect(loadDesignFromLocalStorage()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clearDesignFromLocalStorage
// ---------------------------------------------------------------------------

describe('clearDesignFromLocalStorage', () => {
  it('removes the stored slot', () => {
    saveDesignToLocalStorage(GOLDEN_DECK_DESIGN);
    expect(loadDesignFromLocalStorage()).not.toBeNull();
    clearDesignFromLocalStorage();
    expect(loadDesignFromLocalStorage()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('is a no-op when nothing is stored', () => {
    expect(() => clearDesignFromLocalStorage()).not.toThrow();
  });

  it('swallows storage-unavailable errors (never throws)', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('storage blocked', 'SecurityError');
    });
    // clear() is used at app-boot resets — a throw would crash the
    // shell for users with restricted storage. Contract: never throw.
    expect(() => clearDesignFromLocalStorage()).not.toThrow();
  });
});
