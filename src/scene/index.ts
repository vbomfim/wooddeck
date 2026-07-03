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
 * ## Public surface (frozen — issue #10 §2)
 *
 *   component  DeckScene            — root Canvas + rig + lighting
 *   component  CameraRig            — camera + OrbitControls
 *   component  SceneLighting        — ambient + directional
 *   component  WebGLFallback        — AC5 unsupported-browser view
 *   function   isWebGL2Available    — client-side detection
 *   function   installContextLossHandler — §5 GL-loss diagnostic
 *   function   computePresetCamera  — pure preset math
 *   function   computeAutoFitDistance
 *   function   computeZoomLimits
 *   constant   DECKSCENE_ARIA_LABEL — canvas accessible name
 *   constant   WEBGL_FALLBACK_MESSAGE — AC5 copy
 *   constant   PRESET_TRANSITION_MS
 *   constant   AUTOFIT_MARGIN
 *   constant   DEFAULT_FOV_DEG, TOP_DOWN_FOV_DEG
 *   constant   CAMERA_NEAR_MM, CAMERA_FAR_MM
 *   types      DeckSceneProps, CameraRigProps, WebGLFallbackProps,
 *              CameraPose, BoundsMm, CameraPreset, ContextLossTarget
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
