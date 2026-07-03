/**
 * Unit tests for `src/ui/SceneErrorBoundary.tsx`.
 *
 * ## Coverage map (S12 pair-fix iter 1 — Fix B)
 *
 *   1. Happy path — no throw, children render, no fallback.
 *   2. Sad path — a child throws → the fallback renders with
 *      the pinned title/body + a reload button.
 *   3. Trapping — the error does not escape the boundary
 *      (a sibling component outside the boundary keeps
 *      rendering).
 *   4. Reload — clicking the reload button calls
 *      `window.location.reload()`.
 *   5. onError callback — the boundary invokes the optional
 *      hook with the caught error.
 *
 * ## jsdom notes
 *
 * React logs "The above error occurred in the <X> component" to
 * `console.error` when an error boundary catches. That output is
 * expected + noisy; every test that intentionally throws stubs
 * `console.error` to keep the test log readable.
 *
 * `window.location.reload` is non-configurable in jsdom; the
 * component uses the exported {@link reloadPage} helper as an
 * indirection so tests can spy on it without touching `location`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';

import {
  SCENE_ERROR_BODY,
  SCENE_ERROR_RELOAD_LABEL,
  SCENE_ERROR_TITLE,
  SceneErrorBoundary,
} from './SceneErrorBoundary';

// A tiny helper: a component that unconditionally throws when
// rendered. The `useEffect(() => { throw … })` pattern doesn't
// work for error boundaries (React catches only errors thrown
// during render); throwing directly inside the function body is
// the canonical way to test boundaries.
function Boom({ message = 'boom' }: { message?: string }): JSX.Element {
  throw new Error(message);
}

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  // React logs the caught error to console.error even when a
  // boundary swallows it — silence for test-log hygiene.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('SceneErrorBoundary — happy path', () => {
  it('renders children when nothing throws', () => {
    render(
      <SceneErrorBoundary>
        <p data-testid="child">Hello</p>
      </SceneErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('does NOT render the fallback title when children are fine', () => {
    render(
      <SceneErrorBoundary>
        <p>ok</p>
      </SceneErrorBoundary>,
    );
    expect(screen.queryByText(SCENE_ERROR_TITLE)).not.toBeInTheDocument();
  });
});

describe('SceneErrorBoundary — sad path (Fix B — GPT#2 HIGH)', () => {
  it('renders the fallback title + body + reload button when a child throws', () => {
    render(
      <SceneErrorBoundary>
        <Boom message="scene chunk load failed" />
      </SceneErrorBoundary>,
    );
    expect(screen.getByText(SCENE_ERROR_TITLE)).toBeInTheDocument();
    expect(screen.getByText(SCENE_ERROR_BODY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SCENE_ERROR_RELOAD_LABEL })).toBeInTheDocument();
  });

  it('uses role="alert" so screen readers announce the fallback', () => {
    render(
      <SceneErrorBoundary>
        <Boom />
      </SceneErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('lets siblings OUTSIDE the boundary keep rendering (Fix B trapping guarantee)', () => {
    // This is the critical test: BEFORE Fix B, a chunk-load error
    // in the scene would unmount the WHOLE app, losing the
    // disclaimer + shell + panels. The boundary MUST trap so
    // sibling nodes stay mounted.
    render(
      <div>
        <p data-testid="disclaimer-stub">Non-dismissable disclaimer</p>
        <SceneErrorBoundary>
          <Boom />
        </SceneErrorBoundary>
        <p data-testid="left-panel-stub">Left panel</p>
      </div>,
    );
    expect(screen.getByTestId('disclaimer-stub')).toBeInTheDocument();
    expect(screen.getByTestId('left-panel-stub')).toBeInTheDocument();
    expect(screen.getByText(SCENE_ERROR_TITLE)).toBeInTheDocument();
  });

  it('invokes onError callback with the caught error', () => {
    const onError = vi.fn();
    render(
      <SceneErrorBoundary onError={onError}>
        <Boom message="specific message" />
      </SceneErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    const firstCall = onError.mock.calls[0] as [unknown, unknown];
    const errArg = firstCall[0];
    expect(errArg).toBeInstanceOf(Error);
    expect((errArg as Error).message).toBe('specific message');
  });

  it('honors fallbackTitle prop override', () => {
    render(
      <SceneErrorBoundary fallbackTitle="Custom title">
        <Boom />
      </SceneErrorBoundary>,
    );
    expect(screen.getByText('Custom title')).toBeInTheDocument();
    expect(screen.queryByText(SCENE_ERROR_TITLE)).not.toBeInTheDocument();
  });
});

describe('SceneErrorBoundary — reload button', () => {
  it('clicking Reload page invokes window.location.reload()', async () => {
    // JSDOM's window.location.reload is not configurable, so
    // vi.spyOn(window.location, 'reload') throws "Cannot redefine
    // property: reload". The workaround: replace `window.location`
    // wholesale via vi.stubGlobal, then read the spy from the stub.
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', {
      ...window.location,
      reload: reloadSpy,
      assign: window.location.assign.bind(window.location),
      replace: window.location.replace.bind(window.location),
    });
    try {
      render(
        <SceneErrorBoundary>
          <Boom />
        </SceneErrorBoundary>,
      );
      await userEvent.click(screen.getByRole('button', { name: SCENE_ERROR_RELOAD_LABEL }));
      expect(reloadSpy).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
