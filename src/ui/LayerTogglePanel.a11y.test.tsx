/**
 * `LayerTogglePanel.a11y.test.tsx` — S14 issue #15 §10 WCAG audit.
 *
 * axe-core WCAG 2.2 AA smoke over the mounted panel.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';

import { resetDesignStoreForTests } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { LayerTogglePanel } from './LayerTogglePanel';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

describe('<LayerTogglePanel /> — WCAG 2.2 AA smoke', () => {
  it('emits zero WCAG 2.2 AA violations', async () => {
    const { container } = render(<LayerTogglePanel />);

    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: {
        // jsdom cannot measure contrast without CSS parsing.
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
