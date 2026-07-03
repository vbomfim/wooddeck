/**
 * Unit tests for `src/scene/webgl-support.ts`.
 *
 * ## Why these tests exist (AC5 gate)
 *
 * WebGL 2 is the minimum baseline for the r3f scene — three.js
 * `WebGLRenderer` used with modern shaders requires WebGL 2 for
 * feature parity. Older / niche browsers (or a WebGL-disabled
 * hardware profile) must render the AC5 fallback message, NOT crash
 * the app. This test file locks in:
 *
 *   - `isWebGL2Available()` returns TRUE when the injected canvas
 *     factory yields a canvas whose `getContext('webgl2')` returns
 *     a truthy context object.
 *   - `isWebGL2Available()` returns FALSE when the factory yields
 *     a canvas whose `getContext('webgl2')` returns `null` (real
 *     browsers) or throws (Safari with WebGL disabled).
 *   - Any throw from the factory itself (e.g., `document` is
 *     undefined on a SSR pre-render pass) is caught → returns FALSE.
 *
 * The DECK-SCENE-level fallback (rendering the message) is tested
 * in `DeckScene.test.tsx`; here we only exercise the detector.
 */
import { describe, expect, it } from 'vitest';

import { isWebGL2Available } from './webgl-support';

// A minimal fake canvas — only implements the surface
// `isWebGL2Available` calls (`getContext`). Keeps the tests independent
// of any real jsdom canvas behavior (jsdom does not implement WebGL and
// returns null for any GL context, which would make TRUE cases untestable
// without an explicit stub).
function fakeCanvasReturning(ctx: unknown): { getContext: (id: string) => unknown } {
  return {
    getContext: (id: string) => (id === 'webgl2' ? ctx : null),
  };
}

function fakeCanvasThrowing(): { getContext: (id: string) => unknown } {
  return {
    getContext: () => {
      throw new Error('SecurityError: canvas GL disabled');
    },
  };
}

describe('isWebGL2Available', () => {
  it('AC5: returns TRUE when the canvas exposes a truthy webgl2 context', () => {
    // A truthy object stands in for a real WebGL2RenderingContext —
    // the detector only checks truthiness, not the API surface, so
    // an empty object is a valid positive.
    const factory = () => fakeCanvasReturning({});
    expect(isWebGL2Available(factory)).toBe(true);
  });

  it('AC5: returns FALSE when getContext("webgl2") returns null', () => {
    // Real modern browsers return `null` on unsupported contexts —
    // this is the primary "no WebGL 2" signal we ship the fallback for.
    const factory = () => fakeCanvasReturning(null);
    expect(isWebGL2Available(factory)).toBe(false);
  });

  it('AC5: returns FALSE when getContext throws (Safari GL-disabled)', () => {
    // Safari's "Disable WebGL" advanced preference throws
    // `SecurityError` from `getContext` rather than returning null.
    // Both branches must fall through to the AC5 fallback.
    expect(isWebGL2Available(fakeCanvasThrowing)).toBe(false);
  });

  it('returns FALSE when the factory ITSELF throws (SSR / no document)', () => {
    // A pre-render pass without a DOM (SSR, prerendering) throws when
    // trying to `document.createElement('canvas')` — the detector must
    // treat this as "no WebGL" so the render tree falls back cleanly.
    const factory = (): { getContext: (id: string) => unknown } => {
      throw new ReferenceError('document is not defined');
    };
    expect(isWebGL2Available(factory)).toBe(false);
  });

  it('uses a real document.createElement canvas by default (jsdom path)', () => {
    // In jsdom, `document.createElement('canvas').getContext('webgl2')`
    // returns null — so the default path must return FALSE without
    // throwing (the historical bug we guard against is a detector that
    // throws on jsdom, which would blow up the test suite).
    expect(() => isWebGL2Available()).not.toThrow();
    // In jsdom specifically the answer is false. Documenting the
    // behavior here so a regression that jsdom-mocks WebGL is
    // caught immediately.
    expect(isWebGL2Available()).toBe(false);
  });
});
