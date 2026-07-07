/**
 * `src/ui/StorageBanner.tsx` — S12 issue #13 AC4 + inherited
 * obligation #3 (S8 three-discriminator coverage) + inherited
 * obligation #5 (S6 textContent-only render).
 *
 * ## Responsibility (single)
 *
 * Read `useUiStore(s => s.storageBanner)` and render the matching
 * message. Three non-null discriminators:
 *
 *   - `'storage-full'`         (AC6 — autosave rejected as quota-exceeded)
 *   - `'storage-blocked'`      (AC6 — Storage API unavailable / private-browsing)
 *   - `'load-recompute-failed'` (AC9 — a stored design that no longer
 *                                computes at boot; recovery is "start
 *                                from default")
 *
 * The `'load-recompute-failed'` banner INCLUDES a "Reset to default"
 * button that calls `useDesignStore.getState().reset()` — S8 Opus
 * INFO#11: without this affordance the user is trapped in a
 * boot-each-time-see-the-banner loop.
 *
 * ## Why we render via a message MAP, not a switch in JSX
 *
 * Centralizing `code → message` in one exported const
 * (STORAGE_BANNER_MESSAGES) means:
 *
 *   - S14 (which will surface DeckFileError codes) can extend the
 *     union by adding one key here + updating the type, and every
 *     test that asserts "exhaustive" fires until the map catches up.
 *   - Copy edits go through ONE place (grep-friendly).
 *   - The banner itself stays a thin render function — no error-
 *     code discovery scattered through JSX.
 *
 * Related to DeckFileError codes — see
 * `src/persistence/deck-file/DeckFileError.ts`. When S14 wires the
 * .deck-file load-failure surface, extend `StorageBanner` (state
 * union) FIRST, then map here — do NOT render `DeckFileError.message`
 * directly (that string is derived from untrusted file input; the S6
 * security constraint bans dangerouslySetInnerHTML but a raw
 * `{err.message}` textContent render is still allowed — see
 * docs/ARCHITECTURE.md § "textContent constraint").
 *
 * ## Boundary
 *
 * - Reads `useUiStore` (S8 barrel — see .dependency-cruiser.cjs
 *   ui-allowlist).
 * - Calls `useDesignStore.getState().reset()` — an ACTION on the
 *   state store, no direct persistence coupling.
 * - No scene, no domain, no application imports.
 */
import type { JSX } from 'react';
import './styles/tokens.css';
import './styles/storage-banner.css';
import { useDesignStore } from '../state/design-store';
import { useUiStore } from '../state/ui-store';
import { STORAGE_BANNER_MESSAGES } from './storage-banner-messages';

/**
 * Persistence-event banner. Reads `useUiStore(s => s.storageBanner)`
 * with a scoped selector (one field, not the whole store) so the
 * banner doesn't re-render on every UI-store mutation.
 */
export function StorageBanner(): JSX.Element | null {
  // Scoped selector — a mutation to `units` or `cameraPreset`
  // must NOT re-render the banner. This mirrors the pattern in
  // src/state/hooks.ts `useStorageBanner`.
  const code = useUiStore((s) => s.storageBanner);

  // Null → nothing to render. AC4 baseline: no banner surface,
  // no wrapper div (an empty <div> would still shift layout).
  if (code === null) {
    return null;
  }

  const message = STORAGE_BANNER_MESSAGES[code];

  return (
    <div
      className={`wd-storage-banner wd-storage-banner--${code}`}
      role="alert"
      // aria-live=polite (default for role=alert is 'assertive' —
      // that interrupts screen-reader speech. Downshift to polite
      // so the banner announces at the next natural break rather
      // than mid-sentence).
      aria-live="polite"
    >
      {/*
       * Message rendered as textContent (React default). S6
       * Security constraint (inherited obligation #5): NEVER
       * dangerouslySetInnerHTML — even for compile-time strings.
       * Binds S14 too (which will render .deck-file error text).
       */}
      <span className="wd-storage-banner__message">{message}</span>
      {code === 'load-recompute-failed' && <ResetToDefaultButton />}
    </div>
  );
}

/**
 * The AC9 recovery affordance. Extracted so the button's click
 * handler + a11y wiring live in one testable unit.
 *
 * Behaviour: call `reset()` on the design store, then clear the
 * banner. Both are ACTIONS — no direct persistence coupling. The
 * banner clear (setStorageBanner(null)) ensures the user isn't
 * left staring at "starting from a default" after they actively
 * reset.
 */
function ResetToDefaultButton(): JSX.Element {
  return (
    <button
      type="button"
      className="wd-storage-banner__reset"
      onClick={(): void => {
        // Read the store's action reference AT CLICK TIME (not at
        // render time) so a hot-reload replacing the store doesn't
        // leave a stale closure. `getState()` always returns the
        // current instance.
        useDesignStore.getState().reset();
        useUiStore.getState().setStorageBanner(null);
      }}
    >
      Reset to default
    </button>
  );
}
