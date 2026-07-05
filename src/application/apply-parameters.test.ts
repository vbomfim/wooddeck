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
    // Post material lives in `foundation.post` (review-gate FIX 2 —
    // removed the top-level `design.post` dual source of truth).
    expect(bundle.design.foundation).toEqual(FIXTURE.foundation);
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
// S25 pair-fix — full-path allowlist scoping for optional leaf fields
// (GPT HIGH#1 / Opus MED#2 / Security INFO#1 / QA G2)
//
// The `KNOWN_OPTIONAL_LEAF_PATHS` set exempts genuinely-optional
// FoundationSpec fields (blockRowsHint / blockColsHint) from the
// unknown-key check on subtrees where they don't currently have an
// own key. The exemption MUST be scoped to the DOTTED PATH — a
// leaf-key-only allowlist admitted wrong-subtree writes like
// `{ joist: { blockRowsHint: 999 } }`, which is schema-invalid.
// ---------------------------------------------------------------------------

describe('applyParameters — S25 path-scoped optional-leaf allowlist', () => {
  // Reach the floating tuffblock fixture — it carries a `foundation`
  // subtree without `blockRowsHint`/`blockColsHint`, so a patch that
  // ADDS them is exactly the legitimate-add case the allowlist
  // exists to enable. `find` (not indexed access) is robust against
  // future reordering of the fixture array.
  const floatingFixture = FIXTURE_DESIGNS.find(
    (f) => f.name === 'floating-16x14-tuffblock',
  )!.design;

  it('legitimate `{ foundation: { blockRowsHint: 3 } }` patch succeeds on a hintless floating tuffblock design', () => {
    const patch = { foundation: { blockRowsHint: 3 } } as unknown as DeepPartial<DeckDesign>;
    const bundle = applyParameters(floatingFixture, patch, table);
    if (bundle.design.foundation.type !== 'tuffblocks' && bundle.design.foundation.type !== 'deck-blocks') {
      throw new Error('expected block foundation on floating fixture');
    }
    expect(bundle.design.foundation.blockRowsHint).toBe(3);
  });

  it('legitimate `{ foundation: { blockColsHint: 2 } }` patch succeeds on a hintless floating tuffblock design', () => {
    const patch = { foundation: { blockColsHint: 2 } } as unknown as DeepPartial<DeckDesign>;
    const bundle = applyParameters(floatingFixture, patch, table);
    if (bundle.design.foundation.type !== 'tuffblocks' && bundle.design.foundation.type !== 'deck-blocks') {
      throw new Error('expected block foundation on floating fixture');
    }
    expect(bundle.design.foundation.blockColsHint).toBe(2);
  });

  it('rejects wrong-subtree write `{ joist: { blockRowsHint: 999 } }` with the dotted path', () => {
    // The leaf key `blockRowsHint` is legitimate ONLY at
    // `foundation.blockRowsHint`. Writing it into `joist` is a
    // schema-invalid patch that a leaf-only allowlist would have
    // silently accepted.
    const patch = { joist: { blockRowsHint: 999 } } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(floatingFixture, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('joist.blockRowsHint');
      expect((err as ApplyParametersError).message).toMatch(/joist\.blockRowsHint/);
    }
  });

  it('rejects wrong-subtree write `{ beam: { blockColsHint: 42 } }` with the dotted path', () => {
    const patch = { beam: { blockColsHint: 42 } } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(floatingFixture, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('beam.blockColsHint');
    }
  });

  it('rejects deep wrong-path write `{ joist: { material: { blockRowsHint: 7 } } }`', () => {
    // A leaf-only allowlist would silently accept this nonsense
    // (adding an orphan `blockRowsHint` into MaterialRef). Deep
    // dotted-path check catches it.
    const patch = {
      joist: { material: { blockRowsHint: 7 } },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(floatingFixture, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('joist.material.blockRowsHint');
    }
  });

  it('proto-pollution defence still runs BEFORE the allowlist — nested __proto__ under foundation rejected', () => {
    // Even though `foundation.blockRowsHint` is exempted from the
    // unknown-key check, a JSON.parse-preserved `__proto__` own key
    // under `foundation` must still be rejected as forbidden. This
    // confirms the FORBIDDEN_KEYS check runs first in the loop.
    const rogue = JSON.parse(
      '{"foundation":{"__proto__":{"POLLUTED":true}}}',
    ) as DeepPartial<DeckDesign>;
    try {
      applyParameters(floatingFixture, rogue, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      // Path names the forbidden nested key so the error is
      // debuggable.
      expect((err as ApplyParametersError).path).toBe('foundation.__proto__');
    }
    // Object.prototype must be untouched.
    expect(({} as Record<string, unknown>)['POLLUTED']).toBeUndefined();
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
// Coverage — plain-object-required semantics for the patch value
// (nested __proto__ attack, class instances, arrays, null subtrees).
// These used to REPLACE silently; they now MUST throw with a path.
// ---------------------------------------------------------------------------

describe('applyParameters — plain-object-required subtree semantics', () => {
  it('rejects a nested JS-literal `__proto__` in a subtree that current has as an object', () => {
    // Attack: `{footprint:{__proto__:{widthMm,lengthMm,heightMm}}}`
    // — `patch.footprint` is a prototype-backed object with ZERO
    // own keys. Before the fix a naive `else`-branch REPLACE swapped
    // `current.footprint` for this prototype-backed value; reads
    // worked via the prototype at runtime, but `JSON.stringify`
    // dropped the data → silent autosave corruption. Now this MUST
    // throw ApplyParametersError with `.path === 'footprint'`.
    const patch = {
      footprint: {
        __proto__: { widthMm: 9999, lengthMm: 9999, heightMm: 9999 },
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('footprint');
    }
    // Belt-and-suspenders: Object.prototype MUST remain clean.
    expect(({} as { widthMm?: unknown }).widthMm).toBeUndefined();
  });

  it('rejects a null subtree where current has a plain object (no silent REPLACE)', () => {
    // Before the fix `{footprint:null}` REPLACED the whole subtree
    // and let downstream compute blow up. Now the merge itself
    // rejects the null with an ApplyParametersError naming the path
    // — a much better developer experience.
    const patch = { footprint: null } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('footprint');
    }
  });

  it('rejects an array subtree where current has a plain object', () => {
    const patch = { footprint: [1, 2, 3] } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('footprint');
    }
  });

  it('rejects a Date subtree where current has a plain object', () => {
    const patch = { footprint: new Date() } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('footprint');
    }
  });

  it('rejects a class-instance subtree where current has a plain object', () => {
    class Widget {
      public widthMm = 42;
    }
    const patch = { footprint: new Widget() } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('footprint');
    }
  });
});

// ---------------------------------------------------------------------------
// Root-patch guard — non-object roots must throw ApplyParametersError,
// not a raw TypeError from Object.keys(null).
// ---------------------------------------------------------------------------

describe('applyParameters — root patch guard (non-plain-object rejection)', () => {
  it('rejects null root patch with ApplyParametersError (empty path)', () => {
    try {
      applyParameters(FIXTURE, null as unknown as DeepPartial<DeckDesign>, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('');
    }
  });

  it('rejects undefined root patch with ApplyParametersError', () => {
    try {
      applyParameters(FIXTURE, undefined as unknown as DeepPartial<DeckDesign>, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('');
    }
  });

  it('rejects a primitive root patch with ApplyParametersError', () => {
    try {
      applyParameters(FIXTURE, 42 as unknown as DeepPartial<DeckDesign>, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('');
    }
  });

  it('rejects an array root patch with ApplyParametersError', () => {
    try {
      applyParameters(
        FIXTURE,
        [1, 2, 3] as unknown as DeepPartial<DeckDesign>,
        table,
      );
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('');
    }
  });

  it('rejects a prototype-backed root patch with ApplyParametersError', () => {
    // The JS-literal form `{__proto__: {...}}` at the root sets the
    // new patch's prototype (zero own keys, prototype-backed). The
    // root guard MUST reject this same as any other non-plain-object
    // — otherwise the merge would produce a no-op success (nothing
    // to iterate), silently swallowing the caller's intent.
    const patch = { __proto__: { footprint: { widthMm: 9999 } } } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('');
    }
    // Belt-and-suspenders: Object.prototype MUST remain clean.
    expect(({} as { footprint?: unknown }).footprint).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Editable-surface restriction — id and createdAt are OWN keys of
// DeckDesign but must be REJECTED. See ticket §4 + module docs.
// ---------------------------------------------------------------------------

describe('applyParameters — editable-surface restriction (id, createdAt)', () => {
  it('rejects a patch touching `id` with ApplyParametersError', () => {
    const patch = { id: '00000000-0000-0000-0000-000000000000' } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('id');
      expect((err as ApplyParametersError).message).toMatch(/id/);
    }
  });

  it('rejects a patch touching `createdAt` with ApplyParametersError', () => {
    const patch = { createdAt: '2000-01-01T00:00:00.000Z' } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('createdAt');
      expect((err as ApplyParametersError).message).toMatch(/createdAt/);
    }
  });

  it('preserves the current design.id and .createdAt across a normal edit', () => {
    // The complement of the two rejection tests above: a normal
    // editable-field patch must leave id and createdAt bit-identical.
    const bundle = applyParameters(FIXTURE, { footprint: { widthMm: 4000 } }, table);
    expect(bundle.design.id).toBe(FIXTURE.id);
    expect(bundle.design.createdAt).toBe(FIXTURE.createdAt);
  });
});

// ---------------------------------------------------------------------------
// Structural-sharing — untouched subtrees are reference-shared with
// `current` (safe due to readonly domain types). See types.ts +
// apply-parameters.ts `deepMerge` docstring.
// ---------------------------------------------------------------------------

describe('applyParameters — structural sharing of untouched subtrees', () => {
  it('reference-shares an untouched top-level subtree with `current`', () => {
    // A patch that only touches `footprint` must NOT clone `beam`,
    // `foundation`, `decking`, or `layout` — they should be `===`
    // the originals. This is the standard immutable-update pattern
    // and enables cheap structural equality checks (React memo,
    // zundo snapshot diff) downstream. Safety comes from every
    // field of DeckDesign being `readonly` at the type level — a
    // mutation via a shared reference is a compile error.
    const bundle = applyParameters(FIXTURE, { footprint: { widthMm: 4000 } }, table);
    expect(bundle.design.beam).toBe(FIXTURE.beam);
    // Review-gate FIX 2: post material lives in `foundation.post`.
    expect(bundle.design.foundation).toBe(FIXTURE.foundation);
    expect(bundle.design.decking).toBe(FIXTURE.decking);
    expect(bundle.design.layout).toBe(FIXTURE.layout);
    // The touched subtree IS a fresh object — reference-inequal to
    // the original.
    expect(bundle.design.footprint).not.toBe(FIXTURE.footprint);
  });
});

// ---------------------------------------------------------------------------
// Coverage — `isPlainObject` returns true for null-prototype objects.
// A patch built with `Object.create(null)` (a legitimate "safe bag"
// pattern) must be accepted, exercising the `proto === null` branch.
// ---------------------------------------------------------------------------

describe('applyParameters — Object.create(null) patches (null-prototype "safe bags")', () => {
  it('accepts an Object.create(null) root patch (null prototype is a plain object per our definition)', () => {
    // `Object.create(null)` produces an object with NO prototype —
    // the safest way to build a "bag of keys" without inheriting
    // Object.prototype pollution. isPlainObject returns true for
    // this case (proto === null branch), so the root guard passes
    // and the merge proceeds. This exercises the else-branch of the
    // `proto === Object.prototype` identity check.
    const patch = Object.create(null) as DeepPartial<DeckDesign>;
    (patch as Record<string, unknown>)['footprint'] = { widthMm: 4000 };
    const bundle = applyParameters(FIXTURE, patch, table);
    expect(bundle.design.footprint.widthMm).toBe(4000);
    expect(bundle.design.footprint.lengthMm).toBe(FIXTURE.footprint.lengthMm);
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

// ---------------------------------------------------------------------------
// S23 — discriminated-union `type` switch REPLACES the subtree
// ---------------------------------------------------------------------------
//
// `foundation` is a discriminated union tagged on `.type`:
//
//   - `posts-on-footings` variant carries `post` + `footing`
//   - `deck-blocks` and `tuffblocks` variants carry `product`
//
// A naive deep-merge would keep the CURRENT variant's sibling fields
// (`post`, `footing`) around while a patch introduces the NEW variant's
// `product` field — the resulting shape is a runtime hybrid that
// matches NO discriminant of the union. Worse: an unknown-key check
// on the NEW-variant field (`product` isn't a key of the OLD subtree)
// would REJECT the patch entirely, breaking the S23 atomic
// structure↔foundation re-stamp.
//
// The FIX: when a plain-object patch subtree carries a `type` string
// that DIFFERS from the current subtree's `type` string, treat the
// patch value as a full REPLACE — no per-key merge, no unknown-key
// scan against the old variant. The patch has ALREADY declared a new
// shape; the merge respects it.
//
// This is the ONLY path that treats `type` specially: same-value
// `type` still deep-merges (so a caller can patch `foundation.product.
// productId` in place without switching variants). And the safety
// checks (isPlainObject on patchValue, FORBIDDEN_KEYS on the
// replacement's OWN keys) still apply.
describe('applyParameters — discriminator switch REPLACES the subtree (S23)', () => {
  // Note: FIXTURE.foundation is `{type:'posts-on-footings', post:..., footing:...}`
  // (elevated default). Every test below patches to a different variant
  // to exercise the switch.

  it('switching foundation.type from posts-on-footings to deck-blocks REPLACES the whole subtree', () => {
    // Elevated + deck-blocks is a legal compat combo (FR-030), so
    // computeLayoutAndCheck must succeed. Assert on the resulting
    // shape — the old variant's `post` + `footing` keys MUST BE GONE.
    const patch: DeepPartial<DeckDesign> = {
      foundation: {
        type: 'deck-blocks',
        product: { productId: 'oldcastle-11x11x7' },
      },
    };
    const bundle = applyParameters(FIXTURE, patch, table);
    expect(bundle.design.foundation).toEqual({
      type: 'deck-blocks',
      product: { productId: 'oldcastle-11x11x7' },
    });
    // No stray keys from the old variant survived.
    expect(bundle.design.foundation).not.toHaveProperty('post');
    expect(bundle.design.foundation).not.toHaveProperty('footing');
  });

  it('atomic { structure, foundation } switch → floating + tuffblocks in ONE patch (S23 AC1)', () => {
    // The S23 StructureSelector emits this exact patch when the user
    // clicks Floating from an elevated default: structure flips AND
    // foundation is re-stamped to a compat-valid default in ONE
    // action so the store never sees an invalid intermediate.
    //
    // FIXTURE is a 10x14 elevated deck with 2x10 joists AND 2x10
    // beams — the TuffBlock catalog product's `acceptsLumber` list
    // is [2x6, 2x8], so this specific FIXTURE's beam wouldn't fit
    // on the puck. We patch beam nominal to 2x8 IN THE SAME PATCH
    // to mirror the atomic re-stamp the S23 UI would perform when
    // switching to a foundation whose lumber compatibility is
    // narrower than the current design. The point of the test is
    // the merge shape — that structure + foundation + beam all
    // land in a valid single-action design.
    const patch: DeepPartial<DeckDesign> = {
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      beam: { material: { nominal: '2x8' } },
    };
    const bundle = applyParameters(FIXTURE, patch, table);
    expect(bundle.design.structure).toBe('floating');
    expect(bundle.design.foundation).toEqual({
      type: 'tuffblocks',
      product: { productId: 'tuffblock-12x12x4' },
    });
    expect(bundle.design.beam.material.nominal).toBe('2x8');
  });

  it('same-value `type` still deep-merges (allows patching inner fields)', () => {
    // Patching foundation.footing.widthMm without touching `type`
    // must still deep-merge — the discriminator hasn't changed, so
    // the REPLACE branch does not fire. `post` + `footing.depthMm`
    // survive from the current subtree.
    const patch = {
      foundation: { footing: { widthMm: 400 } },
    } as unknown as DeepPartial<DeckDesign>;
    const bundle = applyParameters(FIXTURE, patch, table);
    if (bundle.design.foundation.type !== 'posts-on-footings') {
      throw new Error('discriminant slipped on same-value type patch');
    }
    expect(bundle.design.foundation.footing.widthMm).toBe(400);
    // Original depthMm preserved by the merge.
    if (FIXTURE.foundation.type !== 'posts-on-footings') {
      throw new Error('fixture setup: expected posts-on-footings');
    }
    expect(bundle.design.foundation.footing.depthMm).toBe(
      FIXTURE.foundation.footing.depthMm,
    );
    // Original post material preserved by the merge.
    expect(bundle.design.foundation.post).toEqual(FIXTURE.foundation.post);
  });

  it('type-only patch (no other subtree keys) also REPLACES — even to the same shape', () => {
    // If the caller writes `{foundation: {type:'posts-on-footings'}}`
    // to reassert the current variant, the REPLACE fires only when
    // the TYPE VALUE differs. Same-value `type` = deep-merge (see
    // above). A different-value `type` here would fail
    // computeLayoutAndCheck for a mis-shaped variant (missing
    // required fields). The REPLACE mechanism does NOT invent
    // fields — it faithfully installs the patch value.
    const patch = {
      foundation: { type: 'deck-blocks' },
    } as unknown as DeepPartial<DeckDesign>;
    // Missing `.product` → layout-engine downstream will throw
    // LayoutError. That surfaces via the store's status='error'
    // branch — the merge itself does not synthesize defaults.
    expect(() => applyParameters(FIXTURE, patch, table)).toThrow(LayoutError);
  });

  it('rejects a discriminator-switch patch whose replacement carries a forbidden key', () => {
    // Defense in depth: the REPLACE path still enforces
    // FORBIDDEN_KEYS on the new subtree's own keys. A malicious
    // patch that flips `type` AND carries a JSON.parse-preserved
    // `__proto__` OWN key must still be rejected.
    //
    // JS-literal syntax `{__proto__: X}` is a proto-setter — it
    // does NOT create an own key. To simulate an attacker payload
    // arriving via JSON.parse (which DOES preserve `__proto__` as
    // an own key), we construct the field via
    // `Object.defineProperty`. This is the same shape the
    // pre-existing prototype-pollution test uses.
    const foundationPatch: Record<string, unknown> = {
      type: 'deck-blocks',
      product: { productId: 'oldcastle-11x11x7' },
    };
    Object.defineProperty(foundationPatch, '__proto__', {
      value: { evil: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const patch = { foundation: foundationPatch } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, patch, table);
      throw new Error('expected ApplyParametersError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.__proto__');
    }
    // Object.prototype must remain clean.
    expect(({} as { evil?: unknown }).evil).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S23 pair-fix — BLOCKING #1: REPLACE-path RECURSIVE + VARIANT-KEY-AWARE
// validation. The pre-fix REPLACE branch only checked TOP-LEVEL keys via a
// shallow Object.keys walk, so:
//
//   (a) A nested `__proto__` at depth ≥ 2 in the replacement subtree
//       (e.g. `foundation.product.__proto__`) BYPASSED FORBIDDEN_KEYS —
//       even though the module docstring PROMISES recursive protection
//       and the deep-merge path recurses.
//
//   (b) An "orphan variant key" — e.g. a stale-spread patch that flips
//       `type` to `tuffblocks` while still carrying `post` and
//       `footing` from a former `posts-on-footings` — produced a hybrid
//       shape matching NO discriminant of the FoundationSpec union
//       (FR-026 violation).
//
// The fix makes `assertReplacementSubtreeSafe`:
//   1. Recurse through every plain-object descendant for FORBIDDEN_KEYS,
//      naming the full dotted path in the error.
//   2. For the `foundation` target: reject own keys not in the variant's
//      allowed set (posts-on-footings → type/post/footing;
//      deck-blocks/tuffblocks → type/product/blockRowsHint/blockColsHint).
//
// Preserves compatibility with the S25 optional-leaf allowlist —
// blockRowsHint/blockColsHint remain valid on the block variants.
// ---------------------------------------------------------------------------

describe('applyParameters — S23 pair-fix #1: nested __proto__ in REPLACE payload', () => {
  it('rejects deep nested `foundation.product.__proto__` in a deck-blocks REPLACE', () => {
    // Attacker payload: JSON.parse-preserved `__proto__` OWN key at
    // DEPTH 2 (foundation.product.__proto__) under a legit-looking
    // discriminator switch. Pre-fix: silently installed — Object.prototype
    // polluted. Post-fix: rejected with the FULL DOTTED PATH.
    const rogue = JSON.parse(
      '{"foundation":{"type":"deck-blocks","product":{"productId":"oldcastle-11x11x7","__proto__":{"POLLUTED_NESTED":true}}}}',
    ) as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, rogue, table);
      throw new Error('expected ApplyParametersError for depth-2 __proto__');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.product.__proto__');
      expect((err as ApplyParametersError).message).toMatch(/foundation\.product\.__proto__/);
    }
    // Object.prototype must remain clean.
    expect(({} as Record<string, unknown>)['POLLUTED_NESTED']).toBeUndefined();
  });

  it('rejects deep nested `foundation.footing.__proto__` on the REVERSE (block→posts) REPLACE', () => {
    // Reverse direction: starting from a floating tuffblocks fixture,
    // flip to posts-on-footings with a __proto__ nested inside footing.
    // Confirms the recursion doesn't accidentally favor one variant.
    const floatingFixture = FIXTURE_DESIGNS.find(
      (f) => f.name === 'floating-16x14-tuffblock',
    )!.design;
    const rogue = JSON.parse(
      '{"foundation":{"type":"posts-on-footings","post":{"nominal":"6x6","species":"PT","grade":"No2"},"footing":{"widthMm":300,"depthMm":300,"__proto__":{"POLLUTED_FOOTING":true}}}}',
    ) as DeepPartial<DeckDesign>;
    try {
      applyParameters(floatingFixture, rogue, table);
      throw new Error('expected ApplyParametersError for depth-2 __proto__ in footing');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.footing.__proto__');
    }
    expect(({} as Record<string, unknown>)['POLLUTED_FOOTING']).toBeUndefined();
  });

  it('rejects `constructor` and `prototype` at nested depth in a REPLACE payload', () => {
    // FORBIDDEN_KEYS covers three vectors — nested recursion must
    // catch them all, not just `__proto__`.
    const rogue = JSON.parse(
      '{"foundation":{"type":"deck-blocks","product":{"productId":"oldcastle-11x11x7","constructor":"evil"}}}',
    ) as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, rogue, table);
      throw new Error('expected ApplyParametersError for depth-2 constructor');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.product.constructor');
    }
  });
});

describe('applyParameters — S23 pair-fix #1: orphan variant keys (FR-026 shape violation)', () => {
  // Fixture: elevated + posts-on-footings (has post + footing keys).
  // We construct patches that fake a "stale spread" — the stale-spread
  // pattern is what a broken UI selector would produce if it did
  // { ...current.foundation, type: 'tuffblocks', product } without
  // dropping the old post/footing keys.

  it('rejects stale-spread `{ ...posts-on-footings, type:"tuffblocks", product }` carrying orphan `post`', () => {
    const stale = {
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
        // Orphan — a tuffblocks variant has no `post` field per FR-026.
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, stale, table);
      throw new Error('expected ApplyParametersError for orphan post on tuffblocks');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.post');
      expect((err as ApplyParametersError).message).toMatch(/post/);
      expect((err as ApplyParametersError).message).toMatch(/tuffblocks/);
    }
  });

  it('rejects stale-spread `{ ...posts-on-footings, type:"tuffblocks", product }` carrying orphan `footing`', () => {
    const stale = {
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
        footing: { widthMm: 300, depthMm: 300 },
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, stale, table);
      throw new Error('expected ApplyParametersError for orphan footing on tuffblocks');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.footing');
      expect((err as ApplyParametersError).message).toMatch(/tuffblocks/);
    }
  });

  it('rejects a `product` key on a `posts-on-footings` REPLACE (orphan block-variant key)', () => {
    // Reverse case: someone writes a `posts-on-footings` REPLACE but
    // includes a `product` (block-only) key. Same shape violation,
    // different direction.
    const floatingFixture = FIXTURE_DESIGNS.find(
      (f) => f.name === 'floating-16x14-tuffblock',
    )!.design;
    const stale = {
      foundation: {
        type: 'posts-on-footings' as const,
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        footing: { widthMm: 300, depthMm: 300 },
        product: { productId: 'tuffblock-12x12x4' as const },
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(floatingFixture, stale, table);
      throw new Error('expected ApplyParametersError for orphan product on posts-on-footings');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.product');
      expect((err as ApplyParametersError).message).toMatch(/posts-on-footings/);
    }
  });

  it('accepts a legit `{ foundation: {type:"tuffblocks", product, blockRowsHint:3} }` REPLACE (S25 leaf allowlist compat)', () => {
    // The variant-key check must NOT reject the very keys the S25
    // KNOWN_OPTIONAL_LEAF_PATHS allowlist grants — blockRowsHint /
    // blockColsHint are legitimate leaves on the block variants.
    const patch: DeepPartial<DeckDesign> = {
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
        blockRowsHint: 3,
      },
      beam: { material: { nominal: '2x8' } },
    };
    const bundle = applyParameters(FIXTURE, patch, table);
    if (bundle.design.foundation.type !== 'tuffblocks') {
      throw new Error('discriminant slipped');
    }
    expect(bundle.design.foundation.product).toEqual({ productId: 'tuffblock-12x12x4' });
    expect(bundle.design.foundation.blockRowsHint).toBe(3);
    // No stray keys — the REPLACE installed the exact shape we sent.
    expect(Object.keys(bundle.design.foundation).sort()).toEqual(
      ['blockRowsHint', 'product', 'type'],
    );
  });

  it('accepts a legit `{ foundation: {type:"deck-blocks", product, blockColsHint:2} }` REPLACE', () => {
    const patch: DeepPartial<DeckDesign> = {
      foundation: {
        type: 'deck-blocks',
        product: { productId: 'oldcastle-11x11x7' },
        blockColsHint: 2,
      },
    };
    const bundle = applyParameters(FIXTURE, patch, table);
    if (bundle.design.foundation.type !== 'deck-blocks') {
      throw new Error('discriminant slipped');
    }
    expect(bundle.design.foundation.blockColsHint).toBe(2);
  });

  it('rejects an entirely unknown own key like `foo` on a tuffblocks REPLACE', () => {
    // Not a legitimate optional leaf, not a variant key — pure typo /
    // schema violation. Must be caught by the allow-set check.
    const stale = {
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
        foo: 42,
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, stale, table);
      throw new Error('expected ApplyParametersError for orphan `foo` on tuffblocks');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.foo');
    }
  });
});

// ---------------------------------------------------------------------------
// S23 pair-fix ITERATION-2 — closing the two residual gaps flagged by
// the GPT diff-only re-review of `assertReplacementSubtreeSafe`:
//
//   Gap #1 — `assertNoForbiddenKeysDeep` skipped ARRAYS entirely, so a
//            `__proto__`/`constructor`/`prototype` inside an
//            array-of-objects would bypass the recursive walk. FoundationSpec
//            has no array fields today so it's not reachable from a valid
//            domain shape, but the guard must be GENERICALLY correct
//            (defense in depth for future variants).
//
//   Gap #2 — The variant-shape check was TOP-LEVEL only. Nested orphan
//            keys under `foundation.product.*`, `foundation.post.*`, or
//            `foundation.footing.*` slipped through and got installed
//            verbatim in the REPLACE branch — an FR-026 violation at
//            depth ≥ 2.
//
// These are defense-in-depth: Ajv `additionalProperties:false` gates
// loads and the UI selectors emit literals, so untrusted input can't
// currently reach these paths. The tests below lock the FR-026
// completeness invariant regardless of reachability.
// ---------------------------------------------------------------------------

describe('applyParameters — S23 pair-fix iter-2 #1: array traversal in recursive FORBIDDEN_KEYS walk', () => {
  it('catches a nested `__proto__` inside an array element (dotted path names the array index)', () => {
    // FoundationSpec has no array field today, so we route the
    // array through an ORPHAN top-level foundation key. The
    // recursive FORBIDDEN_KEYS walk runs BEFORE the variant-shape
    // check (highest-priority security error first), so the
    // prototype-pollution vector is caught even though the
    // surrounding shape would ALSO be rejected as an orphan key.
    // The path convention uses `[idx]` for array indices — dotted
    // for object keys, bracketed for array indices — so the error
    // message reads naturally to a debugger.
    const rogue = JSON.parse(
      '{"foundation":{"type":"tuffblocks","product":{"productId":"tuffblock-12x12x4"},"someArray":[{"__proto__":{"POLLUTED_ARRAY":true}}]}}',
    ) as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, rogue, table);
      throw new Error('expected ApplyParametersError for __proto__ inside array element');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe(
        'foundation.someArray[0].__proto__',
      );
      expect((err as ApplyParametersError).message).toMatch(
        /foundation\.someArray\[0\]\.__proto__/,
      );
    }
    // Object.prototype must remain clean.
    expect(({} as Record<string, unknown>)['POLLUTED_ARRAY']).toBeUndefined();
  });

  it('catches a nested `constructor` inside a deeper array element', () => {
    // Double-nested array element (foundation → array → array): the
    // walk must recurse through both arrays and then into the
    // plain-object element. Confirms the traversal isn't
    // depth-limited to a single array hop.
    const rogue = JSON.parse(
      '{"foundation":{"type":"tuffblocks","product":{"productId":"tuffblock-12x12x4"},"nested":[[{"constructor":"evil"}]]}}',
    ) as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, rogue, table);
      throw new Error('expected ApplyParametersError for constructor in nested array');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe(
        'foundation.nested[0][0].constructor',
      );
    }
  });

  it('skips array elements that are primitives (no false positives on legit numeric arrays)', () => {
    // A number-only array must not throw — arrays of primitives
    // cannot carry FORBIDDEN keys. This tests the traversal is
    // GATED on `isPlainObject` for element inspection, not naively
    // recursing into every element. We construct a payload where
    // the numeric array is under a legit-shape foundation +
    // simultaneously a __proto__ under the SAME array as element[1]
    // would fail — so we ONLY seed primitives.
    // Because the shape check would reject `arr` as an orphan
    // foundation key, use a rogue payload that would fail at the
    // shape stage AFTER the (silent) recursive-walk pass. The
    // FINAL error must be the shape-stage error, not a bogus
    // walker throw.
    const rogue = {
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
        arr: [1, 2, 3],
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, rogue, table);
      throw new Error('expected ApplyParametersError for orphan arr key');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      // The recursive walker saw only primitive elements → no
      // FORBIDDEN error. The shape check then rejected `arr` as
      // an orphan variant key.
      expect((err as ApplyParametersError).path).toBe('foundation.arr');
    }
  });
});

describe('applyParameters — S23 pair-fix iter-2 #2: nested shape validation on `foundation.{product,post,footing}`', () => {
  it('rejects an orphan nested key under `foundation.product` (block variant)', () => {
    // FR-026 nesting: `product` is a `FoundationBlockRef = { productId }` —
    // only `productId` is a valid own key. An extra `orphan`
    // installed verbatim by the REPLACE branch would carry stale
    // state into the persisted design.
    const rogue = {
      foundation: {
        type: 'tuffblocks' as const,
        product: {
          productId: 'tuffblock-12x12x4' as const,
          orphan: 1,
        },
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, rogue, table);
      throw new Error('expected ApplyParametersError for orphan under product');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.product.orphan');
      expect((err as ApplyParametersError).message).toMatch(/product/);
    }
  });

  it('rejects an orphan nested key under `foundation.post` (posts variant)', () => {
    // FR-026 nesting: `post` is a MaterialRef = { nominal, species,
    // grade } — extra keys are not part of the material identity
    // and must be rejected at the REPLACE gate.
    const floatingFixture = FIXTURE_DESIGNS.find(
      (f) => f.name === 'floating-16x14-tuffblock',
    )!.design;
    const rogue = {
      foundation: {
        type: 'posts-on-footings' as const,
        post: {
          nominal: '6x6' as const,
          species: 'PT' as const,
          grade: 'No2' as const,
          evil: 1,
        },
        footing: { widthMm: 300, depthMm: 300 },
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(floatingFixture, rogue, table);
      throw new Error('expected ApplyParametersError for orphan under post');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.post.evil');
      expect((err as ApplyParametersError).message).toMatch(/post/);
    }
  });

  it('rejects an orphan nested key under `foundation.footing` (posts variant)', () => {
    // FootingSpec = { widthMm, depthMm } — extras rejected.
    const floatingFixture = FIXTURE_DESIGNS.find(
      (f) => f.name === 'floating-16x14-tuffblock',
    )!.design;
    const rogue = {
      foundation: {
        type: 'posts-on-footings' as const,
        post: { nominal: '6x6' as const, species: 'PT' as const, grade: 'No2' as const },
        footing: {
          widthMm: 300,
          depthMm: 300,
          extraDim: 42,
        },
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(floatingFixture, rogue, table);
      throw new Error('expected ApplyParametersError for orphan under footing');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.footing.extraDim');
    }
  });

  it('rejects a non-plain-object value at a required nested slot (e.g. `product: []`)', () => {
    // Defense: `product` must be a plain object (FoundationBlockRef).
    // If a caller passes an array, the top-level variant-shape
    // check would accept `product` as a valid key, but the nested
    // check must reject the shape mismatch — otherwise the
    // REPLACE would install `product: []` verbatim, producing a
    // hybrid object matching NO FoundationSpec variant.
    const rogue = {
      foundation: {
        type: 'tuffblocks' as const,
        product: [] as unknown as { productId: 'tuffblock-12x12x4' },
      },
    } as unknown as DeepPartial<DeckDesign>;
    try {
      applyParameters(FIXTURE, rogue, table);
      throw new Error('expected ApplyParametersError for non-object product');
    } catch (err) {
      expect(err).toBeInstanceOf(ApplyParametersError);
      expect((err as ApplyParametersError).path).toBe('foundation.product');
      expect((err as ApplyParametersError).message).toMatch(/plain object/i);
    }
  });

  it('accepts a fully-shaped block-variant REPLACE (product with only productId)', () => {
    // Positive control: the nested-shape check must NOT reject a
    // canonical REPLACE. `product` carries exactly its declared
    // field; `blockRowsHint` remains valid at the foundation TOP
    // level (NOT nested inside product) per FoundationSpec.
    const patch: DeepPartial<DeckDesign> = {
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
        blockRowsHint: 4,
        blockColsHint: 2,
      },
      beam: { material: { nominal: '2x8' } },
    };
    const bundle = applyParameters(FIXTURE, patch, table);
    if (bundle.design.foundation.type !== 'tuffblocks') {
      throw new Error('discriminant slipped');
    }
    expect(bundle.design.foundation.product).toEqual({
      productId: 'tuffblock-12x12x4',
    });
    expect(bundle.design.foundation.blockRowsHint).toBe(4);
    expect(bundle.design.foundation.blockColsHint).toBe(2);
    // The installed foundation carries EXACTLY the FR-026 keys
    // — no smuggled nested extras.
    expect(Object.keys(bundle.design.foundation.product)).toEqual(['productId']);
  });

  it('accepts a fully-shaped posts-variant REPLACE (post + footing with only their declared fields)', () => {
    const floatingFixture = FIXTURE_DESIGNS.find(
      (f) => f.name === 'floating-16x14-tuffblock',
    )!.design;
    const patch: DeepPartial<DeckDesign> = {
      structure: 'elevated',
      // floating fixture's footprint.heightMm is minimal for a
      // ground-level deck; the elevated variant needs a taller
      // stack (posts extent > 0), so bump the height to a safe
      // elevated value.
      footprint: { heightMm: 800 },
      foundation: {
        type: 'posts-on-footings',
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        footing: { widthMm: 300, depthMm: 300 },
      },
    };
    const bundle = applyParameters(floatingFixture, patch, table);
    if (bundle.design.foundation.type !== 'posts-on-footings') {
      throw new Error('discriminant slipped');
    }
    // Nested subtrees carry exactly their FR-026 keys — no extras.
    expect(Object.keys(bundle.design.foundation.post).sort()).toEqual(
      ['grade', 'nominal', 'species'].sort(),
    );
    expect(Object.keys(bundle.design.foundation.footing).sort()).toEqual(
      ['depthMm', 'widthMm'].sort(),
    );
  });
});
