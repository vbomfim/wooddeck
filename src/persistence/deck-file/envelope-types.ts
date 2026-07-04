/**
 * `src/persistence/deck-file/envelope-types.ts` — the frozen envelope
 * TYPE definitions for the `.deck` v1 AND v2 file formats.
 *
 * ## S18 update — v2 landed
 *
 * With Epic 2's foundation model, the on-disk file format now has
 * TWO versions:
 *
 *   - `DeckFileV1` — legacy shape. `design` uses `V1LegacyDesign`
 *     (no `structure`, no `foundation`). Files written by the pre-
 *     Epic-2 app + tests that need to exercise the v1→v2 migration.
 *   - `DeckFileV2` — current shape. `design` is the post-S17
 *     `DeckDesign` (with `structure` + `foundation` required).
 *
 * `DeckFile` is now the union, and every downstream consumer that
 * needs to distinguish the two switches on `envelope.schema`.
 *
 * ## Why a dedicated types module (not inlined in schema-vX.ts)
 *
 * `schema-vX.ts` (which owns serialize / deserialize) needs to
 * import the RUNTIME validator functions. The validators need the
 * envelope TYPES so they can narrow the runtime `unknown` payload
 * after successful validation. Placing the types alongside serialize
 * would create a cycle (`schema-vX → validator → schema-vX`) that
 * `dependency-cruiser`'s `tsPreCompilationDeps: true` graph flags as
 * `no-circular` even though it's type-only. This leaf module breaks
 * the cycle.
 *
 * ## Contract stability
 *
 * The V1 interfaces below are the on-disk shape of a v1 `.deck` file
 * — they are frozen at v1's spec. New fields go into V2. The V2
 * interfaces are the current supported shape; a future breaking
 * change is a schema-version bump, not a v2-in-place edit.
 */
import type {
  DeckDesign,
  FoundationSpec,
  MaterialRef,
  StructureMode,
} from '../../domain/model';
import type { Mm } from '../../domain/units';

// ==========================================================
// V1 — legacy `.deck` file shape (pre-Epic-2)
// ==========================================================
//
// V1 was written before the Epic 2 amendment introduced `structure`
// + `foundation`. The v1 JSON Schema (docs/deck-file-schema-v1.json)
// still describes the SAME fields — additionalProperties:false at
// every level means a v1 file CANNOT carry the new keys. The
// migration function (`migrate-v1-to-v2.ts`) fills them in with
// documented defaults.

/**
 * The `DeckDesign` shape as it existed on disk in v1 (before the
 * S17 Epic 2 amendment). No `structure`, no `foundation` fields.
 *
 * IMPORTANT: this type is NOT `DeckDesign` — the current `DeckDesign`
 * has the S17-required Epic 2 fields. `V1LegacyDesign` describes
 * the OLD shape, kept as a type for parsing v1 payloads and feeding
 * them to the migration function.
 */
export interface V1LegacyDesign {
  readonly id: string;
  readonly createdAt: string;
  readonly footprint: {
    readonly widthMm: Mm;
    readonly lengthMm: Mm;
    readonly heightMm: Mm;
  };
  readonly joist: {
    readonly material: MaterialRef;
    readonly spacingMm: Mm;
  };
  readonly beam: {
    readonly material: MaterialRef;
  };
  readonly post: {
    readonly material: MaterialRef;
  };
  readonly decking: {
    readonly material: MaterialRef;
    readonly orientation: 'parallel-to-length' | 'parallel-to-width';
  };
  readonly layout: {
    readonly bayRemainderStrategy: 'extra-bay-at-end' | 'centered';
  };
}

/**
 * The `.deck` v1 file envelope. Field order is CANONICAL — it
 * matches the JSON output of `serializeAsV1` and pins the byte-for-
 * byte round-trip.
 *
 * Note the `design` field is typed as `V1LegacyDesign`, NOT the
 * post-S17 `DeckDesign`. A v1 file on disk cannot carry the new
 * Epic 2 fields, so the type reflects that.
 */
export interface DeckFileV1 {
  readonly schema: 1;
  readonly generator: 'wooddeck';
  readonly generatorVersion: string;
  readonly createdAt: string; // ISO-8601
  readonly design: V1LegacyDesign;
}

// ==========================================================
// V2 — current `.deck` file shape (Epic 2 onward)
// ==========================================================

/**
 * The compile-time constant recording the v2 envelope's `schema`
 * discriminator. Kept as a `const` so runtime code has a single
 * literal to compare against and the CI / typecheck flags any
 * accidental "magic number" reuse.
 */
export const SCHEMA_V2_VERSION = 2 as const;

/**
 * The `.deck` v2 file envelope. Field order is CANONICAL — matches
 * the JSON output of `serialize` (the v2 default).
 *
 * `design` is the post-S17 `DeckDesign` — the `structure` and
 * `foundation` fields are REQUIRED. A v2 file on disk carries every
 * field the current domain expects; no migration is needed on load.
 */
export interface DeckFileV2 {
  readonly schema: 2;
  readonly generator: 'wooddeck';
  readonly generatorVersion: string;
  readonly createdAt: string; // ISO-8601
  readonly design: DeckDesign;
}

// ==========================================================
// Unified surface
// ==========================================================

/**
 * Union across every supported envelope shape. Downstream code
 * should reach for `DeckFile` rather than `DeckFileV1` or `DeckFileV2`
 * so a future schema bump is a one-line addition here (`| DeckFileV3`)
 * and every consumer's `switch (envelope.schema)` fails to compile
 * on a missing case.
 */
export type DeckFile = DeckFileV1 | DeckFileV2;

/** Optional serialization overrides — used by tests to pin envelope stamps. */
export interface SerializeOptions {
  /** Override the ISO-8601 `createdAt` stamp (defaults to `new Date().toISOString()`). */
  readonly createdAt?: string;
  /** Override the semver `generatorVersion` stamp (defaults to the Vite define). */
  readonly generatorVersion?: string;
}

/**
 * Meta record returned by `deserialize` — mirrors the envelope minus
 * `design`.
 *
 * ## S18 — `schema` now admits 1 | 2
 *
 * Pre-S18 the field was `1 | (number & {})`. Now that v2 has landed
 * it's `1 | 2 | (number & {})` — a v1 file surfaces `schema: 1` here
 * (even though the design was migrated to v2), so a caller inspecting
 * `meta.schema === 1` learns "this file was migrated from v1". S23's
 * migration-toast UI will read this seam.
 *
 * The `number & Record<never, never>` tail preserves branch narrowing
 * against widening (TypeScript's canonical idiom) — plain `1 | 2 |
 * number` would collapse to `number`.
 */
export interface DeckFileMeta {
  readonly schema: 1 | 2 | (number & Record<never, never>);
  readonly generator: string;
  readonly generatorVersion: string;
  readonly createdAt: string;
}

// ==========================================================
// Re-exports for consumers that expect the S17 domain types
// ==========================================================
//
// A convenience passthrough so downstream code that needs
// `FoundationSpec` / `StructureMode` can grab them from the same
// module as `DeckFileV2`. This is a NAMED re-export, not a barrel
// abuse — the types are load-bearing for the v2 envelope shape.
export type { FoundationSpec, StructureMode };
