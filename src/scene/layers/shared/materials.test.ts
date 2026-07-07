/**
 * Unit tests for `src/scene/layers/shared/materials.ts` — kind-keyed
 * scene material palette (replaces the species-keyed AC6 palette).
 *
 * ## User directive (fix/part-type-colors)
 *
 * The scene MUST color members by `MemberKind` — NOT by
 * `LumberMemberMaterial.species`. Two joists of different species
 * render the SAME colour; a joist and a beam of the SAME species
 * render DIFFERENT colours (the whole point of the change).
 *
 * ## Contract asserted here
 *
 *   1. `MATERIAL_KIND_COLORS` maps every `MemberKind` variant to
 *      a distinct hex — the palette is exhaustive (compile-time)
 *      and pairwise distinct (runtime).
 *   2. `materialForKind(kind)` returns a `MeshStandardMaterial`
 *      instance memoized per kind — referential equality on
 *      repeat calls (the "shared per kind" GPU trade-off).
 *   3. Beam / joist / blocking each pick a colour distinct from
 *      the other two (the core user request — those three sit in
 *      the same rendered scene and must be told apart at a glance).
 *   4. `materialForMember` dispatches by `member.kind`, so a
 *      joist member and a beam member of the same species produce
 *      different materials — this is the regression sentinel that
 *      would have FAILED on the old species-based code.
 *   5. `materialForBlock` still exists for `BlocksLayer` (it also
 *      chooses geometry by productId), but the material it returns
 *      is now the shared block-kind material — one color for every
 *      block product, matching the "one colour per kind" rule.
 *   6. Materials are opaque (`transparent === false`) — same MVP
 *      trade-off as the original species-keyed palette.
 *   7. Disposal helper tears the cache down without throwing;
 *      subsequent calls repopulate with fresh instances.
 *
 * ## Why we don't render inside r3f here
 *
 * `materials.ts` returns plain three.js `MeshStandardMaterial`
 * instances — no `<Canvas>` involvement needed; this file uses
 * `vitest` only.
 */
import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial } from 'three';

import type { LayoutMember, MemberKind, Species } from '../../../domain/model';
import {
  MATERIAL_KIND_COLORS,
  disposeSharedMaterials,
  materialForBlock,
  materialForKind,
  materialForMember,
} from './materials';

/**
 * Every `MemberKind` variant — hand-listed so a compiler error
 * fires if the domain enum grows. `MATERIAL_KIND_COLORS` uses the
 * same enum via TypeScript's exhaustive `Record` type, so the
 * "add a row when you add a kind" invariant is compile-enforced.
 */
const ALL_KINDS: readonly MemberKind[] = [
  'joist',
  'beam',
  'post',
  'footing',
  'board',
  'block',
  'blocking',
] as const;

function makeLumberMember(kind: MemberKind, species: Species = 'PT'): LayoutMember {
  return {
    id: `test-${kind}-${species}`,
    kind,
    material:
      species === 'Composite'
        ? { kind: 'lumber', nominal: '5/4x6', species, grade: 'NA' }
        : { kind: 'lumber', nominal: '2x8', species, grade: 'No2' },
    position: { x: 0, y: 0, z: 0 },
    size: { x: 100, y: 100, z: 100 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function makeBlockMember(
  productId: 'oldcastle-11x11x7' | 'tuffblock-12x12x4',
): LayoutMember {
  return {
    id: `test-block-${productId}`,
    kind: 'block',
    material: { kind: 'block', productId },
    position: { x: 0, y: 0, z: 0 },
    size: { x: 279, y: 178, z: 279 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

describe('materials — per-kind colour', () => {
  it('every MemberKind resolves to a DISTINCT colour hex', () => {
    // Pairwise-distinct via `color.getHex()`. If two kinds shared
    // a colour, the whole point of the change (visually separate
    // the seven kinds) would be defeated.
    const hexes = ALL_KINDS.map((k) => materialForKind(k).color.getHex());
    expect(new Set(hexes).size).toBe(ALL_KINDS.length);
  });

  it('beam / joist / blocking each pick a colour distinct from the other two (core user triad)', () => {
    // The core of the ticket — beam, joist, and blocking are the
    // three interior-framing kinds that stack side by side in a
    // typical scene. All three MUST be visually distinguishable.
    const beam = materialForKind('beam').color.getHex();
    const joist = materialForKind('joist').color.getHex();
    const blocking = materialForKind('blocking').color.getHex();
    expect(beam).not.toBe(joist);
    expect(beam).not.toBe(blocking);
    expect(joist).not.toBe(blocking);
  });

  it('MATERIAL_KIND_COLORS map matches the resolved MeshStandardMaterial colours (one row per MemberKind)', () => {
    // The `MATERIAL_KIND_COLORS` constant is EXPORTED as the
    // single source of truth for the palette. Every kind is asserted
    // to route through the same value the material renders with.
    for (const kind of ALL_KINDS) {
      expect(materialForKind(kind).color.getHex()).toBe(MATERIAL_KIND_COLORS[kind]);
    }
  });

  it('beam is a cool colour (blue channel dominant)', () => {
    // Documented in the module header — beam is a deep royal blue.
    // Testing the numerical property (rather than a fixed hex)
    // permits future palette tweaks that still preserve the "cool
    // primary" reading.
    const hex = MATERIAL_KIND_COLORS.beam;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('joist is warm (red channel dominant, high luminance)', () => {
    // Documented as amber/orange in the module header.
    const hex = MATERIAL_KIND_COLORS.joist;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    // Warm amber reads BRIGHT — total channel sum well above the
    // darkest members (post, beam) so the two are separable by
    // luminance alone.
    expect(r + g + b).toBeGreaterThan(300);
  });

  it('blocking is cool green/teal (green channel > red channel)', () => {
    // Documented as emerald in the module header. Green > Red
    // distinguishes it from a warm amber joist even if luminances
    // happen to be similar.
    const hex = MATERIAL_KIND_COLORS.blocking;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    expect(g).toBeGreaterThan(r);
  });

  it('board is a warm wood-plank tone (red >= green > blue)', () => {
    // Documented as a medium wood tan in the module header —
    // classic decking-plank read.
    const hex = MATERIAL_KIND_COLORS.board;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
  });

  it('post is a dark warm brown (red dominant, LOW luminance)', () => {
    // Documented as very dark chocolate brown — real
    // pressure-treated posts read dark against a decked scene.
    const hex = MATERIAL_KIND_COLORS.post;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThanOrEqual(b);
    // Dark: total channel sum well below the mid-tones so post
    // sits at the bottom of the luminance ladder.
    expect(r + g + b).toBeLessThan(200);
  });

  it('footing is a neutral gray (r ≈ g ≈ b)', () => {
    // Documented as mid concrete-pier gray in the module header —
    // real concrete piers under a deck.
    const hex = MATERIAL_KIND_COLORS.footing;
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(Math.abs(r - g)).toBeLessThanOrEqual(16);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(16);
    expect(Math.abs(r - b)).toBeLessThanOrEqual(16);
  });

  it('block is a neutral gray (r ≈ g ≈ b) — preserves the existing concrete-precast palette per user directive', () => {
    // User directive: keep the existing block colour. The
    // previous `MATERIAL_BLOCK_COLORS['concrete-precast']` was
    // `0x9e9e98` — we preserve that exact hex here so scenes
    // containing block members read the same before and after.
    const hex = MATERIAL_KIND_COLORS.block;
    expect(hex).toBe(0x9e9e98);
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    expect(Math.abs(r - g)).toBeLessThanOrEqual(16);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(16);
    expect(Math.abs(r - b)).toBeLessThanOrEqual(16);
  });
});

describe('materials — species-ignoring dispatch (user directive)', () => {
  it('a joist member and a beam member of the SAME species produce DIFFERENT colours', () => {
    // The core regression sentinel. On the OLD species-based
    // code, a PT joist and a PT beam shared one material — this
    // test would have FAILED on that code. On the new kind-based
    // code, `materialForMember` dispatches by `member.kind`, so
    // the two materials differ.
    const ptJoist = makeLumberMember('joist', 'PT');
    const ptBeam = makeLumberMember('beam', 'PT');
    const joistMat = materialForMember(ptJoist);
    const beamMat = materialForMember(ptBeam);
    expect(joistMat.color.getHex()).not.toBe(beamMat.color.getHex());
  });

  it('a joist of PT and a joist of Cedar produce the SAME colour (species is ignored)', () => {
    // Species is intentionally NO LONGER encoded in colour per the
    // user directive. Two joists of different species render the
    // same colour — the layer-toggle UX cares about part-kind, not
    // material grade.
    const ptJoist = makeLumberMember('joist', 'PT');
    const cedarJoist = makeLumberMember('joist', 'Cedar');
    const ptMat = materialForMember(ptJoist);
    const cedarMat = materialForMember(cedarJoist);
    expect(ptMat.color.getHex()).toBe(cedarMat.color.getHex());
  });

  it('a joist of PT and a joist of Composite return the SAME material INSTANCE (referential equality)', () => {
    // Species-blind dispatch + kind-level memoization ⇒ two
    // joist members share one MeshStandardMaterial pointer no
    // matter which species tag they carry.
    const ptJoist = makeLumberMember('joist', 'PT');
    const compositeJoist = makeLumberMember('joist', 'Composite');
    expect(materialForMember(ptJoist)).toBe(materialForMember(compositeJoist));
  });

  it('materialForMember(joist) returns the same instance as materialForKind("joist")', () => {
    // Contract: `materialForMember` is a thin wrapper that reads
    // `member.kind` and delegates. The mesh's material is the
    // exact SAME instance every KindLayer BoxMember uses.
    const member = makeLumberMember('joist', 'Cedar');
    expect(materialForMember(member)).toBe(materialForKind('joist'));
  });
});

describe('materials — sharing & memoization (shared per kind)', () => {
  it('materialForKind returns the SAME instance on repeat calls', () => {
    // Referential equality — every joist mesh gets the SAME
    // MeshStandardMaterial pointer so the GPU has one binding to
    // manage. If a refactor accidentally builds a new material per
    // call, this test fires.
    const a = materialForKind('joist');
    const b = materialForKind('joist');
    expect(a).toBe(b);
  });

  it('materialForKind returns DIFFERENT instances for different kinds', () => {
    // Two kinds must have DIFFERENT material instances (they have
    // different colours, so they cannot share).
    expect(materialForKind('joist')).not.toBe(materialForKind('beam'));
    expect(materialForKind('beam')).not.toBe(materialForKind('blocking'));
    expect(materialForKind('joist')).not.toBe(materialForKind('blocking'));
  });

  it('every kind produces a MeshStandardMaterial instance', () => {
    // MVP is opaque MeshStandardMaterial for every kind. A future
    // PBR swap must go through a deliberate change; this guard
    // makes the swap visible.
    for (const kind of ALL_KINDS) {
      expect(materialForKind(kind)).toBeInstanceOf(MeshStandardMaterial);
    }
  });

  it('every kind material is opaque (transparent === false) — MVP has no see-through members', () => {
    // Depth-buffer / z-fighting hygiene — MVP keeps every material
    // opaque so DeckLayers.tsx's fixed render order alone determines
    // the visible pixel.
    for (const kind of ALL_KINDS) {
      expect(materialForKind(kind).transparent).toBe(false);
    }
  });
});

describe('materials — disposal', () => {
  it('disposeSharedMaterials tears down the cached materials without throwing', () => {
    // Prime the cache.
    const beam = materialForKind('beam');
    expect(() => disposeSharedMaterials()).not.toThrow();
    // After disposal, calling again returns a FRESH material (the
    // cache is empty). The re-created material is still a
    // MeshStandardMaterial with the documented colour.
    const beamAgain = materialForKind('beam');
    expect(beamAgain).toBeInstanceOf(MeshStandardMaterial);
    expect(beamAgain.color.getHex()).toBe(MATERIAL_KIND_COLORS.beam);
    // Referential equality: the fresh material is a different
    // instance from the pre-dispose one.
    expect(beamAgain).not.toBe(beam);
  });
});

describe('materialForMember — QA-Gap-S17-G2 block-kind member throws loudly', () => {
  // A `LayoutMember` with `material.kind === 'block'` must NEVER be
  // routed through the lumber path — blocks own their own picker
  // (`materialForBlock`) because the material discriminant is a
  // productId, not a species. The throw makes the misuse LOUD.
  it('throws a descriptive Error naming the module when passed a block-material member', () => {
    const blockMember = makeBlockMember('oldcastle-11x11x7');
    expect(() => materialForMember(blockMember)).toThrow(/lumber material/i);
    expect(() => materialForMember(blockMember)).toThrow(/block/);
    expect(() => materialForMember(blockMember)).toThrow(/materialForMember/);
  });
});

describe('materialForBlock — routes every block-kind member through the shared block-kind material', () => {
  // User directive: every block, regardless of productId, uses the
  // SAME kind-level colour ("route through the same kind map for
  // consistency"). BlocksLayer still uses `materialForBlock` because
  // it needs per-productId GEOMETRY dispatch — the MATERIAL is now
  // shared per-kind.

  it('Oldcastle and TuffBlock both resolve to the shared block-kind material (productId ignored for colour)', () => {
    const concrete = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    const plastic = materialForBlock(makeBlockMember('tuffblock-12x12x4'));
    // Same colour (per user directive) AND same INSTANCE.
    expect(concrete.color.getHex()).toBe(plastic.color.getHex());
    expect(concrete).toBe(plastic);
  });

  it('materialForBlock returns the SAME instance as materialForKind("block")', () => {
    // Colour + material sharing follow the same kind map every
    // other layer uses — one MeshStandardMaterial per kind, period.
    const blockMat = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    expect(blockMat).toBe(materialForKind('block'));
  });

  it('materialForBlock returns a MeshStandardMaterial with the block-kind colour', () => {
    // Same PBR shader path as every other layer — the block
    // participates in the same ambient + directional lighting the
    // framing uses.
    const mat = materialForBlock(makeBlockMember('oldcastle-11x11x7'));
    expect(mat).toBeInstanceOf(MeshStandardMaterial);
    expect(mat.color.getHex()).toBe(MATERIAL_KIND_COLORS.block);
  });

  it('materialForBlock returns an OPAQUE material — no see-through blocks in MVP', () => {
    expect(materialForBlock(makeBlockMember('oldcastle-11x11x7')).transparent).toBe(
      false,
    );
    expect(materialForBlock(makeBlockMember('tuffblock-12x12x4')).transparent).toBe(
      false,
    );
  });

  it('throws a descriptive Error naming the module when passed a lumber-material member', () => {
    // Mirror image of the `materialForMember` guard — passing a
    // lumber member here is a caller bug (the block layer would
    // never render a lumber member).
    const lumberMember = makeLumberMember('joist', 'PT');
    expect(() => materialForBlock(lumberMember)).toThrow(/block material/i);
    expect(() => materialForBlock(lumberMember)).toThrow(/materialForBlock/);
  });
});
