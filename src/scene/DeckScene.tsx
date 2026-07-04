/**
 * `src/scene/DeckScene.tsx` — the root 3D viewer component.
 *
 * ## Scene coordinate frame & units (S10 pinned — see docs/ARCHITECTURE.md § 3b)
 *
 * The scene is authored at **millimeter world scale** —
 * `1 three.js unit = 1 mm`. Every `LayoutMember.position` /
 * `size` field (see `domain/model.ts` "LAYOUT COORDINATE FRAME")
 * flows into `<mesh>` props unchanged. Frame is right-handed:
 * `+x = width`, `+y = up` (`y = 0` is the ground plane),
 * `+z = length`; Euler rotations are XYZ, radians. The near /
 * far clipping planes below are mm-scaled to match — see
 * `camera-presets.ts` module header for the derivation.
 *
 * ## Responsibility (single)
 *
 * `<DeckScene>` is the composition root for the 3D viewer. It:
 *
 *   - Detects WebGL 2 support and swaps to the AC5 fallback message
 *     when unavailable (BEFORE any Canvas mount so a WebGL crash
 *     never reaches the user).
 *   - Reads the current camera preset and layout bounds from the
 *     Zustand stores VIA THE GRANULAR HOOKS (`useCameraPreset`,
 *     `useLayoutBounds`) so the scene is decoupled from the
 *     `bundle.layout` shape (PR#29 pair-fix iter 1 — Fix G).
 *   - Mounts the r3f `<Canvas>` with:
 *       * an accessible `aria-label` (WCAG 2.2 landmark),
 *       * millimeter-scale near / far clipping planes so deck
 *         geometry from S10 is not clipped by r3f's default
 *         `near = 0.1 / far = 1000` values (Fix A).
 *   - Mounts {@link SceneLighting} + {@link CameraRig} + a
 *     CLEARLY-COMMENTED mount point for layer components (S10+).
 *   - Wires the `webglcontextlost` diagnostic via
 *     {@link installContextLossHandler} (§5 / Fix H) so a driver
 *     crash logs a console error. The user-facing banner lives in
 *     S12.
 *
 * ## Lazy-import contract (§7 SC-009)
 *
 * `<DeckScene>` is exported as BOTH a NAMED and a DEFAULT export so
 * `AppShell` (S12) can do:
 *
 *     const DeckScene = React.lazy(() => import('./scene/DeckScene'));
 *
 * The default-export shape is the React.lazy contract; the named
 * export lets tests and non-lazy consumers grab the component
 * directly. See `DeckScene.test.tsx` "lazy-import contract" test.
 *
 * ## Boundary discipline
 *
 * This file imports ONLY from:
 *   - `react`
 *   - `@react-three/fiber`
 *   - `../state` (barrel — the ONLY state coupling channel)
 *   - `./CameraRig`, `./context-loss`, `./lighting`, `./WebGLFallback`,
 *     `./webgl-support`, `./camera-presets`
 *
 * It does NOT import from `../ui/**`, `../application/**`, or
 * `../persistence/**` — enforced by `.dependency-cruiser.cjs`
 * `scene-allowlist` and the boundary self-test probes.
 */
import { useEffect, useMemo, useRef, type JSX, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';

import { useCameraPreset, useLayoutBounds } from '../state';

import { CAMERA_FAR_MM, CAMERA_NEAR_MM, DEFAULT_FOV_DEG } from './camera-presets';
import { CameraRig } from './CameraRig';
import { reinstallContextLossHandler } from './context-loss';
import { SceneLighting } from './lighting';
import { WebGLFallback } from './WebGLFallback';
import { isWebGL2Available } from './webgl-support';

/**
 * The accessible name for the canvas. Ticket §10 (WCAG 2.2) pins
 * the copy so screen-reader users learn how to interact with the
 * scene. Kept as an exported constant so `DeckScene.test.tsx` and
 * the QA E2E can grep-import the exact string rather than
 * duplicating it.
 *
 * ## PR#29 pair-fix iter 1 — Fix J (honest a11y copy)
 *
 * The original ticket §10 wording promised "use arrow keys or WASD
 * to orbit, +/- to zoom" — but keyboard orbit is an EXPLICIT
 * stretch goal (ticket §16) that S9 does NOT implement. Promising
 * controls that don't exist is worse than describing fewer of
 * them, so the pinned copy now names ONLY what actually works:
 * drag to orbit, scroll to zoom, and the preset view buttons
 * (S14) for keyboard-accessible angles.
 */
export const DECKSCENE_ARIA_LABEL =
  '3D view of deck design; drag to orbit, scroll to zoom, or use the preset view buttons in the toolbar to change angle';

/**
 * The stable CSS class the ExportMenu uses to find the underlying
 * `<canvas>` for PNG export (S14 issue #15 AC10). The class is
 * concatenated with any consumer-supplied `className` prop — see
 * `mergeCanvasClassName` below. Documented so downstream tests +
 * QA E2E can grep-find the exact selector
 * (`canvas.wooddeck-canvas`).
 *
 * ## Why a class instead of a React ref
 *
 * The ExportMenu lives in the ui layer; DeckScene lives in the
 * scene layer. Passing a ref would either require a shared
 * ref-context module (extra coupling) or lift the ref into the
 * composition root App.tsx (still cross-layer). A CSS class is a
 * DOM contract — the ui layer's `document.querySelector('canvas.wooddeck-canvas')`
 * is the standard "find the singleton canvas" pattern and needs
 * no cross-layer plumbing.
 */
export const WOODDECK_CANVAS_CLASSNAME = 'wooddeck-canvas';

/**
 * Merge the stable `wooddeck-canvas` class with any consumer-
 * supplied className. Extracted so the tests can assert both the
 * stable class AND any AppShell-supplied layout class are present
 * on the rendered canvas. Ordering is stable (wooddeck-canvas
 * first) so the AC10 querySelector target is deterministic.
 */
function mergeCanvasClassName(consumer: string | undefined): string {
  return consumer !== undefined && consumer.length > 0
    ? `${WOODDECK_CANVAS_CLASSNAME} ${consumer}`
    : WOODDECK_CANVAS_CLASSNAME;
}

/**
 * Props for {@link DeckScene}. `className` is forwarded to the
 * root element (Canvas OR fallback) so the AppShell layout applies
 * uniformly to both branches.
 */
export interface DeckSceneProps {
  readonly className?: string;
  /**
   * Slot for layer components (S10+). Rendered INSIDE the Canvas so
   * child r3f primitives (meshes, groups) share the scene graph.
   * Left empty for MVP-S9 — the mount point is future work.
   */
  readonly children?: ReactNode;
}

export function DeckScene({ className, children }: DeckSceneProps): JSX.Element {
  // Read WebGL 2 support ONCE per mount — the answer doesn't change
  // during a session, and re-checking on every render is wasteful.
  // `useMemo` with an empty dep list is the standard "compute once
  // per mount" idiom.
  const webgl2Ok = useMemo(() => isWebGL2Available(), []);

  // Fix G: read state via the granular selector hooks — one
  // subscription per read slot. `useCameraPreset` reads from the ui
  // store; `useLayoutBounds` reads a scoped slice of the design
  // store's `bundle.layout.bounds`. See state/hooks.ts for the
  // re-render rationale.
  const preset = useCameraPreset();
  const bounds = useLayoutBounds();

  // Fix H: hold the cleanup returned by installContextLossHandler
  // so we can un-register on unmount. Populated inside onCreated
  // (which fires exactly once per Canvas mount).
  const contextLossCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    // Cleanup only — the register call happens in Canvas.onCreated.
    // This effect exists so we get a Composition-root-lifetime hook
    // to run the returned cleanup on unmount.
    return () => {
      contextLossCleanupRef.current?.();
      contextLossCleanupRef.current = null;
    };
  }, []);

  // AC5 fallback branch — return BEFORE mounting the Canvas so we
  // don't touch WebGL at all. The className prop is spread through
  // a rest-props object rather than passed directly, so
  // `exactOptionalPropertyTypes: true` doesn't complain about
  // `string | undefined` → `string`.
  if (!webgl2Ok) {
    return <WebGLFallback {...(className !== undefined ? { className } : {})} />;
  }

  return (
    <Canvas
      className={mergeCanvasClassName(className)}
      aria-label={DECKSCENE_ARIA_LABEL}
      // S12 pair-fix iter 1 — Fix D (AC6 real canvas focusability).
      // The r3f `<Canvas>` forwards unknown HTML attributes to the
      // underlying `<canvas>` element. Adding tabIndex={0} makes
      // the 3D view part of the natural tab order — WITHOUT it, a
      // keyboard user tabs right past the main content and lands
      // in the right-panel. The AC6 test in App.test.tsx asserts
      // the real tab order lands here (not on a fake test button).
      tabIndex={0}
      // S14 issue #15 AC10 prerequisite (ticket §15 risk note).
      // `canvas.toDataURL('image/png')` reads the WebGL front
      // buffer. Without preserveDrawingBuffer:true the browser
      // clears the buffer after every compositing pass, so
      // toDataURL returns a fully-transparent PNG. Setting this
      // flag costs a tiny bit of memory + a small perf hit on
      // low-end mobile (the swap-chain can't be reused) but is
      // the ONLY way to make PNG export work without a
      // render-to-texture pass. See
      // src/persistence/screenshot.ts module header.
      gl={{ preserveDrawingBuffer: true }}
      // Fix A: near / far clipping planes in millimeter world units.
      // r3f's default 0.1 / 1000 would clip every deck member —
      // preset camera distances run 2 700 – 113 600 mm. See
      // `camera-presets.ts` module header for the derivation.
      camera={{
        near: CAMERA_NEAR_MM,
        far: CAMERA_FAR_MM,
        fov: DEFAULT_FOV_DEG,
      }}
      // Reliability §5 (Fix H): install the GL context-loss
      // diagnostic. The cleanup returned here is stashed in a ref
      // so the composition-root useEffect above un-registers on
      // unmount.
      //
      // S14 UAT pair-fix: use `reinstallContextLossHandler` (NOT
      // the raw `installContextLossHandler`) so a StrictMode
      // dev-only remount doesn't leak the first canvas's listener.
      // The wrapper drops any prior cleanup, clears the sticky
      // webglContextLost flag (a fresh live context is not lost),
      // then installs + stores the new cleanup. See
      // src/scene/context-loss.ts module header for the full RCA.
      onCreated={({ gl }) => {
        reinstallContextLossHandler(gl, contextLossCleanupRef);
      }}
    >
      <SceneLighting />
      <CameraRig preset={preset} bounds={bounds} />
      {/*
       * === LAYER MOUNT POINT (S10 hook) ===
       * Deck layer components (joists, beams, posts, footings,
       * decking boards, environment ground plane) will mount here
       * in S10. `<DeckScene>` intentionally accepts a `children`
       * slot so S12's `<AppShell>` can compose the layer stack from
       * outside — keeping S9 fully rewritable without coupling to
       * the (still-unwritten) S10 layer registry.
       * =====================================
       */}
      {children}
    </Canvas>
  );
}

/**
 * Default export — required by `React.lazy` for the lazy-import
 * shape S12 depends on. See module header §"Lazy-import contract".
 */
export default DeckScene;
