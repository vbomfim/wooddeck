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
  it('exports all six layer components by name', () => {
    expect(typeof layers.EnvironmentLayer).toBe('function');
    expect(typeof layers.DeckingLayer).toBe('function');
    expect(typeof layers.JoistsLayer).toBe('function');
    expect(typeof layers.BeamsLayer).toBe('function');
    expect(typeof layers.PostsLayer).toBe('function');
    expect(typeof layers.FootingsLayer).toBe('function');
  });

  it('exports the <DeckLayers> convenience bundle + its order constant', () => {
    // S12 AppShell drop-in usage: `<DeckScene><DeckLayers/></DeckScene>`.
    expect(typeof layers.DeckLayers).toBe('function');
    expect(Array.isArray(layers.DECK_LAYER_ORDER)).toBe(true);
    expect(layers.DECK_LAYER_ORDER).toHaveLength(6);
  });

  it('exports the shared material helpers so downstream (S11 warning overlay) can align', () => {
    expect(typeof layers.materialForSpecies).toBe('function');
    expect(typeof layers.materialForMember).toBe('function');
    expect(layers.MATERIAL_COLORS).toBeDefined();
  });
});
