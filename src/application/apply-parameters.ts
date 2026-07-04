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
 * vector). This module defends via TWO real strategies (each with
 * a helper property):
 *
 *   1. **Explicit key-level rejection** (`FORBIDDEN_KEYS`) — every
 *      merge step checks whether `key` is in the FORBIDDEN_KEYS set
 *      BEFORE inspecting the patch value. A hit throws
 *      `ApplyParametersError`; the merge is aborted. This catches
 *      the JSON.parse-preserved `__proto__` own-property form and
 *      the `constructor` / `prototype` variants.
 *   2. **Plain-object-required semantics** — every patch object
 *      (root and nested) MUST be a "plain object" (prototype ===
 *      `Object.prototype` or `null` — see `isPlainObject`). This
 *      closes a subtler attack surface: the JS-literal form
 *      `{ __proto__: { widthMm, lengthMm, heightMm } }` sets the
 *      new object's PROTOTYPE (zero own keys), so `Object.keys`
 *      alone would treat it as an empty patch. Without the
 *      plain-object requirement a naive `else`-branch REPLACE
 *      would swap `current.footprint` for a prototype-backed
 *      object with no own JSON fields — reads work at runtime but
 *      `JSON.stringify` drops the data, silent-corrupting the
 *      autosave slot. Additionally: when `current[key]` is a plain
 *      object, `patch[key]` MUST also be a plain object (not null,
 *      array, Date, class instance, prototype-backed object) — a
 *      mismatch throws `ApplyParametersError`, never silently
 *      REPLACES a domain subtree with a non-plain value.
 *
 * Helpers (not standalone defences):
 *
 *   - **Own-enumerable-only iteration** — `Object.keys(patch)` skips
 *     inherited methods (`toString`, `hasOwnProperty`, etc). Alone
 *     this does NOT stop `__proto__` — a JSON.parse-derived `__proto__`
 *     IS an own key. Strategy #1 handles that; iteration just avoids
 *     spurious "unknown key" errors on inherited names.
 *   - **`Object.hasOwn(current, key)`** — the "unknown key" check
 *     does NOT walk the prototype chain, so a rogue key
 *     masquerading as an `Object.prototype` method (e.g. `toString`)
 *     is rejected as "unknown key" rather than falsely accepted.
 *
 * ## Editable-surface restriction (issue #8 §4)
 *
 * `id` and `createdAt` are OWN keys of `DeckDesign` — so the
 * unknown-key check alone would ACCEPT a `{ id: '...' }` patch.
 * That's semantically wrong: `applyParameters` is "edit design
 * PARAMETERS", not "rewrite identity". A patched `id` would
 * desynchronize `layout.designId` (which is copied from
 * `design.id` at the next `computeLayout`), silently break
 * undo/redo replay identity, and break the correlation the S13
 * warnings panel relies on. `NON_EDITABLE_TOP_KEYS` explicitly
 * rejects them with an `ApplyParametersError` naming the field.
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
 * Top-level `DeckDesign` keys that are OWN keys but NOT semantically
 * editable via `applyParameters`. Patching them would either desync
 * `layout.designId` (which is copied from `design.id` at layout
 * time) or rewrite audit metadata (`createdAt`). These are rejected
 * at the top-level of the patch with an `ApplyParametersError` so
 * the S8 store surfaces a loud error rather than silently accepting
 * an identity change.
 *
 * The alternative — an `EDITABLE_TOP_KEYS` allowlist — would need
 * a manual update every time `DeckDesign` grew a new editable
 * subtree (adds friction against the shape). A denylist protects
 * the two known-non-editable fields with no other maintenance cost.
 */
const NON_EDITABLE_TOP_KEYS: ReadonlySet<string> = new Set(['id', 'createdAt']);

/**
 * OPTIONAL DOMAIN FIELDS that a patch MAY introduce even when the
 * current subtree does not yet have them as own properties.
 *
 * ## Why the whitelist exists
 *
 * The general `Object.hasOwn(current, key)` "unknown-key" check
 * enforces two invariants: (a) prototype-pollution defence (a
 * `__proto__`-derived rogue key is not a hit); and (b) typo
 * defence — a patch key like `spacingMM` (wrong case) is rejected
 * instead of silently adding an orphan field. Both are load-
 * bearing.
 *
 * BUT: some `DeckDesign` fields are legitimately OPTIONAL and
 * appear on the current design only WHEN they carry a non-default
 * value. `foundation.blockRowsHint` (S25 / ticket #47) is the
 * canonical example: it is `readonly blockRowsHint?: number` on
 * the `deck-blocks` / `tuffblocks` variants; an initial design
 * omits the property, and the S25 `add-support-row` remediation
 * patches it in. Without the whitelist, that legitimate patch
 * would trip the unknown-key check and fail with
 * "Unknown key 'foundation.blockRowsHint'".
 *
 * ## Why a whitelist (and not just remove the check)
 *
 * The whitelist keeps the typo-defence for the 99% common path
 * (`{ joist: { spacingMm: 305 } }` — every key is a known member
 * of the current subtree). Only genuinely-optional additive fields
 * declared in `model.ts` FoundationSpec (or a future extension)
 * are exempted, and each one is documented here with a citation
 * to the ticket that introduced it. A future field is added by
 * appending one entry — a rewrite that adds a new optional field
 * without touching this set produces a runtime failure, which is
 * caught by the test suite, not silent corruption.
 *
 * ## Security invariant
 *
 * Every key in this set is a LITERAL alphanumeric identifier
 * declared in `src/domain/model.ts` — none of them collide with
 * prototype-pollution vectors (`__proto__`, `constructor`,
 * `prototype`) which remain rejected by `FORBIDDEN_KEYS` earlier
 * in the same loop. Adding a key to this set does NOT weaken
 * the prototype-pollution defence.
 */
const KNOWN_OPTIONAL_LEAF_KEYS: ReadonlySet<string> = new Set([
  // S25 / ticket #47 — FoundationSpec deck-blocks/tuffblocks
  // additive-optional block-grid overrides. See `FoundationSpec`
  // doc-block in `src/domain/model.ts`.
  'blockRowsHint',
  'blockColsHint',
]);

/**
 * Runtime type guard: is `value` a merge-eligible plain object?
 *
 * "Plain object" here means: an object whose prototype is either
 * `Object.prototype` (the everyday `{...}` literal or `JSON.parse`
 * output) OR `null` (an `Object.create(null)` bag). Anything else
 * — `null`, arrays, class instances (Date, Map, custom classes),
 * or objects with a non-Object.prototype prototype — is rejected.
 *
 * This is the load-bearing check for the plain-object-required
 * strategy in the module docstring's prototype-pollution defence
 * section: a JS-literal `{ __proto__: {...} }` produces a
 * prototype-backed object with zero own keys, and `isPlainObject`
 * returns `false` for it.
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
 * top-level object at every level of the patch (immutability
 * guarantee — AC4). Untouched subtrees are structurally SHARED
 * with `current` (reference-equal): this is the standard
 * immutable-update pattern used by Redux/zundo/Immer's `produce`
 * and is safe because every field of `DeckDesign` is declared
 * `readonly` at the type level (a mutation via a shared reference
 * would be a compile error). See `types.ts` `DesignBundle` docs.
 *
 * @throws {ApplyParametersError} on the first forbidden or unknown
 *   key, OR when `patch[key]` is a non-plain-object where
 *   `current[key]` is a plain object (would silently corrupt the
 *   domain subtree). The error's `.path` names the FULL dotted
 *   path from the patch root.
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
    if (!Object.hasOwn(current, key) && !KNOWN_OPTIONAL_LEAF_KEYS.has(key)) {
      throw new ApplyParametersError(
        `${pathPrefix}${key}`,
        `Unknown key '${pathPrefix}${key}' — not a field of DeckDesign at that path (see apply-parameters.ts module docs)`,
      );
    }

    const patchValue = (patch as Record<string, unknown>)[key];
    const currentValue = (current as Record<string, unknown>)[key];

    if (isPlainObject(currentValue)) {
      // The current subtree is a plain object → the patch MUST also
      // be a plain object. A REPLACE with null / array / class
      // instance / prototype-backed object would silently corrupt a
      // domain subtree (nested `__proto__` attack, or accidentally
      // pass an array where an object is required). Fail LOUD.
      if (!isPlainObject(patchValue)) {
        throw new ApplyParametersError(
          `${pathPrefix}${key}`,
          `Expected a plain object at '${pathPrefix}${key}' — refusing to REPLACE a domain subtree with a non-plain value (prototype-pollution defence — see apply-parameters.ts module docs)`,
        );
      }
      // Recurse: extend the path prefix so nested errors report the
      // full dotted path (e.g. `footprint.rogueField`).
      result[key] = deepMerge(
        currentValue,
        patchValue as DeepPartial<typeof currentValue>,
        `${pathPrefix}${key}.`,
      );
    } else {
      // Leaf value in `current` (primitive / array / non-plain
      // object) — REPLACE semantics. Domain leaves are primitives
      // (`Mm` numbers, `Species` strings) so the patch value simply
      // overwrites. If the caller passes a nonsense value (e.g. a
      // string where an `Mm` is expected) the downstream
      // `computeLayout` surfaces it as `LayoutError`.
      result[key] = patchValue;
    }
  }

  return result as T;
}

/**
 * Guard that the root `patch` is a plain object. A non-object patch
 * (`null`, primitive, array, class instance, prototype-backed
 * object) breaks the whole merge contract — `Object.keys(null)`
 * throws a raw `TypeError`, an array patch would silently iterate
 * numeric indices as "keys" of DeckDesign, and a prototype-backed
 * root would be a top-level version of the JS-literal `__proto__`
 * attack. Extracted from `applyParameters` to keep the use-case at
 * ≤ 40 lines per issue #8 §15.
 *
 * @throws {ApplyParametersError} with `path === ''` when the guard
 *   fails. Empty path signals a root-level problem to the S8 UI.
 */
function assertPatchIsPlainObject(patch: unknown): asserts patch is Record<string, unknown> {
  if (!isPlainObject(patch)) {
    throw new ApplyParametersError(
      '',
      'patch must be a plain object (received null, primitive, array, or prototype-backed value — see apply-parameters.ts module docs)',
    );
  }
}

/**
 * Guard that the patch does not touch identity/audit metadata.
 * `id` and `createdAt` are OWN keys of `DeckDesign` — so the
 * unknown-key check alone would accept them. Reject them BEFORE
 * the merge starts. Extracted from `applyParameters` to keep the
 * use-case at ≤ 40 lines per issue #8 §15.
 *
 * @throws {ApplyParametersError} naming the first offending
 *   non-editable top-level key.
 */
function assertPatchTopKeysEditable(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if (NON_EDITABLE_TOP_KEYS.has(key)) {
      throw new ApplyParametersError(
        key,
        `Field '${key}' is not editable via applyParameters — identity/audit metadata is set at design creation only (see apply-parameters.ts module docs)`,
      );
    }
  }
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
 *                `id` and `createdAt` are OWN keys of DeckDesign
 *                but explicitly not editable — patching them throws.
 * @param table   `SpanTable` instance owned by the state store
 *                (issue #8 §17 Open Question — option (b): pass at
 *                every call site rather than a module singleton).
 *
 * @throws {ApplyParametersError} on an unknown, forbidden, or
 *   non-editable-metadata key, on a non-plain-object root patch,
 *   or on a non-plain-object patch where the current subtree is a
 *   plain object.
 * @throws {LayoutError} on a merged design that fails
 *   `computeLayout` (dimensionally invalid or unknown catalog
 *   material — issue #8 §4 Edge cases).
 */
export function applyParameters(
  current: DeckDesign,
  patch: DeepPartial<DeckDesign>,
  table: SpanTable,
): DesignBundle {
  assertPatchIsPlainObject(patch);
  assertPatchTopKeysEditable(patch);
  const merged = deepMerge(current, patch, '');
  const { layout, warnings } = computeLayoutAndCheck(merged, table);
  return { design: merged, layout, warnings };
}
