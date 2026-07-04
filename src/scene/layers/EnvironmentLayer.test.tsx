/**
 * Unit tests for `src/scene/layers/EnvironmentLayer.tsx`.
 *
 * ## Coverage map (S10 issue #11)
 *
 *   AC1  Layer mounts a single <group>.
 *   AC3  Visibility flag flips <group visible> — no remount.
 *   AC5  Environment layer renders:
 *          - a ground plane at y = 0 (the AUTHORITATIVE +y-up frame;
 *            the ticket §4 AC5 wording says "z = 0" but that is the
 *            OLD z-up frame — the binding frame in
 *            `domain/model.ts` "LAYOUT COORDINATE FRAME" is +y up,
 *            so the ground plane sits at y = 0).
 *          - a subtle grid on the ground.
 *          - the plane extends larger than any reasonable deck
 *            footprint (SC-002-ish visual heuristic — the horizon
 *            never gaps out on the biggest supported deck).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Group, Mesh } from 'three';

import { useUiStore } from '../../state';

import { EnvironmentLayer, GROUND_PLANE_SIZE_MM } from './EnvironmentLayer';

function resetLayerVisibility(): void {
  useUiStore.setState({
    layerVisibility: {
      environment: true,
      decking: true,
      joists: true,
      beams: true,
      posts: true,
      footings: true,
      blocks: true,
      blocking: true,
    },
  });
}

describe('<EnvironmentLayer /> — AC1 mount', () => {
  beforeEach(resetLayerVisibility);

  it('AC1: mounts a single root <group>', async () => {
    const renderer = await ReactThreeTestRenderer.create(<EnvironmentLayer />);
    const groups = renderer.scene.findAllByType('Group');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    await renderer.unmount();
  });
});

describe('<EnvironmentLayer /> — AC5 ground plane + grid', () => {
  beforeEach(resetLayerVisibility);

  it('renders a ground-plane mesh at y = 0 (authoritative +y-up frame)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<EnvironmentLayer />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    // At least one mesh — the ground plane. If drei's <Grid>
    // helper also renders a mesh (it does — Grid is a mesh with
    // a custom shader), a second mesh may appear. We assert the
    // FIRST mesh (the ground plane) sits at y = 0 to lock the
    // authoritative frame in place.
    expect(meshes.length).toBeGreaterThanOrEqual(1);
    // Find the plane by its geometry type — helps distinguish the
    // ground plane from a grid helper mesh.
    const plane = meshes.find((m) => m.geometry.type === 'PlaneGeometry');
    expect(plane).toBeDefined();
    expect(plane!.position.y).toBe(0);
  });

  it('ground plane extends at least GROUND_PLANE_SIZE_MM across (larger than any deck footprint)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<EnvironmentLayer />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    const plane = meshes.find((m) => m.geometry.type === 'PlaneGeometry');
    expect(plane).toBeDefined();
    // BufferGeometry bounding box read is deterministic; compute
    // it to get the physical extent regardless of args ordering.
    plane!.geometry.computeBoundingBox();
    const bbox = plane!.geometry.boundingBox!;
    const width = bbox.max.x - bbox.min.x;
    const height = bbox.max.y - bbox.min.y;
    // A PlaneGeometry defaults to the x-y plane in three.js. We
    // rotate the plane by -π/2 around x so it lies in the x-z
    // plane. So `width` = x-extent (bbox pre-rotation) and
    // `height` = y-extent pre-rotation = z-extent post-rotation.
    // Both should be at least `GROUND_PLANE_SIZE_MM`.
    expect(width).toBeGreaterThanOrEqual(GROUND_PLANE_SIZE_MM);
    expect(height).toBeGreaterThanOrEqual(GROUND_PLANE_SIZE_MM);
  });

  it('mounts a grid helper (LineSegments) so the ground has visible tick marks', async () => {
    // We use three.js `<gridHelper>` (LineSegments-based, stock
    // three primitive) rather than drei's `<Grid>` (shader-based)
    // so the grid is trivially testable and adds no shader
    // compile cost per NFR-002.
    const renderer = await ReactThreeTestRenderer.create(<EnvironmentLayer />);
    const grid = renderer.scene.find(
      (n) => n.instance?.type === 'GridHelper' || n.type === 'gridHelper',
    );
    expect(grid).toBeDefined();
  });
});

describe('<EnvironmentLayer /> — AC3 visibility', () => {
  beforeEach(resetLayerVisibility);

  it('AC3: initial visible=true reflects the environment default', async () => {
    const renderer = await ReactThreeTestRenderer.create(<EnvironmentLayer />);
    const groups = renderer.scene.findAllByType('Group');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect((groups[0]!.instance as Group).visible).toBe(true);
    await renderer.unmount();
  });

  it('AC3: toggling the environment flag flips <group visible> WITHOUT remounting the ground plane', async () => {
    const renderer = await ReactThreeTestRenderer.create(<EnvironmentLayer />);
    const groupBefore = renderer.scene.findAllByType('Group')[0]!.instance as Group;
    const planeBefore = renderer.scene.findAllByType('Mesh').find(
      (m) => (m.instance as Mesh).geometry.type === 'PlaneGeometry',
    )!.instance as Mesh;
    expect(groupBefore.visible).toBe(true);

    await ReactThreeTestRenderer.act(async () => {
      useUiStore.getState().toggleLayer('environment');
      await Promise.resolve();
    });
    await renderer.update(<EnvironmentLayer />);

    const groupAfter = renderer.scene.findAllByType('Group')[0]!.instance as Group;
    const planeAfter = renderer.scene.findAllByType('Mesh').find(
      (m) => (m.instance as Mesh).geometry.type === 'PlaneGeometry',
    )!.instance as Mesh;
    // Group visibility flipped.
    expect(groupAfter.visible).toBe(false);
    // Group + plane are the SAME instance — no remount, no shader
    // recompile.
    expect(groupAfter).toBe(groupBefore);
    expect(planeAfter).toBe(planeBefore);

    await renderer.unmount();
  });
});
