/**
 * Unit tests for `src/scene/layers/BlockingLayer.tsx` — the layer
 * for solid noggins between joists (issue #72; IRC R502.7).
 *
 * ## History
 *
 * Pre-S26 this file registered the shared `layer-suite` for
 * `visibilityKey: 'blocking'`. S26 FIX #6 removed the toggle
 * because the layout emitted zero blocking members (misleading
 * dead UI). Under issue #72 the layout pipelines now emit
 * blocking again — via the shared `layoutBlockingBetweenJoists`
 * helper — and this test file re-registers the shared suite so
 * BlockingLayer is validated exactly like every sibling
 * `KindLayer` delegate (e.g. BeamsLayer, JoistsLayer).
 */
import { BlockingLayer } from './BlockingLayer';
import { registerLayerSuite } from './__testing__/layer-suite';

registerLayerSuite({
  Layer: BlockingLayer,
  kind: 'blocking',
  visibilityKey: 'blocking',
  displayName: 'BlockingLayer',
});
