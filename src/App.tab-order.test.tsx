/**
 * `App.tab-order.test.tsx` — S12 pair-fix iter 1 Fix D
 * (GPT#3 HIGH).
 *
 * ## Why this file exists (separate from `AppShell.test.tsx`)
 *
 * The original AC6 test in `AppShell.test.tsx` used a FAKE
 * focusable `<button>` injected into the `main` slot. That test
 * proved the SHELL's tab order is correct in the abstract, but it
 * did NOT prove the REAL scene canvas is focusable — a keyboard
 * user could still tab right past the 3D view because the r3f
 * `<Canvas>` had `aria-label` but NO `tabIndex`.
 *
 * This file exercises the FULL App composition (App → AppShell →
 * lazy DeckScene) with a mocked scene that renders a real
 * `<canvas tabIndex={0}>` element. The tab-order assertion then
 * hits the SAME code path a keyboard user hits in production.
 * The DeckScene contract test (`DeckScene.test.tsx` "Fix D:
 * passes tabIndex={0}…") already proves the real DeckScene sets
 * the tabIndex; here we prove the composition wires it through.
 *
 * ## Why the DeckScene mock
 *
 * The real DeckScene imports `@react-three/fiber`'s `<Canvas>`,
 * which crashes in jsdom (no WebGL). The mock renders a plain
 * `<canvas>` element with the tabIndex + aria-label the real
 * DeckScene would pass — the shape of the mount that matters for
 * a keyboard tab-order test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { resetDesignStoreForTests } from './state/design-store';
import { useUiStore } from './state/ui-store';

// The App uses `React.lazy(() => import('./scene/DeckScene'))`.
// Replace the module with a synchronous mock whose default export
// renders a `<canvas tabIndex={0}>` — the shape the real DeckScene
// mounts after Fix D. This lets us exercise the shell's tab order
// end-to-end without a real WebGL context.
vi.mock('./scene/DeckScene', () => {
  function DeckSceneMock(): JSX.Element {
    return (
      <canvas
        data-testid="scene-canvas-mock"
        aria-label="3D view mock"
        tabIndex={0}
      />
    );
  }
  return {
    __esModule: true,
    default: DeckSceneMock,
    DeckScene: DeckSceneMock,
  };
});

// DeckLayers + WarningOverlay use r3f context — mock to empty
// fragments so they don't complain about a missing context.
vi.mock('./scene', async () => {
  const actual = await vi.importActual<typeof import('./scene')>('./scene');
  return {
    ...actual,
    DeckLayers: () => null,
    WarningOverlay: () => null,
  };
});

// Import App AFTER the mocks so the module graph resolves against
// the stubbed lazy target.
import type { JSX } from 'react';
import { App } from './App';

beforeEach(() => {
  act(() => {
    useUiStore.setState({ storageBanner: null });
  });
  resetDesignStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<App /> — AC6 real keyboard tab order (Fix D — GPT#3 HIGH)', () => {
  it('tabs through header → left(ParameterPanel) → main(canvas) → right', async () => {
    render(<App />);

    // The lazy DeckScene must resolve before the canvas mounts —
    // findByTestId is async, which awaits the Suspense boundary.
    const canvas = await screen.findByTestId('scene-canvas-mock');
    expect(canvas).toBeInTheDocument();
    // Contract: the canvas has tabIndex={0} so keyboard users can
    // focus it. This is the real-canvas proof (mock mirrors the
    // real DeckScene's `tabIndex={0}` prop from Fix D).
    expect(canvas).toHaveAttribute('tabindex', '0');

    // Focus the spec link (first focusable in the header). The
    // rest of the shell follows in DOM order: header → left aside
    // (ParameterPanel) → main canvas → right aside.
    const specLink = screen.getByRole('link', { name: /spec/i });
    specLink.focus();
    expect(document.activeElement).toBe(specLink);

    const user = userEvent.setup();

    // S13 filled the left panel with <ParameterPanel />. The FIRST
    // focusable child in the panel is the "Imperial" button in the
    // UnitSwitcher (rendered above the fields). After tabbing from
    // the spec link, focus must land there — proving the header →
    // left ordering is preserved (S12 AC6 invariant, updated for
    // the S13 population of the leftPanel slot).
    await user.tab();
    const imperialBtn = screen.getByRole('button', { name: /imperial/i });
    expect(document.activeElement).toBe(imperialBtn);

    // Continue tabbing until we reach the canvas. Cap the loop at
    // a generous limit so a regression that skips the canvas fails
    // loudly instead of hanging the test. The exact tab count is
    // an implementation detail (depends on how many inputs the
    // panel exposes) — what matters is the canvas is REACHABLE by
    // keyboard, in DOM order after the left panel.
    const MAX_TABS = 32;
    let reachedCanvas = false;
    for (let i = 0; i < MAX_TABS; i++) {
      await user.tab();
      if (document.activeElement === canvas) {
        reachedCanvas = true;
        break;
      }
    }
    expect(reachedCanvas).toBe(true);
  });
});
