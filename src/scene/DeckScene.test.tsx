/**
 * Unit tests for `src/scene/DeckScene.tsx`.
 *
 * ## Testing strategy — the two-path split
 *
 * `<DeckScene>` has TWO mount branches:
 *
 *   1. WebGL 2 unavailable  → render `<WebGLFallback>`. Trivially
 *                             assertable with RTL (jsdom + testing-
 *                             library). We mock `isWebGL2Available`
 *                             through vitest module mocking.
 *   2. WebGL 2 available    → mount r3f `<Canvas>` + lighting + rig.
 *                             We can't actually MOUNT the r3f Canvas
 *                             in jsdom (no GL), so we mock the r3f
 *                             `<Canvas>` export to a wrapping DOM
 *                             element AND stub `<CameraRig>` +
 *                             `<SceneLighting>` (both need the r3f
 *                             context we've replaced). That lets the
 *                             mock render the OTHER children — the
 *                             S10 layer-mount-point slot the
 *                             composition-root user passes in — so
 *                             a regression that DROPS `{children}`
 *                             from the Canvas is caught here (K).
 *
 * ## Coverage map
 *
 *   AC1  canvas element is present + has aria-label (fallback + real)
 *   AC5  WebGL fallback message when the detector returns false
 *   AC10 aria-label copy matches the pinned wording (updated per
 *        PR#29 pair-fix iter 1 — Fix J to be HONEST about the
 *        interactions the rig actually supports)
 *   K    passed-in children are forwarded to the Canvas mount point
 *   G    routes state through granular hooks (mocking useUiStore
 *        directly is fine — the hooks re-export those under the hood)
 */
import { describe, expect, it, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { DECKSCENE_ARIA_LABEL } from './DeckScene';
import { WEBGL_FALLBACK_MESSAGE } from './WebGLFallback';

// ---- module mocks ---------------------------------------------------------
//
// r3f's real <Canvas> creates a DOM <canvas> and calls WebGLRenderer,
// which throws in jsdom (no GL implementation). Replacing it with a
// plain DOM stub lets us assert the DeckScene's OUTER shape — the
// aria-label, the class name, the fallback branching, AND the S10
// layer-mount-point children forwarding — without paying the price
// of a real Canvas mount.
//
// PR#29 pair-fix iter 1 — Fix K: the Canvas mock now RENDERS
// `{children}` (was `{null}`) so a regression that drops the layer
// slot forwarding is caught by the "forwards children" test below.
// The scene-internal children (SceneLighting + CameraRig) are
// SEPARATELY mocked to `() => null` so they don't try to consume
// the (missing) r3f context.
vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber');
  return {
    ...actual,
    Canvas: ({
      children,
      className,
      'aria-label': ariaLabel,
      tabIndex,
    }: {
      children?: React.ReactNode;
      className?: string;
      'aria-label'?: string;
      tabIndex?: number;
    }) => (
      <div
        data-testid="canvas-mock"
        className={className}
        aria-label={ariaLabel}
        role="img"
        tabIndex={tabIndex}
      >
        {children}
      </div>
    ),
  };
});

// CameraRig + SceneLighting call useThree() / useFrame(), which need
// the r3f reconciler context we've replaced above. Stubbing them out
// keeps DeckScene tests focused on composition + user-children slot;
// the scene-graph structure of the rig / lighting is tested in
// CameraRig.test.tsx / lighting.test.tsx.
vi.mock('./CameraRig', () => ({
  CameraRig: () => null,
}));
vi.mock('./lighting', () => ({
  SceneLighting: () => null,
}));

// WebGL detection is toggled per-test via vi.mocked below.
vi.mock('./webgl-support', () => ({
  isWebGL2Available: vi.fn(() => true),
}));

// Pull the mocked module AFTER the vi.mock declaration so `.mockReturnValueOnce`
// works on the exported function.
import { isWebGL2Available } from './webgl-support';
import { DeckScene } from './DeckScene';

afterEach(() => {
  cleanup();
  vi.mocked(isWebGL2Available).mockReset();
  vi.mocked(isWebGL2Available).mockReturnValue(true);
});

describe('<DeckScene /> — WebGL 2 supported path', () => {
  it('AC1: mounts a canvas element (mocked) without throwing', () => {
    render(<DeckScene />);
    expect(screen.getByTestId('canvas-mock')).toBeInTheDocument();
  });

  it('AC10: the canvas exposes the ticket-pinned aria-label', () => {
    render(<DeckScene />);
    // Assert against the exported constant AND spot-check the copy —
    // the constant is the single source of truth, but a wording drift
    // in the constant itself must also fail-loud.
    expect(DECKSCENE_ARIA_LABEL).toContain('3D view of deck design');
    expect(DECKSCENE_ARIA_LABEL).toContain('preset view buttons');
    const canvas = screen.getByTestId('canvas-mock');
    expect(canvas).toHaveAttribute('aria-label', DECKSCENE_ARIA_LABEL);
  });

  it('AC10 (Fix J): aria-label mentions ONLY interactions actually implemented (no keyboard-orbit promise)', () => {
    // GPT review flagged: the original ticket §10 copy promised
    // "use arrow keys or WASD to orbit, +/- to zoom" but the rig
    // does not implement keyboard orbit. Accessibility copy must
    // not promise controls that don't exist. The pinned constant
    // now mentions ONLY the interactions the code actually supports.
    expect(DECKSCENE_ARIA_LABEL).not.toMatch(/arrow keys/i);
    expect(DECKSCENE_ARIA_LABEL).not.toMatch(/wasd/i);
    // AND it explicitly names the ACTUAL interactions — drag orbit,
    // scroll zoom, preset buttons — so screen-reader users learn how
    // to use what does work.
    expect(DECKSCENE_ARIA_LABEL).toMatch(/drag/i);
    expect(DECKSCENE_ARIA_LABEL).toMatch(/scroll/i);
  });

  it('forwards a `className` prop to the Canvas element', () => {
    // The AppShell (S12) will position the scene via a CSS layout
    // class — DeckScene must not hard-code its own visual container.
    render(<DeckScene className="deck-viewport" />);
    expect(screen.getByTestId('canvas-mock')).toHaveClass('deck-viewport');
  });

  // PR#29 pair-fix iter 1 — Fix K. The S10 layer components will
  // mount as children of `<DeckScene>` via the `children` slot. If
  // the Canvas forwarding regresses (e.g., a maintainer accidentally
  // removes `{children}` from inside the Canvas JSX), S10's whole
  // deck geometry disappears silently. This test locks the contract.
  it('Fix K: forwards `children` into the Canvas mount point (S10 layer slot)', () => {
    render(
      <DeckScene>
        <div data-testid="layer-a">joists</div>
        <div data-testid="layer-b">decking</div>
      </DeckScene>,
    );
    const canvas = screen.getByTestId('canvas-mock');
    expect(canvas).toContainElement(screen.getByTestId('layer-a'));
    expect(canvas).toContainElement(screen.getByTestId('layer-b'));
  });

  // S12 pair-fix iter 1 — Fix D (AC6 real canvas focusability).
  // Before this fix, `<Canvas>` had an aria-label but NO tabIndex,
  // so keyboard users tabbed RIGHT PAST the 3D view. Add
  // tabIndex={0} to make the canvas part of the natural tab order.
  // This test locks the contract at the DeckScene level; the App
  // integration test (`App.test.tsx` "real tab order") asserts the
  // canvas is reachable end-to-end from the shell.
  it('Fix D: passes tabIndex={0} to the Canvas so it is keyboard-focusable (AC6)', () => {
    render(<DeckScene />);
    const canvas = screen.getByTestId('canvas-mock');
    expect(canvas).toHaveAttribute('tabindex', '0');
  });
});

describe('<DeckScene /> — AC5 WebGL 2 unavailable path', () => {
  it('renders the WebGLFallback message when the detector returns false', () => {
    vi.mocked(isWebGL2Available).mockReturnValue(false);
    render(<DeckScene />);
    expect(screen.getByRole('alert')).toHaveTextContent(WEBGL_FALLBACK_MESSAGE);
  });

  it('does NOT mount the mocked Canvas in the fallback path', () => {
    vi.mocked(isWebGL2Available).mockReturnValue(false);
    render(<DeckScene />);
    expect(screen.queryByTestId('canvas-mock')).not.toBeInTheDocument();
  });

  it('forwards `className` to the fallback element so the AppShell can position it', () => {
    // Symmetry with the Canvas path — AppShell layout must apply to
    // both branches so the fallback occupies the same box the canvas
    // would.
    vi.mocked(isWebGL2Available).mockReturnValue(false);
    render(<DeckScene className="deck-viewport" />);
    expect(screen.getByRole('alert')).toHaveClass('deck-viewport');
  });
});

describe('DeckScene module surface (lazy-import contract)', () => {
  it('exports DeckScene as a default export (React.lazy contract)', async () => {
    // The AppShell (S12) will lazy-load the scene chunk with
    // `React.lazy(() => import('./scene/DeckScene'))`. React.lazy
    // requires a MODULE with a default export whose value is the
    // component. This test locks that contract in place.
    const mod = await import('./DeckScene');
    expect(mod.default).toBe(DeckScene);
  });
});

// Silence known-noise "unrecognized in this browser" warnings that
// React emits when the mocked <Canvas> would receive r3f primitive
// children (it doesn't — CameraRig / SceneLighting are stubbed —
// but we keep this guard here in case a future test passes an
// r3f-primitive child directly).
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('is unrecognized in this browser')) return;
    originalConsoleError(...args);
  };
});
afterAll(() => {
  console.error = originalConsoleError;
});
