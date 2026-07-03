/**
 * `AppShell.a11y.test.tsx` — S12 issue #13 AC5.
 *
 * axe-core runs a full WCAG 2.2 Level AA audit over the rendered
 * shell + placeholder panels. Zero violations = pass.
 *
 * ## jsdom color-contrast caveat
 *
 * The axe `color-contrast` check requires *computed* styles to be
 * populated (background + foreground RGBA). jsdom returns
 * `rgba(0,0,0,0)` for most computed values because vitest is
 * configured with `css: false` (see vite.config.ts) — stylesheets
 * are not parsed in test mode. Enabling CSS in jsdom would trade a
 * false negative (contrast not measurable) for a false positive
 * (jsdom incorrectly reports "insufficient contrast" on background-
 * less nodes).
 *
 * We therefore run axe with `color-contrast` DISABLED here and
 * document the contrast invariant separately — the CSS files
 * carry explicit `--wd-*` tokens hand-picked to exceed 4.5:1
 * (documented in `styles/tokens.css`). An E2E axe run against
 * the real browser (QA Guardian scope, later) will exercise the
 * contrast rule against actual computed styles.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import { AppShell } from './AppShell';

describe('<AppShell /> — AC5 axe-core WCAG 2.2 AA smoke', () => {
  it('emits zero violations of WCAG 2.2 AA rules (color-contrast deferred to E2E per module doc)', async () => {
    const { container } = render(
      <AppShell
        leftPanel={
          <div>
            <h2>Params</h2>
            <p>placeholder</p>
          </div>
        }
        rightPanel={
          <div>
            <h2>Toggles &amp; Warnings</h2>
            <p>placeholder</p>
          </div>
        }
        main={
          <div>
            <p>main placeholder</p>
          </div>
        }
      />,
    );

    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        // WCAG 2.1 AA is a superset of 2.0 AA; axe-core's `wcag22aa`
        // tag adds the 2.2-only checks. Including both is the
        // official pattern for "AA compliance".
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: {
        // See module header. jsdom cannot measure contrast without
        // CSS parsing, which vite.config.ts disables in tests.
        'color-contrast': { enabled: false },
      },
    });

    // If violations occur, print the full failure summary so the
    // failing test message is actionable rather than "expected 0
    // got N".
    if (results.violations.length > 0) {
      console.error(
        'axe violations:\n' +
          results.violations
            .map(
              (v) =>
                `- ${v.id} (${v.impact}): ${v.help}\n  ${v.helpUrl}\n  nodes:\n` +
                v.nodes.map((n) => `    - ${n.target.join(' > ')}: ${n.failureSummary}`).join('\n'),
            )
            .join('\n\n'),
      );
    }
    expect(results.violations).toHaveLength(0);
  });
});
