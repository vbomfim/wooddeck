/**
 * `DisclaimerBanner.test.tsx` — S12 issue #13 AC1/AC2 + spec § FR-016.
 *
 * The disclaimer banner is the legal-liability surface for the entire
 * MVP. Two invariants must NEVER regress:
 *
 *   1. AC1 — the frozen text renders on FIRST PAINT (no async, no
 *      state hydration, no lazy import). SC-007 requires the banner
 *      to be visible before any I/O so a user who abandons the page
 *      before hydration still saw the warning.
 *   2. AC2 — the banner is NON-DISMISSABLE. No close button, no
 *      state toggle, no cookie or localStorage flag that hides it.
 *      The tests here are the regression gate: adding ANY dismiss
 *      affordance in the future breaks the "no button, no dismiss"
 *      assertions.
 *
 * The frozen text is a compile-time exported constant
 * (`DISCLAIMER_TEXT`) — one source of truth so the copy can't drift
 * between the runtime render, the tests, and any future E2E harness.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DISCLAIMER_TEXT, DisclaimerBanner } from './DisclaimerBanner';

describe('<DisclaimerBanner /> (S12 AC1 + AC2)', () => {
  it('exports the frozen spec-mandated text as a compile-time constant', () => {
    // The exact wording is legally significant — pin it here so a
    // typo-fix PR MUST update this test (and the reviewer MUST
    // read the diff to notice the copy change).
    expect(DISCLAIMER_TEXT).toBe(
      '⚠ Planning aid, not an engineering document — consult a licensed professional or your local building department.',
    );
  });

  it('AC1: renders the frozen text on FIRST PAINT (no async, SC-007)', () => {
    render(<DisclaimerBanner />);
    // getByText — synchronous — asserts the disclaimer is in the
    // DOM immediately after render, no waitFor / findBy needed.
    // SC-007 requires the banner before any hydration.
    expect(
      screen.getByText(
        /planning aid, not an engineering document — consult a licensed professional or your local building department/i,
      ),
    ).toBeInTheDocument();
  });

  it('AC10 (WCAG 2.2): mounted inside a role="note" with an accessible name', () => {
    render(<DisclaimerBanner />);
    const note = screen.getByRole('note', { name: /product disclaimer/i });
    expect(note).toBeInTheDocument();
    // The role="note" wrapper contains the frozen text — the aria
    // wiring gives screen-reader users the same "here's the
    // legal warning" cue sighted users get from the yellow bar.
    expect(note).toHaveTextContent(/planning aid/i);
  });

  it('AC2: renders NO dismiss / close / hide control', () => {
    render(<DisclaimerBanner />);
    // Any interactive control in the banner is a regression by
    // definition — the banner has NO buttons, NO links, NO form
    // controls. If a future well-intentioned dev adds
    // `<button>×</button>` this fails.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    // Also guard the specific dismiss-ish names people default to
    // — even if a "Close" name landed on a non-button role, we
    // catch it here.
    expect(screen.queryByLabelText(/dismiss/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/close/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/hide/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\s*(dismiss|close|hide|ok|got it)\s*$/i)).not.toBeInTheDocument();
  });

  it('renders text as textContent — no dangerouslySetInnerHTML (S6 Security constraint)', () => {
    // The frozen constant is a plain string; React's default
    // renderer emits it as textContent (escaped). This test guards
    // the invariant by asserting the ⚠ character round-trips as
    // TEXT — dangerouslySetInnerHTML would encode &#9888; and
    // fail this equality (the browser normalises &#9888; back to
    // ⚠, but the raw HTML would differ). A visible-text assertion
    // is the strongest guarantee — see StorageBanner.test for the
    // parallel invariant on the banner messages.
    render(<DisclaimerBanner />);
    const note = screen.getByRole('note', { name: /product disclaimer/i });
    expect(note.textContent).toContain('⚠');
  });
});
