/**
 * `src/scene/DeckScene.tsx` — the root 3D viewer component.
 *
 * ## Responsibility (single)
 *
 * `<DeckScene>` is the composition root for the 3D viewer. It:
 *
 *   - Detects WebGL 2 support and swaps to the AC5 fallback message
 *     when unavailable (BEFORE any Canvas mount so a WebGL crash
 *     never reaches the user).
 *   - Reads the current camera preset and layout bounds from the
 *     Zustand stores (the ONLY state coupling; no props flow up).
 *   - Mounts the r3f `<Canvas>` with an accessible `aria-label`
 *     (WCAG 2.2 landmark per ticket §10).
 *   - Mounts the {@link SceneLighting} + {@link CameraRig} +
 *     a CLEARLY-COMMENTED mount point for layer components (S10+).
 *   - Wires the `onContextLost` event (§5) so a driver crash logs
 *     a diagnostic; the UI banner surfacing lives in S12.
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
 *   - `./CameraRig`, `./lighting`, `./WebGLFallback`, `./webgl-support`
 *
 * It does NOT import from `../ui/**`, `../application/**`, or
 * `../persistence/**` — enforced by `.dependency-cruiser.cjs`
 * `scene-allowlist` and the boundary self-test probes.
 */
import { useMemo, type JSX, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';

import { useDesignStore, useUiStore } from '../state';

import { CameraRig } from './CameraRig';
import { SceneLighting } from './lighting';
import { WebGLFallback } from './WebGLFallback';
import { isWebGL2Available } from './webgl-support';

/**
 * The accessible name for the canvas. Ticket §10 (WCAG 2.2) pins the
 * copy so screen-reader users learn how to change the view via the
 * preset buttons in the toolbar. Kept as an exported constant so
 * `DeckScene.test.tsx` and the QA E2E can grep-import the exact
 * string rather than duplicating it.
 */
export const DECKSCENE_ARIA_LABEL =
  '3D view of deck design; use the preset view buttons in the toolbar to change angle';

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

  // Read state via the granular selector hooks — one subscription
  // per read slot. See state/hooks.ts for the re-render rationale.
  const preset = useUiStore((s) => s.cameraPreset);
  const bounds = useDesignStore((s) => s.bundle.layout.bounds);

  // AC5 fallback branch — return BEFORE mounting the Canvas so we
  // don't touch WebGL at all. The className prop is spread through a
  // rest-props object rather than passed directly, so
  // `exactOptionalPropertyTypes: true` doesn't complain about
  // `string | undefined` → `string`.
  if (!webgl2Ok) {
    return <WebGLFallback {...(className !== undefined ? { className } : {})} />;
  }

  return (
    <Canvas
      className={className}
      aria-label={DECKSCENE_ARIA_LABEL}
      // Reliability §5: log GL context loss so an ops / developer
      // console diagnostics catches driver crashes. The user-facing
      // banner ("3D view crashed — please reload") is S12's job.
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          'webglcontextlost',
          (event: Event) => {
            event.preventDefault();
            console.error(
              '[wooddeck:scene] WebGL context lost — the 3D viewer needs to reload.',
            );
          },
          { passive: false },
        );
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
