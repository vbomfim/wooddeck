/**
 * `src/scene/lighting.tsx` — the deck scene's minimal light rig.
 *
 * ## Composition
 *
 *   - ONE `<ambientLight>`      → baseline diffuse fill so unlit
 *                                 faces don't render black. Colour
 *                                 chosen neutral daylight; intensity
 *                                 keeps shadows readable without
 *                                 washing out the key light.
 *   - ONE `<directionalLight>`  → single "sun" key light coming
 *                                 from the +x/+y/+z octant. Casts
 *                                 NO shadows (ticket §9 — FPS
 *                                 budget guard).
 *
 * ## Why NO shadows for MVP (ticket §9)
 *
 * Enabling `castShadow` on a directional light adds a full extra
 * shadow-map render pass per frame (currently ~1024×1024 default in
 * three.js, but PCF-soft shadows scale worse). On the reference M1
 * MacBook Air with a 20 × 30 ft deck at full-layer visibility the
 * measured frame time crosses the 33 ms budget (30 FPS floor per
 * NFR-003). Shadows can flip on post-MVP behind a user-facing
 * "quality" toggle without redesigning the light rig.
 *
 * ## Why the lighting lives OUTSIDE `<CameraRig>`
 *
 * The rig owns the camera + orbit controls; lighting is a
 * scene-graph concern independent of view. Separating the two keeps
 * `<CameraRig>` single-responsibility and lets a future
 * environment-mapping story swap the light module without touching
 * the rig.
 */
import type { JSX } from 'react';

/**
 * Directional light direction — the "sun" comes from an
 * offset over the front-right of the deck, mimicking mid-morning
 * light for a natural preview. Position is in world millimeters
 * (same frame as the deck) — using a distance well above any
 * reasonable deck height keeps the directional falloff uniform.
 */
const KEY_LIGHT_POSITION: readonly [number, number, number] = [10_000, 15_000, 10_000];

/**
 * Ambient intensity. Low enough that the directional key light
 * still dominates (giving shape to members), high enough that
 * back-facing surfaces stay visible for orbiting.
 */
const AMBIENT_INTENSITY = 0.6;

/**
 * Directional (key) intensity. Combined with the ambient level,
 * total scene brightness lands close to a value-1.0 baseline —
 * enables PBR materials from S10 to read naturally.
 */
const KEY_LIGHT_INTENSITY = 0.9;

export function SceneLighting(): JSX.Element {
  return (
    <>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <directionalLight
        position={KEY_LIGHT_POSITION}
        intensity={KEY_LIGHT_INTENSITY}
        castShadow={false}
      />
    </>
  );
}
