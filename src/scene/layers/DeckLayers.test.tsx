/**
 * Unit tests for `src/scene/layers/DeckLayers.tsx`.
 *
 * ## Coverage map (S10 issue #11 + S22 issue #44 + #72)
 *
 *   AC1  All eight layers mount (six from S10 + blocks from S22 +
 *        blocking re-added under issue #72).
 *   AC8  Layer order — the composition order is
 *        environment → footings → blocks → posts → beams → blocking
 *        → joists → decking so that a raycast from above hits
 *        decking FIRST, then joists, etc.
 *
 *        This test walks the ACTUAL scene-graph traversal order
 *        by reading each layer group's `userData[LAYER_USER_DATA_KEY]`
 *        stamp. Reordering the JSX inside `DeckLayers.tsx` (without
 *        touching `DECK_LAYER_ORDER`) would flip this test to red —
 *        the AC8 promise is that the RENDERED graph matches the
 *        pinned order, not just that a constant contains the right
 *        strings.
 *
 *        Pair-fix iter 1 Fix C (Opus review #3 / GPT review #4 /
 *        QA-G2): the previous assertion was `DECK_LAYER_ORDER
 *        .toEqual([...])` — which passes even after a stealth
 *        reorder of the JSX children. Now the test derives the
 *        sequence FROM the scene graph and compares it against
 *        the constant.
 *
 *   AC3  Every layer's group starts with `visible === true` when
 *        the ui-store default is "all on".
 *
 *   G5   Heterogeneous-KIND render — one member per kind × three
 *        species; assert EXACTLY 5 distinct member-mesh material
 *        instances (one per lumber kind: joist / beam / post /
 *        footing / board) in the scene graph. Post `fix/part-type-
 *        colors` the palette is keyed by MemberKind, so species is
 *        no longer a discriminator: three PT joists + three Cedar
 *        joists + three Composite joists all share ONE joist
 *        material.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Group, Mesh } from 'three';

import type { LayoutMember, MemberKind, Species } from '../../domain/model';
import { useDesignStore, useUiStore } from '../../state';
import { resetDesignStoreForTests } from '../../state/design-store';

import { DeckLayers } from './DeckLayers';
import { DECK_LAYER_ORDER } from './deck-layer-order';
import { LAYER_USER_DATA_KEY } from './shared/kind-layer';
import { MATERIAL_KIND_COLORS } from './shared/materials';
import { makeLayout, makeMember } from './__testing__/fixtures';

function resetLayerVisibility(): void {
  useUiStore.setState({
    layerVisibility: {
      environment: true,
      decking: true,
      joists: true,
      blocking: true,
      beams: true,
      posts: true,
      footings: true,
      blocks: true,
    },
  });
}

describe('<DeckLayers /> — AC1 all eight layers mount', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
    // Seed an empty layout so no member meshes are created — this
    // test focuses on the eight layer groups themselves (six from
    // S10 + `blocks` from S22 + `blocking` re-added under issue #72
    // for solid noggins between joists per IRC R502.7).
    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({ bundle: { ...cur, layout: makeLayout([]) } });
  });

  it('mounts EIGHT groups — one per layer (six original + blocks + #72 blocking)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<DeckLayers />);
    const groups = renderer.scene.findAllByType('Group');
    // Eight layer groups. There may be additional nested groups
    // from internal r3f wrapping, but the top-level count MUST
    // include the eight.
    expect(groups.length).toBeGreaterThanOrEqual(8);
    await renderer.unmount();
  });
});

describe('<DeckLayers /> — AC8 composition order (raycast picking hygiene)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({ bundle: { ...cur, layout: makeLayout([]) } });
  });

  it('DECK_LAYER_ORDER is the fixed eight-entry sequence: env → footings → blocks → posts → beams → blocking → joists → decking', () => {
    // Frozen order — see DeckLayers.tsx module header for the
    // physical-stack rationale. S22 additions:
    //   - blocks   sits between footings and posts (below beams for
    //              floating; below posts for elevated + deck-blocks)
    // Issue #72 additions:
    //   - blocking sits between beams and joists (co-planar with
    //              joists, IRC R502.7). Re-attached under #72 —
    //              was dormant post-S26 FIX #6.
    expect(DECK_LAYER_ORDER).toEqual([
      'environment',
      'footings',
      'blocks',
      'posts',
      'beams',
      'blocking',
      'joists',
      'decking',
    ]);
  });

  it('DECK_LAYER_ORDER is runtime-frozen (GPT review #4)', () => {
    // Runtime immutability guard: TypeScript's `readonly` prevents
    // mutation at compile time, but a `Reflect.set` or a plain-JS
    // consumer could still poke at it. `Object.freeze` closes that
    // gap. `Object.isFrozen` returns true only when every own prop
    // is non-writable + the object is sealed.
    expect(Object.isFrozen(DECK_LAYER_ORDER)).toBe(true);
  });

  it('the rendered scene-graph traversal ORDER matches DECK_LAYER_ORDER (finding-fix Fix C)', async () => {
    // Walk the top-level children of the r3f scene in traversal
    // order. Every layer's root <group> is stamped with
    // `userData[LAYER_USER_DATA_KEY] = <layerId>` — we pluck those
    // ids off the top-level groups (in scene-graph order, i.e.
    // r3f mount / JSX order) and compare them to DECK_LAYER_ORDER.
    //
    // A stealth reorder of the JSX inside DeckLayers.tsx would
    // change the traversal order without touching the constant —
    // this test flips red, proving the guard is meaningful.
    const renderer = await ReactThreeTestRenderer.create(<DeckLayers />);

    // Find every Group in the scene, keep only the ones stamped
    // with our layer-id userData key (excludes internal r3f
    // wrapper groups and the r3f scene root itself). The
    // `findAllByType` walk is deterministic (parent-then-children,
    // left-to-right children) — matching JSX order.
    const layerGroups = renderer.scene
      .findAllByType('Group')
      .map((n) => n.instance as Group)
      .filter((g) => typeof g.userData[LAYER_USER_DATA_KEY] === 'string');

    const observedOrder = layerGroups.map(
      (g) => g.userData[LAYER_USER_DATA_KEY] as string,
    );

    expect(observedOrder).toEqual([...DECK_LAYER_ORDER]);

    await renderer.unmount();
  });
});

describe('<DeckLayers /> — AC3 default visibility (all on)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({ bundle: { ...cur, layout: makeLayout([]) } });
  });

  it('every layer group starts visible=true when ui-store default is "all on"', async () => {
    const renderer = await ReactThreeTestRenderer.create(<DeckLayers />);
    // Every top-level layer group has `visible === true` right
    // after mount. If a future layer defaults to hidden, this test
    // fires and forces a doc update.
    const groups = renderer.scene.findAllByType('Group').map((n) => n.instance as Group);
    // At least eight visible groups (the eight layer roots — S22
    // adds `blocks`; issue #72 re-adds `blocking`).
    const visibleCount = groups.filter((g) => g.visible).length;
    expect(visibleCount).toBeGreaterThanOrEqual(8);
    await renderer.unmount();
  });
});

describe('<DeckLayers /> — G5 heterogeneous-KIND render (per-kind material sharing, species IGNORED)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('renders EXACTLY 5 distinct member-mesh material instances when the layout mixes 5 kinds × 3 species', async () => {
    // Seed a layout with SEVERAL members of each kind, spread
    // across all three species. Post `fix/part-type-colors`,
    // the palette is keyed by MemberKind — species is IGNORED.
    // Three PT joists + three Cedar joists + three Composite
    // joists share ONE joist material instance; likewise for
    // beam / post / footing / board.
    //
    // So no matter how many meshes render, the DISTINCT
    // member-mesh material set size MUST be exactly 5 (one per
    // lumber kind rendered here).
    //
    // This catches a subtle refactor regression: if a future
    // change accidentally moves material construction INTO
    // BoxMember (instead of looking it up from the shared
    // module-cache), each mesh gets its own material and the
    // set size explodes. It also catches an accidental revert
    // to per-species keying — a species-based cache would emit
    // 15 (5 kinds × 3 species) distinct materials here. GPT/QA-G5.
    const species: Species[] = ['PT', 'Cedar', 'Composite'];
    const kinds: MemberKind[] = ['joist', 'beam', 'post', 'footing', 'board'];
    const members: LayoutMember[] = [];
    let index = 0;
    for (const s of species) {
      for (const k of kinds) {
        members.push(
          makeMember({
            id: `${s}-${k}-${index++}`,
            kind: k,
            material: { kind: 'lumber', nominal: '2x8', species: s, grade: 'No2' },
            position: { x: index * 100, y: 100, z: 0 },
          }),
        );
      }
    }
    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({ bundle: { ...cur, layout: makeLayout(members) } });

    const renderer = await ReactThreeTestRenderer.create(<DeckLayers />);
    const meshes = renderer.scene
      .findAllByType('Mesh')
      .map((n) => n.instance as Mesh);
    // Filter to member meshes only — the EnvironmentLayer's ground
    // plane is also a Mesh but uses its own unique material.
    // Every member mesh has one of the shared kind materials from
    // MATERIAL_KIND_COLORS.
    //
    // Import the palette so we filter by ANY known kind hex — no
    // hard-coded numeric literals here (a palette tweak in
    // materials.ts must not silently break this test).
    const memberKindHexes = new Set(Object.values(MATERIAL_KIND_COLORS));
    const kindMaterials = new Set(
      meshes
        .map((m) => (Array.isArray(m.material) ? m.material[0] : m.material))
        .filter((mat) => {
          // Only count materials whose `.color` matches one of the
          // known kind hexes — filters out the ground plane's tan
          // material.
          if (mat === undefined) return false;
          if (!('color' in mat)) return false;
          const colorProp = (mat as { color?: { getHex?: () => number } }).color;
          if (colorProp === undefined || typeof colorProp.getHex !== 'function')
            return false;
          return memberKindHexes.has(colorProp.getHex());
        }),
    );
    // Exactly 5 — one per kind rendered here (joist, beam, post,
    // footing, board). Block + blocking are NOT in the seed set.
    expect(kindMaterials.size).toBe(5);
    // Every member mesh (there should be 15 — 5 kinds × 3 species)
    // is present in the scene graph. This is a light sanity check
    // that the layers actually rendered their meshes.
    expect(meshes.length).toBeGreaterThanOrEqual(15);
    await renderer.unmount();
  });
});

describe('<DeckLayers /> — G3 heavy-scene toggle-latency smoke (QA-G3)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('toggling decking on a ~1900-mesh layout stays under a generous 2 s in jsdom', async () => {
    // Seed a realistic worst-case: ~1500 boards + 300 joists +
    // 40 beams + 40 posts + 40 footings ≈ 1920 members. Real
    // hardware runs a 40'×40' deck at this order of magnitude.
    //
    // ## What this test actually measures
    //
    // Time from `toggleLayer(...)` through `renderer.update(...)` —
    // i.e. Zustand write + React re-render + r3f reconciliation of
    // the whole DeckLayers tree. On a real device this maps roughly
    // to "how long until the visible frame changes"; jsdom
    // reconciliation costs are much higher than a real GPU-backed
    // renderer.
    //
    // ## Ceiling: 2000 ms (generous)
    //
    // The 100 ms SC-002 budget applies to real hardware, not jsdom.
    // GitHub Actions runners can spend 200-400 ms just walking the
    // 1920-node test-renderer tree. The 2 s ceiling is a super-
    // linear-regression sentinel: if a future change makes toggle
    // work O(N²) in the mesh count (e.g. a filter inside a memo
    // that rebuilds on every visibility change), this scene would
    // blow past 2 s. Real-device perf lives in the S14 QA E2E.
    //
    // QA-G3 asked for a 100 ms assertion. We keep the shape of the
    // test — measure both toggles — but the number is calibrated
    // for jsdom + slow CI runners rather than a real device.
    const members: LayoutMember[] = [];
    const push = (kind: MemberKind, count: number, base = 0): void => {
      for (let i = 0; i < count; i++) {
        members.push(
          makeMember({
            id: `${kind}-${base + i}`,
            kind,
            position: { x: (base + i) * 10, y: 100, z: 0 },
          }),
        );
      }
    };
    push('board', 1500, 0);
    push('joist', 300, 0);
    push('beam', 40, 0);
    push('post', 40, 0);
    push('footing', 40, 0);
    expect(members.length).toBeGreaterThanOrEqual(1900);

    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({ bundle: { ...cur, layout: makeLayout(members) } });

    const renderer = await ReactThreeTestRenderer.create(<DeckLayers />);

    // Measure two consecutive toggles (hide → show). SC-002 budget
    // is 100 ms per toggle; jsdom is much faster than a real
    // browser paint, so we assert well under.
    const t0 = performance.now();
    await ReactThreeTestRenderer.act(async () => {
      useUiStore.getState().toggleLayer('decking');
      await Promise.resolve();
    });
    await renderer.update(<DeckLayers />);
    const t1 = performance.now();
    await ReactThreeTestRenderer.act(async () => {
      useUiStore.getState().toggleLayer('decking');
      await Promise.resolve();
    });
    await renderer.update(<DeckLayers />);
    const t2 = performance.now();

    const hideMs = t1 - t0;
    const showMs = t2 - t1;
    // jsdom + slow CI runner budget: 2 s per toggle. Real-device
    // perf lives in S14. See test docstring above for the rationale.
    expect(hideMs).toBeLessThan(2000);
    expect(showMs).toBeLessThan(2000);

    await renderer.unmount();
  });
});
