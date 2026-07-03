/**
 * Unit tests for `src/scene/layers/BeamsLayer.tsx`.
 * See `layer-suite.tsx` for the shared AC1–AC4 assertions.
 */
import { BeamsLayer } from './BeamsLayer';
import { registerLayerSuite } from './__testing__/layer-suite';

registerLayerSuite({
  Layer: BeamsLayer,
  kind: 'beam',
  visibilityKey: 'beams',
  displayName: 'BeamsLayer',
});
