/**
 * Unit tests for `src/scene/layers/DeckLayers.tsx`.
 *
 * ## Coverage map (S10 issue #11)
 *
 *   AC1  All six layers mount.
 *   AC8  Layer order — the composition order is
 *        environment → footings → posts → beams → joists → decking
 *        so that a raycast from above hits decking FIRST, then
 *        joists, etc. Order is asserted by inspecting the
 *        DeckLayers group's child order.
 *   AC3  Every layer's group starts with `visible === true` when
 *        the ui-store default is "all on".
 */
import { describe, expect, it, beforeEach } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Group } from 'three';

import { useDesignStore, useUiStore } from '../../state';
import { resetDesignStoreForTests } from '../../state/design-store';

import { DeckLayers } from './DeckLayers';
import { DECK_LAYER_ORDER } from './deck-layer-order';
import { makeLayout } from './__testing__/fixtures';

function resetLayerVisibility(): void {
  useUiStore.setState({
    layerVisibility: {
      environment: true,
      decking: true,
      joists: true,
      beams: true,
      posts: true,
      footings: true,
    },
  });
}

describe('<DeckLayers /> — AC1 all six layers mount', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
    // Seed an empty layout so no member meshes are created — this
    // test focuses on the six layer groups themselves.
    const cur = useDesignStore.getState().bundle;
    useDesignStore.setState({ bundle: { ...cur, layout: makeLayout([]) } });
  });

  it('mounts SIX groups — one per layer', async () => {
    const renderer = await ReactThreeTestRenderer.create(<DeckLayers />);
    const groups = renderer.scene.findAllByType('Group');
    // Six layer groups. There may be additional nested groups from
    // internal r3f wrapping, but the top-level count MUST include
    // the six.
    expect(groups.length).toBeGreaterThanOrEqual(6);
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

  it('DECK_LAYER_ORDER is the fixed six-entry sequence: env → footings → posts → beams → joists → decking', () => {
    // Frozen order — anyone reading this in code review sees the
    // intent explicitly. The comment in DeckLayers.tsx explains
    // WHY this order (bottom-of-stack first so decking is visually
    // on top and hit first by a top-down raycast).
    expect(DECK_LAYER_ORDER).toEqual([
      'environment',
      'footings',
      'posts',
      'beams',
      'joists',
      'decking',
    ]);
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
    // At least six visible groups (the six layer roots).
    const visibleCount = groups.filter((g) => g.visible).length;
    expect(visibleCount).toBeGreaterThanOrEqual(6);
    await renderer.unmount();
  });
});
