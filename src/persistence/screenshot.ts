/**
 * `src/persistence/screenshot.ts` — S14 issue #15 AC10 adapter.
 *
 * ## Responsibility (single)
 *
 * Two pure adapter functions for browser-side canvas → PNG:
 *
 *   1. `captureCanvasPng(canvas)` — read the pixels of a WebGL
 *      canvas and return a `data:image/png;base64,…` URL.
 *   2. `downloadCanvasScreenshot(canvas, filename)` — capture +
 *      trigger a browser download with the given filename.
 *
 * Both throw `DeckFileError` with the new `'canvas-empty'` code
 * when the canvas has zero width or height (the S14 §4 edge case:
 * "PNG export when the canvas has zero size (window minimized) →
 * shows an error toast"). That maps to the same discriminated-
 * error surface every other persistence I/O uses, so the ui layer
 * pattern-matches the failure the same way it does DeckFileError
 * code=file-too-large.
 *
 * ## Why this lives in persistence/, not ui/ or scene/
 *
 * - It touches `HTMLCanvasElement.toDataURL` (a DOM API) and
 *   `URL.createObjectURL` + anchor.click (browser-download hack).
 *   Every DOM-touching module in wooddeck lives under
 *   `src/persistence/` — the layer whose ONE JOB is browser-API
 *   adaptation.
 * - The ui layer is boundary-forbidden from importing persistence
 *   directly. UI reaches this function through the design-store
 *   action `exportScreenshot(canvas)`, which delegates through
 *   `application/screenshot.ts`. See `.dependency-cruiser.cjs`
 *   `ui-allowlist` + BLOCK-2t.
 *
 * ## preserveDrawingBuffer prerequisite
 *
 * `HTMLCanvasElement.toDataURL('image/png')` reads the FRONT
 * buffer of the WebGL context. By default, the browser CLEARS the
 * front buffer after every compositing pass — so an unmodified
 * r3f `<Canvas>` returns a fully-transparent PNG (
 * `data:image/png;base64,iVBORw…` with all zero alpha). The fix is
 * to construct the WebGL context with `preserveDrawingBuffer:
 * true`, which is applied in `src/scene/DeckScene.tsx` via the
 * r3f `<Canvas gl={{preserveDrawingBuffer: true}}>` prop. This
 * module ASSUMES that prop is set — the caller is responsible for
 * wiring the scene correctly. See the S14 ticket §15 risk note.
 *
 * ## Boundary
 *
 * Imports only:
 *   - `./deck-file/errors` — DeckFileError value class.
 *
 * No React, no three, no state. Every function here is a leaf that
 * takes a DOM element in and returns a string / triggers a
 * download — no hidden state.
 */
import { DeckFileError } from './deck-file/errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * MIME type for the exported image. PNG is chosen (over JPEG /
 * WebP) because:
 *   - Lossless — the deck rendering has sharp edges (framing
 *     lines) that JPEG blurs.
 *   - Alpha channel — a transparent background is a common ask
 *     for design-review overlays.
 *   - Universal browser support for `toDataURL('image/png')`.
 */
const SCREENSHOT_MIME = 'image/png';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture the current pixels of a canvas as a base64 data URL.
 *
 * @param canvas The WebGL canvas element to snapshot. MUST have
 *   been created with `preserveDrawingBuffer: true` on its GL
 *   context — otherwise the returned image is transparent /
 *   empty. See the module header for the r3f wiring.
 * @returns A `data:image/png;base64,…` string.
 * @throws {DeckFileError} code=`'canvas-empty'` when the canvas
 *   has zero width or height (e.g. window minimized, panel
 *   hidden, mount race). Rejecting early here is the fail-fast
 *   equivalent of `readDeckFile`'s size check — a downstream
 *   download of an empty PNG would silently hand the user a
 *   useless file.
 */
export function captureCanvasPng(canvas: HTMLCanvasElement): string {
  if (canvas.width === 0 || canvas.height === 0) {
    throw new DeckFileError(
      'canvas-empty',
      `PNG export failed: canvas has zero size (${String(canvas.width)}×${String(canvas.height)}).`,
    );
  }
  // toDataURL synchronously reads the front buffer. Under jsdom
  // this returns a stub `data:` URL (no actual GL context); under
  // a real browser this is the true PNG-encoded snapshot.
  return canvas.toDataURL(SCREENSHOT_MIME);
}

/**
 * Capture a canvas + trigger a browser download in one step.
 *
 * Uses the same anchor-click pattern as `downloadDeckFile` in
 * `file-io.ts`: create a temporary `<a href download>`, click it,
 * remove it. The `try/finally` guarantees the anchor is
 * un-appended and the object URL is revoked even if `.click()`
 * throws — belt-and-suspenders resource cleanup matching the
 * existing file-io convention.
 *
 * @param canvas   The canvas to snapshot (same requirements as
 *                 {@link captureCanvasPng}).
 * @param filename The download filename (e.g.
 *                 `wooddeck-2024-01-01T00-00-00.png`). Caller
 *                 controls generation — this function does not
 *                 read the clock so it stays deterministic /
 *                 testable.
 * @throws {DeckFileError} code=`'canvas-empty'` via
 *   {@link captureCanvasPng}.
 */
export function downloadCanvasScreenshot(canvas: HTMLCanvasElement, filename: string): void {
  const dataUrl = captureCanvasPng(canvas);
  // A data: URL doesn't need URL.createObjectURL — we can point
  // the anchor.href directly at it. Simpler than the Blob path in
  // file-io.ts because we already HAVE a base64 payload.
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = filename;
    // Defensive: some browsers (older Firefox) require the anchor
    // to be attached to the DOM for .click() to fire.
    anchor.style.display = 'none';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    if (anchor?.parentNode !== null && anchor !== undefined) {
      anchor.parentNode.removeChild(anchor);
    }
    // No URL.revokeObjectURL — we never created an object URL.
    // The data: URL is garbage-collected with the anchor.
  }
}
