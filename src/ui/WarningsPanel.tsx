/**
 * `src/ui/WarningsPanel.tsx` — S14 issue #15 AC4 + AC5.
 *
 * ## Responsibility (single)
 *
 * Render `useWarnings()` (the span-check warnings from the design
 * store) as a labelled section:
 *
 *   - Empty → a passive "no warnings — spans within IRC-2018
 *     limits" message.
 *   - Non-empty → an `<h2>` with an inline count badge (e.g.
 *     "Warnings (3)") + a `<ul>` where each `<li>` shows
 *     `warning.message` and the `warning.tableReference`
 *     citation on a secondary line.
 *
 * ## textContent-only rendering (§6 security)
 *
 * Warnings are produced by `src/domain/spans/span-check.ts`; the
 * `message` and `tableReference` strings are composed from
 * constants + numeric mm values (never user-supplied text). Even
 * so, this component renders them as CHILDREN of `<li>` /
 * `<span>` — React default is `textContent`, NEVER
 * `dangerouslySetInnerHTML`. This mirrors the constraint
 * `DisclaimerBanner` and `StorageBanner` both honour and matches
 * the inherited S6 rule.
 *
 * ## Accessibility (§10)
 *
 *   - The section carries `role="region"` (default for
 *     `<section aria-labelledby>` in a landmark parent) so screen
 *     readers announce "Warnings region" — the `aria-labelledby`
 *     wires to the `<h2>`.
 *   - The count badge is a plain `<span>` inside the `<h2>` —
 *     screen readers read "Warnings 3" as one heading.
 *   - The empty-state message uses `role="status"` (implicit
 *     `aria-live="polite"`) so a transition from N warnings → 0
 *     announces "no warnings" once, without interrupting.
 *   - Each `<li>` uses semantic `<strong>` + normal text for the
 *     message; the citation is inside a `<small>` for visual
 *     hierarchy without changing the reading order.
 *
 * ## Boundary
 *
 *   - `../state`              — useWarnings.
 *   - `react` (JSX)           — types.
 *   - NO domain / application — the store hands us the shape.
 *   - NO scene / persistence  — hard rule.
 */
import type { JSX } from 'react';

import { useWarnings } from '../state';

// ---------------------------------------------------------------------------
// Copy constants
// ---------------------------------------------------------------------------

/**
 * The empty-state text. Exported so tests grep-import the exact
 * string rather than duplicate a fuzzy regex.
 */
export const NO_WARNINGS_TEXT =
  'No warnings — spans within IRC-2018 limits.';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The warnings panel. See module header for the empty / non-empty
 * behaviour and a11y contract.
 */
export function WarningsPanel(): JSX.Element {
  const warnings = useWarnings();
  const count = warnings.length;

  return (
    <section
      aria-labelledby="wd-warnings-panel__title"
      className="wd-warnings-panel"
    >
      <h2 id="wd-warnings-panel__title">
        Warnings
        {count > 0 && (
          <>
            {' '}
            <span
              className="wd-warnings-panel__badge"
              aria-label={`${String(count)} warnings`}
            >
              ({count})
            </span>
          </>
        )}
      </h2>

      {count === 0 ? (
        <p
          className="wd-warnings-panel__empty"
          role="status"
          aria-live="polite"
        >
          {NO_WARNINGS_TEXT}
        </p>
      ) : (
        <ul className="wd-warnings-panel__list">
          {warnings.map((w) => (
            <li key={w.memberId} className="wd-warnings-panel__item">
              {/*
               * Message on the primary line. Rendered as textContent
               * (React default) — see module header § textContent-
               * only rendering.
               */}
              <span className="wd-warnings-panel__message">{w.message}</span>
              <small className="wd-warnings-panel__citation">{w.tableReference}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
