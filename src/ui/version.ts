/**
 * `src/ui/version.ts` — read the wooddeck build version for display in
 * the `<AppHeader />` (S12 AC7).
 *
 * ## Why this is a UI-layer file (not a shared root helper)
 *
 * The persistence layer already has its own reader
 * (`persistence/deck-file/schema-v1.ts` → `getGeneratorVersion`) —
 * that copy stamps the version into `.deck` files. Duplicating the
 * ~10-line reader here keeps `ui/` free of a cross-layer dependency
 * (a `ui → persistence` import would break the S12 dumb-view boundary
 * — see `.dependency-cruiser.cjs` `ui-allowlist`), and the two
 * readers agree on the SAME compile-time constant so drift is
 * impossible in practice. Extraction to a shared `src/shared/`
 * helper is a future-refactor call — for now DRY-across-layers costs
 * more than the ~10 duplicated lines.
 *
 * ## Compile-time constant
 *
 * `__WOODDECK_VERSION__` is defined by `vite.config.ts` via
 * `define: { __WOODDECK_VERSION__: JSON.stringify(pkg.version) }`.
 * The declare-const below matches the schema-v1 pattern so
 * TypeScript sees the token; the `globalThis` fallback covers any
 * environment where the Vite define didn't run (bare node exec,
 * a broken vitest setup). Under vitest the token IS substituted at
 * transform time — `AppHeader.test.tsx` asserts a NON-fallback
 * string so a broken define breaks the tests loudly.
 *
 * Note: `typeof` on an undeclared identifier evaluates to the string
 * `'undefined'` WITHOUT throwing a ReferenceError, so no try/catch
 * is needed around the check.
 */

declare const __WOODDECK_VERSION__: string;

/**
 * The fallback string returned by {@link getAppVersion} when the
 * Vite `define` didn't substitute a real version. Exposed as a
 * constant so tests can pin the invariant "prod code never displays
 * the fallback".
 */
export const APP_VERSION_FALLBACK = '0.0.0-unknown';

/**
 * The app version string displayed in `<AppHeader />`. Never
 * throws — a missing define falls back to
 * {@link APP_VERSION_FALLBACK}.
 */
export function getAppVersion(): string {
  if (typeof __WOODDECK_VERSION__ === 'string' && __WOODDECK_VERSION__.length > 0) {
    return __WOODDECK_VERSION__;
  }
  const fallback = (globalThis as { __WOODDECK_VERSION__?: unknown }).__WOODDECK_VERSION__;
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : APP_VERSION_FALLBACK;
}
