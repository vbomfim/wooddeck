/**
 * `BomPanel.test.tsx` — S14 issue #15 AC6 + AC7 + S21 issue #43 +
 * S24 issue #46 (BomPanel cut-list rendering + foundation section).
 *
 * ## Coverage (S24 shape)
 *
 *   - S14-AC6: renders `<h2>Bill of materials</h2>` (landmark).
 *   - S24-AC1: renders a "Lumber" `<section aria-labelledby><h3>`
 *     with one `<details>` per SKU (`role="group"`) — not one big
 *     table.
 *   - S24-AC4: renders a "Foundation" `<h3>` + table of
 *     `FoundationRow`s below the Lumber section.
 *   - FIX 2: renders a "Footings" `<h3>` + table below (elevated
 *     designs).
 *   - S24-AC5: empty layout → "Empty layout" copy.
 *   - S14-AC7: switching units flips the length formatter in the
 *     Lumber section (summary lines + cut-plan tables).
 *   - a11y-partial: `<th scope>` on every table header cell; every
 *     table has a caption; sub-section landmarks via `<section
 *     aria-labelledby>`.
 *   - DOM ORDER: Lumber `<section>` precedes Foundation `<section>`
 *     which precedes Footings `<section>` (AC4).
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
      id: `block-${String(i)}`,
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
// Lumber section — S24 shape (one <details> per SKU, not one table)
// ---------------------------------------------------------------------------

describe('<BomPanel /> — lumber section (S24 shape)', () => {
  it('renders a Lumber h3 landmark', () => {
    render(<BomPanel />);
    const h3 = screen.getByRole('heading', { level: 3, name: /lumber/i });
    expect(h3).toBeInTheDocument();
  });

  it('renders ≥1 <details role="group"> under the Lumber section (one per SKU)', () => {
    render(<BomPanel />);
    // Native <details> exposes role=group; every SKU row is one.
    // (Foundation/Footings do NOT emit <details>, so counting
    // role=group counts SKUs.)
    const groups = screen.getAllByRole('group');
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.tagName.toLowerCase()).toBe('details');
    }
  });

  it('every SKU row is CLOSED by default (AC7: collapse-by-default)', () => {
    render(<BomPanel />);
    const groups = screen.getAllByRole<HTMLDetailsElement>('group');
    for (const g of groups) {
      expect(g.open).toBe(false);
    }
  });

  it('each summary line mentions a lumber nominal (2x…, 4x…, or 5/4x…)', () => {
    render(<BomPanel />);
    const groups = screen.getAllByRole('group');
    for (const g of groups) {
      const summary = g.querySelector('summary');
      const text = summary?.textContent ?? '';
      expect(text).toMatch(/\d+x\d+|5\/4x\d+/);
    }
  });

  it('each summary line contains the "N × …" count prefix (positive integer)', () => {
    render(<BomPanel />);
    const groups = screen.getAllByRole('group');
    for (const g of groups) {
      const summary = g.querySelector('summary');
      const text = summary?.textContent ?? '';
      const match = /^(\d+)\s*×/.exec(text.trim());
      expect(match).not.toBeNull();
      const n = Number(match![1]);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });

  it('every <th> inside the Lumber section carries a scope=… (a11y)', () => {
    render(<BomPanel />);
    // Under S24, the Lumber section contains <details> children,
    // each hosting a CutPlanTable. Every <th> in any lumber table
    // must have scope=col (headers) or scope=row (board number).
    const lumberSection = screen.getByRole('heading', { level: 3, name: /lumber/i }).closest('section');
    expect(lumberSection).not.toBeNull();
    const ths = lumberSection!.querySelectorAll('th');
    // Under S24 the CutPlanTable is inside <details> — headers ARE
    // rendered (jsdom does not apply UA CSS to hide them).
    expect(ths.length).toBeGreaterThan(0);
    for (const th of Array.from(ths)) {
      expect(th.getAttribute('scope')).toMatch(/^(col|row)$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Foundation section (S21 AC6 / S24 AC4)
// ---------------------------------------------------------------------------

describe('<BomPanel /> — foundation section (S24 AC4)', () => {
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
    const rowHeader = foundationTable!.querySelector('tbody th[scope="row"]');
    expect(rowHeader?.textContent).toMatch(/tuffblock/i);
    const countCell = foundationTable!.querySelector('tbody td');
    expect(countCell?.textContent).toBe('3');
  });

  it('does NOT render a Foundation section when no block members exist', () => {
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
    render(<BomPanel />);
    const footingsH3 = screen.getByRole('heading', { level: 3, name: /footings/i });
    expect(footingsH3).toBeInTheDocument();
  });

  it('renders a footing row with a dimension-derived displayName + count', () => {
    render(<BomPanel />);
    const rowHeader = screen.getByRole('rowheader', { name: /concrete footing/i });
    expect(rowHeader).toBeInTheDocument();
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
// Section order (AC4) — Lumber first, Foundation second, Footings third
// ---------------------------------------------------------------------------

describe('<BomPanel /> — section order (AC4)', () => {
  it('Lumber precedes Foundation precedes Footings in DOM order', () => {
    // Compose a layout with all three: joist (lumber), block
    // (foundation), and — leverage the default elevated deck which
    // already has footings. But the default has no blocks, so we
    // build a synthetic layout with 1 joist + 3 blocks + 1 footing.
    const joist: LayoutMember = {
      id: 'joist-0',
      kind: 'joist',
      position: { x: 0, y: 200, z: 0 },
      size: { x: 38, y: 184, z: 3658 },
      rotation: { x: 0, y: 0, z: 0 },
      material: { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' },
    };
    const block: LayoutMember = {
      id: 'block-0',
      kind: 'block',
      position: { x: 0, y: 0, z: 0 },
      size: { x: 305, y: 102, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
      material: { kind: 'block', productId: 'tuffblock-12x12x4' },
    };
    // Footings carry `material.kind='lumber'` as a placeholder —
    // the layout engine stamps them that way because
    // `LayoutMember.material` is required (see
    // `derive-bom.ts` § FIX 2 comment). They're routed into
    // `bom.footings` by member.kind BEFORE the material switch.
    const footing: LayoutMember = {
      id: 'footing-0',
      kind: 'footing',
      position: { x: 0, y: -305, z: 0 },
      size: { x: 305, y: 305, z: 305 },
      rotation: { x: 0, y: 0, z: 0 },
      material: { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' },
    };
    setLayout({
      designId: 'fixture-all',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 3658, lengthMm: 3658, heightMm: 305 },
      members: [joist, block, footing],
    });
    render(<BomPanel />);
    const h3s = screen.getAllByRole('heading', { level: 3 });
    const names = h3s.map((h) => h.textContent?.toLowerCase() ?? '');
    const lumberIdx = names.findIndex((n) => n.includes('lumber'));
    const foundationIdx = names.findIndex((n) => n.includes('foundation'));
    const footingsIdx = names.findIndex((n) => n.includes('footings'));
    expect(lumberIdx).toBeGreaterThan(-1);
    expect(foundationIdx).toBeGreaterThan(-1);
    expect(footingsIdx).toBeGreaterThan(-1);
    expect(lumberIdx).toBeLessThan(foundationIdx);
    expect(foundationIdx).toBeLessThan(footingsIdx);
  });
});

// ---------------------------------------------------------------------------
// Empty layout (S24 AC5)
// ---------------------------------------------------------------------------

describe('<BomPanel /> — empty layout (AC5)', () => {
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
    expect(screen.queryByRole('group')).toBeNull();
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
// Unit switching (AC6 preserved under S24 shape)
// ---------------------------------------------------------------------------

describe('<BomPanel /> — unit switching (AC6)', () => {
  it('imperial lumber section shows foot/inch marks somewhere', () => {
    render(<BomPanel />);
    const lumberSection = screen
      .getByRole('heading', { level: 3, name: /lumber/i })
      .closest('section');
    const text = lumberSection?.textContent ?? '';
    expect(text).toMatch(/[′″]|ft/);
  });

  it('metric lumber section shows m/cm/mm after unit switch', () => {
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    render(<BomPanel />);
    const lumberSection = screen
      .getByRole('heading', { level: 3, name: /lumber/i })
      .closest('section');
    const text = lumberSection?.textContent ?? '';
    expect(text).toMatch(/\s(m|cm|mm)\b/);
  });
});

// ---------------------------------------------------------------------------
// AC10 — S21 fixture math: default bundle produces real SKU rows
// ---------------------------------------------------------------------------

describe('<BomPanel /> — default store bundle produces real lumber rows (AC10)', () => {
  it('reads useLayout() from the default store and renders ≥1 SKU disclosure', () => {
    render(<BomPanel />);
    const groups = screen.getAllByRole('group');
    expect(groups.length).toBeGreaterThan(0);
    // Every summary line has the "N × …" prefix with N > 0.
    for (const g of groups) {
      const text = g.querySelector('summary')?.textContent ?? '';
      const match = /^(\d+)\s*×/.exec(text.trim());
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(0);
    }
  });
});
