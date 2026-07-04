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
 * `ui/` may import from `ui/`, `state/`, and `domain/` (excluding
 * `domain/layout/**`) — enforced by `.dependency-cruiser.cjs`
 * `ui-allowlist` and BLOCK-2d / BLOCK-2s / BLOCK-2t / BLOCK-2v in
 * `scripts/boundary-selftest.mjs`. `ui/` is still FORBIDDEN from
 * importing `scene/`, `application/`, `persistence/`, and
 * `domain/layout/**` (S13 issue #14 Boundary Resolution §1). The
 * `application` layer's boundary is enforced by BLOCK-2s; the
 * `persistence` layer by BLOCK-2t; the `domain/layout` sub-tree
 * by the dedicated `ui-no-domain-layout` rule + BLOCK-2v.
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

// ---- S14 issue #15 — Right-panel composition ---------------------------
//
// Four panels + one wrapper. The wrapper composes all four for the
// AppShell rightPanel slot; individual panels are exported for
// integration tests that mount them in isolation.
export { LayerTogglePanel } from './LayerTogglePanel';
export { LAYER_ITEMS, PRESET_ITEMS } from './layer-toggle-items';
export { WarningsPanel, NO_WARNINGS_TEXT } from './WarningsPanel';
export { BomPanel, EMPTY_LAYOUT_TEXT } from './BomPanel';
export { ExportMenu, PNG_UNAVAILABLE_MESSAGE } from './ExportMenu';
export type { ExportMenuProps } from './ExportMenu';
export {
  buildPngFilename,
  CANVAS_MISSING_MESSAGE,
  CANVAS_SELECTOR,
  RESET_CONFIRM_TEXT,
} from './export-menu-helpers';
export { SidePanels } from './SidePanels';

// ---- S23 issue #45 — v1→v2 migration toast + foundation selectors --------
//
// The migration toast is a small custom widget (~40 lines) that
// reactively renders the ui-store's discrete migration-event
// counters (`migrationEventId` / `dismissedMigrationEventId` — see
// the S23 pair-fix in `state/ui-store.ts` for the discrete-event
// rationale). See `MigrationToast.tsx` for the "why not a toast
// library" trade-off decision (ticket §17). The three
// foundation-related field components mirror the S13 field-primitive
// layout (fields/ subdirectory) but each carries S23-specific
// behaviour — the StructureSelector's atomic re-stamp, the
// FoundationTypeSelector's compat-matrix-driven disabled reasons,
// and the BlockProductSelector's category filter.
export {
  MIGRATION_TOAST_AUTO_DISMISS_MS,
  MIGRATION_TOAST_MESSAGE,
  MigrationToast,
} from './MigrationToast';
export { StructureSelector } from './fields/StructureSelector';
export { FoundationTypeSelector } from './fields/FoundationTypeSelector';
export { BlockProductSelector } from './fields/BlockProductSelector';

