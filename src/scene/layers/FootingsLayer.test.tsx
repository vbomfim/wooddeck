/**
 * Unit tests for `src/scene/layers/FootingsLayer.tsx`.
 *
 * Delegates to `layer-suite.tsx` for the shared AC1–AC4 assertions.
 * Footings render as cubes in MVP even though they are physically
 * cylinders (§2 "Footings (short cylinders or cubes)"); this is a
 * conscious trade-off and does NOT change the BoxMember rendering
 * shape — so the shared suite covers everything we need.
 */
import { FootingsLayer } from './FootingsLayer';
import { registerLayerSuite } from './__testing__/layer-suite';

registerLayerSuite({
  Layer: FootingsLayer,
  kind: 'footing',
  visibilityKey: 'footings',
  displayName: 'FootingsLayer',
});
