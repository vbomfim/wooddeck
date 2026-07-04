/**
 * `BomPanel.test.tsx` — S14 issue #15 AC6 + AC7 + S21 issue #43.
 *
 * ## Coverage (S21 shape)
 *
 *   - S14-AC6: renders `<h2>Bill of materials</h2>` (landmark).
 *   - S21: renders a "Lumber" sub-section (`<h3>`) with a table of
 *     per-SKU rows (Boards column shows the FFD `totalStockBoards`).
 *   - S21-AC6: renders a "Foundation" sub-section (`<h3>`) with a
 *     table of per-product rows when block-kind members exist.
 *   - Empty design → the "Empty layout" copy.
 *   - S14-AC7: switching units flips the stock-length/offcut string
 *     formatting; row counts stay stable (Mm is source of truth).
 *   - a11y-partial: `<th scope>` on header cells; captions present;
 *     sub-section landmarks via `<section aria-labelledby>`.
 *
 * The store default is a real 12×12 deck with LUMBER members
 * only, so the default path exercises the Lumber table. A stubbed
 * layout is used for empty + foundation-only paths.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import type { Layout, LayoutMember } from '../domain/model';
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

function makeFoundationOnlyLayout(): Layout {
  const members: LayoutMember[] = [];
  for (let i = 0; i < 3; i++) {
    members.push({
      id: `block-${i}`,
      kind: 'block',
      position: { x: 0, y: 0, z: i * 500 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
      material: { kind: 'block', productId: 'tuffblock-12x12x4' },
    });
  }
  return {
    designId: 'fixture-foundation-only',
    computedAt: '2024-01-01T00:00:00.000Z',
    bounds: { widthMm: 305, lengthMm: 1500, heightMm: 102 },
    members,
  };
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

// ---------------------------------------------------------------------------
// Heading + landmark
// ---------------------------------------------------------------------------

describe('<BomPanel /> — heading + landmark', () => {
  it('renders the "Bill of materials" h2 (rightPanel landmark invariant)', () => {
    render(<BomPanel />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent(/bill of materials/i);
  });
});

// ---------------------------------------------------------------------------
// Non-empty layout — lumber section (S21)
// ---------------------------------------------------------------------------

describe('<BomPanel /> — lumber section (S21 minimal render)', () => {
  it('renders a Lumber h3 landmark with a table', () => {
    render(<BomPanel />);
    const h3 = screen.getByRole('heading', { level: 3, name: /lumber/i });
    expect(h3).toBeInTheDocument();
    const tables = screen.getAllByRole('table');
    // At least one table (the lumber one). If the default layout
    // has foundation blocks, both will render.
    expect(tables.length).toBeGreaterThanOrEqual(1);
  });

  it('uses <th scope="col"> on every lumber column header', () => {
    render(<BomPanel />);
    // Filter to the lumber table's headers via the table's caption.
    const lumberTable = screen
      .getAllByRole('table')
      .find((t) => (t.querySelector('caption')?.textContent ?? '').match(/lumber/i));
    expect(lumberTable).toBeDefined();
    const headers = lumberTable!.querySelectorAll('thead th');
    // SKU / Stock length / Boards / Offcut = 4 columns (S21).
    expect(headers.length).toBe(4);
    for (const h of Array.from(headers)) {
      expect(h.getAttribute('scope')).toBe('col');
    }
  });

  it('renders a caption on the lumber table', () => {
    render(<BomPanel />);
    const lumberTable = screen
      .getAllByRole('table')
      .find((t) => (t.querySelector('caption')?.textContent ?? '').match(/lumber/i));
    expect(lumberTable).toBeDefined();
    const caption = lumberTable!.querySelector('caption');
    expect(caption).not.toBeNull();
    expect(caption?.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('shows the SKU as the row header for every lumber row', () => {
    render(<BomPanel />);
    const lumberTable = screen
      .getAllByRole('table')
      .find((t) => (t.querySelector('caption')?.textContent ?? '').match(/lumber/i));
    const rowHeaders = lumberTable!.querySelectorAll('tbody th[scope="row"]');
    // Default deck has at least one lumber SKU (a joist SKU).
    expect(rowHeaders.length).toBeGreaterThan(0);
    // Every row-header text mentions a lumber nominal (2x…, 4x…, or 5/4x…).
    for (const th of Array.from(rowHeaders)) {
      expect(th.textContent).toMatch(/\d+x\d+|5\/4x\d+/);
    }
  });
});

// ---------------------------------------------------------------------------
// Foundation section (S21 AC6)
// ---------------------------------------------------------------------------

describe('<BomPanel /> — foundation section (S21 AC6)', () => {
  it('renders a Foundation h3 landmark when the layout has block members', () => {
    setLayout(makeFoundationOnlyLayout());
    render(<BomPanel />);
    const h3 = screen.getByRole('heading', { level: 3, name: /foundation/i });
    expect(h3).toBeInTheDocument();
  });

  it('renders the foundation table with product displayName + count', () => {
    setLayout(makeFoundationOnlyLayout());
    render(<BomPanel />);
    const foundationTable = screen
      .getAllByRole('table')
      .find((t) => (t.querySelector('caption')?.textContent ?? '').match(/foundation/i));
    expect(foundationTable).toBeDefined();
    // Row-header contains the catalog displayName (TuffBlock …).
    const rowHeader = foundationTable!.querySelector('tbody th[scope="row"]');
    expect(rowHeader?.textContent).toMatch(/tuffblock/i);
    // Count cell shows "3".
    const countCell = foundationTable!.querySelector('tbody td');
    expect(countCell?.textContent).toBe('3');
  });

  it('does NOT render a Foundation section when no block members exist', () => {
    // The default store has NO block members — Foundation h3 must
    // not appear.
    render(<BomPanel />);
    const foundationH3 = screen.queryByRole('heading', { level: 3, name: /foundation/i });
    expect(foundationH3).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Footings section (FIX 2 review-gate — elevated decks show footing count)
// ---------------------------------------------------------------------------

describe('<BomPanel /> — footings section (FIX 2)', () => {
  it('renders a Footings h3 landmark when the layout has footing members', () => {
    // The default store is an ELEVATED deck (`posts-on-footings`)
    // → its layout includes `footing`-kind members. Regression
    // against the S21 v1 bug where footings were silently
    // dropped from the BOM (elevated deck's shopping list was
    // incomplete).
    render(<BomPanel />);
    const footingsH3 = screen.getByRole('heading', { level: 3, name: /footings/i });
    expect(footingsH3).toBeInTheDocument();
  });

  it('renders a footing row with a dimension-derived displayName + count', () => {
    render(<BomPanel />);
    // The footing row's <th scope="row"> contains the synthetic
    // "Concrete footing …" displayName — safe to render as-is.
    const rowHeader = screen.getByRole('rowheader', { name: /concrete footing/i });
    expect(rowHeader).toBeInTheDocument();
    // The default deck has ≥1 footing — count is a positive integer.
    const row = rowHeader.closest('tr');
    expect(row).not.toBeNull();
    const countCell = row!.querySelector('td');
    expect(countCell).not.toBeNull();
    const count = Number(countCell!.textContent);
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThan(0);
  });

  it('does NOT render a Footings section for a floating (block-only) design', () => {
    setLayout(makeFoundationOnlyLayout());
    render(<BomPanel />);
    const footingsH3 = screen.queryByRole('heading', { level: 3, name: /footings/i });
    expect(footingsH3).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty layout
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Unit switching (S14 AC7 preserved under S21 shape)
// ---------------------------------------------------------------------------

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

  it('renders imperial lengths (foot mark ′ or " ft") somewhere in the lumber table', () => {
    render(<BomPanel />);
    const lumberTable = screen
      .getAllByRole('table')
      .find((t) => (t.querySelector('caption')?.textContent ?? '').match(/lumber/i));
    const text = lumberTable!.textContent ?? '';
    expect(text).toMatch(/[′″]|ft/);
  });

  it('renders metric lengths with " m" after unit switch', () => {
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    render(<BomPanel />);
    const lumberTable = screen
      .getAllByRole('table')
      .find((t) => (t.querySelector('caption')?.textContent ?? '').match(/lumber/i));
    const text = lumberTable!.textContent ?? '';
    expect(text).toMatch(/\s(m|cm|mm)\b/);
  });
});

// ---------------------------------------------------------------------------
// Default bundle produces real lumber rows (FIX I preserved)
// ---------------------------------------------------------------------------

describe('<BomPanel /> — default store bundle produces real lumber rows (FIX I)', () => {
  it('reads useLayout() from the default store and renders ≥1 lumber row', () => {
    render(<BomPanel />);
    const lumberTable = screen
      .getAllByRole('table')
      .find((t) => (t.querySelector('caption')?.textContent ?? '').match(/lumber/i));
    expect(lumberTable).toBeDefined();
    const bodyRows = lumberTable!.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBeGreaterThan(0);

    // Boards column (3rd) must show a positive integer for every row.
    for (const tr of Array.from(bodyRows)) {
      const cells = tr.querySelectorAll('td');
      // cells: [Stock length, Boards, Offcut]. 'Boards' is index 1.
      const boardsText = cells[1]?.textContent ?? '';
      const n = Number(boardsText);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });
});
