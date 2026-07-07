/**
 * Unit tests for `src/scene/highlights/OverSpanHighlight.tsx`.
 *
 * ## Coverage map (S11 issue #12)
 *
 *   AC1  (structural piece) — one `<mesh>` per member, at the
 *        member's position/scale/rotation. The AC1 count-per-warning
 *        assertion lives in `WarningOverlay.test.tsx`; here we
 *        prove the leaf decorator does the mm→mesh translation.
 *   AC3  Mesh uses the shared HIGHLIGHT_MATERIAL + shared
 *        HIGHLIGHT_BOX_GEOMETRY singletons; renderOrder is high.
 *   §S11 boundary — the OverSpanHighlight file is self-contained
 *        (imports only three, react, `../../domain/model`, and
 *        `./highlight-primitives`). Enforced structurally by the
 *        dep-cruiser `warning-overlay-no-layers` rule (+ the
 *        BLOCK-2q self-test) and belt-and-suspenders by
 *        `no-geometry-math.test.ts` in this folder.
 *
 * ## No layer-primitive reuse (S11 finding #7)
 *
 * The S10 handoff suggested reusing `<BoxMember material={...}>`
 * as a decorator. The S11 ticket SUPERSEDES that: the overlay
 * MUST NOT import from `src/scene/layers/**` at all — not the
 * component, not the shared primitives. `OverSpanHighlight` is a
 * fully self-contained peer that binds its OWN shared unit-cube
 * geometry + highlight material from `./highlight-primitives`.
 */
import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Mesh } from 'three';

import { makeMember } from '../layers/__testing__/fixtures';

import {
  HIGHLIGHT_BOX_GEOMETRY,
  HIGHLIGHT_INFLATE_MM,
  HIGHLIGHT_MATERIAL,
  HIGHLIGHT_RENDER_ORDER,
} from './highlight-primitives';
import { OverSpanHighlight } from './OverSpanHighlight';

describe('<OverSpanHighlight /> — mesh construction (mm → three units)', () => {
  it('renders exactly one <mesh> per member', async () => {
    const member = makeMember({ id: 'joist-0', kind: 'joist' });
    const renderer = await ReactThreeTestRenderer.create(
      <OverSpanHighlight member={member} />,
    );
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes).toHaveLength(1);
    await renderer.unmount();
  });

  it('mesh position matches member.position exactly (AC7 mm world scale)', async () => {
    // Non-trivial position so any accidental unit conversion shows
    // up as three-orders-of-magnitude drift (matches the S10
    // BoxMember.test.tsx pattern — same discipline, SEPARATE
    // self-contained decorator).
    const member = makeMember({
      id: 'joist-hl',
      kind: 'joist',
      position: { x: 1200, y: 700, z: -1800 },
    });
    const renderer = await ReactThreeTestRenderer.create(
      <OverSpanHighlight member={member} />,
    );
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.position.x).toBe(1200);
    expect(mesh.position.y).toBe(700);
    expect(mesh.position.z).toBe(-1800);
    await renderer.unmount();
  });

  it('mesh scale is the member size INFLATED by HIGHLIGHT_INFLATE_MM (encloses member, no z-fight)', async () => {
    // Opaque-box redesign: the highlight box is slightly LARGER
    // than the member on every axis so it fully encloses the
    // member and no faces are coincident. Coincident faces on an
    // opaque coincident box would z-fight badly.
    const member = makeMember({
      id: 'beam-hl',
      kind: 'beam',
      size: { x: 3600, y: 240, z: 45 },
    });
    const renderer = await ReactThreeTestRenderer.create(
      <OverSpanHighlight member={member} />,
    );
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.scale.x).toBe(3600 + HIGHLIGHT_INFLATE_MM);
    expect(mesh.scale.y).toBe(240 + HIGHLIGHT_INFLATE_MM);
    expect(mesh.scale.z).toBe(45 + HIGHLIGHT_INFLATE_MM);
    await renderer.unmount();
  });

  it('mesh rotation matches member.rotation (Euler XYZ radians)', async () => {
    const member = makeMember({
      id: 'joist-diag',
      kind: 'joist',
      rotation: { x: 0.2, y: 0.4, z: 0.6 },
    });
    const renderer = await ReactThreeTestRenderer.create(
      <OverSpanHighlight member={member} />,
    );
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.rotation.x).toBeCloseTo(0.2);
    expect(mesh.rotation.y).toBeCloseTo(0.4);
    expect(mesh.rotation.z).toBeCloseTo(0.6);
    await renderer.unmount();
  });
});

describe('<OverSpanHighlight /> — AC3 opaque red decoration (depth-correct)', () => {
  it('mesh geometry IS the shared HIGHLIGHT_BOX_GEOMETRY singleton', async () => {
    // Every highlight in the scene binds the same geometry buffer
    // (module-level singleton) — matches the S10 shared-geometry
    // discipline, self-contained inside `highlights/`.
    const member = makeMember({ id: 'joist-shared', kind: 'joist' });
    const renderer = await ReactThreeTestRenderer.create(
      <OverSpanHighlight member={member} />,
    );
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.geometry).toBe(HIGHLIGHT_BOX_GEOMETRY);
    await renderer.unmount();
  });

  it('mesh material IS the shared HIGHLIGHT_MATERIAL singleton', async () => {
    // Reference equality — every highlight shares one red
    // MeshBasicMaterial (see highlight-primitives.test.ts for the
    // property assertions on color / transparent / depthTest /
    // depthWrite).
    const member = makeMember({ id: 'beam-shared', kind: 'beam' });
    const renderer = await ReactThreeTestRenderer.create(
      <OverSpanHighlight member={member} />,
    );
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.material).toBe(HIGHLIGHT_MATERIAL);
    await renderer.unmount();
  });

  it('mesh renderOrder is the pinned HIGHLIGHT_RENDER_ORDER (depth-correct, no forced top)', async () => {
    // Opaque-box redesign: the highlight is depth-correct and no
    // longer force-drawn on top. HIGHLIGHT_RENDER_ORDER is 0 so
    // the highlight sorts with other opaque scene primitives and
    // real z-depth decides visibility.
    const member = makeMember({ id: 'joist-top', kind: 'joist' });
    const renderer = await ReactThreeTestRenderer.create(
      <OverSpanHighlight member={member} />,
    );
    const mesh = renderer.scene.findByType('Mesh').instance as Mesh;
    expect(mesh.renderOrder).toBe(HIGHLIGHT_RENDER_ORDER);
    await renderer.unmount();
  });

  it('TWO OverSpanHighlights SHARE the same geometry + material instance', async () => {
    // Guard: a refactor that constructed geometry/material inside
    // the component (instead of importing the module-level
    // singleton) would flip this test — every highlight would get
    // its own instance and the shared-primitive discipline breaks.
    const memberA = makeMember({ id: 'a', kind: 'joist' });
    const memberB = makeMember({ id: 'b', kind: 'beam' });
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <OverSpanHighlight member={memberA} />
        <OverSpanHighlight member={memberB} />
      </>,
    );
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(2);
    expect(meshes[0]!.geometry).toBe(HIGHLIGHT_BOX_GEOMETRY);
    expect(meshes[1]!.geometry).toBe(HIGHLIGHT_BOX_GEOMETRY);
    expect(meshes[0]!.material).toBe(HIGHLIGHT_MATERIAL);
    expect(meshes[1]!.material).toBe(HIGHLIGHT_MATERIAL);
    await renderer.unmount();
  });
});
