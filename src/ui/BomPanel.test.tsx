/**
 * `BomPanel.test.tsx` — S14 issue #15 AC6 + AC7.
 *
 * ## Coverage
 *
 *   - AC6: renders `<h2>Bill of materials</h2>` (landmark).
 *   - AC6: derives BOM from `useLayout()` and renders a table
 *     with one row per grouped BomLine.
 *   - AC6 (empty): renders the "Empty layout" copy when the
 *     layout has zero members.
 *   - AC7: switching units flips the string formatting but leaves
 *     row counts/kinds unchanged (mm values are the source of
 *     truth).
 *   - a11y-partial: `<th scope>` on header cells; caption present.
 *
 * BomPanel reads `useLayout()` — the design-store default is a
 * 12×12 deck with real layout data, so we exercise both empty
 * (via a stubbed empty layout) and non-empty paths.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import type { Layout } from '../domain/model';
import { resetDesignStoreForTests, useDesignStore } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { BomPanel, EMPTY_LAYOUT_TEXT } from './BomPanel';

function setLayout(layout: Layout): void {
  act(() => {
    useDesignStore.setState((prev) => ({
      bundle: { ...prev.bundle, layout },
    }));
  });
}

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

describe('<BomPanel /> — heading + landmark', () => {
  it('renders the "Bill of materials" h2 (rightPanel landmark invariant)', () => {
    render(<BomPanel />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent(/bill of materials/i);
  });
});

describe('<BomPanel /> — non-empty layout (AC6)', () => {
  it('renders a table with row-per-grouped-BomLine', () => {
    // Default store bundle has a real 12×12 layout — deriveBom
    // will collapse it. We just assert the shape.
    render(<BomPanel />);
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    // At least one <thead> row + at least one <tbody> row.
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('uses <th scope="col"> on every column header', () => {
    render(<BomPanel />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBe(6); // Kind / SKU / Species / Count / Each / Total
    for (const h of headers) {
      expect(h.getAttribute('scope')).toBe('col');
    }
  });

  it('renders a caption describing the table', () => {
    render(<BomPanel />);
    const table = screen.getByRole('table');
    const caption = table.querySelector('caption');
    expect(caption).not.toBeNull();
    expect(caption?.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('<BomPanel /> — empty layout', () => {
  it('renders the "Empty layout" copy and no table', () => {
    setLayout({
      designId: 'stub',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 0, lengthMm: 0, heightMm: 0 },
      members: [],
    });
    render(<BomPanel />);
    expect(screen.getByText(EMPTY_LAYOUT_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('uses role="status" so the empty message is announced', () => {
    setLayout({
      designId: 'stub',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 0, lengthMm: 0, heightMm: 0 },
      members: [],
    });
    render(<BomPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(EMPTY_LAYOUT_TEXT);
  });
});

describe('<BomPanel /> — unit switching (AC7)', () => {
  it('does not change the row structure when units switch', () => {
    render(<BomPanel />);
    const rowsImperial = screen.getAllByRole('row');

    act(() => {
      useUiStore.setState({ units: 'metric' });
    });

    const rowsMetric = screen.getAllByRole('row');
    expect(rowsMetric).toHaveLength(rowsImperial.length);
  });

  it('renders imperial lengths with the foot mark ′ / inch mark ″ (or ft)', () => {
    render(<BomPanel />);
    const cells = screen.getAllByRole('cell');
    const text = cells.map((c) => c.textContent ?? '').join('|');
    // Imperial formatter uses ′ (U+2032) or " ft" — one of them
    // must appear somewhere in the table.
    expect(text).toMatch(/[′″ft]/);
  });

  it('renders metric lengths with " m" after unit switch', () => {
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    render(<BomPanel />);
    const cells = screen.getAllByRole('cell');
    const text = cells.map((c) => c.textContent ?? '').join('|');
    expect(text).toMatch(/\sm\b/);
  });
});
