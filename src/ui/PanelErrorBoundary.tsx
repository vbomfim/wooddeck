/**
 * `src/ui/PanelErrorBoundary.tsx` — React error boundary for a
 * single side-panel subtree.
 *
 * ## Why (S24 UAT pair-fix — FIX 0(b))
 *
 * The live UAT for a >20 ft-wide deck exposed a critical crash:
 * `deriveBom` (called inside `<BomPanel>`'s render `useMemo`) threw
 * an "over-length cut" error, which propagated up through the whole
 * render tree with NO error boundary between it and the app root.
 * The result: a totally normal DIY deck size (24 ft) WHITE-SCREENED
 * the app — losing the parameter panel, the disclaimer landmark,
 * and the 3D scene.
 *
 * The domain-level fix (splicing over-length cuts, FIX 0(a)) removes
 * *that specific* crash. `<PanelErrorBoundary>` is the
 * defense-in-depth companion: it wraps EACH side-panel child so any
 * FUTURE panel-compute exception renders a graceful inline "Couldn't
 * compute this panel — check your parameters" fallback while every
 * other panel keeps working. A bug in one panel's derive function
 * must never brick the whole app again.
 *
 * ## Why a class component
 *
 * React 19 still requires class components for error boundaries
 * (`static getDerivedStateFromError` + `componentDidCatch`). There
 * is no `useErrorBoundary` hook in stock React. We deliberately do
 * NOT drag a library in (`react-error-boundary`) — a tiny local
 * class is cleaner and keeps the shell bundle lean.
 *
 * ## Why not reuse `<SceneErrorBoundary>`
 *
 * `<SceneErrorBoundary>` hardcodes scene-flavored body copy AND a
 * "Reload page" action. A panel that fails is NOT a page-level
 * failure — the user should adjust parameters, not reload. Two
 * small, single-purpose boundaries beat one Franken-boundary with
 * a mode flag.
 *
 * ## Boundary
 *
 * Pure UI — depends only on `react`. Does NOT import from `scene/`,
 * `state/`, `application/`, `persistence/`, or `domain/`. A test can
 * wrap any throwing subtree with it.
 */
import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

import './styles/panel-error-boundary.css';

/**
 * The exact copy the boundary renders. Exported as constants so
 * the tests can grep-import them rather than duplicating strings,
 * and so a future translation layer has one place to hook.
 *
 * Copy per S24 UAT pair-fix ticket: "Couldn't compute this panel —
 * check your parameters." Split into TITLE (short, headline) and
 * BODY (imperative next step) so the fallback matches the visual
 * hierarchy of the other side-panel error states.
 */
export const PANEL_ERROR_TITLE = "Couldn't compute this panel";
export const PANEL_ERROR_BODY = 'Check your parameters and try again.';

export interface PanelErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Optional callback invoked whenever the boundary catches. Tests
   * assert the boundary trapped the error (rather than letting it
   * escape). In production it can wire to a monitoring hook.
   */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface PanelErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  public override state: PanelErrorBoundaryState = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Emit a wooddeck-scoped console.error so ops can grep the
    // production log. Includes the component stack from React's
    // ErrorInfo so a future SRE can find the offending panel.
    console.error(
      '[wooddeck:ui] PanelErrorBoundary caught a rendering error in a side panel.',
      { error, componentStack: info.componentStack },
    );
    this.props.onError?.(error, info);
  }

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return <PanelErrorFallback title={PANEL_ERROR_TITLE} body={PANEL_ERROR_BODY} />;
  }
}

interface PanelErrorFallbackProps {
  readonly title: string;
  readonly body: string;
}

/**
 * The visible fallback UI. Split from the class component so the
 * class stays a THIN wrapper around React's two boundary APIs.
 *
 * `role="alert"` makes screen readers announce the fallback the
 * moment it renders (an unexpected panel failure is a state change
 * the user did not initiate — they need to hear about it).
 */
function PanelErrorFallback({ title, body }: PanelErrorFallbackProps): JSX.Element {
  return (
    <div className="wd-panel-error" role="alert">
      <p className="wd-panel-error__title">{title}</p>
      <p className="wd-panel-error__body">{body}</p>
    </div>
  );
}
