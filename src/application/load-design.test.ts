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
  it('resolves a DesignBundle with a design deep-equal to the source', async () => {
    const file = makeDeckFile(serialize(FIXTURE.design));
    const bundle = await loadDesignFromFile(file, table);
    expect(bundle.design).toEqual(FIXTURE.design);
  });

  it('returns a layout + warnings consistent with computeLayout + spanCheck', async () => {
    const file = makeDeckFile(serialize(FIXTURE.design));
    const bundle = await loadDesignFromFile(file, table);
    const expectedLayout = computeLayout(FIXTURE.design);
    const expectedWarnings = spanCheck(expectedLayout, table);
    // With fake timers frozen the `computedAt` inside both layouts is
    // the same ISO string, so the deep-equal is byte-stable.
    expect(bundle.layout).toEqual(expectedLayout);
    expect(bundle.warnings).toEqual(expectedWarnings);
  });

  it('returns exactly three enumerable own keys — { design, layout, warnings }', async () => {
    // Locks the S8-store spread contract: `set({ ...bundle })` must
    // populate exactly the three DesignBundle slots and NOTHING else.
    const file = makeDeckFile(serialize(FIXTURE.design));
    const bundle = await loadDesignFromFile(file, table);
    expect(Object.keys(bundle).sort()).toEqual(['design', 'layout', 'warnings']);
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

describe('loadDesignFromLocalStorage — returns DesignBundle when valid', () => {
  it('returns a DesignBundle consistent with computeLayoutAndCheck for a stored design', () => {
    persistenceSaveToLocalStorage(FIXTURE.design);
    const bundle = loadDesignFromLocalStorage(table);
    expect(bundle).not.toBeNull();
    expect(bundle!.design).toEqual(FIXTURE.design);
    const expectedLayout = computeLayout(FIXTURE.design);
    expect(bundle!.layout).toEqual(expectedLayout);
    expect(bundle!.warnings).toEqual(spanCheck(expectedLayout, table));
  });
});
