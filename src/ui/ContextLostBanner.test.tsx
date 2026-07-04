/**
 * Unit tests for `src/ui/ContextLostBanner.tsx`.
 *
 * ## Coverage map (S12 pair-fix iter 1 — Fix C)
 *
 *   1. `webglContextLost === false` → renders null (no wrapper).
 *   2. `webglContextLost === true` → renders the banner with the
 *      pinned title/body + Reload button, role="alert".
 *   3. The scene→state→ui flow: firing the context-loss handler
 *      (via `installContextLossHandler`) flips the ui-store flag
 *      → the mounted banner shows. This is the end-to-end proof
 *      the wiring is complete.
 *   4. Reload button calls `window.location.reload()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useUiStore } from '../state';
import { installContextLossHandler, STARTUP_GRACE_MS } from '../scene/context-loss';
import {
  CONTEXT_LOST_BODY,
  CONTEXT_LOST_RELOAD_LABEL,
  CONTEXT_LOST_TITLE,
  ContextLostBanner,
} from './ContextLostBanner';

const UI_STORE_INITIAL = useUiStore.getInitialState();

beforeEach(() => {
  act(() => {
    useUiStore.setState(UI_STORE_INITIAL, true);
  });
});

afterEach(() => {
  act(() => {
    useUiStore.setState(UI_STORE_INITIAL, true);
  });
});

describe('ContextLostBanner — happy path', () => {
  it('renders NOTHING when webglContextLost is false', () => {
    const { container } = render(<ContextLostBanner />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ContextLostBanner — sad path (Fix C — browser UAT finding)', () => {
  it('renders the title + body + reload button when webglContextLost is true', () => {
    act(() => {
      useUiStore.getState().setWebglContextLost(true);
    });
    render(<ContextLostBanner />);
    expect(screen.getByText(CONTEXT_LOST_TITLE)).toBeInTheDocument();
    expect(screen.getByText(CONTEXT_LOST_BODY)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: CONTEXT_LOST_RELOAD_LABEL }),
    ).toBeInTheDocument();
  });

  it('uses role="alert" so screen readers announce the state change', () => {
    act(() => {
      useUiStore.getState().setWebglContextLost(true);
    });
    render(<ContextLostBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('subscribes to the ui-store — flipping the flag makes the banner appear', () => {
    // Mount BEFORE the flag flips — the banner should be absent.
    render(<ContextLostBanner />);
    expect(screen.queryByText(CONTEXT_LOST_TITLE)).not.toBeInTheDocument();

    // Flip the flag — the banner should mount.
    act(() => {
      useUiStore.getState().setWebglContextLost(true);
    });
    expect(screen.getByText(CONTEXT_LOST_TITLE)).toBeInTheDocument();
  });
});

describe('ContextLostBanner — end-to-end scene→state→ui flow (Fix C wiring)', () => {
  it('the scene context-loss handler flips the flag and the mounted banner shows', () => {
    // Silence the context-loss console.error (the handler emits it).
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Use fake timers so we can advance past the STARTUP_GRACE_MS
    // window (see context-loss.ts: for the first 1.5s after install
    // the handler treats webglcontextlost as a StrictMode ghost and
    // ignores it). Real GPU-loss events happen well after 1.5s.
    vi.useFakeTimers();
    try {
      // Set up: mount the banner, install the handler on a fake gl.
      render(<ContextLostBanner />);
      const canvas = document.createElement('canvas');
      installContextLossHandler({ domElement: canvas });
      // Jump past the grace window so the dispatched event is
      // treated as a real GPU loss (not a StrictMode ghost).
      vi.setSystemTime(Date.now() + STARTUP_GRACE_MS + 100);

      // Banner is absent initially.
      expect(screen.queryByText(CONTEXT_LOST_TITLE)).not.toBeInTheDocument();

      // Fire the event → handler flips the ui-store flag → banner
      // rerenders. Wrap the dispatch in `act` because the resulting
      // React state update is synchronous.
      act(() => {
        canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      });

      expect(screen.getByText(CONTEXT_LOST_TITLE)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('ContextLostBanner — reload button', () => {
  it('clicking Reload page invokes window.location.reload()', async () => {
    act(() => {
      useUiStore.getState().setWebglContextLost(true);
    });
    // See SceneErrorBoundary.test.tsx — jsdom's
    // window.location.reload is not configurable; replace the
    // whole `location` via vi.stubGlobal to install a spy.
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', {
      ...window.location,
      reload: reloadSpy,
      assign: window.location.assign.bind(window.location),
      replace: window.location.replace.bind(window.location),
    });
    try {
      render(<ContextLostBanner />);
      await userEvent.click(
        screen.getByRole('button', { name: CONTEXT_LOST_RELOAD_LABEL }),
      );
      expect(reloadSpy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
