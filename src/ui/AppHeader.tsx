/**
 * `src/ui/AppHeader.tsx` — S12 issue #13 AC7.
 *
 * The app header carries three items:
 *   - the app name ("wooddeck") as `<h1>` (page-level landmark)
 *   - the running build version (from Vite `define`)
 *   - a link to the spec at the repo URL
 *
 * That's the whole header — this is intentional. Any future addition
 * (breadcrumb, project name, save-status pip) is a separate PR so
 * the "grep and see" invariant stays useful.
 *
 * ## Landmarks & headings (WCAG 2.2 §10)
 *
 * The `<header>` element outside `<article>`/`<section>` is
 * announced as `role="banner"` — the top-level page landmark. The
 * `<h1>` is the primary heading (there's exactly one per page).
 * The spec link opens in a new tab (`target="_blank"`) so users
 * don't lose their in-progress design; `rel="noopener noreferrer"`
 * is the standard security default (OWASP + web.dev).
 */
import type { JSX } from 'react';
import './styles/tokens.css';
import './styles/app-header.css';
import { getAppVersion } from './version';

/**
 * The spec-link href — pinned to the checked-in spec on the `main`
 * branch of the vbomfim/wooddeck repo. Exported so
 * `AppHeader.test.tsx` can assert the exact string (a typo would
 * lead users to a 404 on the first click of the app's lifetime).
 */
export const SPEC_LINK_HREF =
  'https://github.com/vbomfim/wooddeck/blob/main/specs/mvp-deck-designer/spec.md';

export function AppHeader(): JSX.Element {
  const version = getAppVersion();
  return (
    <header className="wd-app-header">
      <h1 className="wd-app-header__title">wooddeck</h1>
      <span className="wd-app-header__version" aria-label={`version ${version}`}>
        v{version}
      </span>
      {/*
       * External link to the spec. target=_blank so the in-progress
       * design isn't lost; rel=noopener noreferrer so the
       * newly-opened tab can't reach back into wooddeck via
       * window.opener.
       */}
      <a
        className="wd-app-header__spec-link"
        href={SPEC_LINK_HREF}
        target="_blank"
        rel="noopener noreferrer"
      >
        Spec
      </a>
    </header>
  );
}
