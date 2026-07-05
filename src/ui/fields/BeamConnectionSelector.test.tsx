/**
 * `BeamConnectionSelector.test.tsx` — S27 TDD RED for the joist-
 * to-beam connection selector (drop vs flush).
 *
 * ## Coverage
 *
 *   - Visibility:
 *     - `structure === 'elevated'` → visible (elevated always has
 *       beams + joists).
 *     - `structure === 'floating'` + `floatingFraming ===
 *       'beams-and-joists'` (Method A) → visible.
 *     - `structure === 'floating'` + `floatingFraming ===
 *       'joists-on-blocks'` (Method B) → HIDDEN (returns null; no
 *       beams means beamConnection is meaningless).
 *   - Renders a radio group with the two options.
 *   - Reflects `design.beamConnection` on the checked radio.
 *   - Clicking an option dispatches `applyParameters({
 *     beamConnection: '<value>' })`, updates the store, and
 *     recomputes the layout (walking-surface height stays pinned;
 *     the framing stack shortens).
 *   - Clicking the already-selected option is a no-op.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { resetDesignStoreForTests, useDesignStore } from '../../state/design-store';

import { BeamConnectionSelector } from './BeamConnectionSelector';

beforeEach(() => {
  resetDesignStoreForTests();
});

afterEach(() => {
  cleanup();
});

// --------------------------------------------------------------------------
// Visibility gate
// --------------------------------------------------------------------------

describe('<BeamConnectionSelector /> — visibility gating', () => {
  it('renders a radio group when structure === "elevated" (default design)', () => {
    render(<BeamConnectionSelector />);
    expect(
      screen.getByRole('radiogroup', { name: /beam connection/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /drop beam/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /flush beam/i })).toBeInTheDocument();
  });

  it('renders a radio group when structure === "floating" + floatingFraming === "beams-and-joists" (Method A)', () => {
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
        },
      });
    });
    render(<BeamConnectionSelector />);
    expect(
      screen.getByRole('radiogroup', { name: /beam connection/i }),
    ).toBeInTheDocument();
  });

  it('renders NOTHING when floating + floatingFraming === "joists-on-blocks" (Method B — no beams)', () => {
    act(() => {
      useDesignStore.getState().applyParameters({
        structure: 'floating',
        floatingFraming: 'joists-on-blocks',
        foundation: {
          type: 'tuffblocks',
          product: { productId: 'tuffblock-12x12x4' },
        },
      });
    });
    const { container } = render(<BeamConnectionSelector />);
    expect(container.firstChild).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------------------

describe('<BeamConnectionSelector /> — dispatch', () => {
  it('reflects the current design.beamConnection as the checked radio (default: drop)', () => {
    render(<BeamConnectionSelector />);
    const dropRadio = screen.getByRole<HTMLInputElement>('radio', {
      name: /drop beam/i,
    });
    const flushRadio = screen.getByRole<HTMLInputElement>('radio', {
      name: /flush beam/i,
    });
    expect(dropRadio.checked).toBe(true);
    expect(flushRadio.checked).toBe(false);
  });

  it('clicking "Flush beam" flips design.beamConnection and re-layouts', async () => {
    render(<BeamConnectionSelector />);
    const user = userEvent.setup();

    // Capture the layout member positions BEFORE. Elevated post
    // height differs between drop and flush (flush is taller
    // posts for the same walking surface).
    const beforePost = useDesignStore
      .getState()
      .bundle.layout.members.find((m) => m.kind === 'post');
    if (beforePost === undefined) throw new Error('Expected at least one post member');
    const beforePostHeight = beforePost.size.y;

    await user.click(screen.getByRole('radio', { name: /flush beam/i }));

    expect(useDesignStore.getState().bundle.design.beamConnection).toBe('flush');

    const afterPost = useDesignStore
      .getState()
      .bundle.layout.members.find((m) => m.kind === 'post');
    if (afterPost === undefined) throw new Error('Expected at least one post member');
    // Flush stack is shorter → posts extend LOWER (taller).
    expect(afterPost.size.y).toBeGreaterThan(beforePostHeight);
  });

  it('clicking the already-selected option is a no-op (design identity preserved)', async () => {
    render(<BeamConnectionSelector />);
    const before = useDesignStore.getState().bundle.design;
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /drop beam/i }));
    const after = useDesignStore.getState().bundle.design;
    // No design mutation → same object reference.
    expect(after).toBe(before);
  });
});
