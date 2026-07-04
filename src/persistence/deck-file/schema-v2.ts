/**
 * `src/persistence/deck-file/schema-v2.ts` — the `.deck` v2 envelope
 * serializer + the COMMON `deserialize` that dispatches across every
 * supported schema version (currently 1 and 2).
 *
 * ## Design
 *
 * S18 keeps `schema-v1.ts` around for the v1-specific serializer
 * (`serializeAsV1`, used only by tests that need to synthesize v1
 * corpus envelopes) but moves the LOAD path into this module.
 * There is now ONE `deserialize` that:
 *
 *   1. `JSON.parse` → maps `SyntaxError` to `'invalid-json'`.
 *   2. Precheck: envelope `schema` is a POSITIVE INTEGER not in
 *      `KNOWN_SCHEMA_VERSIONS` → `'unknown-schema'`. Non-integer /
 *      non-numeric schema values fall through to Ajv (which reports
 *      `'schema-validation-failed'`).
 *   3. `switch (envelope.schema)`:
 *        - `1` → `validateDeckFile(...)` → `migrateV1ToV2(...)` →
 *          `validateDeckFileV2(...)` → return `{ design, meta,
 *          migrated: true }`.
 *        - `2` → `validateDeckFileV2(...)` → return `{ design, meta,
 *          migrated: false }`.
 *        - default → `'unknown-schema'` (unreachable — the precheck
 *          plus Ajv const:2 gates cover every path, but the branch
 *          stays explicit so a rewrite that drops one gate is
 *          caught by the other).
 *   4. Migration exceptions (see `migrate-v1-to-v2.ts`) are caught
 *      and wrapped as `'migration-failed'`.
 *
 * ## `serialize` — v2 by default (AC10)
 *
 * The public `serialize(design)` emits v2 envelopes. Callers that
 * need to write a v1 file for corpus purposes must import
 * `serializeAsV1` from `schema-v1.ts` directly — a barrier so a
 * downstream refactor cannot accidentally regress the on-disk
 * default.
 *
 * ## Byte-for-byte round-trip (v2 counterpart to SC-006)
 *
 * Envelope field order below MATCHES `DeckFileV2`. `JSON.stringify`
 * preserves insertion order and the design payload's canonical order
 * is pinned by `model.ts`. The v2 test suite's "byte-for-byte round-
 * trip" test guards against a field re-ordering.
 *
 * ## Trust boundary
 *
 * The `deserialize` load path is a boundary function — it accepts an
 * untrusted string. The security posture is inherited from `schema-
 * v1.ts`:
 *
 *   - The parsed payload is NEVER merged into another object
 *     (prototype-pollution defence).
 *   - `additionalProperties: false` in the schema rejects
 *     `__proto__` / `constructor` overrides inside `design`.
 *   - No user-controlled string is passed to `eval`, `Function`,
 *     `RegExp`, or the DOM.
 */
import type { DeckDesign } from '../../domain/model';

import { DeckFileError } from './errors';
import type {
  DeckFileMeta,
  DeckFileV1,
  DeckFileV2,
  SerializeOptions,
} from './envelope-types';
import { SCHEMA_V2_VERSION } from './envelope-types';
import { migrateV1ToV2 } from './migrate-v1-to-v2';
import { validateDeckFile, validateDeckFileV2 } from './validator';

// ---------------------------------------------------------------------------
// Build-time constants — mirrored from schema-v1.ts
// ---------------------------------------------------------------------------

declare const __WOODDECK_VERSION__: string;

/**
 * Read the wooddeck build version stamped into `.deck` files. Uses a
 * globalThis fallback so the function never throws — if the Vite
 * define didn't run for some reason, downstream diagnostic logs will
 * show `'0.0.0-unknown'` rather than a `ReferenceError` stack trace.
 *
 * Note: `typeof` on an undeclared identifier evaluates to the string
 * `'undefined'` WITHOUT throwing a ReferenceError, so no try/catch is
 * needed around the check.
 */
function getGeneratorVersion(): string {
  if (typeof __WOODDECK_VERSION__ === 'string' && __WOODDECK_VERSION__.length > 0) {
    return __WOODDECK_VERSION__;
  }
  const fallback = (globalThis as { __WOODDECK_VERSION__?: unknown }).__WOODDECK_VERSION__;
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : '0.0.0-unknown';
}

// ---------------------------------------------------------------------------
// Known schema versions
// ---------------------------------------------------------------------------

/**
 * The exhaustive set of `.deck` schema versions this build understands.
 * Extending to `[1, 2, 3, …]` requires adding a matching `case` in
 * `deserialize` — the `default:` branch throws `'unknown-schema'` so
 * a rewrite that adds an entry here but forgets the case gets a
 * runtime error the tests catch.
 */
export const KNOWN_SCHEMA_VERSIONS: ReadonlySet<number> = new Set<number>([1, 2]);

// Re-export the v2 schema version so downstream callers have a
// single symbol for the current on-disk format.
export { SCHEMA_V2_VERSION } from './envelope-types';

// ---------------------------------------------------------------------------
// serialize (v2)
// ---------------------------------------------------------------------------

/**
 * Wrap a post-S17 `DeckDesign` in a v2 envelope and return the JSON
 * string. This is the DEFAULT public serializer — every save path
 * uses it (AC10). If a caller needs a v1 envelope for corpus
 * purposes, they must import `serializeAsV1` from `schema-v1.ts`
 * directly.
 *
 * ## Envelope `createdAt` is FILE-GENERATION metadata, not identity
 *
 * `createdAt` is stamped from the current wall clock on every call.
 * Two `serialize(D)` invocations on the same design intentionally
 * produce DIFFERENT strings (their `createdAt` values differ). The
 * AC1-honest round-trip is stated over the design payload and a
 * metadata-preserving byte-identity where the caller pins
 * `createdAt` / `generatorVersion` on the second call.
 *
 * ## Field-order canonicality
 *
 * The construction order MUST match `DeckFileV2` field order —
 * `JSON.stringify` preserves insertion order, and the metadata-
 * preserving byte-identity test fails immediately if a field is
 * added, removed, or reordered.
 */
export function serialize(design: DeckDesign, opts: SerializeOptions = {}): string {
  const envelope: DeckFileV2 = {
    schema: SCHEMA_V2_VERSION,
    generator: 'wooddeck',
    generatorVersion: opts.generatorVersion ?? getGeneratorVersion(),
    createdAt: opts.createdAt ?? new Date().toISOString(),
    design,
  };
  return JSON.stringify(envelope);
}

// ---------------------------------------------------------------------------
// deserialize — common loader
// ---------------------------------------------------------------------------

/**
 * The result of `deserialize`: the design payload, the envelope
 * metadata (recording where the file came from), and a `migrated`
 * boolean discriminator that consumers can read to surface a
 * "migrated from v1" toast (S23 will wire the UI).
 */
export interface DeserializeResult {
  readonly design: DeckDesign;
  readonly meta: DeckFileMeta;
  /**
   * `true` iff the parsed envelope had `schema: 1` and was upgraded
   * to v2 via `migrateV1ToV2`. `false` for a native v2 file. S23's
   * migration-toast UI reads this seam.
   */
  readonly migrated: boolean;
}

/**
 * Parse and validate a `.deck` file string. Throws `DeckFileError`
 * on any failure — no `null`s, no coerced defaults.
 *
 * @throws DeckFileError code=`'invalid-json'` when `JSON.parse` fails.
 * @throws DeckFileError code=`'unknown-schema'` when the envelope
 *         declares a numeric INTEGER `schema` value this build does
 *         not understand (e.g. schema: 99). Prechecked BEFORE Ajv
 *         validation so a future-version file loaded by an older
 *         build reports the correct actionable error ("upgrade
 *         wooddeck") rather than a generic "corrupted file" message.
 *         Non-integer / non-numeric `schema` values (e.g. 1.5, "1",
 *         true) are NOT considered "unknown schema versions" — they
 *         are structural failures and fall through to Ajv, which
 *         reports `'schema-validation-failed'`.
 * @throws DeckFileError code=`'schema-validation-failed'` when the
 *         parsed payload does not match its schema (missing / mistyped
 *         fields, unknown keys in `design`, etc.).
 * @throws DeckFileError code=`'migration-failed'` when the v1→v2
 *         migration threw an internal exception (see
 *         `migrate-v1-to-v2.ts` — currently reserved for future
 *         SKU-resolution failures).
 */
export function deserialize(json: string): DeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new DeckFileError('invalid-json', 'failed to parse .deck file as JSON', cause);
  }

  // -- Schema-version precheck -------------------------------------------
  //
  // Inspect the envelope's `schema` field BEFORE Ajv so a future-
  // version file (schema=99) loaded by this build produces
  // `'unknown-schema'` — an actionable "upgrade wooddeck" signal —
  // rather than the generic `'schema-validation-failed'` Ajv would
  // emit (v2's schema pins `schema` to `const: 2`).
  //
  // Only act on the precheck when `schema` is present AND a positive
  // INTEGER AND not in the known set. Non-integer numbers (e.g. 1.5),
  // strings, booleans, null, or missing values fall through to Ajv.
  if (parsed !== null && typeof parsed === 'object' && 'schema' in parsed) {
    const receivedSchema = parsed.schema;
    if (
      typeof receivedSchema === 'number' &&
      Number.isInteger(receivedSchema) &&
      !KNOWN_SCHEMA_VERSIONS.has(receivedSchema)
    ) {
      throw new DeckFileError(
        'unknown-schema',
        `unsupported .deck schema version: ${String(receivedSchema)} — this build understands schemas ${knownSchemasList()}`,
      );
    }
  }

  // Route on the (as-yet-unvalidated) schema value. We know from the
  // precheck above that if `parsed.schema` is a known integer it's
  // one of `KNOWN_SCHEMA_VERSIONS`; otherwise it may be structurally
  // malformed and Ajv will report accordingly.
  const rawSchema =
    parsed !== null && typeof parsed === 'object' && 'schema' in parsed
      ? parsed.schema
      : undefined;

  switch (rawSchema) {
    case 1: {
      // v1 envelope: validate → migrate → validate v2 → return.
      const v1Envelope = validateDeckFile(parsed);
      const v2Envelope = wrapMigration(v1Envelope);
      // Re-validate the migrated envelope against v2 schema — belt-
      // and-suspenders. `migrateV1ToV2` produces a well-typed
      // envelope by construction, but this pass catches any drift
      // between the migration function and the schema (e.g. someone
      // adds a required field to v2 but forgets the migration).
      const validated = validateDeckFileV2(v2Envelope);
      const meta: DeckFileMeta = {
        schema: v1Envelope.schema, // Preserve original — meta.schema === 1 means "migrated from v1"
        generator: v1Envelope.generator,
        generatorVersion: v1Envelope.generatorVersion,
        createdAt: v1Envelope.createdAt,
      };
      return { design: validated.design, meta, migrated: true };
    }
    case 2: {
      // Native v2 envelope: validate → return.
      const envelope = validateDeckFileV2(parsed);
      const meta: DeckFileMeta = {
        schema: envelope.schema,
        generator: envelope.generator,
        generatorVersion: envelope.generatorVersion,
        createdAt: envelope.createdAt,
      };
      return { design: envelope.design, meta, migrated: false };
    }
    default: {
      // Fall through to Ajv v2 validation — its `const: 2` will
      // report a specific error (e.g. `schema: 1.5` → "must be equal
      // to constant 2" → `'schema-validation-failed'`). This branch
      // preserves the pre-S18 semantics for non-integer schemas.
      validateDeckFileV2(parsed);
      // Unreachable — Ajv would have thrown above. Explicit for
      // safety.
      throw new DeckFileError(
        'unknown-schema',
        `unsupported .deck schema version: ${String(rawSchema)} — this build understands schemas ${knownSchemasList()}`,
      );
    }
  }
}

/**
 * Wrap `migrateV1ToV2` so any uncaught exception surfaces as
 * `'migration-failed'` (AC6). Today the migration is total — this
 * try/catch is defensive against future normalization steps (e.g.
 * SKU-resolution) that could throw.
 */
function wrapMigration(v1: DeckFileV1): DeckFileV2 {
  try {
    return migrateV1ToV2(v1);
  } catch (cause) {
    if (cause instanceof DeckFileError) {
      // Already typed — preserve the code so the caller can distinguish
      // a migration-emitted `'migration-failed'` from an incidental
      // `'schema-validation-failed'` bubbling up.
      throw cause;
    }
    throw new DeckFileError(
      'migration-failed',
      `failed to migrate .deck v1 → v2: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }
}

/**
 * Format the known-schemas set as a human-readable list for error
 * messages (e.g. `"1, 2"`). Sorted ascending so the message is
 * deterministic regardless of insertion order.
 */
function knownSchemasList(): string {
  return Array.from(KNOWN_SCHEMA_VERSIONS)
    .sort((a, b) => a - b)
    .join(', ');
}
