/**
 * Unit tests for `src/scene/layers/BlockingLayer.tsx` — the S22
 * blocking-mesh layer, made DORMANT in S26 FIX #6 (review-gate).
 *
 * ## What this file used to cover
 *
 * Pre-FIX #6 this file registered the shared `layer-suite`
 * (`registerLayerSuite` with `visibilityKey: 'blocking'`) plus a
 * blocking-specific "lumber-material rendering" case. Both hinged
 * on `BlockingLayer` being a `KindLayer` delegate reading
 * `layerVisibility.blocking`.
 *
 * ## What it covers now
 *
 * S26 FIX #6 removed the `blocking` key from `LayerVisibility` (no
 * layout produces `blocking` members, so the toggle was misleading).
 * `BlockingLayer` is now a dormant `() => null` — kept in the tree
 * so a future "blocking between joists" feature can cheaply re-add
 * it. This test pins that behavior: the component MUST render
 * nothing so a stray reintroduction to `DeckLayers.tsx` cannot
 * silently emit anything visible or claim scene-graph slots.
 */
import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';

import { BlockingLayer } from './BlockingLayer';

describe('<BlockingLayer /> — S26 FIX #6 dormant (returns null)', () => {
  it('renders no scene-graph nodes (dormant — kept for future re-attachment)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<BlockingLayer />);
    // The r3f test-renderer's scene root has children only when
    // the component emits something. A dormant `() => null`
    // produces an empty scene subtree.
    expect(renderer.scene.findAllByType('Mesh')).toHaveLength(0);
    expect(renderer.scene.findAllByType('Group')).toHaveLength(0);
    await renderer.unmount();
  });
});
