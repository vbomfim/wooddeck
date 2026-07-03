/**
 * `src/scene/index.ts` — public entry point for the scene layer.
 *
 * ## Consumer contract
 *
 * The `AppShell` (S12) and future E2E harnesses import from THIS
 * barrel, not from the private submodules. That keeps a submodule
 * rename / split from breaking downstream imports.
 *
 * ## Lazy-import escape hatch
 *
 * For code-split loading (§7 SC-009), consumers must import
 * `./DeckScene` directly rather than this barrel:
 *
 *     const DeckScene = React.lazy(() => import('./scene/DeckScene'));
 *
 * Barrel imports drag every symbol into the initial chunk,
 * defeating the ~500 KB code-split budget. See
 * `src/scene/DeckScene.tsx` module header for details.
 *
 * ## Public surface (frozen — issue #10 §2 + issue #11 §2)
 *
 *   component  DeckScene            — root Canvas + rig + lighting
 *   component  CameraRig            — camera + OrbitControls
 *   component  SceneLighting        — ambient + directional
 *   component  WebGLFallback        — AC5 unsupported-browser view
 *   component  EnvironmentLayer     — S10 ground plane + grid
 *   component  DeckingLayer         — S10 kind === "board" meshes
 *   component  JoistsLayer          — S10 kind === "joist" meshes
 *   component  BeamsLayer           — S10 kind === "beam" meshes
 *   component  PostsLayer           — S10 kind === "post" meshes
 *   component  FootingsLayer        — S10 kind === "footing" meshes
 *   component  DeckLayers           — S10 six-layer bundle (fixed order)
 *   component  BoxMember            — S10 reusable rectangular-member mesh
 *   function   isWebGL2Available    — client-side detection
 *   function   installContextLossHandler — §5 GL-loss diagnostic
 *   function   computePresetCamera  — pure preset math
 *   function   computeAutoFitDistance
 *   function   computeZoomLimits
 *   function   materialForSpecies   — S10 shared MeshStandardMaterial
 *   function   materialForMember    — S10 material by LayoutMember
 *   constant   DECK_LAYER_ORDER     — S10 pinned six-entry sequence
 *   constant   DECKSCENE_ARIA_LABEL — canvas accessible name
 *   constant   WEBGL_FALLBACK_MESSAGE — AC5 copy
 *   constant   PRESET_TRANSITION_MS
 *   constant   AUTOFIT_MARGIN
 *   constant   DEFAULT_FOV_DEG, TOP_DOWN_FOV_DEG
 *   constant   CAMERA_NEAR_MM, CAMERA_FAR_MM
 *   constant   GROUND_PLANE_SIZE_MM, GROUND_GRID_DIVISIONS
 *   constant   MATERIAL_COLORS      — S10 per-species palette (AC6)
 *   types      DeckSceneProps, CameraRigProps, WebGLFallbackProps,
 *              CameraPose, BoundsMm, CameraPreset, ContextLossTarget,
 *              BoxMemberProps
 */

// ---- components ------------------------------------------------------------
export { DeckScene, DECKSCENE_ARIA_LABEL } from './DeckScene';
export type { DeckSceneProps } from './DeckScene';

export { CameraRig } from './CameraRig';
export type { CameraRigProps } from './CameraRig';

export { SceneLighting } from './lighting';

export { WebGLFallback, WEBGL_FALLBACK_MESSAGE } from './WebGLFallback';
export type { WebGLFallbackProps } from './WebGLFallback';

// ---- utilities & pure math -------------------------------------------------
export { isWebGL2Available } from './webgl-support';

export { installContextLossHandler } from './context-loss';
export type { ContextLossTarget } from './context-loss';

export {
  AUTOFIT_MARGIN,
  CAMERA_FAR_MM,
  CAMERA_NEAR_MM,
  DEFAULT_FOV_DEG,
  PRESET_TRANSITION_MS,
  TOP_DOWN_FOV_DEG,
  computeAutoFitDistance,
  computePresetCamera,
  computeZoomLimits,
} from './camera-presets';
export type { BoundsMm, CameraPose, CameraPreset } from './camera-presets';

// ---- layer components (S10 issue #11) --------------------------------------
//
// Re-exports from `./layers` so S12's `AppShell` can import
// everything from `src/scene` — one import path for the whole
// scene package. The `./layers/index.ts` barrel is the source of
// truth; this file just re-exposes it.
export {
  BeamsLayer,
  BoxMember,
  DECK_LAYER_ORDER,
  DeckLayers,
  DeckingLayer,
  EnvironmentLayer,
  FootingsLayer,
  GROUND_GRID_DIVISIONS,
  GROUND_PLANE_SIZE_MM,
  JoistsLayer,
  MATERIAL_COLORS,
  PostsLayer,
  materialForMember,
  materialForSpecies,
} from './layers';
export type { BoxMemberProps } from './layers';
