/**
 * `src/ui/AppShell.tsx` — S12 issue #13.
 *
 * ## Responsibility (single)
 *
 * Provide a CSS-grid layout skeleton with named slots for the
 * composition root to fill: `main` (the DeckScene), `leftPanel`
 * (S13 parameters), `rightPanel` (S14 toggles/warnings/BOM/export).
 * The shell also mounts the app-level chrome — the non-dismissable
 * disclaimer banner (`<DisclaimerBanner />`), the persistence-event
 * banner (`<StorageBanner />`), and the app header (`<AppHeader />`).
 *
 * ## What the shell is NOT
 *
 * - Not a controller — no state, no dispatch. Slot props are pure
 *   ReactNode.
 * - Not a scene consumer — MUST NOT import from `src/scene/**`.
 *   The `main` slot is a plain ReactNode; the composition root
 *   (`src/App.tsx`) is the ONE place allowed to wire scene into
 *   the shell. Enforced by `.dependency-cruiser.cjs` `ui-allowlist`
 *   + boundary self-test BLOCK-2d.
 * - Not a domain-layout consumer — MUST NOT import from
 *   `src/domain/layout/**` (the layout engine's throw contract is
 *   surfaced through `useDesignStatus().lastError` from the state
 *   store — the UI never pre-computes mins locally). Enforced by
 *   the `ui-no-domain-layout` rule + boundary self-test BLOCK-2v.
 *   NOTE: `ui/` MAY import `src/domain/units`,
 *   `src/domain/materials-catalog`, and `src/domain/model` (types
 *   only) — this shell doesn't need them, but S13's ParameterPanel
 *   does (per Boundary Resolution §1 for issue #14).
 * - Not an application consumer — use-cases are the state store's
 *   concern. BLOCK-2s enforces.
 * - Not a persistence consumer — I/O flows through state + application.
 *   BLOCK-2t enforces.
 *
 * ## Slot layout (CSS grid)
 *
 *   +------------------------------------------------------+
 *   | DisclaimerBanner (sticky top)                        |
 *   +------------------------------------------------------+
 *   | StorageBanner (only when useUiStore.storageBanner    |
 *   |   is set)                                            |
 *   +------------------------------------------------------+
 *   | AppHeader (h1 wooddeck / version / spec link)        |
 *   +------------+----------------------------+------------+
 *   |            |                            |            |
 *   | leftPanel  |        main (Canvas)       | rightPanel |
 *   |  (aside)   |         (<main>)           |   (aside)  |
 *   |            |                            |            |
 *   +------------+----------------------------+------------+
 *
 * On viewports < 1024px wide, the two asides collapse below the
 * main region (`grid-template-areas` reshape in @media). Mobile
 * (< 640px) shows a "best viewed on desktop" note but the
 * disclaimer + main content remain visible.
 *
 * ## Accessibility (§10)
 *
 *   - `<header>` (role=banner) at the top for the AppHeader.
 *   - `<main>` (role=main) around the main slot.
 *   - Two `<aside>` (role=complementary) around the panels, each
 *     with an accessible name via `aria-label`.
 *   - Panels get `<h2>` section headings (the tests assert
 *     `getAllByRole('heading', { level: 2 })` — placeholder <h2>s
 *     land here until S13/S14 fill them).
 *   - color-scheme: light — dark-mode browsers do NOT auto-invert
 *     (spec § out-of-scope).
 *   - `prefers-reduced-motion` — every transition/animation in
 *     the shell CSS is gated by `@media (prefers-reduced-motion:
 *     no-preference)`.
 */
import type { JSX, ReactNode } from 'react';
import './styles/tokens.css';
import './styles/app-shell.css';
import { AppHeader } from './AppHeader';
import { ContextLostBanner } from './ContextLostBanner';
import { DisclaimerBanner } from './DisclaimerBanner';
import { StorageBanner } from './StorageBanner';
import { MigrationToast } from './MigrationToast';

/**
 * Props for {@link AppShell}. All three slots are REQUIRED —
 * `undefined`/`null` would leave a landmark empty, which is a
 * WCAG smell (an empty `<main>` is a page failure). If a consumer
 * genuinely needs a "no panel" state, pass an explicit placeholder
 * ReactNode (e.g. `<div />`) — that's a deliberate choice, not an
 * accidental omission.
 */
export interface AppShellProps {
  readonly leftPanel: ReactNode;
  readonly rightPanel: ReactNode;
  readonly main: ReactNode;
}

export function AppShell(props: AppShellProps): JSX.Element {
  return (
    <div className="wd-app-shell">
      {/*
       * DisclaimerBanner FIRST — SC-007 requires visibility on
       * first paint. The sticky-top positioning is CSS.
       */}
      <DisclaimerBanner />

      {/*
       * StorageBanner — only renders when useUiStore.storageBanner
       * is set. When null, StorageBanner returns null (no wrapper
       * div, no layout shift).
       */}
      <StorageBanner />

      {/*
       * ContextLostBanner (S12 pair-fix iter 1 — Fix C) — only
       * renders when useUiStore.webglContextLost is true (a
       * WebGL context-loss event fired somewhere in the scene).
       * Orthogonal to StorageBanner: the two can coexist. Null
       * when false, so no layout shift on the happy path.
       */}
      <ContextLostBanner />

      {/*
       * MigrationToast (S23 issue #45 AC5/AC6) — fixed-position
       * bottom-right toast that appears when the design-store
       * loads a v1 envelope and reports `migrated === true`. Does
       * NOT occupy layout space (position: fixed), so mounting
       * inside the AppShell body is safe. Auto-dismisses at 8 s or
       * on user click. Renders `null` when the ui-store flag is
       * false, so no DOM churn on the happy path.
       */}
      <MigrationToast />

      {/*
       * AppHeader — h1 name, version, spec link.
       */}
      <AppHeader />

      {/*
       * "Best viewed on desktop" note. Ticket §4: mobile layout
       * deferred; render the note (CSS hides it on wider
       * viewports) so a phone user learns the current state
       * rather than staring at a broken layout.
       */}
      <p className="wd-app-shell__mobile-note">Best viewed on desktop.</p>

      {/*
       * Grid body: leftPanel | main | rightPanel.
       * <aside> elements get aria-label so the two "complementary"
       * landmarks are distinguishable in a screen-reader landmark
       * list ("aside: Parameters" vs "aside: Toggles"). The <h2>
       * inside each aside is the RENDERED title; aria-label is the
       * ACCESSIBLE NAME — both must exist per WCAG landmark
       * guidance.
       */}
      <div className="wd-app-shell__body">
        <aside className="wd-app-shell__left" aria-label="Parameters panel">
          {props.leftPanel}
        </aside>

        <main className="wd-app-shell__main" aria-label="Deck view">
          {props.main}
        </main>

        <aside className="wd-app-shell__right" aria-label="Tools panel">
          {props.rightPanel}
        </aside>
      </div>
    </div>
  );
}
