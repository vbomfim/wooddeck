/**
 * `src/ui/index.ts` — the SINGLE public entry point for the ui
 * layer.
 *
 * Downstream consumers (the composition root `src/App.tsx` in S12,
 * and any future test harnesses) MUST import from this barrel,
 * never from a private submodule. The `ui` layer is intentionally
 * "dumb" — components render from Zustand state via slot props,
 * so the public surface is small and stable.
 *
 * ## Public surface (frozen — issue #13 §2)
 *
 *   components  AppShell, AppHeader, DisclaimerBanner, StorageBanner,
 *               ContextLostBanner, SceneErrorBoundary
 *   constants   DISCLAIMER_TEXT           — spec § FR-016 frozen copy
 *               STORAGE_BANNER_MESSAGES   — code → message map (S8 union)
 *               SPEC_LINK_HREF            — AC7 spec-link target
 *               APP_VERSION_FALLBACK      — sentinel returned by getAppVersion
 *                                            when the Vite define did not run
 *               CONTEXT_LOST_TITLE / _BODY / _RELOAD_LABEL   — Fix C copy
 *               SCENE_ERROR_TITLE / _BODY / _RELOAD_LABEL    — Fix B copy
 *   functions   getAppVersion             — reads __WOODDECK_VERSION__
 *               reloadPage                — window.location.reload wrapper
 *   types       AppShellProps, SceneErrorBoundaryProps
 *
 * ## Boundary
 *
 * `ui/` may import from `ui/` and `state/` only — enforced by
 * `.dependency-cruiser.cjs` `ui-allowlist` and BLOCK-2d / BLOCK-2r /
 * BLOCK-2s / BLOCK-2t in `scripts/boundary-selftest.mjs`.
 */
export { AppShell } from './AppShell';
export type { AppShellProps } from './AppShell';

export { AppHeader, SPEC_LINK_HREF } from './AppHeader';

export { DISCLAIMER_TEXT, DisclaimerBanner } from './DisclaimerBanner';

export { STORAGE_BANNER_MESSAGES } from './storage-banner-messages';
export { StorageBanner } from './StorageBanner';

export {
  CONTEXT_LOST_BODY,
  CONTEXT_LOST_RELOAD_LABEL,
  CONTEXT_LOST_TITLE,
  ContextLostBanner,
} from './ContextLostBanner';

export {
  SCENE_ERROR_BODY,
  SCENE_ERROR_RELOAD_LABEL,
  SCENE_ERROR_TITLE,
  SceneErrorBoundary,
} from './SceneErrorBoundary';
export type { SceneErrorBoundaryProps } from './SceneErrorBoundary';
export { reloadPage } from './reload-page';

export { APP_VERSION_FALLBACK, getAppVersion } from './version';

// ---- S13 issue #14 — ParameterPanel + UnitSwitcher ----------------------
//
// The `ui/` barrel re-exports the two panel-level components. Field
// components (`LengthField`, `SelectField`) are INTERNAL — consumers
// use the panel, not the fields directly. Keeping fields off the
// barrel means a future rewrite that changes the field split (e.g.
// combining LengthField + SelectField into a generic FieldRow) does
// not break external callers.
export { ParameterPanel } from './ParameterPanel';
export { UnitSwitcher } from './UnitSwitcher';
