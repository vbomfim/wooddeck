/**
 * `LumberRow.test.tsx` — S24 issue #46 AC1 + AC2 + AC7.
 *
 * ## Coverage (S24)
 *
 *   - AC1: summary text `"{N} × {sku} × {stockLength} — {offcut}
 *     total offcut"`.
 *   - AC2: renders a `<details>` element (native disclosure) that
 *     is closed by default. Clicking `<summary>` toggles it.
 *   - AC7: >10 boards → still closed by default. (Native
 *     `<details>` has no `open` attr unless set explicitly.)
 *   - AC6 unit-aware: summary formats via `formatLength` so a
 *     unit switch changes the length text.
 *   - Interior: renders a `<CutPlanTable />` in the disclosure body
 *     — one `<tr>` per PackedBoard.
 *
 * ## SKU string
 *
 *   The fixture uses `"2x8 PT No2"` (space-separated, no
 *   punctuation), matching `formatSku()` in derive-bom.ts. The
 *   ticket's illustrative "2×8 PT No.2" prose is not the wire
 *   format.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { BomSection_Lumber } from '../../domain/bom/derive-bom';

import { LumberRow } from './LumberRow';

afterEach(() => {
  cleanup();
});

/**
 * User's hand-drawn example (ticket §0): 15 boards of 2×8 PT No.2
 * at 16 ft stock, 610 mm total offcut. 13 boards full-length + 2
 * boards with heterogeneous cuts.
 */
function makeUserExampleSection(): BomSection_Lumber {
  const stockLengthMm = 4877; // 16 ft
  const fullBoards = Array.from({ length: 13 }, (_, i) => ({
    stockLengthMm,
    cuts: [{ memberId: `j-${String(i)}`, lengthMm: 4877 }],
    offcutMm: 0,
  }));
  return {
    sku: '2x8 PT No2',
    nominal: '2x8',
    species: 'PT',
    grade: 'No2',
    stockLengthsAvailableMm: [4877],
    pack: {
      stockBoards: [
        ...fullBoards,
        {
          stockLengthMm,
          cuts: [
            { memberId: 'j-13', lengthMm: 4267 },
            { memberId: 'j-14', lengthMm: 610 },
          ],
          offcutMm: 0,
        },
        {
          stockLengthMm,
          cuts: [
            { memberId: 'j-15', lengthMm: 4267 },
            { memberId: 'j-16', lengthMm: 597 },
          ],
          offcutMm: 8,
        },
      ],
      totalStockBoards: 15,
      totalOffcutMm: 8,
    },
  };
}

/** Trivially small section: 1 board, 1 cut. */
function makeSingletonSection(): BomSection_Lumber {
  return {
    sku: '2x6 PT No2',
    nominal: '2x6',
    species: 'PT',
    grade: 'No2',
    stockLengthsAvailableMm: [3658],
    pack: {
      stockBoards: [
        {
          stockLengthMm: 3658,
          cuts: [{ memberId: 'b-0', lengthMm: 3658 }],
          offcutMm: 0,
        },
      ],
      totalStockBoards: 1,
      totalOffcutMm: 0,
    },
  };
}

describe('<LumberRow /> — AC1 summary line', () => {
  it('renders a <details> with a <summary> child', () => {
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    // Native <details> exposes role=group in the accessibility tree.
    const group = screen.getByRole('group');
    expect(group.tagName.toLowerCase()).toBe('details');
    const summary = group.querySelector('summary');
    expect(summary).not.toBeNull();
  });

  it('summary shows "{count} × {sku} × {stockLength}" (imperial)', () => {
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const summary = screen.getByRole('group').querySelector('summary');
    const text = summary?.textContent ?? '';
    // 15 × 2x8 PT No2 × 16′ 0″
    expect(text).toMatch(/15\s*×\s*2x8 PT No2\s*×\s*16′\s*0″/);
  });

  it('summary shows the total offcut after an em-dash suffix', () => {
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const summary = screen.getByRole('group').querySelector('summary');
    const text = summary?.textContent ?? '';
    // "— 5/16″ total offcut" (8 mm → 5/16 in fine imperial).
    expect(text).toMatch(/—/);
    expect(text.toLowerCase()).toMatch(/total offcut/);
  });

  it('summary swaps length text when units flip to metric', () => {
    const section = makeUserExampleSection();
    const { rerender } = render(<LumberRow section={section} units="imperial" />);
    const imperialSummary = screen.getByRole('group').querySelector('summary')?.textContent ?? '';
    expect(imperialSummary).toMatch(/[′″]/);

    rerender(<LumberRow section={section} units="metric" />);
    const metricSummary = screen.getByRole('group').querySelector('summary')?.textContent ?? '';
    expect(metricSummary).toMatch(/\s(m|cm|mm)\b/);
    expect(metricSummary).not.toMatch(/[′″]/);
  });

  it('a singleton pack still renders the "1 × …" summary', () => {
    render(<LumberRow section={makeSingletonSection()} units="imperial" />);
    const text = screen.getByRole('group').querySelector('summary')?.textContent ?? '';
    expect(text).toMatch(/1\s*×\s*2x6 PT No2/);
  });
});

describe('<LumberRow /> — AC2 disclosure behaviour', () => {
  it('is closed by default (no `open` attribute)', () => {
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const details = screen.getByRole<HTMLDetailsElement>('group');
    expect(details.open).toBe(false);
    expect(details.hasAttribute('open')).toBe(false);
  });

  it('opens when the user clicks the summary', async () => {
    const user = userEvent.setup();
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const details = screen.getByRole<HTMLDetailsElement>('group');
    const summary = details.querySelector('summary')!;
    await user.click(summary);
    expect(details.open).toBe(true);
  });

  it('collapses again on a second click (toggle)', async () => {
    const user = userEvent.setup();
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const details = screen.getByRole<HTMLDetailsElement>('group');
    const summary = details.querySelector('summary')!;
    await user.click(summary);
    await user.click(summary);
    expect(details.open).toBe(false);
  });
});

describe('<LumberRow /> — AC7 collapsed even when boards > 10', () => {
  it('a 15-board pack still starts collapsed', () => {
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const details = screen.getByRole<HTMLDetailsElement>('group');
    expect(details.open).toBe(false);
  });
});

describe('<LumberRow /> — interior CutPlanTable', () => {
  it('renders a <table> in the disclosure body with one <tr> per board', () => {
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const details = screen.getByRole('group');
    const table = details.querySelector('table');
    expect(table).not.toBeNull();
    const bodyRows = table!.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(15);
  });

  it('interior table has 4 column headers (Board, Stock length, Cuts, Offcut)', () => {
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const headers = screen
      .getByRole('group')
      .querySelectorAll('table thead th');
    expect(headers.length).toBe(4);
  });
});
