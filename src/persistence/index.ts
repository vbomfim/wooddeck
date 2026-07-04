/**
 * `src/persistence/index.ts` — the SINGLE public entry point for the
 * persistence adapter layer.
 *
 * Downstream layers (`src/state/` — S8, `src/ui/` — S14) MUST import
 * from this barrel, never from a private submodule. Enforcement:
 *
 *   - `.dependency-cruiser.cjs` limits `state/` and `ui/` to their
 *     own trees plus `application/` and `domain/`, so a direct
 *     `import '../persistence/deck-file/schema-v2'` would be an
 *     allowlist violation anyway. This barrel is the CANONICAL way
 *     to reach the persistence API — a rewrite of the internals is
 *     invisible to consumers.
 *
 * ## Public surface (S18 update)
 *
 *   type DeckFile, DeckFileV1, DeckFileV2, DeckFileMeta,
 *        DownloadDeckFileOptions, SerializeOptions,
 *        DeckFileErrorCode, DeserializeResult
 *   const STORAGE_KEY, SCHEMA_V2_VERSION
 *   class DeckFileError
 *   fn    serialize      // v2 by default (S18 AC10)
 *   fn    deserialize    // dispatches across schema 1 / 2 (S18)
 *   fn    saveDesignToLocalStorage, loadDesignFromLocalStorage,
 *         clearDesignFromLocalStorage
 *   fn    downloadDeckFile, readDeckFile
 */
export type {
  DeckFile,
  DeckFileV1,
  DeckFileV2,
  DeckFileMeta,
  SerializeOptions,
} from './deck-file/envelope-types';
export { SCHEMA_V2_VERSION } from './deck-file/envelope-types';
export type { DeserializeResult } from './deck-file/schema-v2';
export { serialize, deserialize } from './deck-file/schema-v2';

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

export { captureCanvasPng, downloadCanvasScreenshot } from './screenshot';
