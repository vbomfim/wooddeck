/**
 * `ExportMenu.a11y.test.tsx` — S14 issue #15 §10 WCAG audit.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';

import { resetDesignStoreForTests } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { ExportMenu } from './ExportMenu';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

describe('<ExportMenu /> — WCAG 2.2 AA smoke', () => {
  it('emits zero WCAG 2.2 AA violations', async () => {
    const { container } = render(<ExportMenu />);
    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: { 'color-contrast': { enabled: false } },
    });
    if (results.violations.length > 0) {
      console.error(JSON.stringify(results.violations, null, 2));
    }
    expect(results.violations).toHaveLength(0);
  });
});
