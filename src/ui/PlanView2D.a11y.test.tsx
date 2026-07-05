/**
 * `PlanView2D.a11y.test.tsx` — S15 issue #16 §10 WCAG audit.
 *
 * Uses axe-core to assert zero WCAG 2.2 AA violations on the
 * default + populated + empty layouts.
 *
 * ## Why color-contrast is disabled
 *
 * jsdom does not apply the imported stylesheet (`plan-view.css`)
 * against the DOM, so axe's contrast check falsely triggers on
 * elements that WILL render with the token colors at runtime.
 * The `tokens.contrast.test.ts` suite covers the contrast pairs
 * statically (S12 Fix I convention).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';

import type { Layout } from '../domain/model';
import { resetDesignStoreForTests, useDesignStore } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { PlanView2D } from './PlanView2D';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

describe('<PlanView2D /> — WCAG 2.2 AA smoke', () => {
  it('emits zero violations on the default (populated) layout', async () => {
    const { container } = render(<PlanView2D />);
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

  it('emits zero violations on the empty-layout placeholder', async () => {
    const empty: Layout = {
      designId: 'empty',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 100, lengthMm: 100, heightMm: 100 },
      members: [],
    };
    act(() => {
      useDesignStore.setState((prev) => ({ bundle: { ...prev.bundle, layout: empty } }));
    });
    const { container } = render(<PlanView2D />);
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

  it('emits zero violations on a very-wide (40×8 ft) layout — letterbox case', async () => {
    // AC3 edge case — the SVG viewBox letterboxes automatically;
    // there is no separate a11y concern to check, but the axe
    // run confirms no landmark or role attribute regressed.
    act(() => {
      useDesignStore.setState((prev) => ({
        bundle: {
          ...prev.bundle,
          layout: {
            designId: 'wide',
            computedAt: '2024-01-01T00:00:00.000Z',
            bounds: { widthMm: 12192, lengthMm: 2438.4, heightMm: 900 },
            members: prev.bundle.layout.members, // reuse populated members
          },
        },
      }));
    });
    const { container } = render(<PlanView2D />);
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
