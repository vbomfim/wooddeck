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
 *                             element that carries the same aria-label
 *                             and `className`, then assert the
 *                             wrapper element. Real Canvas mounts +
 *                             pixel diffs are QA E2E scope (S9 §18).
 *
 * ## Coverage map
 *
 *   AC1 canvas element is present + has aria-label (fallback + real)
 *   AC5 WebGL fallback message when the detector returns false
 *   AC10 aria-label copy matches the ticket §10 pinned wording
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { DECKSCENE_ARIA_LABEL } from './DeckScene';
import { WEBGL_FALLBACK_MESSAGE } from './WebGLFallback';

// ---- module mocks ---------------------------------------------------------
//
// r3f's real <Canvas> creates a DOM <canvas> and calls WebGLRenderer,
// which throws in jsdom (no GL implementation). Replacing it with a
// plain DOM stub lets us assert the DeckScene's OUTER shape — the
// aria-label, the class name, the fallback branching — without paying
// the price of a real Canvas mount. drei's OrbitControls and any
// three-only children the rig mounts are inert under this stub.
vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber');
  return {
    ...actual,
    Canvas: ({
      children,
      className,
      'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode;
      className?: string;
      'aria-label'?: string;
    }) => (
      <div data-testid="canvas-mock" className={className} aria-label={ariaLabel} role="img">
        {/* Children (lighting, camera rig, layer mount point) are not
            rendered here — they need the real r3f context. Structural
            assertions for those subtrees live in their own
            test-renderer tests (lighting.test.tsx, CameraRig.test.tsx). */}
        {typeof children === 'function' ? null : null}
      </div>
    ),
  };
});

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

  it('forwards a `className` prop to the Canvas element', () => {
    // The AppShell (S12) will position the scene via a CSS layout
    // class — DeckScene must not hard-code its own visual container.
    render(<DeckScene className="deck-viewport" />);
    expect(screen.getByTestId('canvas-mock')).toHaveClass('deck-viewport');
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
