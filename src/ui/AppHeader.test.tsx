/**
 * `AppHeader.test.tsx` — S12 issue #13 AC7.
 *
 * The header carries three items:
 *   - the app name ("wooddeck") as the page-level `<h1>` landmark
 *   - the running build version (from the Vite `define` — see
 *     `./version.ts`)
 *   - a link to the spec at the repo URL so a user (or reviewer)
 *     can follow the design contract in one click.
 *
 * Keeping the header this thin means every S13/S14 addition
 * (breadcrumb, project name, save-status pip) has to make a
 * deliberate PR — the "grep for `<AppHeader />` and see what it
 * contains" invariant stays useful.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppHeader, SPEC_LINK_HREF } from './AppHeader';
import { getAppVersion } from './version';

describe('<AppHeader /> — S12 AC7', () => {
  it('renders the app name as the <h1> landmark', () => {
    render(<AppHeader />);
    const h1 = screen.getByRole('heading', { level: 1, name: /wooddeck/i });
    expect(h1).toBeInTheDocument();
  });

  it('renders the running build version', () => {
    render(<AppHeader />);
    // The header must display the SAME version `getAppVersion()`
    // returns — no drift between the header text and the version
    // stamped into the .deck file (schema-v1.getGeneratorVersion).
    const v = getAppVersion();
    expect(screen.getByText(new RegExp(v.replace(/\./g, '\\.')))).toBeInTheDocument();
  });

  it('renders a link to the spec at the repo URL (AC7)', () => {
    render(<AppHeader />);
    // The link name must reference the "spec" so screen-reader
    // users can jump to it via the shortcut list; the href must
    // point at the checked-in `specs/mvp-deck-designer/spec.md`
    // on GitHub main (stable URL).
    const link = screen.getByRole('link', { name: /spec/i });
    expect(link).toHaveAttribute('href', SPEC_LINK_HREF);
    expect(SPEC_LINK_HREF).toBe(
      'https://github.com/vbomfim/wooddeck/blob/main/specs/mvp-deck-designer/spec.md',
    );
  });

  it('is wrapped in a <header> landmark so screen readers announce it', () => {
    render(<AppHeader />);
    // WCAG 2.2 landmarks: the app header is `role="banner"` — the
    // native semantic for a top-level <header> outside <article>.
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('opens the spec link in a new tab with rel=noopener (security default)', () => {
    // The spec link points at github.com — an external destination.
    // For any target="_blank" link the rel MUST include
    // `noopener` (and preferably `noreferrer`) so the newly-opened
    // page can't `window.opener` back into the wooddeck tab.
    // OWASP + web.dev "target=_blank without noopener" guideline.
    render(<AppHeader />);
    const link = screen.getByRole('link', { name: /spec/i });
    expect(link).toHaveAttribute('target', '_blank');
    const rel = link.getAttribute('rel') ?? '';
    expect(rel).toMatch(/\bnoopener\b/);
    expect(rel).toMatch(/\bnoreferrer\b/);
  });
});
