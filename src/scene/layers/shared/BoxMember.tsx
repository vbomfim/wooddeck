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
 * this file (and every layer sibling) for any `member.position.<axis> +/-/*  /` pattern and fires
 * if one appears. The layout engine (S4) owns every derivation;
 * scene code is the passive consumer.
 *
 * ## AC7: 1 three.js unit = 1 mm
 *
 * The scene is authored at millimeter world scale — a member with
 * `position.x = 1000` renders at `mesh.position.x = 1000` (no
 * conversion). `DeckScene.tsx` clips at
 * `CAMERA_NEAR_MM` / `CAMERA_FAR_MM` so the mm-scale geometry
 * fits inside the frustum.
 *
 * ## Unit-box geometry + scale
 *
 * We use a stock `<boxGeometry args={[1, 1, 1]}/>` primitive and
 * scale each `<mesh>` per member. Rationale (issue #11 §17):
 *
 *   - Every mesh shares the same underlying geometry buffer —
 *     GPU has one BoxGeometry to bind, and the per-mesh scale
 *     modifier is essentially free (one 4×4 matrix multiply the
 *     driver would do anyway).
 *   - Full-extent size fields match three.js `BoxGeometry`
 *     convention (`new BoxGeometry(w, h, d)` is FULL widths, not
 *     half-widths). Scaling a unit cube by `size` gives an
 *     equivalent shape.
 *
 * The alternative (each mesh with its own
 * `<boxGeometry args={[m.size.x, m.size.y, m.size.z]}/>`) would
 * put a distinct geometry buffer in every mesh — many more GPU
 * bindings, larger memory footprint, and no visual difference.
 *
 * ## Material
 *
 * Every mesh binds a species-specific `MeshStandardMaterial` from
 * `./materials.ts` — a SHARED instance per species so every joist
 * points at the same GPU handle. `materialForMember(m)` handles
 * the lookup.
 */
import type { JSX } from 'react';

import type { LayoutMember } from '../../../domain/model';

import { materialForMember } from './materials';

/**
 * Props for {@link BoxMember}. The single `member` field carries
 * every render input — the layer above is responsible for filtering
 * to the right `kind`.
 */
export interface BoxMemberProps {
  readonly member: LayoutMember;
}

export function BoxMember({ member }: BoxMemberProps): JSX.Element {
  return (
    <mesh
      position={[member.position.x, member.position.y, member.position.z]}
      scale={[member.size.x, member.size.y, member.size.z]}
      rotation={[member.rotation.x, member.rotation.y, member.rotation.z]}
      material={materialForMember(member)}
    >
      {/*
       * Unit-cube geometry. Scaled per-mesh via the `scale` prop.
       * See module header for the "shared geometry + scale" rationale.
       */}
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}
