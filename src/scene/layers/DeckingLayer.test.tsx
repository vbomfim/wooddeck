/**
 * Unit tests for `src/scene/layers/DeckingLayer.tsx`.
 *
 * Delegates to `layer-suite.tsx` for the shared AC1–AC4 assertions.
 * Decking is the layer users toggle FIRST in the "see underneath"
 * flow (hide decking → framing visible). Uses `kind === "board"`
 * per `domain/model.ts` `MemberKind` — the visibility key is
 * `"decking"` (user-facing vocabulary; see ui-store.ts docstring).
 */
import { DeckingLayer } from './DeckingLayer';
import { registerLayerSuite } from './__testing__/layer-suite';

registerLayerSuite({
  Layer: DeckingLayer,
  kind: 'board',
  visibilityKey: 'decking',
  displayName: 'DeckingLayer',
});
