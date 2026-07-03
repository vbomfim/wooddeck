/**
 * Unit tests for `src/scene/highlights/highlight-primitives.ts`.
 *
 * ## Coverage map (S11 issue #12)
 *
 *   AC3  Highlight material is a distinctly-visible RED, TRANSLUCENT
 *        primitive that renders ON TOP of any occluding geometry
 *        (`depthTest === false`). Also asserts the mesh geometry
 *        is a unit BoxGeometry so scaling by `member.size` produces
 *        the correct box extent (matches the S10 BoxMember discipline
 *        — but with a SEPARATE self-contained copy per the S11
 *        `warning-overlay-no-layers` boundary rule).
 *
 * ## Independence from `src/scene/layers/` (finding #7)
 *
 * The S11 boundary rule forbids `src/scene/highlights/**` from
 * importing anything under `src/scene/layers/`. That means the
 * shared unit-cube geometry AND the highlight material live HERE,
 * not in `layers/shared/`. These tests assert the primitives are
 * self-contained (identity checks + property assertions on the
 * exact instances the OverSpanHighlight binds).
 */
import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, MeshBasicMaterial } from 'three';

import {
  disposeHighlightPrimitives,
  HIGHLIGHT_BOX_GEOMETRY,
  HIGHLIGHT_COLOR_HEX,
  HIGHLIGHT_MATERIAL,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_RENDER_ORDER,
} from './highlight-primitives';

describe('highlight primitives — geometry (self-contained unit cube)', () => {
  it('HIGHLIGHT_BOX_GEOMETRY is a THREE.BoxGeometry', () => {
    // The overlay geometry MUST be a BoxGeometry so the mesh
    // scale prop applies full-extent width/height/depth correctly.
    // A custom / edges geometry would break the AC1 assertion
    // that a highlight sits at the member's full bounding box.
    expect(HIGHLIGHT_BOX_GEOMETRY).toBeInstanceOf(BoxGeometry);
  });

  it('HIGHLIGHT_BOX_GEOMETRY is a UNIT cube (1×1×1) so scale=size works', () => {
    // The geometry parameters are stored on the BoxGeometry
    // instance's `parameters` field. A 1×1×1 cube scaled by
    // `member.size` gives the correct extent.
    const params = HIGHLIGHT_BOX_GEOMETRY.parameters;
    expect(params.width).toBe(1);
    expect(params.height).toBe(1);
    expect(params.depth).toBe(1);
  });

  it('HIGHLIGHT_BOX_GEOMETRY is a MODULE-LEVEL singleton (identity stable across imports)', async () => {
    // Re-import and assert reference equality — every
    // OverSpanHighlight in the scene shares the same geometry
    // buffer (cheap GPU state).
    const again = await import('./highlight-primitives');
    expect(again.HIGHLIGHT_BOX_GEOMETRY).toBe(HIGHLIGHT_BOX_GEOMETRY);
  });
});

describe('highlight primitives — material (AC3 always-on-top red)', () => {
  it('HIGHLIGHT_MATERIAL is a MeshBasicMaterial (unlit — consistent visibility)', () => {
    // Unlit so the highlight does not vary in brightness with
    // scene lighting — a MeshStandardMaterial in a shadowed
    // corner would be nearly black. AC3 says "distinctly visible".
    expect(HIGHLIGHT_MATERIAL).toBeInstanceOf(MeshBasicMaterial);
  });

  it('HIGHLIGHT_COLOR_HEX is RED (predominant red channel)', () => {
    // Red on brown (wood tones) is the AC3 "sufficient contrast"
    // choice. Assert the numeric property — red channel dominates.
    expect(HIGHLIGHT_COLOR_HEX).toBe(0xff0000);
    const r = (HIGHLIGHT_COLOR_HEX >> 16) & 0xff;
    const g = (HIGHLIGHT_COLOR_HEX >> 8) & 0xff;
    const b = HIGHLIGHT_COLOR_HEX & 0xff;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('material color matches HIGHLIGHT_COLOR_HEX', () => {
    expect(HIGHLIGHT_MATERIAL.color.getHex()).toBe(HIGHLIGHT_COLOR_HEX);
  });

  it('material is TRANSLUCENT (transparent=true, opacity in (0, 1))', () => {
    // Translucent so the user can still see the highlighted member
    // through the highlight — a fully opaque red box would hide
    // the member entirely. Opacity is pinned via HIGHLIGHT_OPACITY.
    expect(HIGHLIGHT_MATERIAL.transparent).toBe(true);
    expect(HIGHLIGHT_OPACITY).toBeGreaterThan(0);
    expect(HIGHLIGHT_OPACITY).toBeLessThan(1);
    expect(HIGHLIGHT_MATERIAL.opacity).toBe(HIGHLIGHT_OPACITY);
  });

  it('material has depthTest=false so the highlight renders ON TOP (AC3)', () => {
    // AC3: "Renders on top so it isn't occluded by the highlighted
    // member." depthTest=false disables the per-pixel z-test that
    // would otherwise hide the highlight behind opaque decking.
    expect(HIGHLIGHT_MATERIAL.depthTest).toBe(false);
  });

  it('material has depthWrite=false so it does not corrupt the z-buffer', () => {
    // Companion to depthTest=false: without depthWrite=false, the
    // translucent highlight would still write its depth values,
    // occluding subsequent transparent primitives further back.
    // For a decorator layer this is unwanted — the highlight is
    // an overlay, not a scene participant.
    expect(HIGHLIGHT_MATERIAL.depthWrite).toBe(false);
  });

  it('HIGHLIGHT_RENDER_ORDER is HIGH so the mesh sorts LAST (drawn on top)', () => {
    // Three.js sorts objects by renderOrder ascending — a high
    // value means the highlight draws AFTER every opaque scene
    // primitive (which typically have renderOrder=0). Combined
    // with depthTest=false, this guarantees the highlight sits
    // visually on top regardless of camera angle.
    expect(HIGHLIGHT_RENDER_ORDER).toBeGreaterThanOrEqual(999);
  });

  it('HIGHLIGHT_MATERIAL is a MODULE-LEVEL singleton (identity stable across imports)', async () => {
    // Every OverSpanHighlight in the scene shares the same
    // MeshBasicMaterial instance — matches the S10 "shared per
    // species" material discipline. A per-highlight material
    // would explode GPU state as warnings scale up.
    const again = await import('./highlight-primitives');
    expect(again.HIGHLIGHT_MATERIAL).toBe(HIGHLIGHT_MATERIAL);
  });
});

describe('highlight primitives — disposal (HMR/tooling helper, GPT#4 pair-fix 1)', () => {
  it('disposeHighlightPrimitives() calls .dispose() on BOTH shared singletons exactly once', () => {
    // Parity with the layers' `disposeSharedMaterials` /
    // `disposeSharedGeometry` helpers. We spy on the real methods
    // instead of invoking them so subsequent tests still hold a
    // live geometry + material (the singletons are module-scoped
    // — a real dispose would black-out every other highlight
    // test's scene).
    const geomSpy = vi
      .spyOn(HIGHLIGHT_BOX_GEOMETRY, 'dispose')
      .mockImplementation(() => undefined);
    const matSpy = vi
      .spyOn(HIGHLIGHT_MATERIAL, 'dispose')
      .mockImplementation(() => undefined);
    try {
      disposeHighlightPrimitives();
      expect(geomSpy).toHaveBeenCalledTimes(1);
      expect(matSpy).toHaveBeenCalledTimes(1);
    } finally {
      geomSpy.mockRestore();
      matSpy.mockRestore();
    }
  });

  it('disposeHighlightPrimitives() is IDEMPOTENT — safe to call repeatedly', () => {
    // three.js .dispose() is a no-op on already-disposed handles,
    // so the helper should not throw when called twice + the spy
    // should fire twice per singleton.
    const geomSpy = vi
      .spyOn(HIGHLIGHT_BOX_GEOMETRY, 'dispose')
      .mockImplementation(() => undefined);
    const matSpy = vi
      .spyOn(HIGHLIGHT_MATERIAL, 'dispose')
      .mockImplementation(() => undefined);
    try {
      expect(() => {
        disposeHighlightPrimitives();
        disposeHighlightPrimitives();
      }).not.toThrow();
      expect(geomSpy).toHaveBeenCalledTimes(2);
      expect(matSpy).toHaveBeenCalledTimes(2);
    } finally {
      geomSpy.mockRestore();
      matSpy.mockRestore();
    }
  });
});
