/**
 * Unit tests for `src/scene/WebGLFallback.tsx`.
 *
 * ## AC5 — user-facing fallback content
 *
 * The AC5 message text is copy-pinned by the ticket ("Your browser
 * does not support WebGL 2. Please upgrade to the latest Chrome,
 * Edge, Firefox, or Safari."). Any wording drift will break the QA
 * checklist and — more importantly — leave users with no actionable
 * instructions. These tests LOCK the exact copy.
 *
 * ## Why a `role='alert'` / `role='status'` matters (WCAG 2.2)
 *
 * The 3D canvas has no accessible substitute in the fallback path,
 * so the fallback element itself must be discoverable by assistive
 * tech. We assert a landmark role + accessible text.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WebGLFallback, WEBGL_FALLBACK_MESSAGE } from './WebGLFallback';

describe('WebGLFallback', () => {
  it('AC5: exports the copy-pinned message (single source of truth)', () => {
    // Constants-first for the copy so DeckScene / analytics / QA
    // Playwright fixtures can grep-import the exact string rather
    // than duplicating it.
    expect(WEBGL_FALLBACK_MESSAGE).toBe(
      'Your browser does not support WebGL 2. Please upgrade to the latest Chrome, Edge, Firefox, or Safari.',
    );
  });

  it('AC5: renders the message text to the DOM', () => {
    render(<WebGLFallback />);
    expect(screen.getByText(WEBGL_FALLBACK_MESSAGE)).toBeInTheDocument();
  });

  it('exposes an ARIA alert role so screen readers surface the failure', () => {
    render(<WebGLFallback />);
    // `role="alert"` is one of two ARIA live-region roles the WCAG
    // 2.2 guidance calls out for "an error prevented the user's task
    // from completing". Combined with the message text, an SR user
    // gets the same information as a sighted user.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(WEBGL_FALLBACK_MESSAGE);
  });

  it('forwards a `className` prop so the parent can position it', () => {
    // The AC5 fallback replaces the <Canvas> in the DeckScene DOM —
    // passing through the `className` lets the parent apply the same
    // layout box (e.g., `flex: 1`, `min-height: 400px`) it would give
    // the canvas.
    render(<WebGLFallback className="scene-fallback" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('scene-fallback');
  });
});
