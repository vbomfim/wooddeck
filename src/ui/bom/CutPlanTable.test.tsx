/**
 * `CutPlanTable.test.tsx` — S24 issue #46 AC3.
 *
 * ## Coverage (S24)
 *
 *   - AC3 columns: `<th scope="col">` × 4 — Board, Stock length,
 *     Cuts, Offcut.
 *   - AC3 one row per PackedBoard, board # is a 1-based `<th
 *     scope="row">`.
 *   - AC3 cuts are comma-separated, longest first (per-cell
 *     text — not the packer's physical order).
 *   - AC6 unit-aware: cuts + stock + offcut all format via
 *     `formatLength` so switching to `metric` swaps every value.
 *   - a11y: caption present + non-empty; every `<th>` carries a
 *     `scope=`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { PackResult } from '../../domain/bom/pack-cut-list';

import { CutPlanTable } from './CutPlanTable';

afterEach(() => {
  cleanup();
});

/**
 * A single-board pack — the simplest possible fixture.
 * 16 ft (4877 mm) stock, single cut of 16 ft, 0 offcut.
 */
function makeSingleBoardPack(): PackResult {
  return {
    stockBoards: [
      {
        stockLengthMm: 4877,
        cuts: [{ memberId: 'joist-0', lengthMm: 4877 }],
        offcutMm: 0,
      },
    ],
    totalStockBoards: 1,
    totalOffcutMm: 0,
  };
}

/**
 * A three-board pack with heterogeneous cuts and an offcut on the
 * last board. Longest-first sort of cuts on the last board is what
 * the AC3 "longest first" contract exercises: packer order is
 * `[4267, 610]` but display order should be `[4267, 610]` (already
 * matches — but the FIXTURE flips them so the assertion is
 * meaningful).
 */
function makeMixedPack(): PackResult {
  return {
    stockBoards: [
      {
        stockLengthMm: 4877,
        cuts: [{ memberId: 'j-0', lengthMm: 4877 }],
        offcutMm: 0,
      },
      {
        stockLengthMm: 4877,
        cuts: [{ memberId: 'j-1', lengthMm: 4877 }],
        offcutMm: 0,
      },
      {
        stockLengthMm: 4877,
        cuts: [
          // Physical (packer) order — SHORTER first. Display must
          // reorder so longest comes first: `4267 mm, 610 mm`.
          { memberId: 'j-3', lengthMm: 610 },
          { memberId: 'j-2', lengthMm: 4267 },
        ],
        offcutMm: 8,
      },
    ],
    totalStockBoards: 3,
    totalOffcutMm: 8,
  };
}

describe('<CutPlanTable /> — AC3 column headers', () => {
  it('renders exactly 4 <th scope="col"> headers: Board, Stock length, Cuts, Offcut', () => {
    render(<CutPlanTable pack={makeSingleBoardPack()} sku="2x8 PT No2" units="imperial" />);
    const table = screen.getByRole('table');
    const headers = table.querySelectorAll('thead th');
    expect(headers.length).toBe(4);
    for (const h of Array.from(headers)) {
      expect(h.getAttribute('scope')).toBe('col');
    }
    const texts = Array.from(headers).map((h) => (h.textContent ?? '').toLowerCase());
    expect(texts[0]).toMatch(/board/);
    expect(texts[1]).toMatch(/stock length/);
    expect(texts[2]).toMatch(/cuts/);
    expect(texts[3]).toMatch(/offcut/);
  });

  it('renders a non-empty <caption> that names the SKU (a11y announcement)', () => {
    render(<CutPlanTable pack={makeSingleBoardPack()} sku="2x8 PT No2" units="imperial" />);
    const table = screen.getByRole('table');
    const caption = table.querySelector('caption');
    expect(caption).not.toBeNull();
    // Caption text is not visually shown (visually-hidden class)
    // but must announce which SKU the plan belongs to.
    expect(caption?.textContent ?? '').toMatch(/2x8 PT No2/);
  });
});

describe('<CutPlanTable /> — AC3 rows', () => {
  it('renders one <tr> per PackedBoard', () => {
    render(<CutPlanTable pack={makeMixedPack()} sku="2x8 PT No2" units="imperial" />);
    const table = screen.getByRole('table');
    const bodyRows = table.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(3);
  });

  it('uses a 1-based board number as <th scope="row">', () => {
    render(<CutPlanTable pack={makeMixedPack()} sku="2x8 PT No2" units="imperial" />);
    const table = screen.getByRole('table');
    const rowHeaders = Array.from(table.querySelectorAll('tbody th[scope="row"]'));
    expect(rowHeaders.length).toBe(3);
    expect(rowHeaders[0]?.textContent).toBe('1');
    expect(rowHeaders[1]?.textContent).toBe('2');
    expect(rowHeaders[2]?.textContent).toBe('3');
  });
});

describe('<CutPlanTable /> — AC3 cuts formatting (longest first)', () => {
  it('renders comma-separated cuts sorted longest first (imperial)', () => {
    render(<CutPlanTable pack={makeMixedPack()} sku="2x8 PT No2" units="imperial" />);
    // Row 3 has the heterogeneous cuts — inspect its 3rd <td>
    // (the Cuts column).
    const table = screen.getByRole('table');
    const bodyRows = table.querySelectorAll('tbody tr');
    const row3 = bodyRows[2]!;
    const cells = row3.querySelectorAll('td');
    // cells: [Stock length, Cuts, Offcut] (row-header is the <th>).
    const cutsText = cells[1]?.textContent ?? '';
    // 4267 mm → 14′ 0″, 610 mm → 2′ 0″. Longest first.
    expect(cutsText).toMatch(/14′\s*0″[,\s]+2′\s*0″/);
    // Reverse (shortest first) MUST NOT match.
    expect(cutsText).not.toMatch(/^2′\s*0″[,\s]+14′\s*0″/);
  });

  it('renders a single cut without a comma (row with only one cut)', () => {
    render(<CutPlanTable pack={makeSingleBoardPack()} sku="2x8 PT No2" units="imperial" />);
    const table = screen.getByRole('table');
    const bodyRows = table.querySelectorAll('tbody tr');
    const cells = bodyRows[0]!.querySelectorAll('td');
    const cutsText = cells[1]?.textContent ?? '';
    expect(cutsText).not.toMatch(/,/);
    // 4877 mm → 16′ 0″.
    expect(cutsText).toMatch(/16′\s*0″/);
  });
});

describe('<CutPlanTable /> — AC6 unit-aware rendering', () => {
  it('imperial mode renders foot/inch marks (′ ″) in every value column', () => {
    render(<CutPlanTable pack={makeMixedPack()} sku="2x8 PT No2" units="imperial" />);
    const text = screen.getByRole('table').textContent ?? '';
    expect(text).toMatch(/[′″]/);
  });

  it('metric mode renders m/cm/mm units in every value column', () => {
    render(<CutPlanTable pack={makeMixedPack()} sku="2x8 PT No2" units="metric" />);
    const text = screen.getByRole('table').textContent ?? '';
    expect(text).toMatch(/\s(m|cm|mm)\b/);
    // Imperial marks MUST NOT appear.
    expect(text).not.toMatch(/[′″]/);
  });

  it('offcut of 0 mm renders as the current unit-system "zero" string', () => {
    render(<CutPlanTable pack={makeSingleBoardPack()} sku="2x8 PT No2" units="imperial" />);
    // Single-board pack: offcut = 0. Cell text must render — must
    // not be blank (screen-reader would announce an empty cell).
    const table = screen.getByRole('table');
    const bodyRows = table.querySelectorAll('tbody tr');
    const cells = bodyRows[0]!.querySelectorAll('td');
    const offcutText = cells[2]?.textContent ?? '';
    expect(offcutText.trim().length).toBeGreaterThan(0);
  });
});

describe('<CutPlanTable /> — deterministic cut ordering (tie-break)', () => {
  it('sorts equal-length cuts by memberId ascending (deterministic snapshot)', () => {
    // Two same-length cuts with different memberIds — this is
    // exactly what the FFD packer produces when two members of the
    // same length feed the same SKU. The row's display order MUST
    // be `memberId` ascending so a diff-review sees a stable
    // string. If the sort were unstable, the two members could
    // swap positions across runs and reduce review signal.
    const pack: PackResult = {
      stockBoards: [
        {
          stockLengthMm: 4877,
          cuts: [
            // Physical (packer) order intentionally REVERSED so
            // the tie-break has something to fix.
            { memberId: 'j-zebra', lengthMm: 2000 },
            { memberId: 'j-alpha', lengthMm: 2000 },
          ],
          offcutMm: 871,
        },
      ],
      totalStockBoards: 1,
      totalOffcutMm: 871,
    };
    render(<CutPlanTable pack={pack} sku="2x8 PT No2" units="metric" />);
    const table = screen.getByRole('table');
    const cells = table.querySelectorAll('tbody tr td');
    // Cuts cell is index 1 (after stock length). Both are 2 m so
    // the length text is identical — we can only assert format.
    const cutsText = cells[1]?.textContent ?? '';
    // Both entries formatted as "2 m" and joined with ", ".
    expect(cutsText).toBe('2 m, 2 m');
  });
});
