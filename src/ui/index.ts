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
 *   components  AppShell, AppHeader, DisclaimerBanner, StorageBanner
 *   constants   DISCLAIMER_TEXT           — spec § FR-016 frozen copy
 *               STORAGE_BANNER_MESSAGES   — code → message map (S8 union)
 *               SPEC_LINK_HREF            — AC7 spec-link target
 *               APP_VERSION_FALLBACK      — sentinel returned by getAppVersion
 *                                            when the Vite define did not run
 *   functions   getAppVersion             — reads __WOODDECK_VERSION__
 *   types       AppShellProps
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

export { APP_VERSION_FALLBACK, getAppVersion } from './version';
