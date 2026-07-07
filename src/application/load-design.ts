/**
 * `src/application/load-design.ts` — the two "load" use-cases:
 * `loadDesignFromFile` and `loadDesignFromLocalStorage`.
 *
 * ## Same file name, different responsibilities
 *
 * The persistence layer (`../persistence/local-storage.ts`) exports a
 * function CALLED `loadDesignFromLocalStorage`. THIS module also
 * exports a function called `loadDesignFromLocalStorage` — the
 * application-layer wrapper composes:
 *
 *   persistence.loadDesignFromLocalStorage() : DeckDesign | null
 *   application.loadDesignFromLocalStorage() : DesignBundle | null
 *
 * The application version delegates to the persistence version, then
 * (on non-null) runs `computeLayoutAndCheck` to produce the full
 * `DesignBundle` the S8 store consumes.
 *
 * To make the name collision unambiguous at read time we import the
 * persistence function under an ALIAS
 * (`persistenceLoadFromLocalStorage`). Every subsequent reference is
 * unambiguous: the un-aliased identifier at the bottom is the export;
 * every alias-prefixed call is a delegated persistence call. Same
 * pattern will show up in `save-design.ts` (`saveDesignToLocalStorage`
 * exists in both layers).
 *
 * A naive `import { loadDesignFromLocalStorage } from '../persistence'`
 * would collide at export site, and a re-export at the barrel would
 * silently mask one of them. Alias-plus-single-export removes the
 * ambiguity structurally.
 *
 * ## Line budget
 *
 * Issue #8 §15 caps each USE-CASE at 40 lines. Both functions in this
 * file are ≤ 15 lines each — well under budget. The two are grouped
 * in one file because they share a concern ("load a design bundle")
 * and share the same persistence-alias import.
 *
 * ## Error contract
 *
 * `loadDesignFromFile` propagates `DeckFileError` (from persistence)
 * and `LayoutError` (from `computeLayout` via `computeLayoutAndCheck`)
 * unchanged — the state store pattern-matches on both.
 *
 * `loadDesignFromLocalStorage` returns `null` when the persistence
 * loader returns `null` (no stored design, or a DeckFileError
 * swallowed and reported as `null` per persistence's documented
 * contract). It PROPAGATES `LayoutError` unchanged: a stored
 * design that parses and schema-validates but fails `computeLayout`
 * is a genuine boot-time bug (not a "storage lost my design"
 * silent-failure), and the S8 store should surface it. S8 will
 * catch this at boot and fall back to a fresh default design plus
 * a banner — see issue #8 defer-note re: boot-time recovery.
 */

import type { SpanTable } from '../domain/spans';
import {
  loadDesignFromLocalStorage as persistenceLoadFromLocalStorage,
  readDeckFile,
} from '../persistence';

import { computeLayoutAndCheck } from './compute-layout';
import type { DesignBundle } from './types';

/**
 * Result of `loadDesignFromFile` and `loadDesignFromLocalStorage` —
 * the fully computed `DesignBundle` plus the `migrated` boolean
 * introduced in S18 (AC9). When `true`, the on-disk file was a v1
 * envelope that was upgraded to v2 during load; S23 will wire a
 * migration toast off this seam. Callers that don't care about the
 * flag can destructure `{ bundle }` and drop `migrated`.
 */
export interface LoadDesignResult {
  readonly bundle: DesignBundle;
  readonly migrated: boolean;
}

/**
 * Parse + validate a `.deck` file uploaded by the user, then compute
 * its layout and run the span-check.
 *
 * @param file  Untrusted `File` from a `<input type="file">` — every
 *              validation lives in `readDeckFile` (size cap, JSON
 *              parse, schema validation, version check).
 * @param table `SpanTable` instance owned by the state store (the
 *              ticket §17 Open Question resolved to option (b): pass
 *              at every call site rather than a module singleton).
 *
 * @throws {DeckFileError} propagated unchanged from `readDeckFile`
 *   (codes: `file-too-large`, `file-read-failed`, `invalid-json`,
 *   `schema-validation-failed`, `unknown-schema`, `migration-failed`).
 * @throws {LayoutError} propagated from `computeLayout` when the
 *   parsed design references an unknown catalog material OR is
 *   dimensionally invalid (issue #8 §4 Edge cases).
 */
export async function loadDesignFromFile(
  file: File,
  table: SpanTable,
): Promise<LoadDesignResult> {
  const { design, migrated } = await readDeckFile(file);
  const { layout, warnings } = computeLayoutAndCheck(design, table);
  return { bundle: { design, layout, warnings }, migrated };
}

/**
 * Boot-time load of the current design from `localStorage`. Returns
 * `null` when no valid design is stored — the state store treats this
 * as "start with a fresh default".
 *
 * Does NOT catch `LayoutError`: if the stored design deserializes
 * successfully but fails layout compute, the throw surfaces so the
 * bug is loud rather than silently discarded (that would look like
 * "storage lost my design"). The persistence-side load already
 * swallows any `DeckFileError`, so `LayoutError` is the only
 * remaining failure mode we might see here.
 *
 * The returned `migrated` flag propagates the persistence-layer
 * migration boolean unchanged — `true` iff the stored slot held a v1
 * envelope that was upgraded to v2 in-flight.
 *
 * @param table `SpanTable` instance (see `loadDesignFromFile` param
 *   docs for why it is passed here).
 */
export function loadDesignFromLocalStorage(table: SpanTable): LoadDesignResult | null {
  const loaded = persistenceLoadFromLocalStorage();
  if (loaded === null) return null;
  const { design, migrated } = loaded;
  const { layout, warnings } = computeLayoutAndCheck(design, table);
  return { bundle: { design, layout, warnings }, migrated };
}
