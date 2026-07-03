/**
 * Unit tests for `src/persistence/deck-file/schema-v1.ts` — the
 * envelope + serialize/deserialize surface for the `.deck` v1 file
 * format. Written TDD-red before any implementation exists.
 *
 * ## Coverage map (GitHub issue #7 acceptance criteria)
 *
 *   - AC1 (round-trip identity — HONEST CONTRACT). Three invariants:
 *       (1) design round-trips deep-equal,
 *       (2) metadata-preserving byte-identity when the caller pins
 *           `createdAt` + `generatorVersion` on the second serialize,
 *       (3) design-payload JSON is byte-stable across two serializes
 *           with the same pinned metadata.
 *     The prior "byte-identity across two default serializes" wording
 *     was a fake invariant — `createdAt` is stamped from the wall
 *     clock on every call and MUST differ by design. See ticket §4
 *     AC1 and `schema-v1.ts` module header ("Envelope `createdAt` is
 *     FILE-GENERATION metadata, not identity") for the rationale.
 *   - AC2 (envelope contents)   — every stamped field is asserted.
 *   - AC3 (unknown schema)      — throws with `.code = 'unknown-schema'`
 *                                 ONLY for integer versions outside the
 *                                 known set. Non-integer / non-numeric
 *                                 `schema` values fall through to Ajv
 *                                 and surface as `schema-validation-failed`
 *                                 (structural failure, not a "version
 *                                 we don't know" — see AC3 tests).
 *   - AC6 (invalid JSON)        — throws with `.code = 'invalid-json'`.
 *   - Prototype-pollution reject: the parsed payload must never mutate
 *     `Object.prototype` (ticket §6 Security). Belt-and-suspenders:
 *     Ajv's `additionalProperties:false` on `design` already rejects
 *     `__proto__` because it is not in the allowlist, but this test
 *     asserts the observable outcome — `Object.prototype.polluted` is
 *     still undefined after deserialize throws.
 *
 * ## Test environment
 *
 * Vitest's default env for wooddeck is jsdom (see `vite.config.ts`),
 * which provides `JSON`, `Date`, and every other host object this
 * file exercises. No environment override is needed here.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { deserialize, serialize } from './schema-v1';
import type { DeckFile } from './schema-v1';
import { DeckFileError } from './errors';
import { GOLDEN_DECK_DESIGN, deckDesignArb } from './__fixtures__/deck-designs';

// ---------------------------------------------------------------------------
// AC1 — honest round-trip contract (golden fixture + property test)
// ---------------------------------------------------------------------------
//
// Three invariants, none of which pretend that two default serialize()
// calls produce byte-identical output (their `createdAt` values differ
// by design — see `schema-v1.ts` module header). The old AC1 wording,
// `serialize(deserialize(serialize(D)).design) === serialize(D)`, was
// only passing because tests injected a pinned `createdAt` behind the
// scenes — a weakened variant that hid the true contract.

describe('serialize/deserialize — AC1 honest round-trip contract', () => {
  // Invariant 1: design deep-equal round-trip -------------------------------

  it('invariant 1: deserialize(serialize(D)).design deep-equals D (golden fixture)', () => {
    const json = serialize(GOLDEN_DECK_DESIGN);
    const { design } = deserialize(json);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
  });

  it('invariant 1 (property): design deep-equal round-trips for any generated DeckDesign', () => {
    fc.assert(
      fc.property(deckDesignArb, (design) => {
        const json = serialize(design);
        const { design: parsed } = deserialize(json);
        expect(parsed).toEqual(design);
      }),
      { numRuns: 200 },
    );
  });

  // Invariant 2: metadata-preserving byte-identity --------------------------
  //
  // `serialize(deserialize(s).design, { createdAt: meta.createdAt,
  //                                     generatorVersion: meta.generatorVersion }) === s`
  //
  // This is the REAL "byte-identity" contract: it takes an envelope,
  // recovers its meta, and re-emits with those stamps pinned. If the
  // canonical field order or any per-design encoding drifts, this
  // fails immediately. Envelope `createdAt` is intentionally NOT
  // preserved through a NAKED re-serialize — that's file-generation
  // metadata and MUST differ per save.

  it('invariant 2: metadata-preserving byte-identity holds (golden fixture)', () => {
    const s = serialize(GOLDEN_DECK_DESIGN);
    const { design, meta } = deserialize(s);
    const reEmitted = serialize(design, {
      createdAt: meta.createdAt,
      generatorVersion: meta.generatorVersion,
    });
    expect(reEmitted).toBe(s);
  });

  it('invariant 2 (property): metadata-preserving byte-identity for any generated DeckDesign', () => {
    fc.assert(
      fc.property(deckDesignArb, (design) => {
        const s = serialize(design);
        const { design: recovered, meta } = deserialize(s);
        const reEmitted = serialize(recovered, {
          createdAt: meta.createdAt,
          generatorVersion: meta.generatorVersion,
        });
        expect(reEmitted).toBe(s);
      }),
      { numRuns: 100 },
    );
  });

  // Invariant 3: design-payload JSON byte-stable across same-metadata calls -
  //
  // Proves the design serializer itself is deterministic (independent
  // of wall-clock drift). Two `serialize(D, opts)` calls with the same
  // pinned `{ createdAt, generatorVersion }` produce the same string.

  it('invariant 3: two serialize calls with SAME pinned metadata are byte-identical (golden fixture)', () => {
    const opts = {
      createdAt: '2026-07-02T21:00:00.000Z',
      generatorVersion: '0.0.0-test',
    };
    const a = serialize(GOLDEN_DECK_DESIGN, opts);
    const b = serialize(GOLDEN_DECK_DESIGN, opts);
    expect(a).toBe(b);
  });

  it('invariant 3 (property): byte-identical for any generated DeckDesign under pinned metadata', () => {
    const opts = {
      createdAt: '2026-07-02T21:00:00.000Z',
      generatorVersion: '0.0.0-property-test',
    };
    fc.assert(
      fc.property(deckDesignArb, (design) => {
        const a = serialize(design, opts);
        const b = serialize(design, opts);
        expect(a).toBe(b);
      }),
      { numRuns: 100 },
    );
  });

  // Anti-invariant: two DEFAULT serializes intentionally differ ------------
  //
  // Documented so a future contributor cannot "fix" this by making
  // createdAt monotonic or removing the wall-clock stamp — those
  // would be silent contract changes.

  it('anti-invariant: two default serializes MAY differ (createdAt drifts by design)', async () => {
    const a = serialize(GOLDEN_DECK_DESIGN);
    // Force a wall-clock delta larger than the ISO-8601 millisecond
    // resolution so the two `Date.now()` calls MUST fall in different
    // milliseconds — even under a fast test runner.
    await new Promise((r) => setTimeout(r, 2));
    const b = serialize(GOLDEN_DECK_DESIGN);
    // Parse to compare createdAt structurally rather than asserting
    // `a !== b` (which could false-negative if the timer resolution
    // ever coarsens); either way, the assertion documents intent.
    const createdA = (JSON.parse(a) as { createdAt: string }).createdAt;
    const createdB = (JSON.parse(b) as { createdAt: string }).createdAt;
    // The design payload deep-equals across the two serializations
    // (invariant 1 already proves this), so if `a === b`, then
    // createdA === createdB — which is exactly what we do NOT want
    // to promise. Assert on the timestamps directly.
    expect(Date.parse(createdB)).toBeGreaterThanOrEqual(Date.parse(createdA));
    // And the FULL strings should also differ — proves createdAt is
    // baked into the byte output, not stripped somewhere.
    // (This is a "may differ" assertion — if the OS clock has 1ms
    // resolution and both fell in the same ms, we accept equality.)
    if (createdA !== createdB) {
      expect(a).not.toBe(b);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — envelope contents
// ---------------------------------------------------------------------------

describe('serialize — AC2 envelope contents', () => {
  it('stamps every documented envelope field', () => {
    const before = Date.now();
    const json = serialize(GOLDEN_DECK_DESIGN);
    const after = Date.now();
    const parsed = JSON.parse(json) as DeckFile;
    expect(parsed.schema).toBe(1);
    expect(parsed.generator).toBe('wooddeck');
    // Semver-ish: non-empty string. The exact value depends on
    // `package.json.version` injected at build time by Vite `define`.
    expect(parsed.generatorVersion).toEqual(expect.any(String));
    expect(parsed.generatorVersion.length).toBeGreaterThan(0);
    // ISO-8601 date-time and within the window we bracketed.
    const stampedMs = Date.parse(parsed.createdAt);
    expect(Number.isNaN(stampedMs)).toBe(false);
    expect(stampedMs).toBeGreaterThanOrEqual(before);
    expect(stampedMs).toBeLessThanOrEqual(after);
    expect(parsed.design).toEqual(GOLDEN_DECK_DESIGN);
  });

  it('respects an explicit `opts.generatorVersion`', () => {
    const json = serialize(GOLDEN_DECK_DESIGN, { generatorVersion: '9.9.9-rc' });
    const parsed = JSON.parse(json) as DeckFile;
    expect(parsed.generatorVersion).toBe('9.9.9-rc');
  });

  it('respects an explicit `opts.createdAt`', () => {
    const json = serialize(GOLDEN_DECK_DESIGN, { createdAt: '2020-01-02T03:04:05.000Z' });
    const parsed = JSON.parse(json) as DeckFile;
    expect(parsed.createdAt).toBe('2020-01-02T03:04:05.000Z');
  });

  it('emits fields in canonical order (schema, generator, generatorVersion, createdAt, design)', () => {
    // Byte-order of the envelope is part of the contract — S6 §2 in
    // the ticket. If a rewrite reorders fields the schema still
    // validates but the SC-006 byte-for-byte round-trip could drift.
    const json = serialize(GOLDEN_DECK_DESIGN, {
      createdAt: '2026-07-02T21:00:00.000Z',
      generatorVersion: '0.0.0-test',
    });
    // Field order proven by prefix check on the raw string — much
    // stricter than Object.keys(parsed) which V8 could theoretically
    // reorder in the future.
    expect(json.startsWith('{"schema":1,"generator":"wooddeck","generatorVersion":"0.0.0-test","createdAt":"2026-07-02T21:00:00.000Z","design":')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3 — unknown schema rejected
// ---------------------------------------------------------------------------

describe('deserialize — AC3 unknown-schema rejection', () => {
  it('throws DeckFileError with code=unknown-schema for schema=999', () => {
    const rogue = JSON.stringify({
      schema: 999,
      generator: 'wooddeck',
      generatorVersion: '9.9.9',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(DeckFileError);
    try {
      deserialize(rogue);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('unknown-schema');
      // Message must NAME the offending version so a user can act on it.
      expect(dfe.message).toContain('999');
    }
  });

  it('throws unknown-schema even when the payload is otherwise a valid v1 design', () => {
    // schema=2 with a v1 body — proves the loader gates on the
    // envelope, not the design body shape.
    const rogue = JSON.stringify({
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '2.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'unknown-schema' }),
    );
  });

  it('handles the schema field being missing entirely — reports unknown-schema or validation', () => {
    // Envelope-level schema validation runs BEFORE the switch, so
    // missing `schema` may fail as schema-validation-failed. Either
    // outcome is acceptable — what matters is a typed DeckFileError.
    const rogue = JSON.stringify({
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(DeckFileError);
  });
});

// ---------------------------------------------------------------------------
// AC3 (extension) — non-integer / non-numeric `schema` values classify
// as `schema-validation-failed`, NOT as `unknown-schema`
// ---------------------------------------------------------------------------
//
// The unknown-schema precheck in `deserialize` reserves the code for
// integers outside the known set — a "we don't know this version" story
// makes sense only for something that IS a version. A float, string, or
// boolean in the `schema` slot is a STRUCTURAL failure (the envelope
// isn't shaped right at all) and belongs to Ajv (Code Review GPT #4 —
// previously `schema: 1.5` wrongly told the user to "upgrade wooddeck").

describe('deserialize — non-integer schema falls through to Ajv (Code Review GPT #4)', () => {
  it('classifies schema=1.5 as schema-validation-failed (NOT unknown-schema)', () => {
    const rogue = JSON.stringify({
      schema: 1.5,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    try {
      deserialize(rogue);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      // Explicitly pin to the STRUCTURAL code — this test would have
      // returned 'unknown-schema' under the pre-fix behaviour.
      expect(dfe.code).toBe('schema-validation-failed');
      // The message must NOT falsely tell the user to upgrade wooddeck.
      expect(dfe.message.toLowerCase()).not.toContain('upgrade');
    }
  });

  it('classifies schema="1" (string) as schema-validation-failed', () => {
    const rogue = JSON.stringify({
      schema: '1', // stringy — envelope schema pins `type: integer`
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('classifies schema=true (boolean) as schema-validation-failed', () => {
    const rogue = JSON.stringify({
      schema: true,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('classifies schema=null as schema-validation-failed', () => {
    const rogue = JSON.stringify({
      schema: null,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('KEEPS the unknown-schema path for future integers (2, 999)', () => {
    // Regression fence — narrowing the precheck to integers must NOT
    // break the actual "future version" case.
    for (const version of [2, 3, 999, 12345]) {
      const rogue = JSON.stringify({
        schema: version,
        generator: 'wooddeck',
        generatorVersion: '9.9.9',
        createdAt: '2026-07-02T21:00:00.000Z',
        design: GOLDEN_DECK_DESIGN,
      });
      try {
        deserialize(rogue);
        throw new Error(`should have thrown for schema=${String(version)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(DeckFileError);
        const dfe = err as DeckFileError;
        expect(dfe.code).toBe('unknown-schema');
        expect(dfe.message).toContain(String(version));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generatorVersion — semver pattern enforced by JSON Schema (§F review)
// ---------------------------------------------------------------------------
//
// The ticket calls `generatorVersion` "semver", but the schema previously
// accepted any string ≤ 64 chars. `docs/deck-file-schema-v1.json` now
// pins a lenient semver `pattern`:
//     ^\d+\.\d+\.\d+(?:[-+].+)?$
// which admits MAJOR.MINOR.PATCH with optional -prerelease and/or +build
// tail (both folded into a single `[-+].+` suffix for schema simplicity).
// A `.deck` file whose `generatorVersion` doesn't match must be rejected
// as `schema-validation-failed`.

describe('deserialize — generatorVersion semver pattern (review fix F)', () => {
  it('accepts a valid semver like "1.2.3"', () => {
    const s = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.2.3',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(s)).not.toThrow();
  });

  it('accepts a semver with prerelease + build tag like "1.2.3-rc.1+abc"', () => {
    const s = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.2.3-rc.1+abc',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(s)).not.toThrow();
  });

  it('rejects a non-semver generatorVersion ("banana") with schema-validation-failed', () => {
    const s = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: 'banana', // clearly not semver
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    try {
      deserialize(s);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      // The Ajv message should reference the generatorVersion field
      // OR the `pattern` keyword — either surfaces the intent.
      expect(dfe.message).toMatch(/generatorVersion|pattern/i);
    }
  });

  it('rejects a partial version like "1.2" (missing patch)', () => {
    const s = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.2',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(s)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });
});

// ---------------------------------------------------------------------------
// AC6 — corrupt JSON rejected
// ---------------------------------------------------------------------------

describe('deserialize — AC6 invalid-JSON rejection', () => {
  it('throws DeckFileError with code=invalid-json for a truncated string', () => {
    expect(() => deserialize('not json {')).toThrowError(
      expect.objectContaining({ code: 'invalid-json' }),
    );
  });

  it('throws invalid-json for an empty string', () => {
    expect(() => deserialize('')).toThrowError(
      expect.objectContaining({ code: 'invalid-json' }),
    );
  });

  it('chains the underlying SyntaxError via `cause`', () => {
    try {
      deserialize('{"schema": 1,');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('invalid-json');
      expect(dfe.cause).toBeInstanceOf(SyntaxError);
    }
  });
});

// ---------------------------------------------------------------------------
// Prototype-pollution defence (ticket §6 Security)
// ---------------------------------------------------------------------------

describe('deserialize — prototype-pollution defence', () => {
  it('rejects a payload whose `design` carries an `__proto__` key', () => {
    // Note: JSON.parse itself does NOT set Object.prototype from a
    // `"__proto__"` key — it treats it as a normal own property. But
    // if the parsed value were later spread or merged, pollution
    // could propagate. Our loader defends by (a) validating with a
    // strict schema that rejects unknown keys inside `design`, and
    // (b) never merging the parsed value into another object.
    const payload = `{"schema":1,"generator":"wooddeck","generatorVersion":"1.0.0","createdAt":"2026-07-02T21:00:00.000Z","design":{"__proto__":{"polluted":true},"id":"018f4e7a-c1c5-4a3f-8f52-3a0f6c9d1e4b","createdAt":"2026-07-02T21:00:00.000Z","footprint":{"widthMm":1000,"lengthMm":1000,"heightMm":100},"joist":{"material":{"nominal":"2x8","species":"PT","grade":"No2"},"spacingMm":406},"beam":{"material":{"nominal":"2x10","species":"PT","grade":"No2"}},"post":{"material":{"nominal":"6x6","species":"PT","grade":"No2"}},"decking":{"material":{"nominal":"5/4x6","species":"Composite","grade":"NA"},"orientation":"parallel-to-width"},"layout":{"bayRemainderStrategy":"extra-bay-at-end"}}}`;
    expect(() => deserialize(payload)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
    // Observable: Object.prototype was NOT mutated regardless.
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects a payload whose envelope carries a `constructor` key inside design', () => {
    const payload = `{"schema":1,"generator":"wooddeck","generatorVersion":"1.0.0","createdAt":"2026-07-02T21:00:00.000Z","design":{"constructor":{"prototype":{"polluted":true}},"id":"018f4e7a-c1c5-4a3f-8f52-3a0f6c9d1e4b","createdAt":"2026-07-02T21:00:00.000Z","footprint":{"widthMm":1000,"lengthMm":1000,"heightMm":100},"joist":{"material":{"nominal":"2x8","species":"PT","grade":"No2"},"spacingMm":406},"beam":{"material":{"nominal":"2x10","species":"PT","grade":"No2"}},"post":{"material":{"nominal":"6x6","species":"PT","grade":"No2"}},"decking":{"material":{"nominal":"5/4x6","species":"Composite","grade":"NA"},"orientation":"parallel-to-width"},"layout":{"bayRemainderStrategy":"extra-bay-at-end"}}}`;
    expect(() => deserialize(payload)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Return-type contract — deserialize surfaces meta alongside design
// ---------------------------------------------------------------------------

describe('deserialize — return shape', () => {
  it('returns { design, meta } with every envelope field surfaced under meta', () => {
    const json = serialize(GOLDEN_DECK_DESIGN, {
      createdAt: '2024-11-01T00:00:00.000Z',
      generatorVersion: '1.2.3',
    });
    const { design, meta } = deserialize(json);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
    expect(meta.schema).toBe(1);
    expect(meta.generator).toBe('wooddeck');
    expect(meta.generatorVersion).toBe('1.2.3');
    expect(meta.createdAt).toBe('2024-11-01T00:00:00.000Z');
  });
});
