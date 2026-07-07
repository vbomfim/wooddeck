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
 *   component  WarningOverlay       — S11 over-span warning decorator (peer of layers)
 *   component  OverSpanHighlight    — S11 leaf highlight primitive
 *   function   isWebGL2Available    — client-side detection
 *   function   installContextLossHandler — §5 GL-loss diagnostic
 *   function   computePresetCamera  — pure preset math
 *   function   computeAutoFitDistance
 *   function   computeZoomLimits
 *   function   materialForKind      — shared MeshStandardMaterial
 *                                    keyed by MemberKind (replaces
 *                                    the species-keyed helper)
 *   function   materialForMember    — material by LayoutMember
 *                                    (routes lumber members by kind)
 *   function   disposeHighlightPrimitives — S11 HMR/tooling helper
 *                                    (do NOT call from render code)
 *   constant   DECK_LAYER_ORDER     — S10 pinned six-entry sequence
 *   constant   LAYER_USER_DATA_KEY  — S10 well-known userData key
 *                                     stamped on every layer group
 *   constant   DECKSCENE_ARIA_LABEL — canvas accessible name
 *   constant   WEBGL_FALLBACK_MESSAGE — AC5 copy
 *   constant   PRESET_TRANSITION_MS
 *   constant   AUTOFIT_MARGIN
 *   constant   DEFAULT_FOV_DEG, TOP_DOWN_FOV_DEG
 *   constant   CAMERA_NEAR_MM, CAMERA_FAR_MM
 *   constant   GROUND_PLANE_SIZE_MM, GROUND_GRID_DIVISIONS
 *   constant   MATERIAL_KIND_COLORS — per-MemberKind palette
 *                                    (replaces the S10 MATERIAL_COLORS
 *                                    species map)
 *   constant   WARNING_OVERLAY_USER_DATA_KEY — S11 well-known userData
 *                                     key stamped on the overlay group
 *                                     (mirrors LAYER_USER_DATA_KEY)
 *   constant   WARNING_OVERLAY_USER_DATA_VALUE — S11 canonical value
 *                                     stamped under the key above
 *   types      DeckSceneProps, CameraRigProps, WebGLFallbackProps,
 *              CameraPose, BoundsMm, CameraPreset, ContextLossTarget,
 *              BoxMemberProps, OverSpanHighlightProps
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
  LAYER_USER_DATA_KEY,
  MATERIAL_KIND_COLORS,
  PostsLayer,
  materialForKind,
  materialForMember,
} from './layers';
export type { BoxMemberProps } from './layers';

// ---- S11 warning overlay (peer of layers, not a consumer) -----------------
//
// The S11 WarningOverlay is a top-level scene decorator that draws
// one highlight per over-span warning. S12's AppShell composes it
// as `<DeckScene><DeckLayers/><WarningOverlay/></DeckScene>` — the
// overlay MUST mount AFTER `<DeckLayers />` so its highlights sort
// last in the transparent-material pass and draw on top per AC3.
//
// The `warning-overlay-no-layers` dep-cruiser rule (finding #7)
// forbids the overlay + everything under `./highlights/` from
// importing any file under `./layers/`. The overlay is a PEER of
// the layers, not a consumer — that's how AC2 (visibility
// independence) is guaranteed structurally, not by convention.
export {
  WARNING_OVERLAY_USER_DATA_KEY,
  WARNING_OVERLAY_USER_DATA_VALUE,
  WarningOverlay,
} from './WarningOverlay';

export { OverSpanHighlight } from './highlights/OverSpanHighlight';
export type { OverSpanHighlightProps } from './highlights/OverSpanHighlight';

// HMR / tooling helper — parity with the layers-shared
// `disposeSharedMaterials` / `disposeSharedGeometry` helpers.
// Do NOT call from production render code (see the module header
// of `./highlights/highlight-primitives.ts`).
export { disposeHighlightPrimitives } from './highlights/highlight-primitives';
