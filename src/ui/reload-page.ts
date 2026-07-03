/**
 * `src/ui/reload-page.ts` — a THIN wrapper around
 * `window.location.reload()`.
 *
 * ## Why it lives in its own module
 *
 * Both `<SceneErrorBoundary>` (Fix B) and `<ContextLostBanner>`
 * (Fix C) surface a "Reload page" button. Sharing the implementation
 * keeps the reload semantics identical (a full page reload — not
 * `history.go(0)`, not a soft SPA route change) so users get the
 * same recovery contract regardless of which failure they hit.
 *
 * Extracting to a NON-component module also satisfies the
 * `react-refresh/only-export-components` lint rule: the two
 * component modules can `export const CONSTANT` alongside their
 * component (allowed by `allowConstantExport: true`) but cannot
 * export a plain function without disabling HMR fast-refresh.
 */

/**
 * Trigger a full-page reload. Test-friendly indirection point:
 * tests may spy on `window.location.reload` (via `vi.stubGlobal`)
 * to assert the button was clicked without actually navigating
 * (JSDOM would throw on real navigation).
 */
export function reloadPage(): void {
  window.location.reload();
}
