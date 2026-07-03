/**
 * Unit tests for `src/scene/layers/shared/BoxMember.tsx`.
 *
 * ## Coverage map (S10 issue #11)
 *
 *   AC2  Member fields translate directly to mesh props: position
 *        matches `member.position`; scale matches `member.size`;
 *        rotation matches `member.rotation`. Asserted on the LIVE
 *        `THREE.Mesh` instance via `@react-three/test-renderer` —
 *        NOT on props alone — so a regression that DROPS one of
 *        the props is caught (mirrors the CameraRig live-camera
 *        probe pattern from S9 Fix C).
 *   AC6  Material comes from the shared per-species helper —
 *        assert the mesh's `material` is the SAME instance as
 *        `materialForSpecies(...)`.
 *   AC7  1 three.js unit = 1 mm — a member at position.x = 1000
 *        renders at THREE position.x = 1000 (no rescale).
 *   §3   ZERO geometry math — the member's position is `.set` into
 *        the mesh unchanged. Also asserted by the sibling
 *        `no-geometry-math.test.ts` grep guard.
 */
import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Mesh } from 'three';

import { BoxMember } from './BoxMember';
import { materialForSpecies } from './materials';
import { makeMember } from '../__testing__/fixtures';

describe('<BoxMember /> — mesh construction (AC2, AC7)', () => {
  it('renders exactly one <mesh> per member', async () => {
    const member = makeMember({ id: 'joist-0', kind: 'joist' });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes).toHaveLength(1);
    await renderer.unmount();
  });

  it('mesh position matches member.position exactly (mm → three units, AC7)', async () => {
    // Note the non-trivial position — we deliberately use a value
    // large enough (thousands of mm) that any accidental unit
    // conversion (e.g. mm→m divides by 1000) would show up as a
    // three-orders-of-magnitude discrepancy.
    const member = makeMember({
      id: 'joist-0',
      kind: 'joist',
      position: { x: 1000, y: 600, z: -1500 },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.position.x).toBe(1000);
    expect(mesh.position.y).toBe(600);
    expect(mesh.position.z).toBe(-1500);
    await renderer.unmount();
  });

  it('mesh scale matches member.size (unit box scaled by full extent)', async () => {
    // `<boxGeometry args={[1,1,1]}/>` is a 1×1×1 unit cube; scaling
    // by `size` gives a box of extent `size`. Full-extent (not
    // half-extent) matches three.js `BoxGeometry` convention and
    // the `domain/model.ts` LAYOUT COORDINATE FRAME comment.
    const member = makeMember({
      id: 'beam-0',
      kind: 'beam',
      size: { x: 3000, y: 200, z: 40 },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.scale.x).toBe(3000);
    expect(mesh.scale.y).toBe(200);
    expect(mesh.scale.z).toBe(40);
    await renderer.unmount();
  });

  it('mesh rotation matches member.rotation (Euler XYZ radians)', async () => {
    // Post-MVP diagonals will exercise non-zero rotations; the
    // MVP framing is all axis-aligned, so this test uses a
    // synthetic rotation to prove the prop pipeline forwards ALL
    // three Euler components untouched.
    const member = makeMember({
      id: 'joist-diag',
      kind: 'joist',
      rotation: { x: 0.1, y: 0.2, z: 0.3 },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.rotation.x).toBeCloseTo(0.1);
    expect(mesh.rotation.y).toBeCloseTo(0.2);
    expect(mesh.rotation.z).toBeCloseTo(0.3);
    await renderer.unmount();
  });

  it('mesh geometry is a BoxGeometry (three.js primitive — no custom shader)', async () => {
    // MVP uses stock BoxGeometry for every rectangular member.
    // A future switch to a custom geometry (chamfered edges, wood
    // grain displacement) must go through a deliberate change;
    // this guard makes the swap visible.
    const member = makeMember({ id: 'post-0', kind: 'post' });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.geometry.type).toBe('BoxGeometry');
    await renderer.unmount();
  });
});

describe('<BoxMember /> — material sharing (AC6)', () => {
  it('mesh uses the shared PT material instance for a PT member', async () => {
    const member = makeMember({
      id: 'joist-pt',
      kind: 'joist',
      material: { nominal: '2x8', species: 'PT', grade: 'No2' },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    // Referential equality — the mesh's material IS the shared
    // module-cached instance. Every PT joist points at the same
    // MeshStandardMaterial, which is the whole point of §7's
    // "shared per species" trade-off.
    expect(mesh.material).toBe(materialForSpecies('PT'));
    await renderer.unmount();
  });

  it('mesh uses the shared Cedar material for a Cedar member', async () => {
    const member = makeMember({
      id: 'joist-cedar',
      kind: 'joist',
      material: { nominal: '2x8', species: 'Cedar', grade: 'No2' },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.material).toBe(materialForSpecies('Cedar'));
    await renderer.unmount();
  });

  it('mesh uses the shared Composite material for a Composite board member', async () => {
    const member = makeMember({
      id: 'board-composite',
      kind: 'board',
      material: { nominal: '5/4x6', species: 'Composite', grade: 'NA' },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.material).toBe(materialForSpecies('Composite'));
    await renderer.unmount();
  });

  it('two PT members SHARE the same material instance in the scene graph', async () => {
    // Guard: a subtle refactor that pushed material construction
    // into `<BoxMember>` (rather than looking it up from the
    // module-cached helper) would flip this test to red.
    const memberA = makeMember({ id: 'joist-a', kind: 'joist' });
    const memberB = makeMember({ id: 'joist-b', kind: 'joist' });
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <BoxMember member={memberA} />
        <BoxMember member={memberB} />
      </>,
    );
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(2);
    expect(meshes[0]!.material).toBe(meshes[1]!.material);
    await renderer.unmount();
  });
});
