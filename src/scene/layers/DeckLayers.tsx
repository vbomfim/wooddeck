/**
 * `src/scene/layers/DeckLayers.tsx` — the convenience bundle that
 * mounts all six layer components in a fixed, spec-pinned order.
 *
 * ## Composition shape for S12
 *
 * S12's `AppShell` drops this bundle inside the DeckScene:
 *
 *     <DeckScene>
 *       <DeckLayers />
 *     </DeckScene>
 *
 * S12 does NOT need to import the individual layer components —
 * this bundle owns the ordering and the six mounts. If a future
 * story adds a seventh layer (e.g. warning halo overlay in S11),
 * update `DECK_LAYER_ORDER` + this component in the same commit
 * and every downstream consumer picks it up transparently.
 *
 * ## Fixed layer order — AC8 raycast picking hygiene
 *
 * The six layers mount in this order (bottom of the physical
 * stack first, top last):
 *
 *   1. environment  — ground plane at y = 0
 *   2. footings     — concrete piers, extend into -y
 *   3. posts        — vertical members from footing to beam
 *   4. beams        — horizontal supports carrying joists
 *   5. joists       — floor joists carrying decking
 *   6. decking      — top boards, the visually top-most primitives
 *
 * ## Rationale for THIS order (not alphabetical, not domain-kind
 * enum order)
 *
 * The order matches the physical stack of a real deck. Consequences:
 *
 *   - A top-down raycast from the ISO camera hits `decking` FIRST
 *     because it is highest in y. Even though every mesh uses an
 *     opaque `MeshStandardMaterial` (so the depth buffer resolves
 *     the visible pixel correctly regardless of scene-graph order),
 *     the scene-graph order is used by three.js's raycaster for
 *     tie-breaking on coplanar hits (AC8).
 *   - Reading the layer stack top-to-bottom in code matches how a
 *     carpenter builds a deck bottom-up. Cognitive-load win.
 *   - React reconciliation is stable: adding a layer between two
 *     existing ones (e.g. "insertBefore" beams) means every JSX
 *     child after that point shifts key positions. Every layer
 *     component is a functional component with no state, so this
 *     reordering is a no-op reconciliation — safe.
 *
 * ## Why NO transparency handling
 *
 * MVP does not use transparent materials (see `shared/materials.ts`
 * — every species material has `transparent: false`). Three.js's
 * depth-buffer takes care of everything without a manual sort pass.
 * If a future story introduces translucent members (glass railings,
 * etc.), this component will need to add a `renderOrder` prop OR
 * split translucent members into a separate group with `depthWrite:
 * false` — that change would live here.
 */
import type { JSX } from 'react';

import { BeamsLayer } from './BeamsLayer';
import { DeckingLayer } from './DeckingLayer';
import { EnvironmentLayer } from './EnvironmentLayer';
import { FootingsLayer } from './FootingsLayer';
import { JoistsLayer } from './JoistsLayer';
import { PostsLayer } from './PostsLayer';

export function DeckLayers(): JSX.Element {
  return (
    <>
      <EnvironmentLayer />
      <FootingsLayer />
      <PostsLayer />
      <BeamsLayer />
      <JoistsLayer />
      <DeckingLayer />
    </>
  );
}
