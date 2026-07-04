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
 * ## S23 — discriminated-union `type`-tag switch (REPLACE)
 *
 * `DeckDesign.foundation` is a discriminated union tagged on `.type`
 * (see `domain/model.ts` `FoundationSpec`). A caller flipping the
 * discriminator — e.g. `{foundation: {type:'tuffblocks', product:...}}`
 * on top of the current `{type:'posts-on-footings', post:..., footing:...}`
 * — MUST cause the whole subtree to be REPLACED, not deep-merged.
 * A merge would carry the OLD variant's sibling keys (`post`,
 * `footing`) into a hybrid shape that matches NO discriminant of
 * the union, and would then fail the unknown-key check on the NEW
 * variant's fields (`product` isn't a key of `posts-on-footings`).
 * That would break S23's atomic structure↔foundation re-stamp.
 *
 * `deepMerge` detects a discriminator switch via
 * `isDiscriminatorSwitch(currentValue, patchValue)`: both are plain
 * objects, both have an own `type` string, and the two `type`
 * values DIFFER. In that case the OLD subtree is dropped and the
 * new patch value is installed verbatim (as a fresh shallow copy so
 * the caller's patch is untouched).
 *
 * ### REPLACE-path invariants (S23 pair-fix — BLOCKING #1)
 *
 * The replacement subtree is validated by
 * `assertReplacementSubtreeSafe` BEFORE installation:
 *
 *   - **Recursive FORBIDDEN_KEYS walk.** A JSON.parse-preserved
 *     `__proto__` / `constructor` / `prototype` at ANY depth in
 *     the replacement (e.g. `foundation.product.__proto__`) is
 *     rejected with `ApplyParametersError` naming the full
 *     dotted path. The pre-fix version checked only top-level
 *     keys — a nested attack bypassed the whole defense despite
 *     the module docstring promising recursion.
 *   - **Variant-key-aware shape check for `foundation` targets.**
 *     `FoundationSpec` (see `domain/model.ts`) is a discriminated
 *     union tagged on `type`; each variant declares a fixed set
 *     of allowed own keys (FR-026). A REPLACE payload MUST NOT
 *     carry keys outside the target variant's allowed set — a
 *     stale-spread pattern like `{...current.foundation, type:
 *     'tuffblocks', product}` that drags `post`+`footing` from a
 *     former posts-on-footings variant produces a hybrid
 *     runtime object matching NO discriminant, and is rejected
 *     with `ApplyParametersError` naming the offending key +
 *     the target variant. The FR-026-legit optional leaves
 *     (`blockRowsHint` / `blockColsHint` on the block variants —
 *     S25 / ticket #47) ARE in the allow set so REPLACE and the
 *     S25 leaf-allowlist mechanism don't collide.
 *
 * Downstream `computeLayoutAndCheck` remains the authoritative
 * validator of the resulting shape's REQUIRED fields (a variant
 * missing its mandatory field → `LayoutError`).
 *
 * Same-value `type` is NOT a switch and still deep-merges — a
 * caller can patch `foundation.product.productId` in place without
 * abandoning the surrounding subtree.
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
 * "unknown key". S25 (ticket #47) introduced the first such
 * optional fields — `foundation.blockRowsHint` /
 * `foundation.blockColsHint` — which are patched in by the
 * `add-support-row` remediation on designs whose initial
 * `foundation` subtree does not carry them. The
 * `KNOWN_OPTIONAL_LEAF_PATHS` set (below) grants a NARROWLY-SCOPED
 * full-dotted-path exemption for those fields (and any future
 * optional leaves added by later stories). Any new optional field
 * MUST be added to that set with a comment naming the ticket that
 * introduced it — a rewrite that omits the entry will fail-loud
 * with `Unknown key '...'`, caught by the test suite before it can
 * corrupt production data.
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
 * ## Why the whitelist is FULL-PATH scoped (not leaf-name)
 *
 * (S25 pair-fix / GPT HIGH#1) A leaf-key-only allowlist admitted
 * these hostile-shape patches by name collision:
 *
 *   { joist: { blockRowsHint: 999 } }
 *   { beam:  { blockColsHint: 42 } }
 *   { joist: { material: { blockRowsHint: 7 } } }
 *
 * — none of which are legal DeckDesign edits, all of which used
 * to be silently accepted because the leaf "blockRowsHint" was
 * on the exempt list at every depth. Full dotted-path scoping
 * (`foundation.blockRowsHint`) confines the exemption to the
 * ONE subtree where the field is actually declared on
 * `FoundationSpec`. Adding a future optional leaf is one line
 * (append the dotted path); a typo (`foundation.blockRowHint` —
 * missing 's') is still rejected as unknown.
 *
 * ## Security invariant
 *
 * Every path in this set is a LITERAL alphanumeric identifier
 * declared in `src/domain/model.ts` — none of them collide with
 * prototype-pollution vectors (`__proto__`, `constructor`,
 * `prototype`) which remain rejected by `FORBIDDEN_KEYS` earlier
 * in the same loop. Adding a path to this set does NOT weaken
 * the prototype-pollution defence.
 */
const KNOWN_OPTIONAL_LEAF_PATHS: ReadonlySet<string> = new Set([
  // S25 / ticket #47 — FoundationSpec deck-blocks/tuffblocks
  // additive-optional block-grid overrides. See `FoundationSpec`
  // doc-block in `src/domain/model.ts`.
  'foundation.blockRowsHint',
  'foundation.blockColsHint',
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
 * S23 — is this pair a discriminated-union `type`-tag switch?
 *
 * Returns `true` iff BOTH `current` and `patch` are plain objects
 * whose own key `type` is a string, AND the two string values
 * DIFFER. This is the exact shape a discriminated union takes when
 * a caller flips the discriminator (e.g. `foundation.type` from
 * `'posts-on-footings'` to `'tuffblocks'`).
 *
 * When true, the caller (`deepMerge`) treats the patch subtree as a
 * full REPLACE — no per-key merge, no unknown-key scan against the
 * old variant. This is the ONLY situation in which deep-merge
 * abandons its structural-sharing discipline for a subtree: the
 * caller has explicitly declared a new shape by flipping the tag.
 *
 * ## Why check the CURRENT value's `type` too
 *
 * A subtree that ISN'T a discriminated union (e.g. `footprint`)
 * has no `type` field; the check bails out on the missing/non-string
 * `current.type`, so accidentally naming a field `type` on a
 * non-discriminant subtree doesn't silently switch merge semantics.
 *
 * ## Same-value `type` is NOT a switch
 *
 * `current.type === patch.type` means the caller is keeping the
 * current variant — the standard deep-merge applies (so a caller
 * can patch `foundation.product.productId` in place).
 */
function isDiscriminatorSwitch(
  currentValue: Record<string, unknown>,
  patchValue: Record<string, unknown>,
): boolean {
  const currentType = currentValue['type'];
  const patchType = patchValue['type'];
  return (
    typeof currentType === 'string' &&
    typeof patchType === 'string' &&
    currentType !== patchType
  );
}

/**
 * S23 — validate a REPLACE-subtree payload BEFORE installing it.
 *
 * ## Two invariants enforced (S23 pair-fix BLOCKING #1)
 *
 * The pre-pair-fix version walked ONLY the top-level keys of the
 * replacement subtree, calling `FORBIDDEN_KEYS.has(key)`. Two
 * defects — both flagged by three reviewers (Opus HIGH, GPT HIGH,
 * Security MED) — motivated the rewrite:
 *
 *   1. **Nested prototype pollution.** A JSON.parse-preserved
 *      `__proto__` / `constructor` / `prototype` at depth ≥ 2
 *      (e.g. `foundation.product.__proto__`) BYPASSED the check —
 *      even though the module docstring PROMISES recursive
 *      protection and the deep-merge path (non-REPLACE) DOES
 *      recurse. Fix: walk every plain-object descendant AND
 *      every array element (iter-2: array traversal — defense
 *      in depth for future variants; FoundationSpec has no array
 *      fields today).
 *
 *   2. **Orphan variant keys (FR-026) at TOP LEVEL and NESTED.**
 *      A stale-spread patch like `{ foundation: {
 *      ...current.foundation, type: 'tuffblocks', product } }`
 *      produced a hybrid `tuffblocks` foundation still carrying
 *      `post` + `footing`, matching NO discriminant of
 *      `FoundationSpec`. Fix: at the FOUNDATION top level, reject
 *      keys outside the variant's allowed set (per FR-026 shape).
 *      Iter-2: same at the NESTED level — `product` must be
 *      `{productId}` only; `post` only `MaterialRef` keys
 *      (nominal/species/grade); `footing` only `{widthMm,depthMm}`.
 *
 * ## Interaction with S25's optional-leaf allowlist
 *
 * The block variants (`deck-blocks`, `tuffblocks`) legitimately
 * carry OPTIONAL `blockRowsHint` / `blockColsHint` (S25 / ticket
 * #47). The variant-key allow set INCLUDES those two names at the
 * FOUNDATION TOP level so a REPLACE that installs them does NOT
 * collide with S25's leaf-allowlist. The two mechanisms are
 * orthogonal: S25's allowlist covers deep-merge inserts (adding a
 * hint to a foundation without one); this check covers REPLACE
 * shape (the whole subtree is written verbatim).
 *
 * ## Recursion & error priority
 *
 * `assertNoForbiddenKeysDeep` walks BOTH plain-object descendants
 * (recursing into own values) AND array elements (recursing into
 * each plain-object element by index). Primitives are skipped.
 * The path convention: dotted for object keys (`foo.bar`),
 * bracketed for array indices (`foo[0]`, `foo[0].bar[1]`) — reads
 * naturally in a stack trace.
 *
 * The dispatcher runs `assertNoForbiddenKeysDeep` FIRST — a
 * prototype-pollution vector is a higher-priority error than a
 * variant-shape mismatch, so a payload that would fail BOTH
 * reports the security error first. Then the variant top-level
 * check, then the nested-shape check.
 *
 * @throws {ApplyParametersError} naming the FULL dotted path to the
 *   offending key (forbidden vector OR orphan variant key OR
 *   nested orphan).
 */
function assertReplacementSubtreeSafe(
  patchValue: Record<string, unknown>,
  pathPrefix: string,
): void {
  // 1. Recursive FORBIDDEN_KEYS walk — highest-priority error.
  //    A prototype-pollution vector anywhere in the payload is
  //    reported before any shape-mismatch error, so a rogue
  //    input that ALSO happens to have an orphan variant key
  //    surfaces the security bug first.
  assertNoForbiddenKeysDeep(patchValue, pathPrefix);
  // 2. Variant-key-awareness for the `foundation` subtree —
  //    reject own keys not in the target variant's allowed set.
  //    FR-026 top-level shape defense. Only fires when the
  //    caller targets `foundation` (identifiable by the exact
  //    prefix `foundation.`).
  if (pathPrefix === 'foundation.') {
    assertFoundationReplacementShape(patchValue);
    // 3. Nested-shape check — `foundation.product` must be
    //    `{productId}`, `foundation.post` a `MaterialRef`,
    //    `foundation.footing` a `FootingSpec`. Rejects orphan
    //    keys under any of those (FR-026 at depth ≥ 2).
    assertFoundationNestedShape(patchValue);
  }
}

/**
 * S23 pair-fix BLOCKING #1(a) — recursive FORBIDDEN_KEYS walk
 * (iter-2 extended: descends into arrays too).
 *
 * Walks `value` and every plain-object descendant, throwing
 * `ApplyParametersError` on the first forbidden key found (naming
 * the full dotted path from the patch root). When a value is an
 * ARRAY, iterates its elements and recurses into each plain-object
 * element by index — the path convention is `[idx]` bracketed
 * (e.g. `foundation.someArray[0].__proto__`).
 *
 * Primitives and non-plain non-array objects (Date, Map, class
 * instances) are skipped. `Object.keys` returns only OWN
 * enumerable string keys — no `hasOwnProperty` / `toString`
 * ambient noise — but a JSON.parse-preserved `__proto__` IS an
 * own key on plain objects, so this check fires there.
 *
 * FoundationSpec has no array fields today, so the array branch
 * is not reachable from a valid domain shape via the public API.
 * It exists as defense in depth: a future variant addition that
 * introduces an array-typed field (or a payload constructed with
 * an orphan array key that this dispatcher's variant-shape check
 * would ALSO reject downstream) is caught here first because the
 * dispatcher runs this walk BEFORE the shape checks — a
 * prototype-pollution vector is always the higher-priority error.
 *
 * Exported semantically (via `assertReplacementSubtreeSafe`) so
 * only the REPLACE path calls it; the deep-merge path already
 * catches every FORBIDDEN_KEY at every level via its own iteration
 * loop.
 */
function assertNoForbiddenKeysDeep(
  value: Record<string, unknown>,
  pathPrefix: string,
): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new ApplyParametersError(
        `${pathPrefix}${key}`,
        `Forbidden key '${key}' in discriminator-switch replacement at path '${pathPrefix}${key}' (prototype-pollution defence — see apply-parameters.ts module docs)`,
      );
    }
    const child = value[key];
    if (isPlainObject(child)) {
      assertNoForbiddenKeysDeep(child, `${pathPrefix}${key}.`);
      continue;
    }
    if (Array.isArray(child)) {
      // Iter-2 gap #1 — array traversal. Walk each element by
      // index; recurse into plain-object elements, skip
      // primitives. Nested arrays recurse via the same branch
      // (`walkArray` calls this function again for each
      // plain-object element AND recurses through its own
      // Array.isArray check).
      walkArrayForForbiddenKeys(child, `${pathPrefix}${key}`);
      continue;
    }
    // Primitives / non-plain non-array objects: skip. A non-plain
    // object at this depth is either a Date/Map/class instance the
    // caller sent by accident (downstream `computeLayoutAndCheck`
    // catches it as an unknown value type) or a prototype-backed
    // bag whose OWN keys are empty — no attack surface here.
  }
}

/**
 * Iter-2 helper for `assertNoForbiddenKeysDeep` — walks an array
 * looking for FORBIDDEN keys in plain-object elements. Nested
 * arrays are traversed recursively; primitive elements are
 * skipped. The path convention is `[idx]` bracketed so the
 * error message reads naturally
 * (e.g. `foundation.nested[0][0].constructor`).
 *
 * Kept as a small dedicated helper (rather than folded into
 * `assertNoForbiddenKeysDeep` via a union parameter type) because
 * the loop indexes an array vs an object's own keys — different
 * iteration primitive. Single-responsibility per helper.
 */
function walkArrayForForbiddenKeys(
  arr: readonly unknown[],
  pathPrefix: string,
): void {
  for (let i = 0; i < arr.length; i += 1) {
    const element = arr[i];
    if (isPlainObject(element)) {
      assertNoForbiddenKeysDeep(element, `${pathPrefix}[${i}].`);
      continue;
    }
    if (Array.isArray(element)) {
      walkArrayForForbiddenKeys(element, `${pathPrefix}[${i}]`);
      continue;
    }
    // Primitive: no FORBIDDEN keys reachable.
  }
}

/**
 * S23 pair-fix BLOCKING #1(b) — variant-key-aware shape check for
 * `foundation` REPLACE payloads.
 *
 * The `FoundationSpec` union is discriminated on `type` (FR-026).
 * Each variant declares a FIXED set of allowed own keys — plus
 * two OPTIONAL keys on the block variants (S25 leaf allowlist).
 * A REPLACE payload MUST NOT carry keys outside the target
 * variant's allowed set; a stale-spread pattern that dragged
 * old-variant keys into the new variant (e.g. `post`+`footing`
 * on a `tuffblocks` payload) would produce a hybrid runtime
 * object matching NO variant — FR-026 violation.
 *
 * The allowed-key sets are derived from `FoundationSpec` in
 * `src/domain/model.ts` — every literal here corresponds 1:1 to a
 * TS field of the union. A future variant extension (e.g. adding
 * `helical-pier` type with a `depthMm` field) MUST update this
 * map AND `FoundationSpec`; the tests here catch a drift.
 *
 * @throws {ApplyParametersError} naming the first offending key
 *   PLUS the target variant name.
 */
function assertFoundationReplacementShape(
  patchValue: Record<string, unknown>,
): void {
  const rawType = patchValue['type'];
  // If `type` is missing / not a string, the discriminator-switch
  // predicate would not have fired — but defense in depth: if
  // somehow this validator is called on a non-discriminant
  // shape, we cannot look up an allow set. Fall back to a
  // permissive check (the recursive FORBIDDEN_KEYS pass still
  // runs; downstream `computeLayoutAndCheck` catches the missing
  // discriminator as a `LayoutError`).
  if (typeof rawType !== 'string') return;
  const allowed = FOUNDATION_VARIANT_ALLOWED_KEYS[rawType];
  if (allowed === undefined) {
    // Unknown variant string — a future story added a variant to
    // the type union but forgot to update this map. Fail loud so
    // the omission is caught in test rather than at runtime.
    throw new ApplyParametersError(
      'foundation.type',
      `Unknown foundation variant '${rawType}' in REPLACE payload — ` +
        `expected one of ${Object.keys(FOUNDATION_VARIANT_ALLOWED_KEYS).join(', ')}. ` +
        `Update FOUNDATION_VARIANT_ALLOWED_KEYS in apply-parameters.ts when ` +
        `adding a new FoundationSpec variant (see domain/model.ts).`,
    );
  }
  for (const key of Object.keys(patchValue)) {
    // FORBIDDEN_KEYS are checked separately (recursive pass).
    // Do NOT double-report a `__proto__` here as an "orphan
    // variant key" — the prototype-pollution error is the more
    // informative one.
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (!allowed.has(key)) {
      throw new ApplyParametersError(
        `foundation.${key}`,
        `Key 'foundation.${key}' is not a field of the '${rawType}' variant ` +
          `(FR-026 shape violation). The '${rawType}' variant accepts only: ` +
          `${Array.from(allowed).sort().join(', ')}. This usually indicates a ` +
          `stale-spread pattern in a UI selector — e.g. \`{...current.foundation, ` +
          `type: '${rawType}', ...}\` carrying keys from the previous variant. ` +
          `Emit a fresh subtree instead. See apply-parameters.ts module docs.`,
      );
    }
  }
}

/**
 * S23 pair-fix BLOCKING #1(b) — the per-variant allowed-key map.
 *
 * Derived from `FoundationSpec` in `src/domain/model.ts`:
 *
 *   - `posts-on-footings` : { type, post, footing }
 *   - `deck-blocks`       : { type, product, blockRowsHint?, blockColsHint? }
 *   - `tuffblocks`        : { type, product, blockRowsHint?, blockColsHint? }
 *
 * The two hint keys are declared OPTIONAL on the block variants
 * (S25 / ticket #47) — they belong in the allow set because a
 * REPLACE payload MAY carry them (the S25 add-support-row
 * remediation produces such patches, and the S23 pair-fix test
 * suite explicitly asserts they're accepted).
 *
 * Kept as a `ReadonlyMap<Set>` so the check is O(1) per key. The
 * map is built from a literal at module load; a lint of the
 * literal against `FoundationSpec` runs in
 * `apply-parameters.test.ts` via the "accept legit REPLACE"
 * fixtures — a drift here (e.g. adding a new required field to
 * `FoundationSpec` without updating this map) fails those tests.
 */
const FOUNDATION_VARIANT_ALLOWED_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  'posts-on-footings': new Set(['type', 'post', 'footing']),
  'deck-blocks': new Set(['type', 'product', 'blockRowsHint', 'blockColsHint']),
  'tuffblocks': new Set(['type', 'product', 'blockRowsHint', 'blockColsHint']),
};

/**
 * S23 pair-fix iter-2 gap #2 — allowed keys for NESTED foundation
 * subobjects.
 *
 * Derived from `FoundationSpec` in `src/domain/model.ts`:
 *
 *   - `product` : `FoundationBlockRef` = `{ productId }`
 *   - `post`    : `MaterialRef`        = `{ nominal, species, grade }`
 *   - `footing` : `FootingSpec`        = `{ widthMm, depthMm }`
 *
 * A REPLACE payload MUST NOT smuggle extra keys inside any of
 * these nested objects — an installed `foundation.product.orphan`
 * would leak stale state into the persisted design (FR-026
 * violation at depth ≥ 2). This map is the source of truth for
 * the nested shape check; a `FoundationSpec` change (new field on
 * MaterialRef, e.g.) requires updating BOTH `model.ts` and this
 * literal — the "positive control" REPLACE tests catch the drift.
 *
 * Note: the `blockRowsHint` / `blockColsHint` keys are OPTIONAL
 * LEAVES at the FOUNDATION TOP level (not nested under `product`),
 * so they belong in `FOUNDATION_VARIANT_ALLOWED_KEYS` above, NOT
 * here. This map is only consulted when the outer key is one of
 * `product` / `post` / `footing`.
 */
const FOUNDATION_NESTED_ALLOWED_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  product: new Set(['productId']),
  post: new Set(['nominal', 'species', 'grade']),
  footing: new Set(['widthMm', 'depthMm']),
};

/**
 * S23 pair-fix iter-2 gap #2 — nested-shape check for the
 * `foundation` REPLACE payload.
 *
 * Validates that each of `patchValue.product`, `patchValue.post`,
 * `patchValue.footing` — when present — is a PLAIN OBJECT whose
 * own keys are a subset of the corresponding
 * `FOUNDATION_NESTED_ALLOWED_KEYS[k]` set. Non-object values at
 * a required nested slot (e.g. `product: []`) are rejected with
 * a clear "expected a plain object" error so the REPLACE branch
 * does not install a shape-broken subtree.
 *
 * Runs AFTER `assertNoForbiddenKeysDeep` and
 * `assertFoundationReplacementShape` in the dispatcher — the
 * top-level variant check already guarantees `patchValue`'s keys
 * are a subset of `{type,post,footing,product,blockRowsHint,
 * blockColsHint}` for the target variant, so we only need to
 * inspect the ones that appear in this nested-allowed map.
 *
 * @throws {ApplyParametersError} naming the FULL dotted path to
 *   the offending nested key (e.g. `foundation.product.orphan`)
 *   OR the shape-mismatched nested slot itself when a required
 *   nested field is not a plain object.
 */
function assertFoundationNestedShape(
  patchValue: Record<string, unknown>,
): void {
  for (const nestedKey of Object.keys(FOUNDATION_NESTED_ALLOWED_KEYS)) {
    if (!(nestedKey in patchValue)) continue;
    const nestedValue = patchValue[nestedKey];
    // The nested slot MUST be a plain object — a bare array,
    // primitive, or class instance at `foundation.product` etc.
    // would install a shape-broken subtree.
    if (!isPlainObject(nestedValue)) {
      throw new ApplyParametersError(
        `foundation.${nestedKey}`,
        `Expected a plain object at 'foundation.${nestedKey}' — refusing to REPLACE a domain subtree with a non-plain value (${
          Array.isArray(nestedValue) ? 'received an Array' : `received ${nestedValue === null ? 'null' : typeof nestedValue}`
        }). See apply-parameters.ts module docs.`,
      );
    }
    const allowed = FOUNDATION_NESTED_ALLOWED_KEYS[nestedKey]!;
    for (const key of Object.keys(nestedValue)) {
      // FORBIDDEN_KEYS handled by the recursive walk (higher
      // priority error). Don't double-report.
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (!allowed.has(key)) {
        throw new ApplyParametersError(
          `foundation.${nestedKey}.${key}`,
          `Key 'foundation.${nestedKey}.${key}' is not a field of the '${nestedKey}' sub-object ` +
            `(FR-026 nested shape violation). '${nestedKey}' accepts only: ` +
            `${Array.from(allowed).sort().join(', ')}. Emit a fresh nested subtree ` +
            `matching the FoundationSpec shape in domain/model.ts. See apply-parameters.ts module docs.`,
        );
      }
    }
  }
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
    // S25 pair-fix: full DOTTED-PATH check — a leaf-only allowlist
    // silently accepted `{ joist: { blockRowsHint: 999 } }` and
    // similar wrong-subtree writes. Confine the exemption to the
    // exact declared path (`foundation.blockRowsHint`). The
    // FORBIDDEN_KEYS check above runs first — a `__proto__` under
    // any prefix is still rejected before this check runs.
    if (
      !Object.hasOwn(current, key) &&
      !KNOWN_OPTIONAL_LEAF_PATHS.has(`${pathPrefix}${key}`)
    ) {
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
      // S23 — discriminated-union `type`-tag switch.
      //
      // When BOTH current and patch declare a `type` string and the
      // two values DIFFER, the caller is explicitly flipping the
      // union's discriminator (e.g. `foundation.type` from
      // `'posts-on-footings'` to `'tuffblocks'`). Deep-merging the
      // two variants would carry the OLD variant's sibling keys
      // (`post`, `footing`) into a shape that matches NO discriminant
      // of the union — a hybrid runtime object that would then fail
      // the unknown-key check on the NEW variant's fields (`product`
      // isn't a key of `posts-on-footings`), breaking S23's atomic
      // structure↔foundation re-stamp.
      //
      // The REPLACE path drops the OLD subtree, validates the NEW
      // one against FORBIDDEN_KEYS (defense in depth — a JSON.parse
      // payload can still carry `__proto__`), and installs it
      // verbatim. Downstream `computeLayoutAndCheck` remains the
      // authoritative validator of the resulting shape's fields
      // (missing required field → LayoutError).
      if (isDiscriminatorSwitch(currentValue, patchValue)) {
        assertReplacementSubtreeSafe(patchValue, `${pathPrefix}${key}.`);
        // Fresh shallow copy so the caller's patch object stays
        // untouched (immutability discipline).
        result[key] = { ...patchValue };
        continue;
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
