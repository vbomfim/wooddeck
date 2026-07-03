/**
 * `src/scene/layers/DeckingLayer.tsx` — the decking-board layer.
 *
 * ## Naming discrepancy: MemberKind vs. visibility key
 *
 * The domain uses `MemberKind = "board"` for a decking board
 * (see `domain/model.ts`); the ui-store uses
 * `LayerVisibility.decking` (user-facing vocabulary — the panel
 * label says "Decking", not "Boards"). See `state/ui-store.ts`
 * docstring for the vocabulary decision. `<KindLayer>` takes
 * both arguments explicitly so the mapping is loud.
 *
 * ## Why decking is the FIRST layer users toggle
 *
 * "Peel back the layers" starts with hiding the top boards — the
 * exposed framing (joists + beams + posts + footings) is the
 * pedagogical payoff. This layer's `<group visible>` toggle is
 * the single most-exercised interaction of the whole product.
 *
 * See {@link JoistsLayer} for the general pattern rationale.
 */
import type { JSX } from 'react';

import { KindLayer } from './shared/kind-layer';

export function DeckingLayer(): JSX.Element {
  return <KindLayer kind="board" visibilityKey="decking" />;
}
