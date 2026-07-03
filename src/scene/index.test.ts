/**
 * Barrel-surface smoke test for `src/scene/index.ts`.
 *
 * ## Why lock the barrel exports
 *
 * `src/scene/index.ts` is the ONLY public entry point downstream
 * layers (S10 layers, S12 AppShell, QA E2E) may import from. A
 * silent rename / removal of a symbol here would break every
 * consumer at once. The mirror pattern in `src/state/index.test.ts`
 * is intentional — every layer's barrel gets a symbol-presence test.
 */
import { describe, expect, it } from 'vitest';
import * as scene from './index';

describe('scene barrel', () => {
  it('exports the DeckScene component + aria-label constant', () => {
    expect(typeof scene.DeckScene).toBe('function');
    expect(typeof scene.DECKSCENE_ARIA_LABEL).toBe('string');
  });

  it('exports the CameraRig + SceneLighting components', () => {
    expect(typeof scene.CameraRig).toBe('function');
    expect(typeof scene.SceneLighting).toBe('function');
  });

  it('exports WebGLFallback + copy-pinned message', () => {
    expect(typeof scene.WebGLFallback).toBe('function');
    expect(typeof scene.WEBGL_FALLBACK_MESSAGE).toBe('string');
  });

  it('exports the pure camera-math functions & constants', () => {
    expect(typeof scene.isWebGL2Available).toBe('function');
    expect(typeof scene.computeAutoFitDistance).toBe('function');
    expect(typeof scene.computePresetCamera).toBe('function');
    expect(typeof scene.computeZoomLimits).toBe('function');
    expect(typeof scene.AUTOFIT_MARGIN).toBe('number');
    expect(typeof scene.DEFAULT_FOV_DEG).toBe('number');
    expect(typeof scene.TOP_DOWN_FOV_DEG).toBe('number');
    expect(typeof scene.PRESET_TRANSITION_MS).toBe('number');
    // PR#29 pair-fix iter 1 — Fix A. Near / far plane constants
    // must be exported so DeckScene passes them to Canvas and tests
    // can lock the values.
    expect(typeof scene.CAMERA_NEAR_MM).toBe('number');
    expect(typeof scene.CAMERA_FAR_MM).toBe('number');
  });

  it('exports installContextLossHandler (Fix H)', () => {
    // PR#29 pair-fix iter 1 — Fix H. The GL context-loss listener
    // is extracted so it's testable in jsdom AND consumable by S12's
    // banner surfacing story.
    expect(typeof scene.installContextLossHandler).toBe('function');
  });
});
