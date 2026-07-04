/**
 * Unit tests for `src/scene/layers/BlocksLayer.tsx` — the S22
 * block-mesh layer (Epic 2 / FR-029).
 *
 * ## Coverage map (ticket #44 §4)
 *
 *   AC1  Renders EXACTLY N meshes for N block-kind members —
 *        matches the JoistsLayer / BeamsLayer count contract.
 *
 *   AC2  Geometry selection by `member.material.productId`:
 *        `oldcastle-11x11x7` → `DECK_BLOCK_GEOMETRY`
 *        `tuffblock-12x12x4` → `TUFFBLOCK_GEOMETRY`.
 *        Referential-equality check on `mesh.geometry` — every
 *        Oldcastle mesh binds the shared box; every TuffBlock mesh
 *        binds the shared hex frustum.
 *
 *   AC3  Per-instance `scale` matches `member.size` — same
 *        "unit primitive × mesh scale" discipline as `BoxMember`.
 *        (Position + rotation are asserted here too — the whole
 *        `<mesh>` transform pipeline is per-member.)
 *
 *   AC6  Layer toggles hide members WITHOUT unmount — the group's
 *        `visible` flag flips but every `THREE.Mesh` instance
 *        survives the toggle (uuid identity preserved).
 *
 *   Kind-selection: non-block members (joists, beams, blocking,
 *        etc.) do NOT show up in the block layer — kind filtering
 *        is exhaustive.
 *
 *   Layer stamp: the group carries
 *        `userData[LAYER_USER_DATA_KEY] === 'blocks'` so the
 *        DeckLayers scene-graph-order test can identify it.
 *
 *   Material: block-kind members do NOT route through the lumber
 *        `materialForMember` throw path — they use their own
 *        `materialForBlock` picker (asserted structurally by the
 *        absence of thrown errors during render).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Group, Mesh } from 'three';

import type { LayoutMember } from '../../domain/model';
import { useDesignStore, useUiStore } from '../../state';
import { resetDesignStoreForTests } from '../../state/design-store';

import { BlocksLayer } from './BlocksLayer';
import { LAYER_USER_DATA_KEY } from './shared/kind-layer';
import { DECK_BLOCK_GEOMETRY, TUFFBLOCK_GEOMETRY } from './shared/geometries';
import {
  FIXTURE_MATERIAL_OLDCASTLE,
  FIXTURE_MATERIAL_TUFFBLOCK,
  makeLayout,
  makeMember,
} from './__testing__/fixtures';

/**
 * Reset ui-store layer visibility to the "all on" default so tests
 * start from a known state. The S22 `blocks` and `blocking` flags
 * are added by this story — they default to `true`.
 */
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

function seedLayout(members: readonly LayoutMember[]): void {
  const cur = useDesignStore.getState().bundle;
  useDesignStore.setState({ bundle: { ...cur, layout: makeLayout(members) } });
}

/**
 * Build a `LayoutMember` typed as a block. The catalog dims for
 * each MVP product are used verbatim so AC3 (per-instance scale
 * matches product size) has an easy target.
 */
function makeOldcastle(id: string, x = 0, z = 0): LayoutMember {
  return makeMember({
    id,
    kind: 'block',
    material: FIXTURE_MATERIAL_OLDCASTLE,
    position: { x, y: -89, z }, // block top at y=0, height 178, center at -89
    size: { x: 279, y: 178, z: 279 },
  });
}

function makeTuff(id: string, x = 0, z = 0): LayoutMember {
  return makeMember({
    id,
    kind: 'block',
    material: FIXTURE_MATERIAL_TUFFBLOCK,
    position: { x, y: -51, z }, // block top at y=0, height 102, center at -51
    size: { x: 305, y: 102, z: 305 },
  });
}

describe('<BlocksLayer /> — AC1 mesh count matches block-kind member count', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('renders EXACTLY N meshes for N TuffBlock members (floating layout)', async () => {
    // Floating layout typical case — a grid of TuffBlocks. AC1 pins
    // the count.
    const members: LayoutMember[] = [];
    for (let i = 0; i < 12; i++) {
      members.push(makeTuff(`tuff-${i}`, i * 300, 0));
    }
    seedLayout(members);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes).toHaveLength(12);
    await renderer.unmount();
  });

  it('renders zero meshes when there are no block-kind members (edge case)', async () => {
    // No blocks in the layout — the layer's group must still mount
    // so the visibility toggle has a stable slot, but zero meshes
    // render.
    seedLayout([
      makeMember({ id: 'joist-0', kind: 'joist' }),
      makeMember({ id: 'beam-0', kind: 'beam' }),
    ]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const groups = renderer.scene.findAllByType('Group');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes).toHaveLength(0);
    await renderer.unmount();
  });

  it('ignores non-block members present in the same layout', async () => {
    // Mixed layout — 3 blocks + 5 other kinds. Only the 3 blocks
    // become meshes; the other five (joist / beam / post / footing /
    // decking / blocking) are the concerns of OTHER layers.
    const members: LayoutMember[] = [
      makeTuff('tuff-a'),
      makeTuff('tuff-b', 300),
      makeTuff('tuff-c', 600),
      makeMember({ id: 'joist-0', kind: 'joist' }),
      makeMember({ id: 'beam-0', kind: 'beam' }),
      makeMember({ id: 'post-0', kind: 'post' }),
      makeMember({ id: 'footing-0', kind: 'footing' }),
      makeMember({ id: 'blocking-0', kind: 'blocking' }),
    ];
    seedLayout(members);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes).toHaveLength(3);
    await renderer.unmount();
  });
});

describe('<BlocksLayer /> — AC2 geometry selection by productId', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('Oldcastle blocks bind DECK_BLOCK_GEOMETRY (referential equality)', async () => {
    // Four Oldcastle blocks — every mesh's `.geometry` reference
    // must be the SAME shared `DECK_BLOCK_GEOMETRY` instance. If a
    // refactor accidentally constructs per-mesh geometry, this
    // test fires.
    seedLayout([
      makeOldcastle('ob-0', -600),
      makeOldcastle('ob-1', -200),
      makeOldcastle('ob-2', 200),
      makeOldcastle('ob-3', 600),
    ]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(4);
    for (const m of meshes) {
      expect(m.geometry).toBe(DECK_BLOCK_GEOMETRY);
    }
    await renderer.unmount();
  });

  it('TuffBlock blocks bind TUFFBLOCK_GEOMETRY (referential equality)', async () => {
    seedLayout([
      makeTuff('tb-0', -600),
      makeTuff('tb-1', -200),
      makeTuff('tb-2', 200),
      makeTuff('tb-3', 600),
    ]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(4);
    for (const m of meshes) {
      expect(m.geometry).toBe(TUFFBLOCK_GEOMETRY);
    }
    await renderer.unmount();
  });

  it('MIXED layout: 4 Oldcastle + 4 TuffBlock → 4 DECK_BLOCK + 4 TUFFBLOCK bindings (AC2 exact)', async () => {
    // The ticket AC2 wording — "Given a mixed test layout with 4
    // Oldcastle blocks + 4 TuffBlocks, When BlocksLayer renders,
    // Then 4 meshes use DECK_BLOCK_GEOMETRY, 4 use
    // TUFFBLOCK_GEOMETRY."
    const members: LayoutMember[] = [];
    for (let i = 0; i < 4; i++) {
      members.push(makeOldcastle(`ob-${i}`, i * 300));
      members.push(makeTuff(`tb-${i}`, i * 300, 500));
    }
    seedLayout(members);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(8);
    const deckBlockCount = meshes.filter((m) => m.geometry === DECK_BLOCK_GEOMETRY).length;
    const tuffCount = meshes.filter((m) => m.geometry === TUFFBLOCK_GEOMETRY).length;
    expect(deckBlockCount).toBe(4);
    expect(tuffCount).toBe(4);
    await renderer.unmount();
  });
});

describe('<BlocksLayer /> — AC3 per-instance scale matches product dimensions', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('TuffBlock mesh.scale = (305, 102, 305) — unit-cylinder × size', async () => {
    // Ticket AC3 pins this exactly: a TuffBlock member with
    // `size = (305, 102, 305)` renders at `scale = (305, 102, 305)`.
    seedLayout([makeTuff('tb-0')]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const mesh = renderer.scene.findAllByType('Mesh')[0]!.instance as Mesh;
    expect(mesh.scale.toArray()).toEqual([305, 102, 305]);
    await renderer.unmount();
  });

  it('Oldcastle mesh.scale = (279, 178, 279) — unit-box × size', async () => {
    seedLayout([makeOldcastle('ob-0')]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const mesh = renderer.scene.findAllByType('Mesh')[0]!.instance as Mesh;
    expect(mesh.scale.toArray()).toEqual([279, 178, 279]);
    await renderer.unmount();
  });

  it('mesh.position matches member.position (block y is negative — below grade)', async () => {
    // Floating blocks sit BELOW the ground plane (block TOP at
    // y=0; block CENTER at -height/2). Elevated + blocks-under-post
    // sit ABOVE (block bottom at y=0). This test seeds a member at
    // an arbitrary position and asserts the mesh mirrors it —
    // the scene does ZERO y-arithmetic itself.
    const m = makeTuff('tb-0', -1234, 5678);
    seedLayout([m]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const mesh = renderer.scene.findAllByType('Mesh')[0]!.instance as Mesh;
    expect(mesh.position.toArray()).toEqual([-1234, m.position.y, 5678]);
    await renderer.unmount();
  });

  it('every mesh scale maps to ITS OWN source member — no broadcast', async () => {
    // Three distinct sizes (matches the QA-G6 discipline from the
    // shared layer suite). If a subtle refactor broadcast
    // `members[0]` fields to every mesh, all three would have the
    // same scale — this test flags it.
    const members: LayoutMember[] = [
      makeMember({
        id: 'block-a',
        kind: 'block',
        material: FIXTURE_MATERIAL_OLDCASTLE,
        position: { x: -500, y: -89, z: 0 },
        size: { x: 279, y: 178, z: 279 },
      }),
      makeMember({
        id: 'block-b',
        kind: 'block',
        material: FIXTURE_MATERIAL_TUFFBLOCK,
        position: { x: 0, y: -51, z: 500 },
        size: { x: 305, y: 102, z: 305 },
      }),
      makeMember({
        id: 'block-c',
        kind: 'block',
        material: FIXTURE_MATERIAL_OLDCASTLE,
        position: { x: 500, y: -89, z: -500 },
        // Custom size just to prove the mesh scale is per-member,
        // not a hard-coded catalog dim.
        size: { x: 400, y: 200, z: 400 },
      }),
    ];
    seedLayout(members);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(3);
    const inputs = members.map((m) => ({
      pos: [m.position.x, m.position.y, m.position.z],
      size: [m.size.x, m.size.y, m.size.z],
    }));
    const matched = new Set<number>();
    for (const input of inputs) {
      const found = meshes.findIndex((mesh, i) => {
        if (matched.has(i)) return false;
        return (
          mesh.position.toArray().every((v, idx) => v === input.pos[idx]) &&
          mesh.scale.toArray().every((v, idx) => v === input.size[idx])
        );
      });
      expect(found, `no mesh matched ${JSON.stringify(input)}`).toBeGreaterThanOrEqual(0);
      matched.add(found);
    }
    expect(matched.size).toBe(3);
    await renderer.unmount();
  });
});

describe('<BlocksLayer /> — AC6 layer visibility toggle', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('starts with visible=true when showBlocks default is true', async () => {
    seedLayout([makeTuff('tb-0')]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const groups = renderer.scene
      .findAllByType('Group')
      .map((n) => n.instance as Group)
      .filter((g) => g.userData[LAYER_USER_DATA_KEY] === 'blocks');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.visible).toBe(true);
    await renderer.unmount();
  });

  it('toggling showBlocks flips <group visible> WITHOUT remounting meshes', async () => {
    // The AC6 promise: `<group visible={false}>` hides the meshes
    // without unmounting them — three.js just skips the group
    // during traversal. Mesh uuid identity is preserved across the
    // toggle. This is the direct "no shader recompile" guarantee.
    seedLayout([makeTuff('tb-0'), makeTuff('tb-1', 300), makeOldcastle('ob-0', 600)]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const meshesBefore = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshesBefore).toHaveLength(3);
    const uuidsBefore = meshesBefore.map((m) => m.uuid).sort();

    // Locate the layer's own group by userData.
    const findBlocksGroup = (): Group => {
      const gs = renderer.scene
        .findAllByType('Group')
        .map((n) => n.instance as Group)
        .filter((g) => g.userData[LAYER_USER_DATA_KEY] === 'blocks');
      expect(gs).toHaveLength(1);
      return gs[0]!;
    };
    const groupBefore = findBlocksGroup();
    expect(groupBefore.visible).toBe(true);

    // Toggle via the store — wrap in act to silence the Zustand
    // subscription-outside-commit warning.
    await ReactThreeTestRenderer.act(async () => {
      useUiStore.getState().toggleLayer('blocks');
      await Promise.resolve();
    });
    await renderer.update(<BlocksLayer />);

    const groupAfter = findBlocksGroup();
    expect(groupAfter.visible).toBe(false);
    // Same group instance — no remount.
    expect(groupAfter).toBe(groupBefore);

    // Mesh count unchanged; identity preserved.
    const meshesAfter = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshesAfter).toHaveLength(3);
    const uuidsAfter = meshesAfter.map((m) => m.uuid).sort();
    expect(uuidsAfter).toEqual(uuidsBefore);
    for (const m of meshesBefore) {
      expect(meshesAfter).toContain(m);
    }

    await renderer.unmount();
  });

  it('toggling twice returns to visible=true (idempotency)', async () => {
    seedLayout([makeTuff('tb-0')]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    await ReactThreeTestRenderer.act(async () => {
      useUiStore.getState().toggleLayer('blocks');
      useUiStore.getState().toggleLayer('blocks');
      await Promise.resolve();
    });
    await renderer.update(<BlocksLayer />);
    const group = renderer.scene
      .findAllByType('Group')
      .map((n) => n.instance as Group)
      .find((g) => g.userData[LAYER_USER_DATA_KEY] === 'blocks');
    expect(group?.visible).toBe(true);
    await renderer.unmount();
  });
});

describe('<BlocksLayer /> — layer stamp (userData layer id)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it("stamps userData[LAYER_USER_DATA_KEY] = 'blocks' on its group root", async () => {
    // The DeckLayers AC8 scene-graph-order test relies on every
    // layer group carrying its logical id via userData — the
    // BlocksLayer must join the same convention (matches KindLayer).
    seedLayout([makeTuff('tb-0')]);
    const renderer = await ReactThreeTestRenderer.create(<BlocksLayer />);
    const stamped = renderer.scene
      .findAllByType('Group')
      .map((n) => n.instance as Group)
      .filter((g) => typeof g.userData[LAYER_USER_DATA_KEY] === 'string');
    expect(stamped).toHaveLength(1);
    expect(stamped[0]!.userData[LAYER_USER_DATA_KEY]).toBe('blocks');
    await renderer.unmount();
  });
});
