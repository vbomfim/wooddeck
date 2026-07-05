/**
 * `src/ui/MigrationToast.tsx` — S23 issue #45 AC5/AC6.
 *
 * ## Responsibility (single)
 *
 * Render a one-time "Migrated from v1 — elevated + posts on
 * footings applied" info-toast when the ui-store's discrete
 * migration-event stream indicates a v1→v2 migration just occurred.
 *
 * ## Discrete-event model (S23 pair-fix — GPT MED #2 / Opus INFO)
 *
 * The pre-pair-fix design used a `migrationJustHappened: boolean`
 * flag; Zustand's default `Object.is` equality made a re-set of
 * `true` while ALREADY `true` a NO-OP — so a second v1→v2 load
 * while the toast was still visible failed to restart the 8 s
 * timer and failed to re-announce. The fix models the surface as
 * two monotonic counters on the ui-store:
 *
 *   - `migrationEventId`         — bumped by
 *     `notifyMigrationHappened()` on each v1→v2 load.
 *   - `dismissedMigrationEventId` — synced to `migrationEventId`
 *     by `dismissMigration()` on click / 8 s timer / unmount.
 *
 * Visibility: `migrationEventId > dismissedMigrationEventId`.
 * The 8 s auto-dismiss `useEffect` is KEYED on the pair — a new
 * migration during a still-visible toast (`migrationEventId` bumps
 * again) triggers a fresh effect cycle: the previous timer is
 * cancelled via the effect cleanup, a new 8 s timer is scheduled,
 * and the announcement fires again (from React's perspective the
 * `<div role="status">` is the SAME element, but the effect
 * re-run is enough for the WAI-ARIA polite live region to
 * re-announce).
 *
 * ## Boundary (S23 pair-fix — Opus INFO #12)
 *
 * Reads the two counters via EXPORTED hooks
 * (`useMigrationEventId`, `useDismissedMigrationEventId`) from the
 * `state/` barrel — not by reaching directly into `useUiStore`.
 * This matches the `useLayerVisibility` / `useCameraPreset`
 * pattern and keeps the store's internal slice shape opaque
 * from this component.
 *
 * Dismiss writes still go through `useUiStore.getState()
 * .dismissMigration()` — an ACTION call, not a state slice read.
 * Same discipline as `<StorageBanner>` and other one-off UI
 * feedback surfaces.
 *
 * ## Auto-dismiss timer discipline
 *
 * The `useEffect` is keyed on `[migrationEventId,
 * dismissedMigrationEventId]`. When either counter changes the
 * effect re-runs, cancelling the prior timer via cleanup. Three
 * consequences:
 *
 *   1. A user-click-dismiss bumps `dismissedMigrationEventId`
 *      to `migrationEventId` — the effect re-runs, the visibility
 *      predicate falls to false, the new effect installs no
 *      timer, and the render returns `null`.
 *   2. A new migration bumps `migrationEventId` — the effect
 *      re-runs with a fresh dependency, the OLD timer is
 *      cancelled, a NEW 8 s timer starts. This is the
 *      restart-on-fresh-event behavior the pair-fix required.
 *   3. Unmount runs the cleanup — no zombie timer fires after
 *      the parent tree has been torn down.
 *
 * ## WCAG (S23 pair-fix — Opus MED #6)
 *
 * The pre-pair-fix wrapper `<div>` carried `onClick` for a
 * "click-anywhere" dismiss + `cursor: pointer`. WCAG 2.1.1 says
 * every interaction must be keyboard-operable; a bare `<div>`
 * with `onClick` fails that criterion (it has no accessible name
 * and no focus). The dedicated `<button>` already covers both
 * keyboard and mouse dismissal, so the click-anywhere convenience
 * was subtractive — it was fixed by removing it and the wrapper
 * is now a plain `role="status"` region.
 *
 * ## textContent-only render (S6 security constraint)
 *
 * The message is a compile-time literal (`MIGRATION_TOAST_MESSAGE`)
 * rendered as a plain React child. No `dangerouslySetInnerHTML`.
 * The same discipline applies to StorageBanner — see that file's
 * module header for the S6 boundary reference.
 */
import { useEffect, type JSX } from 'react';

import {
  useDismissedMigrationEventId,
  useMigrationEventId,
  useUiStore,
} from '../state';

import './styles/tokens.css';
import './styles/migration-toast.css';

/**
 * The pinned toast copy (S23 AC5). Named-export so tests can
 * assert on it without duplicating the string. A copy edit lands
 * in ONE place; the topic-word regex tests in
 * `MigrationToast.test.tsx` allow a minor rewording while pinning
 * the three signal words ("v1", "elevated", "posts on footings").
 */
export const MIGRATION_TOAST_MESSAGE =
  'Migrated from v1 — elevated + posts on footings applied.';

/**
 * The auto-dismiss window (S23 AC5 pins "~8 s"). 8000 ms exactly.
 * Exported so tests can advance fake timers by the precise value.
 */
export const MIGRATION_TOAST_AUTO_DISMISS_MS = 8000;

/**
 * The dismiss-button label. Extracted as a constant so a11y tests
 * (`getByRole('button', {name: /dismiss/i})`) and the future
 * localization pass touch ONE string.
 */
const DISMISS_BUTTON_LABEL = 'Dismiss';

/**
 * The v1→v2 migration info-toast. Renders NULL when the outstanding
 * event id has already been dismissed — no wrapper, no layout shift.
 */
export function MigrationToast(): JSX.Element | null {
  // Two scoped selectors — only re-render on the counters this
  // component actually needs. Same pattern as other one-off UI
  // surfaces (StorageBanner, ContextLostBanner).
  const eventId = useMigrationEventId();
  const dismissedId = useDismissedMigrationEventId();
  const isVisible = eventId > dismissedId;

  // Auto-dismiss timer. Effect keyed on BOTH counters:
  //   - `eventId` changes on each new migration → fresh timer,
  //     the prior timer is cancelled via cleanup, the toast
  //     restarts.
  //   - `dismissedId` changes on each dismiss → the visibility
  //     predicate falls to false; the effect re-runs and does
  //     not schedule a new timer.
  // The isVisible-guard skips timer creation on non-visible
  // renders (a v2 load with no outstanding event).
  useEffect(() => {
    if (!isVisible) return;
    const timerId = setTimeout(() => {
      // Read the action at fire time — a hot-reload replacing the
      // store leaves no stale closure. Same discipline as
      // StorageBanner's reset button.
      useUiStore.getState().dismissMigration();
    }, MIGRATION_TOAST_AUTO_DISMISS_MS);
    return (): void => {
      clearTimeout(timerId);
    };
  }, [eventId, dismissedId, isVisible]);

  if (!isVisible) {
    return null;
  }

  // `role="status"` (implicit `aria-live="polite"`) — a passive
  // announcement, NOT the assertive `role="alert"` that would
  // interrupt screen reader speech mid-word. The migration notice
  // is informational, not urgent.
  //
  // No click-anywhere `onClick` on the wrapper (S23 pair-fix
  // Opus MED #6 — WCAG 2.1.1). The dedicated Dismiss button
  // is the SOLE interactive surface: keyboard-reachable via
  // Tab, activatable via Space / Enter, with an announced
  // accessible name.
  return (
    <div className="wd-migration-toast" role="status" aria-live="polite">
      <span className="wd-migration-toast__message">
        {MIGRATION_TOAST_MESSAGE}
      </span>
      <button
        type="button"
        className="wd-migration-toast__dismiss"
        onClick={(): void => {
          useUiStore.getState().dismissMigration();
        }}
      >
        {DISMISS_BUTTON_LABEL}
      </button>
    </div>
  );
}
