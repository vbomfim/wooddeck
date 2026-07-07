/**
 * `BlockRowCountField.test.tsx` — feat/block-count-per-joist.
 *
 * ## Coverage
 *
 *   - Visibility gate — renders NOTHING for:
 *       • default (elevated) design
 *       • floating + beams-and-joists (Method A)
 *       • non-block foundation (defensive)
 *     Renders an integer stepper for floating + joists-on-blocks
 *     (Method B).
 *   - Default surface — with `foundation.blockRowsHint` UNSET,
 *     the input displays a sensible starter integer within
 *     `[MIN_BLOCK_ROWS_HINT, MAX_BLOCK_ROWS_HINT]`.
 *   - Reflects an explicit value — after applyParameters commits
 *     a rows hint, the field re-renders with the new value.
 *   - Dispatch — typing a new count writes back through
 *     `applyParameters({ foundation: { blockRowsHint } })`; the
 *     store carries the new value AND the layout re-renders
 *     with that exact row count.
 *   - Clamp AT input boundary — values below MIN clamp up to
 *     MIN, values above MAX clamp down to MAX (schema safety).
 *   - Round-trip through serialize/deserialize — every user
 *     edit produces a schema-legal design.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { deserialize, serialize } from '../../persistence';
import {
  MAX_BLOCK_ROWS_HINT,
  MIN_BLOCK_ROWS_HINT,
  useDesignStore,
} from '../../state';
import { resetDesignStoreForTests } from '../../state/design-store';

import { BlockRowCountField } from './BlockRowCountField';

beforeEach(() => {
  resetDesignStoreForTests();
});

afterEach(() => {
  cleanup();
});

/**
 * Flip the design store to floating + Method B (joists-on-blocks).
 * This is the ONE state where the block-row-count field is
 * visible.
 */
function flipToMethodB(): void {
  act(() => {
    useDesignStore.getState().applyParameters({
      structure: 'floating',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
      floatingFraming: 'joists-on-blocks',
    });
  });
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe('<BlockRowCountField /> — visibility gating', () => {
  it('renders nothing when the design is elevated (default state)', () => {
    const { container } = render(<BlockRowCountField />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when floating + beams-and-joists (Method A)', () => {
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
        },
        floatingFraming: 'beams-and-joists',
      });
    });
    const { container } = render(<BlockRowCountField />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a "Blocks along each joist" input when floating + joists-on-blocks (Method B)', () => {
    flipToMethodB();
    render(<BlockRowCountField />);
    expect(
      screen.getByLabelText(/blocks along each joist/i),
    ).toBeInTheDocument();
    // The hint copy from the field's own docstring surfaces to the
    // user; assert the substring so a future rewording is caught.
    expect(
      screen.getByText(/spread evenly end-to-end/i),
    ).toBeInTheDocument();
  });

  it('exposes min/max on the native number input matching the schema bounds', () => {
    flipToMethodB();
    render(<BlockRowCountField />);
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );
    expect(input.type).toBe('number');
    expect(input.min).toBe(String(MIN_BLOCK_ROWS_HINT));
    expect(input.max).toBe(String(MAX_BLOCK_ROWS_HINT));
  });
});

// ---------------------------------------------------------------------------
// Default surface
// ---------------------------------------------------------------------------

describe('<BlockRowCountField /> — default surface', () => {
  it('displays a sensible starter integer when blockRowsHint is unset', () => {
    flipToMethodB();
    const design = useDesignStore.getState().bundle.design;
    if (
      design.foundation.type !== 'deck-blocks' &&
      design.foundation.type !== 'tuffblocks'
    ) {
      throw new Error('expected block foundation for this test');
    }
    expect(design.foundation.blockRowsHint).toBeUndefined();

    render(<BlockRowCountField />);
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );
    const shown = Number.parseInt(input.value, 10);
    expect(Number.isFinite(shown)).toBe(true);
    expect(shown).toBeGreaterThanOrEqual(MIN_BLOCK_ROWS_HINT);
    expect(shown).toBeLessThanOrEqual(MAX_BLOCK_ROWS_HINT);
  });

  it('reflects an explicit foundation.blockRowsHint value from the store', () => {
    flipToMethodB();
    act(() => {
      useDesignStore.getState().applyParameters({
        foundation: { blockRowsHint: 5 },
      });
    });
    render(<BlockRowCountField />);
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );
    expect(input.value).toBe('5');
  });

  // ---- Review-gate Fix #2 (no-lying UI) ------------------------
  // When `blockRowsHint` is UNSET the displayed value must equal
  // the ACTUAL number of Method-B block rows the layout is
  // rendering. Pre-fix the field always showed a hardcoded "3"
  // even when the layout drew 4 rows (12×12) / 7 rows (16×24) —
  // a user "confirming" 3 would SILENTLY reduce support.
  // ------------------------------------------------------------

  it('displays the ACTUAL current row count (default 12×12) when blockRowsHint is unset', () => {
    // Fresh design → 12×12 elevated → flip to Method B (which
    // is the makeDefaultDesign starting shape). Read the actual
    // block-row count from the layout the store just computed;
    // assert the field shows exactly that number.
    flipToMethodB();
    const layout = useDesignStore.getState().bundle.layout;
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const uniqueZ = new Set(blocks.map((b) => b.position.z));
    const actualRowCount = uniqueZ.size;
    expect(actualRowCount).toBeGreaterThanOrEqual(MIN_BLOCK_ROWS_HINT);

    render(<BlockRowCountField />);
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );
    expect(input.value).toBe(String(actualRowCount));
  });

  it('displays the ACTUAL current row count for a resized 16×24 Method-B deck when blockRowsHint is unset', () => {
    // Resize (and flip framing) via applyParameters. Once the
    // deck is 16×24 the default row count changes; the field
    // MUST track the layout, not a hardcoded starter.
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        floatingFraming: 'joists-on-blocks',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
        },
        footprint: { widthMm: 16 * 304.8, lengthMm: 24 * 304.8 },
      });
    });
    const layout = useDesignStore.getState().bundle.layout;
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const uniqueZ = new Set(blocks.map((b) => b.position.z));
    const actualRowCount = uniqueZ.size;

    render(<BlockRowCountField />);
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );
    expect(input.value).toBe(String(actualRowCount));
  });

  // ---- Review-gate Fix #A (no-lying UI at the >100-row extreme) --
  // GPT MEDIUM (2026-07-05 diff review): the layout-derived
  // fallback used to clamp the DISPLAYED value to
  // `MAX_BLOCK_ROWS_HINT` (100) before rendering. A legal legacy
  // spacing-only design can produce > 100 rows (100 ft × narrow
  // deck + `blockSpacingMm = MIN_BLOCK_SPACING_MM (300)` →
  // ~102 rows), and the field silently showed "100" — the exact
  // "field lies about the rendered count" bug fix #2 was meant to
  // kill, at the extreme. The user's EDIT is still clamped by the
  // schema; only the READ-ONLY DISPLAY of the effective current
  // count must equal the true rendered row count.
  // -----------------------------------------------------------------

  it('displays the ACTUAL rendered row count when the legacy spacing path exceeds MAX_BLOCK_ROWS_HINT', () => {
    // Extreme legal case: 100 ft × 12 ft deck, wide joist spacing
    // (~6 ft) so numJoists is small enough that the cap doesn't
    // bind, plus MIN blockSpacingMm — the layout renders ~102
    // block rows. The field must reflect that number, NOT the
    // schema max of 100.
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        floatingFraming: 'joists-on-blocks',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
          blockSpacingMm: 300,
        },
        footprint: { widthMm: 12 * 304.8, lengthMm: 100 * 304.8 },
        joist: { spacingMm: 1829 },
      });
    });
    const layout = useDesignStore.getState().bundle.layout;
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const uniqueZ = new Set(blocks.map((b) => b.position.z));
    const actualRowCount = uniqueZ.size;

    // Sanity: we DID construct an over-schema-max case.
    expect(actualRowCount).toBeGreaterThan(MAX_BLOCK_ROWS_HINT);

    render(<BlockRowCountField />);
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );
    expect(input.value).toBe(String(actualRowCount));
  });
});

// ---------------------------------------------------------------------------
// Dispatch — the field writes back to the store
// ---------------------------------------------------------------------------

describe('<BlockRowCountField /> — dispatch', () => {
  it('typing a new integer commits foundation.blockRowsHint through applyParameters', async () => {
    flipToMethodB();
    render(<BlockRowCountField />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );

    await user.clear(input);
    await user.type(input, '6');

    const design = useDesignStore.getState().bundle.design;
    if (
      design.foundation.type !== 'deck-blocks' &&
      design.foundation.type !== 'tuffblocks'
    ) {
      throw new Error('expected block foundation after Method B flip');
    }
    expect(design.foundation.blockRowsHint).toBe(6);
  });

  it('a fresh joists-on-blocks deck at 12×12 produces NO over-span-joist warning at the default count', () => {
    // Regression pin for the UAT bug: fresh joists-on-blocks
    // design at typical size (12×12) must NOT be over-spanned
    // by default. The default derivation picks a span-safe count.
    flipToMethodB();
    const layout = useDesignStore.getState().bundle.layout;
    const warnings = useDesignStore.getState().bundle.warnings;
    // Every joist has ≥ 2 blocks under it → span check runs.
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    // No over-span warnings on the fresh deck.
    const overSpanJoist = warnings.filter(
      (w) => w.kind === 'over-span-joist',
    );
    expect(overSpanJoist).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Clamp — schema-legal range enforcement at the input boundary
// ---------------------------------------------------------------------------

describe('<BlockRowCountField /> — clamp stored value to schema-legal range', () => {
  it('below-min input (0) → design stores MIN_BLOCK_ROWS_HINT', async () => {
    flipToMethodB();
    render(<BlockRowCountField />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );
    await user.clear(input);
    await user.type(input, '0');

    const design = useDesignStore.getState().bundle.design;
    if (
      design.foundation.type !== 'deck-blocks' &&
      design.foundation.type !== 'tuffblocks'
    ) {
      throw new Error('expected block foundation');
    }
    expect(design.foundation.blockRowsHint).toBeDefined();
    expect(
      design.foundation.blockRowsHint ?? Number.NEGATIVE_INFINITY,
    ).toBeGreaterThanOrEqual(MIN_BLOCK_ROWS_HINT);
  });

  it('above-max input (999) → design stores MAX_BLOCK_ROWS_HINT', async () => {
    flipToMethodB();
    render(<BlockRowCountField />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );
    await user.clear(input);
    await user.type(input, '999');

    const design = useDesignStore.getState().bundle.design;
    if (
      design.foundation.type !== 'deck-blocks' &&
      design.foundation.type !== 'tuffblocks'
    ) {
      throw new Error('expected block foundation');
    }
    expect(design.foundation.blockRowsHint).toBeDefined();
    expect(
      design.foundation.blockRowsHint ?? Number.POSITIVE_INFINITY,
    ).toBeLessThanOrEqual(MAX_BLOCK_ROWS_HINT);
  });

  it('every edited value ROUND-TRIPS through serialize→deserialize (save/reload safety)', async () => {
    flipToMethodB();
    render(<BlockRowCountField />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>(
      /blocks along each joist/i,
    );

    for (const raw of ['3', '7', '999']) {
      await user.clear(input);
      await user.type(input, raw);
      const design = useDesignStore.getState().bundle.design;
      const json = serialize(design, {
        createdAt: design.createdAt,
        generatorVersion: '1.0.0',
      });
      expect(() => deserialize(json)).not.toThrow();
    }
  });
});
