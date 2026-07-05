/**
 * `src/scene/layers/BlockingLayer.tsx` — the S22 blocking-mesh
 * layer (Epic 2 / FR-029).
 *
 * ## S26 FIX #6 (review-gate) — dormant
 *
 * S26 removed the floating "blocking between beams" concept: the
 * new floating layout (`floating-layout.ts`) emits ZERO members
 * with `kind === 'blocking'`, and no other layout produces them
 * either. The user-visible checkbox toggled an always-empty layer
 * (misleading). This component is kept as a DORMANT file — no
 * user-visible wiring, no LayerVisibility key, no toggle — so a
 * future "blocking between joists" (mid-joist noggins for lateral
 * bracing) feature can re-attach it cheaply by:
 *
 *   1. Re-adding `blocking: boolean` to `LayerVisibility`
 *      (`state/ui-store.ts`) + the two `ALL_LAYERS_*` frozen
 *      defaults.
 *   2. Re-adding `{ key: 'blocking', label: 'Blocking' }` to
 *      `LAYER_ITEMS` (`ui/layer-toggle-items.ts`).
 *   3. Restoring `<BlockingLayer />` to `scene/layers/DeckLayers.tsx`.
 *   4. Replacing the body below with the previous
 *      `<KindLayer kind="blocking" visibilityKey="blocking" />`.
 *
 * Rationale for keeping the file: the `blocking` `MemberKind`, the
 * `part-color` mapping, and the plan-view rendering (`PlanView2D`)
 * still exist and the ticket owner did NOT delete them. A dormant
 * component preserves the full re-attachment path in ONE place.
 */
import type { JSX } from 'react';

export function BlockingLayer(): JSX.Element | null {
  return null;
}
