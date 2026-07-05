/**
 * `src/state/index.ts` — the SINGLE public entry point for the
 * state layer.
 *
 * Downstream layers (`src/scene/` — S9–S11, `src/ui/` — S12–S15)
 * MUST import from this barrel, never from a private submodule.
 * Enforcement:
 *
 *   - `.dependency-cruiser.cjs` limits `scene/` and `ui/` to
 *     `state/` (plus their own tree + domain/ + application/) —
 *     a direct `import '../state/design-store'` from a consumer is
 *     technically legal to dep-cruiser but the codebase convention
 *     is to route through this barrel so a submodule rename /
 *     split does not break downstream imports.
 *
 * ## Public surface (frozen — issue #9 §2)
 *
 *   store   useDesignStore, useUiStore
 *   hooks   useDesign, useLayout, useLayoutBounds, useWarnings,
 *           useDesignStatus, useUiUnits, useCameraPreset,
 *           useLayerVisibility, useStorageBanner
 *   types   DesignStoreState, DesignStoreActions,
 *           UiStoreState, UiStoreActions,
 *           CameraPreset, LayerVisibility, StorageBanner
 *   default DEFAULT_DESIGN_PARAMS, makeDefaultDesign
 *   constants AUTOSAVE_DEBOUNCE_MS
 *
 * ## Excluded surface
 *
 *   - `resetDesignStoreForTests` — test-only surface, kept out of
 *     the barrel so a component that reaches for it is a red flag.
 *     Import it directly from `./design-store` in a `.test.ts` file.
 *   - `flushAutosaveForTests` — same rationale.
 */

// ---- stores ----------------------------------------------------------------
export { useDesignStore, AUTOSAVE_DEBOUNCE_MS } from './design-store';
export type { DesignStoreState, DesignStoreActions, DesignStoreShape } from './design-store';

export { useUiStore } from './ui-store';
export type {
  CameraPreset,
  LayerVisibility,
  StorageBanner,
  UiStoreActions,
  UiStoreState,
} from './ui-store';

// ---- hooks -----------------------------------------------------------------
export {
  useCameraPreset,
  useDesign,
  useDesignStatus,
  useDismissedMigrationEventId,
  useLayerVisibility,
  useLayout,
  useLayoutBounds,
  useMigrationEventId,
  useRemediationsForWarning,
  useStorageBanner,
  useUiUnits,
  useWarnings,
  useWebglContextLost,
} from './hooks';

// ---- S16 issue #38 — remediation option types ------------------------------
//
// UI consumes these types via the state barrel so `ui-no-domain-spans`
// (in `.dependency-cruiser.cjs`) can forbid direct imports from
// `domain/spans/*` without cutting off type access. `RemediationOption`
// / `RemediationKind` / `RemediationPatch` originate in
// `domain/spans/remediations.ts`; state re-exports the value-free
// type shapes. The `applyRemediation` action reads a concrete
// `RemediationOption` — see `DesignStoreActions` above.
export type {
  RemediationKind,
  RemediationOption,
  RemediationPatch,
} from '../domain/spans';

// ---- default-design factory ------------------------------------------------
export { DEFAULT_DESIGN_PARAMS, makeDefaultDesign } from './default-design';

// ---- shared utility types --------------------------------------------------
//
// `DeepPartial<T>` originates in the application layer (see
// `src/application/types.ts`) — it is the exact type
// `applyParameters(patch: DeepPartial<DeckDesign>)` consumes. The ui
// layer needs the same type but the ui→application boundary rule
// forbids a direct import (S13 issue #14 Boundary Resolution §2:
// the panel talks to the store, not to application). Re-exporting
// through the state barrel gives ui a single sanctioned source of
// truth so a future refactor of `DeepPartial` (e.g. tightening to
// omit arrays) does not require touching both layers, and — more
// importantly — the type at the store call site and the type at
// the ui call site can never drift.
export type { DeepPartial } from '../application';
