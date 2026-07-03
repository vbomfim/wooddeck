/**
 * `src/ui/export-menu-helpers.ts` — data + pure helpers for
 * `ExportMenu.tsx`.
 *
 * Kept in a separate file so `ExportMenu.tsx` can stay
 * "components-only" (fast-refresh HMR rule) and so tests can
 * exercise the helpers without mounting the panel.
 */

/**
 * The CSS class DeckScene puts on its `<canvas>` element. See
 * `src/scene/DeckScene.tsx` `WOODDECK_CANVAS_CLASSNAME` — this
 * literal is duplicated (not imported) because the ui layer is
 * boundary-forbidden from importing `scene/` (BLOCK-2d). Any
 * change to the class MUST update both places.
 */
export const CANVAS_SELECTOR = 'canvas.wooddeck-canvas';

/**
 * Frozen confirm-dialog message for the Reset button. Extracted
 * so tests can spy on the `window.confirm` argument without
 * duplicating the copy.
 */
export const RESET_CONFIRM_TEXT =
  'Reset to default deck? Your current design will be replaced.';

/**
 * Frozen error message when `findCanvas()` returns null (the
 * scene chunk hasn't mounted, or the class went missing). A
 * different failure mode than `'canvas-empty'` — which comes back
 * from the store when the element exists but has zero size.
 */
export const CANVAS_MISSING_MESSAGE =
  'Could not find the 3D view canvas. Try reloading the page.';

/**
 * Build the PNG filename from a UTC timestamp. Format:
 * `wooddeck-YYYY-MM-DDTHH-MM-SS.png`. Colons in ISO-8601 are
 * illegal on Windows filenames, so we replace them with hyphens.
 */
export function buildPngFilename(nowMs: number): string {
  const iso = new Date(nowMs).toISOString();
  // `2024-05-01T14:23:07.129Z` → `wooddeck-2024-05-01T14-23-07.png`
  const stamp = iso.slice(0, 19).replace(/:/g, '-');
  return `wooddeck-${stamp}.png`;
}
