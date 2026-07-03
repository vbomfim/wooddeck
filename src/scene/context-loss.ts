/**
 * `src/scene/context-loss.ts` — WebGL context-loss diagnostic hook.
 *
 * ## Why this is a separate module (PR#29 pair-fix iter 1 — Fix H)
 *
 * The original S9 wired the `webglcontextlost` listener inline
 * inside `<DeckScene>`'s `<Canvas onCreated>` callback. That made
 * the listener untestable in jsdom — the mocked `<Canvas>` never
 * fires `onCreated`, so a broken handler could ship silently.
 *
 * Extracting to a pure function with a `WebGLRenderer`-shaped
 * argument decouples the diagnostic from the Canvas mount:
 *
 *   - `DeckScene`'s `onCreated` calls this function once per mount.
 *   - The tests exercise the function directly with a fake `gl`
 *     stand-in (any object exposing `domElement`) and assert:
 *       (1) the listener is registered on the correct element,
 *       (2) firing the event calls `preventDefault()` +
 *           `console.error()` with the wooddeck-scoped prefix,
 *       (3) the returned cleanup removes the listener.
 *
 * ## Why NO UI banner here (§5 / S12 boundary)
 *
 * Turning a context-loss into a user-facing "3D view crashed —
 * please reload" banner is the AppShell's job (S12 — banner
 * surfacing lives with the other storage/error banners in the
 * ui-store). This module ONLY drops a diagnostic into the ops /
 * developer console. S12 will layer a Zustand `setStorageBanner`
 * (or new `setContextLossBanner`) call on top when it lands.
 */

/**
 * Minimal contract required from the WebGL renderer — just the
 * `domElement` the `webglcontextlost` event dispatches on.
 * Structurally compatible with `THREE.WebGLRenderer` (which is
 * what the r3f `<Canvas onCreated={({ gl }) => …}>` callback
 * hands us) but doesn't require the full type surface — this keeps
 * the tests free of a real `three` dependency for the fake `gl`.
 */
export interface ContextLossTarget {
  readonly domElement: EventTarget;
}

/**
 * Registers a `webglcontextlost` listener on the renderer's canvas.
 * The listener calls `event.preventDefault()` (per the WebGL spec —
 * required to enable the paired `webglcontextrestored` event) and
 * logs a wooddeck-scoped diagnostic to the console so ops can
 * grep it in production log aggregation.
 *
 * @param gl  the WebGL renderer (or any object exposing
 *            `domElement` — the fake used in the tests).
 * @returns   a cleanup function that removes the listener. Callers
 *            (typically the `<DeckScene>` `useEffect`) invoke this
 *            on unmount to avoid a leaked event handler.
 */
export function installContextLossHandler(gl: ContextLossTarget): () => void {
  const handler = (event: Event): void => {
    // Per the WebGL spec, preventDefault MUST be called on
    // webglcontextlost to enable the browser to fire the paired
    // webglcontextrestored event later — without it, the context
    // is gone for the lifetime of the page.
    event.preventDefault();
    console.error(
      '[wooddeck:scene] WebGL context lost — the 3D viewer needs to reload.',
    );
  };
  gl.domElement.addEventListener('webglcontextlost', handler, { passive: false });
  return () => {
    gl.domElement.removeEventListener('webglcontextlost', handler);
  };
}
