/**
 * `src/persistence/deck-file/schema-constants.ts` — the SINGLE
 * source-of-truth for the persistence-side enum lists that appear
 * BOTH in the S17 TS types (`StructureMode`, `FoundationSpec['type']`,
 * `FoundationProductId`) AND in the v2 JSON Schema's `enum` fields.
 *
 * ## Why this file exists (S18 AC8)
 *
 * Without a shared source, the TS union `type StructureMode` and the
 * JSON Schema's `enum` for `design.structure` can drift silently — a
 * new mode added on one side but not the other yields a runtime
 * validation failure that only surfaces at load time. This file
 * pins the arrays as `as const` tuples, derives the TS types from
 * them, and — via the `AssertEqual<A,B>` compile-time helper at the
 * bottom — proves the derived types are identical to the S17
 * exports. A mismatch (an added variant on one side but not the
 * other) fails to compile.
 *
 * The v2 JSON Schema (`docs/deck-file-schema-v2.json`) currently
 * carries its `enum` arrays as hand-written literals — the AssertEqual
 * checks are the belt; a future `build-schema.mjs` that reads THIS
 * file and emits the JSON would be the suspenders (S18 §17 Q1).
 *
 * ## Layer boundary
 *
 * Pure persistence-side module. Imports only:
 *   - `../../domain/model` for the S17 `StructureMode`, `FoundationSpec`
 *   - `../../domain/foundation-catalog` for `FoundationProductId`
 *
 * Both edges are `import type` and already permitted by
 * `.dependency-cruiser.cjs` (persistence → domain is an allowed edge).
 * No new cross-layer edge introduced.
 */
import type { FoundationSpec, StructureMode } from '../../domain/model';
import type { FoundationProductId } from '../../domain/foundation-catalog';

// ==========================================================
// Enum arrays — the SINGLE source of truth
// ==========================================================

/**
 * Every value the S17 `StructureMode` union may take. The order
 * mirrors ticket §2 FR-027 (elevated first, floating second).
 */
export const STRUCTURE_MODES = ['elevated', 'floating'] as const;

/**
 * Every discriminator value the S17 `FoundationSpec.type` union may
 * take. The order mirrors ticket §2 FR-026.
 */
export const FOUNDATION_TYPES = [
  'posts-on-footings',
  'deck-blocks',
  'tuffblocks',
] as const;

/**
 * Every `FoundationProductId` the S17 foundation catalog stocks. The
 * order mirrors `foundation-catalog.MVP_PRODUCTS`.
 */
export const FOUNDATION_PRODUCT_IDS = [
  'oldcastle-11x11x7',
  'tuffblock-12x12x4',
] as const;

// ==========================================================
// Derived types
// ==========================================================

export type StructureModeConst = (typeof STRUCTURE_MODES)[number];
export type FoundationTypeConst = (typeof FOUNDATION_TYPES)[number];
export type FoundationProductIdConst = (typeof FOUNDATION_PRODUCT_IDS)[number];

// ==========================================================
// Compile-time equality checks (AC8)
// ==========================================================
//
// `AssertEqual<A, B>` is a canonical TypeScript "type-level equality"
// pattern. If the two type parameters are structurally equal, the
// alias evaluates to a valid value the `never` position accepts;
// if they differ (a new variant is added to one side but not the
// other), the resulting type is `never`, and the const declaration
// `const _check: AssertEqual<A, B> = true;` fails to compile with
// "Type 'true' is not assignable to type 'never'".
//
// Why the twin `[T]` wrappers: keeps distributive conditional types
// from expanding unions before comparison — the check must be over
// the FULL union shape, not each member individually.

type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : never;

// ---- StructureMode ---------------------------------------------------------
//
// The `_matches…` constants are EXPORTED (not module-private) so
// `tsc`'s `noUnusedLocals` does not strip them. Their VALUE
// (`true`) is not what matters — the TYPE annotation is the compile-
// time equality assertion. If a variant is added to one side but
// not the other, `AssertEqual<A, B>` evaluates to `never`, and
// `const _x: never = true;` fails compilation with
// "Type 'true' is not assignable to type 'never'".

export const _structureModeMatchesS17: AssertEqual<StructureMode, StructureModeConst> =
  true;

// ---- FoundationType --------------------------------------------------------
//
// S17's `FoundationSpec` is a discriminated union; extract the `type`
// tags via a mapped type to compare with the persistence-side tuple.

type FoundationTypeFromS17 = FoundationSpec['type'];

export const _foundationTypeMatchesS17: AssertEqual<
  FoundationTypeFromS17,
  FoundationTypeConst
> = true;

// ---- FoundationProductId ---------------------------------------------------

export const _foundationProductIdMatchesS17: AssertEqual<
  FoundationProductId,
  FoundationProductIdConst
> = true;
