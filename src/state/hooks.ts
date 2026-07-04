/**
 * `src/state/hooks.ts` — granular selector hooks over the two
 * Zustand stores.
 *
 * ## Why granular selectors (issue #9 §9)
 *
 * Consumers that call `useDesignStore()` with NO selector re-render
 * on every mutation, even ones that don't touch the slice they care
 * about (a decking-orientation change re-renders the warnings panel,
 * a camera preset toggle re-renders every scene component). Zustand
 * memoizes selector-based subscriptions per-hook — one hook per
 * READ slice keeps the re-render footprint minimal and matches the
 * NFR §9 "granular selectors to avoid unnecessary re-renders" rule.
 *
 * ## Hook naming convention
 *
 *   - `useDesign()`         → the raw `DeckDesign` (from bundle).
 *   - `useLayout()`         → the computed `Layout`.
 *   - `useWarnings()`       → the span-check warnings.
 *   - `useDesignStatus()`   → the `{ status, lastError }` tuple.
 *   - `useUiUnits()`        → the unit-display preference.
 *   - `useCameraPreset()`   → the current camera preset.
 *   - `useLayerVisibility()`→ the full eight-key layer map.
 *   - `useStorageBanner()`  → the AC6/AC9 banner code (or null).
 *
 * The `useDesign*` / `useUi*` prefix mirrors the two-store split so
 * a grep of a component file makes it obvious which store a hook
 * reads from. `useLayout` and `useWarnings` are grouped under the
 * design side (they live inside `bundle`) but shed the prefix
 * because those two names are unambiguous — `useWarnings` from any
 * other layer would be surprising.
 *
 * ## Return-value shapes
 *
 * `useDesignStatus` returns a single OBJECT `{ status, lastError }`
 * rather than two separate hooks so a component that renders "error
 * state" reads both together with ONE subscription. Zustand's
 * default equality is referential — the store's actions always
 * write a NEW status/lastError object even when unchanged? No: they
 * write specific `set({ status, lastError })` payloads, so the
 * selector picks up the changes correctly.
 *
 * ## Rewritability
 *
 * Every hook is a ONE-line arrow — the whole file is trivially
 * rewritable from its function signatures alone. A future addition
 * (`useDesignId`, `useLayerVisibility(name)`) drops in with no
 * surrounding-code touch.
 */

import type { DeckDesign, Dimensions3D, Layout, Warning } from '../domain/model';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';

import { computeRemediations } from '../domain/spans';
import type { RemediationOption } from '../domain/spans';
import { computeLayoutAndCheck } from '../application/compute-layout';

import { spanTable, useDesignStore } from './design-store';
import type { CameraPreset, LayerVisibility, StorageBanner } from './ui-store';
import { useUiStore } from './ui-store';

// ---- design-store selectors ------------------------------------------------

/**
 * The canonical `DeckDesign`. This is the SKU-and-geometry-only
 * shape S13's parameter panel reads.
 */
export function useDesign(): DeckDesign {
  return useDesignStore((s) => s.bundle.design);
}

/**
 * The computed `Layout` render contract (S10 scene reads this).
 */
export function useLayout(): Layout {
  return useDesignStore((s) => s.bundle.layout);
}

/**
 * The layout's `bounds` (deck AABB in millimeters). Split out from
 * `useLayout` so downstream 3D consumers — starting with S9's
 * `<DeckScene>` — subscribe to the SLICE they actually need, not
 * the whole layout object. This keeps the scene from re-rendering
 * on a warnings-only mutation (which recomputes the layout but
 * leaves the bounds numerically unchanged).
 *
 * ## PR#29 pair-fix iter 1 — Fix G
 *
 * The original `<DeckScene>` used an inline
 * `useDesignStore(s => s.bundle.layout.bounds)` selector,
 * coupling the scene to the private `bundle.layout` shape. Routing
 * through this hook decouples the scene from the store's INTERNAL
 * structure — a future refactor that flattens `bundle.layout` into
 * `bundle.layoutSummary` need only update THIS hook, not every
 * consumer.
 *
 * ## Reference identity
 *
 * The store writes a NEW bundle on every mutation, so this hook's
 * default referential-equality selector will fire on any layout
 * recompute even when numeric values are unchanged. That's fine
 * for `<DeckScene>` because the downstream `<CameraRig>` uses
 * numeric-value dependencies in its `useMemo` (Fix F) to avoid
 * scheduling spurious preset transitions.
 */
export function useLayoutBounds(): Dimensions3D {
  return useDesignStore((s) => s.bundle.layout.bounds);
}

/**
 * The span-check warnings (S13 warnings panel + S10 overlays read
 * this). Referentially stable — the store writes a new bundle on
 * every mutation, but `bundle.warnings` is a plain array reference
 * that changes only when the bundle changes.
 */
export function useWarnings(): readonly Warning[] {
  return useDesignStore((s) => s.bundle.warnings);
}

/**
 * The `{status, lastError}` diagnostic tuple. Grouped so error
 * banners read both slots with ONE subscription. Pair-fix Review
 * NIT F: uses `useShallow` so the selector return is
 * reference-stable between renders when neither slot changes —
 * without this wrapper, the fresh `{...}` object constructed each
 * render would flip Zustand's default referential equality and
 * force a re-render on every unrelated store write.
 */
export function useDesignStatus(): {
  status: 'idle' | 'loading' | 'error';
  lastError: Error | null;
} {
  return useDesignStore(
    useShallow((s) => ({ status: s.status, lastError: s.lastError })),
  );
}

// ---- ui-store selectors ----------------------------------------------------

/**
 * The active unit-display preference. S13's parameter panel reads
 * this to format `Mm` values via `formatLength`.
 */
export function useUiUnits(): 'imperial' | 'metric' {
  return useUiStore((s) => s.units);
}

/**
 * The active camera preset. S9's `<DeckScene>` reads this to
 * position the camera / auto-frame.
 */
export function useCameraPreset(): CameraPreset {
  return useUiStore((s) => s.cameraPreset);
}

/**
 * The full layer-visibility map. S9 / S10 scene components read
 * this to toggle their group visibility.
 */
export function useLayerVisibility(): LayerVisibility {
  return useUiStore((s) => s.layerVisibility);
}

/**
 * The current persistence-event banner (`null` when none). S12's
 * banner component reads this to render one of the three codes
 * (`'storage-full'` / `'storage-blocked'` / `'load-recompute-failed'`).
 */
export function useStorageBanner(): StorageBanner {
  return useUiStore((s) => s.storageBanner);
}

/**
 * The current WebGL context-lost flag. S12's
 * `<ContextLostBanner>` reads this to surface a user-facing
 * "3D view crashed — please reload" banner when the GPU driver
 * drops the context. Written by
 * {@link installContextLossHandler} in `src/scene/context-loss.ts`
 * (S12 pair-fix iter 1 — Fix C).
 */
export function useWebglContextLost(): boolean {
  return useUiStore((s) => s.webglContextLost);
}

// ---- S16 issue #38 — remediation options -----------------------------------

/**
 * The list of `RemediationOption`s produced for a specific
 * `Warning`. Consumed by `<RemediationControls warning={w}/>` in
 * the warnings panel.
 *
 * ## Purpose (S16 issue #38 §2)
 *
 * The ui layer is boundary-forbidden from importing
 * `domain/spans/*` directly (see `.dependency-cruiser.cjs`
 * `ui-no-domain-spans` rule) — the compute is reached through this
 * hook instead. That keeps the "compute logic" and "presentation"
 * cleanly separated: swapping the compute for a spec-driven
 * remediation later requires touching only this hook.
 *
 * ## Reference stability (AC11)
 *
 * The hook memoizes the computed array keyed on
 * `(warning.memberId, design)`. When the design object identity is
 * unchanged (the store returns the same reference between renders)
 * the returned array is REFERENTIALLY equal to the previous render's
 * — a downstream `useEffect([options])` will NOT re-fire on a
 * neighbouring warning's parameter drag.
 *
 * ## Why the memberId, not the whole warning
 *
 * Warnings are recomputed by span-check on every mutation — even
 * when the memberId is stable, the warning OBJECT reference changes.
 * Keying the memo on the memberId (a string) plus the design
 * reference gives us the strongest cache — reference-equal design
 * AND same warning identity → same options array.
 *
 * ## Why not `useShallow((s) => ({ design, warnings }))`?
 *
 * Because `computeRemediations` is a pure function of
 * `(warning, design, spanTable)` and `spanTable` is a stable
 * module singleton, the memo captures every input. Shallow-select
 * would work but adds a hop; the direct `useDesign()` read is
 * cleaner and matches the "one hook per slice" convention.
 */
export function useRemediationsForWarning(
  warning: Warning,
): readonly RemediationOption[] {
  const design = useDesignStore((s) => s.bundle.design);
  return useMemo(
    () =>
      computeRemediations(warning, design, spanTable, (d) => {
        // Ground-truth recompute (S16 pair-fix). `computeRemediations`
        // calls this per candidate patch to verify `wouldClear`.
        // `computeLayoutAndCheck` throws `LayoutError` for invalid
        // designs (e.g. a below-minimum dimension a patch produced) —
        // `verifyPatchClears` inside `computeRemediations` catches
        // that throw and surfaces the candidate as a disabled option
        // with a reason. Do NOT swallow errors here; the domain-side
        // catch is the ONE place responsible for the fail-safe.
        return computeLayoutAndCheck(d, spanTable).warnings;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [warning.memberId, design],
  );
}
