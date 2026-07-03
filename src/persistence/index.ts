/**
 * `src/persistence/index.ts` — the SINGLE public entry point for the
 * persistence adapter layer.
 *
 * Downstream layers (`src/state/` — S8, `src/ui/` — S14) MUST import
 * from this barrel, never from a private submodule. Enforcement:
 *
 *   - `.dependency-cruiser.cjs` limits `state/` and `ui/` to their
 *     own trees plus `application/` and `domain/`, so a direct
 *     `import '../persistence/deck-file/schema-v1'` would be an
 *     allowlist violation anyway. This barrel is the CANONICAL way
 *     to reach the persistence API — a rewrite of the internals is
 *     invisible to consumers.
 *
 * ## Public surface (frozen — issue #7 §2)
 *
 *   type DeckFile, DeckFileV1, DeckFileMeta, DownloadDeckFileOptions,
 *        SerializeOptions, DeckFileErrorCode
 *   const STORAGE_KEY
 *   class DeckFileError
 *   fn    serialize, deserialize
 *   fn    saveDesignToLocalStorage, loadDesignFromLocalStorage,
 *         clearDesignFromLocalStorage
 *   fn    downloadDeckFile, readDeckFile
 */
export type {
  DeckFile,
  DeckFileV1,
  DeckFileMeta,
  SerializeOptions,
} from './deck-file/schema-v1';
export { serialize, deserialize } from './deck-file/schema-v1';

export type { DeckFileErrorCode } from './deck-file/errors';
export { DeckFileError } from './deck-file/errors';

export {
  STORAGE_KEY,
  saveDesignToLocalStorage,
  loadDesignFromLocalStorage,
  clearDesignFromLocalStorage,
} from './local-storage';

export type { DownloadDeckFileOptions } from './file-io';
export { downloadDeckFile, readDeckFile } from './file-io';
