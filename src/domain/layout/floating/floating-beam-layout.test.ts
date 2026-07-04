/**
 * `src/domain/layout/floating/floating-beam-layout.test.ts` — TDD RED
 * phase for the floating beam layout (S19, AC5).
 *
 * ## Contract under test
 *
 * `computeFloatingBeams(design, blockGrid)` returns one beam per
 * UNIQUE x-position in the block grid — i.e. one beam per "column"
 * of blocks. Each beam:
 *
 *   - `kind = 'beam'`
 *   - `material = {kind:'lumber', ...design.beam.material}`
 *   - runs the full deck LENGTH (`size.z = footprint.lengthMm`)
 *   - has `size.x = beam actual widthMm` (small thickness, laid on-edge)
 *   - has `size.y = beam actual heightMm` (large dimension, resists bending)
 *   - has `position.x` = the block column's x-center
 *   - has `position.y = beam.actual.heightMm / 2` (beam bottom on
 *     block top at y=0 — see y-stack-floating.ts)
 *   - has `position.z = 0` (centered on the length axis)
 *   - has all-zero rotation (axis-aligned)
 *
 * ## User Q1 (confirmed in prompt): beams run along the LENGTH axis.
 *
 * Alternative "along the WIDTH axis" is rejected. This convention
 * matches the user's hand-drawn 16′-long-beam example in the ticket
 * §0 origin. If a future user-story reverses this default, the
 * `floating-beam-layout.ts` implementation is the single seam to
 * flip.
 *
 * ## Stable ids
 *
 * `beam-{i}` where `i ∈ [0, numBeams)` — 0-indexed from the -x edge
 * to the +x edge. Deliberately does NOT reuse the elevated
 * `BEAM_IDS.near / .far` labels — those are specific to the
 * 2-beam elevated case (front / back rim), and would be misleading
 * for a floating N-beam grid.
 */
import { describe, expect, it } from 'vitest';

import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign, FoundationSpec, LayoutMember, MaterialRef } from '../../model';
import { MM_PER_FOOT } from '../../units';

import { computeBlockGrid } from './block-grid';
import { computeFloatingBeams } from './floating-beam-layout';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};

const BEAM_SPAN_MAX_MM = 8 * MM_PER_FOOT;
const JOIST_SPAN_MAX_MM = 610;

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

function blocksFor(design: DeckDesign): readonly LayoutMember[] {
  return computeBlockGrid({
    footprintMm: {
      widthMm: design.footprint.widthMm,
      lengthMm: design.footprint.lengthMm,
    },
    foundation:
      design.foundation.type === 'posts-on-footings'
        ? // Unreachable in floating tests; narrowing helper only.
          (() => {
            throw new Error('test fixture uses a floating foundation');
          })()
        : design.foundation,
    beamSpanMaxMm: BEAM_SPAN_MAX_MM,
    joistSpanMaxMm: JOIST_SPAN_MAX_MM,
  });
}

// ---------------------------------------------------------------------------
// AC5 count — one beam per unique block column
// ---------------------------------------------------------------------------

describe('computeFloatingBeams — AC5 count', () => {
  it('16 ft × 14 ft, 8ft beamSpanMax → 3 unique block columns → 3 beams', () => {
    const design = makeFloating({ widthFt: 16, lengthFt: 14 });
    const blocks = blocksFor(design);
    const beams = computeFloatingBeams(design, blocks);
    const uniqueXs = new Set(blocks.map((b) => b.position.x));
    expect(beams.length).toBe(uniqueXs.size);
    expect(beams.length).toBe(3);
  });

  it('20 ft × 20 ft → 4 unique block columns → 4 beams', () => {
    const design = makeFloating({ widthFt: 20, lengthFt: 20 });
    const blocks = blocksFor(design);
    const beams = computeFloatingBeams(design, blocks);
    expect(beams.length).toBe(4);
  });

  it('4 ft × 4 ft (minimum grid) → 2 unique block columns → 2 beams', () => {
    const design = makeFloating({ widthFt: 4, lengthFt: 4 });
    const blocks = blocksFor(design);
    const beams = computeFloatingBeams(design, blocks);
    expect(beams.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC5 shape — size, position, orientation
// ---------------------------------------------------------------------------

describe('computeFloatingBeams — AC5 member shape', () => {
  const design = makeFloating({ widthFt: 16, lengthFt: 14 });

  it('every beam has size.z = footprint.lengthMm (runs the deck length)', () => {
    const beams = computeFloatingBeams(design, blocksFor(design));
    for (const beam of beams) {
      expect(beam.size.z).toBe(design.footprint.lengthMm);
    }
  });

  it('every beam has size.x = beam thickness, size.y = beam depth (on-edge)', () => {
    const beams = computeFloatingBeams(design, blocksFor(design));
    const beamMat = lookupMaterial('2x8', 'PT', 'No2');
    for (const beam of beams) {
      expect(beam.size.x).toBe(beamMat.actual.widthMm); // 38 mm — thickness
      expect(beam.size.y).toBe(beamMat.actual.heightMm); // 184 mm — depth on-edge
    }
  });

  it('every beam.position.y = beam.actual.heightMm / 2 (beam bottom flush with block top at y=0)', () => {
    const beams = computeFloatingBeams(design, blocksFor(design));
    const beamMat = lookupMaterial('2x8', 'PT', 'No2');
    for (const beam of beams) {
      expect(beam.position.y).toBe(beamMat.actual.heightMm / 2);
    }
  });

  it('every beam.position.z = 0 (centered on the length axis)', () => {
    const beams = computeFloatingBeams(design, blocksFor(design));
    for (const beam of beams) {
      expect(beam.position.z).toBe(0);
    }
  });

  it('beam x-positions match the unique block column x-positions (one beam per column)', () => {
    const blocks = blocksFor(design);
    const beams = computeFloatingBeams(design, blocks);
    const beamXs = new Set(beams.map((b) => b.position.x));
    const blockXs = new Set(blocks.map((b) => b.position.x));
    expect(beamXs).toEqual(blockXs);
  });

  it('every beam has kind="beam" and material={kind:"lumber", ...design.beam.material}', () => {
    const beams = computeFloatingBeams(design, blocksFor(design));
    for (const beam of beams) {
      expect(beam.kind).toBe('beam');
      expect(beam.material).toEqual({ kind: 'lumber', ...design.beam.material });
    }
  });

  it('every beam has all-zero rotation (axis-aligned)', () => {
    const beams = computeFloatingBeams(design, blocksFor(design));
    for (const beam of beams) {
      expect(beam.rotation).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('ids follow the beam-{i} pattern, 0-indexed from -x to +x', () => {
    const beams = computeFloatingBeams(design, blocksFor(design));
    for (let i = 0; i < beams.length; i++) {
      expect(beams[i]!.id).toBe(`beam-${i}`);
    }
    // Beam[0] has the smallest x, beam[N-1] the largest.
    for (let i = 1; i < beams.length; i++) {
      expect(beams[i]!.position.x).toBeGreaterThan(beams[i - 1]!.position.x);
    }
  });
});

// ---------------------------------------------------------------------------
// Beam-material switch — 2x10 beam produces 2x10 dimensions
// ---------------------------------------------------------------------------

describe('computeFloatingBeams — material switch', () => {
  it('2x10 PT beam → size.y = 235 mm (2x10 actual heightMm)', () => {
    const design = makeFloating({ widthFt: 16, lengthFt: 14, beam: PT_2X10 });
    const beams = computeFloatingBeams(design, blocksFor(design));
    const beamMat = lookupMaterial('2x10', 'PT', 'No2');
    for (const beam of beams) {
      expect(beam.size.y).toBe(beamMat.actual.heightMm); // 235 mm
      expect(beam.position.y).toBe(beamMat.actual.heightMm / 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Trust boundary — degenerate block grid rejected loudly
// ---------------------------------------------------------------------------

describe('computeFloatingBeams — trust-boundary defensive checks', () => {
  it('throws when the block grid is empty (no beams derivable)', () => {
    const design = makeFloating();
    expect(() => computeFloatingBeams(design, [])).toThrow(
      /block grid|empty|no blocks/i,
    );
  });

  it('throws when a member in the block grid is not kind="block"', () => {
    const design = makeFloating();
    const notABlock: LayoutMember = {
      id: 'joist-0',
      kind: 'joist',
      material: { kind: 'lumber', ...PT_2X8 },
      position: { x: 0, y: 100, z: 0 },
      size: { x: 38, y: 184, z: 1000 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    expect(() => computeFloatingBeams(design, [notABlock])).toThrow(
      /block/i,
    );
  });
});
