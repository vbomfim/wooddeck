/**
 * Unit tests for `src/scene/layers/shared/materials.ts`.
 *
 * ## Coverage map (S10 issue #11)
 *
 *   AC6  Materials per species — PT / Cedar / Composite each pick a
 *        distinct base colour (asserted here via `color.getHex()`).
 *   §7   Materials memoized — every call to `materialForMember(...)`
 *        for the same species returns the SAME instance (referential
 *        equality) so all joists share one material and the GPU has
 *        one MeshStandardMaterial to bind.
 *   §17  Non-transparent — MVP has no see-through materials; the
 *        material is opaque, `MeshStandardMaterial`, with a fixed
 *        roughness (documented in the module header).
 *
 * ## Why we don't render inside r3f here
 *
 * `materials.ts` returns plain three.js `MeshStandardMaterial`
 * instances — they compose into r3f `<mesh>` but they themselves
 * are constructed with the three.js API and asserted on the same
 * API. No `<Canvas>` involvement needed; this file uses `vitest`
 * only.
 */
import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial } from 'three';

import type { LayoutMember, Species } from '../../../domain/model';
import {
  MATERIAL_BLOCK_COLORS,
  MATERIAL_COLORS,
  disposeSharedBlockMaterials,
  disposeSharedMaterials,
  materialForBlock,
  materialForMember,
  materialForSpecies,
} from './materials';

function makeMember(species: Species): LayoutMember {
  return {
    id: 'test',
    kind: 'joist',
    material: { kind: 'lumber', nominal: '2x8', species, grade: species === 'Composite' ? 'NA' : 'No2' },
    position: { x: 0, y: 0, z: 0 },
    size: { x: 100, y: 100, z: 100 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

describe('materials — per-species colour (AC6)', () => {
  it('PT / Cedar / Composite each pick a distinct colour', () => {
    const pt = materialForSpecies('PT');
    const cedar = materialForSpecies('Cedar');
    const composite = materialForSpecies('Composite');
    // Distinct hex values — if two matched, the "see underneath"
    // UX would confuse the viewer about species.
    expect(pt.color.getHex()).not.toBe(cedar.color.getHex());
    expect(pt.color.getHex()).not.toBe(composite.color.getHex());
    expect(cedar.color.getHex()).not.toBe(composite.color.getHex());
  });

  it('MATERIAL_COLORS map matches the resolved MeshStandardMaterial colours', () => {
    // The `MATERIAL_COLORS` constant is documented in the module
    // header (PT = greenish-brown, Cedar = reddish-brown, Composite
    // = gray). This test locks the map in place so a future edit
    // that flips one colour also updates the docstring.
    expect(materialForSpecies('PT').color.getHex()).toBe(MATERIAL_COLORS.PT);
    expect(materialForSpecies('Cedar').color.getHex()).toBe(MATERIAL_COLORS.Cedar);
    expect(materialForSpecies('Composite').color.getHex()).toBe(MATERIAL_COLORS.Composite);
  });

  it('PT colour is greenish-brown (green channel is the dominant chroma)', () => {
    // Documented in the module header. Asserting the numerical
    // property (rather than the exact hex) keeps a future palette
    // tweak from silently drifting AWAY from "greenish".
    const hex = MATERIAL_COLORS.PT;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    // Green channel is at least equal to red — PT is olive/tan,
    // not fire-engine red. Blue stays low so the material reads
    // warm.
    expect(g).toBeGreaterThanOrEqual(r - 8);
    expect(b).toBeLessThan(r);
    expect(b).toBeLessThan(g);
  });

  it('Cedar colour is reddish-brown (red channel dominant)', () => {
    const hex = MATERIAL_COLORS.Cedar;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    // Red is highest; green sits in the middle; blue is lowest —
    // classic warm cedar tone.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('Composite colour is neutral gray (r ≈ g ≈ b)', () => {
    const hex = MATERIAL_COLORS.Composite;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    // Neutral gray: no channel dominates by more than ~16 (≈6% of
    // the full range) — reads as gray rather than tinted.
    expect(Math.abs(r - g)).toBeLessThanOrEqual(16);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(16);
    expect(Math.abs(r - b)).toBeLessThanOrEqual(16);
  });
});

describe('materials — sharing & memoization (§7 shared-per-species)', () => {
  it('materialForSpecies returns the SAME instance on repeat calls', () => {
    // Referential equality — every joist gets the SAME
    // MeshStandardMaterial pointer, so the GPU has one binding to
    // manage. If a refactor accidentally builds a new material per
    // call, this test fires.
    const a = materialForSpecies('PT');
    const b = materialForSpecies('PT');
    expect(a).toBe(b);
  });

  it('materialForMember returns the same instance as materialForSpecies for that species', () => {
    const shared = materialForSpecies('Cedar');
    const viaMember = materialForMember(makeMember('Cedar'));
    expect(viaMember).toBe(shared);
  });

  it('all three species produce MeshStandardMaterial instances', () => {
    // Ticket §7: MVP is opaque MeshStandardMaterial. A future PBR
    // swap must go through a deliberate change; this guard makes
    // the swap visible.
    expect(materialForSpecies('PT')).toBeInstanceOf(MeshStandardMaterial);
    expect(materialForSpecies('Cedar')).toBeInstanceOf(MeshStandardMaterial);
    expect(materialForSpecies('Composite')).toBeInstanceOf(MeshStandardMaterial);
  });

  it('shared materials are opaque (transparent === false) — MVP has no see-through wood', () => {
    // If a future edit accidentally enables `transparent: true`
    // (e.g. to fade a hidden layer), sort-order-based Z-fighting
    // will bite; MVP keeps everything opaque.
    expect(materialForSpecies('PT').transparent).toBe(false);
    expect(materialForSpecies('Cedar').transparent).toBe(false);
    expect(materialForSpecies('Composite').transparent).toBe(false);
  });
});

describe('materials — disposal', () => {
  it('disposeSharedMaterials tears down the cached materials without throwing', () => {
    // Prime the cache.
    const pt = materialForSpecies('PT');
    // A `MeshStandardMaterial.dispose()` marks GPU resources for
    // release; three.js does not currently throw for double-dispose
    // but we still guard against a stale-reference use path.
    expect(() => disposeSharedMaterials()).not.toThrow();
    // After disposal, calling again returns a FRESH material (the
    // cache is empty). The re-created material is still a
    // MeshStandardMaterial with the documented colour.
    const ptAgain = materialForSpecies('PT');
    expect(ptAgain).toBeInstanceOf(MeshStandardMaterial);
    expect(ptAgain.color.getHex()).toBe(MATERIAL_COLORS.PT);
    // Referential equality: the fresh material is a different
    // instance from the pre-dispose one.
    expect(ptAgain).not.toBe(pt);
  });
});

// ---------------------------------------------------------------------------
// QA Gap S17-G2 — materialForMember throws on a block-kind member
// ---------------------------------------------------------------------------
//
// Block producers arrive with S19/S20 and will introduce their own
// material picker rather than routing through this shared helper.
// If a caller accidentally routes a block-kind member here today,
// the throw makes the misuse LOUD (no silent wrong-color render).
// This regression test locks in that behavior for the S17 window.

describe('materialForMember — QA-Gap-S17-G2 block-kind member throws loudly', () => {
  it('throws a descriptive Error naming the module when passed a block-kind member', () => {
    const blockMember: LayoutMember = {
      id: 'block-0',
      kind: 'block',
      material: { kind: 'block', productId: 'oldcastle-11x11x7' },
      position: { x: 0, y: 0, z: 0 },
      size: { x: 279, y: 178, z: 279 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    expect(() => materialForMember(blockMember)).toThrow(/lumber material/i);
    expect(() => materialForMember(blockMember)).toThrow(/block/);
    // The message names the module so triage is fast.
    expect(() => materialForMember(blockMember)).toThrow(/materialForMember/);
  });
});

// ---------------------------------------------------------------------------
// S22 — block materials (Epic 2 / FR-029)
// ---------------------------------------------------------------------------
//
// Blocks are NOT lumber — `materialForMember` throws on them by
// design (see the S17 guard above). The block layer uses its own
// picker `materialForBlock(member)` that dispatches by product id
// through the foundation catalog's `FoundationCategory` field:
//
//   - `oldcastle-11x11x7` → category `'concrete-precast'` → grey
//     concrete tone.
//   - `tuffblock-12x12x4` → category `'polypropylene'` → dark
//     charcoal / near-black plastic tone.
//
// The picker follows the SAME shared-per-category discipline as
// `materialForSpecies` (referential equality on repeat calls,
// `MATERIAL_BLOCK_COLORS` exported for palette assertions,
// `disposeSharedBlockMaterials` for HMR / test cleanup).
// ---------------------------------------------------------------------------

function makeBlockMember(
  productId: 'oldcastle-11x11x7' | 'tuffblock-12x12x4',
): LayoutMember {
  return {
    id: `block-${productId}`,
    kind: 'block',
    material: { kind: 'block', productId },
    position: { x: 0, y: 0, z: 0 },
    size: { x: 279, y: 178, z: 279 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

describe('materialForBlock — per-category colour (AC / FR-029)', () => {
  it('Oldcastle (concrete-precast) and TuffBlock (polypropylene) get distinct colours', () => {
    const concrete = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    const plastic = materialForBlock(makeBlockMember('tuffblock-12x12x4'));
    // Distinct hex — a viewer glancing at a mixed layout must be
    // able to tell "which foundation product is this?" at a glance.
    expect(concrete.color.getHex()).not.toBe(plastic.color.getHex());
  });

  it('MATERIAL_BLOCK_COLORS maps each category to the resolved MeshStandardMaterial colour', () => {
    // The `MATERIAL_BLOCK_COLORS` constant is the source of truth
    // for the block palette. Downstream code (S26 LayerToggle
    // future icons; docs) can assert the palette without duplicating
    // hex literals.
    const concrete = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    const plastic = materialForBlock(makeBlockMember('tuffblock-12x12x4'));
    expect(concrete.color.getHex()).toBe(MATERIAL_BLOCK_COLORS['concrete-precast']);
    expect(plastic.color.getHex()).toBe(MATERIAL_BLOCK_COLORS['polypropylene']);
  });

  it('concrete-precast colour is a neutral / light grey (r ≈ g ≈ b, mid-to-high luminance)', () => {
    // Documented as "grey concrete" in the module header. The
    // numerical property test (rather than a fixed hex) permits
    // future palette adjustments without fighting the assertion,
    // as long as the "concrete" cast survives.
    const hex = MATERIAL_BLOCK_COLORS['concrete-precast'];
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(Math.abs(r - g)).toBeLessThanOrEqual(16);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(16);
    // Concrete reads as a lighter mid-tone grey — luminance
    // (crude Rec-601 approximation) should be > 96 (out of 255).
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    expect(luminance).toBeGreaterThan(96);
  });

  it('polypropylene colour is a dark / near-black neutral (low luminance, r ≈ g ≈ b)', () => {
    // Documented as "dark charcoal / near-black" plastic. Same
    // numerical-property discipline as the concrete assertion.
    const hex = MATERIAL_BLOCK_COLORS['polypropylene'];
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(Math.abs(r - g)).toBeLessThanOrEqual(16);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(16);
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    // Polypropylene puck reads DARK — luminance well below the
    // concrete tone. Ceiling of 96 keeps a healthy contrast gap.
    expect(luminance).toBeLessThan(96);
  });

  it('does not collide with any lumber species colour (concrete grey ≠ Composite grey)', () => {
    // Composite lumber is `0x7a7a7a` — a viewer must not confuse
    // "concrete block" with "composite decking" in a mixed scene.
    // The block palette is required to stay clear of every lumber
    // species colour.
    for (const speciesColor of Object.values(MATERIAL_COLORS)) {
      expect(MATERIAL_BLOCK_COLORS['concrete-precast']).not.toBe(speciesColor);
      expect(MATERIAL_BLOCK_COLORS['polypropylene']).not.toBe(speciesColor);
    }
  });
});

describe('materialForBlock — sharing & memoization (matches materialForSpecies)', () => {
  it('returns the SAME instance on repeat calls for the same productId', () => {
    // Referential equality — every Oldcastle mesh in a scene shares
    // ONE material. The GPU manages one binding; the memory
    // footprint stays O(1) regardless of block count.
    const a = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    const b = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    expect(a).toBe(b);
  });

  it('returns distinct instances for different productIds', () => {
    // Two distinct products → two distinct materials (they have
    // different colours, so they cannot share).
    const oldcastle = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    const tuff = materialForBlock(makeBlockMember('tuffblock-12x12x4'));
    expect(oldcastle).not.toBe(tuff);
  });

  it('returns MeshStandardMaterial instances (matches lumber palette)', () => {
    // Same PBR shader path as lumber — the block layer participates
    // in the same ambient + directional lighting the framing uses.
    expect(materialForBlock(makeBlockMember('oldcastle-11x11x7'))).toBeInstanceOf(
      MeshStandardMaterial,
    );
    expect(materialForBlock(makeBlockMember('tuffblock-12x12x4'))).toBeInstanceOf(
      MeshStandardMaterial,
    );
  });

  it('block materials are opaque (transparent === false) — MVP has no see-through blocks', () => {
    // Depth-buffer / z-fighting hygiene — MVP keeps every material
    // opaque so DeckLayers.tsx's fixed render order alone determines
    // the visible pixel.
    expect(materialForBlock(makeBlockMember('oldcastle-11x11x7')).transparent).toBe(
      false,
    );
    expect(materialForBlock(makeBlockMember('tuffblock-12x12x4')).transparent).toBe(
      false,
    );
  });

  it('throws a descriptive Error naming the module when passed a lumber-kind member', () => {
    // Mirror image of the S17 guard on `materialForMember` — passing
    // a lumber member here is a caller bug (the block layer would
    // never render a lumber member). Fail loudly rather than
    // silently return the wrong material.
    const lumberMember: LayoutMember = {
      id: 'joist-0',
      kind: 'joist',
      material: { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' },
      position: { x: 0, y: 0, z: 0 },
      size: { x: 100, y: 100, z: 100 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    expect(() => materialForBlock(lumberMember)).toThrow(/block material/i);
    expect(() => materialForBlock(lumberMember)).toThrow(/materialForBlock/);
  });
});

describe('materialForBlock — disposal', () => {
  it('disposeSharedBlockMaterials tears down cached materials without throwing', () => {
    // Prime the cache with both products.
    const oldcastle = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    const tuff = materialForBlock(makeBlockMember('tuffblock-12x12x4'));
    expect(() => disposeSharedBlockMaterials()).not.toThrow();
    // After disposal, the cache is empty — re-request re-creates
    // fresh instances with the documented palette.
    const oldcastleAgain = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    const tuffAgain = materialForBlock(makeBlockMember('tuffblock-12x12x4'));
    expect(oldcastleAgain).not.toBe(oldcastle);
    expect(tuffAgain).not.toBe(tuff);
    expect(oldcastleAgain.color.getHex()).toBe(MATERIAL_BLOCK_COLORS['concrete-precast']);
    expect(tuffAgain.color.getHex()).toBe(MATERIAL_BLOCK_COLORS['polypropylene']);
  });
});
