/**
 * `AppShell.test.tsx` — S12 issue #13 AC1/AC2/AC3/AC6/AC7 + edges.
 *
 * `<AppShell>` is a DUMB layout component (no domain, no scene
 * imports) — it accepts three slot props (`leftPanel`, `rightPanel`,
 * `main`) and lays them out over a CSS grid with landmarks
 * (`<header>`, `<main>`, two `<aside>`). This test file exercises
 * every acceptance criterion + the deferred-mobile / reduced-motion
 * edge cases the ticket calls out in §4 Edge cases.
 *
 * WCAG-specific tests live in `AppShell.a11y.test.tsx` (axe-core);
 * this file focuses on structure + semantics + keyboard tab order.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUiStore } from '../state/ui-store';
import { AppShell } from './AppShell';
import { DISCLAIMER_TEXT } from './DisclaimerBanner';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Setup / teardown — keep the ui store's persistence banner OFF unless a
// specific test opts in, so a leaked storageBanner from a previous test
// can't shift AppShell's rendered content in a sibling test. Wrap the
// setState call in `act` so any residual mounted subscribers (StorageBanner
// mounted by a prior test whose cleanup is still in-flight) flush their
// react updates inside the act boundary.
// ---------------------------------------------------------------------------

beforeEach(() => {
  act(() => {
    useUiStore.setState({ storageBanner: null });
  });
});

afterEach(() => {
  act(() => {
    useUiStore.setState({ storageBanner: null });
  });
});

// ---------------------------------------------------------------------------
// AC1 — disclaimer on first paint
// ---------------------------------------------------------------------------

describe('<AppShell /> — AC1: disclaimer on first paint (SC-007)', () => {
  it('renders the DisclaimerBanner text synchronously — no async wait needed', () => {
    render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m" />}
      />,
    );
    // getByText is synchronous — succeeds iff the text is in the
    // DOM at the moment `render` returns. SC-007 requires this
    // "on first paint" invariant.
    expect(screen.getByText(new RegExp(DISCLAIMER_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60), 'i'))).toBeInTheDocument();
  });

  it('renders EXACTLY ONE DisclaimerBanner — the S1 interim disclaimer must not linger', () => {
    render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m" />}
      />,
    );
    // The S1 App.tsx placeholder rendered its own <p role="note">
    // disclaimer. When S12 lands there must be EXACTLY ONE
    // note-role element carrying the "planning aid" text.
    const notes = screen.getAllByRole('note');
    const disclaimerNotes = notes.filter((n) => /planning aid/i.test(n.textContent ?? ''));
    expect(disclaimerNotes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC2 — non-dismissable (regression gate)
// ---------------------------------------------------------------------------

describe('<AppShell /> — AC2: disclaimer non-dismissable', () => {
  it('renders no dismiss / close / hide affordance for the disclaimer', () => {
    render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m" />}
      />,
    );
    const note = screen.getByRole('note', { name: /product disclaimer/i });
    // No interactive descendant of the note — no button, no link.
    // A regression that adds `<button>×</button>` fails here.
    expect(within(note).queryByRole('button')).not.toBeInTheDocument();
    expect(within(note).queryByRole('link')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC3 — slot layout
// ---------------------------------------------------------------------------

describe('<AppShell /> — AC3: slot layout', () => {
  it('renders leftPanel, rightPanel, and main content via the slot props', () => {
    render(
      <AppShell
        leftPanel={<div data-testid="lp">left</div>}
        rightPanel={<div data-testid="rp">right</div>}
        main={<div data-testid="m">main</div>}
      />,
    );
    expect(screen.getByTestId('lp')).toBeInTheDocument();
    expect(screen.getByTestId('rp')).toBeInTheDocument();
    expect(screen.getByTestId('m')).toBeInTheDocument();
  });

  it('main slot content lives inside the <main> landmark', () => {
    render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m">main</div>}
      />,
    );
    const main = screen.getByRole('main');
    expect(within(main).getByTestId('m')).toBeInTheDocument();
  });

  it('leftPanel + rightPanel live inside <aside> landmarks (WCAG §10)', () => {
    render(
      <AppShell
        leftPanel={<div data-testid="lp">left</div>}
        rightPanel={<div data-testid="rp">right</div>}
        main={<div data-testid="m" />}
      />,
    );
    // Two <aside> = two "complementary" role landmarks. Each aside
    // must have an accessible name so a screen-reader user can
    // distinguish them in the landmark list.
    const asides = screen.getAllByRole('complementary');
    expect(asides).toHaveLength(2);
    // The left panel contains lp; the right panel contains rp.
    // Order is preserved by CSS grid, but the DOM order is left→right.
    // Length-check above narrows the tuple destructure; the non-null
    // assertions here document that.
    const left = asides[0]!;
    const right = asides[1]!;
    expect(within(left).getByTestId('lp')).toBeInTheDocument();
    expect(within(right).getByTestId('rp')).toBeInTheDocument();
  });

  it('the two <aside> landmarks have <h2> section titles (WCAG heading structure)', () => {
    // AppShell is DUMB — it accepts JSX children via slot props. The
    // convention is that each panel slot INCLUDES an <h2> section
    // title (see src/App.tsx's LeftPanelPlaceholder / RightPanelPlaceholder,
    // and S13/S14 must follow the same discipline). This test asserts
    // AppShell renders the h2s the consumer passes — not that AppShell
    // injects them itself.
    render(
      <AppShell
        leftPanel={<h2>Parameters</h2>}
        rightPanel={<h2>Tools</h2>}
        main={<div data-testid="m" />}
      />,
    );
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.length).toBeGreaterThanOrEqual(2);
    expect(h2s.some((h) => /parameters/i.test(h.textContent ?? ''))).toBe(true);
    expect(h2s.some((h) => /tools/i.test(h.textContent ?? ''))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC4 hookup — StorageBanner mounted inside the shell
// ---------------------------------------------------------------------------

describe('<AppShell /> — StorageBanner integration (inherited obligation #3)', () => {
  it('does NOT render a storage banner when the UI store banner is null', () => {
    useUiStore.setState({ storageBanner: null });
    render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m" />}
      />,
    );
    // No alert-role element when banner is null. (The disclaimer
    // uses role="note", not "alert".)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the storage banner when the UI store banner is set', () => {
    act(() => {
      useUiStore.setState({ storageBanner: 'storage-full' });
    });
    render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m" />}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/local storage is full/i);
  });
});

// ---------------------------------------------------------------------------
// AC6 — keyboard tab order
// ---------------------------------------------------------------------------

describe('<AppShell /> — AC6: keyboard tab order', () => {
  it('tabs through header → left → main → right when each region has a focusable item', async () => {
    render(
      <AppShell
        leftPanel={
          <div>
            <h2>Params</h2>
            <button type="button" data-testid="left-btn">left</button>
          </div>
        }
        rightPanel={
          <div>
            <h2>Toggles</h2>
            <button type="button" data-testid="right-btn">right</button>
          </div>
        }
        main={
          <div>
            <button type="button" data-testid="main-btn" tabIndex={0}>
              canvas
            </button>
          </div>
        }
      />,
    );

    const user = userEvent.setup();
    // Focus the header spec link first — it's the first focusable
    // element in the DOM order (header → left aside → main → right
    // aside). Then tab forward and check we land in each region.
    const specLink = screen.getByRole('link', { name: /spec/i });
    specLink.focus();
    expect(document.activeElement).toBe(specLink);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('left-btn'));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('main-btn'));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('right-btn'));
  });
});

// ---------------------------------------------------------------------------
// AC7 — header shows name + version + spec link
// ---------------------------------------------------------------------------

describe('<AppShell /> — AC7: header exposes name/version/spec link', () => {
  it('mounts an AppHeader (h1 wooddeck + spec link)', () => {
    render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m" />}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: /wooddeck/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /spec/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Edge — reduced-motion + light-only color-scheme (CSS static invariants)
// ---------------------------------------------------------------------------

const CSS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'styles');
function readCss(basename: string): string {
  return readFileSync(resolve(CSS_DIR, basename), 'utf-8');
}

/**
 * Removes every `@media (prefers-reduced-motion: no-preference) { ... }`
 * block from a CSS source string. Uses a brace-aware scanner because
 * nested selectors inside the media query would defeat a naive regex.
 * Returns the CSS with those blocks (and their trailing whitespace)
 * gone — any remaining `transition:` / `animation:` is definitively
 * OUTSIDE the reduced-motion guard.
 */
function stripGuardedMotionBlocks(css: string): string {
  const guardPattern = /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/g;
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = guardPattern.exec(css)) !== null) {
    out += css.slice(cursor, match.index);
    // Walk from the position of the opening `{` and count braces
    // until we find the matching close.
    let depth = 1;
    let i = match.index + match[0].length; // just past the opening `{`
    while (i < css.length && depth > 0) {
      const ch = css[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    cursor = i;
    guardPattern.lastIndex = i;
  }
  out += css.slice(cursor);
  return out;
}

describe('<AppShell /> — CSS invariants (ticket §4 Edge cases)', () => {
  it('gates transitions behind @media (prefers-reduced-motion: no-preference) — WCAG 2.3.3 (ALL stylesheets, Fix G)', () => {
    // S12 pair-fix iter 1 — Fix G (Opus#1). The previous version
    // of this test only checked `app-shell.css`. But since Fix B
    // and Fix C added TWO more stylesheets with color transitions
    // (scene-error-boundary.css, context-lost-banner.css), and
    // the existing storage-banner/disclaimer-banner/app-header
    // stylesheets could grow transitions later, we now iterate
    // EVERY css file in the styles directory and assert:
    //   (a) if it declares `transition:` or `animation:`, that
    //       property MUST appear ONLY inside a
    //       `@media (prefers-reduced-motion: no-preference)` block,
    //   (b) stripping the guard blocks leaves ZERO
    //       transition/animation declarations behind.
    //
    // The stripping approach is stronger than the previous
    // "at least one media block exists" heuristic — it definitively
    // catches a transition accidentally placed OUTSIDE the guard.
    const cssFiles = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThan(0);

    for (const file of cssFiles) {
      const css = readCss(file);
      const hasMotion = /transition\s*:|animation\s*:/.test(css);
      if (!hasMotion) continue; // no motion declared — trivially compliant

      // Assert the guard block exists in this file.
      expect(
        css,
        `${file} declares transition/animation but is missing the reduced-motion guard`,
      ).toMatch(/@media\s*\(prefers-reduced-motion:\s*no-preference\)/);

      // Strip every `@media (prefers-reduced-motion: no-preference)
      // { ... }` block using a brace-aware scanner (naive regex would
      // fail on nested braces). Then assert no motion declarations
      // survive outside the guards.
      const stripped = stripGuardedMotionBlocks(css);
      const outsideMotion = /transition\s*:|animation\s*:/.exec(stripped);
      expect(
        outsideMotion,
        `${file} declares transition/animation OUTSIDE @media (prefers-reduced-motion: no-preference) — WCAG 2.3.3 regression`,
      ).toBeNull();
    }
  });

  it('declares color-scheme: light so dark-mode browsers do not auto-invert (ticket §4)', () => {
    const css = readCss('app-shell.css');
    expect(css).toMatch(/color-scheme\s*:\s*light/);
  });

  it('shows a "best viewed on desktop" note for very narrow viewports (ticket §4 mobile deferral)', () => {
    // The narrow-viewport note lives in the shell chrome and is
    // rendered UNCONDITIONALLY (CSS hides it on wider viewports).
    // The disclaimer must still be visible alongside it.
    render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m" />}
      />,
    );
    // A user-facing note; not a role="alert" (which would fire
    // screen-reader interruptions).
    expect(screen.getByText(/best viewed on desktop/i)).toBeInTheDocument();
    // Disclaimer still present.
    expect(screen.getByRole('note', { name: /product disclaimer/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Bugfix — Independent pane scrolling (fix/independent-pane-scroll)
//
// Bug: when the right panel's content grew (many warnings + BOM + plan
// view), the WHOLE PAGE scrolled and the 3D canvas got pushed off-screen.
// Fix: on desktop (≥ 1024px), the shell is a FIXED-viewport-height layout;
// each aside scrolls INTERNALLY (overflow-y:auto + min-height:0), main is
// overflow:hidden, and the shell itself does not scroll (overflow:hidden).
// On mobile (< 1024px, stacked), the shell can grow and the PAGE scrolls
// as before.
//
// These invariants are enforced via source-file grep of `app-shell.css`,
// following the existing pattern used by the WCAG 2.3.3 test above. A
// pure-CSS overflow behaviour cannot be asserted from jsdom (no layout
// engine), so we assert the CSS declarations that make the browser behave
// correctly, plus the classNames the CSS targets are present in the DOM.
// ---------------------------------------------------------------------------

describe('<AppShell /> — independent pane scrolling (regression guard)', () => {
  it('renders every classname the layout CSS targets (regression: renaming a class silently breaks the CSS)', () => {
    const { container } = render(
      <AppShell
        leftPanel={<div data-testid="lp" />}
        rightPanel={<div data-testid="rp" />}
        main={<div data-testid="m" />}
      />,
    );
    // The five CSS hooks the fix relies on. If any of these class
    // names change in AppShell.tsx without also updating app-shell.css,
    // the layout regresses to auto-height scrolling.
    expect(container.querySelector('.wd-app-shell')).toBeTruthy();
    expect(container.querySelector('.wd-app-shell__body')).toBeTruthy();
    expect(container.querySelector('aside.wd-app-shell__left')).toBeTruthy();
    expect(container.querySelector('aside.wd-app-shell__right')).toBeTruthy();
    expect(container.querySelector('main.wd-app-shell__main')).toBeTruthy();
  });
});

/**
 * Utility — locate a CSS rule block by selector and return its declarations
 * as a raw string. Uses a brace-aware scanner because a naïve regex would
 * fail on nested media queries or pseudo-class blocks. If the selector
 * appears more than once (e.g. once outside a media query and once inside),
 * returns the concatenation of every block's declarations so an assertion
 * against the combined text still catches the property.
 *
 * Search targets a top-level rule OR a rule at any nesting depth INSIDE
 * the anchor block passed via `withinBlock` (defaults to the whole file).
 */
function findRuleDeclarations(css: string, selector: string, withinBlock?: string): string {
  const haystack = withinBlock ?? css;
  const pattern = new RegExp(
    // Match the selector as a full selector-list token — allow other
    // selectors joined by commas, but require our target selector to
    // appear as a whole word (bounded by `,`, whitespace, or `{`).
    `(?:^|[\\s,])${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[\\s,{]`,
    'g',
  );
  let out = '';
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(haystack)) !== null) {
    // Find the `{` that opens THIS rule's block. The match ends
    // just past the selector; the next `{` at the current nesting
    // level opens the block.
    let i = match.index + match[0].length - 1;
    while (i < haystack.length && haystack[i] !== '{') i += 1;
    if (i >= haystack.length) continue;
    i += 1; // move past `{`
    // Walk to the matching `}` at depth 0.
    let depth = 1;
    const start = i;
    while (i < haystack.length && depth > 0) {
      const ch = haystack[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    out += haystack.slice(start, i - 1) + '\n';
    pattern.lastIndex = i;
  }
  return out;
}

/**
 * Utility — extract the body of a `@media (min-width: 1024px)` block from
 * the CSS. Returns the concatenation of every such block (there can be
 * more than one) so a downstream assertion catches the property no matter
 * which block declares it.
 */
function extractDesktopMediaBlock(css: string): string {
  const pattern = /@media\s*\(min-width:\s*1024px\)\s*\{/g;
  let out = '';
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      const ch = css[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    out += css.slice(start, i - 1) + '\n';
    pattern.lastIndex = i;
  }
  return out;
}

describe('<AppShell /> — independent pane scrolling CSS invariants (fix/independent-pane-scroll)', () => {
  it('caps the shell at viewport height on desktop (≥ 1024px) so panel content does not grow the page', () => {
    // ROOT INVARIANT of the fix. If the shell can grow beyond the
    // viewport height on desktop, panel content pushes the 3D canvas
    // off-screen and the whole page scrolls — the bug we are fixing.
    // The desktop @media block must declare `height: 100vh` or
    // `height: 100dvh` on `.wd-app-shell`.
    const css = readCss('app-shell.css');
    const desktop = extractDesktopMediaBlock(css);
    expect(
      desktop,
      'app-shell.css must contain a @media (min-width: 1024px) block',
    ).not.toBe('');
    const shellRule = findRuleDeclarations(desktop, '.wd-app-shell');
    expect(
      shellRule,
      '.wd-app-shell must have a rule inside @media (min-width: 1024px)',
    ).not.toBe('');
    // Accept either `100vh` or `100dvh` (or both — `100dvh` with a
    // `100vh` fallback is the recommended progressive-enhancement
    // pattern for iOS Safari where the URL bar changes viewport size).
    expect(shellRule).toMatch(/height\s*:\s*100(vh|dvh)/);
  });

  it('clips the shell root on desktop so no child can push the page taller than the viewport', () => {
    // Belt-and-braces alongside the height cap: if a child ever
    // overflows the shell despite the height cap, `overflow: hidden`
    // ensures the page still doesn't grow. Without this, a grid item
    // whose min-content exceeds its track can visually spill.
    const css = readCss('app-shell.css');
    const desktop = extractDesktopMediaBlock(css);
    const shellRule = findRuleDeclarations(desktop, '.wd-app-shell');
    expect(shellRule).toMatch(/overflow\s*:\s*hidden/);
  });

  it('asides scroll internally on desktop (overflow-y: auto + min-height: 0)', () => {
    // Grid/flex children need BOTH `overflow-y: auto` AND
    // `min-height: 0` for internal scrolling to work. Without
    // `min-height: 0`, the aside's min-content expands its track
    // and the container grows instead of the aside scrolling.
    const css = readCss('app-shell.css');
    // The rule may live at top level (mobile default with a media
    // override) or inside the desktop block — either way, the
    // combined rule text must declare both properties for both asides.
    const leftAll = findRuleDeclarations(css, '.wd-app-shell__left');
    const rightAll = findRuleDeclarations(css, '.wd-app-shell__right');
    // Overflow-y: auto MUST be present on desktop (either directly or
    // via a shared rule the desktop @media doesn't override).
    const desktop = extractDesktopMediaBlock(css);
    const leftDesktop =
      findRuleDeclarations(desktop, '.wd-app-shell__left') + '\n' + leftAll;
    const rightDesktop =
      findRuleDeclarations(desktop, '.wd-app-shell__right') + '\n' + rightAll;
    expect(leftDesktop).toMatch(/overflow-y\s*:\s*auto/);
    expect(rightDesktop).toMatch(/overflow-y\s*:\s*auto/);
    expect(leftDesktop).toMatch(/min-height\s*:\s*0/);
    expect(rightDesktop).toMatch(/min-height\s*:\s*0/);
  });

  it('main clips its content on desktop (overflow: hidden) so the 3D canvas never contributes to page height', () => {
    // The r3f <Canvas> fills its parent. Without overflow: hidden
    // on main, a canvas sized in mm world units could visually
    // expand main and defeat the fixed-viewport layout.
    const css = readCss('app-shell.css');
    const mainRule = findRuleDeclarations(css, '.wd-app-shell__main');
    expect(mainRule).toMatch(/overflow\s*:\s*hidden/);
    expect(mainRule).toMatch(/min-height\s*:\s*0/);
  });

  it('body wrapper declares min-height: 0 so its grid track can shrink below content min (grid quirk)', () => {
    // Without this, a grid item's default `min-height: auto` forces
    // the track to be at least the content's min height, blowing out
    // the fixed viewport layout.
    const css = readCss('app-shell.css');
    const bodyRule = findRuleDeclarations(css, '.wd-app-shell__body');
    expect(bodyRule).toMatch(/min-height\s*:\s*0/);
  });
});
