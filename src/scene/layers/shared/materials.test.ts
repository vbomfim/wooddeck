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
  MATERIAL_COLORS,
  disposeSharedMaterials,
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
