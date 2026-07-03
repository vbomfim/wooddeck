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

import { installContextLossHandler } from './context-loss';

// A minimal fake WebGLRenderer stand-in — implements just the
// `domElement` surface `installContextLossHandler` touches.
function makeFakeGl(): {
  domElement: HTMLCanvasElement;
} {
  const domElement = document.createElement('canvas');
  return { domElement };
}

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  // `MockInstance` gives us `.mock.calls[i]` typed with our declared
  // signature (`(...args: unknown[]) => void`), which the wooddeck-
  // prefix assertion below inspects.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
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

  it('after cleanup, firing the event does NOT invoke the handler', () => {
    const gl = makeFakeGl();
    const cleanup = installContextLossHandler(gl);
    cleanup();

    const event = new Event('webglcontextlost', { cancelable: true });
    gl.domElement.dispatchEvent(event);

    // Handler was removed → console.error must NOT have been called.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
