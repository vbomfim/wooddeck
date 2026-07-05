/**
 * Unit tests for `src/scene/layers/index.ts` — the layers barrel.
 *
 * Locks the public surface described in the S10 issue #11 §2
 * component map: seven active layer components (six from S10 +
 * `BlocksLayer` from S22) + the `<DeckLayers>` convenience bundle
 * + the `DECK_LAYER_ORDER` constant is exported by NAME (S12's
 * `AppShell` will import from this barrel).
 *
 * S26 FIX #6 (review-gate): `blocking` was removed from the toggle
 * panel + `LayerVisibility` + `DECK_LAYER_ORDER` because no layout
 * produces `blocking` members. `BlockingLayer` is kept in the tree
 * DORMANT (returns null) for a cheap future re-attachment path.
 */
import { describe, expect, it } from 'vitest';

import * as layers from './index';

describe('layers/index barrel — frozen public surface', () => {
  it('exports the seven active layer components by name', () => {
    expect(typeof layers.EnvironmentLayer).toBe('function');
    expect(typeof layers.DeckingLayer).toBe('function');
    expect(typeof layers.JoistsLayer).toBe('function');
    expect(typeof layers.BeamsLayer).toBe('function');
    expect(typeof layers.PostsLayer).toBe('function');
    expect(typeof layers.FootingsLayer).toBe('function');
    // S22 (Epic 2 / FR-029) — still active.
    expect(typeof layers.BlocksLayer).toBe('function');
    // S22 addition — S26 FIX #6 made this DORMANT (returns null)
    // but the export is preserved to keep the future-reactivation
    // path cheap. It still resolves as a function.
    expect(typeof layers.BlockingLayer).toBe('function');
  });

  it('exports the <DeckLayers> convenience bundle + its order constant', () => {
    // S12 AppShell drop-in usage: `<DeckScene><DeckLayers/></DeckScene>`.
    expect(typeof layers.DeckLayers).toBe('function');
    expect(Array.isArray(layers.DECK_LAYER_ORDER)).toBe(true);
    // S26 FIX #6 (review-gate): removed `blocking` from the order.
    // The order is now SEVEN entries (six original + blocks).
    expect(layers.DECK_LAYER_ORDER).toHaveLength(7);
  });

  it('exports the shared material helpers so downstream (S11 warning overlay) can align', () => {
    // Post `fix/part-type-colors`: coloured by MemberKind, not by
    // species — `materialForKind` replaces `materialForSpecies`,
    // and `MATERIAL_KIND_COLORS` replaces the two prior palette
    // records (`MATERIAL_COLORS` + `MATERIAL_BLOCK_COLORS`).
    expect(typeof layers.materialForKind).toBe('function');
    expect(typeof layers.materialForMember).toBe('function');
    expect(layers.MATERIAL_KIND_COLORS).toBeDefined();
    expect(typeof layers.materialForBlock).toBe('function');
  });
});
