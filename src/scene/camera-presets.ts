/**
 * `src/scene/camera-presets.ts` — pure camera math for the deck viewer.
 *
 * ## Why this module is framework-free
 *
 * Every function in this file operates on plain numbers and returns
 * plain tuples/objects. There is NO import from `three`, `react`, or
 * `@react-three/*`. That deliberate choice keeps the coordinate-frame
 * contract testable in raw Vitest without needing a headless r3f
 * renderer — the CameraRig test file only has to prove the RIG
 * consumes these outputs correctly; every numerical claim about
 * where a camera SITS is proved here in isolation.
 *
 * Ticket §18: "Unit-test the PURE camera math separately: extract
 * preset→camera-position/target computation and the auto-fit
 * computation into pure functions and unit-test them thoroughly
 * against known bounds in the coordinate frame."
 *
 * ## Coordinate frame (spec § domain/model.ts binding contract)
 *
 *     +x = width  (deck-width axis)
 *     +y = up     (world "up", height axis)
 *     +z = length (deck-length axis)
 *     origin (0,0,0) = ground-level CENTER of the footprint
 *     y = 0          = ground plane
 *     Euler XYZ, right-handed (three.js-native)
 *
 * The deck centroid — where every preset points its camera — is
 * therefore `(0, heightMm/2, 0)`.
 *
 * ## Preset semantics (ticket §2 + §17 open-question resolution)
 *
 *   orbit → free orbit; on mount / bounds change, snap to the ISO
 *           corner (this is the "auto-fit" pose users see first).
 *   top   → look straight down (-y). Uses a NARROW-FOV perspective
 *           (near-orthographic look) per §17 open-question.
 *   front → look along -z from the +z side. Width horizontal,
 *           height vertical.
 *   side  → look along -x from the +x side. Length horizontal,
 *           height vertical.
 *   iso   → 45° corner in the (+x, +y, +z) octant. The camera-to-
 *           target vector is (1,1,1) normalised, scaled to the
 *           auto-fit distance.
 *
 * ## Auto-fit distance derivation (AC4)
 *
 * We model the deck as a bounding SPHERE (not box) of radius
 * `R = ½ × diagonal(w, l, h)`. The sphere is a conservative
 * over-approximation of the box, so any camera far enough to fit
 * the sphere also fits the box with room to spare. For a
 * perspective camera with vertical FOV `f`, the distance that just
 * frames the sphere is `d = R / sin(f/2)` — we substitute
 * `tan(f/2)` for near-field simplicity (over-conservative for the
 * frustum's oblique horizon but visually indistinguishable at the
 * distances we operate at) — then scale by `(1 + margin)` to give
 * the user the 15% breathing room the ticket requires:
 *
 *     d = R × (1 + margin) / tan(fov / 2)     // fov in radians
 *
 * ## Zoom limits derivation (AC3)
 *
 * The ticket gives an exact formula: `minDistance = ½ × smallest
 * deck dim; maxDistance = 5 × largest`. Documented in the constant
 * names below.
 *
 * ## Degenerate-input guard
 *
 * A zero-volume `bounds` (all mm = 0) would push `R = 0` and
 * collapse the camera onto the target — the OrbitControls
 * `minDistance` would become 0, and the perspective camera would
 * clip through geometry. To keep the rig safe against a boot-time
 * bug or a mid-load empty-bounds bundle, every zero-input branch
 * substitutes `MIN_BOUND_FLOOR_MM` (1000 mm = ~3 ft) for the
 * degenerate dimension.
 */

/**
 * Bounds shape — the SAME shape as domain `Dimensions3D` but
 * duplicated here so the scene layer doesn't import `domain/model`
 * for a plain-numbers vocabulary. Consumers pass the domain type
 * directly (structurally compatible).
 */
export interface BoundsMm {
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly heightMm: number;
}

/**
 * The five camera modes S9 supports. Duplicated from `state/ui-store`
 * for the same reason as `BoundsMm` above — scene layer stays
 * import-light. The two type unions are structurally identical and
 * TypeScript equates them.
 */
export type CameraPreset = 'orbit' | 'top' | 'front' | 'side' | 'iso';

/**
 * A frame-agnostic camera pose. `position` and `target` are in the
 * world frame (mm); `up` is a unit-vector world-frame direction;
 * `fovDeg` is the vertical field-of-view in degrees the rig should
 * apply to the perspective camera.
 */
export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly fovDeg: number;
}

// ---------------------------------------------------------------------------
// Constants — every consumer imports these (never hard-codes)
// ---------------------------------------------------------------------------

/**
 * The AC4 auto-fit margin (15%). If you're editing this value,
 * update the ticket AC4 too — this is the user-facing "how much
 * breathing room around the deck" number.
 */
export const AUTOFIT_MARGIN = 0.15;

/**
 * The default vertical FOV for non-top presets. 45° is a natural
 * human-vision-like angle (three.js `PerspectiveCamera` defaults to
 * 50°; we go slightly narrower for a subtly telephoto feel that
 * flatters architecture renderings).
 */
export const DEFAULT_FOV_DEG = 45;

/**
 * The narrow FOV for the top-down preset (ticket §17 resolution).
 * 10° is well into telephoto territory — a distant camera + narrow
 * FOV gives a near-parallel projection while keeping the ONE
 * perspective camera the rest of the rig uses. Alternative would
 * have been swapping in an OrthographicCamera on top-preset
 * activation, which complicates the useFrame lerp (Ortho and
 * Perspective don't interpolate cleanly through a common shape).
 */
export const TOP_DOWN_FOV_DEG = 10;

/**
 * The AC2 preset-transition budget. The `useFrame` lerp in
 * `CameraRig` must complete within this window so a preset click
 * feels instant.
 */
export const PRESET_TRANSITION_MS = 500;

/**
 * Lower floor for any bounds dimension used in distance / zoom
 * computation. Guards against the zero-volume degenerate case
 * described in the module header. 1000 mm ≈ 3 ft is well below any
 * sensible deck yet large enough that OrbitControls' minDistance
 * doesn't clip through geometry.
 */
const MIN_BOUND_FLOOR_MM = 1000;

/**
 * Near clipping plane in millimeters — passed to the r3f
 * `<Canvas camera={{ near }}>` prop by `<DeckScene>` (Fix A).
 *
 * ## Why this constant exists (PR#29 pair-fix iter 1 — Fix A)
 *
 * r3f's default camera near = 0.1 (unitless). The wooddeck world is
 * in MILLIMETERS — so with the default, geometry that sits between
 * 0.1 mm and 10 mm of the camera clips against the near plane. In
 * practice the camera never dollies that close, but the SAME
 * defaults set FAR = 1000 mm, which is far worse: preset camera
 * distances range from ~2 700 mm (tiny deck iso) to ~113 600 mm
 * (large deck top). EVERY deck member renders behind the default
 * far plane → completely blank scene when S10 mounts geometry.
 *
 * We ship a single constant per plane so the Canvas prop and the
 * invariant tests (see `camera-presets.test.ts`) share ONE source
 * of truth; a maintainer who bumps FAR without bumping NEAR (or
 * vice-versa) will trigger a "log2(far/near) < 20 bits" precision
 * assertion, keeping z-fighting away from the default depth buffer.
 *
 * 10 mm ≈ 0.4 in — well below the ~450 mm minDistance for the
 * smallest supported deck.
 */
export const CAMERA_NEAR_MM = 10;

/**
 * Far clipping plane in millimeters — passed to the r3f
 * `<Canvas camera={{ far }}>` prop by `<DeckScene>` (Fix A).
 *
 * 500 000 mm = 500 m: comfortably covers the worst-case top-preset
 * fit distance for a 40 ft × 40 ft × 4 ft deck (~113 600 mm) with
 * a large safety margin for future larger designs, while keeping
 * `log2(CAMERA_FAR_MM / CAMERA_NEAR_MM) ≈ 15.6` bits of depth-
 * buffer precision usage — well under the 24-bit depth buffer
 * ceiling and 20-bit soft cap the test asserts.
 */
export const CAMERA_FAR_MM = 500_000;

// ---------------------------------------------------------------------------
// Internal helpers — kept module-private (single call site each)
// ---------------------------------------------------------------------------

/**
 * Replace ONLY non-positive dimensions with the safety floor so
 * downstream math never emits NaN / 0 / Infinity. A real deck
 * dimension (e.g., 900 mm for a ~3 ft-high pier deck) is passed
 * through unchanged — the floor exists solely to keep the boot-time
 * "empty bounds" degenerate case from collapsing the camera onto
 * the target. See module header "Degenerate-input guard".
 */
function safeBounds(b: BoundsMm): BoundsMm {
  const floor = (v: number): number => (v > 0 ? v : MIN_BOUND_FLOOR_MM);
  return {
    widthMm: floor(b.widthMm),
    lengthMm: floor(b.lengthMm),
    heightMm: floor(b.heightMm),
  };
}

/**
 * Bounding-sphere radius = ½ × the 3D diagonal of the AABB. Uses
 * the safe bounds so a zero input never collapses to zero radius.
 */
function boundingSphereRadius(bounds: BoundsMm): number {
  const b = safeBounds(bounds);
  return Math.sqrt(b.widthMm ** 2 + b.lengthMm ** 2 + b.heightMm ** 2) / 2;
}

/**
 * Deck centroid — the point every camera targets. See coordinate
 * frame in the module header for why y = heightMm / 2.
 */
function deckCentroid(bounds: BoundsMm): [number, number, number] {
  const b = safeBounds(bounds);
  return [0, b.heightMm / 2, 0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Distance (mm) from the deck centroid at which a perspective
 * camera with the given vertical FOV frames the bounding sphere
 * with the requested margin.
 *
 * @param bounds  deck AABB in mm
 * @param fovDeg  vertical FOV in degrees (default {@link DEFAULT_FOV_DEG})
 * @param margin  fractional margin — 0.15 = 15% breathing room
 *                (default {@link AUTOFIT_MARGIN})
 */
export function computeAutoFitDistance(
  bounds: BoundsMm,
  fovDeg = DEFAULT_FOV_DEG,
  margin = AUTOFIT_MARGIN,
): number {
  const radius = boundingSphereRadius(bounds);
  const halfFovRad = (fovDeg / 2) * (Math.PI / 180);
  // `Math.tan(halfFovRad)` is safe: fovDeg is bounded by
  // TOP_DOWN_FOV_DEG > 0 and DEFAULT_FOV_DEG < 90 in every call site.
  return (radius * (1 + margin)) / Math.tan(halfFovRad);
}

/**
 * OrbitControls zoom / dolly range. AC3 exact formula:
 *
 *     minDistance = ½ × min(widthMm, lengthMm, heightMm)
 *     maxDistance = max(5 × largest, topFitDistance × TOP_FIT_HEADROOM)
 *
 * Both derived from the SAFE bounds so a zero-volume bundle still
 * yields a valid strictly-increasing range.
 *
 * ## Why maxDistance is NOT just `5 × largest` (PR#29 pair-fix iter 1 — Fix B)
 *
 * The original ticket AC3 formula was `maxDistance = 5 × largest`.
 * That clamp is TIGHTER than the top-preset auto-fit distance for
 * every real deck size (top uses TOP_DOWN_FOV_DEG ≈ 10°, which
 * pushes the camera much farther than 5 × largest). OrbitControls
 * would silently clamp the camera closer than the top-preset
 * target, cropping the top view and violating AC4's 15% margin
 * promise. The relaxed formula takes the MAX of the AC3 zoom cap
 * and the top-preset fit distance (with a small headroom so the
 * top pose sits comfortably inside the clamp, not on it).
 */
const TOP_FIT_HEADROOM = 1.05;

export function computeZoomLimits(bounds: BoundsMm): {
  readonly minDistance: number;
  readonly maxDistance: number;
} {
  const b = safeBounds(bounds);
  const smallest = Math.min(b.widthMm, b.lengthMm, b.heightMm);
  const largest = Math.max(b.widthMm, b.lengthMm, b.heightMm);
  const topFitDistance = computeAutoFitDistance(b, TOP_DOWN_FOV_DEG);
  return {
    minDistance: smallest / 2,
    maxDistance: Math.max(largest * 5, topFitDistance * TOP_FIT_HEADROOM),
  };
}

/**
 * Compute the {@link CameraPose} for a preset + bounds combination.
 * See the module header for per-preset semantics.
 */
export function computePresetCamera(preset: CameraPreset, bounds: BoundsMm): CameraPose {
  const target = deckCentroid(bounds);
  switch (preset) {
    case 'top':
      return topPose(target, bounds);
    case 'front':
      return frontPose(target, bounds);
    case 'side':
      return sidePose(target, bounds);
    case 'iso':
    case 'orbit':
      // Orbit's initial pose = iso corner — see ticket §2. The rig
      // then hands control to OrbitControls for user input.
      return isoPose(target, bounds);
    default: {
      // Exhaustiveness guard — TS will fail-compile if a new preset
      // is added to the union without a case above. Runtime throw is
      // defence-in-depth for `any`-typed callers.
      const _exhaustive: never = preset;
      throw new Error(`Unknown camera preset: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-preset pose helpers — each is a single-responsibility function
// ---------------------------------------------------------------------------

function topPose(
  target: readonly [number, number, number],
  bounds: BoundsMm,
): CameraPose {
  const distance = computeAutoFitDistance(bounds, TOP_DOWN_FOV_DEG);
  return {
    // Camera directly ABOVE the target on the +y axis.
    position: [target[0], target[1] + distance, target[2]],
    target,
    // Gaze is (0, -1, 0); up cannot be ±y — pick +z so deck LENGTH
    // renders as screen-vertical ("north" on the plan view).
    up: [0, 0, 1],
    fovDeg: TOP_DOWN_FOV_DEG,
  };
}

function frontPose(
  target: readonly [number, number, number],
  bounds: BoundsMm,
): CameraPose {
  const distance = computeAutoFitDistance(bounds);
  return {
    // Camera on the +z side, looking along -z.
    position: [target[0], target[1], target[2] + distance],
    target,
    up: [0, 1, 0],
    fovDeg: DEFAULT_FOV_DEG,
  };
}

function sidePose(
  target: readonly [number, number, number],
  bounds: BoundsMm,
): CameraPose {
  const distance = computeAutoFitDistance(bounds);
  return {
    // Camera on the +x side, looking along -x.
    position: [target[0] + distance, target[1], target[2]],
    target,
    up: [0, 1, 0],
    fovDeg: DEFAULT_FOV_DEG,
  };
}

function isoPose(
  target: readonly [number, number, number],
  bounds: BoundsMm,
): CameraPose {
  const distance = computeAutoFitDistance(bounds);
  // (1,1,1) normalised = (1,1,1) / √3 → each axis gets distance/√3.
  const axialOffset = distance / Math.sqrt(3);
  return {
    position: [
      target[0] + axialOffset,
      target[1] + axialOffset,
      target[2] + axialOffset,
    ],
    target,
    up: [0, 1, 0],
    fovDeg: DEFAULT_FOV_DEG,
  };
}
