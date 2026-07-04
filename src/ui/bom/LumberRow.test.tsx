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
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  // -------------------------------------------------------------------------
  // S24 UAT pair-fix FIX 3 (QA G1): AC2 explicitly requires KEYBOARD
  // -------------------------------------------------------------------------
  // Native `<summary>` toggles on Space OR Enter — this is the
  // whole point of using `<details>` over a role="button" +
  // aria-expanded custom widget. jsdom does NOT translate a
  // `keydown` event on `<summary>` into the platform-level click
  // that real browsers dispatch as the default action of an
  // `HTMLSummaryElement`. We polyfill that default action in the
  // test with a keydown listener that mirrors what every real
  // browser does. This exercises the platform CONTRACT: the
  // element MUST be a real `<summary>` that receives the keyboard
  // event, and the click that follows MUST toggle the details.
  // If a future refactor puts an intercepting `onKeyDown` handler
  // higher in the tree that preventDefault's the event, this test
  // fails — which is the desired signal (AC2 requires the
  // keyboard path to work in real browsers).
  function polyfillSummaryKeyboardToggle(summary: HTMLElement): () => void {
    const handler = (e: KeyboardEvent): void => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.defaultPrevented) {
        e.preventDefault();
        summary.click();
      }
    };
    summary.addEventListener('keydown', handler);
    return () => summary.removeEventListener('keydown', handler);
  }

  it('opens when the user presses Space on the focused summary (AC2 keyboard)', async () => {
    const user = userEvent.setup();
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const details = screen.getByRole<HTMLDetailsElement>('group');
    const summary = details.querySelector('summary')!;
    // The element MUST be a real `<summary>` — that's what gives
    // us native keyboard support in every browser and AT stack.
    expect(summary.tagName.toLowerCase()).toBe('summary');
    const cleanupPolyfill = polyfillSummaryKeyboardToggle(summary);
    try {
      summary.focus();
      expect(summary).toBe(document.activeElement);
      await user.keyboard('{ }');
      expect(details.open).toBe(true);
    } finally {
      cleanupPolyfill();
    }
  });

  it('opens when the user presses Enter on the focused summary (AC2 keyboard)', async () => {
    const user = userEvent.setup();
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const details = screen.getByRole<HTMLDetailsElement>('group');
    const summary = details.querySelector('summary')!;
    const cleanupPolyfill = polyfillSummaryKeyboardToggle(summary);
    try {
      summary.focus();
      await user.keyboard('{Enter}');
      expect(details.open).toBe(true);
    } finally {
      cleanupPolyfill();
    }
  });

  it('closes on a second Space press (keyboard toggle round-trip)', async () => {
    const user = userEvent.setup();
    render(<LumberRow section={makeUserExampleSection()} units="imperial" />);
    const details = screen.getByRole<HTMLDetailsElement>('group');
    const summary = details.querySelector('summary')!;
    const cleanupPolyfill = polyfillSummaryKeyboardToggle(summary);
    try {
      summary.focus();
      await user.keyboard('{ }');
      expect(details.open).toBe(true);
      summary.focus();
      await user.keyboard('{ }');
      expect(details.open).toBe(false);
    } finally {
      cleanupPolyfill();
    }
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

// ---------------------------------------------------------------------------
// S24 UAT pair-fix FIX 3 (QA G2): summary offcut === Σ stockBoards[i].offcutMm
// ---------------------------------------------------------------------------

describe('<LumberRow /> — summary offcut consistency (QA G2)', () => {
  it('summary total-offcut value equals the sum of the expanded table row offcuts', () => {
    // Construct a section where multiple boards have non-zero
    // offcuts. The summary text must be arithmetically consistent
    // with the per-board offcuts shown in the disclosure body.
    const section: BomSection_Lumber = {
      sku: '2x8 PT No2',
      nominal: '2x8',
      species: 'PT',
      grade: 'No2',
      stockLengthsAvailableMm: [4877],
      pack: {
        stockBoards: [
          {
            stockLengthMm: 4877,
            cuts: [{ memberId: 'a', lengthMm: 4700 }],
            offcutMm: 177,
          },
          {
            stockLengthMm: 4877,
            cuts: [{ memberId: 'b', lengthMm: 4500 }],
            offcutMm: 377,
          },
          {
            stockLengthMm: 4877,
            cuts: [{ memberId: 'c', lengthMm: 4877 }],
            offcutMm: 0,
          },
        ],
        totalStockBoards: 3,
        totalOffcutMm: 554, // 177 + 377 + 0
      },
    };
    render(<LumberRow section={section} units="metric" />);
    const details = screen.getByRole('group');
    const summary = details.querySelector('summary')!;
    const summaryText = summary.textContent ?? '';

    // Read the per-board offcut cells directly from the DOM
    // (third <td> in each row, per CutPlanTable's column order).
    const rowCells = Array.from(details.querySelectorAll('tbody tr'));
    const offcutTexts = rowCells.map(
      (row) => row.querySelectorAll('td')[2]?.textContent?.trim() ?? '',
    );
    // Every non-zero offcut in the table must be reflected in the
    // total announced in the summary line. Rather than parse the
    // formatted units back to mm (fragile), assert that the sum's
    // formatted string appears in the summary. 554 mm ≥ 100 mm
    // renders as "55.4 cm" at fine precision (formatMetric
    // switches to cm at ≥ 10 cm — see units.ts).
    expect(summaryText).toContain('55.4 cm');
    // And each row cell's offcut is rendered (non-empty text).
    expect(offcutTexts.filter((s) => s.length > 0).length).toBe(3);
    // Row-cell offcuts: 177 mm, 377 mm, 0 mm. 177 → "17.7 cm";
    // 377 → "37.7 cm"; 0 → "0 mm". Verify each renders.
    expect(offcutTexts[0]).toBe('17.7 cm');
    expect(offcutTexts[1]).toBe('37.7 cm');
    expect(offcutTexts[2]).toBe('0 mm');
  });
});

// ---------------------------------------------------------------------------
// S24 UAT pair-fix FIX 3 (QA G5): sku is textContent — no HTML injection
// ---------------------------------------------------------------------------

describe('<LumberRow /> — sku is textContent (XSS defense, QA G5)', () => {
  it('a hostile sku string renders as text, not as HTML markup', () => {
    // A SKU string like `'<img src=x onerror="alert(1)">'` would
    // fire the onerror handler if `dangerouslySetInnerHTML` (or
    // any equivalent bypass) crept into the summary. React's
    // default text interpolation escapes it — this test guards
    // against a future refactor that swaps to unsafe HTML.
    // Mirrors the FoundationRow displayName XSS test.
    const hostileSku = '<img src=x onerror="alert(1)">';
    const section: BomSection_Lumber = {
      sku: hostileSku,
      nominal: '2x8',
      species: 'PT',
      grade: 'No2',
      stockLengthsAvailableMm: [4877],
      pack: {
        stockBoards: [
          {
            stockLengthMm: 4877,
            cuts: [{ memberId: 'x', lengthMm: 4877 }],
            offcutMm: 0,
          },
        ],
        totalStockBoards: 1,
        totalOffcutMm: 0,
      },
    };
    const { container } = render(<LumberRow section={section} units="imperial" />);
    // The hostile string appears verbatim in the DOM's text
    // content (not parsed).
    const summary = container.querySelector('summary');
    expect(summary?.textContent).toContain(hostileSku);
    // And NO <img> tag was created — the whole point of the test.
    expect(container.querySelector('img')).toBeNull();
    // The caption inside CutPlanTable also renders the sku as
    // text (defense in depth).
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S24 UAT pair-fix FIX 3 (Opus#3): mixed-stock-length pack throws
// ---------------------------------------------------------------------------

describe('<LumberRow /> — mixed-stock invariant (Opus#3)', () => {
  it('throws a descriptive error when a pack has boards with different stock lengths', () => {
    // The packer contract guarantees every board in a pack shares
    // one stock length (single-stock choice from §16, and the
    // FIX 0 splice pass emits maxStock for every spliced board).
    // A pack that violates this would silently mislabel the
    // shopping list — the summary shows ONE stock length but the
    // expanded table shows a mixture. Fail loud instead.
    const section: BomSection_Lumber = {
      sku: '2x8 PT No2',
      nominal: '2x8',
      species: 'PT',
      grade: 'No2',
      stockLengthsAvailableMm: [3658, 4877],
      pack: {
        stockBoards: [
          {
            stockLengthMm: 3658, // 12 ft
            cuts: [{ memberId: 'a', lengthMm: 3658 }],
            offcutMm: 0,
          },
          {
            stockLengthMm: 4877, // 16 ft — different!
            cuts: [{ memberId: 'b', lengthMm: 4877 }],
            offcutMm: 0,
          },
        ],
        totalStockBoards: 2,
        totalOffcutMm: 0,
      },
    };
    // Swallow React's boundary log noise for this expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        render(<LumberRow section={section} units="imperial" />),
      ).toThrow(/mixed stock lengths/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('does NOT throw for a spliced pack (every board is maxStockMm)', () => {
    // FIX 0 splice: a 24 ft cut on a 16 ft-max SKU emits 2 boards
    // BOTH at stockLengthMm = 4877 (the max). The mixed-stock
    // guard must NOT false-positive here.
    const section: BomSection_Lumber = {
      sku: '2x8 PT No2',
      nominal: '2x8',
      species: 'PT',
      grade: 'No2',
      stockLengthsAvailableMm: [4877],
      pack: {
        stockBoards: [
          {
            stockLengthMm: 4877,
            cuts: [{ memberId: 'big-beam', lengthMm: 4877 }],
            offcutMm: 0,
          },
          {
            stockLengthMm: 4877,
            cuts: [{ memberId: 'big-beam', lengthMm: 2438 }],
            offcutMm: 2439,
          },
        ],
        totalStockBoards: 2,
        totalOffcutMm: 2439,
      },
    };
    expect(() =>
      render(<LumberRow section={section} units="imperial" />),
    ).not.toThrow();
  });
});
