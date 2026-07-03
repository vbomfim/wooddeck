/**
 * `src/persistence/deck-file/schema-v1.ts` — the `.deck` v1 envelope,
 * `serialize`, and `deserialize` (with schema-version switch).
 *
 * ## Contract (frozen — issue #7 §2, §11)
 *
 * The `.deck` file is JSON with a versioned envelope:
 *
 *     {
 *       "schema":            1,
 *       "generator":         "wooddeck",
 *       "generatorVersion":  "<semver>",
 *       "createdAt":         "<ISO-8601>",
 *       "design":            <DeckDesign>
 *     }
 *
 * `deserialize` performs a `switch (schema)` (even with only case 1)
 * so a rewritten loader tomorrow — v2, v3 — MUST add its own case
 * rather than hot-patch this file. Any unrecognized value throws
 * `DeckFileError code:"unknown-schema"` (issue #7 AC3, Code Review
 * Guardian finding #8).
 *
 * ## Byte-for-byte round-trip (SC-006)
 *
 * `JSON.stringify` emits properties in insertion order. Both the
 * envelope construction below and the `DeckDesign` construction in
 * `src/domain/model.ts` are in CANONICAL order — the round-trip
 * property test (`schema-v1.test.ts` — AC1) is what pins that
 * invariant. If a field is added or reordered, the property test
 * fails immediately.
 *
 * ## Build-time version injection
 *
 * `generatorVersion` is stamped from `package.json.version` via a
 * Vite `define` at build time (`vite.config.ts` → `define`). At test
 * time Vite still applies the define; a `globalThis` fallback covers
 * the (should-be-unreachable) case where the token was not
 * substituted — printing `'0.0.0-unknown'` is safer than crashing.
 *
 * ## Trust boundary
 *
 * `deserialize` is a boundary function — it accepts an untrusted
 * string and returns a typed `DeckDesign`. The load path is:
 *
 *   1. `JSON.parse` (throws SyntaxError on garbage → mapped to
 *      `'invalid-json'`).
 *   2. `validateDeckFile` (Ajv, strict inside `design`, rejects
 *      `__proto__` / `constructor` overrides — issue #7 §6 Security).
 *   3. `switch (schema)` gate — rejects unknown versions.
 *   4. Return `{ design, meta }` — the payload is never merged into
 *      another object, so no prototype-pollution vector propagates.
 */
import type { DeckDesign } from '../../domain/model';

import { DeckFileError } from './errors';
import type { DeckFileMeta, DeckFileV1, SerializeOptions } from './envelope-types';
import { validateDeckFile } from './validator';

// Re-export the envelope types from this module too, so downstream
// code that has always imported them from `schema-v1` continues to
// work. The single source of truth is `envelope-types.ts`.
export type { DeckFile, DeckFileMeta, DeckFileV1, SerializeOptions } from './envelope-types';

// ---------------------------------------------------------------------------
// Build-time constants
// ---------------------------------------------------------------------------

/**
 * Compile-time constant injected by Vite `define` (see
 * `vite.config.ts`). Declared as an ambient global — the actual
 * substitution happens at bundle time; the `globalThis` fallback in
 * `getGeneratorVersion` handles any environment (e.g. bare `node`
 * evaluation) where the token was NOT replaced.
 */
declare const __WOODDECK_VERSION__: string;

/**
 * Read the wooddeck build version stamped into `.deck` files. Uses a
 * globalThis fallback so the function never throws — if the Vite
 * define didn't run for some reason, downstream diagnostic logs will
 * show `'0.0.0-unknown'` rather than a `ReferenceError` stack trace.
 */
function getGeneratorVersion(): string {
  try {
    // typeof-guard against the ReferenceError that would occur if
    // Vite didn't substitute the token AND no globalThis mirror exists.
    if (typeof __WOODDECK_VERSION__ === 'string' && __WOODDECK_VERSION__.length > 0) {
      return __WOODDECK_VERSION__;
    }
  } catch {
    /* fall through to globalThis fallback */
  }
  const fallback = (globalThis as { __WOODDECK_VERSION__?: unknown }).__WOODDECK_VERSION__;
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : '0.0.0-unknown';
}

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------
//
// Envelope TYPES live in `./envelope-types.ts` and are re-exported at the
// top of this file. Only RUNTIME code lives below.

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

/**
 * Wrap a `DeckDesign` in a v1 envelope and return the JSON string.
 *
 * The construction order MUST match `DeckFileV1` field order —
 * `JSON.stringify` preserves insertion order, and the byte-for-byte
 * round-trip test (`schema-v1.test.ts` — AC1) fails immediately if a
 * field is added, removed, or reordered.
 */
export function serialize(design: DeckDesign, opts: SerializeOptions = {}): string {
  const envelope: DeckFileV1 = {
    schema: 1,
    generator: 'wooddeck',
    generatorVersion: opts.generatorVersion ?? getGeneratorVersion(),
    createdAt: opts.createdAt ?? new Date().toISOString(),
    design,
  };
  return JSON.stringify(envelope);
}

// ---------------------------------------------------------------------------
// deserialize
// ---------------------------------------------------------------------------

/**
 * The exhaustive set of `.deck` schema versions this build understands.
 * Grows to `[1, 2]` when v2 lands — the `switch` in `deserialize`
 * needs the matching branch.
 */
const KNOWN_SCHEMA_VERSIONS = new Set<number>([1]);

/**
 * Parse and validate a `.deck` file string. Throws `DeckFileError`
 * on any failure — no `null`s, no coerced defaults.
 *
 * @throws DeckFileError code=`'invalid-json'` when `JSON.parse` fails.
 * @throws DeckFileError code=`'unknown-schema'` when the envelope
 *         declares a `schema` value this build does not understand.
 *         Prechecked BEFORE Ajv validation so a v2 file loaded by a
 *         v1 build reports the correct actionable error ("upgrade
 *         wooddeck") rather than a generic "corrupted file" message.
 * @throws DeckFileError code=`'schema-validation-failed'` when the
 *         parsed payload does not match `docs/deck-file-schema-v1.json`
 *         (missing / mistyped fields, unknown keys in `design`, etc.).
 */
export function deserialize(json: string): { design: DeckDesign; meta: DeckFileMeta } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new DeckFileError('invalid-json', 'failed to parse .deck file as JSON', cause);
  }

  // -- Schema-version precheck -------------------------------------------
  //
  // We inspect the envelope's `schema` field BEFORE running Ajv so a
  // future-version file (schema=2) loaded by this v1 build produces
  // `unknown-schema` — an actionable "upgrade wooddeck" signal — rather
  // than the generic `schema-validation-failed` Ajv would emit (the
  // JSON Schema pins `schema` to `const: 1`, so Ajv would otherwise
  // classify a v2 envelope as "malformed").
  //
  // We ONLY act on the precheck when `schema` is present AND numeric
  // AND not in the known set. Missing / non-numeric `schema` falls
  // through to Ajv, which reports the specific structural failure.
  if (parsed !== null && typeof parsed === 'object' && 'schema' in parsed) {
    const receivedSchema = parsed.schema;
    if (typeof receivedSchema === 'number' && !KNOWN_SCHEMA_VERSIONS.has(receivedSchema)) {
      throw new DeckFileError(
        'unknown-schema',
        `unsupported .deck schema version: ${String(receivedSchema)} — this build only understands schema 1`,
      );
    }
  }

  // `validateDeckFile` throws `DeckFileError('schema-validation-failed', ...)`
  // for any structural violation. It also rejects unknown keys inside
  // `design` (prototype-pollution defence — ticket §6 Security)
  // BEFORE the switch below runs.
  const envelope = validateDeckFile(parsed);

  // Version switch — even with only case 1, this shape is required by
  // the ticket (Code Review Guardian finding #8) so future v2 support
  // is a matter of adding a case, not re-architecting.
  //
  // The precheck above already caught any envelope with a numeric
  // schema outside the known set, but the switch stays here (a) as a
  // second gate for internal safety, and (b) so a v2 case is a
  // one-line addition when it lands.
  switch (envelope.schema) {
    case 1: {
      const meta: DeckFileMeta = {
        schema: envelope.schema,
        generator: envelope.generator,
        generatorVersion: envelope.generatorVersion,
        createdAt: envelope.createdAt,
      };
      // The design is returned by reference — NEVER spread / merged
      // into another object here (prototype-pollution defence).
      return { design: envelope.design, meta };
    }
    default: {
      // Should be unreachable — Ajv's `const: 1` on `schema` PLUS
      // the numeric precheck above cover every path. Left explicit
      // so a rewrite that drops one gate is caught by the other.
      const received = (envelope as { schema: number }).schema;
      throw new DeckFileError(
        'unknown-schema',
        `unsupported .deck schema version: ${String(received)} — this build only understands schema 1`,
      );
    }
  }
}
