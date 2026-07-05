/**
 * Unit tests for `src/scene/highlights/highlight-primitives.ts`.
 *
 * ## Coverage map (S11 issue #12 + opaque-highlight follow-up)
 *
 *   AC3  Highlight material is a distinctly-visible RED, OPAQUE,
 *        depth-correct primitive (`transparent === false`,
 *        `opacity === 1`, `depthTest === true`, `depthWrite === true`).
 *        The mesh geometry is a unit BoxGeometry — every highlight
 *        scales it via {@link inflateHighlightScale}(member.size)
 *        so the resulting box is slightly larger than the member,
 *        fully enclosing it and avoiding z-fighting with the
 *        member's own surface. See module header of the source file
 *        for the depth-correct opaque rationale.
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
  HIGHLIGHT_INFLATE_MM,
  HIGHLIGHT_MATERIAL,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_RENDER_ORDER,
  inflateHighlightScale,
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

describe('highlight primitives — material (AC3 opaque red, depth-correct)', () => {
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

  it('material is OPAQUE (transparent=false, opacity=1)', () => {
    // Opacity was flipped from translucent (0.35) to fully opaque
    // per the "remove transparency" request. The over-span member
    // renders as a SOLID red box — no member tint bleeding through.
    // Coincident z-fighting is avoided at the geometry level by
    // {@link inflateHighlightScale} — see its dedicated tests.
    expect(HIGHLIGHT_MATERIAL.transparent).toBe(false);
    expect(HIGHLIGHT_OPACITY).toBe(1);
    expect(HIGHLIGHT_MATERIAL.opacity).toBe(HIGHLIGHT_OPACITY);
  });

  it('material participates in the depth buffer (depthTest=true, depthWrite=true)', () => {
    // The old translucent-overlay design disabled depth entirely
    // (test=false, write=false) and force-drew on top via a high
    // renderOrder. The opaque-box design is depth-correct: the
    // enclosing red box is occluded by nearer geometry the same
    // way any other opaque scene primitive is — no more artificial
    // "always on top" behavior that ignored the scene's z-order.
    expect(HIGHLIGHT_MATERIAL.depthTest).toBe(true);
    expect(HIGHLIGHT_MATERIAL.depthWrite).toBe(true);
  });

  it('HIGHLIGHT_RENDER_ORDER is 0 — depth-correct opaque, no forced top-most sort', () => {
    // A depth-correct opaque box does not need to force itself to
    // the end of the transparent pass. renderOrder=0 sorts it with
    // other opaque scene primitives; z-buffer visibility is
    // determined by the real depth values, not by draw order.
    expect(HIGHLIGHT_RENDER_ORDER).toBe(0);
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

describe('highlight primitives — inflation (opaque box encloses member, no z-fight)', () => {
  it('HIGHLIGHT_INFLATE_MM is a small positive mm value', () => {
    // The inflation amount is added to each axis so the opaque
    // highlight fully ENCLOSES the coincident member — no shared
    // faces, no z-fighting. Too small (< 1 mm) and floating-point
    // precision at real-world coordinates still lets faces touch;
    // too large (> 100 mm) and the highlight visibly overshoots
    // the member's silhouette.
    expect(HIGHLIGHT_INFLATE_MM).toBeGreaterThan(0);
    expect(HIGHLIGHT_INFLATE_MM).toBeLessThanOrEqual(100);
  });

  it('inflateHighlightScale adds HIGHLIGHT_INFLATE_MM on every axis', () => {
    // The helper takes a size {x,y,z} and returns a [x,y,z] tuple
    // suitable for the mesh `scale` prop. Adding the same margin
    // on every axis keeps the box centred on the member position
    // (which OverSpanHighlight passes through unchanged).
    const scale = inflateHighlightScale({ x: 3600, y: 240, z: 45 });
    expect(scale).toEqual([
      3600 + HIGHLIGHT_INFLATE_MM,
      240 + HIGHLIGHT_INFLATE_MM,
      45 + HIGHLIGHT_INFLATE_MM,
    ]);
  });

  it('inflateHighlightScale returns a length-3 tuple', () => {
    // Contract check — the return shape is what the R3F mesh
    // `scale` prop consumes.
    const scale = inflateHighlightScale({ x: 1, y: 2, z: 3 });
    expect(scale).toHaveLength(3);
  });

  it('inflateHighlightScale is pure (does not mutate the input)', () => {
    // The helper is called on every render — mutation of the
    // input would silently corrupt LayoutMember state (which flows
    // from the immutable layout store).
    const size = { x: 100, y: 200, z: 300 };
    inflateHighlightScale(size);
    expect(size).toEqual({ x: 100, y: 200, z: 300 });
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
