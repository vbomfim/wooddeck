/**
 * `FloatingFramingSelector.test.tsx` — TDD RED for the new
 * floating-framing selector.
 *
 * ## Coverage
 *
 *   - When `structure === 'elevated'`, the selector renders NOTHING
 *     (returns null). Elevated framing is fixed — the selector is
 *     meaningful only for floating construction.
 *   - When `structure === 'floating'`, the selector renders a radio
 *     group with two labelled options.
 *   - Clicking an option dispatches `applyParameters({
 *     floatingFraming: '<value>' })`, which updates the store and
 *     recomputes the layout (different members appear).
 *   - a11y — the group has an accessible label ("Floating framing"),
 *     each option has visible text, and the current selection is
 *     reflected on the checked radio.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { resetDesignStoreForTests, useDesignStore } from '../../state/design-store';

import { FloatingFramingSelector } from './FloatingFramingSelector';

beforeEach(() => {
  resetDesignStoreForTests();
});

afterEach(() => {
  cleanup();
});

// --------------------------------------------------------------------------
// Visibility
// --------------------------------------------------------------------------

describe('<FloatingFramingSelector /> — visibility gating', () => {
  it('renders nothing when structure === "elevated"', () => {
    // Default design is elevated.
    const { container } = render(<FloatingFramingSelector />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a radio group when structure === "floating"', () => {
    // Flip the store to floating first.
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
        },
      });
    });
    render(<FloatingFramingSelector />);
    expect(
      screen.getByRole('radiogroup', { name: /floating framing/i }),
    ).toBeInTheDocument();
    // Two options.
    expect(
      screen.getByRole('radio', { name: /beams \+ joists/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /joists on blocks/i }),
    ).toBeInTheDocument();
  });
});

// --------------------------------------------------------------------------
// Dispatch — the selector writes back to the store
// --------------------------------------------------------------------------

describe('<FloatingFramingSelector /> — dispatch', () => {
  it('reflects the current design.floatingFraming as the checked radio', () => {
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
        },
      });
    });
    render(<FloatingFramingSelector />);
    const beamsAndJoists = screen.getByRole<HTMLInputElement>('radio', {
      name: /beams \+ joists/i,
    });
    const joistsOnBlocks = screen.getByRole<HTMLInputElement>('radio', {
      name: /joists on blocks/i,
    });
    // Default after switching to floating: beams-and-joists.
    expect(beamsAndJoists.checked).toBe(true);
    expect(joistsOnBlocks.checked).toBe(false);
  });

  it('clicking "Joists on blocks" flips design.floatingFraming and re-layouts', async () => {
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
        },
      });
    });
    render(<FloatingFramingSelector />);
    const user = userEvent.setup();
    // Capture initial layout member counts (Method A has beams).
    const beforeBeams = useDesignStore
      .getState()
      .bundle.layout.members.filter((m) => m.kind === 'beam').length;
    expect(beforeBeams).toBe(2); // rim beams

    await user.click(
      screen.getByRole('radio', { name: /joists on blocks/i }),
    );

    // Store now carries the new discriminator.
    expect(
      useDesignStore.getState().bundle.design.floatingFraming,
    ).toBe('joists-on-blocks');
    // Layout was recomputed — Method B has zero beams.
    const afterBeams = useDesignStore
      .getState()
      .bundle.layout.members.filter((m) => m.kind === 'beam').length;
    expect(afterBeams).toBe(0);
  });

  it('clicking the already-selected option is a no-op (no design mutation)', async () => {
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
        },
      });
    });
    render(<FloatingFramingSelector />);
    const before = useDesignStore.getState().bundle.design;
    const user = userEvent.setup();
    // Default post-switch is beams-and-joists; click it again.
    await user.click(
      screen.getByRole('radio', { name: /beams \+ joists/i }),
    );
    const after = useDesignStore.getState().bundle.design;
    // Object identity — the design reference is stable (no re-run).
    expect(after).toBe(before);
  });
});
