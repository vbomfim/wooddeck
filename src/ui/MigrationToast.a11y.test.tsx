/**
 * `MigrationToast.a11y.test.tsx` — S23 issue #45 §10 WCAG audit.
 *
 * axe-core runs a WCAG 2.2 Level AA audit over the mounted toast
 * when the flag is UP (so the toast surface is present). See
 * `AppShell.a11y.test.tsx` for the jsdom color-contrast caveat.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';

import { useUiStore } from '../state/ui-store';

import { MigrationToast } from './MigrationToast';

const UI_INITIAL_STATE = useUiStore.getInitialState();

beforeEach(() => {
  useUiStore.setState(UI_INITIAL_STATE, true);
  act(() => {
    // S23 pair-fix — use the discrete-event bump instead of a
    // boolean flip. Under the new API a "toast is visible" state
    // is `migrationEventId > dismissedMigrationEventId`.
    useUiStore.getState().notifyMigrationHappened();
  });
});

afterEach(() => {
  cleanup();
  useUiStore.setState(UI_INITIAL_STATE, true);
});

describe('<MigrationToast /> — WCAG 2.2 AA smoke', () => {
  it('emits zero WCAG 2.2 AA violations (color-contrast deferred per module doc)', async () => {
    const { container } = render(<MigrationToast />);
    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    if (results.violations.length > 0) {
      console.error(
        'axe violations:\n' +
          results.violations
            .map(
              (v) =>
                `- ${v.id} (${v.impact}): ${v.help}\n  ${v.helpUrl}`,
            )
            .join('\n\n'),
      );
    }
    expect(results.violations).toHaveLength(0);
  });
});
