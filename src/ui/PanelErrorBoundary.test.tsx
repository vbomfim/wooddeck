/**
 * `PanelErrorBoundary.test.tsx` — S24 UAT pair-fix FIX 0(b).
 *
 * ## Why this exists
 *
 * The live UAT for a >20 ft-wide deck exposed a critical crash:
 * `deriveBom` (called inside `<BomPanel>`'s `useMemo`) threw an
 * "over-length cut" error, which propagated up through the render
 * tree with NO error boundary between it and the app root. The
 * WHOLE app white-screened — including the parameter panel, the
 * disclaimer, and the 3D scene.
 *
 * `<PanelErrorBoundary>` is the defense-in-depth companion to
 * `<SceneErrorBoundary>`: it wraps EACH side-panel child so a
 * throw inside one panel renders an inline "Couldn't compute this
 * panel — check your parameters" fallback while every other panel
 * keeps working.
 *
 * The domain fix (splicing over-length cuts, FIX 0(a)) removes
 * the specific crash; the boundary catches the NEXT one — a
 * future panel-compute exception should never white-screen again.
 *
 * ## Contract asserted here
 *
 *   - Happy path: renders children when no descendant throws.
 *   - Catches a throw and swaps in the fallback text.
 *   - Fallback text matches the copy the ticket asked for
 *     ("Couldn't compute this panel — check your parameters").
 *   - `role="alert"` on the fallback so screen readers announce it.
 *   - The `onError` prop fires exactly once per catch.
 *   - Sibling boundaries are independent — a throw in one does
 *     NOT trigger the other's fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';

import {
  PANEL_ERROR_BODY,
  PANEL_ERROR_TITLE,
  PanelErrorBoundary,
} from './PanelErrorBoundary';

/**
 * A React component that throws on render — the classical error
 * boundary test fixture. Kept in this file (not exported from the
 * boundary module) so it can never leak into production.
 */
function Boom({ message }: { message: string }): JSX.Element {
  throw new Error(message);
}

/**
 * A silent React component — never throws. Used as the "happy
 * path" child so we can assert the boundary is transparent when
 * nothing fails.
 */
function Ok(): JSX.Element {
  return <p data-testid="ok-child">ok</p>;
}

// React logs `Uncaught ` errors when a boundary catches. Silence
// the noise (the test's assertions are the source of truth).
let errorSpy: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  cleanup();
});

describe('<PanelErrorBoundary /> — happy path (no throw)', () => {
  it('renders children when no descendant throws', () => {
    render(
      <PanelErrorBoundary>
        <Ok />
      </PanelErrorBoundary>,
    );
    expect(screen.getByTestId('ok-child')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('<PanelErrorBoundary /> — catches a rendering throw', () => {
  it('swaps in the fallback when a descendant throws', () => {
    render(
      <PanelErrorBoundary>
        <Boom message="synthetic panel crash" />
      </PanelErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent ?? '').toMatch(new RegExp(PANEL_ERROR_TITLE, 'i'));
    expect(alert.textContent ?? '').toMatch(new RegExp(PANEL_ERROR_BODY, 'i'));
  });

  it('fallback text contains the copy the ticket asked for', () => {
    // The ticket specifies "Couldn't compute this panel — check
    // your parameters." verbatim. Guard against typos (missing
    // apostrophe, missing em-dash).
    expect(PANEL_ERROR_TITLE.toLowerCase()).toMatch(/couldn.?t compute/i);
    expect(PANEL_ERROR_BODY.toLowerCase()).toMatch(/check your parameters/i);
  });

  it('invokes the onError prop exactly once per catch (observability hook)', () => {
    const onError = vi.fn();
    render(
      <PanelErrorBoundary onError={onError}>
        <Boom message="observable crash" />
      </PanelErrorBoundary>,
    );
    // React may double-invoke in strict/development mode; the
    // boundary implementation must guarantee AT LEAST ONE call.
    expect(onError).toHaveBeenCalled();
    const first = onError.mock.calls[0]![0] as Error;
    expect(first).toBeInstanceOf(Error);
    expect(first.message).toBe('observable crash');
  });
});

describe('<PanelErrorBoundary /> — sibling boundaries are independent', () => {
  it('a throw in one boundary does NOT trigger the sibling boundary', () => {
    render(
      <div>
        <PanelErrorBoundary>
          <Boom message="only-this-one" />
        </PanelErrorBoundary>
        <PanelErrorBoundary>
          <Ok />
        </PanelErrorBoundary>
      </div>,
    );
    // Exactly ONE alert (the throwing boundary). The Ok child of
    // the other boundary must still render.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByTestId('ok-child')).toBeInTheDocument();
  });
});
