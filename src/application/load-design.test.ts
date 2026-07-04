/**
 * Unit tests for `src/application/load-design.ts`.
 *
 * ## Coverage map (issue #8 acceptance criteria)
 *
 *   - AC2  Load from file (happy path) → `DesignBundle` where
 *          `design`, `layout`, and `warnings` are internally
 *          consistent.
 *          Test path: build a REAL `.deck` v1 file via
 *          `persistence.serialize` → wrap in a jsdom `File` →
 *          `loadDesignFromFile` → assert bundle.
 *   - AC3  Load from a file with unknown-schema envelope → rejects
 *          with the SAME `DeckFileError` (`code:"unknown-schema"`),
 *          unchanged. Proves the use-case does NOT rewrap
 *          persistence errors.
 *   - Edge: `loadDesignFromLocalStorage(table)` returns `null` when
 *          `persistence.loadDesignFromLocalStorage` returns `null`
 *          (no stored design, corrupted stored design, or storage
 *          unavailable).
 *   - Edge: `loadDesignFromLocalStorage(table)` returns a full
 *          `DesignBundle` when a valid design is present.
 *   - Edge: loading a file whose material triples are not in the
 *          catalog → propagates the `LayoutError` from
 *          `computeLayout` unchanged (see issue #8 §4 Edge cases).
 *   - Edge: `readDeckFile` DoS cap (10 MB) — the use-case must
 *          propagate `DeckFileError code:"file-too-large"` unchanged
 *          without any layout compute attempt.
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). jsdom implements `File`,
 * `Blob`, `FileReader`, and `localStorage`, so we can exercise the
 * REAL persistence path (issue #8 §18: mocked persistence + real
 * domain — but AC2/AC3 explicitly say to exercise the real
 * persistence path with a jsdom File).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeLayout, LayoutError } from '../domain/layout';
import { spanCheck, IrcSpanTable } from '../domain/spans';
import { FIXTURE_DESIGNS } from '../domain/layout/__fixtures__/fixtures-data';
import {
  DeckFileError,
  STORAGE_KEY,
  saveDesignToLocalStorage as persistenceSaveToLocalStorage,
  serialize,
} from '../persistence';

import { loadDesignFromFile, loadDesignFromLocalStorage } from './load-design';

const table = new IrcSpanTable();
const FIXTURE = FIXTURE_DESIGNS[2]!; // medium-10x14 — proven layout-valid

/**
 * Build a `.deck` v1 `File` object with a specified name / content.
 * jsdom implements the `File` constructor so this exercises the real
 * upload path all the way through `FileReader`.
 */
function makeDeckFile(contents: string, name = 'test.deck.json'): File {
  return new File([contents], name, { type: 'application/json' });
}

beforeEach(() => {
  // Fake `Date` ONLY — not `setTimeout` / `setImmediate`. jsdom's
  // `FileReader.readAsText` schedules its `onload` via `setTimeout`,
  // so faking timers globally would deadlock every AC2/AC3 test on
  // the Promise from `readDeckFile`. We still need a frozen clock so
  // that a re-invocation of `computeLayout` inside a test produces
  // the same `Layout.computedAt` for the byte-stable deep-equal.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-03T10:00:00.000Z'));
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// AC2 — file happy path
// ---------------------------------------------------------------------------

describe('loadDesignFromFile — AC2 happy path', () => {
  it('resolves a result with a design deep-equal to the source', async () => {
    const file = makeDeckFile(serialize(FIXTURE.design));
    const { bundle } = await loadDesignFromFile(file, table);
    expect(bundle.design).toEqual(FIXTURE.design);
  });

  it('returns a layout + warnings consistent with computeLayout + spanCheck', async () => {
    const file = makeDeckFile(serialize(FIXTURE.design));
    const { bundle } = await loadDesignFromFile(file, table);
    const expectedLayout = computeLayout(FIXTURE.design);
    const expectedWarnings = spanCheck(expectedLayout, table);
    // With fake timers frozen the `computedAt` inside both layouts is
    // the same ISO string, so the deep-equal is byte-stable.
    expect(bundle.layout).toEqual(expectedLayout);
    expect(bundle.warnings).toEqual(expectedWarnings);
  });

  it('returns a bundle with exactly three enumerable own keys — { design, layout, warnings }', async () => {
    // Locks the S8-store spread contract: `set({ ...bundle })` must
    // populate exactly the three DesignBundle slots and NOTHING else.
    const file = makeDeckFile(serialize(FIXTURE.design));
    const { bundle } = await loadDesignFromFile(file, table);
    expect(Object.keys(bundle).sort()).toEqual(['design', 'layout', 'warnings']);
  });

  it('reports `migrated: false` when the file is a native v2 envelope (S18 AC9)', async () => {
    const file = makeDeckFile(serialize(FIXTURE.design));
    const { migrated } = await loadDesignFromFile(file, table);
    expect(migrated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC3 — unknown-schema envelope → propagate unchanged
// ---------------------------------------------------------------------------

describe('loadDesignFromFile — AC3 propagates DeckFileError unchanged', () => {
  it('rejects with code=unknown-schema when the envelope schema is not v1', async () => {
    // Hand-craft an envelope with a future schema version — persistence
    // must throw `DeckFileError('unknown-schema')`, and the use-case
    // must let it through without rewrapping. Note: the envelope's
    // `schema` field is a NUMBER (the precheck in `deserialize`
    // fires when it is a positive integer outside the known set —
    // see `deserialize` module docs).
    const unknown = JSON.stringify({
      schema: 42,
      generator: 'wooddeck',
      generatorVersion: '99.99.99',
      createdAt: '2026-07-03T10:00:00.000Z',
      design: FIXTURE.design,
    });
    const file = makeDeckFile(unknown);
    await expect(loadDesignFromFile(file, table)).rejects.toBeInstanceOf(DeckFileError);
    // Also assert the specific code — proves NO rewrap occurred.
    await expect(loadDesignFromFile(file, table)).rejects.toMatchObject({
      code: 'unknown-schema',
    });
  });

  it('rejects with code=schema-validation-failed on a v1 envelope with a bad design shape', async () => {
    // Also demonstrates propagation, this time from the JSON-Schema
    // validator — again, use-case must NOT rewrap.
    const bad = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '99.99.99',
      createdAt: '2026-07-03T10:00:00.000Z',
      design: { id: 'not-a-uuid' }, // missing everything else
    });
    const file = makeDeckFile(bad);
    await expect(loadDesignFromFile(file, table)).rejects.toMatchObject({
      code: 'schema-validation-failed',
    });
  });

  it('rejects with code=invalid-json when the file content is not JSON', async () => {
    const file = makeDeckFile('<<< not json >>>');
    await expect(loadDesignFromFile(file, table)).rejects.toMatchObject({
      code: 'invalid-json',
    });
  });
});

// ---------------------------------------------------------------------------
// Edge — DoS cap (10 MB) propagates without layout attempt
// ---------------------------------------------------------------------------

describe('loadDesignFromFile — DoS cap propagates before layout compute', () => {
  it('rejects with code=file-too-large for an oversized File', async () => {
    // Fake a 20 MB file via a Blob-slice-style size — jsdom's File
    // uses the underlying string length. Build a big string.
    const bigString = 'x'.repeat(11 * 1024 * 1024);
    const file = makeDeckFile(bigString);
    await expect(loadDesignFromFile(file, table)).rejects.toMatchObject({
      code: 'file-too-large',
    });
  });
});

// ---------------------------------------------------------------------------
// Edge — designs that pass persistence's schema but fail computeLayout
// (dimensional invalidity OR unknown material triple) MUST propagate
// `LayoutError` from the layout engine unchanged.
// ---------------------------------------------------------------------------

describe('loadDesignFromFile — LayoutError propagation from computeLayout', () => {
  it('propagates LayoutError when a persisted design has a dimensionally-invalid footprint', () => {
    // Build a v1-schema-valid envelope with a footprint too small for
    // the layout engine (widthMm = 100). Persistence accepts it (the
    // JSON schema doesn't currently enforce the min-4ft rule), so the
    // failure surfaces from `computeLayout` as `LayoutError` — and
    // the use-case MUST propagate it unchanged.
    const invalid = {
      ...FIXTURE.design,
      footprint: { ...FIXTURE.design.footprint, widthMm: 100 },
    };
    const file = makeDeckFile(serialize(invalid));
    // The use-case does not rewrap; `LayoutError` reaches the caller.
    return expect(loadDesignFromFile(file, table)).rejects.toThrow(/LayoutError|below|minimum/i);
  });

  it('propagates LayoutError when a persisted design references a material triple absent from the catalog', () => {
    // Composite species is a REAL enum value AND grade "No2" is a
    // real enum value — so the JSON schema (which only checks the
    // enums, not the (species, grade) coupling) accepts this design.
    // But `lookupMaterial` rejects the triple `(5/4x6, Composite,
    // No2)` because Composite is only ever paired with grade "NA"
    // in the catalog. The failure surfaces from `computeLayout` as
    // `LayoutError` and MUST propagate unchanged.
    const unknownMaterial = {
      ...FIXTURE.design,
      decking: {
        material: { nominal: '5/4x6' as const, species: 'Composite' as const, grade: 'No2' as const },
        orientation: FIXTURE.design.decking.orientation,
      },
    };
    const file = makeDeckFile(serialize(unknownMaterial));
    return expect(loadDesignFromFile(file, table)).rejects.toBeInstanceOf(LayoutError);
  });
});

// ---------------------------------------------------------------------------
// loadDesignFromLocalStorage — returns bundle OR null
// ---------------------------------------------------------------------------

describe('loadDesignFromLocalStorage — returns null when no stored design', () => {
  it('returns null when the storage slot is empty', () => {
    expect(loadDesignFromLocalStorage(table)).toBeNull();
  });

  it('returns null when the stored value is corrupted (invalid JSON)', () => {
    window.localStorage.setItem(STORAGE_KEY, '<<< not json >>>');
    // The persistence loader swallows the DeckFileError and returns
    // null (its documented contract). The application wrapper must
    // preserve that null.
    expect(loadDesignFromLocalStorage(table)).toBeNull();
  });
});

describe('loadDesignFromLocalStorage — returns bundle-result when valid', () => {
  it('returns a DesignBundle consistent with computeLayoutAndCheck for a stored design', () => {
    persistenceSaveToLocalStorage(FIXTURE.design);
    const result = loadDesignFromLocalStorage(table);
    expect(result).not.toBeNull();
    expect(result!.bundle.design).toEqual(FIXTURE.design);
    const expectedLayout = computeLayout(FIXTURE.design);
    expect(result!.bundle.layout).toEqual(expectedLayout);
    expect(result!.bundle.warnings).toEqual(spanCheck(expectedLayout, table));
    // S18 AC9: v2 native envelope → migrated:false.
    expect(result!.migrated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review-gate FIX 1 — loader integration for compat + support gates
// ---------------------------------------------------------------------------
//
// The compat matrix (FR-030) + support gate live inside `computeLayout`,
// which every ingress funnels through. These tests exercise the two
// concrete ingresses (`readDeckFile` and `loadDesignFromLocalStorage`)
// with hand-crafted v2 envelopes carrying illegal AND not-yet-implemented
// structure×foundation combos, and prove the LayoutError surfaces to the
// application-layer caller (the persistence layer did NOT swallow it, and
// the use-case did NOT rewrap it).

describe('loadDesignFromFile — FIX 1 compat/support gate propagates', () => {
  it('propagates LayoutError for FR-030-illegal elevated + tuffblocks combo', async () => {
    const illegal = {
      ...FIXTURE.design,
      structure: 'elevated' as const,
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
      },
    };
    const file = makeDeckFile(serialize(illegal));
    await expect(loadDesignFromFile(file, table)).rejects.toBeInstanceOf(LayoutError);
    await expect(loadDesignFromFile(file, table)).rejects.toThrow(/TuffBlock/i);
  });

  it('propagates LayoutError "not yet implemented" for elevated + deck-blocks (S20)', async () => {
    const notImpl = {
      ...FIXTURE.design,
      structure: 'elevated' as const,
      foundation: {
        type: 'deck-blocks' as const,
        product: { productId: 'oldcastle-11x11x7' as const },
      },
    };
    const file = makeDeckFile(serialize(notImpl));
    await expect(loadDesignFromFile(file, table)).rejects.toBeInstanceOf(LayoutError);
    await expect(loadDesignFromFile(file, table)).rejects.toThrow(/not yet implemented/i);
  });
});

describe('loadDesignFromLocalStorage — FIX 1 compat/support gate propagates', () => {
  it('propagates LayoutError for FR-030-illegal floating + posts-on-footings combo', () => {
    // Build a v2 envelope by hand — persistence.saveDesignToLocalStorage
    // routes through validation-on-save which would ALSO reject this
    // design (defense-in-depth is good), so we bypass save by writing
    // the raw envelope string into the storage slot directly.
    const illegal = {
      ...FIXTURE.design,
      structure: 'floating' as const,
      foundation: {
        type: 'posts-on-footings' as const,
        post: { nominal: '6x6' as const, species: 'PT' as const, grade: 'No2' as const },
        footing: { widthMm: 300, depthMm: 300 },
      },
    };
    // `serialize` writes a well-formed v2 envelope (schema OK); the
    // compat rejection happens later in computeLayout via loader.
    window.localStorage.setItem(STORAGE_KEY, serialize(illegal));
    expect(() => loadDesignFromLocalStorage(table)).toThrow(LayoutError);
    expect(() => loadDesignFromLocalStorage(table)).toThrow(/floating/i);
  });
});

// ---------------------------------------------------------------------------
// FIX 2 (review gate) — post-material save→load round-trip preservation.
// ---------------------------------------------------------------------------
//
// Regression guard against the pre-fix DUAL SOURCE OF TRUTH bug:
// pre-FIX-2 the design had BOTH `design.post` and `foundation.post`;
// UI edits patched only the top-level field, leaving `foundation.post`
// stale — so save/load persisted contradictory post materials. FIX 2
// removed `design.post` entirely and re-pointed post-layout,
// migration, and the UI at `foundation.post` as the single source of
// truth. This test locks that in end-to-end.

describe('save→load round-trip — FIX 2 post material preserved with no contradiction', () => {
  it('a design with a specific post material round-trips through save+load with foundation.post intact and NO top-level `post` field', () => {
    // Start from the medium fixture and rewrite `foundation.post` to
    // a distinctive material triple (4x4 Cedar No2 — stocked SKU) so
    // the assertion catches a value that could only survive if the
    // SoT is honoured.
    const distinctive = {
      ...FIXTURE.design,
      foundation: {
        type: 'posts-on-footings' as const,
        post: {
          nominal: '4x4' as const,
          species: 'Cedar' as const,
          grade: 'No2' as const,
        },
        footing: { widthMm: 300, depthMm: 300 },
      },
    };

    // Route through the REAL persistence save (writes a v2 envelope
    // to localStorage) then the application-layer loader (which runs
    // schema validation + migration branch + computeLayout).
    persistenceSaveToLocalStorage(distinctive);
    const result = loadDesignFromLocalStorage(table);
    expect(result).not.toBeNull();

    const loaded = result!.bundle.design;
    // The SoT survives the round-trip byte-for-byte.
    if (loaded.foundation.type !== 'posts-on-footings') {
      throw new Error(
        `expected 'posts-on-footings' but got '${loaded.foundation.type}'`,
      );
    }
    expect(loaded.foundation.post).toEqual({
      nominal: '4x4',
      species: 'Cedar',
      grade: 'No2',
    });
    // Regression guard — top-level `post` MUST NOT re-appear after
    // save/load. If persistence starts emitting a legacy field, this
    // is where we catch it before it splits the SoT again.
    expect((loaded as { post?: unknown }).post).toBeUndefined();
  });
});
