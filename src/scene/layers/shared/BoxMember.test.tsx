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
 *   AC6  Material comes from the shared per-kind helper — assert
 *        the mesh's `material` is the SAME instance as
 *        `materialForKind(member.kind)`. The `fix/part-type-colors`
 *        change rerouted this from species to kind; the assertion
 *        stays a structural referential-equality check.
 *   AC7  1 three.js unit = 1 mm — a member at position.x = 1000
 *        renders at THREE position.x = 1000 (no rescale).
 *   §3   ZERO geometry math — the member's position is `.set` into
 *        the mesh unchanged. Also asserted by the sibling
 *        `no-geometry-math.test.ts` grep guard.
 *   Fix D  Shared geometry — every mesh's `geometry` is the SAME
 *          `UNIT_BOX_GEOMETRY` module singleton. GPT review #3
 *          flagged that the previous inline `<boxGeometry
 *          args={[1,1,1]}/>` allocated one geometry per mesh; the
 *          identity assertion here catches a regression.
 *   Fix F  Optional `material` prop — pass a custom Material and
 *          assert the mesh binds it instead of the species default
 *          (S11 WarningOverlay reuse path).
 */
import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Mesh, MeshBasicMaterial } from 'three';

import { BoxMember } from './BoxMember';
import { UNIT_BOX_GEOMETRY } from './geometries';
import { materialForKind } from './materials';
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

  it('mesh geometry IS the shared UNIT_BOX_GEOMETRY singleton (Fix D, GPT #3)', async () => {
    // Reference equality — every `<BoxMember>` in the scene
    // shares the ONE module-level BoxGeometry. A regression that
    // inlines `<boxGeometry args={[1,1,1]}/>` again would allocate
    // a per-mesh instance and flip this test to red.
    const member = makeMember({ id: 'post-shared', kind: 'post' });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.geometry).toBe(UNIT_BOX_GEOMETRY);
    await renderer.unmount();
  });

  it('TWO BoxMembers share the SAME geometry instance in the scene graph (Fix D)', async () => {
    // Structural companion to the identity assertion above — two
    // meshes in one render, both bound to the same module singleton.
    // Also proves the shared reference survives across
    // sibling-mount and identity, not just the first mount.
    const memberA = makeMember({ id: 'a', kind: 'joist' });
    const memberB = makeMember({ id: 'b', kind: 'beam' });
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <BoxMember member={memberA} />
        <BoxMember member={memberB} />
      </>,
    );
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(2);
    expect(meshes[0]!.geometry).toBe(UNIT_BOX_GEOMETRY);
    expect(meshes[1]!.geometry).toBe(UNIT_BOX_GEOMETRY);
    expect(meshes[0]!.geometry).toBe(meshes[1]!.geometry);
    await renderer.unmount();
  });
});

describe('<BoxMember /> — material sharing (AC6)', () => {
  it('mesh uses the shared JOIST-kind material for a joist member (species IGNORED)', async () => {
    // Post `fix/part-type-colors`: colour is determined by
    // `member.kind`, not `member.material.species`. Two joists of
    // different species must share the same material instance.
    const member = makeMember({
      id: 'joist-pt',
      kind: 'joist',
      material: { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    // Referential equality — the mesh's material IS the shared
    // module-cached instance. Every joist points at the same
    // MeshStandardMaterial, which is the whole point of the
    // "shared per kind" trade-off.
    expect(mesh.material).toBe(materialForKind('joist'));
    await renderer.unmount();
  });

  it('mesh uses the shared JOIST-kind material even for a Cedar-species joist (species IGNORED)', async () => {
    // Same joist kind, DIFFERENT species — proves species has no
    // effect on material selection.
    const member = makeMember({
      id: 'joist-cedar',
      kind: 'joist',
      material: { kind: 'lumber', nominal: '2x8', species: 'Cedar', grade: 'No2' },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.material).toBe(materialForKind('joist'));
    await renderer.unmount();
  });

  it('mesh uses the shared BOARD-kind material for a Composite decking board (species IGNORED)', async () => {
    // Decking (kind='board') always uses the board colour, no
    // matter what species tag the material carries.
    const member = makeMember({
      id: 'board-composite',
      kind: 'board',
      material: { kind: 'lumber', nominal: '5/4x6', species: 'Composite', grade: 'NA' },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.material).toBe(materialForKind('board'));
    await renderer.unmount();
  });

  it('two joist members SHARE the same material instance in the scene graph', async () => {
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

  it('a joist and a beam of the SAME species render DIFFERENT material instances (core user request)', async () => {
    // This is the regression sentinel: on the OLD species-based
    // code, a PT joist and a PT beam shared a material — this test
    // would have FAILED there. On the new kind-based code, they
    // are distinct instances with distinct colours.
    const joist = makeMember({
      id: 'joist-pt',
      kind: 'joist',
      material: { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' },
    });
    const beam = makeMember({
      id: 'beam-pt',
      kind: 'beam',
      material: { kind: 'lumber', nominal: '2x10', species: 'PT', grade: 'No2' },
    });
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <BoxMember member={joist} />
        <BoxMember member={beam} />
      </>,
    );
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(2);
    // Different instances — different colours per the kind palette.
    expect(meshes[0]!.material).not.toBe(meshes[1]!.material);
  });
});

describe('<BoxMember /> — optional material override (Fix F, Opus #6)', () => {
  it('binds the override material when the `material` prop is provided', async () => {
    // S11's WarningOverlay path: a decorator layer wants to render
    // the SAME rectangular member with a red-outline material.
    // Passing `material={custom}` swaps the material without
    // touching the position / scale / rotation / geometry pipeline.
    const member = makeMember({
      id: 'joist-overlay',
      kind: 'joist',
      material: { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' },
    });
    const override = new MeshBasicMaterial({ color: 0xff0000 });
    const renderer = await ReactThreeTestRenderer.create(
      <BoxMember member={member} material={override} />,
    );
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    // Referential equality — the mesh's material IS the override,
    // not the kind default.
    expect(mesh.material).toBe(override);
    // Sanity: the OTHER props still flow through unchanged.
    expect(mesh.geometry).toBe(UNIT_BOX_GEOMETRY);
    override.dispose();
    await renderer.unmount();
  });

  it('falls back to the shared kind material when `material` is omitted', async () => {
    // This is the current call path — every `<KindLayer>` renders
    // `<BoxMember member={...}/>` without an override. The
    // regression sentinel: adding a REQUIRED material prop would
    // break every caller silently. This test ensures the fallback
    // stays wired.
    const member = makeMember({
      id: 'joist-default',
      kind: 'joist',
      material: { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' },
    });
    const renderer = await ReactThreeTestRenderer.create(<BoxMember member={member} />);
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.material).toBe(materialForKind('joist'));
    await renderer.unmount();
  });
});
