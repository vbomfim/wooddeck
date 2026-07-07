/**
 * `WarningsPanel.a11y.test.tsx` — S14 issue #15 §10 WCAG audit.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';

import { resetDesignStoreForTests, useDesignStore } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { WarningsPanel } from './WarningsPanel';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

describe('<WarningsPanel /> — WCAG 2.2 AA smoke', () => {
  it('emits zero WCAG 2.2 AA violations (empty state)', async () => {
    const { container } = render(<WarningsPanel />);
    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toHaveLength(0);
  });

  it('emits zero WCAG 2.2 AA violations (non-empty state)', async () => {
    act(() => {
      useDesignStore.setState((prev) => ({
        bundle: {
          ...prev.bundle,
          warnings: [
            {
              memberId: 'j-0',
              kind: 'over-span-joist',
              actualMm: 4500,
              allowableMm: 4200,
              tableReference: 'IRC-2018 Table R507.6 — PT No2 2x8.',
              message: 'Joist span 4500 mm exceeds 4200 mm.',
            },
          ],
        },
      }));
    });
    const { container } = render(<WarningsPanel />);
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
