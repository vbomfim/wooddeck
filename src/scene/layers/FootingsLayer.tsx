/**
 * `src/scene/layers/FootingsLayer.tsx` — the footing-mesh layer.
 *
 * ## Footings render as cubes
 *
 * Real-world footings are cylindrical concrete piers (Sonotube).
 * MVP renders them as cubes — the {@link BoxMember} box primitive
 * suffices for the "peel back the layers" UX (§16 out-of-scope
 * calls out cylindrical geometry as post-MVP). The domain model
 * already stores footings with `kind === "footing"` and a
 * square-cross-section `size`; the visual approximation is
 * intentional per issue #11 §2.
 *
 * See {@link JoistsLayer} for the general pattern rationale.
 */
import type { JSX } from 'react';

import { KindLayer } from './shared/kind-layer';

export function FootingsLayer(): JSX.Element {
  return <KindLayer kind="footing" visibilityKey="footings" />;
}
