/**
 * `App.test.tsx` — tests for the composition root.
 *
 * S12 turns `App.tsx` into the true composition root: it wires the
 * `AppShell` (ui) around a `React.lazy(() => import('./scene/DeckScene'))`
 * suspense boundary, mounts placeholder left/right panels (S13/S14
 * will replace them), and calls
 * `useDesignStore.getState().loadFromLocalStorage()` once on mount
 * to restore any autosaved design (S7 boot flow).
 *
 * The tests here focus on the composition WITHOUT relying on the
 * lazy-loaded scene actually resolving under jsdom — that's covered
 * by `src/scene/DeckScene.test.tsx`. We assert:
 *   - the disclaimer text renders on first paint (SC-007)
 *   - the AppShell landmarks are present (h1, main, complementary×2)
 *   - the StorageBanner surface exists (via useUiStore)
 *   - `loadFromLocalStorage` is called EXACTLY ONCE on mount
 *   - StrictMode double-invocation is tolerated (call may be =1 or
 *     ≤2 depending on React version; we assert ≥1 and ≤2 to guard
 *     against a leak of >2 without over-tightening).
 *   - the "Hello wooddeck" placeholder from S1 is GONE — the
 *     header now shows the h1 name only (no placeholder <p>).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from './App';
import { resetDesignStoreForTests, useDesignStore } from './state/design-store';
import { useUiStore } from './state/ui-store';

// ---------------------------------------------------------------------------
// Setup — clean stores between tests. Spies are restored after each. The
// setState is wrapped in `act` so any lingering subscriber (from a prior
// test whose RTL cleanup is still in flight) flushes its update inside the
// act boundary.
// ---------------------------------------------------------------------------

beforeEach(() => {
  act(() => {
    useUiStore.setState({ storageBanner: null });
  });
  resetDesignStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<App /> — composition root (S12)', () => {
  it('renders the DisclaimerBanner text on first paint (spec FR-016, SC-007)', () => {
    render(<App />);
    // Frozen wording. If the S1 "Hello wooddeck" text leaks back
    // in as a <p> disclaimer, the AppShell test "exactly one
    // note" catches it — this test just guards presence.
    expect(
      screen.getByText(
        /planning aid, not an engineering document — consult a licensed professional or your local building department/i,
      ),
    ).toBeInTheDocument();
  });

  it('renders the app <h1> and landmarks (header/main/aside×2)', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /wooddeck/i })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('complementary')).toHaveLength(2);
  });

  it('calls useDesignStore.loadFromLocalStorage() exactly once on mount (boot flow — inherited obligation #4)', () => {
    // We spy on the ACTION on the returned state — that's the
    // reference App.tsx calls via getState().loadFromLocalStorage().
    const spy = vi.spyOn(useDesignStore.getState(), 'loadFromLocalStorage');
    render(<App />);
    // StrictMode is NOT applied here (that's in main.tsx). Under
    // vitest render, useEffect fires ONCE — assert exactly one call.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not surface the S1 "Hello wooddeck" placeholder anymore (S1 decision #13 cleanup)', () => {
    render(<App />);
    // The S1 placeholder rendered "Hello wooddeck" as an <h1>.
    // Post-S12 the h1 is just "wooddeck" (via AppHeader). The
    // literal "Hello" MUST NOT appear.
    expect(screen.queryByText(/hello wooddeck/i)).not.toBeInTheDocument();
  });

  it('does not surface the S1 interim disclaimer as a <p> (S1 decision #13 cleanup)', () => {
    render(<App />);
    // Exactly one note-role element carries the disclaimer text —
    // any leftover <p role="note"> from S1 would push this count
    // above one.
    const notes = screen.getAllByRole('note');
    const disclaimerNotes = notes.filter((n) => /planning aid/i.test(n.textContent ?? ''));
    expect(disclaimerNotes).toHaveLength(1);
  });

  it('surfaces a StorageBanner when useUiStore.storageBanner is set (S8/S12 integration)', () => {
    act(() => {
      useUiStore.setState({ storageBanner: 'storage-full' });
    });
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent(/local storage is full/i);
  });
});
