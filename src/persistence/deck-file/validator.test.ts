/**
 * Unit tests for `src/persistence/deck-file/validator.ts` — the Ajv
 * Draft-2020-12 validator loaded from the checked-in JSON Schema at
 * `docs/deck-file-schema-v1.json`.
 *
 * ## Coverage map (issue #7 acceptance criteria)
 *
 *   - AC4 (schema-validation failure surfaces the offending field).
 *   - AC5 (`docs/deck-file-schema-v1.json` is a valid Draft-2020-12
 *     document AND the validator is instantiated from that file, not
 *     from a hand-coded TS mirror).
 *   - Envelope strictness policy: LENIENT at the root (additive future
 *     metadata OK), STRICT inside `design` (unknown fields rejected).
 *   - `useDefaults: false` — the validator MUST NOT mutate the payload
 *     by injecting schema defaults (a subtle vector for prototype
 *     pollution when the schema references literal objects).
 */
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { validateDeckFile } from './validator';
import { DeckFileError } from './errors';
import { GOLDEN_DECK_DESIGN } from './__fixtures__/deck-designs';

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
      design: GOLDEN_DECK_DESIGN,
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
      design: GOLDEN_DECK_DESIGN,
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
    const badDesign = { ...GOLDEN_DECK_DESIGN } as Record<string, unknown>;
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
        ...GOLDEN_DECK_DESIGN,
        decking: { ...GOLDEN_DECK_DESIGN.decking, orientation: 'diagonal-45' },
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
      design: { ...GOLDEN_DECK_DESIGN, id: 'not-a-uuid' },
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
      design: { ...GOLDEN_DECK_DESIGN, rogueField: 42 },
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
        ...GOLDEN_DECK_DESIGN,
        joist: {
          ...GOLDEN_DECK_DESIGN.joist,
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
      design: GOLDEN_DECK_DESIGN,
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
      design: GOLDEN_DECK_DESIGN,
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
      design: GOLDEN_DECK_DESIGN,
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
      design: GOLDEN_DECK_DESIGN,
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
      design: GOLDEN_DECK_DESIGN,
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
      design: GOLDEN_DECK_DESIGN,
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
      design: GOLDEN_DECK_DESIGN,
    };
    expect(() => validateDeckFile(envelope)).not.toThrow();
  });
});
