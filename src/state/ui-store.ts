/**
 * `src/state/ui-store.ts` — the Zustand store for TRANSIENT UI state.
 *
 * ## Two-store discipline (issue #9 §2 + Code Review Guardian finding #9)
 *
 * The design layer of wooddeck is split into TWO Zustand stores by
 * design (not by coincidence):
 *
 *   - `useDesignStore`  — owns the canonical `DesignBundle` + I/O
 *                         actions. Every mutation lives in `.temporal`
 *                         (zundo undo/redo scaffold).
 *   - `useUiStore`      — this file. Owns view-only state
 *                         (camera preset, layer visibility, unit
 *                         DISPLAY mode) + the AC6 storage banner.
 *
 * NEITHER store references the other's slice at the state level. The
 * design store's autosave path DOES call `useUiStore.getState()
 * .setStorageBanner(...)` on a save failure — that is an ACTION-to-
 * ACTION cross-store call, not a state coupling. It keeps the two
 * stores' STATE disjoint (AC1 assertion) while letting the design
 * store surface user-facing feedback.
 *
 * Why `disclaimerAcknowledged` is FROZEN `false`:
 *   Per issue #9 §2 interface contract — the field is kept in the
 *   shape as a boolean so a future acknowledgement UX can flip it,
 *   but MVP renders the disclaimer permanently visible (spec US3 AC2:
 *   "cannot be dismissed"). No setter is exposed and the field is
 *   documented as a permanent `false`.
 *
 * ## Load-notice channel (AC9 wiring)
 *
 * The design store's boot-time recovery path (AC9 — a stored design
 * that recomputes to `LayoutError` at boot) needs a channel to
 * surface "we couldn't load your saved design — starting fresh".
 * Rather than add a distinct field, we REUSE `storageBanner` with a
 * new discriminator value: `'load-recompute-failed'`. Rationale:
 *
 *   - AC9 pinned comment explicitly permits reuse ("Reuse the
 *     storageBanner channel or add a distinct notice field — your
 *     call, but document it.").
 *   - The UI (S12) already needs a general "there is a persistence
 *     event to show" banner surface; one field, three discriminator
 *     values, one dismiss path.
 *   - The banner code is the enum EXPANSION of the AC6 codes; the
 *     three values remain distinguishable so the S12 renderer can
 *     pick different microcopy per code.
 *
 * See `design-store.ts` for the AC9 recovery flow.
 *
 * ## Boundary discipline
 *
 * This store imports from `zustand` only — no React components, no
 * DOM APIs, no application-layer use-cases. That keeps `ui-store.ts`
 * safely importable from anywhere in the app (the design store
 * imports it via `getState()` to reach `setStorageBanner`).
 */

import { create } from 'zustand';

/**
 * The three CAMERA presets S9's `<DeckScene>` supports plus the
 * default free-orbit mode. Adding a new preset here MUST be paired
 * with an S9 scene-controls update — the union serves as the
 * exhaustive `switch` discriminant for camera setup.
 */
export type CameraPreset = 'orbit' | 'top' | 'front' | 'side' | 'iso';

/**
 * The seven visual LAYERS a user can toggle. Names match the domain
 * `MemberKind` set (`joist` / `beam` / `post` / `footing` / `board` /
 * `block`) plus `environment` (ground plane + shadows).
 * `board` is renamed to `decking` here to match user-facing
 * vocabulary; `block` is pluralized to `blocks` for the same reason.
 * Layer maps to scene-graph visibility toggles in S9/S10/S22.
 *
 * ## S22 addition (Epic 2 / FR-029)
 *
 *   - `blocks`   — foundation blocks (Oldcastle precast concrete or
 *     TuffBlock polypropylene). Rendered by the S22 `BlocksLayer`.
 *
 * ## S26 FIX #6 (review-gate) — `blocking` REMOVED
 *
 * S22 originally added a `blocking` key for "short lumber blocks
 * between beams for lateral bracing." S26's floating rework removed
 * that concept from the layout (`floating-layout.ts` emits ZERO
 * `blocking` members), leaving the toggle wired to an
 * always-empty layer — misleading UI. The key is removed from
 * `LayerVisibility` + `LAYER_ITEMS`; the dormant `BlockingLayer`
 * component and the `blocking` `MemberKind` are preserved so a
 * future "blocking between joists" feature can cheaply re-add the
 * toggle. See `scene/layers/BlockingLayer.tsx` for the re-add path.
 */
export interface LayerVisibility {
  readonly environment: boolean;
  readonly decking: boolean;
  readonly joists: boolean;
  readonly beams: boolean;
  readonly posts: boolean;
  readonly footings: boolean;
  readonly blocks: boolean;
}

/**
 * The banner union — three persistence-event codes plus the "no
 * event" `null`. See module header for why AC9 (load-recompute
 * failure) reuses this channel with `'load-recompute-failed'`.
 */
export type StorageBanner = null | 'storage-full' | 'storage-blocked' | 'load-recompute-failed';

/**
 * The (state, actions) UNION exposed by `useUiStore`. Fields are
 * frozen against the issue #9 §2 interface contract. `readonly` on
 * every field enforces immutable-update discipline — mutations MUST
 * flow through `set(...)` in the actions.
 */
export interface UiStoreState {
  readonly units: 'imperial' | 'metric';
  readonly cameraPreset: CameraPreset;
  readonly layerVisibility: LayerVisibility;
  /**
   * Frozen `false` — spec US3 AC2 requires the disclaimer to render
   * for the duration of the session. No setter is exposed; the field
   * is present for a future acknowledgement UX (post-MVP).
   */
  readonly disclaimerAcknowledged: false;
  /**
   * Persistence-event banner. `null` = no active event; other values
   * = user-facing message S12 will render. See module header for the
   * three discriminator values.
   */
  readonly storageBanner: StorageBanner;
  /**
   * WebGL context-lost flag — set by
   * {@link installContextLossHandler} (in `src/scene/context-loss.ts`)
   * when the GPU driver drops the context. Rendered as a
   * user-facing "3D view crashed — please reload" banner by S12's
   * `<ContextLostBanner>`. Kept as a SEPARATE field from
   * `storageBanner` because the two concerns are orthogonal
   * (persistence vs. graphics) and their banners must be able to
   * coexist — e.g. a page in `storage-full` state can also lose
   * its WebGL context.
   *
   * ## Boundary (S12 pair-fix iter 1 — Fix C)
   *
   * The scene layer MAY write this via
   * `useUiStore.getState().setWebglContextLost(true)`. Scene→state
   * is an allowed boundary (scene reads state via the granular
   * hooks; writing an ORTHOGONAL surface via `getState()` follows
   * the same channel — see the `design-store.setStorageBanner`
   * precedent). The UI layer reads it via
   * `useUiStore(s => s.webglContextLost)` — ui→state, also allowed.
   * Neither direction requires a scene↔ui coupling.
   */
  readonly webglContextLost: boolean;
  /**
   * S23 — the v1→v2 migration EVENT counter.
   *
   * ## Discrete-event semantics (S23 pair-fix — GPT MED #2 / Opus INFO)
   *
   * The pre-pair-fix design used a `migrationJustHappened: boolean`
   * flag. Zustand's default `Object.is` equality made a re-set of
   * `true` while ALREADY `true` a NO-OP — so:
   *   (i)  A v1→v2 load while a prior toast was still visible did
   *        NOT restart the 8 s timer and did NOT re-announce.
   *   (ii) The flag wasn't cleared on load-start, so a stale toast
   *        could linger across a subsequent non-migrated load.
   *
   * The fix models the surface as a DISCRETE event stream:
   *
   *   - `migrationEventId: number` — monotonic counter.
   *     Incremented by `notifyMigrationHappened()` from the
   *     design-store's `loadFromFile` / `loadFromLocalStorage`
   *     when `migrated === true`. Starts at `0` (no event).
   *   - `dismissedMigrationEventId: number` — the id up to which
   *     migration events are considered dismissed. Starts at `0`.
   *     A dismiss action (`dismissMigration()`) sets it to the
   *     current `migrationEventId`.
   *
   * The toast is visible iff `migrationEventId >
   * dismissedMigrationEventId`. Each new migration bumps the
   * event id, which — as long as it exceeds the last-dismissed id
   * — flips the visibility back to true AND changes a `useEffect`
   * dependency in `<MigrationToast>` so the 8 s auto-dismiss
   * timer restarts fresh per event.
   *
   * ## Non-migrated loads (`{migrated: false}`)
   *
   * The load handlers do NOT touch either counter on a v2 load —
   * that matches the pre-fix "boolean is false at rest" behaviour
   * for successful non-migration loads. A stale toast (from a
   * prior v1 load) is dismissed via the ordinary click / 8 s
   * paths, not incidentally by a subsequent load.
   *
   * ## Why a `number` (not a `symbol` / opaque id)
   *
   * A `number` compares cheaply, serializes in dev-tools, and
   * the "monotonic" invariant is trivially auditable. Overflow
   * is not a concern (`Number.MAX_SAFE_INTEGER` ≈ 9e15; a real
   * user cannot fire 9e15 migration events).
   *
   * ## Why a boolean, not a payload — historical note
   *
   * The pre-pair-fix rationale (a boolean is enough for a fixed-
   * copy toast) still holds — the toast copy is compile-time
   * pinned. Promoting to a `{id, from, to} | null` shape is a
   * safe widening if a future story wants per-migration detail.
   */
  readonly migrationEventId: number;
  /**
   * See `migrationEventId` — the id up to which migration events
   * are considered dismissed.
   */
  readonly dismissedMigrationEventId: number;
}

export interface UiStoreActions {
  setUnits(units: 'imperial' | 'metric'): void;
  setCameraPreset(preset: CameraPreset): void;
  toggleLayer(name: keyof LayerVisibility): void;
  showAllLayers(): void;
  hideAllLayers(): void;
  setStorageBanner(banner: StorageBanner): void;
  /**
   * Set the WebGL context-lost flag. Called by the scene's
   * `installContextLossHandler` when the GPU driver drops the
   * context. Idempotent — setting to `true` twice is a no-op.
   * There is NO setter to `false`: WebGL context-restored is a
   * separate event we don't yet handle, and reloading the page
   * is the only reliable recovery. If a future story implements
   * proper restore-and-recreate, this contract can loosen.
   */
  setWebglContextLost(lost: boolean): void;
  /**
   * S23 — notify that a v1→v2 migration just occurred. Called
   * with no arguments by the design-store load handlers
   * (`loadFromFile`, `loadFromLocalStorage`) when the
   * application-layer loader returned `{migrated: true}`. Bumps
   * `migrationEventId` by 1 — the monotonic counter is what makes
   * two back-to-back migrations distinguishable (see doc on the
   * state field for the full rationale — S23 pair-fix GPT MED #2).
   */
  notifyMigrationHappened(): void;
  /**
   * S23 — dismiss the CURRENT outstanding migration event. Called
   * by `<MigrationToast>`'s click / 8 s auto-dismiss / unmount
   * paths. Sets `dismissedMigrationEventId` to the current
   * `migrationEventId`. Idempotent — repeated dismisses of the
   * same event are no-ops.
   */
  dismissMigration(): void;
}

/**
 * All seven layers on — the boot-time default. Extracted so both
 * the store initializer and `showAllLayers()` can share the same
 * value (DRY — a new layer added to the union means updating ONE
 * place).
 *
 * S22 addition — `blocks` joins the six S10 layers.
 * S26 FIX #6 — `blocking` REMOVED from LayerVisibility (see
 * interface doc); the dormant scene layer + MemberKind remain.
 */
const ALL_LAYERS_VISIBLE: LayerVisibility = Object.freeze({
  environment: true,
  decking: true,
  joists: true,
  beams: true,
  posts: true,
  footings: true,
  blocks: true,
});

/**
 * All seven layers off — utility for `hideAllLayers()`. Kept as a
 * module-scope frozen literal so every `hideAllLayers()` invocation
 * returns the same reference; consumers that key on referential
 * equality see a stable value.
 */
const ALL_LAYERS_HIDDEN: LayerVisibility = Object.freeze({
  environment: false,
  decking: false,
  joists: false,
  beams: false,
  posts: false,
  footings: false,
  blocks: false,
});

export const useUiStore = create<UiStoreState & UiStoreActions>((set) => ({
  // ---- state -----------------------------------------------------
  units: 'imperial',
  cameraPreset: 'orbit',
  layerVisibility: ALL_LAYERS_VISIBLE,
  disclaimerAcknowledged: false,
  storageBanner: null,
  webglContextLost: false,
  migrationEventId: 0,
  dismissedMigrationEventId: 0,

  // ---- actions ---------------------------------------------------
  //
  // Every action is a THIN wrapper — `set` a single field. No I/O,
  // no derived data, no cross-store call. Matches the Code Review
  // Guardian finding #1 rule (issue #9 §2): actions are thin.
  setUnits(units): void {
    set({ units });
  },
  setCameraPreset(cameraPreset): void {
    set({ cameraPreset });
  },
  toggleLayer(name): void {
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [name]: !state.layerVisibility[name] },
    }));
  },
  showAllLayers(): void {
    set({ layerVisibility: ALL_LAYERS_VISIBLE });
  },
  hideAllLayers(): void {
    set({ layerVisibility: ALL_LAYERS_HIDDEN });
  },
  setStorageBanner(storageBanner): void {
    set({ storageBanner });
  },
  setWebglContextLost(webglContextLost): void {
    set({ webglContextLost });
  },
  notifyMigrationHappened(): void {
    // Monotonic increment — see `migrationEventId` field doc for
    // the discrete-event semantics. Uses the `(state) => ...`
    // updater form so a rapid double-call (should never happen in
    // real load handlers but defense in depth) sees the fresh
    // counter each time.
    set((state) => ({ migrationEventId: state.migrationEventId + 1 }));
  },
  dismissMigration(): void {
    // Sync the dismissed pointer to the current event id — the
    // toast's `migrationEventId > dismissedMigrationEventId`
    // predicate falls to false, the render returns null.
    set((state) => ({ dismissedMigrationEventId: state.migrationEventId }));
  },
}));
