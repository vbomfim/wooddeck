/**
 * Unit tests for `src/persistence/deck-file/schema-v2.ts` — the
 * envelope + serialize/deserialize surface for the `.deck` v2 file
 * format (S18). Extends the pre-existing v1 test coverage to the
 * v2 default emission (AC10) and the v1→v2 migration seam (AC9).
 *
 * ## Coverage map (GitHub issue #40 acceptance criteria)
 *
 *   - AC1 (v2 round-trip identity — HONEST CONTRACT). Three
 *     invariants, mirrored from v1:
 *       (1) design round-trips deep-equal,
 *       (2) metadata-preserving byte-identity when the caller pins
 *           `createdAt` + `generatorVersion` on the second serialize,
 *       (3) design-payload JSON is byte-stable across two serializes
 *           with the same pinned metadata.
 *   - AC2 (envelope contents)   — every stamped field is asserted;
 *     `schema: 2` is the default (AC10).
 *   - AC4 (rejects malformed `structure`) — Ajv v2 catches unknown
 *     enum values with a field-path message.
 *   - AC4 (rejects malformed `foundation.productId`) — same.
 *   - AC5 (accepts every valid combo per the S17 compat matrix) —
 *     the v2 schema is deliberately PERMISSIVE re: structure ×
 *     foundation combinations; the compat matrix is enforced at the
 *     domain layer. This test just proves the schema doesn't gate.
 *   - AC7 (unknown-schema precheck — schema: 99) — same as v1 AC3
 *     but the known-set is now `{1, 2}`.
 *   - AC7 (non-integer schema falls through to Ajv) — regression
 *     fence carried over from v1 (Code Review GPT#4).
 *   - AC9 (`migrated` boolean) — v2 native envelopes surface
 *     `migrated === false`; v1 migration surfaces `migrated === true`
 *     (v1 corpus tests live in `migrate-v1-to-v2.test.ts`).
 *
 * ## Test environment
 *
 * Vitest's default env for wooddeck is jsdom (see `vite.config.ts`),
 * which provides `JSON`, `Date`, and every other host object this
 * file exercises. No environment override is needed here.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { deserialize, serialize } from './schema-v2';
import type { DeckFileV2 } from './envelope-types';
import { DeckFileError } from './errors';
import { GOLDEN_DECK_DESIGN, deckDesignArb } from './__fixtures__/deck-designs';

// ---------------------------------------------------------------------------
// AC1 — honest round-trip contract (golden fixture + property test)
// ---------------------------------------------------------------------------
//
// Three invariants, none of which pretend that two default serialize()
// calls produce byte-identical output (their `createdAt` values differ
// by design — see `schema-v2.ts` module header).

describe('serialize/deserialize — AC1 honest round-trip contract (v2)', () => {
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

  it('invariant 3: two serialize calls with SAME pinned metadata are byte-identical (golden fixture)', () => {
    const opts = {
      createdAt: '2026-07-04T00:00:00.000Z',
      generatorVersion: '0.0.0-test',
    };
    const a = serialize(GOLDEN_DECK_DESIGN, opts);
    const b = serialize(GOLDEN_DECK_DESIGN, opts);
    expect(a).toBe(b);
  });

  it('invariant 3 (property): byte-identical for any generated DeckDesign under pinned metadata', () => {
    const opts = {
      createdAt: '2026-07-04T00:00:00.000Z',
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

  it('anti-invariant: two default serializes MAY differ (createdAt drifts by design)', async () => {
    const a = serialize(GOLDEN_DECK_DESIGN);
    await new Promise((r) => setTimeout(r, 2));
    const b = serialize(GOLDEN_DECK_DESIGN);
    const createdA = (JSON.parse(a) as { createdAt: string }).createdAt;
    const createdB = (JSON.parse(b) as { createdAt: string }).createdAt;
    expect(Date.parse(createdB)).toBeGreaterThanOrEqual(Date.parse(createdA));
    if (createdA !== createdB) {
      expect(a).not.toBe(b);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — envelope contents (v2 default per AC10)
// ---------------------------------------------------------------------------

describe('serialize — AC2/AC10 envelope contents (v2 default)', () => {
  it('stamps every documented envelope field with schema:2', () => {
    const before = Date.now();
    const json = serialize(GOLDEN_DECK_DESIGN);
    const after = Date.now();
    const parsed = JSON.parse(json) as DeckFileV2;
    expect(parsed.schema).toBe(2);
    expect(parsed.generator).toBe('wooddeck');
    expect(parsed.generatorVersion).toEqual(expect.any(String));
    expect(parsed.generatorVersion.length).toBeGreaterThan(0);
    const stampedMs = Date.parse(parsed.createdAt);
    expect(Number.isNaN(stampedMs)).toBe(false);
    expect(stampedMs).toBeGreaterThanOrEqual(before);
    expect(stampedMs).toBeLessThanOrEqual(after);
    expect(parsed.design).toEqual(GOLDEN_DECK_DESIGN);
  });

  it('respects an explicit `opts.generatorVersion`', () => {
    const json = serialize(GOLDEN_DECK_DESIGN, { generatorVersion: '9.9.9-rc' });
    const parsed = JSON.parse(json) as DeckFileV2;
    expect(parsed.generatorVersion).toBe('9.9.9-rc');
  });

  it('respects an explicit `opts.createdAt`', () => {
    const json = serialize(GOLDEN_DECK_DESIGN, { createdAt: '2020-01-02T03:04:05.000Z' });
    const parsed = JSON.parse(json) as DeckFileV2;
    expect(parsed.createdAt).toBe('2020-01-02T03:04:05.000Z');
  });

  it('emits fields in canonical order (schema, generator, generatorVersion, createdAt, design)', () => {
    const json = serialize(GOLDEN_DECK_DESIGN, {
      createdAt: '2026-07-04T00:00:00.000Z',
      generatorVersion: '0.0.0-test',
    });
    expect(
      json.startsWith(
        '{"schema":2,"generator":"wooddeck","generatorVersion":"0.0.0-test","createdAt":"2026-07-04T00:00:00.000Z","design":',
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC7 — unknown schema rejected (precheck integer-only)
// ---------------------------------------------------------------------------

describe('deserialize — AC7 unknown-schema rejection', () => {
  it('throws DeckFileError with code=unknown-schema for schema=999', () => {
    const rogue = JSON.stringify({
      schema: 999,
      generator: 'wooddeck',
      generatorVersion: '9.9.9',
      createdAt: '2026-07-04T00:00:00.000Z',
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

  it('throws unknown-schema for schema=99 (S18 AC7 canonical fixture)', () => {
    const rogue = JSON.stringify({
      schema: 99,
      generator: 'wooddeck',
      generatorVersion: '9.9.9',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'unknown-schema' }),
    );
  });

  it('handles the schema field being missing entirely — reports a typed DeckFileError', () => {
    const rogue = JSON.stringify({
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(DeckFileError);
  });
});

// ---------------------------------------------------------------------------
// AC7 (extension) — non-integer / non-numeric `schema` values classify
// as `schema-validation-failed`, NOT as `unknown-schema`
// ---------------------------------------------------------------------------

describe('deserialize — non-integer schema falls through to Ajv (Code Review GPT #4)', () => {
  it('classifies schema=1.5 as schema-validation-failed (NOT unknown-schema)', () => {
    const rogue = JSON.stringify({
      schema: 1.5,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    try {
      deserialize(rogue);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      expect(dfe.message.toLowerCase()).not.toContain('upgrade');
    }
  });

  it('classifies schema="2" (string) as schema-validation-failed', () => {
    const rogue = JSON.stringify({
      schema: '2',
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-04T00:00:00.000Z',
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
      createdAt: '2026-07-04T00:00:00.000Z',
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
      createdAt: '2026-07-04T00:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('KEEPS the unknown-schema path for future integers (3, 4, 99, 999)', () => {
    // Regression fence — narrowing the precheck to integers must NOT
    // break the actual "future version" case. Note schema=1 and =2
    // are now KNOWN (v1 migration + v2 native), so they are NOT
    // exercised here.
    for (const version of [3, 4, 99, 12345]) {
      const rogue = JSON.stringify({
        schema: version,
        generator: 'wooddeck',
        generatorVersion: '9.9.9',
        createdAt: '2026-07-04T00:00:00.000Z',
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

describe('deserialize — generatorVersion semver pattern (review fix F)', () => {
  it('accepts a valid semver like "1.2.3"', () => {
    const s = serialize(GOLDEN_DECK_DESIGN, {
      generatorVersion: '1.2.3',
      createdAt: '2026-07-04T00:00:00.000Z',
    });
    expect(() => deserialize(s)).not.toThrow();
  });

  it('accepts a semver with prerelease + build tag like "1.2.3-rc.1+abc"', () => {
    const s = serialize(GOLDEN_DECK_DESIGN, {
      generatorVersion: '1.2.3-rc.1+abc',
      createdAt: '2026-07-04T00:00:00.000Z',
    });
    expect(() => deserialize(s)).not.toThrow();
  });

  it('rejects a non-semver generatorVersion ("banana") with schema-validation-failed', () => {
    const s = serialize(GOLDEN_DECK_DESIGN, {
      generatorVersion: 'banana',
      createdAt: '2026-07-04T00:00:00.000Z',
    });
    try {
      deserialize(s);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      expect(dfe.message).toMatch(/generatorVersion|pattern/i);
    }
  });

  it('rejects a partial version like "1.2" (missing patch)', () => {
    const s = serialize(GOLDEN_DECK_DESIGN, {
      generatorVersion: '1.2',
      createdAt: '2026-07-04T00:00:00.000Z',
    });
    expect(() => deserialize(s)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });
});

// ---------------------------------------------------------------------------
// AC6 — corrupt JSON rejected
// ---------------------------------------------------------------------------

describe('deserialize — invalid-JSON rejection', () => {
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
      deserialize('{"schema": 2,');
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
    const s = serialize(GOLDEN_DECK_DESIGN, {
      createdAt: '2026-07-04T00:00:00.000Z',
      generatorVersion: '1.0.0',
    });
    // Splice `"__proto__":{"polluted":true},` in right after the
    // opening `"design":{` — Ajv's `additionalProperties:false` on
    // `design` must reject it.
    const injected = s.replace('"design":{', '"design":{"__proto__":{"polluted":true},');
    expect(() => deserialize(injected)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
    // Observable: Object.prototype was NOT mutated regardless.
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects a payload whose envelope carries a `constructor` key inside design', () => {
    const s = serialize(GOLDEN_DECK_DESIGN, {
      createdAt: '2026-07-04T00:00:00.000Z',
      generatorVersion: '1.0.0',
    });
    const injected = s.replace(
      '"design":{',
      '"design":{"constructor":{"prototype":{"polluted":true}},',
    );
    expect(() => deserialize(injected)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC9 — return shape includes `migrated` discriminator
// ---------------------------------------------------------------------------

describe('deserialize — AC9 return shape (design/meta/migrated)', () => {
  it('returns { design, meta, migrated: false } for a native v2 envelope', () => {
    const json = serialize(GOLDEN_DECK_DESIGN, {
      createdAt: '2024-11-01T00:00:00.000Z',
      generatorVersion: '1.2.3',
    });
    const { design, meta, migrated } = deserialize(json);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
    expect(meta.schema).toBe(2);
    expect(meta.generator).toBe('wooddeck');
    expect(meta.generatorVersion).toBe('1.2.3');
    expect(meta.createdAt).toBe('2024-11-01T00:00:00.000Z');
    expect(migrated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC4 — v2 schema rejects malformed `structure` / `foundation`
// ---------------------------------------------------------------------------

describe('deserialize — AC4 v2 schema rejects malformed Epic-2 fields', () => {
  function envelopeWithDesignPatch(patch: Record<string, unknown>): string {
    const s = serialize(GOLDEN_DECK_DESIGN, {
      createdAt: '2026-07-04T00:00:00.000Z',
      generatorVersion: '1.0.0',
    });
    // Replace `"design":{...}` with the patched design (canonical
    // stringify — no order guarantee across fields the injector
    // adds; Ajv doesn't care about order).
    const parsed = JSON.parse(s) as DeckFileV2;
    const patchedDesign = { ...parsed.design, ...patch };
    const patchedEnv = { ...parsed, design: patchedDesign };
    return JSON.stringify(patchedEnv);
  }

  it('rejects a bogus structure value ("bouncy")', () => {
    const rogue = envelopeWithDesignPatch({ structure: 'bouncy' });
    try {
      deserialize(rogue);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      // Message must NAME the field so a user knows what's wrong.
      expect(dfe.message).toMatch(/structure|enum/i);
    }
  });

  it('rejects an unknown foundation.productId under deck-blocks', () => {
    const rogue = envelopeWithDesignPatch({
      structure: 'floating',
      foundation: {
        type: 'deck-blocks',
        product: { productId: 'unknown-sku-999' },
      },
    });
    try {
      deserialize(rogue);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      // Message may reference `productId`, `enum`, or a `oneOf`
      // branch — accept any of them as evidence the field path was
      // surfaced.
      expect(dfe.message).toMatch(/productId|enum|oneOf/i);
    }
  });

  it('rejects a foundation with an unknown discriminator (`type: "made-up"`)', () => {
    const rogue = envelopeWithDesignPatch({
      foundation: { type: 'made-up' },
    });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });
});

// ---------------------------------------------------------------------------
// AC5 — every VALID structure × foundation combo round-trips
// ---------------------------------------------------------------------------

describe('deserialize — AC5 valid structure × foundation combos round-trip', () => {
  // The v2 schema deliberately does NOT gate on combination validity;
  // the compat matrix is enforced at the domain layer. These fixtures
  // avoid invalid combos (elevated+tuffblocks, floating+posts-on-
  // footings) purely for cleanliness — a load-then-domain-validate
  // pipeline would reject them separately.

  const OPTS = {
    createdAt: '2026-07-04T00:00:00.000Z',
    generatorVersion: '1.0.0',
  } as const;

  it('elevated + posts-on-footings (default) round-trips', () => {
    const json = serialize(GOLDEN_DECK_DESIGN, OPTS);
    const { design, migrated } = deserialize(json);
    expect(migrated).toBe(false);
    expect(design.structure).toBe('elevated');
    expect(design.foundation.type).toBe('posts-on-footings');
  });

  it('elevated + deck-blocks round-trips', () => {
    const withDeckBlocks = {
      ...GOLDEN_DECK_DESIGN,
      structure: 'elevated' as const,
      foundation: {
        type: 'deck-blocks' as const,
        product: { productId: 'oldcastle-11x11x7' as const },
      },
    };
    const json = serialize(withDeckBlocks, OPTS);
    const { design, migrated } = deserialize(json);
    expect(migrated).toBe(false);
    expect(design.foundation).toEqual(withDeckBlocks.foundation);
  });

  it('floating + deck-blocks round-trips', () => {
    const floatingDeckBlocks = {
      ...GOLDEN_DECK_DESIGN,
      structure: 'floating' as const,
      foundation: {
        type: 'deck-blocks' as const,
        product: { productId: 'oldcastle-11x11x7' as const },
      },
    };
    const json = serialize(floatingDeckBlocks, OPTS);
    const { design, migrated } = deserialize(json);
    expect(migrated).toBe(false);
    expect(design.structure).toBe('floating');
    expect(design.foundation.type).toBe('deck-blocks');
  });

  it('floating + tuffblocks round-trips', () => {
    const floatingTuff = {
      ...GOLDEN_DECK_DESIGN,
      structure: 'floating' as const,
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
      },
    };
    const json = serialize(floatingTuff, OPTS);
    const { design, migrated } = deserialize(json);
    expect(migrated).toBe(false);
    expect(design.foundation.type).toBe('tuffblocks');
  });
});
