/**
 * Unit tests for `src/scene/layers/JoistsLayer.tsx`.
 *
 * Delegates the AC1 / AC2 / AC3 / AC4 shared assertions to
 * `layer-suite.tsx`. Any joist-specific behaviour (there is none
 * in MVP — joists are treated as any other rectangular member)
 * would live here.
 */
import { JoistsLayer } from './JoistsLayer';
import { registerLayerSuite } from './__testing__/layer-suite';

registerLayerSuite({
  Layer: JoistsLayer,
  kind: 'joist',
  visibilityKey: 'joists',
  displayName: 'JoistsLayer',
});
