/**
 * `src/ui/storage-banner-messages.ts` — the centralized code → user-
 * facing message map for `<StorageBanner />`.
 *
 * Extracted from `StorageBanner.tsx` so the file stays "components
 * only" (satisfies `eslint-plugin-react-refresh/only-export-components`
 * — a mixed export of components + object constants breaks Vite HMR
 * for the whole module).
 *
 * ## Why this file is the source of truth
 *
 * - S14 will extend `StorageBanner` (state union in `state/ui-store.ts`)
 *   to surface DeckFileError codes. Add a new key here + a new
 *   discriminator in `state/ui-store.ts`; TypeScript's exhaustive-record
 *   check (see `NonNullStorageBanner`) flags the missing key.
 * - Copy edits go through ONE place (grep-friendly).
 * - Related to DeckFileError codes — see
 *   `src/persistence/deck-file/DeckFileError.ts`. When S14 wires the
 *   .deck-file load-failure surface, extend the state union FIRST,
 *   map here — do NOT render `DeckFileError.message` verbatim (that
 *   string is derived from untrusted file input; the S6 security
 *   constraint bans dangerouslySetInnerHTML but a raw `{err.message}`
 *   textContent render is still allowed — see docs/ARCHITECTURE.md
 *   § "textContent constraint").
 */
import type { StorageBanner as StorageBannerCode } from '../state/ui-store';

/**
 * The non-null variant of `StorageBanner` — the set of codes that
 * actually render a message. `null` means "no banner", handled
 * separately by `<StorageBanner />` (early return).
 */
export type NonNullStorageBanner = Exclude<StorageBannerCode, null>;

/**
 * Centralized `code → user-facing message` map. Every non-null
 * `StorageBanner` discriminator MUST have a matching entry — the
 * `Record<NonNullStorageBanner, string>` type is intentionally
 * tight so TypeScript flags a missing key when the union grows.
 *
 * Copy notes:
 *   - AC4 pins the exact 'storage-full' string; do NOT rephrase.
 *   - 'storage-blocked' names BOTH the cause ("private browsing")
 *     and the mitigation ("download the .deck file") in one line.
 *   - 'load-recompute-failed' matches the S8 pinned comment
 *     recommended wording verbatim.
 */
export const STORAGE_BANNER_MESSAGES: Record<NonNullStorageBanner, string> = {
  'storage-full':
    'Local storage is full. Your design will not be autosaved. Download the .deck file to keep it safe.',
  'storage-blocked':
    'Local storage is blocked (private browsing or a browser setting). Your design will not be autosaved — download the .deck file to keep it safe.',
  'load-recompute-failed':
    "We couldn't reopen your saved design — starting from a default.",
};
