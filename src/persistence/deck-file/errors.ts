/**
 * `src/persistence/deck-file/errors.ts` — the single error class
 * surfaced by every public API in `src/persistence/**`.
 *
 * ## Contract (frozen — issue #7 §2)
 *
 * Every failure path in the persistence layer — serialize, deserialize,
 * validator, localStorage adapter, file I/O — throws a `DeckFileError`
 * carrying a stable string `.code`. Consumers pattern-match on the code
 * (never on the message text) to render user-facing UX. The message is
 * for developer diagnostics and MUST NOT contain PII / paths / stack
 * fragments (ticket §6 Security).
 *
 * ## Why a single error class, not one per module
 *
 * Consumers (`src/state/`, `src/ui/`) need ONE type to catch. A single
 * `DeckFileError` with a discriminated `.code` gives a uniform surface
 * without proliferating class hierarchies for what are essentially
 * enum values. The seven codes below are the entire enum — expansion
 * requires an API-contract change (ticket revision).
 *
 * ## Why `extends Error` with an explicit `.name` set
 *
 * ES2022 `Error` subclasses set `.name` to `"Error"` unless the
 * subclass constructor overrides it. Without the override, dev-tool
 * stack traces render as `Error: unsupported .deck schema…`, which
 * obscures the fact that a specific typed error was thrown. Setting
 * `this.name = 'DeckFileError'` fixes the trace attribution.
 */

/**
 * The exhaustive set of `.code` values a `DeckFileError` may carry.
 * Ordered by call-site frequency (invalid-json / schema-validation
 * dominate the load path).
 *
 *   - `'invalid-json'` — `JSON.parse` failed on the input string.
 *   - `'schema-validation-failed'` — JSON parsed but did not match
 *     `docs/deck-file-schema-v1.json`. Message identifies the offending
 *     field (e.g. `"design.footprint: required"`).
 *   - `'unknown-schema'` — the envelope's `schema` value is not one
 *     this build understands. Message includes the received value.
 *   - `'file-too-large'` — an uploaded File exceeded the 10 MB DoS
 *     cap. Distinguished from `schema-validation-failed` so consumers
 *     can render an accurate UX ("this file is too large" vs "this
 *     file is corrupted"). Introduced in PR#26 pair-fix iteration 1
 *     after Code Review GPT#2 and Opus#1 found the previous mapping
 *     misleading (validation never ran on an oversized file).
 *   - `'file-read-failed'` — `FileReader` fired `.onerror` — the
 *     browser could not read the file bytes (permissions, network
 *     drive I/O error, unplugged USB). Distinguished from
 *     `invalid-json` for the same reason: nothing was parsed.
 *   - `'storage-full'` — `localStorage.setItem` threw
 *     `QuotaExceededError`. Caller UX may prompt the user to download
 *     the design before further edits (S8 + S14).
 *   - `'storage-blocked'` — `localStorage` is unavailable or setItem
 *     threw a `SecurityError` (private browsing on some engines).
 *     Caller UX disables autosave and surfaces a banner.
 *   - `'canvas-empty'` — the WebGL canvas passed to
 *     `screenshot.captureCanvasPng` had zero width or height (window
 *     minimized, panel hidden, mount race). S14 issue #15 AC10 edge
 *     case: the caller UX surfaces a toast instead of downloading a
 *     transparent PNG. Reuses the persistence-error surface so
 *     `ui`/`state` can pattern-match with the same `instanceof
 *     DeckFileError` idiom they use for storage/file failures.
 */
export type DeckFileErrorCode =
  | 'invalid-json'
  | 'schema-validation-failed'
  | 'unknown-schema'
  | 'file-too-large'
  | 'file-read-failed'
  | 'storage-full'
  | 'storage-blocked'
  | 'canvas-empty';

/**
 * Typed error thrown by every public function in `src/persistence/**`.
 *
 * @example
 * ```ts
 * try {
 *   const design = await readDeckFile(file);
 * } catch (err) {
 *   if (err instanceof DeckFileError) {
 *     switch (err.code) {
 *       case 'invalid-json': return showBanner('Not a .deck file.');
 *       case 'schema-validation-failed': return showBanner('Corrupted .deck file.');
 *       case 'unknown-schema': return showBanner('This file was made by a newer wooddeck.');
 *       // storage-* cannot come from readDeckFile — TS narrows here.
 *     }
 *   }
 *   throw err;
 * }
 * ```
 */
export class DeckFileError extends Error {
  /** Stable discriminator — safe to switch on in UI code. */
  public readonly code: DeckFileErrorCode;

  /**
   * @param code Stable discriminator (see `DeckFileErrorCode`).
   * @param message Developer-facing diagnostic — must NOT contain PII
   *                or filesystem paths. Safe to log server-side.
   * @param cause Optional underlying error (native `SyntaxError`,
   *              `QuotaExceededError`, etc.) for chained diagnostics.
   */
  public constructor(code: DeckFileErrorCode, message: string, cause?: unknown) {
    // Standard Error constructor supports { cause } since ES2022.
    // Passing it via options keeps the native inspection format.
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'DeckFileError';
    this.code = code;
  }
}
