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
 *           `console.error()` with the wooddeck-scoped prefix
 *           + flips the ui-store `webglContextLost` flag,
 *       (3) the returned cleanup removes the listener.
 *
 * ## User-facing surfacing (S12 pair-fix iter 1 — Fix C)
 *
 * S9 promised "UI banner shows '3D view crashed — please reload.'"
 * (§5) but left the surfacing wiring for S12. This module now
 * writes to `useUiStore.getState().setWebglContextLost(true)` when
 * the event fires — S12's `<ContextLostBanner>` reads that flag
 * and renders the user-facing message with a Reload button.
 *
 * ## Boundary
 *
 * Scene → state is an allowed dep-cruiser channel (scene already
 * reads state via the granular hooks; writing an ORTHOGONAL
 * surface via `useUiStore.getState()` follows the same channel).
 * The console.error is retained as a developer-side diagnostic
 * that's easy to grep for in production log aggregation.
 */

import { useUiStore } from '../state';

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
 * The listener:
 *
 *   1. Calls `event.preventDefault()` (per the WebGL spec —
 *      required to enable the paired `webglcontextrestored` event).
 *   2. Logs a wooddeck-scoped diagnostic to `console.error` so ops
 *      can grep it in production log aggregation.
 *   3. Flips `useUiStore.getState().setWebglContextLost(true)` so
 *      S12's `<ContextLostBanner>` can surface a user-facing
 *      "3D view crashed — please reload" message.
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
    // S12 pair-fix iter 1 — Fix C. Reach into the store via
    // getState() rather than a subscription: this is a
    // fire-and-forget WRITE from a DOM event handler that is not
    // a React component, so there's no hook to call. The store
    // action is idempotent (setting `true` twice is a no-op).
    useUiStore.getState().setWebglContextLost(true);
  };
  gl.domElement.addEventListener('webglcontextlost', handler, { passive: false });
  return () => {
    gl.domElement.removeEventListener('webglcontextlost', handler);
  };
}
