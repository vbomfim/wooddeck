/**
 * `src/scene/WebGLFallback.tsx` — the AC5 unsupported-browser message.
 *
 * ## Why a component (not just a string)
 *
 * Rendering a plain `<p>` from `DeckScene` would inline the copy in
 * one place — but the AC5 message is ALSO consumed by:
 *
 *   - the QA Playwright E2E (will grep-import `WEBGL_FALLBACK_MESSAGE`),
 *   - a possible analytics event (post-MVP),
 *   - screen-reader accessibility hooks (needs a stable landmark
 *     role — see WCAG note below).
 *
 * A dedicated component + exported constant gives every consumer a
 * single source of truth for both the DOM shape and the copy.
 *
 * ## WCAG 2.2 landmark
 *
 * The 3D canvas has no accessible substitute in the fallback path,
 * so the fallback element itself carries `role='alert'`. That is the
 * ARIA live-region role for "an error prevented the user's task from
 * completing" — an SR user gets the same information as a sighted
 * user without a page-scroll to a hidden banner.
 */
import type { JSX } from 'react';

/**
 * Ticket AC5 copy — pinned by contract. Any change here MUST be
 * mirrored in the S9 issue AC5 and QA E2E fixture.
 */
export const WEBGL_FALLBACK_MESSAGE =
  'Your browser does not support WebGL 2. Please upgrade to the latest Chrome, Edge, Firefox, or Safari.';

/**
 * Props for {@link WebGLFallback}. `className` is optional and
 * forwarded to the root element so the DeckScene / AppShell can
 * position the fallback in the same box the canvas would occupy.
 */
export interface WebGLFallbackProps {
  readonly className?: string;
}

/**
 * Renders the AC5 message inside a `role="alert"` element that
 * assistive technology surfaces immediately on mount.
 */
export function WebGLFallback({ className }: WebGLFallbackProps): JSX.Element {
  return (
    <div role="alert" className={className}>
      {WEBGL_FALLBACK_MESSAGE}
    </div>
  );
}
