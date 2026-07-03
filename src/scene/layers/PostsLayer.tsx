/**
 * `src/scene/layers/PostsLayer.tsx` — the post-mesh layer.
 *
 * See {@link JoistsLayer} for the pattern rationale — this file
 * is the post-kind sibling.
 */
import type { JSX } from 'react';

import { KindLayer } from './shared/kind-layer';

export function PostsLayer(): JSX.Element {
  return <KindLayer kind="post" visibilityKey="posts" />;
}
