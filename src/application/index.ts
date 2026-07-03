/**
 * `src/application/index.ts` — the SINGLE public entry point for the
 * application use-case layer.
 *
 * Downstream layers (`src/state/` — S8, `src/ui/` — S14) MUST import
 * from this barrel, never from a private submodule. Enforcement:
 *
 *   - `.dependency-cruiser.cjs` limits `state/` to `state/ +
 *     application/ + domain/`, and `ui/` to `ui/ + state/ +
 *     application/ + domain/`. Direct submodule imports (e.g.
 *     `../application/apply-parameters`) are technically legal to
 *     dep-cruiser, but the codebase convention is to route through
 *     this barrel so a submodule rename / split does not break
 *     downstream imports.
 *
 * ## Public surface (frozen — issue #8 §2)
 *
 *   type DesignBundle, DeepPartial
 *   fn   computeLayoutAndCheck
 *   fn   loadDesignFromFile, loadDesignFromLocalStorage
 *   fn   saveDesignToLocalStorage, downloadDesign
 *   fn   applyParameters
 *   class ApplyParametersError
 *   class DeckFileError (re-export from persistence)
 *
 * ## Name collisions with `../persistence`
 *
 * TWO exports here share a name with a persistence export:
 *
 *   application.loadDesignFromLocalStorage → returns DesignBundle | null
 *   application.saveDesignToLocalStorage   → delegates + propagates
 *
 * Consumers importing from THIS barrel get the application-layer
 * version (which composes persistence + `computeLayoutAndCheck` /
 * error propagation). Anyone deliberately reaching for the raw
 * persistence version must import from `../persistence` directly —
 * S8 should never do this (it would bypass layout recompute on load).
 */
export type { DesignBundle, DeepPartial } from './types';

export { computeLayoutAndCheck } from './compute-layout';

export {
  loadDesignFromFile,
  loadDesignFromLocalStorage,
} from './load-design';

export {
  downloadDesign,
  saveDesignToLocalStorage,
} from './save-design';

export {
  ApplyParametersError,
  applyParameters,
} from './apply-parameters';

/**
 * Re-export of the persistence-layer `DeckFileError` so downstream
 * layers (state, ui) can `instanceof` narrow save/load failures
 * WITHOUT taking a direct import edge on `../persistence`. Keeping
 * this on the application barrel lets `.dependency-cruiser.cjs`
 * enforce the "state routes all I/O through application" invariant
 * (the `state-allowlist` deliberately excludes `persistence/`).
 *
 * The re-export is intentionally value-side (not `export type`) —
 * `instanceof DeckFileError` requires the class at runtime.
 */
export { DeckFileError } from '../persistence';
