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
 *   - Interpolates the camera position + target + FOV + UP vector
 *     smoothly to the pose the current `preset` prop requests
 *     (AC2), completing within `PRESET_TRANSITION_MS` (≤ 500 ms).
 *   - Disables `<OrbitControls>` for the duration of a preset lerp
 *     so user input does not race the animation (§4 edge case).
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
 * ## Up-vector nlerp (PR#29 pair-fix iter 1 — Fix D)
 *
 * Snapping `up` to the destination at t=0 broke top↔front and
 * top↔side transitions: the initial camera position (still at the
 * source pose) combined with the destination `up` produces a
 * degenerate `lookAt` (view direction parallel to up), which
 * yields a NaN camera matrix for one frame. The fix normalised-
 * linear-interpolates (nlerp) the up vector between `from.up`
 * and `to.up`. All wooddeck presets use orthogonal or identical
 * ups so nlerp is safe (it fails only on anti-parallel vectors —
 * we don't have those).
 *
 * ## useMemo bounds identity (PR#29 pair-fix iter 1 — Fix F)
 *
 * The store returns a NEW `bounds` OBJECT on every layout recompute
 * even when the numeric values are unchanged (e.g. the user
 * toggles decking orientation). Depending on the object REFERENCE
 * in `useMemo` would schedule a pointless 500 ms lerp per edit.
 * The fix depends on the numeric VALUES so a same-numeric bounds
 * update is a no-op.
 *
 * ## Controls disabled during transition (PR#29 pair-fix iter 1 — Fix E)
 *
 * Ticket §4 edge case: "Preset change during ongoing orbit →
 * cancel the orbit gesture; complete the preset transition." We
 * flip `controls.enabled = false` at transition start and back to
 * `true` at completion (also on unmount). Two writers on
 * `camera.position` / `.target` would otherwise race.
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
 * +x width, +y up, +z length, origin ground-level centre.
 */
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MathUtils, PerspectiveCamera as ThreePerspectiveCamera } from 'three';
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
 * Per-transition scratch: holds the elapsed animation time, start
 * pose, and target pose. `null` when no transition is active.
 * Kept in a ref so `useFrame` mutations never trigger a React
 * re-render.
 *
 * ## Why `elapsedMs` accumulates from `useFrame`'s delta
 *
 * The natural choice would be `startMs = performance.now()` +
 * `elapsed = now - startMs`. That works in real browsers but
 * `performance.now()` does NOT advance with r3f test-renderer's
 * `advanceFrames(count, deltaMs)`, which drives a SIMULATED clock.
 * Accumulating the useFrame `delta` argument (per-tick simulated
 * seconds) makes the lerp progress deterministically in tests AND
 * frame-rate-adapt in production — a 30 FPS frame reports twice
 * the delta of a 60 FPS frame, so a slower machine still completes
 * the animation in ~500 ms of wall clock.
 */
interface TransitionState {
  elapsedMs: number;
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
 * `<CameraRig>` — see module header for behaviour. Mounts once per
 * `<DeckScene>` mount; internally re-computes poses on prop change.
 */
export function CameraRig({ preset, bounds }: CameraRigProps): JSX.Element {
  // The r3f-managed default camera. We assert PerspectiveCamera —
  // r3f's default is always perspective unless overridden on Canvas
  // (we don't override, so this is safe).
  const camera = useThree((state) => state.camera);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // Fix F: depend on the numeric VALUES, not the object identity.
  // The store issues a NEW `bounds` object on every layout recompute
  // even when the numbers are unchanged (e.g. after a decking-
  // orientation toggle) — an identity-based dep would schedule a
  // pointless 500 ms lerp every edit.
  const { widthMm, lengthMm, heightMm } = bounds;
  const targetPose = useMemo(
    () => computePresetCamera(preset, { widthMm, lengthMm, heightMm }),
    [preset, widthMm, lengthMm, heightMm],
  );

  // AC3: zoom limits — derived from bounds so the orbit range scales
  // with deck size. Same numeric-value dep as above (Fix F).
  const { minDistance, maxDistance } = useMemo(
    () => computeZoomLimits({ widthMm, lengthMm, heightMm }),
    [widthMm, lengthMm, heightMm],
  );

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
      if (controlsRef.current) {
        controlsRef.current.target.set(...targetPose.target);
        controlsRef.current.update();
      }
      initializedRef.current = true;
      return;
    }
    // Subsequent (preset OR numeric-value bounds) change → start a
    // lerp from the camera's CURRENT pose to the new target pose.
    const from: CameraPose = readCurrentPose(camera, controlsRef.current);
    transitionRef.current = {
      elapsedMs: 0,
      durationMs: PRESET_TRANSITION_MS,
      from,
      to: targetPose,
    };
    // Fix E: disable user input for the duration of the animation
    // so OrbitControls' drag / zoom handlers don't race the useFrame
    // lerp writing to the same camera state.
    if (controlsRef.current) {
      controlsRef.current.enabled = false;
    }
  }, [camera, targetPose]);

  // Fix E: on unmount, re-enable controls (defensive — if the rig
  // unmounts mid-transition, leaving `controls.enabled = false`
  // would strand a NEW rig with disabled controls if it were
  // mounted around the same time).
  useEffect(() => {
    const controls = controlsRef.current;
    return () => {
      if (controls) {
        controls.enabled = true;
      }
    };
  }, []);

  // Drive the lerp on every frame while a transition is active.
  // Zero per-frame allocation: no new Vector3 / Array / Object.
  // `delta` is the SIMULATED frame delta in seconds (advances via
  // `renderer.advanceFrames(count, dtMs)` in tests, real wall
  // clock in production) — accumulating it into `tx.elapsedMs`
  // gives us deterministic progress in tests without a real timer.
  useFrame((_state, delta) => {
    const tx = transitionRef.current;
    if (!tx) return;
    tx.elapsedMs += delta * 1000;
    const t = Math.min(1, tx.elapsedMs / tx.durationMs);
    const eased = easeInOut(t);

    // Position lerp — write directly to the camera without allocating.
    const px = tx.from.position[0] + (tx.to.position[0] - tx.from.position[0]) * eased;
    const py = tx.from.position[1] + (tx.to.position[1] - tx.from.position[1]) * eased;
    const pz = tx.from.position[2] + (tx.to.position[2] - tx.from.position[2]) * eased;

    // Target lerp — used for lookAt AND for the controls target.
    const tgx = tx.from.target[0] + (tx.to.target[0] - tx.from.target[0]) * eased;
    const tgy = tx.from.target[1] + (tx.to.target[1] - tx.from.target[1]) * eased;
    const tgz = tx.from.target[2] + (tx.to.target[2] - tx.from.target[2]) * eased;

    // Fix D: nlerp the up vector (normalised linear interpolation).
    // Snapping to `to.up` at t=0 broke top↔front / top↔side
    // transitions because the source-pose camera + destination-up
    // produced a near-degenerate lookAt. nlerp is safe here because
    // every wooddeck preset up is orthogonal or identical to every
    // other — nlerp fails only on ANTI-parallel vectors.
    let ux = tx.from.up[0] + (tx.to.up[0] - tx.from.up[0]) * eased;
    let uy = tx.from.up[1] + (tx.to.up[1] - tx.from.up[1]) * eased;
    let uz = tx.from.up[2] + (tx.to.up[2] - tx.from.up[2]) * eased;
    const upLen = Math.hypot(ux, uy, uz);
    if (upLen < 1e-6) {
      // Anti-parallel or degenerate — snap to destination.
      ux = tx.to.up[0];
      uy = tx.to.up[1];
      uz = tx.to.up[2];
    } else {
      ux /= upLen;
      uy /= upLen;
      uz /= upLen;
    }

    // FOV lerp — perspective cameras only.
    const fovDeg = tx.from.fovDeg + (tx.to.fovDeg - tx.from.fovDeg) * eased;

    // Apply, in order: up (before lookAt so the view is oriented
    // correctly), position, lookAt, then FOV update.
    camera.up.set(ux, uy, uz);
    camera.position.set(px, py, pz);
    // `Camera.lookAt(x, y, z)` accepts numbers — no Vector3
    // allocation.
    camera.lookAt(tgx, tgy, tgz);
    if (camera instanceof ThreePerspectiveCamera) {
      camera.fov = fovDeg;
      camera.updateProjectionMatrix();
    }
    if (controlsRef.current) {
      controlsRef.current.target.set(tgx, tgy, tgz);
      controlsRef.current.update();
    }

    if (t >= 1) {
      transitionRef.current = null;
      // Fix E: re-enable user input now that the animation
      // completed. If controls unmounted mid-transition the
      // useEffect cleanup above has already handled it.
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      // makeDefault registers this as the primary controls instance
      // so any drei helper that needs the "active controls" (e.g.,
      // future TransformControls in the parameter panel) finds it.
      // Also puts the impl on `state.controls` for downstream
      // consumers via useThree(s => s.controls).
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
 * three.js to recompute its projection matrix. Called ONCE per
 * bounds / preset change from `useEffect`; the per-frame lerp
 * body applies its interpolated pose inline (no allocation).
 */
function applyPose(camera: Camera, pose: CameraPose): void {
  camera.up.set(...pose.up);
  camera.position.set(...pose.position);
  camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
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
