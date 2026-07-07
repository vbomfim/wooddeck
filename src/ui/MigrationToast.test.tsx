/**
 * `MigrationToast.test.tsx` — S23 issue #45 AC5/AC6 + pair-fix.
 *
 * ## What this file covers
 *
 *   - AC5: when the discrete-event counter indicates an
 *     outstanding migration (migrationEventId >
 *     dismissedMigrationEventId), the toast renders with the
 *     pinned copy AND dismisses on button click OR after the 8 s
 *     auto-dismiss timer.
 *   - AC6: when there is no outstanding event, the toast renders
 *     nothing (no wrapper element → no layout shift).
 *   - a11y: role="status" + aria-live="polite" (non-interrupting),
 *     dismiss button is a real `<button>` (keyboard-activatable).
 *   - Pair-fix #6 (WCAG 2.1.1): the wrapper is NOT clickable; the
 *     Dismiss button is the sole interactive surface.
 *   - Pair-fix #2 (discrete events): a NEW migration during a
 *     still-visible toast RESTARTS the 8 s timer (each event
 *     restarts the auto-dismiss clock).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useUiStore } from '../state/ui-store';

import {
  MIGRATION_TOAST_MESSAGE,
  MIGRATION_TOAST_AUTO_DISMISS_MS,
  MigrationToast,
} from './MigrationToast';

const UI_INITIAL_STATE = useUiStore.getInitialState();

beforeEach(() => {
  useUiStore.setState(UI_INITIAL_STATE, true);
});

afterEach(() => {
  cleanup();
  useUiStore.setState(UI_INITIAL_STATE, true);
  vi.useRealTimers();
});

// --------------------------------------------------------------------------
// AC6 — no render when no outstanding event
// --------------------------------------------------------------------------

describe('<MigrationToast /> — AC6 hidden when no outstanding event', () => {
  it('renders nothing when migrationEventId === dismissedMigrationEventId (fresh boot: 0/0)', () => {
    const { container } = render(<MigrationToast />);
    // No wrapper element — CSS layout does not shift.
    expect(container.firstChild).toBeNull();
    // Belt-and-suspenders: no role="status" landmark either.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing after a dismiss caught up to the current event', () => {
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
      useUiStore.getState().dismissMigration();
    });
    const { container } = render(<MigrationToast />);
    expect(container.firstChild).toBeNull();
  });
});

// --------------------------------------------------------------------------
// AC5 — renders when there is an outstanding event
// --------------------------------------------------------------------------

describe('<MigrationToast /> — AC5 renders when outstanding event exists', () => {
  beforeEach(() => {
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
  });

  it('renders the pinned message text (S23 AC5)', () => {
    render(<MigrationToast />);
    // getByText auto-checks the visible textContent — no
    // dangerouslySetInnerHTML is possible with a plain string child
    // (S6 security constraint).
    expect(screen.getByText(MIGRATION_TOAST_MESSAGE)).toBeInTheDocument();
  });

  it('renders with role="status" + aria-live="polite" (non-interrupting)', () => {
    render(<MigrationToast />);
    const region = screen.getByRole('status');
    // `role="status"` semantics carry an implicit
    // aria-live="polite". Assert both for defense in depth against
    // a screen reader that reads the explicit attribute over the
    // role default.
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('has a real <button> dismiss control (keyboard-activatable)', () => {
    render(<MigrationToast />);
    const button = screen.getByRole('button', { name: /dismiss/i });
    expect(button.tagName).toBe('BUTTON');
    // type="button" prevents form-submit if the toast ever lands
    // inside a <form>. Same discipline as StorageBanner.
    expect(button).toHaveAttribute('type', 'button');
  });
});

// --------------------------------------------------------------------------
// AC5 — click dismiss clears the toast
// --------------------------------------------------------------------------

describe('<MigrationToast /> — AC5 click dismiss', () => {
  it('clicking the dismiss button syncs dismissedMigrationEventId to migrationEventId', async () => {
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const user = userEvent.setup();
    render(<MigrationToast />);
    const eventBefore = useUiStore.getState().migrationEventId;
    expect(useUiStore.getState().dismissedMigrationEventId).toBeLessThan(
      eventBefore,
    );

    const button = screen.getByRole('button', { name: /dismiss/i });
    await user.click(button);

    // Dismissed pointer caught up to the event id — toast is gone.
    expect(useUiStore.getState().dismissedMigrationEventId).toBe(eventBefore);
    // The toast REACTS to the visibility flip — the region
    // disappears on the very next render.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

// --------------------------------------------------------------------------
// Pair-fix #6 (WCAG 2.1.1) — no click-anywhere on the wrapper
// --------------------------------------------------------------------------

describe('<MigrationToast /> — pair-fix #6: wrapper is NOT clickable (WCAG 2.1.1)', () => {
  it('the role="status" wrapper does NOT carry an onClick handler (dismiss button is the sole interactive surface)', async () => {
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const user = userEvent.setup();
    render(<MigrationToast />);

    // Click the wrapper directly — it must NOT dismiss the toast.
    const region = screen.getByRole('status');
    const dismissedBefore = useUiStore.getState().dismissedMigrationEventId;
    await user.click(region);

    // Nothing changed — the wrapper click was a no-op.
    expect(useUiStore.getState().dismissedMigrationEventId).toBe(
      dismissedBefore,
    );
    // Toast still visible.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// --------------------------------------------------------------------------
// AC5 — auto-dismiss after 8 s
// --------------------------------------------------------------------------

describe('<MigrationToast /> — AC5 auto-dismiss after 8 s', () => {
  it('the 8 s timer syncs dismissed pointer to the event id (fake timers)', () => {
    vi.useFakeTimers();
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const eventId = useUiStore.getState().migrationEventId;
    render(<MigrationToast />);
    expect(useUiStore.getState().dismissedMigrationEventId).toBeLessThan(
      eventId,
    );

    // Advance to just BEFORE the timer — still outstanding.
    act(() => {
      vi.advanceTimersByTime(MIGRATION_TOAST_AUTO_DISMISS_MS - 1);
    });
    expect(useUiStore.getState().dismissedMigrationEventId).toBeLessThan(
      eventId,
    );

    // Advance past the timer — dismissed pointer catches up.
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(useUiStore.getState().dismissedMigrationEventId).toBe(eventId);
  });

  it('the constant `MIGRATION_TOAST_AUTO_DISMISS_MS` is 8000 (ticket AC5 pins 8 s)', () => {
    expect(MIGRATION_TOAST_AUTO_DISMISS_MS).toBe(8000);
  });
});

// --------------------------------------------------------------------------
// Pair-fix #2 (discrete events) — a NEW migration restarts the timer
// --------------------------------------------------------------------------

describe('<MigrationToast /> — pair-fix #2: fresh event restarts the 8 s timer', () => {
  it('a new migration during a still-visible toast RESTARTS the 8 s auto-dismiss timer', () => {
    // Pre-pair-fix bug: `setMigrationJustHappened(true)` while
    // already `true` was a Zustand no-op, so the useEffect
    // dependency didn't change → timer NOT restarted → the toast
    // dismissed at the ORIGINAL 8 s mark from the first migration.
    // Post-pair-fix: each migration bumps `migrationEventId`, the
    // effect re-runs, the old timer is cancelled, a fresh 8 s
    // timer starts.
    vi.useFakeTimers();
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    render(<MigrationToast />);
    const firstEventId = useUiStore.getState().migrationEventId;

    // Advance 4 s (halfway through the first timer).
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // Second migration mid-toast — timer must restart.
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const secondEventId = useUiStore.getState().migrationEventId;
    expect(secondEventId).toBeGreaterThan(firstEventId);
    // Toast still visible.
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Advance another 5 s — total elapsed = 4 + 5 = 9 s. The
    // FIRST timer would have fired at 8 s, dismissing at 5 s from
    // the second migration and leaving the SECOND event still
    // outstanding. Under the fix, the first timer was cancelled;
    // the SECOND timer's 8 s window started at t=4 s (real time),
    // so at t=9 s (5 s elapsed within the second window) the
    // second event is still outstanding.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Under the fix — the toast is still visible because the
    // second event's 8 s window hasn't expired yet.
    expect(useUiStore.getState().dismissedMigrationEventId).toBeLessThan(
      secondEventId,
    );

    // Advance the remaining 3 s of the second timer — total
    // second-event elapsed = 8 s → toast dismisses.
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(useUiStore.getState().dismissedMigrationEventId).toBe(secondEventId);
  });
});

// --------------------------------------------------------------------------
// Edge — unmount cleans up the timer (no lingering fire)
// --------------------------------------------------------------------------

describe('<MigrationToast /> — cleanup on unmount', () => {
  it('unmounting cancels the auto-dismiss timer (no stale dismiss after unmount)', () => {
    vi.useFakeTimers();
    act(() => {
      useUiStore.getState().notifyMigrationHappened();
    });
    const dismissedBefore = useUiStore.getState().dismissedMigrationEventId;
    const { unmount } = render(<MigrationToast />);
    // Unmount BEFORE the timer fires.
    unmount();
    act(() => {
      vi.advanceTimersByTime(MIGRATION_TOAST_AUTO_DISMISS_MS * 2);
    });
    // Dismissed pointer was never touched by the (cancelled) timer.
    expect(useUiStore.getState().dismissedMigrationEventId).toBe(
      dismissedBefore,
    );
  });
});

// --------------------------------------------------------------------------
// Message content (S23 AC5 pinned copy)
// --------------------------------------------------------------------------

describe('<MigrationToast /> — pinned copy (S23 AC5)', () => {
  it('mentions "v1", "elevated", "posts on footings" so the user knows what was applied', () => {
    // The exact string is defined in `MIGRATION_TOAST_MESSAGE` —
    // this test locks in the topics rather than the exact wording
    // (a future minor copy edit that keeps the three signal words
    // is fine; a wholesale rewrite would need to update this).
    expect(MIGRATION_TOAST_MESSAGE).toMatch(/v1/);
    expect(MIGRATION_TOAST_MESSAGE.toLowerCase()).toMatch(/elevated/);
    expect(MIGRATION_TOAST_MESSAGE.toLowerCase()).toMatch(/post.*footing/);
  });
});
