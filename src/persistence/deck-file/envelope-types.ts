/**
 * `src/persistence/deck-file/envelope-types.ts` — the frozen envelope
 * TYPE definitions for the `.deck` v1 file format.
 *
 * ## Why a dedicated types module (not inlined in schema-v1.ts)
 *
 * `schema-v1.ts` (which owns `serialize` / `deserialize`) needs to
 * import the RUNTIME `validateDeckFile` from `validator.ts`. And
 * `validator.ts` needs the `DeckFileV1` TYPE so it can narrow the
 * runtime `unknown` payload after successful validation. Placing
 * the types alongside serialize would create a cycle
 * (`schema-v1 → validator → schema-v1`) that `dependency-cruiser`'s
 * `tsPreCompilationDeps: true` graph flags as `no-circular` even
 * though it's type-only. This leaf module breaks the cycle.
 *
 * ## Contract stability
 *
 * The interfaces below are the on-disk shape of a v1 `.deck` file —
 * changing them is a schema-version bump. A rewrite may reorganize
 * how types are laid out, but MUST preserve every field name, order,
 * and literal (e.g. `schema: 1`, `generator: 'wooddeck'`).
 */
import type { DeckDesign } from '../../domain/model';

/**
 * The `.deck` v1 file envelope. Field order is CANONICAL — it
 * matches the JSON output of `serialize` and pins SC-006's
 * byte-for-byte round-trip.
 */
export interface DeckFileV1 {
  readonly schema: 1;
  readonly generator: 'wooddeck';
  readonly generatorVersion: string;
  readonly createdAt: string; // ISO-8601
  readonly design: DeckDesign;
}

/**
 * Union alias — grows to `DeckFileV1 | DeckFileV2 | ...` when a
 * future schema version lands. Downstream code should reach for
 * `DeckFile` rather than `DeckFileV1` to survive the transition.
 */
export type DeckFile = DeckFileV1;

/** Optional serialization overrides — used by tests to pin envelope stamps. */
export interface SerializeOptions {
  /** Override the ISO-8601 `createdAt` stamp (defaults to `new Date().toISOString()`). */
  readonly createdAt?: string;
  /** Override the semver `generatorVersion` stamp (defaults to the Vite define). */
  readonly generatorVersion?: string;
}

/** Meta record returned by `deserialize` — mirrors the envelope minus `design`. */
export interface DeckFileMeta {
  readonly schema: number;
  readonly generator: string;
  readonly generatorVersion: string;
  readonly createdAt: string;
}
