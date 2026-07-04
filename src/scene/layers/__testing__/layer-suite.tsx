/**
 * `src/scene/layers/__testing__/layer-suite.tsx` — shared assertions
 * for the five kind-scoped layer components (Decking / Joists /
 * Beams / Posts / Footings).
 *
 * ## Why one factory instead of five copy-paste test files
 *
 * The five kind-scoped layers share IDENTICAL structural behaviour:
 *
 *   1. Select the layout members whose `kind === <own kind>`.
 *   2. Read a single boolean from `useUiStore.layerVisibility`.
 *   3. Render `<group visible={visible}>{members.map(BoxMember)}</group>`.
 *
 * If we copy-pasted the AC1 / AC2 / AC3 / edge-case tests into
 * every layer's test file, a bug fix would need to be applied five
 * times. The factory below defines every assertion ONCE — every
 * per-layer test file calls it with its own kind + layer key.
 *
 * ## What each per-layer file adds on top
 *
 * Kind-specific quirks (e.g. footings can render as cubes even
 * though they are physically cylinders — §2) live in the per-layer
 * file. The shared suite handles everything that is NOT a
 * kind-specific behaviour.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ComponentType } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { Group, Mesh } from 'three';

import type { Layout, LayoutMember, MemberKind } from '../../../domain/model';
import type { LayerVisibility } from '../../../state';
import { useDesignStore, useUiStore } from '../../../state';
import { resetDesignStoreForTests } from '../../../state/design-store';

import { makeLayout, makeMember, makeMembers } from './fixtures';

/**
 * Wrap a synchronous callback in an `act()` scope so React commits
 * the resulting store subscription flush INSIDE act's window (the
 * warning "not configured to support act(...)" is suppressed once
 * both `IS_REACT_ACT_ENVIRONMENT = true` AND the update itself is
 * wrapped). The trailing `await Promise.resolve()` satisfies
 * TypeScript-ESLint's `@typescript-eslint/require-await` for the
 * async callback shape r3f's `Act` type mandates.
 */
async function withAct(fn: () => void): Promise<void> {
  await ReactThreeTestRenderer.act(async () => {
    fn();
    await Promise.resolve();
  });
}

/**
 * Overwrite the design store's layout with an arbitrary `Layout`.
 * This bypasses the layout engine so scene tests can test with a
 * known-count member list.
 */
function seedLayout(layout: Layout): void {
  // Set the bundle's layout to `layout`; keep the rest of the
  // bundle intact (default design + empty warnings).
  const cur = useDesignStore.getState().bundle;
  useDesignStore.setState({ bundle: { ...cur, layout } });
}

/**
 * Reset UI store's layer visibility to a KNOWN state so per-test
 * assertions are deterministic (no bleed from a previous test that
 * left a layer hidden).
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

/**
 * Locate the layer's `<group>` in the r3f scene graph. Layer
 * components each render EXACTLY ONE Group as their root, so the
 * first Group found is the layer's own.
 */
function findLayerGroup(renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>): Group {
  const groups = renderer.scene.findAllByType('Group');
  // The `renderer.scene` itself is the root; `findAllByType`
  // returns nested groups. The layer's own Group is the first
  // match under the scene.
  expect(groups.length).toBeGreaterThanOrEqual(1);
  return groups[0]!.instance as Group;
}

export interface LayerSuiteOptions {
  /** The layer component under test (e.g. `JoistsLayer`). */
  readonly Layer: ComponentType;
  /** The `MemberKind` this layer filters on. */
  readonly kind: MemberKind;
  /** The visibility key this layer subscribes to. */
  readonly visibilityKey: keyof LayerVisibility;
  /** Human-friendly display name for test descriptions. */
  readonly displayName: string;
}

/**
 * Register a full acceptance-criteria test suite for one layer.
 * The per-layer .test.tsx file calls this once with its own
 * `Layer` + `kind` + `visibilityKey`.
 */
export function registerLayerSuite({ Layer, kind, visibilityKey, displayName }: LayerSuiteOptions): void {
  describe(`<${displayName} /> — AC1/AC2/AC3 shared behaviour`, () => {
    beforeEach(() => {
      resetLayerVisibility();
      resetDesignStoreForTests();
    });

    it('AC1: mounts a single <group> as its root even when there are zero matching members (edge case)', async () => {
      // Empty-members path: nothing to render, but the group MUST
      // still mount so the composition-root layer stack has a
      // stable slot for visibility toggles. This is the reliability
      // §5 "Layout is null" case, expressed as "layout is
      // non-null but has zero members of my kind".
      seedLayout(makeLayout([]));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);
      const groups = renderer.scene.findAllByType('Group');
      expect(groups.length).toBeGreaterThanOrEqual(1);
      const meshes = renderer.scene.findAllByType('Mesh');
      expect(meshes).toHaveLength(0);
      await renderer.unmount();
    });

    it('AC2: renders EXACTLY N meshes for N members of its kind, ignoring other kinds', async () => {
      // Mix of kinds — only `kind` members become meshes; the rest
      // are filtered out. This proves each layer selects its own
      // slice, not the whole layout.
      const myMembers = makeMembers(kind, 3);
      const otherKind: MemberKind = kind === 'joist' ? 'beam' : 'joist';
      const otherMembers = makeMembers(otherKind, 5);
      seedLayout(makeLayout([...myMembers, ...otherMembers]));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);
      const meshes = renderer.scene.findAllByType('Mesh');
      expect(meshes).toHaveLength(3);
      await renderer.unmount();
    });

    it('AC2: each mesh position matches its member.position (mm → three units)', async () => {
      // Three members at distinct x values; assert each mesh's
      // world-frame position exactly matches the source member.
      const members: LayoutMember[] = [
        makeMember({ id: `${kind}-a`, kind, position: { x: -1000, y: 100, z: 0 } }),
        makeMember({ id: `${kind}-b`, kind, position: { x: 0, y: 200, z: 500 } }),
        makeMember({ id: `${kind}-c`, kind, position: { x: 1000, y: 300, z: -500 } }),
      ];
      seedLayout(makeLayout(members));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);
      const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
      expect(meshes).toHaveLength(3);
      // Sort meshes by position.x so the assertion is stable
      // regardless of scene-graph traversal order.
      const sorted = [...meshes].sort((a, b) => a.position.x - b.position.x);
      expect(sorted[0]!.position.toArray()).toEqual([-1000, 100, 0]);
      expect(sorted[1]!.position.toArray()).toEqual([0, 200, 500]);
      expect(sorted[2]!.position.toArray()).toEqual([1000, 300, -500]);
      await renderer.unmount();
    });

    it('AC2: each mesh scale matches its member.size (full-extent, unit-box scaled)', async () => {
      const members: LayoutMember[] = [
        makeMember({ id: `${kind}-a`, kind, size: { x: 100, y: 200, z: 300 } }),
        makeMember({ id: `${kind}-b`, kind, size: { x: 400, y: 500, z: 600 } }),
      ];
      seedLayout(makeLayout(members));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);
      const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
      expect(meshes).toHaveLength(2);
      const sorted = [...meshes].sort((a, b) => a.scale.x - b.scale.x);
      expect(sorted[0]!.scale.toArray()).toEqual([100, 200, 300]);
      expect(sorted[1]!.scale.toArray()).toEqual([400, 500, 600]);
      await renderer.unmount();
    });

    it('AC3: initial visible=true reflects the store default (all layers on)', async () => {
      seedLayout(makeLayout(makeMembers(kind, 1)));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);
      const group = findLayerGroup(renderer);
      expect(group.visible).toBe(true);
      await renderer.unmount();
    });

    it('AC3: toggling visibility flips <group visible> WITHOUT remounting meshes (finding #6)', async () => {
      // The heart of S10 — the "see underneath" UX requires that
      // toggling a layer NEVER destroys and re-creates the meshes
      // (which would recompile shaders and thrash the GPU). We
      // capture the mesh instance BEFORE the toggle and assert it
      // is the SAME OBJECT after — proving no unmount / remount.
      seedLayout(makeLayout(makeMembers(kind, 2)));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);

      // Baseline: two meshes, group visible.
      const meshesBefore = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
      expect(meshesBefore).toHaveLength(2);
      const uuidsBefore = meshesBefore.map((m) => m.uuid).sort();
      const groupBefore = findLayerGroup(renderer);
      expect(groupBefore.visible).toBe(true);

      // Toggle → the layer's visibility flag flips to false.
      // Wrap the store action + rerender in act() so React commits
      // the subscribed hook update inside the r3f reconciler tick
      // (silences "not configured for act()" warnings from Zustand
      // subscriptions firing outside a React commit boundary).
      await withAct(() => {
        useUiStore.getState().toggleLayer(visibilityKey);
      });
      await renderer.update(<Layer />);

      // Assertion 1: the group's `visible` flag flipped.
      const groupAfterHide = findLayerGroup(renderer);
      expect(groupAfterHide.visible).toBe(false);

      // Assertion 2: the SAME group instance — no group remount.
      expect(groupAfterHide).toBe(groupBefore);

      // Assertion 3: mesh count did NOT drop to zero — meshes are
      // still in the scene graph, just hidden.
      const meshesAfterHide = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
      expect(meshesAfterHide).toHaveLength(2);

      // Assertion 4: mesh IDENTITY preserved — same THREE.Mesh
      // instances, same uuids. This is the direct, non-inferable
      // finding-#6 guarantee: no shader recompile, no GC churn.
      const uuidsAfterHide = meshesAfterHide.map((m) => m.uuid).sort();
      expect(uuidsAfterHide).toEqual(uuidsBefore);
      // Reference equality on the sorted arrays.
      for (const mesh of meshesBefore) {
        expect(meshesAfterHide).toContain(mesh);
      }

      // Toggle again → flip back to visible. Meshes STILL the same
      // instances (idempotency + no remount on show either).
      await withAct(() => {
        useUiStore.getState().toggleLayer(visibilityKey);
      });
      await renderer.update(<Layer />);
      const groupAfterShow = findLayerGroup(renderer);
      expect(groupAfterShow.visible).toBe(true);
      expect(groupAfterShow).toBe(groupBefore);
      const meshesAfterShow = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
      for (const mesh of meshesBefore) {
        expect(meshesAfterShow).toContain(mesh);
      }

      await renderer.unmount();
    });

    it('AC3 idempotency: toggling twice returns to the initial state (edge case)', async () => {
      seedLayout(makeLayout(makeMembers(kind, 1)));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);
      const initialVisible = findLayerGroup(renderer).visible;
      await withAct(() => {
        useUiStore.getState().toggleLayer(visibilityKey);
        useUiStore.getState().toggleLayer(visibilityKey);
      });
      await renderer.update(<Layer />);
      expect(findLayerGroup(renderer).visible).toBe(initialVisible);
      await renderer.unmount();
    });

    it('AC4: layer toggle latency is well under 100 ms in a jsdom test (SC-002)', async () => {
      // A jsdom smoke — real-hardware perf lives in the QA E2E.
      // The toggle path is a Zustand `set` + a React re-render of
      // ONE group's `visible` prop; nothing GPU-side. 100 ms is
      // vastly more headroom than we need.
      seedLayout(makeLayout(makeMembers(kind, 20)));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);
      const t0 = performance.now();
      await withAct(() => {
        useUiStore.getState().toggleLayer(visibilityKey);
      });
      await renderer.update(<Layer />);
      const elapsedMs = performance.now() - t0;
      expect(elapsedMs).toBeLessThan(100);
      await renderer.unmount();
    });

    it('G6: each mesh scale maps to its OWN source member — no broadcast (QA-G6)', async () => {
      // Three DISTINCT sizes AND distinct positions. If a subtle
      // refactor broadcast one member's fields to every mesh (e.g.
      // reading `members[0]` in a loop by mistake), every mesh
      // would end up with the same scale — this test flags the
      // regression by asserting every observed scale tuple is in
      // the input set exactly once.
      const inputs: Array<[[number, number, number], [number, number, number]]> = [
        [[100, 200, 300], [-500, 100, 0]],
        [[400, 500, 600], [0, 200, 500]],
        [[700, 800, 900], [500, 300, -500]],
      ];
      const members = inputs.map(([size, pos], i) =>
        makeMember({
          id: `${kind}-g6-${i}`,
          kind,
          size: { x: size[0], y: size[1], z: size[2] },
          position: { x: pos[0], y: pos[1], z: pos[2] },
        }),
      );
      seedLayout(makeLayout(members));
      const renderer = await ReactThreeTestRenderer.create(<Layer />);
      const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
      expect(meshes).toHaveLength(3);
      // For each input, find a mesh whose position AND scale
      // match. Every input must find a unique mesh — no
      // duplicates, no broadcast, no cross-wire.
      const matchedIndices = new Set<number>();
      for (const [size, pos] of inputs) {
        const meshIndex = meshes.findIndex((m, i) => {
          if (matchedIndices.has(i)) return false;
          return (
            m.position.x === pos[0] &&
            m.position.y === pos[1] &&
            m.position.z === pos[2] &&
            m.scale.x === size[0] &&
            m.scale.y === size[1] &&
            m.scale.z === size[2]
          );
        });
        expect(meshIndex, `input ${JSON.stringify({ size, pos })} matched no mesh`).toBeGreaterThanOrEqual(0);
        matchedIndices.add(meshIndex);
      }
      expect(matchedIndices.size).toBe(3);
      await renderer.unmount();
    });
  });
}
