/**
 * `src/scene/layers/BlockingLayer.tsx` — the S22 blocking-mesh
 * layer (Epic 2 / FR-029).
 *
 * ## Responsibility (single)
 *
 * Render every `LayoutMember` with `kind === 'blocking'` as a
 * {@link BoxMember} inside a `<group visible>` bound to
 * `useUiStore(s => s.layerVisibility.blocking)`. Blocking members
 * are short lumber blocks between beams (or between joists) —
 * they carry a `{kind:'lumber', ...}` material, so the standard
 * `KindLayer` delegation pattern applies unchanged.
 *
 * ## Why this file is one line
 *
 * See `JoistsLayer` / `BeamsLayer` — every kind-scoped layer whose
 * members map 1-to-1 to a `BoxMember` delegates to the shared
 * `KindLayer` helper. Only `BlocksLayer` needs a bespoke component
 * (different geometry per productId); `BlockingLayer` looks and
 * behaves exactly like the framing layers.
 */
import type { JSX } from 'react';

import { KindLayer } from './shared/kind-layer';

export function BlockingLayer(): JSX.Element {
  return <KindLayer kind="blocking" visibilityKey="blocking" />;
}
