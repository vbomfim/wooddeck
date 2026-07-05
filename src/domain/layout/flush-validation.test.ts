/**
 * S27 review-response — flush-beam validation + min-height dispatch
 * + clear-span joist length.
 *
 * Covers the four HIGH findings from PR #64 review gate:
 *
 *   - HIGH #2: `beamConnection === 'flush' && joistDepth > beamDepth`
 *     MUST throw a typed `LayoutError` (elevated + floating Method A)
 *     rather than silently producing an underground joist. UI banner
 *     surfaces via the existing `useDesignStatus().lastError` path.
 *   - HIGH #3: elevated `computeMinStructuralHeightMm` MUST dispatch
 *     on `beamConnection`. Given HIGH #2 guarantees `beam >= joist`
 *     for flush, the flush min-stack collapses to
 *     `decking + beamDepth + MIN_POST` — shorter than drop by
 *     `joistDepth`. A previously-too-short flush design MUST load
 *     at the lower height (delivers the "low-profile flush deck"
 *     headroom feature).
 *   - HIGH #1: flush joist `size.z` MUST equal the CLEAR SPAN
 *     between the two beams (near/far, elevated + floating Method A)
 *     — joists END at the beam inner faces (touch-only) because in
 *     flush construction joists hang OFF the beam face via joist
 *     hangers; a joist that runs THROUGH the beam is physically
 *     impossible. Joist end faces MUST align with beam inner faces
 *     and MUST NOT AABB-overlap the beam. Drop is unchanged
 *     (joists run full length, may cantilever past the beams).
 *   - No framing member's bottom < 0 (below grade) — invariant
 *     asserted for floating flush at the min-height boundary
 *     (regression pin: pre-S27-review the 2×10 joist + 2×8 beam
 *     flush case produced `joistBottomY = -51 mm`).
 *
 * TDD RED: every test below MUST fail against `dec4015` (pre-fix)
 * and pass against the review-response commit.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../model';
import { MM_PER_FOOT, type Mm } from '../units';
import {
  LayoutError,
  MIN_POST_HEIGHT_MM,
  computeLayout,
  computeMinStructuralHeightMm,
} from './layout-engine';
import { computeFloatingLayout } from './floating/floating-layout';
import { computeMinFloatingHeightMm } from './floating/y-stack-floating';
import { lookupMaterial } from '../materials-catalog';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };
const FOOTING_FOUNDATION: FoundationSpec = {
  type: 'posts-on-footings',
  post: { nominal: '6x6', species: 'PT', grade: 'No2' },
  footing: { widthMm: 300, depthMm: 300 },
};
// Oldcastle 11×11×7 accepts 2×6/2×8/2×10 — the widest MVP block —
// so the flush tests below can freely mix joist / beam nominals
// (including 2×10 beams) without hitting the FR-028 acceptsLumber
// gate first.
const OLDCASTLE_FOUNDATION: FoundationSpec = {
  type: 'deck-blocks',
  product: { productId: 'oldcastle-11x11x7' },
};

interface ElevatedOverrides {
  joist?: MaterialRef;
  beam?: MaterialRef;
  beamConnection?: DeckDesign['beamConnection'];
  heightMm?: Mm;
}

function makeElevated(overrides: ElevatedOverrides = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000027',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: {
      widthMm: 3660,
      lengthMm: 4880,
      heightMm: overrides.heightMm ?? 914,
    },
    structure: 'elevated',
    floatingFraming: 'beams-and-joists',
    beamConnection: overrides.beamConnection ?? 'flush',
    foundation: FOOTING_FOUNDATION,
    joist: {
      material: overrides.joist ?? PT_2X10,
      spacingMm: 406,
    },
    beam: { material: overrides.beam ?? PT_2X10 },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

interface FloatOverrides {
  joist?: MaterialRef;
  beam?: MaterialRef;
  beamConnection?: DeckDesign['beamConnection'];
  heightMm?: Mm;
}

function makeFloating(overrides: FloatOverrides = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000f27',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: {
      widthMm: 16 * MM_PER_FOOT,
      lengthMm: 14 * MM_PER_FOOT,
      // 500 mm clears every Method A flush + drop stack for the
      // materials used below (PT 2×8 / 2×10).
      heightMm: overrides.heightMm ?? 500,
    },
    structure: 'floating',
    floatingFraming: 'beams-and-joists',
    beamConnection: overrides.beamConnection ?? 'flush',
    foundation: OLDCASTLE_FOUNDATION,
    joist: {
      material: overrides.joist ?? PT_2X8,
      spacingMm: 406,
    },
    beam: { material: overrides.beam ?? PT_2X8 },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

// ---------------------------------------------------------------------------
// HIGH #2 — joist-deeper-than-beam flush is REJECTED
// ---------------------------------------------------------------------------

describe('HIGH #2 — flush requires beam depth >= joist depth', () => {
  it('elevated flush with 2×10 joist + 2×8 beam throws LayoutError', () => {
    const design = makeElevated({
      joist: PT_2X10, // depth 235
      beam: PT_2X8, //  depth 184
      beamConnection: 'flush',
    });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    // Message MUST name the constraint so the ParameterPanel banner
    // is actionable ("beam >= joist depth" idiom).
    expect(() => computeLayout(design)).toThrow(/flush/i);
    expect(() => computeLayout(design)).toThrow(/beam/i);
    expect(() => computeLayout(design)).toThrow(/joist/i);
    expect(() => computeLayout(design)).toThrow(/depth/i);
  });

  it('floating Method A flush with 2×10 joist + 2×8 beam throws LayoutError', () => {
    const design = makeFloating({
      joist: PT_2X10,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    expect(() => computeFloatingLayout(design)).toThrow(LayoutError);
    expect(() => computeFloatingLayout(design)).toThrow(/flush/i);
    expect(() => computeFloatingLayout(design)).toThrow(/beam/i);
    expect(() => computeFloatingLayout(design)).toThrow(/depth/i);
  });

  it('elevated flush with 2×8 joist + 2×10 beam is ACCEPTED (beam deeper)', () => {
    const design = makeElevated({
      joist: PT_2X8,
      beam: PT_2X10,
      beamConnection: 'flush',
    });
    expect(() => computeLayout(design)).not.toThrow();
  });

  it('elevated flush with equal 2×10 joist + 2×10 beam is ACCEPTED', () => {
    const design = makeElevated({
      joist: PT_2X10,
      beam: PT_2X10,
      beamConnection: 'flush',
    });
    expect(() => computeLayout(design)).not.toThrow();
  });

  it('DROP with 2×10 joist + 2×8 beam is ACCEPTED (only flush cares)', () => {
    const design = makeElevated({
      joist: PT_2X10,
      beam: PT_2X8,
      beamConnection: 'drop',
    });
    expect(() => computeLayout(design)).not.toThrow();
  });

  it('floating Method B ignores beamConnection — no rejection even at flush + deep joist', () => {
    // Method B has NO beam layer, so `beamConnection` is a no-op
    // and the deeper-joist check MUST NOT fire.
    const design = makeFloating({
      joist: PT_2X10,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const methodB: DeckDesign = { ...design, floatingFraming: 'joists-on-blocks' };
    expect(() => computeFloatingLayout(methodB)).not.toThrow();
  });

  it('floating flush min-height design keeps every ABOVE-GRADE member bottom >= 0 (no framing below grade)', () => {
    // Regression pin — pre-fix the flush stack with 2×10 joist + 2×8
    // beam produced `joistBottomY = -51 mm` at the min-height
    // boundary. Post-fix that combo is REJECTED (see above); this
    // test asserts the VALID flush combo (beam ≥ joist) keeps every
    // FRAMING member (joist, beam, decking) bottom on or above grade.
    // Blocks are intentionally buried (blockTopY = 0, blockBottomY < 0)
    // — they are the foundation, not framing — so we exclude them.
    const design = makeFloating({
      joist: PT_2X8,
      beam: PT_2X10, // deeper beam — legal flush
      beamConnection: 'flush',
    });
    const minHeightMm = computeMinFloatingHeightMm(design);
    const atMin: DeckDesign = { ...design, footprint: { ...design.footprint, heightMm: minHeightMm } };
    const layout = computeFloatingLayout(atMin);
    const framingKinds: readonly string[] = ['joist', 'beam', 'board', 'post'];
    for (const m of layout.members) {
      if (!framingKinds.includes(m.kind)) continue;
      const bottomY = m.position.y - m.size.y / 2;
      expect(bottomY, `${m.kind} ${m.id} bottom must be >= 0`).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// HIGH #3 — elevated computeMinStructuralHeightMm dispatches on beamConnection
// ---------------------------------------------------------------------------

describe('HIGH #3 — elevated min-height dispatches on beamConnection', () => {
  it('flush min == decking + max(joist,beam) + MIN_POST', () => {
    // Legal flush (equal 2×10 joist + 2×10 beam) — max(joist,beam)
    // collapses to either. Use unequal (2×8 joist + 2×10 beam) so
    // the max() truly matters and isn't a coincidence.
    const flush = makeElevated({
      joist: PT_2X8,
      beam: PT_2X10,
      beamConnection: 'flush',
    });
    const beamMat = lookupMaterial('2x10', 'PT', 'No2');
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    const expected =
      decking.actual.widthMm + beamMat.actual.heightMm + MIN_POST_HEIGHT_MM;
    expect(computeMinStructuralHeightMm(flush)).toBe(expected);
  });

  it('flush min < drop min (delta == joistDepth, the overlap)', () => {
    const flush = makeElevated({
      joist: PT_2X8,
      beam: PT_2X10,
      beamConnection: 'flush',
    });
    const drop: DeckDesign = { ...flush, beamConnection: 'drop' };
    const flushMin = computeMinStructuralHeightMm(flush);
    const dropMin = computeMinStructuralHeightMm(drop);
    const joist = lookupMaterial('2x8', 'PT', 'No2');
    // Flush is shorter by exactly the joist depth (the y-overlap
    // between joist and beam vanishes because beam >= joist).
    expect(dropMin - flushMin).toBe(joist.actual.heightMm);
  });

  it('drop min is BYTE-IDENTICAL to pre-S27 (regression pin)', () => {
    // Pre-S27 fixed the pinned drop formula:
    //   decking(5/4x6=25) + joist(2x10=235) + beam(2x10=235) + MIN_POST(25)
    //     = 520 mm
    const drop = makeElevated({
      joist: PT_2X10,
      beam: PT_2X10,
      beamConnection: 'drop',
    });
    expect(computeMinStructuralHeightMm(drop)).toBe(520);
  });

  it('a low-profile flush deck that drop REJECTS now LOADS', () => {
    // Take an unequal-depth flush design and pick a height that
    // clears the flush min but NOT the drop min. Assert:
    //   - flush at that height computes a layout OK;
    //   - drop at that height throws LayoutError with a height message.
    const flush = makeElevated({
      joist: PT_2X8,
      beam: PT_2X10,
      beamConnection: 'flush',
    });
    const flushMin = computeMinStructuralHeightMm(flush);
    const drop: DeckDesign = { ...flush, beamConnection: 'drop' };
    const dropMin = computeMinStructuralHeightMm(drop);
    expect(flushMin).toBeLessThan(dropMin);
    // Pick a height strictly between the two.
    const between = flushMin + 1;
    expect(between).toBeLessThan(dropMin);

    const lowFlush: DeckDesign = {
      ...flush,
      footprint: { ...flush.footprint, heightMm: between },
    };
    expect(() => computeLayout(lowFlush)).not.toThrow();

    const lowDrop: DeckDesign = {
      ...drop,
      footprint: { ...drop.footprint, heightMm: between },
    };
    expect(() => computeLayout(lowDrop)).toThrow(LayoutError);
    expect(() => computeLayout(lowDrop)).toThrow(/height/i);
  });
});

// ---------------------------------------------------------------------------
// HIGH #1 — flush joists END at beam inner faces (no pass-through)
// ---------------------------------------------------------------------------

describe('HIGH #1 — flush joist length = clear span between beam inner faces', () => {
  it('ELEVATED flush: joist size.z == far-inner-z − near-inner-z (touch-only)', () => {
    const design = makeElevated({
      joist: PT_2X8,
      beam: PT_2X10,
      beamConnection: 'flush',
    });
    const layout = computeLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(2);
    expect(joists.length).toBeGreaterThan(0);

    const nearBeam = beams.find((b) => b.position.z < 0);
    const farBeam = beams.find((b) => b.position.z > 0);
    if (!nearBeam || !farBeam) throw new Error('expected near+far beams');
    const nearInnerZ = nearBeam.position.z + nearBeam.size.z / 2;
    const farInnerZ = farBeam.position.z - farBeam.size.z / 2;
    const expectedLength = farInnerZ - nearInnerZ;

    for (const j of joists) {
      expect(j.size.z).toBeCloseTo(expectedLength, 6);
      // Joist centered on the length axis (position.z stays 0).
      expect(j.position.z).toBe(0);
      // End faces touch beam inner faces.
      expect(j.position.z - j.size.z / 2).toBeCloseTo(nearInnerZ, 6);
      expect(j.position.z + j.size.z / 2).toBeCloseTo(farInnerZ, 6);
    }
  });

  it('ELEVATED flush: joists and beams do NOT AABB-overlap on z (touch-only)', () => {
    const design = makeElevated({
      joist: PT_2X8,
      beam: PT_2X10,
      beamConnection: 'flush',
    });
    const layout = computeLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const beams = layout.members.filter((m) => m.kind === 'beam');

    // Touch-only: joistEndZ - beamInnerZ = 0 (strict equality within
    // floating-point tolerance). A NEGATIVE gap (i.e. joist extends
    // INTO the beam volume) is the pre-fix bug — assert POSITIVE-OR-ZERO.
    for (const j of joists) {
      const jNear = j.position.z - j.size.z / 2;
      const jFar = j.position.z + j.size.z / 2;
      for (const b of beams) {
        const bNear = b.position.z - b.size.z / 2;
        const bFar = b.position.z + b.size.z / 2;
        // Interval overlap = min(jFar, bFar) - max(jNear, bNear).
        // For touch-only, overlap MUST be <= 0 (touching = 0, no
        // interpenetration).
        const overlap = Math.min(jFar, bFar) - Math.max(jNear, bNear);
        expect(overlap).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('ELEVATED drop: joist size.z == footprint.lengthMm (UNCHANGED — may cantilever)', () => {
    const design = makeElevated({
      joist: PT_2X10,
      beam: PT_2X10,
      beamConnection: 'drop',
    });
    const layout = computeLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    expect(joists.length).toBeGreaterThan(0);
    for (const j of joists) {
      expect(j.size.z).toBe(design.footprint.lengthMm);
    }
  });

  it('FLOATING Method A flush: joist size.z == clear span between rim-beam inner faces', () => {
    const design = makeFloating({
      joist: PT_2X8,
      beam: PT_2X10,
      beamConnection: 'flush',
    });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(2);
    expect(joists.length).toBeGreaterThan(0);

    const nearBeam = beams.find((b) => b.position.z < 0);
    const farBeam = beams.find((b) => b.position.z > 0);
    if (!nearBeam || !farBeam) throw new Error('expected near+far rim beams');
    const nearInnerZ = nearBeam.position.z + nearBeam.size.z / 2;
    const farInnerZ = farBeam.position.z - farBeam.size.z / 2;
    const expectedLength = farInnerZ - nearInnerZ;

    for (const j of joists) {
      expect(j.size.z).toBeCloseTo(expectedLength, 6);
      expect(j.position.z).toBe(0);
    }
  });

  it('FLOATING Method A drop: joist size.z == footprint.lengthMm (UNCHANGED)', () => {
    const design = makeFloating({ beamConnection: 'drop' });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    for (const j of joists) {
      expect(j.size.z).toBe(design.footprint.lengthMm);
    }
  });

  it('FLOATING Method B ignores beamConnection — joist size.z == footprint.lengthMm', () => {
    // Method B has no beams — flush is a no-op geometrically.
    const design = makeFloating({ beamConnection: 'flush' });
    const methodB: DeckDesign = { ...design, floatingFraming: 'joists-on-blocks' };
    const layout = computeFloatingLayout(methodB);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    for (const j of joists) {
      expect(j.size.z).toBe(design.footprint.lengthMm);
    }
  });
});
