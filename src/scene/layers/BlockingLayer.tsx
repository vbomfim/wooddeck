/**
 * `src/scene/layers/BlockingLayer.tsx` — the blocking-mesh layer
 * (issue #72 — solid noggins between joists per IRC R502.7).
 *
 * ## History
 *
 * S22 originally added a "blocking between beams" layer under
 * Epic 2 / FR-029. S26's floating rework removed that concept
 * (`floating-layout.ts` emitted zero `blocking` members) and
 * S26 FIX #6 made this component a dormant `return null` — kept as
 * a placeholder for the eventual "blocking between joists" story.
 *
 * ## Issue #72 — re-activated
 *
 * The layout pipelines now emit `blocking` `MemberKind` members
 * via the shared pure helper `layoutBlockingBetweenJoists`:
 *
 *   - Solid full-depth lumber noggins between adjacent joists.
 *   - ≥ 1 interior mid-span row, ≤ 8 ft o.c. (IRC R502.7.1).
 *   - Emitted by BOTH elevated and floating (Method A + Method B)
 *     pipelines.
 *
 * The component delegates to the shared `KindLayer` — same shape
 * as every sibling layer (e.g. {@link BeamsLayer},
 * {@link JoistsLayer}). Toggling `LayerVisibility.blocking`
 * hides/shows every blocking mesh in one place.
 */
import type { JSX } from 'react';

import { KindLayer } from './shared/kind-layer';

export function BlockingLayer(): JSX.Element {
  return <KindLayer kind="blocking" visibilityKey="blocking" />;
}
