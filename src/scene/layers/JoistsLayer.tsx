/**
 * `src/scene/layers/JoistsLayer.tsx` — the joist-mesh layer.
 *
 * ## Responsibility (single)
 *
 * Render every `LayoutMember` with `kind === "joist"` as a
 * {@link BoxMember} inside a `<group visible>` bound to
 * `useUiStore(s => s.layerVisibility.joists)`.
 *
 * ## Rewritability contract
 *
 * The whole file is a delegation to `<KindLayer kind="joist"
 * visibilityKey="joists" />` — one call site, one line. Rewriting
 * this component from its interface (`() => JSX.Element` + the
 * frozen kind / visibility key mapping) needs the sibling
 * `shared/kind-layer.tsx` only.
 *
 * ## Boundary
 *
 * Imports: `react` (JSX type) and the local `./shared/kind-layer`
 * (which reads state via the state barrel). No domain/layout, no
 * ui/, no application/. Enforced by the dep-cruiser
 * `scene-allowlist` + `scene-no-domain-layout` rules and the
 * sibling `no-geometry-math.test.ts` grep.
 */
import type { JSX } from 'react';

import { KindLayer } from './shared/kind-layer';

export function JoistsLayer(): JSX.Element {
  return <KindLayer kind="joist" visibilityKey="joists" />;
}
