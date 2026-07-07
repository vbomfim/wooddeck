/**
 * `BomPanel.a11y.test.tsx` — S14 issue #15 §10 WCAG audit +
 * S24 issue #46 AC8 (expanded cut plan announces headers).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';

import { resetDesignStoreForTests } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { BomPanel } from './BomPanel';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

describe('<BomPanel /> — WCAG 2.2 AA smoke', () => {
  it('emits zero WCAG 2.2 AA violations (default: all disclosures closed)', async () => {
    const { container } = render(<BomPanel />);
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

  it('emits zero WCAG 2.2 AA violations when every cut-plan disclosure is EXPANDED (AC8)', async () => {
    const { container } = render(<BomPanel />);
    // Open every <details> so axe scans the cut-plan tables too.
    const groups = container.querySelectorAll('details');
    for (const g of Array.from(groups)) {
      g.open = true;
    }
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
