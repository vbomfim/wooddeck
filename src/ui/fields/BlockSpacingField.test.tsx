/**
 * `BlockSpacingField.test.tsx` — feat/block-spacing.
 *
 * ## Coverage
 *
 *   - Visibility gate — renders NOTHING for:
 *       • default (elevated) design
 *       • floating + beams-and-joists (Method A)
 *       • non-block foundation (defensive)
 *     Renders a length input for floating + joists-on-blocks
 *     (Method B).
 *   - Default surface — with `foundation.blockSpacingMm` UNSET,
 *     the displayed value is DEFAULT_METHOD_B_BLOCK_SPACING_MM
 *     (1220 mm ≈ 4 ft 0 in).
 *   - Reflects an explicit value — after applyParameters commits
 *     a spacing, the field re-renders with the new value.
 *   - Dispatch — typing + committing writes back through
 *     `applyParameters({ foundation: { blockSpacingMm } })`; the
 *     store now carries the new value AND the layout is fresh.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { deserialize, serialize } from '../../persistence';
import {
  MAX_BLOCK_SPACING_MM,
  MIN_BLOCK_SPACING_MM,
  useDesignStore,
} from '../../state';
import { resetDesignStoreForTests } from '../../state/design-store';

import { BlockSpacingField } from './BlockSpacingField';

beforeEach(() => {
  resetDesignStoreForTests();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flip the design store to floating + Method B (joists-on-blocks).
 * This is the ONE state where the block-spacing field is visible.
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

describe('<BlockSpacingField /> — visibility gating', () => {
  it('renders nothing when the design is elevated (default state)', () => {
    const { container } = render(<BlockSpacingField />);
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
        // Explicit Method A — spacing field is only for Method B.
        floatingFraming: 'beams-and-joists',
      });
    });
    const { container } = render(<BlockSpacingField />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a "Block spacing" input when floating + joists-on-blocks (Method B)', () => {
    flipToMethodB();
    render(<BlockSpacingField />);
    // LengthField renders a labelled numeric input.
    expect(
      screen.getByLabelText(/block spacing/i),
    ).toBeInTheDocument();
    // The hint copy from the field's own docstring surfaces to the
    // user; assert the substring so a future rewording is caught.
    expect(
      screen.getByText(/distance between block rows along each joist/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Default surface
// ---------------------------------------------------------------------------

describe('<BlockSpacingField /> — default surface', () => {
  it('displays the DEFAULT_METHOD_B_BLOCK_SPACING_MM (~4 ft 0 in) when the field is unset', () => {
    // Flip to Method B WITHOUT setting blockSpacingMm — the display
    // must fall back to the domain default.
    flipToMethodB();
    // Sanity — the store slice really has NO spacing set on it.
    const design = useDesignStore.getState().bundle.design;
    if (
      design.foundation.type !== 'deck-blocks' &&
      design.foundation.type !== 'tuffblocks'
    ) {
      throw new Error('expected block foundation for this test');
    }
    expect(design.foundation.blockSpacingMm).toBeUndefined();

    render(<BlockSpacingField />);
    const input = screen.getByLabelText<HTMLInputElement>(/block spacing/i);
    // Default is 1220 mm ≈ 4 ft. The formatter uses primes (′ ft,
    // ″ in) and rounds to the nearest 1/16 in, so the exact string
    // is `4′ 0 1/16″`. Assert the "4′" prefix — that's the
    // interesting invariant (feet component). A change to the
    // formatter that dropped primes would be caught by the primary
    // formatter tests, not here.
    expect(input.value).toMatch(/^4′/);
  });

  it('reflects an explicit foundation.blockSpacingMm value from the store', () => {
    flipToMethodB();
    act(() => {
      useDesignStore.getState().applyParameters({
        foundation: { blockSpacingMm: 610 }, // 2 ft
      });
    });
    render(<BlockSpacingField />);
    const input = screen.getByLabelText<HTMLInputElement>(/block spacing/i);
    // 610 mm = 2 ft 0 in exactly (formatter uses primes `′`/`″`).
    expect(input.value).toMatch(/^2′\s*0″/);
  });
});

// ---------------------------------------------------------------------------
// Dispatch — the field writes back to the store
// ---------------------------------------------------------------------------

describe('<BlockSpacingField /> — dispatch', () => {
  it('typing a new spacing + blurring commits `foundation.blockSpacingMm` through applyParameters', async () => {
    flipToMethodB();
    render(<BlockSpacingField />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>(/block spacing/i);

    // Clear the input and type a new value in the default imperial
    // system. 6 ft ≈ 1828.8 mm — small enough to stay under
    // MAX_BLOCK_SPACING_MM and large enough to be a distinct grid
    // vs the 4 ft default.
    await user.clear(input);
    await user.type(input, '6 ft 0 in');
    // Commit via blur (LengthField commits on blur when dirty).
    await user.tab();

    const design = useDesignStore.getState().bundle.design;
    if (
      design.foundation.type !== 'deck-blocks' &&
      design.foundation.type !== 'tuffblocks'
    ) {
      throw new Error('expected block foundation after Method B flip');
    }
    // Allow round-trip drift (formatter/parser tolerance) — the
    // value should be within a millimeter of 1828.8 mm.
    expect(design.foundation.blockSpacingMm).toBeDefined();
    expect(
      Math.abs((design.foundation.blockSpacingMm ?? 0) - 1828.8),
    ).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// HIGH #2 (review) — UI-side clamp so the STORED value is
// always schema-valid (save/reload cannot trap the user)
// ---------------------------------------------------------------------------
//
// Pre-fix: `BlockSpacingField` dispatched whatever the user typed.
// The LAYOUT would clamp (300 ≤ s ≤ 2438.4) for geometry, but the
// stored `foundation.blockSpacingMm` was the raw value. Save →
// reload path would then throw `schema-validation-failed` on the
// same design that "worked fine" until close. Fix: clamp AT THE
// INPUT BOUNDARY so the value STORED is always schema-legal.

describe('<BlockSpacingField /> — HIGH #2: clamp stored value to schema-legal range', () => {
  it('above-max input (10000 mm ≈ 33 ft) → design stores MAX_BLOCK_SPACING_MM (2438.4)', async () => {
    flipToMethodB();
    render(<BlockSpacingField />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>(/block spacing/i);
    await user.clear(input);
    // 10000 mm — well above MAX_BLOCK_SPACING_MM (2438.4).
    await user.type(input, '10000 mm');
    await user.tab();

    const design = useDesignStore.getState().bundle.design;
    if (
      design.foundation.type !== 'deck-blocks' &&
      design.foundation.type !== 'tuffblocks'
    ) {
      throw new Error('expected block foundation');
    }
    // Stored value MUST be ≤ MAX_BLOCK_SPACING_MM (schema-safe).
    expect(design.foundation.blockSpacingMm).toBeDefined();
    expect(
      (design.foundation.blockSpacingMm ?? Number.POSITIVE_INFINITY),
    ).toBeLessThanOrEqual(MAX_BLOCK_SPACING_MM);
  });

  it('below-min input (50 mm) → design stores MIN_BLOCK_SPACING_MM (300)', async () => {
    flipToMethodB();
    render(<BlockSpacingField />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>(/block spacing/i);
    await user.clear(input);
    await user.type(input, '50 mm');
    await user.tab();

    const design = useDesignStore.getState().bundle.design;
    if (
      design.foundation.type !== 'deck-blocks' &&
      design.foundation.type !== 'tuffblocks'
    ) {
      throw new Error('expected block foundation');
    }
    expect(design.foundation.blockSpacingMm).toBeDefined();
    expect(
      (design.foundation.blockSpacingMm ?? 0),
    ).toBeGreaterThanOrEqual(MIN_BLOCK_SPACING_MM);
  });

  it('a design edited via the field ROUND-TRIPS through serialize→deserialize without schema throw (save/reload safety)', async () => {
    flipToMethodB();
    render(<BlockSpacingField />);
    const user = userEvent.setup();
    const input = screen.getByLabelText<HTMLInputElement>(/block spacing/i);

    // Try three adversarial values that pre-fix would poison the
    // stored design with. Each MUST end up schema-legal → the
    // serialize/deserialize round-trip must not throw.
    for (const raw of ['10000 mm', '50 mm', '3 m']) {
      await user.clear(input);
      await user.type(input, raw);
      await user.tab();

      const design = useDesignStore.getState().bundle.design;
      const json = serialize(design, {
        createdAt: design.createdAt,
        generatorVersion: '1.0.0',
      });
      // The critical assertion: reload the just-written file.
      // Pre-fix, this throws schema-validation-failed for any of
      // the three inputs above.
      expect(() => deserialize(json)).not.toThrow();
    }
  });
});
