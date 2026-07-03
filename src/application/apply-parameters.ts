/**
 * `src/application/apply-parameters.ts` — the "edit a design"
 * use-case: deep-merge a partial patch into a current design, then
 * recompute layout + warnings for the merged result.
 *
 * ## Why deep-merge (not shallow, not `Object.assign`)
 *
 * `DeckDesign` is a NESTED structure: `footprint` is an object,
 * `joist` is an object containing a `material` object, etc. A UI
 * event like "the user changed the joist nominal to 2×12" logically
 * produces the patch `{ joist: { material: { nominal: '2x12' } } }`
 * — a THREE-level-deep partial. A shallow `{...current, ...patch}`
 * would REPLACE `current.joist` entirely and lose `spacingMm`. Deep-
 * merge preserves the surrounding tree.
 *
 * The domain type `DeckDesign` contains no arrays, so we intentionally
 * do NOT implement array-merge semantics. If a future domain field
 * introduces an array (e.g. `edits[]`), the merge MUST be REPLACE,
 * not element-by-element merge, so undo/redo snapshots stay
 * consistent — see `types.ts` `DeepPartial` doc.
 *
 * ## Prototype-pollution safety
 *
 * Untrusted patches (from JSON.parse of a .deck file, from a state-
 * store payload synthesized from user input) can carry weaponized
 * keys — `__proto__`, `constructor`, `prototype` — that a naive
 * merge would treat as normal fields and thereby mutate
 * `Object.prototype` (a classic supply-chain / prototype-pollution
 * vector). This module defends via THREE overlapping strategies:
 *
 *   1. **Explicit rejection at the key level** — every merge step
 *      checks whether `key` is in the FORBIDDEN_KEYS set BEFORE
 *      inspecting the patch value. A hit throws
 *      `ApplyParametersError`; the merge is aborted.
 *   2. **Own-enumerable-only iteration** — we walk `Object.keys(patch)`,
 *      which returns only own enumerable string keys. This alone
 *      excludes JS-literal `{__proto__: ...}` (which invokes the
 *      __proto__ setter — no own key is created), and combined with
 *      #1 also excludes JSON.parse-preserved `__proto__` own props.
 *   3. **Own-property guard on validation** — `Object.hasOwn(current,
 *      key)` uses the reliable own-check (does NOT walk the prototype
 *      chain), so a rogue key masquerading as a Object.prototype
 *      method (e.g. `toString`) is rejected as "unknown key" rather
 *      than falsely accepted.
 *
 * ## Runtime unknown-key validation vs TypeScript
 *
 * `DeepPartial<DeckDesign>` gives us COMPILE-TIME safety in
 * hand-written call sites, but three real sources of patches slip
 * past the type system at runtime:
 *
 *   - Values loaded from a `.deck` file (schema-validated at the
 *     envelope, but the JSON Schema is intentionally lenient inside
 *     `design` for forward compatibility — see S6 module docs).
 *   - Values synthesized from URL query params or the S8 store's
 *     replay log.
 *   - Values authored by future story code before its type
 *     definitions catch up.
 *
 * The runtime walk against `current`'s own-key shape is what catches
 * all three. AC5 codifies this — a `{ notARealKey: 42 }` patch is
 * a bug that should be LOUD, not silently accepted-and-ignored.
 *
 * ## Ownership of the shape check
 *
 * We use `current` (the last-known-good design) as the authoritative
 * shape reference — every own key of `current` is a legitimate field
 * of DeckDesign at that path. Alternative approaches considered and
 * rejected:
 *
 *   - **Explicit allowed-keys map** — DRY violation; every domain
 *     schema change would need a manual update here.
 *   - **Reflection via TypeScript** — TS types are compile-time only;
 *     no runtime reflection exists.
 *   - **JSON Schema derivation** — the schema in S6 lives in
 *     `docs/deck-file-schema-v1.json`; parsing it here would put
 *     schema evolution in two places.
 *
 * Using `current` as the reference has ONE limitation: if the domain
 * type ever added an OPTIONAL field, `current` might legitimately
 * omit that field, and a patch that ADDS it would be rejected as
 * "unknown key". Every field of `DeckDesign` is currently REQUIRED
 * (see `src/domain/model.ts`), so this limitation does not bite for
 * MVP. A future optional-field addition would need a companion
 * "allowed additional keys" list argued for on the ticket.
 *
 * ## Line budget
 *
 * `applyParameters` — the ONE exported use-case — is 6 lines. The
 * deep-merge + validation helpers live in this file too but are
 * private; the ticket's "one exported top-level use-case per file"
 * rule is satisfied.
 *
 * ## Error contract
 *
 * `ApplyParametersError` for structural failures (unknown key,
 * forbidden pollution vector). `LayoutError` for domain-level
 * failures produced by `computeLayout` on the merged design (e.g.
 * a merged widthMm below the min-4ft threshold, an unknown catalog
 * triple).
 */

import type { DeckDesign } from '../domain/model';
import type { SpanTable } from '../domain/spans';

import { computeLayoutAndCheck } from './compute-layout';
import type { DeepPartial, DesignBundle } from './types';

/**
 * Typed error thrown by `applyParameters` when a patch has a
 * structural problem the domain layer can't diagnose (unknown key,
 * prototype-pollution vector).
 *
 * `.path` is the DOTTED key path from the patch root to the
 * offending key. A UI can render "The 'X' field is not editable" by
 * splitting on `.` and mapping to a form control.
 *
 * `.name` is set explicitly so dev-tool stack traces attribute the
 * error to `ApplyParametersError`, not the generic `Error` — matches
 * the pattern in `../persistence/deck-file/errors.ts`.
 */
export class ApplyParametersError extends Error {
  /**
   * The dotted path (from the patch root) to the offending key. Never
   * empty; a top-level bad key produces a single-segment path like
   * `"notARealKey"`; a nested bad key like `"footprint.rogueField"`.
   */
  public readonly path: string;

  public constructor(path: string, message: string) {
    super(message);
    this.name = 'ApplyParametersError';
    this.path = path;
  }
}

/**
 * Keys that MUST NOT appear in ANY patch — even at a nested level.
 * Setting any of these via a merge would either mutate
 * `Object.prototype` (a security incident) or corrupt the object's
 * class identity. `constructor` and `prototype` are included as
 * defense-in-depth alongside `__proto__` per common prototype-
 * pollution attack surveys.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Runtime type guard: is `value` a merge-eligible plain object?
 *
 * We only recurse into values that are BOTH object-typed AND descend
 * from `Object.prototype` (or `null`). This excludes:
 *
 *   - `null` (typeof 'object' but not an object we can merge)
 *   - arrays (`isArray`), which would otherwise merge element-by-
 *     element — REPLACE is the correct array semantics.
 *   - class instances (e.g. `new Date()`), whose semantic identity
 *     is destroyed by a spread merge.
 *
 * Any non-plain-object value on either side (patch or current) falls
 * through to REPLACE semantics — the patch value overwrites the
 * current value.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  // `Object.getPrototypeOf` narrows to `unknown` — cast to a loose
  // object type for the identity check. The check itself does not
  // read any property from `value`, so no unsafe access flows.
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursive deep-merge of `patch` into `current`. Produces a NEW
 * object at every level (immutability guarantee — AC4). Throws
 * `ApplyParametersError` on the first forbidden or unknown key,
 * naming the full dotted path.
 *
 * `pathPrefix` accumulates the dotted path so far — an empty string
 * at the root, otherwise ending in `.`. The offending key is
 * appended to this prefix in the error message.
 */
function deepMerge<T extends object>(
  current: T,
  patch: DeepPartial<T>,
  pathPrefix: string,
): T {
  // Start from a shallow copy of `current` — subsequent iterations
  // either recurse (replacing an object slot with its merged version)
  // or assign the patch value directly. `current` itself is never
  // touched — that satisfies the AC4 immutability guarantee.
  const result: Record<string, unknown> = { ...(current as Record<string, unknown>) };

  // `Object.keys` returns own enumerable string keys only. Excludes
  // JS-literal `{__proto__: ...}` (which is a proto-set, not an own
  // key) and every inherited method (`toString`, `hasOwnProperty`,
  // etc). JSON.parse-preserved `__proto__` IS an own key though — the
  // FORBIDDEN_KEYS check below handles it.
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new ApplyParametersError(
        `${pathPrefix}${key}`,
        `Forbidden key '${key}' in patch at path '${pathPrefix}${key}' (prototype-pollution defence — see apply-parameters.ts module docs)`,
      );
    }
    if (!Object.hasOwn(current, key)) {
      throw new ApplyParametersError(
        `${pathPrefix}${key}`,
        `Unknown key '${pathPrefix}${key}' — not a field of DeckDesign at that path (see apply-parameters.ts module docs)`,
      );
    }

    const patchValue = (patch as Record<string, unknown>)[key];
    const currentValue = (current as Record<string, unknown>)[key];

    if (isPlainObject(patchValue) && isPlainObject(currentValue)) {
      // Recurse: extend the path prefix so nested errors report the
      // full dotted path (e.g. `footprint.rogueField`).
      result[key] = deepMerge(
        currentValue,
        patchValue as DeepPartial<typeof currentValue>,
        `${pathPrefix}${key}.`,
      );
    } else {
      // REPLACE semantics for primitives / arrays / class instances
      // — see `isPlainObject` docs.
      result[key] = patchValue;
    }
  }

  return result as T;
}

/**
 * Merge a partial patch into the current design, then recompute
 * layout and warnings for the merged result.
 *
 * @param current The design AS OF the last accepted edit (S8 store
 *                holds this reference). NEVER mutated.
 * @param patch   Path-based partial. Every key must be a legitimate
 *                field of DeckDesign at its nesting depth; unknown
 *                keys throw `ApplyParametersError` naming the path.
 * @param table   `SpanTable` instance owned by the state store
 *                (issue #8 §17 Open Question — option (b): pass at
 *                every call site rather than a module singleton).
 *
 * @throws {ApplyParametersError} on an unknown or forbidden key.
 * @throws {LayoutError} on a merged design that fails
 *   `computeLayout` (dimensionally invalid or unknown catalog
 *   material — issue #8 §4 Edge cases).
 */
export function applyParameters(
  current: DeckDesign,
  patch: DeepPartial<DeckDesign>,
  table: SpanTable,
): DesignBundle {
  const merged = deepMerge(current, patch, '');
  const { layout, warnings } = computeLayoutAndCheck(merged, table);
  return { design: merged, layout, warnings };
}
