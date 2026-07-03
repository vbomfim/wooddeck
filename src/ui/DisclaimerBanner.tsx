/**
 * `src/ui/DisclaimerBanner.tsx` — S12 issue #13 AC1 + AC2, spec §
 * FR-016.
 *
 * ## Responsibility (single)
 *
 * Render the frozen "planning aid, not an engineering document"
 * disclaimer at the top of the app. That's it — no state, no
 * animations, no dismiss control, no props.
 *
 * ## Why "no props" is a design choice, not laziness
 *
 * The disclaimer is a legal-liability surface (Code Review Guardian
 * "honorable mention" — see issue #13 §15). Every prop is a knob a
 * future well-intentioned dev could use to weaken the invariant
 * ("just let admins hide it during screenshots"). No props = no
 * knobs. The text is a compile-time exported constant so the tests,
 * the render, and any future E2E harness see the SAME string; a
 * copy change requires updating one place and every test that
 * asserted the exact wording fires immediately.
 *
 * ## Non-dismissable — enforced structurally
 *
 * The component renders NO interactive elements: no button, no
 * link, no form control. The AC2 regression tests in
 * `DisclaimerBanner.test.tsx` fail if any interactive descendant
 * lands here. There is also NO `useUiStore` read: the banner does
 * NOT check any state flag before rendering — so no future
 * `disclaimerAcknowledged` toggle can hide it. `useUiStore`'s
 * `disclaimerAcknowledged` field is documented as frozen `false`
 * (state/ui-store.ts) for the same reason.
 *
 * ## Boundary
 *
 * Imports: React only. No state, no scene, no domain. This is the
 * dumbest component in the codebase — a plain frozen div.
 */
import type { JSX } from 'react';
import './styles/tokens.css';
import './styles/disclaimer-banner.css';

/**
 * The frozen legal-disclaimer text — spec § FR-016, ticket §2 slot
 * layout. Exported so tests can grep-import the exact string; DO
 * NOT hard-code the wording anywhere else in the app.
 *
 * A copy change here MUST go through PR review (legal / product
 * sign-off) — the QA E2E and the a11y test both assert on this
 * literal.
 */
export const DISCLAIMER_TEXT =
  '⚠ Planning aid, not an engineering document — consult a licensed professional or your local building department.';

/**
 * The non-dismissable disclaimer banner. Renders as a `<div
 * role="note" aria-label="Product disclaimer">` so screen-reader
 * users get the "here's important context" cue that sighted users
 * get from the yellow bar. `role="note"` (not `role="alert"`)
 * because AC10 §Screen reader specifies "note" — an alert would
 * interrupt every navigation, which is user-hostile.
 */
export function DisclaimerBanner(): JSX.Element {
  return (
    <div className="wd-disclaimer-banner" role="note" aria-label="Product disclaimer">
      {/*
       * Text rendered as CHILDREN (React default) — never
       * dangerouslySetInnerHTML (S6 Security constraint). See
       * DisclaimerBanner.test.tsx for the regression check.
       */}
      {DISCLAIMER_TEXT}
    </div>
  );
}
