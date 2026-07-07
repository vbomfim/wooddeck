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
 *   - `DeckScene`'s `onCreated` calls `reinstallContextLossHandler`
 *     once per mount (see below for the StrictMode rationale).
 *   - The tests exercise the function directly with a fake `gl`
 *     stand-in (any object exposing `domElement`) and assert:
 *       (1) both `webglcontextlost` and `webglcontextrestored`
 *           listeners are registered on the correct element,
 *       (2) firing `webglcontextlost` calls `preventDefault()` +
 *           `console.error()` with the wooddeck-scoped prefix
 *           + flips the ui-store `webglContextLost` flag to true,
 *       (3) firing `webglcontextrestored` flips the flag back
 *           to false (so the banner clears when the GPU driver
 *           hands back a fresh context — required for both real
 *           GPU-loss recovery AND the StrictMode dev-mode double-
 *           mount scenario below),
 *       (4) the returned cleanup removes BOTH listeners.
 *
 * ## User-facing surfacing (S12 pair-fix iter 1 — Fix C)
 *
 * S9 promised "UI banner shows '3D view crashed — please reload.'"
 * (§5) but left the surfacing wiring for S12. This module writes
 * to `useUiStore.getState().setWebglContextLost(true)` when the
 * loss event fires — S12's `<ContextLostBanner>` reads that flag
 * and renders the user-facing message with a Reload button.
 * `setWebglContextLost(false)` is fired on both the paired
 * `webglcontextrestored` event AND from
 * `reinstallContextLossHandler` when a fresh live context is
 * created — the latter is the S14 UAT fix (see below).
 *
 * ## StrictMode remount safety (S14 UAT pair-fix)
 *
 * Root cause diagnosed on a live M4 Pro (real GPU, NOT
 * swiftshader): React StrictMode's dev-only double-mount disposes
 * the FIRST r3f renderer, which calls
 * `WEBGL_lose_context.loseContext()` on the shared canvas. That
 * QUEUES a `webglcontextlost` event on the canvas DOM element.
 * By the time the browser dispatches the event (asynchronously,
 * a few hundred ms later per M4 Pro measurements), the second
 * mount has already installed a fresh listener on the SAME
 * canvas element (React reuses it across StrictMode remounts).
 * The fresh listener catches the queued STALE event and latches
 * `webglContextLost=true`, even though renderer2 is running
 * happily.
 *
 * We defend with a startup grace window: for the first
 * `STARTUP_GRACE_MS` after `installContextLossHandler` runs, any
 * `webglcontextlost` event on the target is treated as a
 * StrictMode ghost and IGNORED (the browser can't lose context
 * that fast in the real world — a GPU-driver crash-and-recover
 * cycle takes minimum ~1s, and forced-loss via WEBGL_lose_context
 * from a disposed renderer is the only realistic sub-second
 * source). This is dev-only ergonomics: in prod, StrictMode
 * doesn't double-mount and the grace window is invisible.
 *
 * Two additional fixes accompany the grace window:
 *
 *   1. `installContextLossHandler` also listens for
 *      `webglcontextrestored` and clears the flag, so a
 *      GENUINE prod-mode GPU loss+restore cycle now clears the
 *      banner automatically.
 *   2. `<DeckScene>`'s `onCreated` uses
 *      `reinstallContextLossHandler` instead of the raw
 *      installer, so if a prior cleanup was NOT flushed
 *      (StrictMode's ref-preservation quirk), we drop the stale
 *      listener before installing the new one.
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
 * The window during which we suppress `webglcontextlost` events
 * after installation. Chosen at 1500 ms:
 *
 *   - StrictMode's second-mount → first-renderer-disposal race
 *     completes within a few hundred ms on the M4 Pro; adding a
 *     margin keeps the guard robust across slower hardware.
 *   - Real GPU-driver crash-and-recover cycles take much longer
 *     than 1.5 s in practice (driver hangs are measured in
 *     seconds); a real loss BEFORE 1.5 s from a fresh context
 *     is extremely rare and (if it did happen) would still be
 *     picked up on the next render tick.
 *
 * Exported so tests can inject a shorter value if the fake-timer
 * approach doesn't fit their setup.
 */
export const STARTUP_GRACE_MS = 1500;

/**
 * Registers `webglcontextlost` + `webglcontextrestored` listeners
 * on the renderer's canvas.
 *
 *   - `webglcontextlost` handler:
 *       1. Calls `event.preventDefault()` (per the WebGL spec —
 *          required to enable the paired
 *          `webglcontextrestored` event).
 *       2. If the event fires within the startup grace window
 *          (`STARTUP_GRACE_MS`), the event is treated as a
 *          StrictMode double-mount ghost and IGNORED (see
 *          module header § StrictMode remount safety).
 *       3. Otherwise logs a wooddeck-scoped diagnostic to
 *          `console.error` and sets
 *          `useUiStore.getState().setWebglContextLost(true)` so
 *          `<ContextLostBanner>` surfaces the message.
 *
 *   - `webglcontextrestored` handler:
 *       Sets `useUiStore.getState().setWebglContextLost(false)`
 *       so the banner clears when the driver hands back a fresh
 *       context. Without this the banner would latch forever.
 *
 * @param gl  the WebGL renderer (or any object exposing
 *            `domElement` — the fake used in the tests).
 * @returns   a cleanup function that removes BOTH listeners.
 *            Callers (typically the DeckScene composition-root
 *            useEffect + reinstallContextLossHandler wrapper)
 *            invoke this on unmount / re-mount to avoid a leaked
 *            handler.
 */
export function installContextLossHandler(gl: ContextLossTarget): () => void {
  const installedAtMs = Date.now();
  const onLost = (event: Event): void => {
    // Per the WebGL spec, preventDefault MUST be called on
    // webglcontextlost to enable the browser to fire the paired
    // webglcontextrestored event later — without it, the context
    // is gone for the lifetime of the page.
    event.preventDefault();
    // StrictMode grace window: renderer1's disposal queues a
    // webglcontextlost event on the shared canvas element, which
    // arrives after listener2 has installed. Any lost event
    // within STARTUP_GRACE_MS of installation is presumed to be
    // that stale queued event. See module header for the full
    // RCA.
    const elapsedMs = Date.now() - installedAtMs;
    if (elapsedMs < STARTUP_GRACE_MS) {
      // Log at debug level so a devtools-open developer can still
      // see the ignored event — helps confirm the guard is
      // working without cluttering console.error.
      console.debug(
        `[wooddeck:scene] ignoring webglcontextlost within startup grace window (${String(elapsedMs)}ms < ${String(STARTUP_GRACE_MS)}ms) — StrictMode ghost, not a real loss.`,
      );
      return;
    }
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
  const onRestored = (): void => {
    // S14 UAT pair-fix — clear the flag so <ContextLostBanner>
    // stops rendering. The GPU driver dispatches this once the
    // paired lost/restored cycle completes.
    useUiStore.getState().setWebglContextLost(false);
  };
  gl.domElement.addEventListener('webglcontextlost', onLost, { passive: false });
  gl.domElement.addEventListener('webglcontextrestored', onRestored);
  return () => {
    gl.domElement.removeEventListener('webglcontextlost', onLost);
    gl.domElement.removeEventListener('webglcontextrestored', onRestored);
  };
}

/**
 * A ref cell that holds the cleanup returned by the previous
 * `installContextLossHandler` call. Kept as an interface so
 * DeckScene can pass its `useRef<(() => void) | null>` here
 * without pulling React types into this module.
 */
export interface ContextLossCleanupRef {
  current: (() => void) | null;
}

/**
 * StrictMode-safe wrapper around `installContextLossHandler`.
 *
 * Call this from the r3f `<Canvas onCreated>` callback (see
 * `DeckScene.tsx`). It performs three actions in order:
 *
 *   1. If `previousCleanupRef.current` is populated (a prior
 *      renderer's cleanup — happens on every StrictMode remount
 *      and on real re-mounts across route changes), CALL that
 *      cleanup first. This removes the leaked listener on the
 *      first (about-to-be-disposed) canvas.
 *   2. Clear the ui-store `webglContextLost` flag to `false` —
 *      a freshly-created live context is by definition not
 *      lost, and any latched flag from a prior renderer's loss
 *      event (e.g. StrictMode's disposal of the first mount) is
 *      stale.
 *   3. Install the new handler on `gl` and store the returned
 *      cleanup into `previousCleanupRef.current` so a subsequent
 *      remount (or the composition-root unmount) can drop it.
 *
 * Kept in this module (not DeckScene.tsx) so it can be unit-
 * tested in isolation — the r3f Canvas mock in DeckScene.test.tsx
 * never invokes `onCreated`, so testing the reinstall logic
 * inside `onCreated` directly is impractical.
 */
export function reinstallContextLossHandler(
  gl: ContextLossTarget,
  previousCleanupRef: ContextLossCleanupRef,
): void {
  // 1. Drop the prior canvas's listeners (fixes the StrictMode
  //    remount leak — the OLD listener would otherwise latch the
  //    flag when the first renderer is disposed later).
  previousCleanupRef.current?.();
  // 2. Clear the sticky flag — a live context can't be lost.
  useUiStore.getState().setWebglContextLost(false);
  // 3. Install the new pair of listeners and remember the cleanup
  //    so the next re-mount (or the unmount useEffect) can drop
  //    them symmetrically.
  previousCleanupRef.current = installContextLossHandler(gl);
}
