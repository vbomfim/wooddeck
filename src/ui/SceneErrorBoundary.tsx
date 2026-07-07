/**
 * `src/ui/SceneErrorBoundary.tsx` — React error boundary for the
 * lazy-loaded 3D scene subtree.
 *
 * ## Why (S12 pair-fix iter 1 — Fix B / GPT#2 HIGH)
 *
 * `React.lazy(() => import('./scene/DeckScene'))` fires a dynamic
 * import at first mount. `<Suspense>` handles the loading state,
 * but does NOT handle chunk-load ERRORS: a network hiccup, a
 * missing CDN asset, or an exception thrown inside the scene tree
 * would tear down the WHOLE app — losing the disclaimer, the shell
 * landmarks, and the side panels. That's a WCAG regression (users
 * on flaky networks lose all legal-liability signage) AND a
 * production incident risk (a bad r3f release could brick every
 * session).
 *
 * `<SceneErrorBoundary>` wraps the scene subtree with a classical
 * React error boundary. When any descendant throws (chunk load,
 * runtime three.js exception, r3f internal error, …), the
 * boundary swaps in a plain-text fallback with a Reload button.
 * The AppShell, disclaimer, header, and side panels remain fully
 * usable — the user knows the 3D view failed and how to recover.
 *
 * ## Why a class component
 *
 * React 19 STILL requires class components for error boundaries
 * (`static getDerivedStateFromError` + `componentDidCatch`).
 * There is no `useErrorBoundary` hook in stock React; using a
 * third-party wrapper would drag `react-error-boundary` into the
 * shell chunk. A tiny local class is cleaner.
 *
 * ## Boundary
 *
 * Pure UI — depends only on `react`. Does NOT import from
 * `scene/`, `state/`, `application/`, `persistence/`, or `domain/`.
 * A future test can wrap ANY throwing subtree with it; there's
 * nothing scene-specific in the boundary itself (the copy is
 * scene-flavored, but that's a prop-shaped concern — see
 * {@link SceneErrorBoundaryProps.fallbackTitle}).
 */
import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

import { reloadPage } from './reload-page';
import './styles/scene-error-boundary.css';

/**
 * The exact copy the boundary renders. Exported as a constant so
 * the tests can grep-import it rather than duplicating the string,
 * and so a future translation layer has one place to hook.
 */
export const SCENE_ERROR_TITLE = '3D view failed to load';
export const SCENE_ERROR_BODY =
  'Please reload the page. If the problem persists, check your network connection or try a different browser.';
export const SCENE_ERROR_RELOAD_LABEL = 'Reload page';

export interface SceneErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Optional override for the fallback title. Defaults to the
   * scene-flavored {@link SCENE_ERROR_TITLE}. Tests use this to
   * assert the boundary is a general-purpose component; product
   * copy sticks with the default.
   */
  readonly fallbackTitle?: string;
  /**
   * Optional callback invoked whenever the boundary catches. The
   * tests use this to assert the boundary trapped the error
   * (rather than letting it escape). In production it can log to
   * a monitoring hook.
   */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface SceneErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
}

/**
 * NOTE: `reloadPage` lives in `./reload-page` — a separate module
 * so both this file and `<ContextLostBanner>` can share the same
 * reload implementation without an inter-component import edge,
 * AND without breaking the react-refresh HMR rule that forbids
 * a component file from also exporting non-component functions.
 * Consumers should `import { reloadPage } from '../ui'` (barrel
 * re-exports from ./reload-page) or import directly.
 */

export class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  public override state: SceneErrorBoundaryState = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): SceneErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Emit a wooddeck-scoped console.error so ops can grep the
    // production log. The message includes the component stack
    // (info.componentStack) to help pinpoint the offending node.
    console.error(
      '[wooddeck:ui] SceneErrorBoundary caught a rendering error in the scene subtree.',
      { error, componentStack: info.componentStack },
    );
    this.props.onError?.(error, info);
  }

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <SceneErrorFallback
        title={this.props.fallbackTitle ?? SCENE_ERROR_TITLE}
        body={SCENE_ERROR_BODY}
      />
    );
  }
}

interface SceneErrorFallbackProps {
  readonly title: string;
  readonly body: string;
}

/**
 * The visible fallback UI rendered by the error boundary. Split
 * from the class component so the class stays a THIN wrapper
 * around `getDerivedStateFromError` + `componentDidCatch` — the
 * only two APIs React demands as class methods.
 *
 * `role="alert"` makes screen readers announce the fallback the
 * moment it renders (a chunk load failure is an important state
 * change the user did not initiate).
 */
function SceneErrorFallback({ title, body }: SceneErrorFallbackProps): JSX.Element {
  return (
    <div className="wd-scene-error" role="alert">
      <h3 className="wd-scene-error__title">{title}</h3>
      <p className="wd-scene-error__body">{body}</p>
      <button type="button" className="wd-scene-error__reload" onClick={reloadPage}>
        {SCENE_ERROR_RELOAD_LABEL}
      </button>
    </div>
  );
}
