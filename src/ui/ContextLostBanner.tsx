/**
 * `src/ui/ContextLostBanner.tsx` — WebGL context-lost surfacing.
 *
 * ## Why (S12 pair-fix iter 1 — Fix C / browser UAT finding)
 *
 * The scene's `installContextLossHandler` (`src/scene/context-loss.ts`,
 * S9 §5) was previously console-only: `console.error('[wooddeck:scene]
 * WebGL context lost…')`. A live browser UAT showed users whose
 * GPU driver hiccups saw a broken/blank canvas with zero
 * explanation. S9's ticket §5 explicitly wanted: "UI banner shows
 * '3D view crashed — please reload.'"
 *
 * This component reads `useUiStore(s => s.webglContextLost)` (a
 * flag the scene handler now flips) and renders a persistent,
 * accessible banner with a Reload button. Rest of the shell —
 * disclaimer, side panels, header — remains usable while the
 * banner shows.
 *
 * ## Why a separate banner (not `StorageBanner`)
 *
 * Persistence events (`storageBanner`) and graphics events
 * (`webglContextLost`) are ORTHOGONAL — the two banners must be
 * able to coexist. A page in `storage-full` can also lose its
 * WebGL context, and the user needs both messages. Reusing the
 * `storageBanner` discriminator union would race the two.
 *
 * ## Contract
 *
 * - When `webglContextLost === false` → renders `null` (empty
 *   fragment; no wrapper div, no layout shift).
 * - When `webglContextLost === true` → renders a banner with
 *   `role="alert"` (announced by screen readers on state change)
 *   plus a "Reload page" button that calls `window.location.reload()`.
 *
 * ## Boundary
 *
 * Pure UI — reads from `state/` (via granular hook), imports
 * nothing else. Dep-cruiser `ui-allowlist` enforces.
 */
import type { JSX } from 'react';

import { useWebglContextLost } from '../state';
import { reloadPage } from './reload-page';
import './styles/context-lost-banner.css';

/**
 * The banner copy. Exported as constants so tests can grep-import
 * the exact strings + so future translation has one hook.
 */
export const CONTEXT_LOST_TITLE = '3D view crashed';
export const CONTEXT_LOST_BODY =
  'The graphics context was lost — please reload the page to restore the 3D view.';
export const CONTEXT_LOST_RELOAD_LABEL = 'Reload page';

export function ContextLostBanner(): JSX.Element | null {
  const isContextLost = useWebglContextLost();
  if (!isContextLost) {
    return null;
  }
  return (
    <div className="wd-context-lost" role="alert" aria-label="Graphics error">
      <div className="wd-context-lost__message">
        <strong className="wd-context-lost__title">{CONTEXT_LOST_TITLE}</strong>
        <span className="wd-context-lost__body">{CONTEXT_LOST_BODY}</span>
      </div>
      <button
        type="button"
        className="wd-context-lost__reload"
        onClick={reloadPage}
      >
        {CONTEXT_LOST_RELOAD_LABEL}
      </button>
    </div>
  );
}
