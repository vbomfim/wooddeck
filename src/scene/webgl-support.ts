/**
 * `src/scene/webgl-support.ts` — WebGL 2 feature detection.
 *
 * ## Why we detect at all
 *
 * three.js `WebGLRenderer` used with r3f defaults expects WebGL 2 for
 * feature parity (uniform buffer objects, sample-count MSAA, etc.).
 * On WebGL 1-only browsers r3f will throw at Canvas mount time —
 * the AC5 fallback catches that BEFORE the Canvas ever tries to
 * initialise, giving the user an actionable message instead of a
 * crash.
 *
 * ## Dependency-injection shape (testability)
 *
 * The function accepts an optional `createCanvas` factory so tests
 * can substitute a canvas whose `getContext` returns either a
 * truthy stub (positive path) or `null` (negative path). Real
 * runtime callers pass no argument — the default factory calls
 * `document.createElement('canvas')`. Wrapping the `document`
 * access in the factory (rather than at module import) makes the
 * module SSR-safe: an accidental import from a Node-only context
 * won't throw at load.
 *
 * ## Why the try/catch is broad
 *
 * Safari's "Disable WebGL" preference makes `getContext('webgl2')`
 * THROW `SecurityError`; other browsers just return `null`. We
 * catch both by wrapping the entire probe in a `try` and returning
 * `false` on any failure — the failure mode is identical (no GL →
 * render fallback), so a discriminating branch would be dead code.
 */

/**
 * Minimal contract we require from the injected canvas — just the
 * `getContext` method. Structurally compatible with `HTMLCanvasElement`.
 */
interface WebGLProbeCanvas {
  readonly getContext: (contextId: string) => unknown;
}

/**
 * Default factory — creates a real DOM canvas via `document`. Wrapped
 * in a function (not eagerly evaluated) so the module load doesn't
 * touch `document` on SSR / worker contexts.
 */
function defaultCanvasFactory(): WebGLProbeCanvas {
  return document.createElement('canvas');
}

/**
 * `true` when the current environment can create a WebGL 2 context.
 *
 * @param createCanvas  optional canvas factory — omit in production;
 *                      inject a stub in unit tests to exercise the
 *                      positive / negative branches without needing
 *                      a real GL implementation.
 */
export function isWebGL2Available(
  createCanvas: () => WebGLProbeCanvas = defaultCanvasFactory,
): boolean {
  try {
    const canvas = createCanvas();
    return canvas.getContext('webgl2') != null;
  } catch {
    // Any throw — from the factory (no document), the canvas
    // (SecurityError), or a browser bug — falls through to the AC5
    // fallback rendering path.
    return false;
  }
}
