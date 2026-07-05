/**
 * Unit tests for `src/domain/layout/joist-layout.ts` — TDD RED phase.
 *
 * Ticket #5, covers:
 *   - AC1 exact joist count formula for the reference (3660 mm / 406 mm) case
 *   - Every joist is inside the width footprint (per-kind property, promoted
 *     to a global property in properties.test.ts)
 *   - Joists are parallel to +z (length axis): `size.z = footprint.lengthMm`,
 *     `size.x = joist material dressed width`, `size.y = joist material depth`
 *   - `extra-bay-at-end` schema field: accepted but MVP uses even-spaced
 *     placement internally. All bays are exactly equal and ≤ spacingMm.
 *   - Edge cases: minimum viable width (4 ft); spacing that divides evenly;
 *     unknown joist material throws (delegated from lookupMaterial)
 */
import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT } from '../units';
import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign } from '../model';

import { layoutJoists } from './joist-layout';

/** Test-only helper — builds a minimum-viable design. */
function makeDesign(overrides: Partial<{
  widthMm: number;
  lengthMm: number;
  heightMm: number;
  spacingMm: number;
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-07-02T00:00:00.000Z',
    footprint: {
      widthMm: overrides.widthMm ?? 3660,
      lengthMm: overrides.lengthMm ?? 4880,
      heightMm: overrides.heightMm ?? 914,
    },
    structure: 'elevated',
    floatingFraming: 'beams-and-joists',
    beamConnection: 'drop',
    foundation: {
      type: 'posts-on-footings',
      post: { nominal: '6x6', species: 'PT', grade: 'No2' },
      footing: { widthMm: 300, depthMm: 300 },
    },
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: overrides.spacingMm ?? 406,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

describe('layoutJoists — AC1 exact joist count formula', () => {
  it('produces exactly 10 joists for width=3660 mm at 406 mm o.c. spacing', () => {
    // Formula: ceil((widthMm - thicknessMm) / spacingMm) + 1
    // With thickness=38 (2x10 PT): ceil((3660-38)/406) + 1 = ceil(8.923) + 1 = 9 + 1 = 10 joists
    // (See joist-layout.ts header for the ticket-vs-formula reconciliation.)
    const joists = layoutJoists(makeDesign({ widthMm: 3660, spacingMm: 406 }));
    expect(joists).toHaveLength(10);
    for (const j of joists) {
      expect(j.kind).toBe('joist');
    }
  });

  it('produces exactly 11 joists for width=4064 mm at 406 mm o.c. (a nearly-divisible case)', () => {
    // ceil((4064-38)/406) + 1 = ceil(4026/406) + 1 = ceil(9.916) + 1 = 10 + 1 = 11.
    expect(layoutJoists(makeDesign({ widthMm: 4064, spacingMm: 406 }))).toHaveLength(11);
  });

  it('produces exactly 9 joists for width=4064 mm at 508 mm o.c.', () => {
    // ceil((4064-38)/508) + 1 = ceil(7.925) + 1 = 8 + 1 = 9.
    expect(layoutJoists(makeDesign({ widthMm: 4064, spacingMm: 508 }))).toHaveLength(9);
  });

  it('produces at least 2 joists for the minimum viable width (4 ft)', () => {
    const joists = layoutJoists(makeDesign({ widthMm: 4 * MM_PER_FOOT }));
    expect(joists.length).toBeGreaterThanOrEqual(2);
  });
});

describe('layoutJoists — geometry', () => {
  it('every joist runs the full length of the deck along +z', () => {
    const design = makeDesign({ widthMm: 3660, lengthMm: 4880, spacingMm: 406 });
    const joistMaterial = lookupMaterial('2x10', 'PT', 'No2');
    const joists = layoutJoists(design);
    for (const j of joists) {
      expect(j.size.z).toBe(design.footprint.lengthMm);
      expect(j.size.x).toBe(joistMaterial.actual.widthMm); // dressed thickness (38 mm)
      expect(j.size.y).toBe(joistMaterial.actual.heightMm); // dressed depth (235 mm)
    }
  });

  it('every joist is centered on z=0 (extends symmetrically from -length/2 to +length/2)', () => {
    const design = makeDesign({ lengthMm: 4880 });
    for (const j of layoutJoists(design)) {
      expect(j.position.z).toBe(0);
    }
  });

  it('first joist sits flush at x = -widthMm/2 + thickness/2 (flush-left anchor)', () => {
    const design = makeDesign({ widthMm: 3660, spacingMm: 406 });
    const joistMaterial = lookupMaterial('2x10', 'PT', 'No2');
    const joists = layoutJoists(design);
    // "Flush-left" means the joist's -x face lies on x = -widthMm/2. The joist's
    // CENTER position is therefore at -widthMm/2 + thickness/2.
    expect(joists[0]!.position.x).toBeCloseTo(-3660 / 2 + joistMaterial.actual.widthMm / 2, 6);
  });

  it('adjacent joists have a UNIFORM on-center pitch ≤ spacingMm (even-spaced strategy)', () => {
    const design = makeDesign({ widthMm: 3660, spacingMm: 406 });
    const joists = layoutJoists(design);
    // The even-spaced strategy makes ALL bays exactly equal, at a pitch
    // = (widthMm - thicknessMm) / bayCount, which is ≤ spacingMm.
    const gaps: number[] = [];
    for (let i = 1; i < joists.length; i++) {
      gaps.push(joists[i]!.position.x - joists[i - 1]!.position.x);
    }
    const firstGap = gaps[0]!;
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(firstGap, 6);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(406 + 1e-6);
    }
  });

  it('last joist sits flush at the far edge: x = +widthMm/2 - thickness/2', () => {
    const design = makeDesign({ widthMm: 3660, spacingMm: 406 });
    const joistMaterial = lookupMaterial('2x10', 'PT', 'No2');
    const joists = layoutJoists(design);
    expect(joists.at(-1)!.position.x).toBeCloseTo(
      3660 / 2 - joistMaterial.actual.widthMm / 2,
      6,
    );
  });

  it('joists have zero rotation (axis-aligned) for MVP', () => {
    const design = makeDesign();
    for (const j of layoutJoists(design)) {
      expect(j.rotation).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('every joist has a stable, unique, non-empty id', () => {
    const joists = layoutJoists(makeDesign());
    const ids = joists.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^joist-\d+$/);
  });

  it('every joist carries the joist material reference from the design', () => {
    const design = makeDesign();
    for (const j of layoutJoists(design)) {
      // S17 MemberMaterialRef widening — the layout stamps
      // `{kind:'lumber', ...design.joist.material}` (see
      // joist-layout.ts). The assertion matches the wrapped
      // shape; a caller reading `.nominal` / `.species` /
      // `.grade` must first narrow with `kind === 'lumber'`.
      expect(j.material).toEqual({ kind: 'lumber', ...design.joist.material });
    }
  });

  it('is deterministic — same design yields deeply-equal member arrays', () => {
    const design = makeDesign();
    expect(layoutJoists(design)).toEqual(layoutJoists(design));
  });
});

describe('layoutJoists — error paths', () => {
  it('throws when the joist material triple is not in the catalog', () => {
    const bad: DeckDesign = {
      ...makeDesign(),
      joist: {
        // Composite is not a valid 2x10 joist material with Grade 'No2' (Composite uses NA).
        material: { nominal: '2x10', species: 'Composite', grade: 'No2' },
        spacingMm: 406,
      },
    };
    expect(() => layoutJoists(bad)).toThrow(/Unknown material/);
  });
});

describe('layoutJoists — bayRemainderStrategy equivalence (Fix K / MVP)', () => {
  it("'centered' and 'extra-bay-at-end' produce identical joist arrays in MVP", () => {
    // The MVP treats both strategies identically (even-spaced with flush
    // end joists); see `joist-layout.ts` for the deferred TODO for the
    // real 'centered' semantics. This test locks in the current
    // equivalence so a future divergence is a deliberate change with a
    // visible test-update signal, not a silent behavioural drift.
    const proto = makeDesign();
    const centered: DeckDesign = {
      ...proto,
      layout: { bayRemainderStrategy: 'centered' },
    };
    const extraBay: DeckDesign = {
      ...proto,
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    };
    expect(layoutJoists(centered)).toEqual(layoutJoists(extraBay));
  });

  it("equivalence holds for remainder-heavy 3660 × 4880 mm too", () => {
    const proto = makeDesign({ widthMm: 3660, lengthMm: 4880 });
    const centered: DeckDesign = {
      ...proto,
      layout: { bayRemainderStrategy: 'centered' },
    };
    const extraBay: DeckDesign = {
      ...proto,
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    };
    expect(layoutJoists(centered)).toEqual(layoutJoists(extraBay));
  });
});
