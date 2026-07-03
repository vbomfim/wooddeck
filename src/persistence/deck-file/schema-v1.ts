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
 *
 * Note: `typeof` on an undeclared identifier evaluates to the string
 * `'undefined'` WITHOUT throwing a ReferenceError, so no try/catch is
 * needed around the check (Opus#4 hygiene: dead try/catch removed).
 */
function getGeneratorVersion(): string {
  if (typeof __WOODDECK_VERSION__ === 'string' && __WOODDECK_VERSION__.length > 0) {
    return __WOODDECK_VERSION__;
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
 * ## Envelope `createdAt` is FILE-GENERATION metadata, not identity
 *
 * `createdAt` is stamped from the current wall clock on every call.
 * Two `serialize(D)` invocations on the same design intentionally
 * produce DIFFERENT strings (their `createdAt` values differ). This
 * is by design — the field records WHEN the file was written, not
 * WHAT was written. The AC1 round-trip identity contract is stated
 * over (a) the DESIGN payload (deep-equal) and (b) a metadata-
 * preserving byte-identity where the caller pins `createdAt` and
 * `generatorVersion` on the second serialize (see
 * `schema-v1.test.ts` — "AC1 honest round-trip contract"). Callers
 * that need byte-identity across two serializations MUST pass
 * `opts.createdAt` / `opts.generatorVersion` explicitly on the
 * second call — the recovered metadata is available via
 * `deserialize(json).meta`.
 *
 * ## Field-order canonicality
 *
 * The construction order MUST match `DeckFileV1` field order —
 * `JSON.stringify` preserves insertion order, and the metadata-
 * preserving byte-identity test fails immediately if a field is
 * added, removed, or reordered.
 *
 * ## Unknown envelope keys (v1 does NOT round-trip them)
 *
 * The JSON Schema is lenient at the envelope root (unknown top-level
 * keys are accepted), but `deserialize` does not surface them and
 * `serialize` does not re-emit them. As a result, `serialize(...)`
 * always outputs the canonical five-field envelope; forward-compat
 * additive metadata added by a v2+ producer is IGNORED on load and
 * LOST on re-save through a v1 build. Round-trip preservation of
 * extra envelope keys is a v2 consideration (see ticket §17). If
 * you need to preserve extras today, save the raw JSON string
 * verbatim — do NOT rely on `deserialize → serialize` to preserve
 * them.
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
 * ## Unknown envelope keys are NOT preserved
 *
 * The JSON Schema is lenient at the envelope root so future producers
 * can append additive metadata (`checksum`, `signature`, etc.) without
 * a breaking schema bump. However, `deserialize` returns only the
 * canonical five-field envelope in `meta` — unknown top-level keys are
 * SILENTLY DROPPED on load, and `serialize` does not re-emit them. If
 * a v1 build loads a v2 file with extras and re-saves, the extras are
 * lost. See ticket §17 (Trade-off Decisions) for the rationale; a
 * v2 loader may build a passthrough if needed.
 *
 * @throws DeckFileError code=`'invalid-json'` when `JSON.parse` fails.
 * @throws DeckFileError code=`'unknown-schema'` when the envelope
 *         declares a numeric INTEGER `schema` value this build does
 *         not understand. Prechecked BEFORE Ajv validation so a v2
 *         file loaded by a v1 build reports the correct actionable
 *         error ("upgrade wooddeck") rather than a generic
 *         "corrupted file" message. Non-integer / non-numeric
 *         `schema` values (e.g. 1.5, "1", true) are NOT considered
 *         "unknown schema versions" — they are structural failures
 *         and fall through to Ajv, which reports
 *         `'schema-validation-failed'`.
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
  // We ONLY act on the precheck when `schema` is present AND a positive
  // INTEGER AND not in the known set. Non-integer numbers (e.g. 1.5),
  // strings (e.g. "1"), booleans, null, or missing values fall through
  // to Ajv, which reports the specific structural failure with the
  // `schema-validation-failed` code (Code Review GPT#4 / QA-G3 —
  // previously a `schema: 1.5` file wrongly reported "upgrade wooddeck").
  if (parsed !== null && typeof parsed === 'object' && 'schema' in parsed) {
    const receivedSchema = parsed.schema;
    if (
      typeof receivedSchema === 'number' &&
      Number.isInteger(receivedSchema) &&
      !KNOWN_SCHEMA_VERSIONS.has(receivedSchema)
    ) {
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
