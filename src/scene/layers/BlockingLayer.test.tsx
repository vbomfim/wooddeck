/**
 * Unit tests for `src/scene/layers/BlockingLayer.tsx` — the S22
 * blocking-mesh layer (Epic 2 / FR-029).
 *
 * ## Why this file is short
 *
 * `BlockingLayer` is a `KindLayer` delegator (same three-line body
 * as `JoistsLayer` / `BeamsLayer` — see those files for the
 * rationale). It renders lumber-material `blocking`-kind members
 * as `BoxMember` boxes: same primitive, same material picker
 * (`materialForMember` accepts lumber), just a different `kind`.
 *
 * The shared `layer-suite.tsx` factory (AC1 / AC2 / AC3 / AC6 /
 * QA-G6) applies unchanged — the assertions are identical to every
 * other kind-scoped layer. We register it here and add ONE
 * blocking-specific test at the end: the members explicitly use
 * `LumberMemberMaterial` (not block material), so `materialForMember`
 * does NOT throw when the layer renders them.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Mesh, MeshStandardMaterial } from 'three';

import { useDesignStore, useUiStore } from '../../state';
import { resetDesignStoreForTests } from '../../state/design-store';

import { BlockingLayer } from './BlockingLayer';
import { registerLayerSuite } from './__testing__/layer-suite';
import {
  FIXTURE_MATERIAL_PT,
  makeLayout,
  makeMember,
} from './__testing__/fixtures';

registerLayerSuite({
  Layer: BlockingLayer,
  kind: 'blocking',
  visibilityKey: 'blocking',
  displayName: 'BlockingLayer',
});

// ---------------------------------------------------------------------------
// Blocking-specific: lumber material path (no throw from materialForMember)
// ---------------------------------------------------------------------------

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

describe('<BlockingLayer /> — lumber-material rendering (matches beams/joists)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('each mesh binds a MeshStandardMaterial from the lumber palette', async () => {
    // Blocking members carry `material.kind === 'lumber'` (matches
    // the joist SKU — same species so they nest inside the same
    // material shared-cache). If the layer accidentally routed
    // through the block picker, `materialForMember` would throw
    // and the test would fail — this documents the wiring.
    const members = [
      makeMember({
        id: 'blocking-0',
        kind: 'blocking',
        material: FIXTURE_MATERIAL_PT,
        position: { x: 0, y: 200, z: 0 },
        size: { x: 300, y: 200, z: 38 },
      }),
      makeMember({
        id: 'blocking-1',
        kind: 'blocking',
        material: FIXTURE_MATERIAL_PT,
        position: { x: 0, y: 200, z: 500 },
        size: { x: 300, y: 200, z: 38 },
      }),
    ];
    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({ bundle: { ...cur, layout: makeLayout(members) } });

    const renderer = await ReactThreeTestRenderer.create(<BlockingLayer />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(2);
    for (const m of meshes) {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      expect(mat).toBeInstanceOf(MeshStandardMaterial);
    }
    // The two blocking meshes share the SAME PT species material —
    // referential-equality on the material pointer. Same discipline
    // as JoistsLayer.
    const [a, b] = meshes;
    const matA = Array.isArray(a!.material) ? a!.material[0] : a!.material;
    const matB = Array.isArray(b!.material) ? b!.material[0] : b!.material;
    expect(matA).toBe(matB);

    await renderer.unmount();
  });
});
