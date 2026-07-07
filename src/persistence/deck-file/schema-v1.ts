/**
 * `src/persistence/deck-file/schema-v1.ts` — v1 envelope types and
 * `serializeAsV1`.
 *
 * ## S18 update — deserialize moved, serialize renamed
 *
 * Since S18 the LOAD path is a single `deserialize` living in
 * `schema-v2.ts` — it dispatches across every known schema version
 * (currently 1 → migrate → v2, and native 2). The v1-only serializer
 * has been renamed to `serializeAsV1` and is now an INTERNAL corpus
 * helper — production save paths call `serialize` (v2 default).
 *
 * `serializeAsV1` remains exported so:
 *   - The v1 corpus fixtures (`__fixtures__/v1-envelopes.ts`) can
 *     synthesize genuine v1 envelopes for migration tests (AC2/AC3).
 *   - A future "export as legacy" toggle (not planned) could reuse
 *     the same builder.
 *
 * ## Byte-for-byte round-trip (SC-006)
 *
 * The envelope construction below matches `DeckFileV1` field order —
 * `JSON.stringify` preserves insertion order, and the round-trip
 * property test pins that invariant. If a field is added or
 * reordered, the property test fails immediately.
 *
 * ## Build-time version injection
 *
 * `generatorVersion` is stamped from `package.json.version` via a
 * Vite `define` at build time. The `globalThis` fallback covers the
 * (should-be-unreachable) case where the token was not substituted —
 * printing `'0.0.0-unknown'` is safer than crashing.
 */
import type { DeckFileV1, SerializeOptions, V1LegacyDesign } from './envelope-types';

// Re-export the envelope types from this module too, so downstream
// code that has always imported them from `schema-v1` continues to
// work. The single source of truth is `envelope-types.ts`.
export type {
  DeckFile,
  DeckFileMeta,
  DeckFileV1,
  SerializeOptions,
  V1LegacyDesign,
} from './envelope-types';

// ---------------------------------------------------------------------------
// Build-time constants
// ---------------------------------------------------------------------------

declare const __WOODDECK_VERSION__: string;

/**
 * Read the wooddeck build version stamped into `.deck` files.
 * Duplicated from `schema-v2.ts` deliberately — the two serializers
 * are independent artifacts and neither should depend on the other's
 * internals. A future refactor could hoist this to a shared module
 * (`build-info.ts`) but the cost of duplication for a 6-line helper
 * is smaller than the coupling cost.
 */
function getGeneratorVersion(): string {
  if (typeof __WOODDECK_VERSION__ === 'string' && __WOODDECK_VERSION__.length > 0) {
    return __WOODDECK_VERSION__;
  }
  const fallback = (globalThis as { __WOODDECK_VERSION__?: unknown }).__WOODDECK_VERSION__;
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : '0.0.0-unknown';
}

// ---------------------------------------------------------------------------
// serializeAsV1 — corpus helper (NOT the production save path)
// ---------------------------------------------------------------------------

/**
 * Wrap a legacy `V1LegacyDesign` in a v1 envelope and return the
 * JSON string. This is NOT the production save path — that is
 * `serialize` in `schema-v2.ts`. Use this only to synthesize v1
 * corpus fixtures for migration tests.
 *
 * The design payload must already be in the pre-Epic-2 shape (no
 * `structure`, no `foundation`). The v2 loader will migrate the
 * emitted file on load, producing a post-Epic-2 `DeckDesign`.
 */
export function serializeAsV1(
  design: V1LegacyDesign,
  opts: SerializeOptions = {},
): string {
  const envelope: DeckFileV1 = {
    schema: 1,
    generator: 'wooddeck',
    generatorVersion: opts.generatorVersion ?? getGeneratorVersion(),
    createdAt: opts.createdAt ?? new Date().toISOString(),
    design,
  };
  return JSON.stringify(envelope);
}
