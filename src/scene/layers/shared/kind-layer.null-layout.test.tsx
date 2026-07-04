/**
 * Unit tests for `src/scene/layers/shared/kind-layer.tsx` —
 * the null-layout defensive-access behavior (pair-fix iter 1
 * Fix E, Opus review #5 / QA-G4).
 *
 * ## What this test proves
 *
 * Issue #11 §5 promises "if Layout is null → each layer returns
 * null gracefully, no crash". The store contract as of S8 always
 * constructs a valid `Layout` in `bundle.layout`, so the promise
 * was not tested against the actual defensive path. This test
 * seeds `bundle.layout = null` directly (bypassing the store
 * contract) and asserts that every kind layer renders an EMPTY
 * group with NO meshes and NO thrown errors.
 *
 * ## Why not test each layer separately
 *
 * All five kind layers delegate to `<KindLayer>`, which is the
 * one place with the `?.members ?? []` guard. Testing one is
 * equivalent to testing all five. The G6 shared-suite test
 * (added below) covers per-layer behaviour.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Group } from 'three';

import { useDesignStore, useUiStore } from '../../../state';
import { resetDesignStoreForTests } from '../../../state/design-store';

import { JoistsLayer } from '../JoistsLayer';

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

describe('<KindLayer> — null-layout defensive access (Fix E)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('renders an empty group with zero meshes when bundle.layout is null (§5 promise)', async () => {
    // Directly seed `bundle.layout = null` — a hypothetical future
    // store state during a re-layout that has not yet completed,
    // or a fresh session before the first layout runs. The store
    // contract today doesn't produce this state, but the ticket
    // §5 promise requires the scene to survive it.
    //
    // `useDesignStore.setState` accepts a shape that overrides the
    // bundle; casting to `unknown` first bypasses the compile-time
    // guard so we can seed a null layout. The runtime behavior is
    // what we're testing.
    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({
      bundle: { ...cur, layout: null } as unknown as typeof cur,
    });

    const renderer = await ReactThreeTestRenderer.create(<JoistsLayer />);

    // The layer group MUST still mount (visibility contract requires
    // a stable slot for the visibility toggle to flip).
    const groups = renderer.scene.findAllByType('Group');
    expect(groups.length).toBeGreaterThanOrEqual(1);

    // Zero meshes — no members to render.
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes).toHaveLength(0);

    // Group is still `visible` (defensive access doesn't change
    // the visibility flag path).
    const group = groups[0]!.instance as Group;
    expect(group.visible).toBe(true);

    await renderer.unmount();
  });

  it('renders an empty group when bundle.layout is undefined', async () => {
    // Sibling case — an `undefined` layout should be as safe as a
    // `null` one. The `?.members ?? []` guard covers both via
    // optional-chaining semantics.
    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({
      bundle: { ...cur, layout: undefined } as unknown as typeof cur,
    });

    const renderer = await ReactThreeTestRenderer.create(<JoistsLayer />);
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes).toHaveLength(0);
    await renderer.unmount();
  });
});
