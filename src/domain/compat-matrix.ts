/**
 * `src/domain/compat-matrix.ts` — the pure `structure × foundation`
 * compatibility check (Epic 2 / S17 / FR-030).
 *
 * ## Purpose
 *
 * Given a `{ structure, foundation }` pair, return `{ ok: true }` if
 * the combination is allowed by the MVP scope or `{ ok: false, reason }`
 * with a user-legible explanation of the incompatibility. The
 * function is PURE — same input yields byte-equal output on every
 * call; no I/O, no clock, no store access.
 *
 * ## The 2×3 matrix (FR-030 — pinned by ticket #39 AC5)
 *
 * ```
 *                    posts-on-footings   deck-blocks   tuffblocks
 *   elevated:       ok                   ok            FAIL
 *   floating:       FAIL                 ok            ok
 * ```
 *
 * The two FAIL cases carry exact reason strings the ticket §AC5 pins
 * (see the branches below). A copy-edit of either string surfaces as
 * a test failure in `compat-matrix.test.ts`.
 *
 * ## Rationale for the two rejections
 *
 *   - `elevated + tuffblocks` — TuffBlock is a polypropylene ground-
 *     level product. Its rated load path assumes the puck sits
 *     directly on prepared gravel with framing on top; it is NOT
 *     designed to carry a post pointing upward from its face. The
 *     vendor's data sheet is explicit about ground-level use only.
 *   - `floating + posts-on-footings` — a floating deck by definition
 *     rests directly on a block grid. Poured or precast footings
 *     imply a post-supported (elevated) design; asking for footings
 *     in a floating layout is a data-entry mistake, not a legitimate
 *     variant.
 *
 * ## Exhaustiveness
 *
 * The `switch` on `structure` is total (2 branches); each branch's
 * inner `switch` on `foundation.type` is total (3 branches). Both
 * fall through to a `_exhaustive: never` guard so a new
 * `StructureMode` or `FoundationSpec.type` variant fails-compile
 * here until the matrix is updated (`noFallthroughCasesInSwitch:
 * true` — see `tsconfig.json`).
 *
 * ## Layer boundary
 *
 * Pure `src/domain/**` module. Imports ONLY from `./model` (types).
 * No runtime dependency on any other layer. dependency-cruiser's
 * `domain-allowlist` rule permits this.
 */
import type { FoundationSpec, StructureMode } from './model';

// ==========================================================
// Result type — a small discriminated union
// ==========================================================

/**
 * Success discriminant — the combination is allowed by the MVP.
 */
export interface CompatOk {
  readonly ok: true;
}

/**
 * Failure discriminant — the combination is REJECTED. The `reason`
 * string is user-legible plain English (no `SNAKE_CODES`, no
 * bracketed keys, no stack fragments) — safe to render directly in
 * the ParameterPanel (S23).
 */
export interface CompatFail {
  readonly ok: false;
  readonly reason: string;
}

/**
 * The return-type contract. Consumers `switch` on `.ok` (or use `if
 * (result.ok) …`) to narrow before reading `.reason`.
 */
export type CompatResult = CompatOk | CompatFail;

// ==========================================================
// Reason strings — pinned by ticket §AC5
// ==========================================================
//
// Kept as named constants so a downstream test can import them for a
// literal-equality assertion without duplicating the text. Also
// makes a copy-edit a one-place change.

const REASON_ELEVATED_TUFFBLOCKS =
  'TuffBlock is designed for ground-level (floating) decks; ' +
  'the standard product is not rated for post-supported construction';

const REASON_FLOATING_POSTS_ON_FOOTINGS =
  'Floating construction rests directly on the block grid; ' +
  'poured footings are only compatible with elevated construction';

// ==========================================================
// Public API
// ==========================================================

/**
 * Validate a `{ structure, foundation }` combination against the
 * FR-030 matrix. Pure — no side effects, no clock, no RNG. Returns
 * a fresh object literal per call (safe to store, safe to discard).
 *
 * @see the "matrix" ASCII table in the module header for the six
 *   outcomes at a glance.
 */
export function validateFoundationCombination(input: {
  readonly structure: StructureMode;
  readonly foundation: FoundationSpec;
}): CompatResult {
  const { structure, foundation } = input;
  switch (structure) {
    case 'elevated':
      switch (foundation.type) {
        case 'posts-on-footings':
          return { ok: true };
        case 'deck-blocks':
          return { ok: true };
        case 'tuffblocks':
          return { ok: false, reason: REASON_ELEVATED_TUFFBLOCKS };
        default: {
          // Compile-time exhaustive check — a new `FoundationSpec.type`
          // fails here until the branch is added.
          const _exhaustive: never = foundation;
          return _exhaustive;
        }
      }
    case 'floating':
      switch (foundation.type) {
        case 'posts-on-footings':
          return { ok: false, reason: REASON_FLOATING_POSTS_ON_FOOTINGS };
        case 'deck-blocks':
          return { ok: true };
        case 'tuffblocks':
          return { ok: true };
        default: {
          const _exhaustive: never = foundation;
          return _exhaustive;
        }
      }
    default: {
      // Compile-time exhaustive check — a new `StructureMode` value
      // fails here until the branch is added.
      const _exhaustive: never = structure;
      return _exhaustive;
    }
  }
}
