/**
 * Unit tests for `src/scene/layers/index.ts` — the layers barrel.
 *
 * Locks the public surface described in the S10 issue #11 §2
 * component map: each of the six layer components + the
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
    expect(typeof layers.materialForSpecies).toBe('function');
    expect(typeof layers.materialForMember).toBe('function');
    expect(layers.MATERIAL_COLORS).toBeDefined();
    // S22 additions — block-specific material picker + palette.
    expect(typeof layers.materialForBlock).toBe('function');
    expect(layers.MATERIAL_BLOCK_COLORS).toBeDefined();
  });
});
