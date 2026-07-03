/**
 * `src/application/save-design.ts` — the two "save" use-cases:
 * `saveDesignToLocalStorage` (autosave slot) and `downloadDesign`
 * (user-triggered .deck download).
 *
 * ## Same file name, different responsibilities (persistence collision)
 *
 * The persistence layer exports a function CALLED
 * `saveDesignToLocalStorage`. This module also exports a function
 * called `saveDesignToLocalStorage` — the application wrapper is a
 * thin delegation that PROPAGATES the persistence-layer error
 * contract (`DeckFileError code:"storage-full"` / `"storage-blocked"`)
 * unchanged.
 *
 * To make the collision unambiguous at read time we import the
 * persistence function under an alias (`persistenceSaveToLocalStorage`)
 * — mirror of the pattern in `./load-design.ts`. The single
 * un-aliased identifier at export is the public application-layer
 * function; every `persistenceSaveToLocalStorage` call is delegated
 * to the persistence layer.
 *
 * ## Why a wrapper at all — isn't this just re-export?
 *
 * Two reasons the wrapper stays:
 *
 *   1. **Uniform layer**: EVERY save/load flow in the application
 *      layer goes through `src/application/**`, so a rewrite of the
 *      persistence adapter (S6 → S6b) never leaks its module paths
 *      into consumers. If `save-design.ts` were a pass-through
 *      re-export instead, the state store (S8) would import a
 *      persistence symbol under an application module path — a
 *      false invariant.
 *   2. **Future concerns bolt on cleanly**: throttling, dirty-flag
 *      short-circuits, retry-with-backoff, telemetry — none of that
 *      belongs in `persistence/`, but all of it belongs here. Right
 *      now these wrappers ARE trivial; they are placeholders for
 *      the S18 preset flow and other future save behaviours.
 *
 * ## Line budget
 *
 * Both functions are 3 lines each — well under the 40-line cap in
 * issue #8 §15.
 *
 * ## No direct DOM / localStorage access
 *
 * The application layer never touches `document`, `window`, or
 * `localStorage` directly — every browser API is reached through
 * `persistence/` (see the module boundary rules in
 * `.dependency-cruiser.cjs`). ESLint's `no-restricted-globals` on
 * `src/domain/**` does NOT block these globals under
 * `src/application/**`, so the DISCIPLINE is manual: keep browser
 * APIs behind `persistence/`.
 */

import type { DeckDesign } from '../domain/model';
import {
  downloadDeckFile as persistenceDownloadDeckFile,
  saveDesignToLocalStorage as persistenceSaveToLocalStorage,
} from '../persistence';

/**
 * Persist a design to the autosave slot. Synchronous — the S8 state
 * store wraps this in a debounce.
 *
 * @throws {DeckFileError} propagated unchanged from
 *   `persistence.saveDesignToLocalStorage`. Codes seen here:
 *   `'storage-full'` (quota exceeded), `'storage-blocked'`
 *   (SecurityError / private mode / storage unavailable).
 */
export function saveDesignToLocalStorage(design: DeckDesign): void {
  persistenceSaveToLocalStorage(design);
}

/**
 * Trigger a browser download of the design as a `.deck` JSON file.
 * The filename is generated inside the persistence layer from the
 * UTC clock (issue #7 §6 Security — never derived from user input)
 * and canNOT be overridden by the caller.
 */
export function downloadDesign(design: DeckDesign): void {
  persistenceDownloadDeckFile(design);
}
