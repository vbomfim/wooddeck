/**
 * Unit tests for `src/scene/layers/index.ts` — the layers barrel.
 *
 * Locks the public surface described in the S10 issue #11 §2
 * component map: eight active layer components (six from S10 +
 * `BlocksLayer` from S22 + `BlockingLayer` re-attached under issue
 * #72) + the `<DeckLayers>` convenience bundle + the
 * `DECK_LAYER_ORDER` constant is exported by NAME (S12's
 * `AppShell` will import from this barrel).
 *
 * S26 FIX #6 (review-gate): `blocking` was originally removed from
 * the toggle panel + `LayerVisibility` + `DECK_LAYER_ORDER` because
 * no layout produced `blocking` members. Under issue #72 the
 * layout pipelines now emit blocking (IRC R502.7 solid noggins
 * between joists), so the toggle + layer are RE-ATTACHED.
 */
import { describe, expect, it } from 'vitest';

import * as layers from './index';

describe('layers/index barrel — frozen public surface', () => {
  it('exports the eight active layer components by name', () => {
    expect(typeof layers.EnvironmentLayer).toBe('function');
    expect(typeof layers.DeckingLayer).toBe('function');
    expect(typeof layers.JoistsLayer).toBe('function');
    expect(typeof layers.BeamsLayer).toBe('function');
    expect(typeof layers.PostsLayer).toBe('function');
    expect(typeof layers.FootingsLayer).toBe('function');
    // S22 (Epic 2 / FR-029).
    expect(typeof layers.BlocksLayer).toBe('function');
    // Issue #72 — re-attached (was dormant post-S26 FIX #6).
    expect(typeof layers.BlockingLayer).toBe('function');
  });

  it('exports the <DeckLayers> convenience bundle + its order constant', () => {
    // S12 AppShell drop-in usage: `<DeckScene><DeckLayers/></DeckScene>`.
    expect(typeof layers.DeckLayers).toBe('function');
    expect(Array.isArray(layers.DECK_LAYER_ORDER)).toBe(true);
    // Issue #72 re-added `blocking` — order is now EIGHT entries
    // (six original + blocks + blocking).
    expect(layers.DECK_LAYER_ORDER).toHaveLength(8);
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
