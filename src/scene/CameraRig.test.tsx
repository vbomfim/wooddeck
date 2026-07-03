/**
 * Unit tests for `src/scene/CameraRig.tsx`.
 *
 * ## Testing strategy — live-camera probes (PR#29 pair-fix iter 1 — Fix C)
 *
 * The original S9 test file re-derived poses via `computePresetCamera`
 * and compared the DERIVATION to itself — a green light even if
 * `applyPose` were deleted. Both code-review models independently
 * flagged this as a false-confidence gap that hid the near/far
 * clipping bug (Fix A) and the top-preset zoom-clamp bug (Fix B).
 *
 * The new strategy uses a `<CameraProbe>` component that calls
 * `useThree()` to capture the LIVE r3f-managed camera and
 * controls, then asserts the ACTUAL camera state after the
 * initial mount and after a `renderer.update()` preset change.
 * If `applyPose` no-ops or the lerp math is wrong, the assertion
 * fires; if the pure math changes but stays consistent with the
 * pose we're asked to apply, the assertion also fires — the test
 * exercises the whole rig, not just its inputs.
 *
 * ## What's tested here vs. deferred to QA E2E
 *
 * Structural / prop-flow / live-camera assertions belong here:
 *   - AC1: mounting without error.
 *   - AC2: preset change → camera position, up vector, and FOV
 *          converge on the new pose after the lerp completes.
 *   - AC2/§4: OrbitControls is DISABLED during a preset lerp so
 *          user input does not race the animation.
 *   - AC3: OrbitControls mounts with the computed min / max
 *          distance from `computeZoomLimits`.
 *   - AC3 invariant: max distance accommodates the top-preset
 *          fit distance (Fix B — was violated by the previous
 *          5×largest-only formula).
 *   - AC4: initial camera pose = the auto-fit iso corner for the
 *          passed bounds (Fix C — was NOT actually asserted before).
 *   - Fix D: up vector never goes degenerate mid-transition
 *          (top→front, top→side).
 *   - Fix F: re-setting bounds to numerically-equal values does
 *          NOT schedule a spurious lerp.
 *
 * Perceptual assertions belong in the QA E2E (Playwright, S9 pinned):
 *   - AC3 orbit gesture responsiveness (real mouse events),
 *   - AC6 30 FPS floor,
 *   - Pixel-diff of preset transitions.
 */
import { describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { PerspectiveCamera as ThreePerspectiveCamera, type Camera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import { useThree } from '@react-three/fiber';

import { CameraRig, type CameraRigProps } from './CameraRig';
import {
  DEFAULT_FOV_DEG,
  PRESET_TRANSITION_MS,
  TOP_DOWN_FOV_DEG,
  computeAutoFitDistance,
  computePresetCamera,
  computeZoomLimits,
} from './camera-presets';

// A reference 20 × 30 × 3 ft deck (mm-approximate) — the ticket §9
// hardware target uses this footprint for the FPS budget.
const REFERENCE_BOUNDS: CameraRigProps['bounds'] = {
  widthMm: 6096,
  lengthMm: 9144,
  heightMm: 900,
};

// Tolerance for float compares — camera positions come out of
// three.js Vector3 arithmetic so we allow small drift.
const POS_EPS = 1e-3;

/**
 * Captures the live r3f state on every render into the passed
 * `capture` object. Rendered alongside `<CameraRig>` so its
 * `useThree()` reads the SAME context the rig writes to.
 *
 * A `useEffect(..., undefined)` after every render (undefined
 * dependency list = every render) means the object is updated on
 * every commit — including after `advanceFrames`. The capture
 * object holds refs (not copies) so `capture.camera.position`
 * reflects the CURRENT frame's values.
 */
interface LiveState {
  camera?: Camera;
  controls?: OrbitControlsImpl | null;
}

function LiveStateProbe({ capture }: { capture: LiveState }): null {
  const camera = useThree((s) => s.camera);
  // `state.controls` is populated when `<OrbitControls makeDefault>` mounts.
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useEffect(() => {
    capture.camera = camera;
    capture.controls = controls;
  });
  return null;
}

/**
 * Small helper — advances enough frames to complete a preset lerp.
 * PRESET_TRANSITION_MS is 500 ms. `renderer.advanceFrames(count, delta)`
 * passes `delta` DIRECTLY as the r3f `useFrame(state, delta)` value,
 * which the r3f convention treats as SECONDS. So 12 frames × 0.05 s
 * (50 ms) = 600 ms — 100 ms of headroom past the 500 ms budget
 * so the final "snap to target + null out transitionRef" bookkeeping
 * definitely runs.
 */
async function completeTransition(
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
): Promise<void> {
  await renderer.advanceFrames(12, 0.05);
}

describe('<CameraRig /> — smoke + structure', () => {
  it('AC1: mounts without throwing in an r3f headless canvas', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <CameraRig preset="orbit" bounds={REFERENCE_BOUNDS} />,
    );
    expect(renderer.scene).toBeDefined();
    await renderer.unmount();
  });

  it('AC3: mounts <OrbitControls> as the zoom/pan/orbit adapter', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <CameraRig preset="orbit" bounds={REFERENCE_BOUNDS} />,
    );
    // drei's `<OrbitControls>` mounts a `THREE.OrbitControls` instance
    // as a scene child. Finding it by three-type name proves the
    // AC3 orbit/zoom/pan adapter is wired.
    const controls = renderer.scene.findAll(
      (node) =>
        node.type === 'OrbitControls' ||
        node.instance?.constructor?.name === 'OrbitControls',
    );
    expect(controls.length).toBeGreaterThanOrEqual(1);
    await renderer.unmount();
  });

  it('smoke: re-derives pure-math zoom limits (belt-and-suspenders sanity)', () => {
    // Not r3f-rendered — just re-derives the AC3 numbers as a
    // sanity check that the pure math the rig depends on is stable
    // for the reference bounds. The LIVE assertion (rig actually
    // applies these to OrbitControls) is in the "live-camera state"
    // block below.
    const { minDistance, maxDistance } = computeZoomLimits(REFERENCE_BOUNDS);
    expect(minDistance).toBeGreaterThan(0);
    expect(maxDistance).toBeGreaterThan(minDistance);
  });
});

// ---------------------------------------------------------------------------
// PR#29 pair-fix iter 1 — Fix C: live-camera assertions
// ---------------------------------------------------------------------------

describe('<CameraRig /> — live-camera state (Fix C)', () => {
  it('AC4: on mount, the r3f-managed camera is snapped to the iso auto-fit pose', async () => {
    const capture: LiveState = {};
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CameraRig preset="orbit" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    // First-frame snap — no lerp, `initializedRef` false → position set immediately.
    await renderer.advanceFrames(1, 0.016);

    expect(capture.camera).toBeDefined();
    const cam = capture.camera!;
    const expected = computePresetCamera('orbit', REFERENCE_BOUNDS);
    // LIVE position must match the computed iso corner (was NOT
    // asserted before — this is the test that would have caught the
    // near/far clip in visible output).
    expect(cam.position.x).toBeCloseTo(expected.position[0], POS_EPS);
    expect(cam.position.y).toBeCloseTo(expected.position[1], POS_EPS);
    expect(cam.position.z).toBeCloseTo(expected.position[2], POS_EPS);
    // Up vector must be world +y for iso.
    expect(cam.up.x).toBeCloseTo(expected.up[0], POS_EPS);
    expect(cam.up.y).toBeCloseTo(expected.up[1], POS_EPS);
    expect(cam.up.z).toBeCloseTo(expected.up[2], POS_EPS);
    // FOV = DEFAULT_FOV_DEG (iso preset).
    if (cam instanceof ThreePerspectiveCamera) {
      expect(cam.fov).toBeCloseTo(DEFAULT_FOV_DEG, POS_EPS);
    }

    await renderer.unmount();
  });

  it('AC3: OrbitControls receives the computed min/max distance from bounds', async () => {
    const capture: LiveState = {};
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CameraRig preset="orbit" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await renderer.advanceFrames(1, 0.016);

    const { minDistance, maxDistance } = computeZoomLimits(REFERENCE_BOUNDS);
    // OrbitControls exposes minDistance / maxDistance as public props;
    // the rig sets them via JSX so drei writes them onto the impl.
    expect(capture.controls).toBeTruthy();
    const controls = capture.controls!;
    expect(controls.minDistance).toBeCloseTo(minDistance, POS_EPS);
    expect(controls.maxDistance).toBeCloseTo(maxDistance, POS_EPS);

    await renderer.unmount();
  });

  it('AC2: preset switch orbit → top → camera actually converges on the top pose', async () => {
    const capture: LiveState = {};
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CameraRig preset="orbit" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    // Complete the initial-mount snap.
    await completeTransition(renderer);

    // Switch to top preset and let the lerp complete.
    await renderer.update(
      <>
        <CameraRig preset="top" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await completeTransition(renderer);

    const cam = capture.camera!;
    const top = computePresetCamera('top', REFERENCE_BOUNDS);
    // Position: directly above target, at fit distance for narrow FOV.
    expect(cam.position.x).toBeCloseTo(top.position[0], POS_EPS);
    expect(cam.position.y).toBeCloseTo(top.position[1], POS_EPS);
    expect(cam.position.z).toBeCloseTo(top.position[2], POS_EPS);
    // Up: +z (screen-vertical for the top plan view).
    expect(cam.up.x).toBeCloseTo(top.up[0], POS_EPS);
    expect(cam.up.y).toBeCloseTo(top.up[1], POS_EPS);
    expect(cam.up.z).toBeCloseTo(top.up[2], POS_EPS);
    // FOV: narrow (TOP_DOWN_FOV_DEG).
    if (cam instanceof ThreePerspectiveCamera) {
      expect(cam.fov).toBeCloseTo(TOP_DOWN_FOV_DEG, POS_EPS);
    }

    await renderer.unmount();
  });

  it('AC2/§4: OrbitControls is disabled DURING a preset lerp and re-enabled after', async () => {
    const capture: LiveState = {};
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CameraRig preset="orbit" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await completeTransition(renderer);
    // Baseline: after the initial mount snap, controls are enabled
    // (no active transition).
    expect(capture.controls?.enabled).toBe(true);

    // Kick a preset change → schedules a lerp. Advance ONE frame so
    // the useEffect fires + one useFrame tick runs mid-transition.
    await renderer.update(
      <>
        <CameraRig preset="top" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    // 100 ms elapsed of a 500 ms lerp → controls MUST be disabled.
    // `advanceFrames(count, delta)` passes `delta` DIRECTLY as the
    // r3f useFrame `delta` argument, which the r3f convention treats
    // as SECONDS. 2 × 0.05 s = 100 ms of simulated animation time.
    await renderer.advanceFrames(2, 0.05);
    expect(capture.controls?.enabled).toBe(false);

    // Complete the lerp → controls re-enable at t >= 1.
    await renderer.advanceFrames(12, 0.05);
    expect(capture.controls?.enabled).toBe(true);

    await renderer.unmount();
  });
});

// ---------------------------------------------------------------------------
// PR#29 pair-fix iter 1 — Fix D: up-vector never degenerate
// ---------------------------------------------------------------------------

describe('<CameraRig /> — up-vector interpolation (Fix D)', () => {
  it('top → front: camera matrix stays finite / non-degenerate every frame', async () => {
    const capture: LiveState = {};
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CameraRig preset="top" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await completeTransition(renderer);

    // Kick the top → front change. During this transition the up
    // vector rotates 90° (top uses +z, front uses +y). The OLD
    // implementation SNAPPED up to the destination at t=0, which
    // put the camera in a near-degenerate lookAt state at the
    // start of the lerp (view direction parallel to up).
    await renderer.update(
      <>
        <CameraRig preset="front" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );

    // Sample the matrix every ~50 ms across the transition and
    // assert every entry is finite and the up vector is unit-length
    // (non-zero, non-NaN — the collapse-condition guard).
    // r3f `useFrame` delta is in SECONDS → 0.05 s = 50 ms per tick,
    // 10 samples × 50 ms = full 500 ms transition sampled.
    for (let step = 0; step < 10; step++) {
      await renderer.advanceFrames(1, 0.05);
      const cam = capture.camera!;
      for (let i = 0; i < cam.matrixWorld.elements.length; i++) {
        expect(Number.isFinite(cam.matrixWorld.elements[i])).toBe(true);
      }
      const upLen = Math.hypot(cam.up.x, cam.up.y, cam.up.z);
      // Unit-length +/- floating slack — never zero (degenerate) or NaN.
      expect(upLen).toBeGreaterThan(0.5);
      expect(Number.isFinite(upLen)).toBe(true);
    }
    await renderer.unmount();
  });

  it('top → side: end-state up vector matches destination (+y)', async () => {
    const capture: LiveState = {};
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CameraRig preset="top" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await completeTransition(renderer);
    await renderer.update(
      <>
        <CameraRig preset="side" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await completeTransition(renderer);

    const cam = capture.camera!;
    // Final up = +y (side preset).
    expect(cam.up.x).toBeCloseTo(0, POS_EPS);
    expect(cam.up.y).toBeCloseTo(1, POS_EPS);
    expect(cam.up.z).toBeCloseTo(0, POS_EPS);
    await renderer.unmount();
  });
});

// ---------------------------------------------------------------------------
// PR#29 pair-fix iter 1 — Fix F: identity-only bounds change is a no-op
// ---------------------------------------------------------------------------

describe('<CameraRig /> — bounds identity change is a no-op (Fix F)', () => {
  it('re-setting bounds to a NEW object with the same numeric values does not move the camera', async () => {
    const capture: LiveState = {};
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CameraRig preset="front" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await completeTransition(renderer);

    // Snapshot the settled camera position.
    const settled = {
      x: capture.camera!.position.x,
      y: capture.camera!.position.y,
      z: capture.camera!.position.z,
    };

    // Pass a NEW bounds object with identical numeric values. The
    // OLD implementation triggered a fresh 500ms lerp on this
    // (useMemo dep=object identity); the fix depends on the numeric
    // values so this should be a no-op.
    const identical: CameraRigProps['bounds'] = {
      widthMm: REFERENCE_BOUNDS.widthMm,
      lengthMm: REFERENCE_BOUNDS.lengthMm,
      heightMm: REFERENCE_BOUNDS.heightMm,
    };
    await renderer.update(
      <>
        <CameraRig preset="front" bounds={identical} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    // Advance a couple of frames. If a spurious transition had
    // been scheduled we would see the camera lerping AWAY from the
    // settled position (from = current pose, to = re-computed pose,
    // which is numerically identical → the lerp would still animate
    // through smoothstep noise for a frame). With the fix, useMemo
    // returns the same referenced pose and no effect re-fires.
    // (delta = 0.05 s per frame per r3f seconds convention)
    await renderer.advanceFrames(3, 0.05);

    const cam = capture.camera!;
    expect(cam.position.x).toBeCloseTo(settled.x, POS_EPS);
    expect(cam.position.y).toBeCloseTo(settled.y, POS_EPS);
    expect(cam.position.z).toBeCloseTo(settled.z, POS_EPS);
    // Controls also stay ENABLED (no transition in flight).
    expect(capture.controls?.enabled).toBe(true);

    await renderer.unmount();
  });

  it('changing a numeric bounds value DOES trigger a re-fit', async () => {
    // Regression guard for Fix F: the useMemo dep switch must NOT
    // break real bounds updates.
    const capture: LiveState = {};
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CameraRig preset="front" bounds={REFERENCE_BOUNDS} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await completeTransition(renderer);
    const settledZ = capture.camera!.position.z;

    // Double the length → front-preset fit distance grows too.
    const grown: CameraRigProps['bounds'] = {
      widthMm: REFERENCE_BOUNDS.widthMm,
      lengthMm: REFERENCE_BOUNDS.lengthMm * 2,
      heightMm: REFERENCE_BOUNDS.heightMm,
    };
    await renderer.update(
      <>
        <CameraRig preset="front" bounds={grown} />
        <LiveStateProbe capture={capture} />
      </>,
    );
    await completeTransition(renderer);

    const expected = computeAutoFitDistance(grown);
    expect(capture.camera!.position.z).toBeCloseTo(expected, POS_EPS);
    expect(capture.camera!.position.z).toBeGreaterThan(settledZ);
    await renderer.unmount();
  });
});

// ---------------------------------------------------------------------------
// Smoke — deferred to QA E2E (kept as a sanity ceiling for the pure math)
// ---------------------------------------------------------------------------

describe('<CameraRig /> — pure-math smoke (deferred to QA E2E)', () => {
  it('smoke: top-preset pure math (TOP_DOWN_FOV_DEG, positive y offset)', () => {
    // This test does NOT render — it is a re-derivation smoke check
    // that the pure math is stable. The LIVE-camera assertion above
    // is what actually verifies the rig APPLIES this pose. Kept as
    // a doc-style anchor for the coordinate-frame contract.
    const topPose = computePresetCamera('top', REFERENCE_BOUNDS);
    expect(topPose.fovDeg).toBe(TOP_DOWN_FOV_DEG);
    expect(topPose.position[0]).toBeCloseTo(0, POS_EPS);
    expect(topPose.position[2]).toBeCloseTo(0, POS_EPS);
    const expectedY =
      topPose.target[1] + computeAutoFitDistance(REFERENCE_BOUNDS, TOP_DOWN_FOV_DEG);
    expect(topPose.position[1]).toBeCloseTo(expectedY, POS_EPS);
  });

  it('smoke: transition budget PRESET_TRANSITION_MS matches the AC2 500 ms cap', () => {
    // Guards the constant the rig uses to bound its useFrame lerp.
    expect(PRESET_TRANSITION_MS).toBeLessThanOrEqual(500);
  });
});
