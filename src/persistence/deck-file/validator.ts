/**
 * `src/persistence/deck-file/validator.ts` — Ajv (Draft 2020-12)
 * validator loaded from the checked-in JSON Schema at
 * `docs/deck-file-schema-v1.json`.
 *
 * ## Contract
 *
 *   - `validateDeckFile(payload: unknown): DeckFileV1`
 *     Validates the payload against the schema. On success, returns
 *     the payload NARROWED (via a type assertion — Ajv's validation
 *     is the runtime evidence) to `DeckFileV1`. On failure throws
 *     `DeckFileError('schema-validation-failed', <field-identifying msg>)`.
 *
 * ## Why load the schema at import time (module-scope compile)
 *
 * Ajv `compile()` is expensive (~5–10 ms per schema). Persistence is
 * called on every save-debounce interval; compiling per call would
 * bury the profiler in Ajv time. The compiled validator is stateless
 * (Ajv 8+ instance holds no per-call mutable state as long as
 * `useDefaults: false` and `removeAdditional: false`) so caching at
 * module scope is safe.
 *
 * ## Security posture (issue #7 §6)
 *
 *   - `useDefaults: false` — Ajv MUST NOT inject default values.
 *     Defaults would mutate the input and could re-introduce keys the
 *     caller thought were absent.
 *   - `strict: true` — the schema itself is validated: unknown Ajv
 *     keywords blow up at compile time, so a typo like `additionalProps`
 *     would fail the build instead of silently permitting anything.
 *   - `allErrors: true` — collect every error in one pass so the
 *     thrown message can name the FIRST offending field for the user.
 *   - `additionalProperties: false` inside `design` (declared in the
 *     schema, not enforced by Ajv option) — rejects `__proto__` /
 *     `constructor` overrides because they are not in the allowlist.
 *     This is our primary prototype-pollution defence (belt); the
 *     "we never merge the parsed payload into another object"
 *     discipline in `schema-v1.ts` is the suspenders.
 *
 * ## Loading the schema
 *
 * Vite / vitest support `import ... from '*.json' with { type: 'json' }`.
 * The relative path resolves to the checked-in file — same file the
 * `AC5 checked-in schema` test asserts on, so a rename or move
 * surfaces immediately as a test failure.
 */
import { Ajv2020, type ValidateFunction, type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { DeckFileError } from './errors';
import type { DeckFileV1 } from './envelope-types';

import deckFileSchema from '../../../docs/deck-file-schema-v1.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Ajv instance — module-scope, single validator
// ---------------------------------------------------------------------------

/**
 * Build the singleton Ajv instance. Kept as a function so the tests
 * can prove the same construction works when instantiated separately
 * (see `validator.test.ts` — AC5 rebuild).
 */
function buildValidator(): ValidateFunction {
  const ajv = new Ajv2020({
    strict: true, // fail-compile on unknown/typo keywords
    allErrors: true, // collect every failure, not just the first
    useDefaults: false, // never mutate the input (security)
    coerceTypes: false, // never widen "1" to 1 or vice versa
    removeAdditional: false, // never delete unknown keys (would hide bugs)
  });
  addFormats(ajv);
  // Ajv typing wants `object`, and TypeScript picks up the imported
  // JSON as a wide unknown-shape record. Ajv validates the schema at
  // compile time so a shape mismatch throws here, not later.
  return ajv.compile(deckFileSchema as object);
}

const validate: ValidateFunction = buildValidator();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a payload against the `.deck` v1 JSON Schema.
 *
 * Success returns the input NARROWED to `DeckFileV1` (the schema is
 * the runtime evidence for the type). Failure throws a
 * `DeckFileError` whose message names the FIRST offending field so
 * a human reader can locate the problem.
 *
 * @throws DeckFileError code=`'schema-validation-failed'` on any
 *         structural violation.
 */
export function validateDeckFile(payload: unknown): DeckFileV1 {
  if (validate(payload)) {
    // Ajv has proven the shape at runtime; the cast reflects that.
    return payload as DeckFileV1;
  }
  const errors = validate.errors ?? [];
  throw new DeckFileError('schema-validation-failed', formatValidationError(errors));
}

// ---------------------------------------------------------------------------
// Error formatting — reader-facing messages
// ---------------------------------------------------------------------------

/**
 * Reduce Ajv's verbose error array to a single actionable message.
 * We pick the FIRST error deterministically so the message is
 * reproducible under test; the rest are still in `validate.errors`
 * if a caller needs to inspect them via `.cause` (future work).
 *
 * Ajv error path shape: `"/design/footprint"` — we transform to
 * dot-notation (`"design.footprint"`) for readability.
 */
function formatValidationError(errors: readonly ErrorObject[]): string {
  if (errors.length === 0) {
    // Should be unreachable — `validate` returned false, so Ajv set
    // `.errors`. Guard anyway so we NEVER throw a bare "undefined"
    // message.
    return '.deck file failed schema validation (no details available)';
  }
  const first = errors[0]!;
  const pathDots = first.instancePath.replace(/^\//, '').replace(/\//g, '.');
  const location = pathDots.length > 0 ? pathDots : '(root)';
  // Ajv's `params` payload varies by keyword. For `required` it
  // carries `missingProperty`; for `additionalProperties` it carries
  // `additionalProperty`; for `enum` it carries `allowedValues`. We
  // surface the missing/extra property name explicitly so the message
  // is specific.
  const params = first.params as {
    missingProperty?: string;
    additionalProperty?: string;
    allowedValues?: readonly unknown[];
  };
  if (params.missingProperty !== undefined) {
    const missingPath = location === '(root)' ? params.missingProperty : `${location}.${params.missingProperty}`;
    return `.deck file failed schema validation: missing required field '${missingPath}'`;
  }
  if (params.additionalProperty !== undefined) {
    const extraPath = location === '(root)' ? params.additionalProperty : `${location}.${params.additionalProperty}`;
    return `.deck file failed schema validation: unknown field '${extraPath}' — v1 rejects unknown fields inside 'design'`;
  }
  return `.deck file failed schema validation at '${location}': ${first.message ?? first.keyword}`;
}
