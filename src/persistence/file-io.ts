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
 *     edge cases. Any File larger than that is rejected with a
 *     DeckFileError BEFORE any FileReader byte is read.
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
 * matters — size check FIRST (cheap, bounds resource use), then
 * text read (bounded now that size is checked), then
 * `deserialize` (which layers JSON + schema validation).
 */
import type { DeckDesign } from '../domain/model';

import { DeckFileError } from './deck-file/errors';
import { deserialize, serialize } from './deck-file/schema-v1';

// ---------------------------------------------------------------------------
// Constants — filename & size caps
// ---------------------------------------------------------------------------

/**
 * Frozen regex from ticket AC9. Every generated filename is
 * verified against this in the test suite; a rewrite MUST NOT drift.
 */
const DOWNLOAD_FILENAME_PATTERN = /^wooddeck-\d{8}T\d{6}\.deck\.json$/;

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
   * Reserved for future use. Currently IGNORED — the download
   * filename is always generated from the UTC clock. See the module
   * header (Security) for the rationale.
   */
  readonly filename?: string;
}

/**
 * Trigger a browser download containing the serialized `.deck` v1
 * envelope. Constructs a Blob, allocates a temporary object URL,
 * synthesizes an anchor element with `download=<generated>`, clicks
 * it, and revokes the URL.
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
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // `rel=noopener` is defensive: even though `download` prevents
    // navigation, we cannot rely on every browser behaving
    // identically. `noopener` ensures no cross-window relationship.
    anchor.rel = 'noopener';
    // Style hidden — we do NOT append to document.body in every
    // browser; some (older Firefox) require the element to be in the
    // DOM for `.click()` to work. Append then remove to be safe.
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // Always release the object URL, even if `click` throws — a leak
    // would accumulate blob URLs indefinitely for a user with a
    // flaky browser.
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
 * @throws DeckFileError code=`'schema-validation-failed'` when the
 *         File exceeds `MAX_UPLOAD_BYTES` (DoS defence) OR when the
 *         JSON payload does not match the v1 schema. (The former is
 *         classified as a validation failure because oversize is a
 *         shape violation of the format — there is no separate code
 *         in the ticket's DeckFileErrorCode union.)
 * @throws DeckFileError code=`'invalid-json'` on JSON parse errors.
 * @throws DeckFileError code=`'unknown-schema'` when the envelope
 *         declares a version this build cannot understand.
 */
export async function readDeckFile(file: File): Promise<DeckDesign> {
  if (file.size > MAX_UPLOAD_BYTES) {
    // Fail fast without reading a byte. Reject with
    // schema-validation-failed because that is the closest of the
    // five permitted DeckFileErrorCode values — the alternative is a
    // ticket-scope addition (`'file-too-large'`), which is out of
    // scope for S6.
    throw new DeckFileError(
      'schema-validation-failed',
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
 * Produce a filename matching `DOWNLOAD_FILENAME_PATTERN`.
 *
 * The stamp is derived from `new Date()` — deterministic ordering
 * across a user's downloads. Two calls in the same second collide
 * (both produce the same filename); the OS decides whether to append
 * a suffix. That is acceptable per the ticket's AC9 (the regex is
 * about SHAPE, not uniqueness).
 */
function generateDownloadFilename(): string {
  const now = new Date();
  const y = String(now.getUTCFullYear()).padStart(4, '0');
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  const filename = `wooddeck-${y}${mo}${d}T${h}${mi}${s}.deck.json`;
  // Belt + suspenders: if a future refactor breaks the shape, catch
  // it here rather than at the download prompt. The pattern is the
  // single source of truth.
  if (!DOWNLOAD_FILENAME_PATTERN.test(filename)) {
    // Should be unreachable — throw so a broken rewrite is loud.
    throw new Error(
      `Internal error: generated filename '${filename}' does not match the frozen pattern`,
    );
  }
  return filename;
}

/**
 * Read a File as UTF-8 text, wrapping the callback-based FileReader
 * API in a Promise. Uses FileReader (not `file.text()`) because
 * `File.prototype.text()` was added in a later era than the browser
 * baseline we support (though wooddeck targets modern only, jsdom
 * implements it — we could switch later; kept as FileReader for
 * defensive parity with older browsers).
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
      reject(
        new DeckFileError('invalid-json', 'FileReader returned non-string content', result),
      );
    };
    reader.onerror = (): void => {
      reject(
        new DeckFileError(
          'invalid-json',
          `failed to read .deck file: ${reader.error?.message ?? 'unknown FileReader error'}`,
          reader.error,
        ),
      );
    };
    reader.readAsText(file);
  });
}
