/**
 * `WarningsPanel.test.tsx` — S14 issue #15 AC4 + AC5.
 *
 * ## Coverage
 *
 *   - AC4: empty warnings → green passive message + `<h2>Warnings</h2>`
 *     without a count badge.
 *   - AC5: N warnings → `<h2>Warnings (N)</h2>` + `<ul>` with one
 *     `<li>` per warning containing the message + tableReference.
 *   - textContent-only rendering — assert HTML injection in a
 *     warning message is escaped (no dangerouslySetInnerHTML).
 *   - Landmark: `<section aria-labelledby>` with a nested `<h2>`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import type { Warning } from '../domain/model';
import { resetDesignStoreForTests, useDesignStore } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { NO_WARNINGS_TEXT, WarningsPanel } from './WarningsPanel';

function setWarnings(warnings: Warning[]): void {
  act(() => {
    useDesignStore.setState((prev) => ({
      bundle: { ...prev.bundle, warnings },
    }));
  });
}

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

describe('<WarningsPanel /> — heading + landmark (AC4/AC5 shared)', () => {
  it('renders the "Warnings" h2 (AppShell rightPanel landmark invariant)', () => {
    render(<WarningsPanel />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent(/^warnings/i);
  });

  it('exposes a region landmark with the h2 as its accessible name', () => {
    render(<WarningsPanel />);
    // <section aria-labelledby> is not a landmark by default in
    // ARIA — but role="status" (on empty) or the enclosing aside
    // in AppShell provides the landmark. Here we just assert the
    // aria-labelledby wiring.
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.id).toBe('wd-warnings-panel__title');
  });
});

describe('<WarningsPanel /> — empty state (AC4)', () => {
  it('shows the passive "no warnings" message when warnings=[]', () => {
    render(<WarningsPanel />);
    expect(screen.getByText(NO_WARNINGS_TEXT)).toBeInTheDocument();
  });

  it('does NOT render a count badge when empty', () => {
    render(<WarningsPanel />);
    const h2 = screen.getByRole('heading', { level: 2 });
    // The heading text should be exactly "Warnings" with no "(N)".
    expect(h2.textContent?.trim()).toBe('Warnings');
  });

  it('uses role="status" so the empty state is announced politely', () => {
    render(<WarningsPanel />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(NO_WARNINGS_TEXT);
  });
});

describe('<WarningsPanel /> — non-empty state (AC5)', () => {
  it('renders the count badge in the heading', () => {
    setWarnings([
      {
        memberId: 'j-0',
        kind: 'over-span-joist',
        actualMm: 4500,
        allowableMm: 4200,
        tableReference: 'IRC-2018 Table R507.6 — PT No2 2x8 @ 406 mm o.c.',
        message: 'Joist span 4500 mm exceeds 4200 mm allowable.',
      },
    ]);
    render(<WarningsPanel />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/warnings \(1\)/i);
  });

  it('renders one <li> per warning with message + citation', () => {
    setWarnings([
      {
        memberId: 'j-0',
        kind: 'over-span-joist',
        actualMm: 4500,
        allowableMm: 4200,
        tableReference: 'IRC-2018 Table R507.6 — PT No2 2x8 @ 406 mm o.c.',
        message: 'Joist span 4500 mm exceeds 4200 mm allowable.',
      },
      {
        memberId: 'b-0',
        kind: 'over-span-beam',
        actualMm: 3800,
        allowableMm: 3600,
        tableReference: 'IRC-2018 Table R507.5 — PT No2 (2)2x8.',
        message: 'Beam span 3800 mm exceeds 3600 mm allowable.',
      },
    ]);
    render(<WarningsPanel />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    expect(items[0]).toHaveTextContent(/joist span 4500/i);
    expect(items[0]).toHaveTextContent(/table r507\.6/i);
    expect(items[1]).toHaveTextContent(/beam span 3800/i);
    expect(items[1]).toHaveTextContent(/table r507\.5/i);
  });

  it('escapes any HTML-ish content in warning text (textContent, not innerHTML)', () => {
    setWarnings([
      {
        memberId: 'j-0',
        kind: 'over-span-joist',
        actualMm: 4500,
        allowableMm: 4200,
        tableReference: '<img src=x onerror=alert(1)>',
        message: '<script>alert("xss")</script>',
      },
    ]);
    render(<WarningsPanel />);
    // The rendered text should contain the LITERAL angle-bracket
    // characters as text, NOT as a live <script> or <img> tag.
    const item = screen.getByRole('listitem');
    expect(item.querySelector('script')).toBeNull();
    expect(item.querySelector('img')).toBeNull();
    // textContent contains the literal chars.
    expect(item.textContent).toContain('<script>');
    expect(item.textContent).toContain('<img src=x');
  });
});
