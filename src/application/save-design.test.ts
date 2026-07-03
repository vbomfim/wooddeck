/**
 * Unit tests for `src/application/save-design.ts`.
 *
 * ## Coverage map (issue #8 acceptance criteria)
 *
 *   - AC6  `saveDesignToLocalStorage(design)` succeeds on a
 *          quota-OK save and PROPAGATES `DeckFileError code:"storage-full"`
 *          unchanged when the underlying `setItem` throws
 *          `QuotaExceededError`.
 *   - Ergonomics: `downloadDesign(design)` delegates to
 *          `persistence.downloadDeckFile(design)`. We verify by
 *          spying on the persistence function and asserting the
 *          argument shape (not by asserting DOM side-effects — those
 *          are already covered exhaustively in
 *          `persistence/file-io.test.ts`).
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). We spy on
 * `Storage.prototype.setItem` for the quota simulation — matches the
 * pattern used in `persistence/local-storage.test.ts`.
 *
 * ## Why a `vi.mock('../persistence', ...)` for `downloadDeckFile`
 *
 * `downloadDeckFile` performs real DOM side-effects (Blob + object
 * URL + anchor.click), all of which are already exhaustively tested
 * in `persistence/file-io.test.ts`. Here we only need to prove the
 * APPLICATION-layer wrapper DELEGATES correctly, so we mock the
 * persistence barrel and assert the call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_DESIGNS } from '../domain/layout/__fixtures__/fixtures-data';
import {
  DeckFileError,
  STORAGE_KEY,
  loadDesignFromLocalStorage as persistenceLoadFromLocalStorage,
} from '../persistence';

import { downloadDesign, saveDesignToLocalStorage } from './save-design';

const FIXTURE = FIXTURE_DESIGNS[2]!.design; // medium-10x14

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// AC6 — save happy path
// ---------------------------------------------------------------------------

describe('saveDesignToLocalStorage — AC6 happy path', () => {
  it('persists a design so persistence.loadDesignFromLocalStorage returns it verbatim', () => {
    saveDesignToLocalStorage(FIXTURE);
    // Prove end-to-end: we can round-trip through the persistence
    // layer without going through the application-layer wrapper for
    // the load side.
    expect(persistenceLoadFromLocalStorage()).toEqual(FIXTURE);
  });

  it('writes to the frozen STORAGE_KEY (not some ad-hoc slot)', () => {
    saveDesignToLocalStorage(FIXTURE);
    // Any drift in the STORAGE_KEY would make every user's persisted
    // design invisible. The persistence-layer test already pins this;
    // this assertion belts-and-suspenders that the application
    // wrapper doesn't accidentally rewrite the key.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('is idempotent under repeated same-value writes (autosave semantics)', () => {
    saveDesignToLocalStorage(FIXTURE);
    saveDesignToLocalStorage(FIXTURE);
    saveDesignToLocalStorage(FIXTURE);
    expect(persistenceLoadFromLocalStorage()).toEqual(FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// AC6 — quota exceeded → propagate storage-full unchanged
// ---------------------------------------------------------------------------

describe('saveDesignToLocalStorage — AC6 storage-full propagates', () => {
  it('propagates DeckFileError code=storage-full when setItem throws QuotaExceededError', () => {
    // Same simulation as `persistence/local-storage.test.ts` AC8, so
    // the two suites stay in lock-step. If persistence changes how it
    // classifies quota errors, both tests fail together (loud) rather
    // than one silently drifting.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err =
        typeof DOMException === 'function'
          ? new DOMException('quota exceeded', 'QuotaExceededError')
          : Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
      throw err;
    });
    try {
      saveDesignToLocalStorage(FIXTURE);
      throw new Error('expected DeckFileError to be thrown');
    } catch (err) {
      // `.toBeInstanceOf` alone isn't enough — the application-layer
      // wrapper could have re-thrown a fresh `Error` and lost the
      // DeckFileError class + code. Assert BOTH the class AND the
      // code to prove no rewrap.
      expect(err).toBeInstanceOf(DeckFileError);
      expect((err as DeckFileError).code).toBe('storage-full');
    }
  });

  it('propagates DeckFileError code=storage-blocked on SecurityError', () => {
    // Coverage-parity with `persistence/local-storage.test.ts` for
    // the SecurityError → storage-blocked mapping. If persistence
    // maps this to a different code, this test alerts us.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err =
        typeof DOMException === 'function'
          ? new DOMException('blocked', 'SecurityError')
          : Object.assign(new Error('blocked'), { name: 'SecurityError' });
      throw err;
    });
    try {
      saveDesignToLocalStorage(FIXTURE);
      throw new Error('expected DeckFileError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      expect((err as DeckFileError).code).toBe('storage-blocked');
    }
  });
});

// ---------------------------------------------------------------------------
// downloadDesign — delegates to persistence
// ---------------------------------------------------------------------------

// Mock the persistence barrel so we can spy on `downloadDeckFile`
// without actually triggering DOM side-effects. jsdom's URL is missing
// `createObjectURL` (see `persistence/file-io.test.ts` for the same
// caveat), so calling the real function here would explode. Testing
// via mock is the right layer — the real function is exhaustively
// covered in `persistence/file-io.test.ts`.
vi.mock('../persistence', async () => {
  const actual = await vi.importActual<typeof import('../persistence')>('../persistence');
  return {
    ...actual,
    downloadDeckFile: vi.fn(),
  };
});

describe('downloadDesign — delegates to persistence.downloadDeckFile', () => {
  it('calls persistence.downloadDeckFile exactly once with the design argument', async () => {
    const persistence = await import('../persistence');
    const spy = vi.mocked(persistence.downloadDeckFile);
    spy.mockClear();

    downloadDesign(FIXTURE);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(FIXTURE);
  });

  it('does NOT pass a filename hint through — the persistence layer generates it', async () => {
    // Enforces the SECURITY posture from issue #7 §6 (repeated in
    // issue #8): the app never proposes a filename, only the
    // persistence layer's generated `wooddeck-<UTC>.deck.json`.
    // A hypothetical future overload that accepts a filename here
    // would need a ticket revision.
    const persistence = await import('../persistence');
    const spy = vi.mocked(persistence.downloadDeckFile);
    spy.mockClear();

    downloadDesign(FIXTURE);

    // The application wrapper takes exactly ONE positional argument.
    // Any second argument would signal a hidden filename override.
    expect(spy.mock.calls[0]?.length).toBe(1);
  });
});
