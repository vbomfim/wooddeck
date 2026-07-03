/**
 * Unit tests for `src/persistence/deck-file/schema-v1.ts` — the
 * envelope + serialize/deserialize surface for the `.deck` v1 file
 * format. Written TDD-red before any implementation exists.
 *
 * ## Coverage map (GitHub issue #7 acceptance criteria)
 *
 *   - AC1 (round-trip identity) — golden fixture + property test.
 *   - AC2 (envelope contents)   — every stamped field is asserted.
 *   - AC3 (unknown schema)      — throws with `.code = 'unknown-schema'`.
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
// AC1 — round-trip identity (golden fixture + property test)
// ---------------------------------------------------------------------------

describe('serialize/deserialize — AC1 round-trip identity', () => {
  it('deep-equals the source design (golden fixture)', () => {
    const json = serialize(GOLDEN_DECK_DESIGN);
    const { design } = deserialize(json);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
  });

  it('is byte-for-byte idempotent on a second pass (golden fixture)', () => {
    const first = serialize(GOLDEN_DECK_DESIGN);
    const { design } = deserialize(first);
    // Pass an explicit `createdAt` + `generatorVersion` matching the
    // first call so we control the envelope stamps — otherwise the
    // ISO `createdAt` drifts and the strings differ. This proves the
    // NORMALISED serialization is stable, which is the SC-006 promise.
    const second = serialize(design, {
      createdAt: extractCreatedAt(first),
      generatorVersion: extractGeneratorVersion(first),
    });
    expect(second).toBe(first);
  });

  it('property: round-trip is deep-equal for every generated DeckDesign', () => {
    fc.assert(
      fc.property(deckDesignArb, (design) => {
        const json = serialize(design);
        const { design: parsed } = deserialize(json);
        expect(parsed).toEqual(design);
      }),
      { numRuns: 200 },
    );
  });

  it('property: second-pass serialize is byte-identical when envelope stamps are pinned', () => {
    fc.assert(
      fc.property(deckDesignArb, (design) => {
        const first = serialize(design, {
          createdAt: '2026-07-02T21:00:00.000Z',
          generatorVersion: '0.0.0-property-test',
        });
        const { design: parsed } = deserialize(first);
        const second = serialize(parsed, {
          createdAt: '2026-07-02T21:00:00.000Z',
          generatorVersion: '0.0.0-property-test',
        });
        expect(second).toBe(first);
      }),
      { numRuns: 100 },
    );
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

// ---------------------------------------------------------------------------
// Test-local helpers
// ---------------------------------------------------------------------------

function extractCreatedAt(envelopeJson: string): string {
  return (JSON.parse(envelopeJson) as { createdAt: string }).createdAt;
}
function extractGeneratorVersion(envelopeJson: string): string {
  return (JSON.parse(envelopeJson) as { generatorVersion: string }).generatorVersion;
}
