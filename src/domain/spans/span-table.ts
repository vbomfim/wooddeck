/**
 * `src/domain/spans/span-table.ts` — the abstraction seam for
 * IRC-style span data.
 *
 * ## Purpose
 *
 * `spanCheck` (in `./span-check.ts`) needs to ask "how far can this
 * joist / beam span?". If it asked a concrete IRC-2018 module
 * directly, then swapping in IRC-2024, the Canadian NBC, a
 * region-specific dataset, or a MOCK for unit tests would require
 * editing the checker. The `SpanTable` interface breaks that
 * coupling: the checker depends on an interface, and any conforming
 * implementation plugs in.
 *
 * This module intentionally contains NO runtime code — every export
 * is a `type` / `interface`. It compiles to an empty JavaScript
 * file, has zero runtime footprint, and satisfies the
 * `src/domain/**` framework-free / DOM-free rule automatically.
 *
 * ## Interface contract (from GitHub issue #6)
 *
 * ```ts
 * interface SpanTable {
 *   readonly edition: string;
 *   lookupJoistMaxSpan(material: MaterialRef, spacingMm: Mm): Mm;
 *   lookupBeamMaxSpan(material: MaterialRef, joistSpanMm: Mm, plyCount: number): Mm;
 *   citationFor(kind: MemberKind, material: MaterialRef, spacingMm: Mm): string;
 * }
 * ```
 *
 * ### `edition`
 * A human-readable, stable identifier for the dataset (e.g., `"IRC-2018"`).
 * Used in log lines, error messages, and the `Warning.tableReference`
 * prefix so a homeowner + inspector can trace the exact source.
 *
 * ### `lookupJoistMaxSpan(material, spacingMm) → Mm`
 * Returns the largest allowable center-to-center joist span (mm) for
 * the given size + species + grade + on-center spacing. Returns `0`
 * when the material/spacing combination is not covered by the dataset
 * — the caller MUST interpret `0` as "fail-safe warn" (never as "no
 * limit"). See `Warning`-fail-safe contract in ticket AC4 + the
 * `IrcSpanTable` module docs.
 *
 * ### `lookupBeamMaxSpan(material, joistSpanMm, plyCount) → Mm`
 * Returns the largest allowable center-to-center distance between two
 * adjacent posts on the beam (mm), given the beam's size + species +
 * grade, the tributary joist span it supports, and the number of
 * lumber plies built up (2 = double, 3 = triple; MVP defaults to 2).
 * Same `0` semantics as `lookupJoistMaxSpan`.
 *
 * ### `citationFor(kind, material, spacingMm) → string`
 * Returns the exact table-row string carried on the `Warning`'s
 * `tableReference` field so the UI (S13 Warnings panel) + a code
 * inspector can find the row in the source publication. The
 * `spacingMm` parameter is the on-center spacing for `kind: "joist"`;
 * for `kind: "beam"` it is IGNORED (pass `0` by convention — see
 * `span-check.ts`). This slightly-overloaded shape matches the
 * signature the ticket dictates and keeps the interface a single
 * method rather than two.
 */

import type { MaterialRef, MemberKind } from '../model';
import type { Mm } from '../units';

/**
 * The abstraction seam for IRC-style span-checking datasets. See
 * module header for the semantics of each member.
 *
 * Implementations MUST be pure (no I/O, no shared mutable state) so
 * that multiple `spanCheck` calls on the same design produce
 * identical `Warning[]`s regardless of call order.
 */
export interface SpanTable {
  /** Stable dataset identifier (e.g., `"IRC-2018"`, `"IRC-2024"`, `"NBC-2020"`). */
  readonly edition: string;

  /**
   * Max allowable joist span in mm for the given size / species /
   * grade / spacing. Returns `0` when the combination is not in the
   * dataset (fail-safe warn — see AC4).
   */
  lookupJoistMaxSpan(material: MaterialRef, spacingMm: Mm): Mm;

  /**
   * Max allowable beam post-to-post span in mm for the given size /
   * species / grade / tributary joist span / ply-count. Returns `0`
   * when the combination is not in the dataset (fail-safe warn).
   */
  lookupBeamMaxSpan(material: MaterialRef, joistSpanMm: Mm, plyCount: number): Mm;

  /**
   * Human-readable citation for the row a `Warning` was derived
   * from. Named parameter shape matches ticket §2; `spacingMm` is
   * the on-center spacing when `kind === 'joist'` and is IGNORED
   * for `kind === 'beam'` (callers pass `0`).
   */
  citationFor(kind: MemberKind, material: MaterialRef, spacingMm: Mm): string;
}
