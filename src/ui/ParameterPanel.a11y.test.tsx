/**
 * `ParameterPanel.a11y.test.tsx` — S13 issue #14 §10 WCAG audit.
 *
 * axe-core runs a full WCAG 2.2 Level AA audit over the mounted
 * panel. Zero violations = pass. See `AppShell.a11y.test.tsx`
 * for the jsdom color-contrast caveat.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';

import { resetDesignStoreForTests } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { ParameterPanel } from './ParameterPanel';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

describe('<ParameterPanel /> — WCAG 2.2 AA smoke', () => {
  it('emits zero WCAG 2.2 AA violations (color-contrast deferred to E2E per AppShell.a11y module doc)', async () => {
    const { container } = render(<ParameterPanel />);

    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: {
        // jsdom cannot measure contrast without CSS parsing — see
        // AppShell.a11y.test.tsx module header.
        'color-contrast': { enabled: false },
      },
    });

    if (results.violations.length > 0) {
      console.error(
        'axe violations:\n' +
          results.violations
            .map(
              (v) =>
                `- ${v.id} (${v.impact}): ${v.help}\n  ${v.helpUrl}\n  nodes:\n` +
                v.nodes
                  .map((n) => `    - ${n.target.join(' > ')}: ${n.failureSummary}`)
                  .join('\n'),
            )
            .join('\n\n'),
      );
    }
    expect(results.violations).toHaveLength(0);
  });
});
