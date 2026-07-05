/**
 * Unit tests for `src/scene/layers/index.ts` — the layers barrel.
 *
 * Locks the public surface described in the S10 issue #11 §2
 * component map: each of the eight layer components (six from S10
 * plus `BlocksLayer` + `BlockingLayer` from S22) + the
 * `<DeckLayers>` convenience bundle + the `DECK_LAYER_ORDER`
 * constant is exported by NAME (S12's `AppShell` will import from
 * this barrel).
 */
import { describe, expect, it } from 'vitest';

import * as layers from './index';

describe('layers/index barrel — frozen public surface', () => {
  it('exports all eight layer components by name', () => {
    expect(typeof layers.EnvironmentLayer).toBe('function');
    expect(typeof layers.DeckingLayer).toBe('function');
    expect(typeof layers.JoistsLayer).toBe('function');
    expect(typeof layers.BeamsLayer).toBe('function');
    expect(typeof layers.PostsLayer).toBe('function');
    expect(typeof layers.FootingsLayer).toBe('function');
    // S22 (Epic 2 / FR-029) additions.
    expect(typeof layers.BlocksLayer).toBe('function');
    expect(typeof layers.BlockingLayer).toBe('function');
  });

  it('exports the <DeckLayers> convenience bundle + its order constant', () => {
    // S12 AppShell drop-in usage: `<DeckScene><DeckLayers/></DeckScene>`.
    expect(typeof layers.DeckLayers).toBe('function');
    expect(Array.isArray(layers.DECK_LAYER_ORDER)).toBe(true);
    // S22 grows the order from six to eight (blocks + blocking).
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
