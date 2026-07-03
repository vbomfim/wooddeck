/**
 * `src/scene/CameraRig.tsx` — camera positioning + preset transitions.
 *
 * ## Responsibility (single)
 *
 * The rig owns EVERY camera-related concern for `<DeckScene>`:
 *
 *   - Applies the initial auto-fit pose on mount / bounds change (AC4).
 *   - Mounts drei's `<OrbitControls>` so the user gets free
 *     orbit / zoom / pan (AC3).
 *   - Interpolates the camera position + target + FOV smoothly to
 *     the pose the current `preset` prop requests (AC2), completing
 *     within `PRESET_TRANSITION_MS` (≤ 500 ms).
 *
 * It owns NO geometry, NO lighting, NO layer visibility. Those live
 * outside the rig so the whole file stays rewritable from its props
 * + the pure `computePresetCamera` contract.
 *
 * ## Why NOT drei's `<CameraControls>` (ticket §17 trade-off)
 *
 * `CameraControls` from drei gives cinematic tweening for free, but
 * its API surface is larger and its animation model needs a
 * dedicated `useControls` hook + a manual "flying" flag to disable
 * user input mid-transition. `OrbitControls` + a `useFrame` lerp is
 * ~30 lines and lets us hard-code the AC2 500 ms budget. Ticket
 * §17 records the trade-off and picks this simpler shape.
 *
 * ## Why the lerp uses a REF-driven progress, not React state
 *
 * `useFrame` runs on every render tick (~60 Hz). Updating React
 * state inside it would trigger a re-render on every frame — a
 * catastrophic performance cost given the NFR-003 30 FPS floor.
 * We keep the transition state in a `useRef` object; React never
 * re-renders during a preset lerp.
 *
 * ## Pure math vs r3f-touching code
 *
 * Every numerical claim about WHERE the camera sits (positions,
 * distances, up vectors, FOVs) is delegated to
 * `./camera-presets.ts`, a framework-free module unit-tested in
 * isolation. This file only carries the plumbing: r3f context
 * access, three.js Vector3 mutation, and the lerp bookkeeping.
 *
 * ## Coordinate frame contract
 *
 * Every `[x, y, z]` tuple this file accepts / emits is in the same
 * world frame as `src/domain/model.ts` §"LAYOUT COORDINATE FRAME":
 * +x width, +y up, +z length, origin ground-level centre. The rig
 * relies on that contract to place the camera; violating it in the
 * layout engine would show up as an inverted preset (e.g., top view
 * looking UP instead of down).
 */
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MathUtils, PerspectiveCamera as ThreePerspectiveCamera, Vector3 } from 'three';
import type { Camera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import {
  PRESET_TRANSITION_MS,
  computePresetCamera,
  computeZoomLimits,
  type BoundsMm,
  type CameraPose,
  type CameraPreset,
} from './camera-presets';

/**
 * Public props — mirrors the issue #10 §2 interface contract.
 */
export interface CameraRigProps {
  readonly preset: CameraPreset;
  readonly bounds: BoundsMm;
}

/**
 * Per-transition scratch: holds the animation start-time, start
 * pose, and target pose. `null` when no transition is active.
 * Kept in a ref so `useFrame` mutations never trigger a React
 * re-render.
 */
interface TransitionState {
  readonly startMs: number;
  readonly durationMs: number;
  readonly from: CameraPose;
  readonly to: CameraPose;
}

/**
 * Smoothstep-ish easing for the preset lerp. `MathUtils.smoothstep`
 * gives a C1-continuous ease-in-out over [0, 1] — soft acceleration
 * and deceleration mean the camera never JOLTS to the new pose,
 * which reads as more responsive than a hard linear ramp.
 */
function easeInOut(t: number): number {
  return MathUtils.smoothstep(t, 0, 1);
}

/**
 * Linear interpolation on a 3-tuple. Kept local (not exported from
 * camera-presets) because it's a tiny helper and camera-presets
 * intentionally exports POSES, not lerp primitives.
 */
function lerpTuple(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * `<CameraRig>` — see module header for behaviour. Mounts once per
 * `<DeckScene>` mount; internally re-computes poses on prop change.
 */
export function CameraRig({ preset, bounds }: CameraRigProps): JSX.Element {
  // The r3f-managed default camera. We assert PerspectiveCamera —
  // r3f's default is always perspective unless overridden on Canvas
  // (we don't override, so this is safe).
  const camera = useThree((state) => state.camera);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // Compute the target pose for the current (preset, bounds) pair.
  // Memoised so the useEffect below only triggers a NEW transition
  // when the pose actually changes (a bounds update that leaves the
  // preset pose numerically identical is a no-op).
  const targetPose = useMemo(() => computePresetCamera(preset, bounds), [preset, bounds]);

  // AC3: zoom limits — derived from bounds so the orbit range scales
  // with deck size.
  const { minDistance, maxDistance } = useMemo(() => computeZoomLimits(bounds), [bounds]);

  // Transition scratch — see comment on TransitionState. `null`
  // when no transition is active; useEffect below fills it in on
  // targetPose change; useFrame drains it as time passes.
  const transitionRef = useRef<TransitionState | null>(null);

  // Snap the camera to the initial pose on mount. Subsequent
  // targetPose changes schedule a smooth lerp; the very FIRST mount
  // has no "from" state — the camera hasn't been positioned yet —
  // so we set it directly to skip the transition.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      applyPose(camera, targetPose);
      controlsRef.current?.target.set(...targetPose.target);
      controlsRef.current?.update();
      initializedRef.current = true;
      return;
    }
    // Subsequent (preset OR bounds) change → start a lerp from the
    // camera's CURRENT pose to the new target pose.
    const from: CameraPose = readCurrentPose(camera, controlsRef.current);
    transitionRef.current = {
      startMs: performance.now(),
      durationMs: PRESET_TRANSITION_MS,
      from,
      to: targetPose,
    };
  }, [camera, targetPose]);

  // Drive the lerp on every frame while a transition is active.
  useFrame(() => {
    const tx = transitionRef.current;
    if (!tx) return;
    const elapsed = performance.now() - tx.startMs;
    const t = Math.min(1, elapsed / tx.durationMs);
    const eased = easeInOut(t);

    const pose: CameraPose = {
      position: lerpTuple(tx.from.position, tx.to.position, eased),
      target: lerpTuple(tx.from.target, tx.to.target, eased),
      up: tx.to.up, // up vector doesn't lerp cleanly — snap on start
      fovDeg: tx.from.fovDeg + (tx.to.fovDeg - tx.from.fovDeg) * eased,
    };
    applyPose(camera, pose);
    if (controlsRef.current) {
      controlsRef.current.target.set(...pose.target);
      controlsRef.current.update();
    }

    if (t >= 1) {
      transitionRef.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      // makeDefault registers this as the primary controls instance
      // so any drei helper that needs the "active controls" (e.g.,
      // future TransformControls in the parameter panel) finds it.
      makeDefault
      // AC3: dolly / zoom range derived from bounds.
      minDistance={minDistance}
      maxDistance={maxDistance}
      // Damping = smoother orbit feel without extra state. Cheap.
      enableDamping
      // AC3: MMB pan is enabled by default in drei's OrbitControls;
      // we explicitly enable pan + zoom for defensive clarity.
      enablePan
      enableZoom
      enableRotate
    />
  );
}

// ---------------------------------------------------------------------------
// Private plumbing — three.js touching code, kept below the public API
// ---------------------------------------------------------------------------

/**
 * Mutate the r3f-managed camera to match a {@link CameraPose}.
 * Handles the perspective-camera-specific FOV update and asks
 * three.js to recompute its projection matrix.
 */
function applyPose(camera: Camera, pose: CameraPose): void {
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  camera.lookAt(new Vector3(...pose.target));
  if (camera instanceof ThreePerspectiveCamera) {
    // Only PerspectiveCamera has `.fov`; guarding keeps a future
    // Ortho-camera swap from crashing here.
    camera.fov = pose.fovDeg;
    camera.updateProjectionMatrix();
  }
}

/**
 * Snapshot the camera's current world pose so the lerp has a
 * defined "from" state. The controls target (if any) is used as
 * the pose target — it's the user's current focus point, which
 * gives a natural transition.
 */
function readCurrentPose(camera: Camera, controls: OrbitControlsImpl | null): CameraPose {
  const target: readonly [number, number, number] = controls
    ? [controls.target.x, controls.target.y, controls.target.z]
    : [0, 0, 0];
  const fovDeg = camera instanceof ThreePerspectiveCamera ? camera.fov : 45;
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target,
    up: [camera.up.x, camera.up.y, camera.up.z],
    fovDeg,
  };
}
