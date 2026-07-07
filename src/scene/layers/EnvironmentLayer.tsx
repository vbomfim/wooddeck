/**
 * `src/scene/layers/EnvironmentLayer.tsx` — the ground plane + grid
 * environment layer.
 *
 * ## Responsibility (single)
 *
 * Render the non-deck world that sits UNDER the deck: a large
 * ground plane at `y = 0` and a subtle grid on the ground. Bound
 * to `useUiStore(s => s.layerVisibility.environment)`.
 *
 * ## AC5 authoritative frame reconciliation
 *
 * Ticket §4 AC5 wording says "z = 0" — that references the OLD
 * z-up frame from earlier ticket drafts. The BINDING frame lives
 * in `domain/model.ts` `LAYOUT COORDINATE FRAME`:
 *
 *     +x = width, +y = up, +z = length; y = 0 is the ground plane.
 *
 * We implement the AUTHORITATIVE frame. The ground plane sits at
 * `y = 0`, which is also where every `LayoutMember`'s vertical
 * coordinates originate. Consequently footings extend into `-y`
 * (below the ground plane) and above-ground framing sits at
 * `y >= 0` — exactly what the domain model says.
 *
 * ## Ground-plane sizing
 *
 * `GROUND_PLANE_SIZE_MM` = 60 000 mm ≈ 200 ft — deliberately much
 * larger than the maximum supported deck footprint (≈ 40 × 40 ft,
 * 12 200 mm) so the horizon never gaps out in orbit view. A user
 * who orbits far enough that the plane's edge would show has
 * probably zoomed past `CAMERA_FAR_MM` anyway (~114 000 mm).
 *
 * ## Grid divisions
 *
 * `GROUND_GRID_DIVISIONS` = 60. Combined with the 60 000 mm
 * plane, that's a grid line every 1 000 mm (~3.3 ft) — coarse
 * enough not to overwhelm the framing detail, fine enough to
 * give a sense of scale under the deck.
 *
 * ## Why three.js `<gridHelper>` (not drei's `<Grid>`)
 *
 * `<gridHelper>` is a stock three.js `LineSegments` primitive.
 * It uses `LineBasicMaterial` (no custom shader) and has zero
 * per-frame cost. drei's `<Grid>` is more visually polished but
 * uses a custom shader — NFR-002 requires "no shader recompile"
 * on layer toggle, and we're one shader lighter this way. If a
 * future story wants the drei Grid look, it can swap in behind
 * the same `<gridHelper>` slot; the visibility contract is
 * unchanged.
 *
 * ## Ground-plane rotation constant
 *
 * The three.js `PlaneGeometry` primitive lies in the x-y plane by
 * default. To lay it flat in the world x-z plane (which is what
 * "ground" means with +y up) we rotate by `-π/2` around the
 * x axis. The constant is named so the intent is loud — and it
 * is a FIXED rotation of a fixed primitive, not arithmetic on a
 * `LayoutMember` (so finding #3 is not implicated).
 *
 * ## Materials
 *
 * The plane uses a `MeshStandardMaterial` with a subtle
 * ground-tone colour. It is NOT sharable via the species helper
 * — the ground plane is unique.
 */
import type { JSX } from 'react';
import { DoubleSide } from 'three';

import { useUiStore } from '../../state';

import { LAYER_USER_DATA_KEY } from './shared/kind-layer';

/**
 * Full extent of the ground plane (millimeters). See module
 * header for the sizing rationale.
 */
export const GROUND_PLANE_SIZE_MM = 60_000;

/**
 * Number of grid divisions on the ground grid. See module
 * header — 60 divisions × 60 000 mm plane = 1 000 mm per cell.
 */
export const GROUND_GRID_DIVISIONS = 60;

/**
 * Ground-plane colour — a muted tan / dirt tone that contrasts
 * with both PT (greenish) and Cedar (reddish) framing. Kept
 * as a named constant so a future palette tweak is a one-line
 * edit.
 */
const GROUND_COLOR = 0x9a8a70;

/**
 * Grid center-line and secondary-line colours. Both muted so the
 * grid reads as ambient tick-marks rather than a chart.
 */
const GRID_COLOR_MAJOR = 0x666666;
const GRID_COLOR_MINOR = 0x888888;

/**
 * Fixed rotation to lay a PlaneGeometry flat in the x-z plane.
 * Named so the intent is loud — this is NOT arithmetic on a
 * LayoutMember (finding #3 does not apply); it is the fixed
 * orientation of the ground-plane primitive.
 */
const GROUND_PLANE_ROTATION: readonly [number, number, number] = [-Math.PI / 2, 0, 0];

export function EnvironmentLayer(): JSX.Element {
  const visible = useUiStore((s) => s.layerVisibility.environment);
  return (
    /*
     * `userData[LAYER_USER_DATA_KEY] = 'environment'` — same layer-
     * identity stamp used by every KindLayer. The AC8 scene-graph
     * order test walks the top-level groups and reads the sequence
     * of layer ids directly from three.js.
     */
    <group visible={visible} userData={{ [LAYER_USER_DATA_KEY]: 'environment' }}>
      {/*
       * Ground plane — laid flat in the world x-z plane at y = 0.
       * DoubleSide so the plane renders whether the camera is
       * above OR below (the top preset views it from directly
       * above; other presets could dip below the horizon during
       * a transition and would otherwise see the back face cull).
       */}
      <mesh position={[0, 0, 0]} rotation={GROUND_PLANE_ROTATION}>
        <planeGeometry args={[GROUND_PLANE_SIZE_MM, GROUND_PLANE_SIZE_MM]} />
        <meshStandardMaterial color={GROUND_COLOR} side={DoubleSide} roughness={1} metalness={0} />
      </mesh>
      {/*
       * Grid — three.js primitive `<gridHelper>` sits in the x-z
       * plane at y = 0 by default (no rotation needed). We lift
       * it a hair above the ground plane (1 mm) so the grid lines
       * never z-fight the plane surface during orbit.
       */}
      <gridHelper
        args={[GROUND_PLANE_SIZE_MM, GROUND_GRID_DIVISIONS, GRID_COLOR_MAJOR, GRID_COLOR_MINOR]}
        position={[0, 1, 0]}
      />
    </group>
  );
}
