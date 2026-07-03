/**
 * `src/persistence/file-io.ts` — browser-side download / upload
 * adapter for `.deck` files.
 *
 * ## Interface (frozen — issue #7 §2)
 *
 *   - `downloadDeckFile(design, opts?)` — sync, triggers a browser
 *     download via a Blob + anchor click.
 *   - `readDeckFile(file): Promise<DeckDesign>` — async, parses +
 *     validates the uploaded File.
 *
 * ## Security posture (issue #7 §6)
 *
 *   - **Filename is ALWAYS generated** from the current UTC clock;
 *     `opts.filename` is present in the signature for API stability
 *     but is INTENTIONALLY IGNORED — the ticket explicitly forbids
 *     deriving the filename from user input (path traversal / RTL
 *     override / etc.). The generated shape matches AC9's frozen
 *     regex: `^wooddeck-\d{8}T\d{6}\.deck\.json$`.
 *   - **10 MB size cap on uploads** — DoS defence per ticket §4
 *     edge cases. Any File larger than that is rejected with
 *     `DeckFileError code:"file-too-large"` BEFORE any FileReader
 *     byte is read (see PR#26 pair-fix iter 1 — Code Review GPT#2 /
 *     Opus#1: distinguishing this from schema-validation-failed lets
 *     consumers render a truthful UX).
 *   - **Validation before typing** — `readDeckFile` never merges the
 *     parsed payload into another object; it hands the raw string to
 *     `deserialize`, which runs the Ajv schema check. Prototype
 *     pollution is impossible on the load path.
 *   - **No `eval` / no `innerHTML`** — the parsed design is returned
 *     as a plain typed value; it never touches HTML.
 *
 * ## Trust boundary
 *
 * `readDeckFile` is a boundary function: it accepts an untrusted
 * `File` from a user-triggered `<input type="file">`. The order
 * matters — size check FIRST (cheap, bounds resource use; no
 * FileReader byte is issued until size is proven ≤ cap), then
 * text read (bounded now that size is checked), then
 * `deserialize` (which layers JSON + schema validation).
 */
import type { DeckDesign } from '../domain/model';

import { DeckFileError } from './deck-file/errors';
import { deserialize, serialize } from './deck-file/schema-v1';

// ---------------------------------------------------------------------------
// Constants — filename & size caps
// ---------------------------------------------------------------------------

// The frozen download-filename pattern is asserted in the test file
// (`file-io.test.ts`'s `FILENAME_PATTERN`); the generator here builds
// a string that structurally satisfies it via `String().padStart`
// (Security#3 hygiene — the previous belt-and-suspenders `test()`
// self-check was removed as unreachable).

/**
 * DoS defence — any upload above this size is rejected without
 * being read. 10 MB is generous for a JSON deck (typical file is
 * < 20 KB) while remaining small enough that a hostile allocation
 * can't OOM the tab.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * MIME type stamped on the Blob. `application/json` is the correct
 * IANA type for a JSON payload; browsers use it to choose default
 * "Open with" applications.
 */
const DOWNLOAD_MIME = 'application/json';

// ---------------------------------------------------------------------------
// Public API — download
// ---------------------------------------------------------------------------

/**
 * Options for `downloadDeckFile`. Present for API stability; the
 * ONLY field, `filename`, is currently IGNORED for security.
 */
export interface DownloadDeckFileOptions {
  /**
   * @deprecated Currently ignored — reserved for a future sanitized-preset
   * override. The download filename is always generated from the UTC
   * clock; see the module header (Security) for the rationale. IDEs
   * will strike this through so callers know the value they pass is
   * discarded.
   */
  readonly filename?: string;
}

/**
 * Trigger a browser download containing the serialized `.deck` v1
 * envelope. Constructs a Blob, allocates a temporary object URL,
 * synthesizes an anchor element with `download=<generated>`, clicks
 * it, and revokes the URL. Cleanup (removing the temp anchor and
 * revoking the object URL) runs in a `finally` block so a throwing
 * `.click()` implementation cannot leak either resource
 * (Code Review Opus#5).
 */
export function downloadDeckFile(
  design: DeckDesign,
  _opts: DownloadDeckFileOptions = {},
): void {
  // `_opts.filename` is intentionally ignored — see module header.
  const filename = generateDownloadFilename();
  const payload = serialize(design);
  const blob = new Blob([payload], { type: DOWNLOAD_MIME });
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // `rel=noopener` is defensive: even though `download` prevents
    // navigation, we cannot rely on every browser behaving
    // identically. `noopener` ensures no cross-window relationship.
    anchor.rel = 'noopener';
    // Style hidden — some browsers (older Firefox) require the
    // element to be in the DOM for `.click()` to work. Appending here
    // then removing in `finally` is the safe pattern.
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    // Cleanup MUST happen even if `click()` throws — otherwise a
    // hostile / flaky browser could leak both the anchor and the
    // object URL indefinitely.
    if (anchor?.parentNode !== null && anchor !== undefined) {
      anchor.parentNode.removeChild(anchor);
    }
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Public API — upload
// ---------------------------------------------------------------------------

/**
 * Parse + validate an uploaded `.deck` File. Resolves to the
 * `DeckDesign` payload on success; rejects with a `DeckFileError`
 * on any failure.
 *
 * Failure codes (see `DeckFileErrorCode`):
 *
 * @throws DeckFileError code=`'file-too-large'` when the File exceeds
 *         `MAX_UPLOAD_BYTES` (DoS defence). Fires BEFORE FileReader
 *         issues any read — verified by unit test G5.
 * @throws DeckFileError code=`'file-read-failed'` when FileReader
 *         emits `onerror` (permissions, network drive, unplugged
 *         media). Nothing was parsed.
 * @throws DeckFileError code=`'invalid-json'` on JSON parse errors
 *         (surfaces from `deserialize`).
 * @throws DeckFileError code=`'schema-validation-failed'` when the
 *         payload's JSON structure does not match v1.
 * @throws DeckFileError code=`'unknown-schema'` when the envelope
 *         declares a version this build cannot understand.
 */
export async function readDeckFile(file: File): Promise<DeckDesign> {
  if (file.size > MAX_UPLOAD_BYTES) {
    // Fail fast without reading a byte. `file-too-large` is the
    // dedicated code so the UI can render a truthful error message
    // ("This file is too large") rather than the misleading
    // `schema-validation-failed` (validation never ran).
    throw new DeckFileError(
      'file-too-large',
      `.deck file rejected: ${String(file.size)} bytes exceeds the ${String(MAX_UPLOAD_BYTES)}-byte DoS cap`,
    );
  }
  const text = await readFileAsText(file);
  return deserialize(text).design;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Produce a filename matching `/^wooddeck-\d{8}T\d{6}\.deck\.json$/`.
 *
 * The stamp is derived from `new Date()` — deterministic ordering
 * across a user's downloads. Two calls in the same second collide
 * (both produce the same filename); the OS decides whether to append
 * a suffix. That is acceptable per the ticket's AC9 (the regex is
 * about SHAPE, not uniqueness).
 *
 * The template literal below is structurally guaranteed to match
 * the frozen pattern — each part is a padded `String()` of a
 * numeric value, so no runtime "belt and suspenders" self-check is
 * needed (Security#3 hygiene: dead branch removed). The AC9 unit
 * test asserts on the shape.
 */
function generateDownloadFilename(): string {
  const now = new Date();
  const y = String(now.getUTCFullYear()).padStart(4, '0');
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  return `wooddeck-${y}${mo}${d}T${h}${mi}${s}.deck.json`;
}

/**
 * Read a File as UTF-8 text, wrapping the callback-based FileReader
 * API in a Promise. Uses FileReader (not `file.text()`) because
 * `File.prototype.text()` was added in a later era than the browser
 * baseline we support (though wooddeck targets modern only, jsdom
 * implements it — we could switch later; kept as FileReader for
 * defensive parity with older browsers).
 *
 * Failure modes surface via `DeckFileError`:
 *   - `onerror` → `'file-read-failed'` (browser couldn't read bytes)
 *   - non-string `.result` → `'file-read-failed'` (FileReader was
 *     misused — should never occur since we call `readAsText`, but
 *     the branch exists as a defensive guard).
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
        return;
      }
      // Defensive — `readAsText` always yields a string. If we ever
      // switch to `readAsArrayBuffer` this branch would fire.
      reject(
        new DeckFileError(
          'file-read-failed',
          'FileReader returned non-string content (expected UTF-8 text)',
          result,
        ),
      );
    };
    reader.onerror = (): void => {
      reject(
        new DeckFileError(
          'file-read-failed',
          `failed to read .deck file: ${reader.error?.message ?? 'unknown FileReader error'}`,
          reader.error,
        ),
      );
    };
    reader.readAsText(file);
  });
}
