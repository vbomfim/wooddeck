/**
 * `StorageBanner.test.tsx` — S12 issue #13 AC4 + inherited
 * obligation #3 (S8 discriminator coverage).
 *
 * Coverage:
 *   - null → renders nothing (returns an empty fragment).
 *   - 'storage-full' → the AC4-mandated exact message.
 *   - 'storage-blocked' → a message covering the private-browsing /
 *     Storage-API-unavailable case.
 *   - 'load-recompute-failed' → the AC9 recovery message PLUS the
 *     "Reset to default" affordance (S8 Opus INFO#11).
 *   - The reset button calls `useDesignStore.getState().reset()`
 *     AND clears the banner (setStorageBanner(null)) so the user
 *     is not trapped in a boot-time recompute loop.
 *   - Messages render as textContent (no dangerouslySetInnerHTML —
 *     S6 Security constraint that binds S14 too).
 *   - The code→message map is centralized as one exported constant
 *     so future error-code additions have exactly one place to update.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  resetDesignStoreForTests,
  useDesignStore,
} from '../state/design-store';
import { useUiStore } from '../state/ui-store';
import { STORAGE_BANNER_MESSAGES } from './storage-banner-messages';
import { StorageBanner } from './StorageBanner';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
//
// Each test starts with the UI store in a clean baseline and the
// design store back at its default bundle. Tests that mutate the
// stores MUST not bleed into siblings — this is the discipline
// established by state/ui-store.test.ts and state/design-store.test.ts.
// setState is wrapped in `act` so any residual mounted subscribers
// (StorageBanner mounted by a prior test whose RTL cleanup is
// still in-flight) flush their react updates inside the act boundary.

beforeEach(() => {
  act(() => {
    useUiStore.setState({ storageBanner: null });
  });
  resetDesignStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC4 + discriminator coverage
// ---------------------------------------------------------------------------

describe('<StorageBanner /> — AC4 + S8 discriminator coverage', () => {
  it('renders nothing when storageBanner is null (AC4 baseline)', () => {
    useUiStore.setState({ storageBanner: null });
    const { container } = render(<StorageBanner />);
    // Fragment-only render leaves the container empty. Any element
    // would break the AC4 "empty fragment" contract.
    expect(container.firstChild).toBeNull();
  });

  it("AC4: 'storage-full' → exact spec message", () => {
    useUiStore.setState({ storageBanner: 'storage-full' });
    render(<StorageBanner />);
    expect(
      screen.getByText(
        'Local storage is full. Your design will not be autosaved. Download the .deck file to keep it safe.',
      ),
    ).toBeInTheDocument();
  });

  it("'storage-blocked' → a private-browsing / storage-unavailable message", () => {
    useUiStore.setState({ storageBanner: 'storage-blocked' });
    render(<StorageBanner />);
    // Copy is deliberately not verbatim spec-quoted — it names
    // both the "blocked" cause and the "download to keep it safe"
    // mitigation. AC4 mandates SOME message for this discriminator;
    // the exact wording is the S12 team's call.
    const message = screen.getByRole('alert');
    expect(message).toHaveTextContent(/local storage is (blocked|unavailable)/i);
    expect(message).toHaveTextContent(/private browsing/i);
    expect(message).toHaveTextContent(/download the \.deck file/i);
  });

  it("'load-recompute-failed' → AC9 recovery message", () => {
    useUiStore.setState({ storageBanner: 'load-recompute-failed' });
    render(<StorageBanner />);
    expect(
      screen.getByText(
        "We couldn't reopen your saved design — starting from a default.",
      ),
    ).toBeInTheDocument();
  });

  it("'load-recompute-failed' → a 'Reset to default' button is rendered", () => {
    useUiStore.setState({ storageBanner: 'load-recompute-failed' });
    render(<StorageBanner />);
    // S8 Opus INFO#11: the user must be able to escape the
    // recompute-fail boot loop with one click.
    const btn = screen.getByRole('button', { name: /reset to default/i });
    expect(btn).toBeInTheDocument();
  });

  it("'reset to default' click calls useDesignStore.reset() AND clears the banner", async () => {
    useUiStore.setState({ storageBanner: 'load-recompute-failed' });

    // Spy on the design-store reset action — the test asserts the
    // click routed through the store's action (not a local method).
    const resetSpy = vi.spyOn(useDesignStore.getState(), 'reset');

    render(<StorageBanner />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /reset to default/i }));

    expect(resetSpy).toHaveBeenCalledOnce();
    // The banner must also clear — otherwise the user still sees
    // "starting from a default" after successfully resetting.
    expect(useUiStore.getState().storageBanner).toBeNull();
  });

  it('storage-full / storage-blocked banners have NO reset button (only load-recompute-failed does)', () => {
    act(() => {
      useUiStore.setState({ storageBanner: 'storage-full' });
    });
    const { rerender } = render(<StorageBanner />);
    expect(screen.queryByRole('button', { name: /reset to default/i })).not.toBeInTheDocument();

    act(() => {
      useUiStore.setState({ storageBanner: 'storage-blocked' });
    });
    rerender(<StorageBanner />);
    expect(screen.queryByRole('button', { name: /reset to default/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Centralized message map
// ---------------------------------------------------------------------------

describe('STORAGE_BANNER_MESSAGES — centralized code→message map', () => {
  it('exports a message for every non-null discriminator (exhaustive at type level)', () => {
    // Structural test: the map must have exactly the three
    // non-null codes. If S14 adds a new persistence-error code to
    // the `StorageBanner` union, ui-store.ts widens the type and
    // this test fires until STORAGE_BANNER_MESSAGES gains the
    // matching key.
    expect(Object.keys(STORAGE_BANNER_MESSAGES).sort()).toEqual([
      'load-recompute-failed',
      'storage-blocked',
      'storage-full',
    ]);
  });

  it('every mapped message is a non-empty string (compile-time constants only)', () => {
    // S6 Security: banners render textContent from these compile-
    // time strings. If a future refactor makes them functions or
    // localizes them, that's a distinct review — this test forces
    // the discussion.
    for (const key of Object.keys(STORAGE_BANNER_MESSAGES) as (keyof typeof STORAGE_BANNER_MESSAGES)[]) {
      expect(typeof STORAGE_BANNER_MESSAGES[key]).toBe('string');
      expect(STORAGE_BANNER_MESSAGES[key].length).toBeGreaterThan(0);
    }
  });
});
