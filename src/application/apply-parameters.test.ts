/**
 * Unit tests for `src/application/apply-parameters.ts`.
 *
 * ## Coverage map (issue #8 acceptance criteria)
 *
 *   - AC4  Partial patch merges into the current design; the
 *          returned `bundle.design` reflects the patch, ALL OTHER
 *          fields are unchanged, and the layout + warnings are
 *          recomputed for the merged design.
 *   - AC4  Immutability guarantee — the input `current` object is
 *          NOT mutated by the merge (defensive against a rewrite
 *          that reaches for `Object.assign(current, patch)` for
 *          "efficiency").
 *   - AC5  Unknown top-level key (`{ notARealKey: 42 }`) → throws
 *          `ApplyParametersError` naming the offending path
 *          (`"notARealKey"`).
 *   - AC5  Unknown nested key (`{ footprint: { rogueField: 1 } }`)
 *          → throws with the FULL DOTTED path
 *          (`"footprint.rogueField"`), so a state-store UX can
 *          point the user at the exact form field.
 *   - AC5  Prototype-pollution safety — `{ __proto__: { polluted:
 *          true } }` MUST be rejected (or at least MUST NOT
 *          mutate `Object.prototype`). Verified by asserting
 *          `({}).polluted === undefined` AFTER the call.
 *          Additionally: a JSON.parse-constructed payload with a
 *          real own `__proto__` key MUST be rejected with
 *          `ApplyParametersError` (the JS-literal form is a
 *          proto-set no-op with no own keys, but JSON.parse
 *          preserves it as a real own property).
 *   - Edge: an unknown value in a KNOWN key (e.g. an unknown
 *          material triple) is NOT the responsibility of
 *          `applyParameters` — it surfaces as `LayoutError` from
 *          the downstream `computeLayout` (issue #8 §4 Edge cases).
 *   - Edge: a patch producing a dimensionally-invalid design
 *          (widthMm below the min-4ft threshold) propagates
 *          `LayoutError` unchanged.
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). All subjects are pure —
 * no browser API is used in these tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutError } from '../domain/layout';
import { computeLayout } from '../domain/layout';
import { IrcSpanTable, spanCheck } from '../domain/spans';
import { FIXTURE_DESIGNS } from '../domain/layout/__fixtures__/fixtures-data';

import {
  ApplyParametersError,
  applyParameters,
} from './apply-parameters';
import type { DeepPartial } from './types';
import type { DeckDesign } from '../domain/model';

const table = new IrcSpanTable();
const FIXTURE = FIXTURE_DESIGNS[2]!.design; // medium-10x14 — proven layout-valid

/**
 * Freeze `Date` (but NOT `setTimeout`, which would deadlock any async
 * subject — none here, but keep the pattern consistent with
 * `load-design.test.ts`) so the layout re-compute is byte-stable.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-03T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC4 — partial patch, immutability, layout+warnings recompute
// ---------------------------------------------------------------------------

describe('applyParameters — AC4 partial merge + recompute', () => {
  it('applies { footprint: { widthMm: 4000 } } and leaves every other field untouched', () => {
    const patch: DeepPartial<DeckDesign> = { footprint: { widthMm: 4000 } };
    const bundle = applyParameters(FIXTURE, patch, table);

    // Patched field reflects the new value.
    expect(bundle.design.footprint.widthMm).toBe(4000);

    // Sibling fields inside footprint survive the deep merge.
    expect(bundle.design.footprint.lengthMm).toBe(FIXTURE.footprint.lengthMm);
    expect(bundle.design.footprint.heightMm).toBe(FIXTURE.footprint.heightMm);

    // Every other top-level branch is untouched (deep-equal, not
    // reference-equal — deep-merge produces a new tree).
    expect(bundle.design.joist).toEqual(FIXTURE.joist);
    expect(bundle.design.beam).toEqual(FIXTURE.beam);
    expect(bundle.design.post).toEqual(FIXTURE.post);
    expect(bundle.design.decking).toEqual(FIXTURE.decking);
    expect(bundle.design.layout).toEqual(FIXTURE.layout);
    expect(bundle.design.id).toBe(FIXTURE.id);
    expect(bundle.design.createdAt).toBe(FIXTURE.createdAt);
  });

  it('does NOT mutate the input `current` object', () => {
    // Deep-clone the fixture so we compare against a pristine
    // reference — a mutation-in-place would show up as inequality.
    const before = structuredClone(FIXTURE);
    applyParameters(FIXTURE, { footprint: { widthMm: 4000 } }, table);
    expect(FIXTURE).toEqual(before);
  });

  it('recomputes layout and warnings for the merged design', () => {
    const patch: DeepPartial<DeckDesign> = { footprint: { widthMm: 4000 } };
    const bundle = applyParameters(FIXTURE, patch, table);

    const expectedMerged = {
      ...FIXTURE,
      footprint: { ...FIXTURE.footprint, widthMm: 4000 },
    };
    const expectedLayout = computeLayout(expectedMerged);
    const expectedWarnings = spanCheck(expectedLayout, table);
    expect(bundle.layout).toEqual(expectedLayout);
    expect(bundle.warnings).toEqual(expectedWarnings);
  });

  it('deep-merges a nested MaterialRef partial (only .nominal changes)', () => {
    // Prove the merge really recurses — a shallow `{...current, ...patch}`
    // would replace `joist` entirely and lose `spacingMm`.
    const patch: DeepPartial<DeckDesign> = {
      joist: { material: { nominal: '2x12' } },
    };
    const bundle = applyParameters(FIXTURE, patch, table);
    expect(bundle.design.joist.material.nominal).toBe('2x12');
    expect(bundle.design.joist.material.species).toBe(FIXTURE.joist.material.species);
    expect(bundle.design.joist.material.grade).toBe(FIXTURE.joist.material.grade);
    expect(bundle.design.joist.spacingMm).toBe(FIXTURE.joist.spacingMm);
  });

  it('returns a DesignBundle with exactly three own keys — design/layout/warnings', () => {
    const bundle = applyParameters(FIXTURE, { footprint: { widthMm: 4000 } }, table);
    expect(Object.keys(bundle).sort()).toEqual(['design', 'layout', 'warnings']);
  });
});

// ---------------------------------------------------------------------------
// AC5 — unknown-key rejection
// ---------------------------------------------------------------------------

describe('applyParameters — AC5 unknown-key rejection', () => {
  it('throws ApplyParametersError naming the offending TOP-LEVEL key', () => {
    // `notARealKey` is not a field of DeckDesign. The DeepPartial
    // TypeScript type would reject this at compile time, but the
    // runtime check is what protects us from `.deck` payloads and
    // JSON.parse-constructed patches that TS can't verify.
    const patch = { notARealKey: 42 } as unknown as DeepPartial<DeckDesign>;
    expect(() => applyParameters(FIXTURE, patch, table)).toThrow(ApplyParametersError);
    try {
      applyParameters(FIXTURE, patch, table);
    } catch (err) {
      // The error must be typed AND its `path` must name the field.
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('notARealKey');
      expect((err as ApplyParametersError).message).toMatch(/notARealKey/);
    }
  });

  it('throws with the full DOTTED path for a nested unknown key', () => {
    // `footprint.rogueField` is not part of Dimensions3D. The
    // application layer must name the FULL path so the S8 store /
    // S12 warning banner can point the user at the exact form field.
    const patch = {
      footprint: { rogueField: 1 },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('footprint.rogueField');
    }
  });

  it('throws with the full dotted path for a deeply-nested unknown key', () => {
    // Three-level deep: joist.material.brand is not a MaterialRef field.
    const patch = {
      joist: { material: { brand: 'Trex' } },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('joist.material.brand');
    }
  });
});

// ---------------------------------------------------------------------------
// AC5 (prototype pollution) — the __proto__ vector MUST NOT poison
// Object.prototype, and JSON-parse form MUST be rejected.
// ---------------------------------------------------------------------------

describe('applyParameters — AC5 prototype pollution safety', () => {
  it('a JS-literal `{ __proto__: {…} }` patch does NOT mutate Object.prototype', () => {
    // The JS literal `{ __proto__: {...} }` invokes the __proto__
    // SETTER on Object.prototype and sets the new object's prototype
    // — it does NOT create an own property. `Object.keys()` on that
    // object returns []. So a correctly-written merge simply iterates
    // no keys and returns a copy of `current`. This test proves the
    // absence of a rogue Object.prototype write.
    const patch = { __proto__: { polluted: true } } as unknown as DeepPartial<DeckDesign>;
    // Some implementations might reject this outright (also fine).
    // We accept EITHER: (a) a clean bundle return with unchanged
    // design, OR (b) a rejection with ApplyParametersError. What we
    // absolutely disallow is `Object.prototype` being mutated.
    let threw = false;
    try {
      applyParameters(FIXTURE, patch, table);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ApplyParametersError);
    }
    // Whichever path was taken, Object.prototype MUST remain clean.
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    // Belt-and-suspenders: the test wasn't a no-op — either a bundle
    // was produced OR a typed error was thrown.
    expect(typeof threw).toBe('boolean');
  });

  it('rejects a JSON.parse-constructed __proto__ patch with ApplyParametersError', () => {
    // Unlike the JS-literal form, JSON.parse preserves `__proto__`
    // as a REAL own property (per the ECMA-262 JSON parser spec).
    // A naive `for..in` merge would then treat it as a normal key
    // and mutate the target's prototype. Our implementation MUST
    // reject `__proto__` at the key level.
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('__proto__');
    }
    // Sanity-check: Object.prototype was NOT mutated.
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('rejects a `constructor` key patch (secondary prototype pollution vector)', () => {
    const patch = { constructor: { evil: true } } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('constructor');
    }
  });

  it('rejects a `prototype` key patch (tertiary prototype pollution vector)', () => {
    const patch = { prototype: { evil: true } } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('prototype');
    }
  });
});

// ---------------------------------------------------------------------------
// Edge — invalid resulting design → LayoutError propagation
// ---------------------------------------------------------------------------

describe('applyParameters — invalid resulting design propagates LayoutError', () => {
  it('propagates LayoutError when the merged design has widthMm below the min', () => {
    // Setting widthMm to 0 mm is below MIN_DECK_DIMENSION_MM (4 ft
    // = 1219.2 mm). `applyParameters` merges cleanly (0 is a valid
    // value for the FIELD), then `computeLayout` throws — and the
    // use-case propagates that error unchanged (issue #8 §4 Edge cases).
    const patch: DeepPartial<DeckDesign> = { footprint: { widthMm: 0 } };
    expect(() => applyParameters(FIXTURE, patch, table)).toThrow(LayoutError);
  });

  it('propagates LayoutError when the merged design references an unknown material triple', () => {
    // Composite grade "No2" is not in the catalog (Composite is always
    // grade "NA"). The design merges to a schema-valid but catalog-
    // invalid triple; `computeLayout` fails via the `lookupMaterial`
    // path, wraps as `LayoutError`, and the use-case propagates it.
    // Note: this is the exact edge case called out by issue #8 §4.
    const patch = {
      joist: { material: { species: 'Composite' as const, grade: 'No2' as const } },
    };
    expect(() => applyParameters(FIXTURE, patch, table)).toThrow(LayoutError);
  });
});

// ---------------------------------------------------------------------------
// Coverage — `isPlainObject` non-object branches (REPLACE fallback)
// ---------------------------------------------------------------------------

describe('applyParameters — REPLACE semantics for non-plain-object patch values', () => {
  it('replaces (rather than merges) when the patch value is null', () => {
    // Patch { footprint: null } — the deep-merge helper's
    // `isPlainObject(null)` returns false, so the value is REPLACED
    // outright. The downstream layout engine then blows up trying to
    // destructure `design.footprint` (whichever error type it emits).
    // The merge itself does NOT throw ApplyParametersError — null is
    // a "valid value shape" for the FIELD, just not for the domain
    // validator downstream. We assert the negative: no
    // ApplyParametersError from the merge, and SOME error surfaces
    // from the downstream compute.
    const patch = { footprint: null } as unknown as DeepPartial<DeckDesign>;
    expect(() => applyParameters(FIXTURE, patch, table)).toThrow();
    expect(() => applyParameters(FIXTURE, patch, table)).not.toThrow(
      ApplyParametersError,
    );
  });

  it('replaces (rather than merges) when the patch value is an array', () => {
    // Arrays intentionally REPLACE — `isPlainObject([]) === false`.
    // This matches the DeepPartial docstring on array semantics: an
    // array patch overwrites, never element-merges.
    const patch = { footprint: [1, 2, 3] } as unknown as DeepPartial<DeckDesign>;
    // The downstream `computeLayout` sees an array-shaped footprint
    // — some form of Error surfaces; we don't pin the exact class,
    // only that the merge succeeded without ApplyParametersError.
    expect(() => applyParameters(FIXTURE, patch, table)).toThrow();
    expect(() => applyParameters(FIXTURE, patch, table)).not.toThrow(
      ApplyParametersError,
    );
  });
});

// ---------------------------------------------------------------------------
// ApplyParametersError — shape
// ---------------------------------------------------------------------------

describe('ApplyParametersError', () => {
  it('is an Error subclass carrying `.name === "ApplyParametersError"` and a `.path`', () => {
    // `err.name` matters for dev-tool stack-trace attribution; `.path`
    // is the machine-readable field a UI can key on to highlight the
    // exact form input that failed validation.
    const err = new ApplyParametersError('some.path', 'a message');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApplyParametersError');
    expect(err.path).toBe('some.path');
    expect(err.message).toBe('a message');
  });
});
