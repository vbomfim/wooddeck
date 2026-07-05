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
import { computeLayout } from '../../domain/layout/layout-engine';

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
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
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

// ---------------------------------------------------------------------------
// S25 pair-fix (Security#2 / GPT MED#3+#4 / Opus LOW#6 / QA G8):
// schema tightening on the optional `blockRowsHint` /
// `blockColsHint` fields introduced by S25.
//
//   - `type: integer` + `minimum: 2` (mirrors the AC4 perimeter-two
//     lower bound the runtime clamp enforces).
//   - `maximum: 100` — a generous fixed cap well above any
//     physically-sensible grid; the runtime density clamp
//     (MIN_BLOCK_SPACING_MM = 300 mm) reduces this further per
//     deck length, so 100 is the schema-level "not-obviously-
//     hostile" bound.
//
// The tightening reduces the persisted-file trust boundary:
// pre-fix, a `.deck` file could smuggle `blockRowsHint: -1` or
// `blockRowsHint: "3"` past Ajv → apply-parameters accepted the
// bogus subtree → the layout silently clamped, but the persisted
// design still carried garbage. Now the load-time Ajv rejection
// catches it.
// ---------------------------------------------------------------------------

describe('deserialize — S25 blockRowsHint schema tightening', () => {
  const HINT_OPTS = {
    createdAt: '2026-07-04T00:00:00.000Z',
    generatorVersion: '1.0.0',
  } as const;

  function floatingTuffWithHint(overrides: Record<string, unknown>): string {
    // Serialize a valid floating+tuffblocks base then patch the
    // foundation to inject the hint under test. Bypasses the
    // domain-type readonly narrowing while keeping the envelope
    // otherwise-valid.
    const base = {
      ...GOLDEN_DECK_DESIGN,
      structure: 'floating' as const,
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
      },
    };
    const s = serialize(base, HINT_OPTS);
    const parsed = JSON.parse(s) as DeckFileV2;
    const patched = {
      ...parsed,
      design: {
        ...parsed.design,
        foundation: { ...parsed.design.foundation, ...overrides },
      },
    };
    return JSON.stringify(patched);
  }

  it('rejects blockRowsHint = 0 (below minimum 2)', () => {
    const rogue = floatingTuffWithHint({ blockRowsHint: 0 });
    try {
      deserialize(rogue);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      expect((err as DeckFileError).code).toBe('schema-validation-failed');
      expect((err as DeckFileError).message).toMatch(/blockRowsHint|minimum/i);
    }
  });

  it('rejects blockRowsHint = 1 (below minimum 2)', () => {
    const rogue = floatingTuffWithHint({ blockRowsHint: 1 });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects blockRowsHint = 1.5 (non-integer)', () => {
    const rogue = floatingTuffWithHint({ blockRowsHint: 1.5 });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects blockRowsHint = "3" (wrong type — string)', () => {
    const rogue = floatingTuffWithHint({ blockRowsHint: '3' });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects blockRowsHint = -1 (negative)', () => {
    const rogue = floatingTuffWithHint({ blockRowsHint: -1 });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects blockRowsHint = 101 (above maximum 100)', () => {
    const rogue = floatingTuffWithHint({ blockRowsHint: 101 });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects blockColsHint = 0 (mirrors the row-hint bounds)', () => {
    const rogue = floatingTuffWithHint({ blockColsHint: 0 });
    expect(() => deserialize(rogue)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  // QA G8: round-trip a floating tuffblock design carrying a valid
  // `blockRowsHint: 3` — serialize → deserialize → deep-equal
  // original. This is the "the legitimate write path still works"
  // proof.
  it('QA G8 round-trip: floating + tuffblocks with blockRowsHint = 3 deep-equals the original', () => {
    const withHint = {
      ...GOLDEN_DECK_DESIGN,
      structure: 'floating' as const,
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
        blockRowsHint: 3,
      },
    };
    const json = serialize(withHint, HINT_OPTS);
    const { design, migrated } = deserialize(json);
    expect(migrated).toBe(false);
    // The round-tripped foundation MUST carry the hint verbatim.
    expect(design.foundation).toEqual(withHint.foundation);
  });

  it('QA G8 round-trip: valid blockColsHint = 2 preserved end-to-end', () => {
    const withColsHint = {
      ...GOLDEN_DECK_DESIGN,
      structure: 'floating' as const,
      foundation: {
        type: 'tuffblocks' as const,
        product: { productId: 'tuffblock-12x12x4' as const },
        blockColsHint: 2,
      },
    };
    const json = serialize(withColsHint, HINT_OPTS);
    const { design } = deserialize(json);
    expect(design.foundation).toEqual(withColsHint.foundation);
  });
});

// ---------------------------------------------------------------------------
// S26 FIX #3 (review-gate, DATA-LOSS) — pre-S26 floating decks load
// ---------------------------------------------------------------------------
//
// Regression target: pre-fix, `withFloatingFramingDefault` stamped
// `'beams-and-joists'` unconditionally when the v2 payload omitted
// `floatingFraming`. Method A's stack is TALLER than Method B's
// (adds a beam layer), so a pre-S26 floating design with
// `heightMm ∈ [209, 393) mm` — the range that was VALID pre-S26
// (Method B min = 209 mm) but became INVALID for Method A
// (min = 393 mm) — throws `LayoutError` on the first `computeLayout`
// call after load. The user's saved `.deck` / localStorage design
// silently breaks with no way to open it.
//
// Fix: when the payload lacks `floatingFraming`, choose Method B
// (`'joists-on-blocks'`) IFF `heightMm` is below the Method-A min
// AND ≥ the Method-B min. Otherwise choose Method A (the default).
// This keeps every pre-S26 file loadable with a sensible geometry
// and NEVER silently bumps the user's `heightMm`.

describe('deserialize — S26 FIX #3: pre-S26 floating decks default to Method B when heightMm is short', () => {
  const OPTS = {
    createdAt: '2026-07-04T00:00:00.000Z',
    generatorVersion: '1.0.0',
  } as const;

  function makeV2EnvelopeMissingFraming(
    designPatch: Record<string, unknown>,
  ): string {
    // Build a valid v2 envelope from GOLDEN_DECK_DESIGN, then strip
    // `floatingFraming` from the design payload (the field is
    // OPTIONAL in the v2 schema exactly so this is a legal payload).
    const s = serialize(GOLDEN_DECK_DESIGN, OPTS);
    const parsed = JSON.parse(s) as DeckFileV2;
    const rawDesign = { ...parsed.design, ...designPatch } as Record<string, unknown>;
    delete rawDesign['floatingFraming'];
    const patchedEnv = { ...parsed, design: rawDesign };
    return JSON.stringify(patchedEnv);
  }

  it('pre-S26 floating design at heightMm=209 loads with floatingFraming="joists-on-blocks" (Method B — the low-profile pre-S26 min)', () => {
    // 209 mm = joistDepth (2×8 = 184) + deckingThickness (5/4×6 = 25).
    // This was a legal pre-S26 floating min height (there were no
    // joists in the stack). Method A min = 393; Method B min = 209.
    const rogue = makeV2EnvelopeMissingFraming({
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      footprint: {
        widthMm: 4 * 304.8,
        lengthMm: 4 * 304.8,
        heightMm: 209,
      },
    });
    const { design } = deserialize(rogue);
    expect(design.floatingFraming).toBe('joists-on-blocks');
    // And crucially: the loaded design MUST NOT throw on
    // computeLayout — the data-loss claim was "silently unopenable."
    expect(() =>
      computeLayout(design, { now: () => '2026-07-04T00:00:00.000Z' }),
    ).not.toThrow();
  });

  it('pre-S26 floating design at heightMm=500 (comfortably clearing Method A) defaults to Method A', () => {
    // At a comfortable heightMm, the default remains Method A —
    // ONLY the low-profile pre-S26 files get auto-selected Method B.
    const rogue = makeV2EnvelopeMissingFraming({
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      footprint: {
        widthMm: 4 * 304.8,
        lengthMm: 4 * 304.8,
        heightMm: 500,
      },
    });
    const { design } = deserialize(rogue);
    expect(design.floatingFraming).toBe('beams-and-joists');
  });

  it('pre-S26 ELEVATED design defaults to Method A (floatingFraming is IGNORED for elevated but must be stamped for type-safety)', () => {
    // Elevated designs read no `floatingFraming`; the default stamp
    // should still be a valid enum value. Method A is the canonical
    // default per model.ts doc-block.
    const rogue = makeV2EnvelopeMissingFraming({}); // elevated is GOLDEN default
    const { design } = deserialize(rogue);
    expect(design.structure).toBe('elevated');
    expect(design.floatingFraming).toBe('beams-and-joists');
  });

  it('an INVALID floatingFraming enum value is REJECTED by Ajv (Security-INFO#1 / QA-GAP-1 defensive gate)', () => {
    const rogue = makeV2EnvelopeMissingFraming({});
    // Re-inject a bogus value.
    const parsed = JSON.parse(rogue) as DeckFileV2;
    const patched = {
      ...parsed,
      design: { ...parsed.design, floatingFraming: 'bogus-value' },
    };
    expect(() => deserialize(JSON.stringify(patched))).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  // S26 FIX #7 residual (property-order slip in `finalizeFloatingFraming`).
  //
  // Regression: the pre-fix helper stamped the field via
  // `{ ...design, floatingFraming: X }`, which appends `floatingFraming`
  // AFTER `layout` in JS spread key order — violating the canonical
  // `DeckDesign` property order established in FIX #7 (Opus#6):
  // `floatingFraming` MUST land immediately after `structure`, matching
  // `model.ts`, `default-design.ts`, the `model.test` golden, and every
  // persistence fixture.
  //
  // Why key order matters even for read-only load: `JSON.stringify` emits
  // insertion order, so a design loaded via the stamp path and re-serialized
  // would produce a byte-DIFFERENT `.deck` file from the same design
  // constructed via the default factory. That silently breaks the byte-for-
  // byte round-trip property (`model.test` AC4) and any external diff tool
  // pointed at two `.deck` files.

  it('stamps floatingFraming in the CANONICAL property order (immediately after `structure`)', () => {
    // Loading a pre-S26 floating file that hits the height-corridor
    // stamps Method B. The resulting design's key order must place
    // `floatingFraming` right after `structure`, NOT at the end.
    const rogue = makeV2EnvelopeMissingFraming({
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      footprint: {
        widthMm: 4 * 304.8,
        lengthMm: 4 * 304.8,
        heightMm: 209, // → Method B stamp path
      },
    });
    const { design } = deserialize(rogue);
    const keys = Object.keys(design);
    const structureIdx = keys.indexOf('structure');
    const framingIdx = keys.indexOf('floatingFraming');
    // Field must be present AND lie exactly one slot after `structure`.
    expect(structureIdx).toBeGreaterThanOrEqual(0);
    expect(framingIdx).toBe(structureIdx + 1);
    // And it must NOT be the last key (which is where a naive
    // `{ ...design, floatingFraming: X }` spread would put it).
    expect(framingIdx).not.toBe(keys.length - 1);
  });

  it('elevated stamp path also produces canonical property order', () => {
    // Same guard on the OTHER stamp path — elevated + missing field
    // hits `if (design.structure !== 'floating')` and returns early.
    const rogue = makeV2EnvelopeMissingFraming({}); // elevated GOLDEN default
    const { design } = deserialize(rogue);
    const keys = Object.keys(design);
    expect(keys.indexOf('floatingFraming')).toBe(
      keys.indexOf('structure') + 1,
    );
  });

  it('height-comfortable floating stamp path also produces canonical property order', () => {
    // The third stamp path (`heightMm ≥ methodAMin` → Method A default).
    const rogue = makeV2EnvelopeMissingFraming({
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      footprint: {
        widthMm: 4 * 304.8,
        lengthMm: 4 * 304.8,
        heightMm: 500, // → Method A stamp path
      },
    });
    const { design } = deserialize(rogue);
    const keys = Object.keys(design);
    expect(keys.indexOf('floatingFraming')).toBe(
      keys.indexOf('structure') + 1,
    );
  });

  it('stamped design JSON-serializes to a canonical key sequence (byte-order regression)', () => {
    // Belt-and-suspenders: the resulting design, when re-serialized
    // via JSON.stringify, produces `structure` immediately followed
    // by `floatingFraming` in the byte stream (validates the load-
    // then-re-save round-trip). Uses the elevated stamp path for a
    // simple pin.
    const rogue = makeV2EnvelopeMissingFraming({});
    const { design } = deserialize(rogue);
    const json = JSON.stringify(design);
    // Regex requires `"structure":"..."` to appear IMMEDIATELY before
    // `,"floatingFraming":"..."` with no intervening properties.
    expect(json).toMatch(/"structure":"[^"]+","floatingFraming":"[^"]+"/);
  });
});

// ===========================================================================
// S27 — feat/joist-beam-connection (`beamConnection` field)
// ===========================================================================
//
// The v2 schema is EXTENDED with a new OPTIONAL string enum field:
//
//     "beamConnection": "drop" | "flush"      -- OPTIONAL in the schema
//
// On the WIRE the field is optional so pre-S27 v2 files still load. Inside
// the domain type it is REQUIRED (see `model.ts` — the load path stamps a
// default of `'drop'` via `finalizeBeamConnection` when missing, which
// preserves pre-S27 semantics: joists rest on beam tops).
//
// The finalize helper MIRRORS the S26 `finalizeFloatingFraming` pattern
// (one seam routing both v1-migration and v2-native load paths through a
// single defaulter). The stamp helper `stampBeamConnection` rebuilds the
// design in CANONICAL key order (immediately after `floatingFraming`), so
// a loaded design and a factory-constructed design serialize byte-for-byte
// identically.

describe('deserialize — S27 beamConnection load defaults + canonical order', () => {
  const OPTS = {
    createdAt: '2026-07-04T00:00:00.000Z',
    generatorVersion: '1.0.0',
  } as const;

  function makeV2EnvelopeMissingBeamConn(): string {
    // Build a valid v2 envelope from GOLDEN_DECK_DESIGN, then strip
    // `beamConnection` from the design payload. The field is
    // OPTIONAL in the v2 schema exactly so this is a legal payload.
    const s = serialize(GOLDEN_DECK_DESIGN, OPTS);
    const parsed = JSON.parse(s) as DeckFileV2;
    const rawDesign = { ...parsed.design } as Record<string, unknown>;
    delete rawDesign['beamConnection'];
    const patchedEnv = { ...parsed, design: rawDesign };
    return JSON.stringify(patchedEnv);
  }

  it('pre-S27 v2 file (no beamConnection field) loads with beamConnection="drop" (preserves pre-S27 geometry)', () => {
    const rogue = makeV2EnvelopeMissingBeamConn();
    const { design } = deserialize(rogue);
    expect(design.beamConnection).toBe('drop');
  });

  it('v2 file with beamConnection="flush" loads with beamConnection="flush" (round-trip)', () => {
    // Round-trip: start from GOLDEN, apply flush, serialize,
    // deserialize; the loaded design must carry `'flush'`.
    const flushDesign = {
      ...GOLDEN_DECK_DESIGN,
      beamConnection: 'flush' as const,
    };
    const s = serialize(flushDesign, OPTS);
    const { design } = deserialize(s);
    expect(design.beamConnection).toBe('flush');
  });

  it('an INVALID beamConnection enum value is REJECTED by Ajv', () => {
    // Reject `'bogus'` via the schema's enum constraint.
    const s = serialize(GOLDEN_DECK_DESIGN, OPTS);
    const parsed = JSON.parse(s) as DeckFileV2;
    const patched = {
      ...parsed,
      design: { ...parsed.design, beamConnection: 'bogus-value' },
    };
    expect(() => deserialize(JSON.stringify(patched))).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('stamps beamConnection in the CANONICAL property order (immediately after `floatingFraming`)', () => {
    // Loading a pre-S27 v2 file that lacks `beamConnection` stamps
    // the default. The resulting design's key order must place
    // `beamConnection` right after `floatingFraming`, NOT at the
    // end. Mirrors the S26 FIX #7 residual guard above.
    const rogue = makeV2EnvelopeMissingBeamConn();
    const { design } = deserialize(rogue);
    const keys = Object.keys(design);
    const framingIdx = keys.indexOf('floatingFraming');
    const bcIdx = keys.indexOf('beamConnection');
    expect(framingIdx).toBeGreaterThanOrEqual(0);
    expect(bcIdx).toBe(framingIdx + 1);
    // Not the last key (which is where a naive
    // `{ ...design, beamConnection: X }` spread would put it).
    expect(bcIdx).not.toBe(keys.length - 1);
  });

  it('stamped design JSON-serializes with beamConnection immediately after floatingFraming (byte-order regression)', () => {
    const rogue = makeV2EnvelopeMissingBeamConn();
    const { design } = deserialize(rogue);
    const json = JSON.stringify(design);
    expect(json).toMatch(
      /"floatingFraming":"[^"]+","beamConnection":"[^"]+"/,
    );
  });

  it('round-trip byte identity: serialize(design) then deserialize + re-serialize is byte-identical', () => {
    // The finalize helpers preserve canonical order under load, so
    // a design that was written then read then re-written must
    // produce the same bytes. This is the load-then-save
    // invariant that pins the schema's contract.
    const first = serialize(GOLDEN_DECK_DESIGN, OPTS);
    const { design } = deserialize(first);
    const second = serialize(design, OPTS);
    expect(second).toBe(first);
  });

  // G5 (S27 review-response) — parametrized byte-identity save/load
  // round-trip over drop AND flush. Pins that the presence of the
  // 'flush' value on the wire does not break canonical ordering
  // (already the case for 'drop' — the golden defaults there). If a
  // future refactor accidentally lower-cased or reordered the field
  // for one variant only, this test fires.
  it.each(['drop', 'flush'] as const)(
    'G5: byte-identity round-trip for beamConnection = %s',
    (bc) => {
      const design = { ...GOLDEN_DECK_DESIGN, beamConnection: bc };
      const first = serialize(design, OPTS);
      const { design: reloaded } = deserialize(first);
      expect(reloaded.beamConnection).toBe(bc);
      const second = serialize(reloaded, OPTS);
      expect(second).toBe(first);
    },
  );
});

// -----------------------------------------------------------------
// S27 review-response HIGH regression — finalize ordering under
// missing BOTH optional fields.
//
// `finalizeDesign = finalizeBeamConnection ∘ finalizeFloatingFraming`
// runs `finalizeFloatingFraming` FIRST. That helper PROBES Method-A
// vs Method-B by computing floating heights (`computeMinFloating-
// HeightMm`, which reaches `computeYStackFloating`). After S27's
// hardening, the floating y-stack has an exhaustive
// `switch (beamConnection)` with `default: assertNever(...)`. When
// a pre-S27 v2 file is missing BOTH `floatingFraming` AND
// `beamConnection`, `beamConnection` is still `undefined` during the
// probe → `assertNever(undefined)` throws → the broad `try/catch` in
// the probe swallows the error and falls back to Method A. A
// low-profile floating file that SHOULD default to Method B then
// fails Method-A's height validation and becomes silently
// unopenable.
//
// Fix: reorder `finalizeDesign` so `finalizeBeamConnection` runs
// FIRST. That way the height-probe always sees a defined
// `beamConnection` (`'drop'`). Also make the probe defensive
// (`beamConnection: design.beamConnection ?? 'drop'`) so a future
// caller can't hit the same failure mode.
// -----------------------------------------------------------------

describe('deserialize — S27 review-response: finalize order regression (missing BOTH optional fields)', () => {
  const OPTS = {
    createdAt: '2026-07-04T00:00:00.000Z',
    generatorVersion: '1.0.0',
  } as const;

  function makeV2EnvelopeMissingBoth(
    designPatch: Record<string, unknown>,
  ): string {
    // Build a valid v2 envelope from GOLDEN_DECK_DESIGN, then strip
    // BOTH `floatingFraming` AND `beamConnection` from the design
    // payload (both are OPTIONAL in the v2 schema, so this is a
    // legal payload — representative of a pre-S26 v2 `.deck` file
    // that was written before either field existed).
    const s = serialize(GOLDEN_DECK_DESIGN, OPTS);
    const parsed = JSON.parse(s) as DeckFileV2;
    const rawDesign = { ...parsed.design, ...designPatch } as Record<
      string,
      unknown
    >;
    delete rawDesign['floatingFraming'];
    delete rawDesign['beamConnection'];
    const patchedEnv = { ...parsed, design: rawDesign };
    return JSON.stringify(patchedEnv);
  }

  it('low-profile floating design missing BOTH fields defaults to Method B + drop, loads without throwing (fix for assertNever regression)', () => {
    // 209 mm is a legal pre-S26 min floating height (joistDepth 184
    // + deckingThickness 25) that lives in the Method-B-legal /
    // Method-A-too-short corridor `[methodBMin, methodAMin)`. Under
    // the pre-fix finalize order, the probe throws inside the
    // `switch (beamConnection)` on `assertNever(undefined)`; the
    // catch swallows it and stamps Method A; then Method A's height
    // validation rejects the design and `computeLayout` throws.
    //
    // Post-fix (finalizeBeamConnection runs FIRST), the probe sees
    // `beamConnection: 'drop'` and correctly classifies the design
    // as Method B — the design loads and computes a valid layout.
    const rogue = makeV2EnvelopeMissingBoth({
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      footprint: {
        widthMm: 4 * 304.8,
        lengthMm: 4 * 304.8,
        heightMm: 209,
      },
    });
    // Load must not throw.
    const { design } = deserialize(rogue);
    // Both fields defaulted correctly.
    expect(design.floatingFraming).toBe('joists-on-blocks');
    expect(design.beamConnection).toBe('drop');
    // Downstream computeLayout must succeed — this is the
    // "silently unopenable" contract this test defends.
    expect(() =>
      computeLayout(design, { now: () => '2026-07-04T00:00:00.000Z' }),
    ).not.toThrow();
  });

  it('elevated design missing BOTH fields defaults to Method A + drop, loads without throwing', () => {
    // Elevated ignores `floatingFraming` at layout time, but the
    // finalizer still stamps a value. `beamConnection` defaults to
    // `'drop'`. Pre-fix this path did NOT throw (the probe is
    // gated on `structure === 'floating'`) — this test guards
    // against a regression that would generalize the bug.
    const rogue = makeV2EnvelopeMissingBoth({}); // elevated is GOLDEN default
    const { design } = deserialize(rogue);
    expect(design.structure).toBe('elevated');
    expect(design.floatingFraming).toBe('beams-and-joists');
    expect(design.beamConnection).toBe('drop');
    expect(() =>
      computeLayout(design, { now: () => '2026-07-04T00:00:00.000Z' }),
    ).not.toThrow();
  });

  it('comfortable-height floating design missing BOTH fields defaults to Method A + drop', () => {
    // 500 mm comfortably clears Method A min for the fixture
    // materials — the classifier stamps the canonical Method A
    // default. `beamConnection` still defaults to `'drop'`.
    const rogue = makeV2EnvelopeMissingBoth({
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      footprint: {
        widthMm: 4 * 304.8,
        lengthMm: 4 * 304.8,
        heightMm: 500,
      },
    });
    const { design } = deserialize(rogue);
    expect(design.floatingFraming).toBe('beams-and-joists');
    expect(design.beamConnection).toBe('drop');
  });
});
