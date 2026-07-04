/**
 * `src/scene/layers/BlocksLayer.tsx` — the S22 block-mesh layer
 * (Epic 2 / FR-029).
 *
 * ## Responsibility (single)
 *
 * Render every `LayoutMember` with `kind === 'block'` as a
 * `<mesh>` inside a `<group visible>` bound to
 * `useUiStore(s => s.layerVisibility.blocks)`. Unlike the five
 * kind-scoped layers that all use `BoxMember` + `UNIT_BOX_GEOMETRY`,
 * a block member's GEOMETRY depends on its foundation product:
 *
 *   - `oldcastle-11x11x7` → `DECK_BLOCK_GEOMETRY` (unit box)
 *   - `tuffblock-12x12x4` → `TUFFBLOCK_GEOMETRY` (unit hex frustum)
 *
 * This layer is therefore the ONE PLACE the "geometry by productId"
 * dispatch lives. If a future block product is added, one row is
 * added to `GEOMETRY_BY_PRODUCT_ID` and the `LayoutMember` producer
 * gains a `{kind:'block', productId:'new-id'}` variant — nothing
 * else changes.
 *
 * ## Rewritability contract
 *
 * The file exports one component; the geometry lookup is a frozen
 * `Record` at module scope. A caller (an AI agent, a new
 * contributor) rewriting this file from its `() => JSX.Element`
 * interface + the AC1–AC6 tests needs `LAYER_USER_DATA_KEY`,
 * `materialForBlock`, and the two block geometries — every one is
 * imported explicitly.
 *
 * ## Kind-layer parallel — WHY this is NOT a KindLayer
 *
 * `KindLayer` (shared/kind-layer.tsx) is the delegator used by
 * every kind whose members map 1-to-1 to a `BoxMember`. Blocks
 * are NOT boxes (TuffBlock is a hex frustum), so the dispatcher
 * lives in this file rather than being hidden in the shared
 * helper. The two look similar on purpose — same visibility
 * pattern, same userData stamp, same defensive null-layout
 * fallback — but the material + geometry lookup differ.
 *
 * ## ZERO geometry math (Code Review Guardian finding #3)
 *
 * `BlockMesh` passes `member.position`, `member.size`, and
 * `member.rotation` through as `<mesh>` props with NO arithmetic —
 * same discipline as `BoxMember`. The `no-geometry-math.test.ts`
 * grep scans this file for any `member.position.x + N` style
 * pattern and fires if one appears; every derivation of a block's
 * y-center lives in the layout engine (S19/S20).
 *
 * ## Boundary
 *
 * Imports: `react` (JSX type), `three` (Group/Material types),
 * `../../domain/model` (LayoutMember type), `../../domain/foundation-catalog`
 * (product-id type re-export), `../../state` (design + ui stores),
 * `./shared/geometries` (block geometries), `./shared/materials`
 * (materialForBlock), `./shared/kind-layer` (LAYER_USER_DATA_KEY
 * constant). No coupling to `src/domain/layout/**` (layout engine
 * math), enforced by dep-cruiser `scene-no-domain-layout` and the
 * sibling `no-geometry-math.test.ts` grep.
 */
import type { JSX } from 'react';
import type { BufferGeometry } from 'three';

import type { FoundationProductId } from '../../domain/foundation-catalog';
import type { LayoutMember } from '../../domain/model';
import { useDesignStore, useUiStore } from '../../state';

import {
  DECK_BLOCK_GEOMETRY,
  TUFFBLOCK_GEOMETRY,
} from './shared/geometries';
import { LAYER_USER_DATA_KEY } from './shared/kind-layer';
import { materialForBlock } from './shared/materials';

/**
 * Stable empty-array reference for the defensive `?? EMPTY_MEMBERS`
 * fallback below. If we returned a fresh `[]` from the selector on
 * every render, Zustand's default referential-equality check would
 * flip to "changed" on every read and trigger an infinite re-render
 * loop. A module singleton keeps the reference stable — mirror of
 * `KindLayer`'s discipline.
 */
const EMPTY_MEMBERS: readonly LayoutMember[] = Object.freeze([]);

/**
 * The geometry each block product renders with. Keyed by
 * `FoundationProductId` (the MVP catalog literal) — an exhaustive
 * `Record` so TypeScript fails-compile when a new product id is
 * added upstream without a matching row here.
 */
const GEOMETRY_BY_PRODUCT_ID: Readonly<Record<FoundationProductId, BufferGeometry>> =
  Object.freeze({
    'oldcastle-11x11x7': DECK_BLOCK_GEOMETRY,
    'tuffblock-12x12x4': TUFFBLOCK_GEOMETRY,
  });

/**
 * Props for {@link BlockMesh}. The single `member` field carries
 * every render input — the layer above filters to `kind === 'block'`
 * and guarantees `member.material.kind === 'block'` before entry.
 */
interface BlockMeshProps {
  readonly member: LayoutMember;
}

/**
 * Render ONE block member as a `<mesh>`. The geometry is picked
 * from the productId lookup; the material is picked from the
 * shared block-material cache. This is the block equivalent of
 * `BoxMember` — one member becomes one `<mesh>`, no arithmetic on
 * member coordinates.
 *
 * The caller (`BlocksLayer`) has already narrowed `member.kind`
 * to `'block'`, but TypeScript sees `member.material` as the wider
 * `MemberMaterialRef` union. A discriminant check inside this
 * function narrows it to `BlockMemberMaterial` — the throw is a
 * defense-in-depth guard against a caller violating the layer's
 * contract; every test path that reaches this component supplies a
 * block-material member.
 */
function BlockMesh({ member }: BlockMeshProps): JSX.Element {
  // Narrow the discriminated union. `materialForBlock` will also
  // throw on a non-block material — we throw earlier here so the
  // stack trace names the layer instead of the material helper.
  if (member.material.kind !== 'block') {
    throw new Error(
      `BlocksLayer: expected block material on kind==='block' member, ` +
        `got material.kind="${member.material.kind}" for member id="${member.id}". ` +
        `The layout engine is expected to pair kind:'block' with material:{kind:'block',...}. ` +
        `See src/scene/layers/BlocksLayer.tsx.`,
    );
  }
  const geometry = GEOMETRY_BY_PRODUCT_ID[member.material.productId];
  const material = materialForBlock(member);
  return (
    <mesh
      position={[member.position.x, member.position.y, member.position.z]}
      scale={[member.size.x, member.size.y, member.size.z]}
      rotation={[member.rotation.x, member.rotation.y, member.rotation.z]}
      geometry={geometry}
      material={material}
    />
  );
}

/**
 * `BlocksLayer` — S22 (Epic 2 / FR-029). Renders every block-kind
 * `LayoutMember` inside a single `<group>` whose visibility is
 * bound to `layerVisibility.blocks`. See module header for the
 * dispatch rationale.
 */
export function BlocksLayer(): JSX.Element {
  // Reading `members` as a whole keeps the selector reference-stable
  // across unrelated store writes — same rationale as `KindLayer`.
  // The defensive `?.members ?? EMPTY_MEMBERS` guard honors the
  // §5 "if Layout is null → each layer returns null gracefully"
  // promise (see kind-layer.tsx module header).
  const members = useDesignStore((s) => s.bundle.layout?.members ?? EMPTY_MEMBERS);
  const visible = useUiStore((s) => s.layerVisibility.blocks);

  const own = members.filter((m) => m.kind === 'block');

  return (
    /*
     * `userData[LAYER_USER_DATA_KEY] = 'blocks'` stamps the layer's
     * logical id on the group instance — matches every KindLayer
     * so the DeckLayers AC8 scene-graph-order test can pluck the
     * layer sequence directly from three.js userData.
     */
    <group visible={visible} userData={{ [LAYER_USER_DATA_KEY]: 'blocks' }}>
      {own.map((member) => (
        <BlockMesh key={member.id} member={member} />
      ))}
    </group>
  );
}
