/**
 * `src/application/screenshot.ts` — the S14 PNG export use-case.
 *
 * ## Same wrapper shape as `./save-design.ts`
 *
 * This module is a thin pass-through to the persistence adapter,
 * mirroring the `downloadDesign` / `saveDesignToLocalStorage`
 * shape in `./save-design.ts`. The rationale is documented there
 * — briefly:
 *
 *   1. **Uniform application layer** — every browser-side I/O
 *      flows through `src/application/**`, so the state store
 *      never takes a direct edge on `src/persistence/**`.
 *   2. **Future concerns bolt on cleanly** — a canvas-resolution
 *      upscale, a redaction pass, or a telemetry event all belong
 *      here rather than in the DOM adapter.
 *
 * ## Line budget
 *
 * `exportCanvasScreenshot` is 1 line. Same as `downloadDesign`.
 *
 * ## Error contract
 *
 * Propagates `DeckFileError` (code `'canvas-empty'`) UNCHANGED
 * from the persistence adapter. Consumers (the design-store
 * action) catch it and route to the ui-store banner surface.
 *
 * ## Boundary
 *
 * Imports:
 *   - `../persistence` — the adapter under wrap.
 *
 * NO React, NO DOM, NO state. Same rule as `./save-design.ts`.
 */

import { downloadCanvasScreenshot as persistenceDownloadCanvasScreenshot } from '../persistence';

/**
 * Trigger a browser download of the current canvas contents as a
 * PNG file. Delegated to the persistence adapter. The caller
 * generates the filename (typically
 * `wooddeck-{timestamp}.png`).
 *
 * @param canvas   The WebGL canvas element to snapshot.
 * @param filename The download filename.
 * @throws {DeckFileError} code=`'canvas-empty'` propagated from
 *   the persistence layer when the canvas has zero size.
 */
export function exportCanvasScreenshot(canvas: HTMLCanvasElement, filename: string): void {
  persistenceDownloadCanvasScreenshot(canvas, filename);
}
