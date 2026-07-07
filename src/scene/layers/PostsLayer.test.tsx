/**
 * Unit tests for `src/scene/layers/PostsLayer.tsx`.
 * See `layer-suite.tsx` for the shared AC1–AC4 assertions.
 */
import { PostsLayer } from './PostsLayer';
import { registerLayerSuite } from './__testing__/layer-suite';

registerLayerSuite({
  Layer: PostsLayer,
  kind: 'post',
  visibilityKey: 'posts',
  displayName: 'PostsLayer',
});
