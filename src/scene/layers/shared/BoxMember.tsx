/**
 * `src/scene/layers/shared/BoxMember.tsx` — reusable `<mesh>` for
 * one rectangular `LayoutMember`.
 *
 * ## Responsibility (single)
 *
 * Translate ONE {@link LayoutMember} into ONE `<mesh>` — a box
 * primitive positioned, scaled, and rotated per the member's
 * pre-computed geometry fields. This is the sole "member becomes
 * mesh" path in the scene; every kind-scoped layer (`JoistsLayer`,
 * `BeamsLayer`, etc.) renders a list of `<BoxMember>` inside its
 * `<group>` and does no per-mesh geometry itself.
 *
 * ## ZERO geometry math — the finding-#3 pledge
 *
 * BoxMember NEVER does arithmetic on `member.position`, `member.size`,
 * or `member.rotation`. It ONLY passes the fields through as
 * `<mesh>` props:
 *
 *   position = [ m.position.x, m.position.y, m.position.z ]
 *   scale    = [ m.size.x,     m.size.y,     m.size.z     ]
 *   rotation = [ m.rotation.x, m.rotation.y, m.rotation.z ]
 *
 * There is a sibling `no-geometry-math.test.ts` grep that scans
 * this file (and every layer sibling) for any `member.position.<axis> +/-/*  /` pattern (plus
 * unary-minus and bracket-notation variants) and fires if one
 * appears. The layout engine (S4) owns every derivation; scene
 * code is the passive consumer.
 *
 * ## AC7: 1 three.js unit = 1 mm
 *
 * The scene is authored at millimeter world scale — a member with
 * `position.x = 1000` renders at `mesh.position.x = 1000` (no
 * conversion). `DeckScene.tsx` clips at
 * `CAMERA_NEAR_MM` / `CAMERA_FAR_MM` so the mm-scale geometry
 * fits inside the frustum.
 *
 * ## Shared unit-box geometry (pair-fix iter 1 Fix D — GPT review #3)
 *
 * A single module-level `UNIT_BOX_GEOMETRY` — `new BoxGeometry(1, 1, 1)`
 * — is shared by EVERY `<BoxMember>` in the scene. Rationale:
 *
 *   - GPU binds ONE geometry buffer for every member (previously,
 *     `<boxGeometry args={[1,1,1]}/>` inline created one
 *     `BoxGeometry` instance per mesh — ~1900 for a 40'×40' deck,
 *     each with its own 24-vertex + 36-index buffer).
 *   - The per-mesh `scale` prop is the only per-member cost — the
 *     GPU applies the model matrix in the vertex shader regardless.
 *   - Full-extent size fields match three.js `BoxGeometry`
 *     convention (`new BoxGeometry(w, h, d)` is FULL widths, not
 *     half-widths). Scaling a unit cube by `size` gives an
 *     equivalent shape.
 *   - Referential equality: every `<BoxMember>` in the scene
 *     graph has `mesh.geometry === UNIT_BOX_GEOMETRY` — asserted
 *     by `BoxMember.test.tsx`.
 *
 * The alternative (each mesh with its own
 * `<boxGeometry args={[m.size.x, m.size.y, m.size.z]}/>`) would
 * put a distinct geometry buffer in every mesh — many more GPU
 * bindings, larger memory footprint, and no visual difference.
 *
 * ## Disposal contract
 *
 * `UNIT_BOX_GEOMETRY` is a module-level singleton. It lives for
 * the lifetime of the JavaScript module (which in a real app is
 * the lifetime of the tab). Browser tab teardown reclaims the GPU
 * handle — no explicit disposal is required in production.
 *
 * For HMR / test scenarios that want to prove the singleton is
 * rebuild-friendly, {@link disposeSharedGeometry} is exported
 * alongside `disposeSharedMaterials`. Both live in `./materials.ts`
 * as a package-level helper (`disposeSharedResources`) — kept out
 * of the public barrel because production code never calls them.
 *
 * ## Optional `material` prop (pair-fix iter 1 Fix F — Opus review #6)
 *
 * `BoxMember` accepts an optional `material?: Material` prop so
 * downstream stories (notably S11's WarningOverlay, which
 * highlights a member with a red outline material) can reuse the
 * SAME position / scale / rotation / geometry pipeline without
 * duplicating the component. When `material` is omitted, the
 * per-KIND shared material is looked up via `materialForMember`
 * (which reads `member.kind` post `fix/part-type-colors`; see
 * `./materials.ts` for the palette rationale).
 *
 * Current call sites (the five kind layers via `<KindLayer>`) do
 * NOT pass `material` — behaviour is unchanged.
 */
import type { JSX } from 'react';
import type { Material } from 'three';

import type { LayoutMember } from '../../../domain/model';

import { UNIT_BOX_GEOMETRY } from './geometries';
import { materialForMember } from './materials';

/**
 * Props for {@link BoxMember}. The single `member` field carries
 * every render input — the layer above is responsible for filtering
 * to the right `kind`.
 *
 * `material` is optional — omit for the per-KIND shared material
 * (the common case), or pass an override for a decorator use case
 * such as S11's WarningOverlay.
 */
export interface BoxMemberProps {
  readonly member: LayoutMember;
  readonly material?: Material;
}

export function BoxMember({ member, material }: BoxMemberProps): JSX.Element {
  // Look up the kind material ONLY when the caller did not
  // provide an override. The lookup is a Map.get + reference
  // return — no allocation.
  const effectiveMaterial = material ?? materialForMember(member);
  return (
    <mesh
      position={[member.position.x, member.position.y, member.position.z]}
      scale={[member.size.x, member.size.y, member.size.z]}
      rotation={[member.rotation.x, member.rotation.y, member.rotation.z]}
      geometry={UNIT_BOX_GEOMETRY}
      material={effectiveMaterial}
    />
  );
}
