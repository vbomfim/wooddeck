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
import type { DeckFileV1, DeckFileV2 } from './envelope-types';

import deckFileSchemaV1 from '../../../docs/deck-file-schema-v1.json' with { type: 'json' };
import deckFileSchemaV2 from '../../../docs/deck-file-schema-v2.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Ajv instances — module-scope, one validator per schema version
// ---------------------------------------------------------------------------

/**
 * Build a singleton Ajv validator for a given schema. Kept as a
 * function so the tests can prove the same construction works when
 * instantiated separately (see `validator.test.ts` — AC5 rebuild).
 *
 * ## Why a fresh Ajv per validator (not a shared instance)
 *
 * Ajv 8+ instances are stateless once compiled, but `strict: true`
 * validates every schema at COMPILE time — a `.compile()` failure
 * on v2 would then break v1's cached validator too. Two separate
 * instances isolate the failure surface and keep each schema's
 * error semantics pristine.
 */
function buildValidator(schema: object): ValidateFunction {
  const ajv = new Ajv2020({
    strict: true, // fail-compile on unknown/typo keywords
    allErrors: true, // collect every failure, not just the first
    useDefaults: false, // never mutate the input (security)
    coerceTypes: false, // never widen "1" to 1 or vice versa
    removeAdditional: false, // never delete unknown keys (would hide bugs)
  });
  addFormats(ajv);
  return ajv.compile(schema);
}

const validateV1: ValidateFunction = buildValidator(deckFileSchemaV1);
const validateV2: ValidateFunction = buildValidator(deckFileSchemaV2);

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
  if (validateV1(payload)) {
    return payload as DeckFileV1;
  }
  const errors = validateV1.errors ?? [];
  throw new DeckFileError(
    'schema-validation-failed',
    formatValidationError(errors, 'v1', payload),
  );
}

/**
 * Validate a payload against the `.deck` v2 JSON Schema (S18).
 *
 * Success returns the input NARROWED to `DeckFileV2`. Failure throws
 * a `DeckFileError` with a v2-specific hint in the message so users
 * loading a malformed v2 file see "v2 rejects unknown fields" rather
 * than the v1 message.
 */
export function validateDeckFileV2(payload: unknown): DeckFileV2 {
  if (validateV2(payload)) {
    return payload as DeckFileV2;
  }
  const errors = validateV2.errors ?? [];
  throw new DeckFileError(
    'schema-validation-failed',
    formatValidationError(errors, 'v2', payload),
  );
}

// ---------------------------------------------------------------------------
// Error formatting — reader-facing messages
// ---------------------------------------------------------------------------

/**
 * FR-026 foundation variants — same triple as `FOUNDATION_TYPES` in
 * `schema-constants.ts` but duplicated here to keep validator.ts
 * import-free of other persistence modules (avoids a circular seam
 * during schema build). If the schema variants grow, add here too.
 */
const FOUNDATION_TYPE_VARIANTS = [
  'posts-on-footings',
  'deck-blocks',
  'tuffblocks',
] as const;
type FoundationTypeVariant = (typeof FOUNDATION_TYPE_VARIANTS)[number];

/**
 * Per-variant field sets — MUST stay in sync with the branches under
 * `#/$defs/FoundationSpec*` in `docs/deck-file-schema-v2.json`. The
 * discriminator-aware error formatter uses these to filter Ajv errors
 * to the branch the user's `type` actually matches.
 */
const FOUNDATION_VARIANT_FIELDS: Readonly<
  Record<FoundationTypeVariant, { required: readonly string[]; allowed: readonly string[] }>
> = {
  'posts-on-footings': {
    required: ['type', 'post', 'footing'],
    allowed: ['type', 'post', 'footing'],
  },
  'deck-blocks': {
    required: ['type', 'product'],
    // S25 pair-fix (Security#2 / GPT MED#3): include the optional
    // `blockRowsHint` / `blockColsHint` fields so a malformed hint
    // is reported as its actual schema violation (e.g. "must be
    // integer >= 2") rather than the noisier "unknown field" from
    // an incomplete allowlist. The fields are OPTIONAL — omitted
    // from `required` — but MUST appear in `allowed` for the
    // error-filter to recognize a legitimate presence.
    //
    // feat/block-spacing: `blockSpacingMm` follows the same pattern
    // — OPTIONAL user-controlled grid pitch for Method B, must be
    // in `allowed` so a malformed value (e.g. below the schema
    // minimum) is reported with its schema violation, not
    // "unknown field".
    allowed: ['type', 'product', 'blockRowsHint', 'blockColsHint', 'blockSpacingMm'],
  },
  tuffblocks: {
    required: ['type', 'product'],
    // S25 pair-fix — see `deck-blocks` above.
    // feat/block-spacing — see `deck-blocks` above.
    allowed: ['type', 'product', 'blockRowsHint', 'blockColsHint', 'blockSpacingMm'],
  },
};

function isKnownFoundationVariant(value: unknown): value is FoundationTypeVariant {
  return (
    typeof value === 'string' &&
    (FOUNDATION_TYPE_VARIANTS as readonly string[]).includes(value)
  );
}

/**
 * Read `payload.design.foundation.type` defensively — the payload is
 * `unknown` at this point and any of the branches may be missing.
 * Returns the discriminator value or `undefined` if the path doesn't
 * resolve. Never throws (used only to steer error formatting).
 */
function readFoundationDiscriminator(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const design = (payload as { design?: unknown }).design;
  if (typeof design !== 'object' || design === null) return undefined;
  const foundation = (design as { foundation?: unknown }).foundation;
  if (typeof foundation !== 'object' || foundation === null) return undefined;
  return (foundation as { type?: unknown }).type;
}

/**
 * Reduce Ajv's verbose error array to a single actionable message.
 *
 * When the schema uses `oneOf` (e.g. `foundation` is a discriminated
 * union in v2), Ajv walks EVERY branch and reports errors from each
 * — the raw `errors[0]` is therefore often a misleading "missing
 * required field from a branch you weren't matching". We pick the
 * DEEPEST-path non-`oneOf` error instead: the deeper the instancePath,
 * the more specific the offense is to the user's actual data.
 *
 * FIX 3 (review gate) — discriminator-aware `foundation` errors:
 *   - If `payload.design.foundation.type` is a KNOWN variant, filter
 *     out the OTHER variants' `const`/`required`/`additionalProperties`
 *     errors so the reported message describes the user's actual
 *     variant only (missing / extra field on THAT branch).
 *   - If the discriminator is UNKNOWN, collapse the per-variant `const`
 *     errors into ONE enum-style message ("must be one of ...") so
 *     the user sees ALL valid types at once rather than "must equal
 *     'posts-on-footings'" implying only one is valid.
 *
 * Ajv error path shape: `"/design/footprint"` — we transform to
 * dot-notation (`"design.footprint"`) for readability.
 */
function formatValidationError(
  errors: readonly ErrorObject[],
  schemaVersion: 'v1' | 'v2',
  payload?: unknown,
): string {
  if (errors.length === 0) {
    return '.deck file failed schema validation (no details available)';
  }

  // FIX 3 — discriminator-aware branch selection for foundation.
  // Only applies to v2 (v1 has no foundation).
  if (schemaVersion === 'v2') {
    const discriminator = readFoundationDiscriminator(payload);
    if (discriminator !== undefined) {
      // Detect whether the collected errors include any foundation.type
      // `const` errors (Ajv reports one per oneOf branch when the
      // whole oneOf fails).
      const foundationTypeConstErrors = errors.filter(
        (e) =>
          e.keyword === 'const' &&
          e.instancePath === '/design/foundation/type',
      );

      if (foundationTypeConstErrors.length > 0 && !isKnownFoundationVariant(discriminator)) {
        // Discriminator is an unknown string — collapse into a single
        // enum-style message listing every valid variant.
        const quoted = FOUNDATION_TYPE_VARIANTS.map((v) => `'${v}'`).join(', ');
        return `.deck file failed schema validation at 'design.foundation.type': must be one of ${quoted}`;
      }

      if (isKnownFoundationVariant(discriminator)) {
        // Known variant — the user's `type` is correct; filter out
        // OTHER variants' branches' errors so only the one true
        // offense on THIS branch is reported. Ajv's schemaPath is
        // relativized against the branch $ref (so branch-index
        // filtering isn't reliable) — instead we filter by the
        // variant's field-set: a missing field the branch doesn't
        // require is noise, and a "stray" field the branch DOES
        // allow is likewise noise.
        const fields = FOUNDATION_VARIANT_FIELDS[discriminator];
        const requiredSet = new Set(fields.required);
        const allowedSet = new Set(fields.allowed);
        const seenAdditional = new Set<string>();
        const filtered = errors.filter((e) => {
          const isFoundationSubtreeError = e.instancePath.startsWith(
            '/design/foundation',
          );
          if (!isFoundationSubtreeError) return true;
          // Drop the outer `oneOf` aggregator (uninformative).
          if (e.keyword === 'oneOf') return false;
          const params = e.params as {
            missingProperty?: string;
            additionalProperty?: string;
          };
          // Drop `const` errors on `/design/foundation/type` — the
          // user's discriminator is correct; only the OTHER variants
          // reject it, which is expected.
          if (
            e.keyword === 'const' &&
            e.instancePath === '/design/foundation/type'
          ) {
            return false;
          }
          // Drop `required` errors for fields the chosen variant
          // does not require (they come from other branches).
          if (
            e.keyword === 'required' &&
            params.missingProperty !== undefined &&
            !requiredSet.has(params.missingProperty)
          ) {
            return false;
          }
          // Drop `additionalProperties` errors for fields the chosen
          // variant DOES allow (they come from other branches).
          if (
            e.keyword === 'additionalProperties' &&
            params.additionalProperty !== undefined
          ) {
            if (allowedSet.has(params.additionalProperty)) return false;
            // Dedupe: Ajv reports one such error per rejecting
            // branch, but the user only sees ONE stray field.
            if (seenAdditional.has(params.additionalProperty)) return false;
            seenAdditional.add(params.additionalProperty);
          }
          return true;
        });
        if (filtered.length > 0) {
          return formatChosen(pickMostSpecificError(filtered), schemaVersion);
        }
      }
    }
  }

  return formatChosen(pickMostSpecificError(errors), schemaVersion);
}

/**
 * Render one Ajv error into the reader-facing message. Extracted so
 * both the plain path and the discriminator-aware path share exactly
 * one rendering rule.
 */
function formatChosen(chosen: ErrorObject, schemaVersion: 'v1' | 'v2'): string {
  const pathDots = chosen.instancePath.replace(/^\//, '').replace(/\//g, '.');
  const location = pathDots.length > 0 ? pathDots : '(root)';
  const params = chosen.params as {
    missingProperty?: string;
    additionalProperty?: string;
    allowedValues?: readonly unknown[];
  };
  if (params.missingProperty !== undefined) {
    const missingPath =
      location === '(root)' ? params.missingProperty : `${location}.${params.missingProperty}`;
    return `.deck file failed schema validation: missing required field '${missingPath}'`;
  }
  if (params.additionalProperty !== undefined) {
    const extraPath =
      location === '(root)' ? params.additionalProperty : `${location}.${params.additionalProperty}`;
    return `.deck file failed schema validation: unknown field '${extraPath}' — ${schemaVersion} rejects unknown fields inside 'design'`;
  }
  return `.deck file failed schema validation at '${location}': ${chosen.message ?? chosen.keyword}`;
}

/**
 * Rank Ajv errors and pick the most user-facing one.
 *
 * Priority order:
 *   1. Enum/pattern/format errors on the DEEPEST path (most specific).
 *   2. `additionalProperties` / `required` errors on the deepest path.
 *   3. Any error, deepest-path first, `oneOf` LAST (it's the least
 *      informative — it just says "matched no branch").
 */
function pickMostSpecificError(errors: readonly ErrorObject[]): ErrorObject {
  const pathDepth = (e: ErrorObject): number =>
    e.instancePath.length === 0 ? 0 : e.instancePath.split('/').length;
  const priority = (e: ErrorObject): number => {
    switch (e.keyword) {
      case 'enum':
      case 'pattern':
      case 'format':
      case 'const':
        return 3;
      case 'additionalProperties':
      case 'required':
        return 2;
      case 'oneOf':
      case 'anyOf':
      case 'allOf':
      case 'not':
        return 0;
      default:
        return 1;
    }
  };
  // Sort descending by (priority, path depth). Stable — first wins ties.
  const ranked = [...errors].sort((a, b) => {
    const dp = priority(b) - priority(a);
    if (dp !== 0) return dp;
    return pathDepth(b) - pathDepth(a);
  });
  return ranked[0]!;
}
