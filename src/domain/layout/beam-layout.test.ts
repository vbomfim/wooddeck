/**
 * Unit tests for `src/domain/layout/beam-layout.ts` — TDD RED phase.
 *
 * Convention exercised here (see beam-layout.ts header for the full write-up):
 *   - MVP produces EXACTLY 2 beams, one at each z-end of the deck (near & far).
 *   - Beams are perpendicular to joists, so they run along +x — a single-ply
 *     board spans the full deck width.
 *   - Drop-beam configuration: joists rest ON TOP of beams. Beam top y =
 *     joist bottom y = footprint.heightMm - deckingThickness - joistDepth.
 *   - Beams are flush with the deck ends along z: their -z (or +z) face lies
 *     on the corresponding footprint edge.
 */
import { describe, expect, it } from 'vitest';

import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign } from '../model';

import { layoutBeams } from './beam-layout';
import { FOOTING_WIDTH_MM } from './y-stack';

function makeDesign(overrides: Partial<{
  widthMm: number;
  lengthMm: number;
  heightMm: number;
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    createdAt: '2026-07-02T00:00:00.000Z',
    footprint: {
      widthMm: overrides.widthMm ?? 3660,
      lengthMm: overrides.lengthMm ?? 4880,
      heightMm: overrides.heightMm ?? 914,
    },
    structure: 'elevated',
    foundation: {
      type: 'posts-on-footings',
      post: { nominal: '6x6', species: 'PT', grade: 'No2' },
      footing: { widthMm: 300, depthMm: 300 },
    },
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: 406,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
    post: { material: { nominal: '6x6', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

describe('layoutBeams — count and identity', () => {
  it('produces exactly 2 beams (near & far end of joist run)', () => {
    const beams = layoutBeams(makeDesign());
    expect(beams).toHaveLength(2);
    for (const b of beams) expect(b.kind).toBe('beam');
  });

  it('every beam has a stable, unique id (beam-near, beam-far)', () => {
    const beams = layoutBeams(makeDesign());
    const ids = beams.map((b) => b.id);
    expect(new Set(ids)).toEqual(new Set(['beam-near', 'beam-far']));
  });

  it('every beam carries the beam material reference from the design', () => {
    const design = makeDesign();
    for (const b of layoutBeams(design)) {
      // S17 MemberMaterialRef widening — beams are stamped
      // `{kind:'lumber', ...design.beam.material}`.
      expect(b.material).toEqual({ kind: 'lumber', ...design.beam.material });
    }
  });
});

describe('layoutBeams — geometry', () => {
  it('every beam spans the full deck width along +x', () => {
    const design = makeDesign({ widthMm: 3660 });
    for (const b of layoutBeams(design)) {
      expect(b.size.x).toBe(3660);
    }
  });

  it('beam vertical (y) size = beam material dressed depth; z size = dressed thickness (on-edge)', () => {
    const design = makeDesign();
    const beamMaterial = lookupMaterial('2x10', 'PT', 'No2');
    for (const b of layoutBeams(design)) {
      expect(b.size.y).toBe(beamMaterial.actual.heightMm); // 235 mm depth (on-edge)
      expect(b.size.z).toBe(beamMaterial.actual.widthMm); // 38 mm thickness
    }
  });

  it('every beam is centered horizontally (x=0)', () => {
    for (const b of layoutBeams(makeDesign())) expect(b.position.x).toBe(0);
  });

  it('beams are inset from the deck ends by FOOTING_WIDTH_MM/2 (footings fit inside footprint on z)', () => {
    // "Inset by half a footing width" — the beam center is offset from the
    // corresponding footprint z-edge by FOOTING_WIDTH_MM / 2 so that the
    // associated footings (same z as the beam) fit entirely inside `bounds`
    // on z (AC2). Joists cantilever past the beams by the residual.
    const design = makeDesign({ lengthMm: 4880 });
    const beams = layoutBeams(design);
    const near = beams.find((b) => b.id === 'beam-near')!;
    const far = beams.find((b) => b.id === 'beam-far')!;
    expect(near.position.z).toBeCloseTo(-4880 / 2 + FOOTING_WIDTH_MM / 2, 6);
    expect(far.position.z).toBeCloseTo(+4880 / 2 - FOOTING_WIDTH_MM / 2, 6);
  });

  it('drop-beam convention: beam TOP y = joist BOTTOM y', () => {
    // Y-stack: decking (top at heightMm) sits on joists → joists' top at
    // heightMm - deckingThickness. Beams sit UNDER joists → beam top =
    // joist bottom = heightMm - deckingThickness - joistDepth.
    const design = makeDesign({ heightMm: 914 });
    const deckingMat = lookupMaterial('5/4x6', 'PT', 'No2');
    const joistMat = lookupMaterial('2x10', 'PT', 'No2');
    const beamMat = lookupMaterial('2x10', 'PT', 'No2');
    const expectedBeamTop = 914 - deckingMat.actual.widthMm - joistMat.actual.heightMm;
    const expectedBeamCenter = expectedBeamTop - beamMat.actual.heightMm / 2;
    for (const b of layoutBeams(design)) {
      expect(b.position.y).toBeCloseTo(expectedBeamCenter, 6);
    }
  });

  it('beams have zero rotation (axis-aligned) for MVP', () => {
    for (const b of layoutBeams(makeDesign())) {
      expect(b.rotation).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('is deterministic — same design yields deeply-equal member arrays', () => {
    const design = makeDesign();
    expect(layoutBeams(design)).toEqual(layoutBeams(design));
  });
});
