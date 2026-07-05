/**
 * Unit tests for `src/persistence/deck-file/validator.ts` — the Ajv
 * Draft-2020-12 validators loaded from the checked-in JSON Schemas
 * at `docs/deck-file-schema-v1.json` and `docs/deck-file-schema-v2.json`.
 *
 * ## Coverage map (issue #7 + S18 issue #40 acceptance criteria)
 *
 *   - AC4 (schema-validation failure surfaces the offending field).
 *   - AC5 (`docs/deck-file-schema-v1.json` is a valid Draft-2020-12
 *     document AND the validator is instantiated from that file, not
 *     from a hand-coded TS mirror). Extended for v2 (S18).
 *   - Envelope strictness policy: LENIENT at the root (additive future
 *     metadata OK), STRICT inside `design` (unknown fields rejected).
 *   - `useDefaults: false` — the validator MUST NOT mutate the payload
 *     by injecting schema defaults (a subtle vector for prototype
 *     pollution when the schema references literal objects).
 *
 * ## v1 vs v2 test-shape correspondence
 *
 * S18 changed `GOLDEN_DECK_DESIGN` in `./__fixtures__/deck-designs.ts`
 * to the post-Epic-2 shape (adds `structure` + `foundation`). The v1
 * validator's schema still requires the OLD shape and rejects the new
 * fields — so v1 tests here use `V1_LEGACY_DESIGN` (a v1-shape design
 * imported from the same shared fixtures module, review-gate FIX 5d).
 * v2 tests use `GOLDEN_DECK_DESIGN` unchanged.
 */
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { validateDeckFile, validateDeckFileV2 } from './validator';
import { DeckFileError } from './errors';
import { GOLDEN_DECK_DESIGN, V1_LEGACY_DESIGN } from './__fixtures__/deck-designs';

// Review-gate FIX 5d — V1_LEGACY_DESIGN (a v1-shape design) now
// lives in `./__fixtures__/deck-designs.ts` so BOTH this file and
// the migration corpus consume the SAME literal. The promoted
// V1_LEGACY_DESIGN is used for the "v1 design inside a v2 envelope"
// negative test below.
const V1_DESIGN = V1_LEGACY_DESIGN;

// ---------------------------------------------------------------------------
// AC5 — schema file is a valid Draft-2020-12 document
// ---------------------------------------------------------------------------

describe('validator — AC5 checked-in schema', () => {
  it('`docs/deck-file-schema-v1.json` parses as JSON', async () => {
    // Node fs is available in the vitest/jsdom env — vite serves
    // `import`s of `.json` under `resolveJsonModule`. We assert on
    // the same file the validator loads (see validator.ts).
    const { default: schema } = await import(
      '../../../docs/deck-file-schema-v1.json',
      { with: { type: 'json' } }
    );
    expect(schema).toBeDefined();
    const $schema = (schema as { $schema: string }).$schema;
    expect($schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('is accepted by an independently-instantiated Ajv 2020 validator', async () => {
    // Rebuild the validator from scratch here so a bug in the shared
    // instance can't hide behind itself.
    const { default: schema } = await import(
      '../../../docs/deck-file-schema-v1.json',
      { with: { type: 'json' } }
    );
    const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
    addFormats(ajv);
    // `compile` throws on an invalid schema — the presence of any
    // exception here means the checked-in schema is malformed.
    const compile = ajv.compile(schema as object);
    expect(typeof compile).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Envelope validation — happy path
// ---------------------------------------------------------------------------

describe('validateDeckFile — happy path', () => {
  it('accepts a well-formed v1 envelope wrapping the golden design', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: V1_DESIGN,
    };
    expect(() => validateDeckFile(envelope)).not.toThrow();
  });

  it('is TOLERANT of unknown TOP-LEVEL keys (envelope stays additive)', () => {
    // Trade-off decision (ticket §17): envelope-level extra fields
    // are additive metadata (future features like `checksum`, `notes`).
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: V1_DESIGN,
      futureMetadataField: { checksum: 'sha256:deadbeef' }, // NOT in schema
    };
    expect(() => validateDeckFile(envelope)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC4 — schema-validation failure surfaces the offending field
// ---------------------------------------------------------------------------

describe('validateDeckFile — AC4 failure identifies the offending field', () => {
  it('rejects a design missing `footprint` with a message naming the field', () => {
    const badDesign = { ...V1_DESIGN } as Record<string, unknown>;
    delete badDesign['footprint'];
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: badDesign,
    };
    try {
      validateDeckFile(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      // Message must NAME the offending field so a user / QA agent
      // can pinpoint what's wrong.
      expect(dfe.message).toMatch(/footprint/i);
    }
  });

  it('rejects a design with the wrong `orientation` enum value', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: {
        ...V1_DESIGN,
        decking: { ...V1_DESIGN.decking, orientation: 'diagonal-45' },
      },
    };
    try {
      validateDeckFile(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      expect(dfe.message).toMatch(/orientation|enum/i);
    }
  });

  it('rejects a design with a non-UUID `id`', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: { ...V1_DESIGN, id: 'not-a-uuid' },
    };
    expect(() => validateDeckFile(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects a design carrying an EXTRA field inside `design` (strict inside)', () => {
    // Ticket §11 API contract: `additionalProperties: false` inside
    // `design`. This test proves the schema is strict at that level.
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: { ...V1_DESIGN, rogueField: 42 },
    };
    expect(() => validateDeckFile(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects a design with an extra field inside a nested `joist` object', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: {
        ...V1_DESIGN,
        joist: {
          ...V1_DESIGN.joist,
          extraFieldInsideJoist: 'nope',
        },
      },
    };
    expect(() => validateDeckFile(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects a payload where `schema` is not the const 1', () => {
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: V1_DESIGN,
    };
    // Envelope-level schema field is `const: 1`, so validator rejects
    // any other integer here BEFORE the switch(schema) runs. Loader
    // callers must treat this as `schema-validation-failed` from the
    // validator (which the schema-v1 loader can then remap or wrap).
    expect(() => validateDeckFile(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects an envelope missing `createdAt`', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      design: V1_DESIGN,
    };
    expect(() => validateDeckFile(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects an envelope whose `createdAt` is not ISO-8601', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: 'yesterday-ish',
      design: V1_DESIGN,
    };
    expect(() => validateDeckFile(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Ajv config invariants — `useDefaults: false`, no payload mutation
// ---------------------------------------------------------------------------

describe('validateDeckFile — payload is not mutated', () => {
  it('leaves the input object structurally identical after a successful validate', () => {
    // `useDefaults: false` means Ajv must NOT inject default values
    // (which would be a prototype-pollution vector if a schema
    // referenced literal `{}` defaults that got shared across calls).
    const envelope = Object.freeze({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: V1_DESIGN,
    });
    // If Ajv tried to mutate the frozen input, this would throw.
    expect(() => validateDeckFile(envelope)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generatorVersion semver pattern (Review fix F — schema-level enforcement)
// ---------------------------------------------------------------------------
//
// The JSON Schema pins `generatorVersion` to a lenient semver `pattern`
// (`^\d+\.\d+\.\d+(?:[-+].+)?$`) — the intent was already documented in
// the spec but the schema previously accepted any string ≤ 64 chars.
// These tests exercise the validator layer directly (not just the
// higher-level deserialize surface) so a rewrite that swaps schema
// files but forgets the pattern is caught here at the closest layer.

describe('validateDeckFile — generatorVersion semver pattern (F)', () => {
  it('rejects generatorVersion="banana" — Ajv reports pattern/generatorVersion', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: 'banana',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: V1_DESIGN,
    };
    try {
      validateDeckFile(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      expect(dfe.message).toMatch(/generatorVersion|pattern/i);
    }
  });

  it('rejects generatorVersion="1.2" (missing patch component)', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.2',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: V1_DESIGN,
    };
    expect(() => validateDeckFile(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('accepts a well-formed semver with prerelease + build tags', () => {
    const envelope = {
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.2.3-rc.4+abc.def',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: V1_DESIGN,
    };
    expect(() => validateDeckFile(envelope)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// S18 — validateDeckFileV2 (v2 schema)
// ---------------------------------------------------------------------------

describe('validateDeckFileV2 — S18 v2 schema', () => {
  it('accepts a well-formed v2 envelope wrapping the (post-S17) golden design', () => {
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    };
    expect(() => validateDeckFileV2(envelope)).not.toThrow();
  });

  it('is TOLERANT of unknown TOP-LEVEL keys in a v2 envelope (additive metadata)', () => {
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
      futureMetadataField: { checksum: 'sha256:deadbeef' },
    };
    expect(() => validateDeckFileV2(envelope)).not.toThrow();
  });

  it('rejects a v2 design with an unknown structure value ("bouncy") — S18 AC4', () => {
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: { ...GOLDEN_DECK_DESIGN, structure: 'bouncy' },
    };
    try {
      validateDeckFileV2(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      // Message must NAME the offending field.
      expect(dfe.message).toMatch(/structure|enum/i);
    }
  });

  it('rejects a v2 design with an unknown foundation.productId — S18 AC4', () => {
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: {
        ...GOLDEN_DECK_DESIGN,
        structure: 'floating' as const,
        foundation: {
          type: 'deck-blocks' as const,
          product: { productId: 'made-up-sku-42' },
        },
      },
    };
    expect(() => validateDeckFileV2(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects a v2 design carrying an EXTRA field inside `design` (strict inside)', () => {
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: { ...GOLDEN_DECK_DESIGN, rogueField: 42 },
    };
    expect(() => validateDeckFileV2(envelope)).toThrowError(
      expect.objectContaining({ code: 'schema-validation-failed' }),
    );
  });

  it('rejects a v1-shape design (missing structure + foundation) in a v2 envelope', () => {
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: V1_DESIGN,
    };
    try {
      validateDeckFileV2(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      expect(dfe.message).toMatch(/structure|foundation/i);
    }
  });

  it('rejects a v2 design whose joist.spacingMm is below the 305 mm minimum (PR #73 review — MIN_JOIST_SPACING_MM defense-in-depth)', () => {
    // PR #73 review (GPT-5.5 HIGH #2 root fix) added a
    // 305 mm (12″ o.c.) practical minimum for joist.spacingMm.
    // Enforced at THREE layers:
    //   (1) domain — `validateJoistSpacing` throws LayoutError
    //   (2) persistence schema — `joist.spacingMm.minimum = 305`
    //   (3) UI — joist-spacing LengthField hint text
    // Layer (2) — this test — protects against a hand-crafted
    // `.deck` file that ships a sub-min value: it must be
    // REJECTED at deserialize (as a clean schema-validation
    // failure) rather than reaching the domain and throwing an
    // opaque LayoutError from deep inside `computeLayout`.
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: {
        ...GOLDEN_DECK_DESIGN,
        joist: {
          ...GOLDEN_DECK_DESIGN.joist,
          spacingMm: 200, // BELOW the 305 mm minimum
        },
      },
    };
    try {
      validateDeckFileV2(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      // Message names the offending field (Ajv reports the failing
      // instance path, which includes "spacingMm"). We do not
      // require a specific error phrasing beyond that so future
      // Ajv upgrades or schema wording changes do not brittly
      // fail this test.
      expect(dfe.message).toMatch(/spacingMm|minimum|305/i);
    }
  });

  it('ACCEPTS a v2 design whose joist.spacingMm is exactly the 305 mm minimum (inclusive boundary — PR #73 review)', () => {
    const envelope = {
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '0.0.0-test',
      createdAt: '2026-07-04T00:00:00.000Z',
      design: {
        ...GOLDEN_DECK_DESIGN,
        joist: {
          ...GOLDEN_DECK_DESIGN.joist,
          spacingMm: 305,
        },
      },
    };
    expect(() => validateDeckFileV2(envelope)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FIX 3 (review gate) — discriminator-aware foundation error messages
// ---------------------------------------------------------------------------
//
// Pre-fix bug: for a malformed `foundation`, Ajv walks every `oneOf`
// branch and reports a `const` error from the WRONG variant. E.g.
// `foundation: { type: 'deck-blocks' }` (missing `product`) surfaced
// "foundation.type must equal 'posts-on-footings'", implying the
// user's `type` value was wrong when it was actually correct. FIX 3
// makes the ranker discriminator-aware:
//
//   - If `foundation.type` is a KNOWN variant, filter Ajv errors to
//     just that branch (report the real missing / extra field).
//   - If `foundation.type` is UNKNOWN, collapse the same-path
//     per-variant `const` errors into ONE enum-style message.

describe('validator — FIX 3 discriminator-aware foundation errors', () => {
  const envBase = {
    schema: 2,
    generator: 'wooddeck',
    generatorVersion: '0.0.0-test',
    createdAt: '2026-07-04T00:00:00.000Z',
  };

  it('missing `product` on a deck-blocks foundation → names the missing field, NOT the wrong-variant const', () => {
    const envelope = {
      ...envBase,
      design: {
        ...GOLDEN_DECK_DESIGN,
        structure: 'floating' as const,
        // deck-blocks branch requires `product`; type is correct.
        foundation: { type: 'deck-blocks' },
      },
    };
    try {
      validateDeckFileV2(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const msg = (err as DeckFileError).message;
      // MUST name the missing 'product' field.
      expect(msg).toMatch(/product/);
      // MUST NOT wrongly claim 'type' should equal 'posts-on-footings'.
      expect(msg).not.toMatch(/posts-on-footings/);
    }
  });

  it('missing `footing` on a posts-on-footings foundation → names the missing field, NOT a deck-blocks/tuffblocks const', () => {
    const envelope = {
      ...envBase,
      design: {
        ...GOLDEN_DECK_DESIGN,
        structure: 'elevated' as const,
        foundation: {
          type: 'posts-on-footings' as const,
          post: { nominal: '6x6' as const, species: 'PT' as const, grade: 'No2' as const },
          // footing intentionally missing
        },
      },
    };
    try {
      validateDeckFileV2(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const msg = (err as DeckFileError).message;
      expect(msg).toMatch(/footing/);
      expect(msg).not.toMatch(/deck-blocks|tuffblocks/);
    }
  });

  it('stray `post` on a deck-blocks foundation → names the additional field, NOT a const error from another variant', () => {
    const envelope = {
      ...envBase,
      design: {
        ...GOLDEN_DECK_DESIGN,
        structure: 'floating' as const,
        foundation: {
          type: 'deck-blocks' as const,
          product: { productId: 'oldcastle-11x11x7' as const },
          // stray field — deck-blocks branch has additionalProperties:false
          post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        },
      },
    };
    try {
      validateDeckFileV2(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const msg = (err as DeckFileError).message;
      // The 'unknown field' additionalProperties message names 'post'.
      expect(msg).toMatch(/post/);
      // And does NOT claim 'type' should equal 'posts-on-footings'.
      expect(msg).not.toMatch(/must equal 'posts-on-footings'/);
    }
  });

  it('bad discriminator value → enum-style message listing all valid types', () => {
    const envelope = {
      ...envBase,
      design: {
        ...GOLDEN_DECK_DESIGN,
        structure: 'elevated' as const,
        // 'bouncy' is not one of the three known variants.
        foundation: { type: 'bouncy' },
      },
    };
    try {
      validateDeckFileV2(envelope);
      throw new Error('expected DeckFileError');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const msg = (err as DeckFileError).message;
      // Enum-style: all three variants named in ONE message.
      expect(msg).toMatch(/posts-on-footings/);
      expect(msg).toMatch(/deck-blocks/);
      expect(msg).toMatch(/tuffblocks/);
    }
  });
});
