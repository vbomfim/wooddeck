/**
 * `src/scene/layers/BeamsLayer.tsx` — the beam-mesh layer.
 *
 * See {@link JoistsLayer} for the pattern rationale — this file
 * is the beam-kind sibling.
 */
import type { JSX } from 'react';

import { KindLayer } from './shared/kind-layer';

export function BeamsLayer(): JSX.Element {
  return <KindLayer kind="beam" visibilityKey="beams" />;
}
