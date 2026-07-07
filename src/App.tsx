/**
 * `src/App.tsx` — the composition root.
 *
 * `App.tsx` sits OUTSIDE every layer folder (`domain/`,
 * `application/`, `persistence/`, `state/`, `scene/`, `ui/`) — it
 * is the ONE place allowed to import from all of them at once and
 * wire everything together. That's the classic composition-root
 * pattern (Mark Seemann): dependencies are constructed at the
 * outermost layer where every concrete type is in scope; every
 * inner layer stays free of the graph-construction concern.
 *
 * ## What this file does (S12)
 *
 *   1. Lazy-imports `<DeckScene />` via `React.lazy(() =>
 *      import('./scene/DeckScene'))` so the three.js + r3f + drei
 *      bundle (~500 KB gzipped) ships as a SEPARATE chunk from the
 *      shell (SC-009 code-split budget). A build-artifacts check
 *      (`scripts/check-build-artifacts.mjs`) asserts the split
 *      lands in `dist/`.
 *   2. Passes the scene into `<AppShell />` as the `main` slot,
 *      wrapped in `<Suspense>` so the chunk load doesn't hard-fault
 *      the shell.
 *   3. Renders placeholder left/right panels (S13 params, S14
 *      toggles/warnings/BOM/export) — each carries an `<h2>` title
 *      so the aside landmarks have accessible names now, not after
 *      S13/S14 lands.
 *   4. Calls `useDesignStore.getState().loadFromLocalStorage()` in
 *      a boot `useEffect` (once, on mount) so a returning user's
 *      autosaved design is restored (S7 boot flow + inherited
 *      obligation #4). The store owns AC9 recovery — a stored
 *      design that fails to recompute at boot lands in `state:
 *      'error'` and surfaces the `'load-recompute-failed'` banner
 *      via `<StorageBanner />` (mounted inside AppShell).
 *
 * ## Why the useEffect uses `getState()` instead of a hook
 *
 * `useDesignStore.getState().loadFromLocalStorage()` reads the store
 * OUT-OF-BAND — the component doesn't SUBSCRIBE to the store, so
 * the effect fires exactly once (React 19 useEffect is NOT
 * double-invoked in production; StrictMode DOES double-invoke in
 * dev/test, but `loadFromLocalStorage()` is IDEMPOTENT — a second
 * call re-reads localStorage and either re-hydrates the same
 * bundle or hits the no-op "no stored design" branch). Using
 * `useDesignStore(s => s.loadFromLocalStorage)` inside a component
 * would rerun the effect every time the action reference changed
 * (never, but the wiring adds unnecessary re-render pressure).
 *
 * ## Boundary
 *
 * `App.tsx` is unrestricted by `.dependency-cruiser.cjs` — the
 * per-layer allowlists match `^src/${layer}/` with a trailing
 * slash, so the root file at `^src/App.tsx` falls through every
 * rule. That's intentional: the composition root is by definition
 * cross-layer. Every OTHER file in the codebase is boundary-checked.
 */
import { lazy, Suspense, useEffect, type JSX } from 'react';
import { AppShell, ParameterPanel, SceneErrorBoundary, SidePanels } from './ui';
import { useDesignStore } from './state';

/**
 * The scene bundle — three.js + r3f + drei + our own scene
 * components. Lazy-imported so it lands in a SEPARATE `dist/`
 * chunk from the shell (SC-009 code-split budget). The default
 * export of `./scene/DeckScene` is the React.lazy contract.
 *
 * IMPORTANT: import from `./scene/DeckScene` DIRECTLY, NOT via
 * `./scene` — the barrel drags every named export into the initial
 * chunk (Rollup can't tree-shake through a barrel that re-exports
 * `three`-using symbols). See `src/scene/index.ts` "Lazy-import
 * escape hatch" for the pinned rationale.
 */
const DeckScene = lazy(() => import('./scene/DeckScene'));

/**
 * The scene composition — DeckLayers + WarningOverlay inside
 * DeckScene. Both lazy-loaded (Vite's advancedChunks groups them
 * into the same `r3f` chunk as DeckScene by regex match, so the
 * three dynamic imports resolve as one network round-trip).
 *
 * ## Import discipline (S12 pair-fix iter 1 — Opus#4 nit)
 *
 * All three lazy targets import from DIRECT module paths, NOT via
 * `./scene` (the barrel). The barrel re-exports every scene
 * symbol; a lazy `import('./scene')` would drag the whole surface
 * into the chunk and defeat the tree-shaking that keeps the
 * shell TTI-clean. The default-export unwrapping shape is
 * consistent across all three: `mod.default` or a named unwrap
 * to `{ default: mod.Xxx }`. See vite.config.ts §"advancedChunks"
 * for the group configuration that ensures they share a chunk.
 */
const DeckLayers = lazy(async () => {
  const mod = await import('./scene/layers/DeckLayers');
  return { default: mod.DeckLayers };
});
const WarningOverlay = lazy(async () => {
  const mod = await import('./scene/WarningOverlay');
  return { default: mod.WarningOverlay };
});

/**
 * The Suspense fallback rendered while the scene chunk is loading.
 * Deliberately minimal — a full-viewport spinner would compete
 * with the disclaimer for user attention. A short text message
 * on the shell background is enough.
 */
function SceneFallback(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#4a4a4a',
        fontSize: '0.875rem',
      }}
    >
      Loading 3D view…
    </div>
  );
}

/**
 * S13 placeholder REPLACED — the leftPanel now hosts the real
 * `<ParameterPanel />`. S14 placeholder REPLACED — the rightPanel
 * now hosts `<SidePanels />` (a wrapper composing FIVE sections
 * as of S15: layer toggles + camera presets, warnings, BOM,
 * export menu, and the read-only 2D plan view).
 * Both real panels carry their own `<h2>` titles so the aside
 * landmarks keep accessible names.
 */

export function App(): JSX.Element {
  // Boot: hydrate the design store from localStorage. The store
  // handles AC9 gracefully — a stored design that fails to
  // recompute lands in status:'error' + banner via
  // `useUiStore.setStorageBanner('load-recompute-failed')`. See
  // src/state/design-store.ts `loadFromLocalStorage`.
  //
  // Empty deps → fires ONCE on mount. StrictMode double-invocation
  // (dev/test only) is tolerated because `loadFromLocalStorage()`
  // is idempotent — a second call re-reads localStorage.
  useEffect(() => {
    useDesignStore.getState().loadFromLocalStorage();
  }, []);

  return (
    <AppShell
      leftPanel={<ParameterPanel />}
      rightPanel={<SidePanels />}
      main={
        // SceneErrorBoundary (S12 pair-fix iter 1 — Fix B / GPT#2
        // HIGH) traps chunk-load failures and any r3f/three
        // rendering exception INSIDE the scene subtree so the
        // shell + disclaimer + panels stay usable. It wraps
        // <Suspense> (not the other way around) so a rejected
        // dynamic import — which surfaces as a thrown promise
        // Suspense re-throws when timed out — reaches the
        // boundary as an Error rather than an unhandled rejection.
        <SceneErrorBoundary>
          <Suspense fallback={<SceneFallback />}>
            <DeckScene>
              <DeckLayers />
              {/*
               * WarningOverlay is a PEER of DeckLayers, mounted
               * AFTER them so its highlights sort last in the
               * transparent-material pass (S11 AC3 finding #7).
               * Structural separation is enforced by dep-cruiser
               * (`warning-overlay-no-layers` rule) — the overlay
               * cannot import from `scene/layers/**`.
               */}
              <WarningOverlay />
            </DeckScene>
          </Suspense>
        </SceneErrorBoundary>
      }
    />
  );
}
