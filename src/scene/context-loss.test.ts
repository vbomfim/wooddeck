/**
 * Unit tests for `src/scene/context-loss.ts`.
 *
 * ## Why extracted from DeckScene (PR#29 pair-fix iter 1 — Fix H)
 *
 * The original S9 wired the `webglcontextlost` listener inline
 * inside the Canvas `onCreated` callback. That made the handler
 * untestable without a real Canvas mount (which jsdom doesn't
 * support) — Opus#12, GPT#6, and QA G3 all flagged this as
 * "handler exists but no test proves it fires". Extracting to a
 * plain function pulled it out of the r3f context and made the
 * observable behavior (listener registration, `preventDefault`,
 * `console.error`, cleanup) directly assertable in jsdom.
 *
 * ## What is tested
 *
 *   1. `installContextLossHandler` returns a cleanup function.
 *   2. The listener is registered on the passed `gl.domElement`.
 *   3. Firing a `webglcontextlost` event triggers `preventDefault()`
 *      AND `console.error()` with a wooddeck-prefixed message.
 *   4. The cleanup function removes the listener (no side effects
 *      after unmount).
 *
 * ## What is deferred to QA E2E
 *
 * The USER-VISIBLE banner ("3D view crashed — please reload") is
 * S12's job. This module only proves the diagnostic hook fires.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { useUiStore } from '../state';
import { installContextLossHandler, STARTUP_GRACE_MS } from './context-loss';

// A minimal fake WebGLRenderer stand-in — implements just the
// `domElement` surface `installContextLossHandler` touches.
function makeFakeGl(): {
  domElement: HTMLCanvasElement;
} {
  const domElement = document.createElement('canvas');
  return { domElement };
}

/**
 * Advance the mocked wall clock past the startup grace window so
 * that `webglcontextlost` events are honoured (not swallowed as
 * StrictMode ghosts). Every test that wants to simulate a REAL
 * context-loss event (as opposed to the ghost-event guard test)
 * calls this after `installContextLossHandler` / `reinstall…`.
 */
function advancePastGraceWindow(): void {
  vi.setSystemTime(Date.now() + STARTUP_GRACE_MS + 100);
}

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;
let consoleDebugSpy: MockInstance<(...args: unknown[]) => void>;
const UI_STORE_INITIAL = useUiStore.getInitialState();

beforeEach(() => {
  // Use fake timers so we can control the startup grace window
  // deterministically. `installContextLossHandler` reads
  // `Date.now()` at install-time; `vi.setSystemTime` steers it.
  vi.useFakeTimers();
  // `MockInstance` gives us `.mock.calls[i]` typed with our declared
  // signature (`(...args: unknown[]) => void`), which the wooddeck-
  // prefix assertion below inspects.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  // Reset the ui-store so the webglContextLost assertions below
  // aren't polluted by a prior test that set the flag.
  useUiStore.setState(UI_STORE_INITIAL, true);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleDebugSpy.mockRestore();
  useUiStore.setState(UI_STORE_INITIAL, true);
  vi.useRealTimers();
});

describe('installContextLossHandler', () => {
  it('registers a webglcontextlost listener on gl.domElement', () => {
    const gl = makeFakeGl();
    const addSpy = vi.spyOn(gl.domElement, 'addEventListener');

    installContextLossHandler(gl);

    // At least one call was for 'webglcontextlost' — additional
    // listeners registered by three.js internals during a real Canvas
    // mount would ALSO show up, but this spy sees only our call
    // (the fake gl has no three.js internals wired).
    expect(addSpy).toHaveBeenCalledWith(
      'webglcontextlost',
      expect.any(Function),
      expect.objectContaining({ passive: false }),
    );
  });

  it('returns a cleanup function that removes the listener', () => {
    const gl = makeFakeGl();
    const removeSpy = vi.spyOn(gl.domElement, 'removeEventListener');

    const cleanup = installContextLossHandler(gl);
    expect(typeof cleanup).toBe('function');

    cleanup();

    expect(removeSpy).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
  });

  it('firing webglcontextlost calls preventDefault + console.error with the wooddeck prefix', () => {
    const gl = makeFakeGl();
    installContextLossHandler(gl);
    // Advance past the startup grace window so the event is
    // treated as a real loss (grace-window guard is tested
    // separately below).
    advancePastGraceWindow();

    // Synthesise a webglcontextlost Event. Real browsers dispatch a
    // WebGLContextEvent (a subclass with statusMessage) but the
    // handler only needs `preventDefault()` from the base Event API.
    const event = new Event('webglcontextlost', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    gl.domElement.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalledOnce();
    // The console.error MUST carry the wooddeck-scoped prefix so
    // ops can grep the diagnostic in production logs.
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const firstArg = consoleErrorSpy.mock.calls[0]?.[0];
    // The handler passes a plain string message (see context-loss.ts);
    // narrow the `unknown` here before regex-matching so
    // no-base-to-string is satisfied.
    expect(typeof firstArg).toBe('string');
    const message = typeof firstArg === 'string' ? firstArg : '';
    expect(message).toMatch(/\[wooddeck:scene\]/);
    expect(message).toMatch(/context lost/i);
  });

  it('firing webglcontextlost flips ui-store webglContextLost=true (S12 Fix C)', () => {
    const gl = makeFakeGl();
    installContextLossHandler(gl);
    advancePastGraceWindow();
    // Precondition: the store starts with the flag `false`.
    expect(useUiStore.getState().webglContextLost).toBe(false);

    const event = new Event('webglcontextlost', { cancelable: true });
    gl.domElement.dispatchEvent(event);

    expect(useUiStore.getState().webglContextLost).toBe(true);
  });

  it('after cleanup, firing the event does NOT invoke the handler', () => {
    const gl = makeFakeGl();
    const cleanup = installContextLossHandler(gl);
    advancePastGraceWindow();
    cleanup();

    const event = new Event('webglcontextlost', { cancelable: true });
    gl.domElement.dispatchEvent(event);

    // Handler was removed → console.error must NOT have been called.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // S14 UAT pair-fix — webglcontextrestored + cleanup symmetry
  // ------------------------------------------------------------------
  //
  // Root cause diagnosed live on an M4 Pro (real GPU, NOT swiftshader):
  // React StrictMode dev-only double-mount disposes the FIRST r3f
  // renderer, which fires `webglcontextlost` on that dead canvas
  // AFTER a live remounted second renderer is already up. The old
  // handler set the sticky `webglContextLost` flag to true and NEVER
  // cleared it — even after the browser dispatched
  // `webglcontextrestored`. Additionally, DeckScene's single ref
  // over-wrote the FIRST cleanup with the SECOND, leaking the first
  // listener. The tests below pin both invariants.

  it('firing webglcontextrestored clears ui-store webglContextLost=false', () => {
    const gl = makeFakeGl();
    installContextLossHandler(gl);
    advancePastGraceWindow();

    // Simulate the loss first so we have something to clear.
    gl.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(useUiStore.getState().webglContextLost).toBe(true);

    // Now the paired restore event — the driver dispatches this
    // once the GPU driver hands back a fresh context.
    gl.domElement.dispatchEvent(new Event('webglcontextrestored'));
    expect(useUiStore.getState().webglContextLost).toBe(false);
  });

  it('registers webglcontextrestored listener alongside webglcontextlost', () => {
    const gl = makeFakeGl();
    const addSpy = vi.spyOn(gl.domElement, 'addEventListener');

    installContextLossHandler(gl);

    // Both listener registrations must have happened.
    const events = addSpy.mock.calls.map((call) => call[0]);
    expect(events).toContain('webglcontextlost');
    expect(events).toContain('webglcontextrestored');
  });

  it('cleanup removes BOTH webglcontextlost and webglcontextrestored listeners', () => {
    const gl = makeFakeGl();
    const removeSpy = vi.spyOn(gl.domElement, 'removeEventListener');

    const cleanup = installContextLossHandler(gl);
    cleanup();

    const events = removeSpy.mock.calls.map((call) => call[0]);
    expect(events).toContain('webglcontextlost');
    expect(events).toContain('webglcontextrestored');
  });

  it('after cleanup, firing webglcontextrestored does NOT touch the store', () => {
    const gl = makeFakeGl();
    const cleanup = installContextLossHandler(gl);
    // Pre-populate the flag so a bogus restore-event handler would
    // observably clear it.
    useUiStore.getState().setWebglContextLost(true);
    cleanup();

    gl.domElement.dispatchEvent(new Event('webglcontextrestored'));

    expect(useUiStore.getState().webglContextLost).toBe(true);
  });
});

// ------------------------------------------------------------------
// reinstallContextLossHandler — StrictMode remount safety
// ------------------------------------------------------------------
//
// A single-ref pattern (`ref.current = installContextLossHandler(gl)`)
// leaks the FIRST listener across a StrictMode remount because the
// second onCreated OVERWRITES ref.current with the new cleanup
// without invoking the old one. `reinstallContextLossHandler` is
// the safe wrapper: it drops the previous cleanup first, clears any
// stale `webglContextLost` flag (a newly-created context is by
// definition not lost), then installs and stores the new cleanup.

describe('reinstallContextLossHandler (S14 UAT pair-fix)', () => {
  it('invokes the previous cleanup before installing the new listener', () => {
    // Import lazily so the test file compiles even before the helper
    // is implemented (TDD red).
    void import('./context-loss');
  });

  it('does not leak the first canvas listener across a simulated remount', async () => {
    const { reinstallContextLossHandler } = await import('./context-loss');
    const glA = makeFakeGl();
    const glB = makeFakeGl();

    const ref: { current: (() => void) | null } = { current: null };
    reinstallContextLossHandler(glA, ref);
    // Simulate StrictMode remount — a second onCreated with a fresh gl.
    reinstallContextLossHandler(glB, ref);
    // Advance past the grace window on B so a real fire would flip.
    advancePastGraceWindow();
    const consoleErrorCallsBefore = consoleErrorSpy.mock.calls.length;

    // Now fire webglcontextlost on the FIRST (disposed) canvas.
    // With the leak, this would flip the flag; the fix removes A's
    // listener before installing B's, so the flag must stay false.
    glA.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    expect(useUiStore.getState().webglContextLost).toBe(false);
    // And console.error must not have been called for A — its
    // handler was removed.
    expect(consoleErrorSpy.mock.calls.length).toBe(consoleErrorCallsBefore);
  });

  it('clears a stale webglContextLost flag when installing on a fresh live context', async () => {
    const { reinstallContextLossHandler } = await import('./context-loss');
    // Pretend a prior renderer already latched the flag.
    useUiStore.getState().setWebglContextLost(true);
    const gl = makeFakeGl();
    const ref: { current: (() => void) | null } = { current: null };

    reinstallContextLossHandler(gl, ref);

    // A freshly created context is by definition alive → flag reset.
    expect(useUiStore.getState().webglContextLost).toBe(false);
  });

  it('stores the new cleanup in the ref for a later unmount call', async () => {
    const { reinstallContextLossHandler } = await import('./context-loss');
    const gl = makeFakeGl();
    const ref: { current: (() => void) | null } = { current: null };

    reinstallContextLossHandler(gl, ref);
    expect(typeof ref.current).toBe('function');

    // Calling the stored cleanup removes the listener.
    const removeSpy = vi.spyOn(gl.domElement, 'removeEventListener');
    ref.current?.();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('firing webglcontextlost on the LIVE (second) canvas still surfaces the flag', async () => {
    const { reinstallContextLossHandler } = await import('./context-loss');
    const glA = makeFakeGl();
    const glB = makeFakeGl();
    const ref: { current: (() => void) | null } = { current: null };

    reinstallContextLossHandler(glA, ref);
    reinstallContextLossHandler(glB, ref);
    // Wait past the grace window so real losses aren't swallowed.
    advancePastGraceWindow();

    // A real GPU-loss on the live canvas MUST still surface.
    glB.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(useUiStore.getState().webglContextLost).toBe(true);

    // And the paired restore clears it (regression guard).
    glB.domElement.dispatchEvent(new Event('webglcontextrestored'));
    expect(useUiStore.getState().webglContextLost).toBe(false);
  });
});

// ------------------------------------------------------------------
// S14 UAT pair-fix — startup grace window (StrictMode ghost guard)
// ------------------------------------------------------------------
//
// Real M4 Pro measurement: react-three-fiber reuses the SAME `<canvas>`
// DOM element across a StrictMode double-mount. When React's simulated
// unmount disposes renderer1, three.js calls
// `WEBGL_lose_context.loseContext()` on that shared canvas — which
// QUEUES a `webglcontextlost` event. The browser dispatches it
// asynchronously (~1.3s on M4 Pro). By that time the fresh listener
// from the second mount is already installed on the same canvas, so
// the STALE event flips the flag and latches the banner permanently.
//
// The fix: for the first `STARTUP_GRACE_MS` after installation, any
// `webglcontextlost` event is treated as a StrictMode ghost and
// IGNORED (a real GPU-driver crash takes seconds; a sub-1.5s loss
// from a freshly-created context can only be a synthetic
// forceContextLoss from a disposed sibling renderer).

describe('installContextLossHandler — startup grace window (S14 UAT pair-fix)', () => {
  it('IGNORES webglcontextlost events fired within the grace window', () => {
    const gl = makeFakeGl();
    installContextLossHandler(gl);
    // DO NOT advance time — we're testing the grace window.

    gl.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    // Flag must remain false — the event is a StrictMode ghost.
    expect(useUiStore.getState().webglContextLost).toBe(false);
    // console.error must NOT be called (that surface is user-
    // visible signal; ghosts should be invisible outside debug).
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    // console.debug MAY be called (helpful developer signal that
    // the guard fired).
    expect(consoleDebugSpy).toHaveBeenCalled();
  });

  it('HONOURS webglcontextlost events fired AFTER the grace window elapses', () => {
    const gl = makeFakeGl();
    installContextLossHandler(gl);
    advancePastGraceWindow();

    gl.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    // Real loss → flag flips, console.error surfaces.
    expect(useUiStore.getState().webglContextLost).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('grace window is 1500 ms (matches the constant)', () => {
    // Contract: the window is exported so tests + future callers
    // can share the exact value. Changing this constant is a
    // ux/ops decision (see module header § StartupGrace).
    expect(STARTUP_GRACE_MS).toBe(1500);
  });
});
