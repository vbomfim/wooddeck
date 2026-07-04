/**
 * `src/domain/layout/floating/blocking-layout.test.ts` — TDD RED
 * phase for the floating blocking pieces (S19, AC6).
 *
 * ## Contract under test
 *
 * `computeBlocking({beams, joistNominal, species, grade, maxSpacingMm})`
 * returns `blocking`-kind `LayoutMember`s installed between adjacent
 * BEAM PAIRS for lateral stiffness. Per AC6:
 *
 *   - For each pair of adjacent beams (N beams → N-1 pairs):
 *     `numPerPair = max(0, ceil(lengthMm / maxSpacingMm) - 1)`
 *     blocking pieces are placed between them, evenly spaced along
 *     the length axis as INTERIOR points (not endpoints).
 *
 *   - Each piece runs PERPENDICULAR to the beams — i.e. its long
 *     axis is along +x (from one beam's inner face to the next
 *     beam's inner face). Physical reality of "blocking between
 *     beams". See TICKET-NOTE below for the AC6 wording nuance.
 *
 *   - Piece sizes:
 *     - `size.x` = the free-length between the two beam WEBS
 *       (i.e. `|Δbeam.x| - beam.thickness`) — an offcut cut to fit
 *       snug between the beams.
 *     - `size.y` = beam depth (blocking is same nominal as the beam
 *       per the `joistNominal` input, laid on-edge like the beam).
 *     - `size.z` = beam thickness (matches the beam's z-extent so
 *       the piece nests flush between the two beam webs).
 *
 *   - `material = {kind:'lumber', nominal:joistNominal, species, grade}`.
 *     "Same SKU as beam" per AC6 — the caller passes the beam's
 *     nominal/species/grade explicitly for testability.
 *
 *   - `kind = 'blocking'` (new MemberKind added by S17).
 *
 *   - Beam length is derived from `beam.size.z` (every beam in the
 *     floating layout has an identical size.z = deck lengthMm).
 *
 * ## TICKET-NOTE (autonomous decision, documented in handoff)
 *
 * AC6 literally says `size.z = shorter offcut length` but the
 * "free-length between the two beam webs" is measured along the +x
 * axis (perpendicular to the beams). The implementation follows the
 * PHYSICAL geometry (long axis of blocking piece = +x = between
 * beams) — putting the free-length on `size.x`. This is documented
 * as an autonomous decision so the reviewer can push back if a
 * different orientation was intended.
 *
 * ## Stable ids
 *
 * `blocking-p{pairIndex}-s{seqIndex}` — pairIndex ∈ [0, N-1),
 * seqIndex ∈ [0, numPerPair). Unique + stable across re-layouts.
 */
import { describe, expect, it } from 'vitest';

import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign, FoundationSpec, LayoutMember, MaterialRef } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';

import { computeBlockGrid } from './block-grid';
import { computeFloatingBeams } from './floating-beam-layout';
import { computeBlocking } from './blocking-layout';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};

const BEAM_SPAN_MAX_MM = 8 * MM_PER_FOOT;
const JOIST_SPAN_MAX_MM = 610;
// IRC blocking recommendation for joists ≥ 2×8: 48" (1220 mm) max
// bracing interval. See spec FR-029 + prompt Q2 (user-confirmed;
// NOT UI-configurable in MVP).
const MAX_BLOCKING_SPACING_MM: Mm = 1220;

function makeFloating(overrides: Partial<{
  widthFt: number;
  lengthFt: number;
  beam: MaterialRef;
  foundation: FoundationSpec;
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000019',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: {
      widthMm: (overrides.widthFt ?? 16) * MM_PER_FOOT,
      lengthMm: (overrides.lengthFt ?? 14) * MM_PER_FOOT,
      heightMm: 300,
    },
    structure: 'floating',
    foundation: overrides.foundation ?? TUFFBLOCK_FOUNDATION,
    joist: { material: overrides.beam ?? PT_2X8, spacingMm: 406 },
    beam: { material: overrides.beam ?? PT_2X8 },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

function beamsFor(design: DeckDesign): readonly LayoutMember[] {
  if (design.foundation.type === 'posts-on-footings') {
    throw new Error('test fixture uses a floating foundation');
  }
  const blocks = computeBlockGrid({
    footprintMm: {
      widthMm: design.footprint.widthMm,
      lengthMm: design.footprint.lengthMm,
    },
    foundation: design.foundation,
    beamSpanMaxMm: BEAM_SPAN_MAX_MM,
    joistSpanMaxMm: JOIST_SPAN_MAX_MM,
  });
  return computeFloatingBeams(design, blocks);
}

// ---------------------------------------------------------------------------
// AC6 count formula — ceil(len / maxSpacing) - 1 pieces per pair
// ---------------------------------------------------------------------------

describe('computeBlocking — AC6 count formula', () => {
  it('16 ft × 14 ft with 3 beams and 48" max spacing → 3 per pair × 2 pairs = 6 pieces', () => {
    // length 4267.2 mm / 1220 = 3.497 → ceil = 4 → -1 = 3 per pair.
    // 3 beams → 2 pairs → 6 pieces total.
    const design = makeFloating({ widthFt: 16, lengthFt: 14 });
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    expect(pieces.length).toBe((beams.length - 1) * 3);
    expect(pieces.length).toBe(6);
  });

  it('20 ft × 20 ft with 4 beams and 48" max spacing → 4 per pair × 3 pairs = 12 pieces', () => {
    // length 6096 mm / 1220 = 4.997 → ceil = 5 → -1 = 4 per pair.
    // 4 beams → 3 pairs → 3 × 4 = 12 pieces.
    const design = makeFloating({ widthFt: 20, lengthFt: 20 });
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    expect(pieces.length).toBe((beams.length - 1) * 4);
    expect(pieces.length).toBe(12);
  });

  it('length shorter than maxSpacing → ceil(len/spacing)-1 = 0 → zero blocking pieces', () => {
    // 4 ft × 4 ft: length 1219.2 / 1220 = 0.999 → ceil = 1 → -1 = 0.
    const design = makeFloating({ widthFt: 4, lengthFt: 4 });
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    expect(pieces.length).toBe(0);
  });

  it('single beam (N=1) → zero pairs → zero blocking pieces', () => {
    // Pathological but the layout math cannot produce a 1-beam grid
    // for any realistic footprint — defensive coverage of the
    // `beams.length < 2` fast-path.
    const design = makeFloating({ widthFt: 16, lengthFt: 14 });
    const [beam0] = beamsFor(design);
    const pieces = computeBlocking({
      beams: [beam0!],
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    expect(pieces.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC6 spacing — evenly-spaced INTERIOR points along +z
// ---------------------------------------------------------------------------

describe('computeBlocking — AC6 spacing', () => {
  it('pieces are placed at evenly-spaced INTERIOR z-positions (not at beam ends)', () => {
    const design = makeFloating({ widthFt: 16, lengthFt: 14 });
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    // 3 per pair × 2 pairs = 6 pieces; unique z-positions = 3 (each
    // z shared across the 2 pairs).
    const uniqueZs = [...new Set(pieces.map((p) => p.position.z))].sort(
      (a, b) => a - b,
    );
    expect(uniqueZs.length).toBe(3);
    // Not at ±lengthMm/2 (interior)
    for (const z of uniqueZs) {
      expect(Math.abs(z)).toBeLessThan(design.footprint.lengthMm / 2);
    }
    // Even spacing between adjacent z-positions AND between the
    // first/last z-position and the deck ends (numPerPair + 1
    // equal-length "cells" along the length).
    const numPerPair = 3;
    const expectedStep = design.footprint.lengthMm / (numPerPair + 1);
    // The first interior z should be -length/2 + expectedStep.
    expect(uniqueZs[0]!).toBeCloseTo(
      -design.footprint.lengthMm / 2 + expectedStep,
      5,
    );
    // Every adjacent gap should equal expectedStep.
    for (let i = 1; i < uniqueZs.length; i++) {
      expect(uniqueZs[i]! - uniqueZs[i - 1]!).toBeCloseTo(expectedStep, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// AC6 member shape — size, position, orientation, material
// ---------------------------------------------------------------------------

describe('computeBlocking — AC6 member shape', () => {
  const design = makeFloating({ widthFt: 16, lengthFt: 14 });

  it('every piece has kind="blocking" and material={kind:"lumber", 2x8 PT No2}', () => {
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    for (const p of pieces) {
      expect(p.kind).toBe('blocking');
      expect(p.material).toEqual({
        kind: 'lumber',
        nominal: '2x8',
        species: 'PT',
        grade: 'No2',
      });
    }
  });

  it('size.x = the free-length between the two beam WEBS (|Δbeam.x| - beam.thickness)', () => {
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    // For the 16-ft-wide 3-beam layout, adjacent beams are at
    // x-centers ~(-widthMm/2, 0, +widthMm/2) — gaps ≈ widthMm/2 each.
    // Free-length = gap − beam.thickness (2×8 thickness = 38 mm).
    const beam0 = beams[0]!;
    const beam1 = beams[1]!;
    const expectedFreeLen = Math.abs(beam1.position.x - beam0.position.x) - beam0.size.x;
    for (const p of pieces) {
      expect(p.size.x).toBeCloseTo(expectedFreeLen, 5);
      expect(p.size.x).toBeGreaterThan(0);
    }
  });

  it('size.y = beam depth (2×8 = 184 mm) — blocking laid on-edge like the beam', () => {
    const beams = beamsFor(design);
    const beamMat = lookupMaterial('2x8', 'PT', 'No2');
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    for (const p of pieces) {
      expect(p.size.y).toBe(beamMat.actual.heightMm);
    }
  });

  it('size.z = beam thickness (blocking nests flush along the beam webs)', () => {
    const beams = beamsFor(design);
    const beamMat = lookupMaterial('2x8', 'PT', 'No2');
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    for (const p of pieces) {
      expect(p.size.z).toBe(beamMat.actual.widthMm);
    }
  });

  it('position.x is the mid-point between the two beam centers (centered in the bay)', () => {
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    // Pair 0: beams[0], beams[1]. Midpoint x = (b0.x + b1.x) / 2.
    const midX_pair0 = (beams[0]!.position.x + beams[1]!.position.x) / 2;
    const midX_pair1 = (beams[1]!.position.x + beams[2]!.position.x) / 2;
    // 3 pieces per pair × 2 pairs — split by expected mid-x.
    const pair0Pieces = pieces.filter((p) => Math.abs(p.position.x - midX_pair0) < 0.5);
    const pair1Pieces = pieces.filter((p) => Math.abs(p.position.x - midX_pair1) < 0.5);
    expect(pair0Pieces.length).toBe(3);
    expect(pair1Pieces.length).toBe(3);
  });

  it('position.y = beam.position.y (blocking sits at the same y as the beams)', () => {
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    for (const p of pieces) {
      expect(p.position.y).toBe(beams[0]!.position.y);
    }
  });

  it('every piece has all-zero rotation (axis-aligned)', () => {
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    for (const p of pieces) {
      expect(p.rotation).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('ids follow blocking-p{pair}-s{seq} pattern; are unique + stable', () => {
    const beams = beamsFor(design);
    const pieces = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    const ids = pieces.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^blocking-p\d+-s\d+$/);
    }
    // Re-run gives byte-equal ids (determinism)
    const again = computeBlocking({
      beams,
      joistNominal: '2x8',
      species: 'PT',
      grade: 'No2',
      maxSpacingMm: MAX_BLOCKING_SPACING_MM,
    });
    expect(again.map((p) => p.id)).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// Trust boundary — degenerate inputs
// ---------------------------------------------------------------------------

describe('computeBlocking — trust-boundary defensive checks', () => {
  it('throws when maxSpacingMm ≤ 0 (would divide-by-zero or infinite loop)', () => {
    const design = makeFloating();
    const beams = beamsFor(design);
    expect(() =>
      computeBlocking({
        beams,
        joistNominal: '2x8',
        species: 'PT',
        grade: 'No2',
        maxSpacingMm: 0,
      }),
    ).toThrow(/maxSpacingMm/i);
    expect(() =>
      computeBlocking({
        beams,
        joistNominal: '2x8',
        species: 'PT',
        grade: 'No2',
        maxSpacingMm: -1,
      }),
    ).toThrow(/maxSpacingMm/i);
  });

  it('throws when a supplied "beam" has kind !== "beam"', () => {
    const notBeam: LayoutMember = {
      id: 'joist-0',
      kind: 'joist',
      material: { kind: 'lumber', ...PT_2X8 },
      position: { x: 0, y: 100, z: 0 },
      size: { x: 38, y: 184, z: 1000 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    expect(() =>
      computeBlocking({
        beams: [notBeam, notBeam],
        joistNominal: '2x8',
        species: 'PT',
        grade: 'No2',
        maxSpacingMm: MAX_BLOCKING_SPACING_MM,
      }),
    ).toThrow(/beam/i);
  });
});
