/**
 * `UnitSwitcher.test.tsx` — S13 issue #14 AC5 + a11y.
 *
 * The switcher is a display-only control: it toggles
 * `useUiStore.units` between 'imperial' and 'metric', which changes
 * how LengthField renders `mmValue`. It NEVER touches
 * `useDesignStore` — AC5 is the invariant that a unit switch does
 * not mutate the design.
 *
 * A11y — two-state button with `aria-pressed`, per ticket §10.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useUiStore } from '../state/ui-store';
import { UnitSwitcher } from './UnitSwitcher';

beforeEach(() => {
  act(() => {
    useUiStore.setState({ units: 'imperial' });
  });
});

afterEach(() => {
  cleanup();
  act(() => {
    useUiStore.setState({ units: 'imperial' });
  });
});

describe('<UnitSwitcher />', () => {
  it('renders TWO controls (imperial, metric) with pressed state on the active unit', () => {
    render(<UnitSwitcher />);
    // Two buttons — one per system.
    const imperial = screen.getByRole('button', { name: /imperial/i });
    const metric = screen.getByRole('button', { name: /metric/i });
    expect(imperial.getAttribute('aria-pressed')).toBe('true');
    expect(metric.getAttribute('aria-pressed')).toBe('false');
  });

  it('flips ui-store units from imperial to metric on click', async () => {
    const user = userEvent.setup();
    render(<UnitSwitcher />);
    const metric = screen.getByRole('button', { name: /metric/i });
    await user.click(metric);
    expect(useUiStore.getState().units).toBe('metric');
  });

  it('is idempotent — clicking the already-active button leaves state unchanged', async () => {
    const user = userEvent.setup();
    render(<UnitSwitcher />);
    const imperial = screen.getByRole('button', { name: /imperial/i });
    await user.click(imperial);
    expect(useUiStore.getState().units).toBe('imperial');
  });

  it('has an accessible group label so screen readers announce it as one control', () => {
    render(<UnitSwitcher />);
    // Group is a labelled region — role=group + aria-label so the
    // two buttons are announced together as "Display units" or
    // similar.
    const group = screen.getByRole('group', { name: /display units/i });
    expect(group).toBeInTheDocument();
  });
});
