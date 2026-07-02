/**
 * Property-based tests for the layout engine — TDD RED phase.
 *
 * Covers:
 *   - AC2: every member's (position ± size/2) lies inside `bounds` on x and z.
 *   - AC3: no two members OF THE SAME KIND have overlapping bounding boxes.
 *   - AC4: swapping widthMm ↔ lengthMm rotates the layout (joist count moves
 *          from width-driven to length-driven; x/z position ranges swap).
 *   - AC5: increasing lengthMm never DECREASES the joist count (monotonicity).
 *          NOTE — joist COUNT is driven by WIDTH (they are spaced across
 *          width). So the true monotonic relationship is "increasing widthMm
 *          never DECREASES joist count". The AC5 phrasing is preserved
 *          verbatim, but the stronger, width-monotonic version is asserted
 *          alongside it (and the length-monotonic version is verified as an
 *          equality — joist count is invariant to length).
 *   - AC5 companion property: joist count is a NON-DECREASING step function
 *          of widthMm at fixed spacing.
 *
 * `fast-check` is a devDependency (see package.json). Domain layer must stay
 * framework-/DOM-free — `fast-check` is neither, and it is imported via
 * bare specifier which is allowed by the ESLint domain override.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { DeckDesign, LayoutMember } from '../model';

import { layoutJoists } from './joist-layout';
import { computeLayout, MIN_DECK_DIMENSION_MM } from './layout-engine';

// ---------------------------------------------------------------------------
// Arbitraries — bounded to reasonable buildable deck dimensions so the
// property tests run quickly and stay within the engine's declared domain.
// ---------------------------------------------------------------------------

// Widths and lengths in millimeters, integer, bounded roughly 4 ft … 50 ft.
// Floor to whole mm and clamp to MIN so the layout engine's validator accepts
// every generated design (MIN_DECK_DIMENSION_MM is 4 * MM_PER_FOOT = 1219.2).
const dimMm = fc.integer({ min: Math.ceil(MIN_DECK_DIMENSION_MM), max: 15_240 });
// Heights: 0 (edge case) up to ~10 ft.
const heightMm = fc.integer({ min: 0, max: 3_048 });
// Joist spacings: 305 mm (12"), 406 mm (16"), 508 mm (20"), 610 mm (24").
const spacingMm = fc.constantFrom(305, 406, 508, 610);
// Decking orientations.
const orientation = fc.constantFrom(
  'parallel-to-width' as const,
  'parallel-to-length' as const,
);

const designArb = fc
  .record({
    widthMm: dimMm,
    lengthMm: dimMm,
    heightMm: heightMm,
    spacingMm: spacingMm,
    orientation: orientation,
  })
  .map<DeckDesign>((r) => ({
    id: '00000000-0000-4000-8000-0000000000ff',
    createdAt: '2026-07-02T00:00:00.000Z',
    footprint: {
      widthMm: r.widthMm,
      lengthMm: r.lengthMm,
      heightMm: r.heightMm,
    },
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: r.spacingMm,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
    post: { material: { nominal: '6x6', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: r.orientation,
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  }));

// The dressed thickness of a 2×10 PT joist — hard-coded here to keep the
// property test's expected-count formula pure (no catalog lookup per
// iteration). Matches lookupMaterial('2x10', 'PT', 'No2').actual.widthMm.
const JOIST_2X10_THICKNESS_MM = 38;

/**
 * The joist-count formula the engine implements. Kept as a helper so
 * the property tests can predict counts without duplicating the
 * flush-left/on-spacing/flush-right derivation. See joist-layout.ts
 * header for the algorithm.
 */
function expectedJoistCount(widthMm: number, spacingMm: number, thicknessMm: number): number {
  const usable = widthMm - thicknessMm;
  return Math.ceil(usable / spacingMm) + 1;
}

// ---------------------------------------------------------------------------
// AC2 — every member is inside the footprint on x and z.
// ---------------------------------------------------------------------------
describe('layout engine — AC2 property: members inside footprint', () => {
  it('every member (except footings on y-below-ground) satisfies |pos ± size/2| ≤ bounds/2 on x and z', () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const layout = computeLayout(design);
        const halfW = design.footprint.widthMm / 2;
        const halfL = design.footprint.lengthMm / 2;
        // Tolerance for floating-point residuals in position ± size/2 comparisons.
        const EPS = 1e-6;
        for (const m of layout.members) {
          const minX = m.position.x - m.size.x / 2;
          const maxX = m.position.x + m.size.x / 2;
          const minZ = m.position.z - m.size.z / 2;
          const maxZ = m.position.z + m.size.z / 2;
          expect(minX).toBeGreaterThanOrEqual(-halfW - EPS);
          expect(maxX).toBeLessThanOrEqual(halfW + EPS);
          expect(minZ).toBeGreaterThanOrEqual(-halfL - EPS);
          expect(maxZ).toBeLessThanOrEqual(halfL + EPS);
        }
      }),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// AC3 — no two members OF THE SAME KIND overlap.
// ---------------------------------------------------------------------------
describe('layout engine — AC3 property: no same-kind bounding-box overlap', () => {
  function boxesOverlap(a: LayoutMember, b: LayoutMember): boolean {
    // Two axis-aligned boxes overlap iff they overlap on every axis.
    // Touching faces (equal on the boundary) DO NOT count as overlap — the
    // MVP places joists edge-to-edge with the ±half-thickness convention,
    // and boards touch at their gap boundaries; treating touching as
    // overlap would trip on legitimate flush layouts.
    const EPS = 1e-6;
    const axisOverlap = (
      aMin: number,
      aMax: number,
      bMin: number,
      bMax: number,
    ): boolean => aMax - EPS > bMin && bMax - EPS > aMin;
    return (
      axisOverlap(
        a.position.x - a.size.x / 2,
        a.position.x + a.size.x / 2,
        b.position.x - b.size.x / 2,
        b.position.x + b.size.x / 2,
      ) &&
      axisOverlap(
        a.position.y - a.size.y / 2,
        a.position.y + a.size.y / 2,
        b.position.y - b.size.y / 2,
        b.position.y + b.size.y / 2,
      ) &&
      axisOverlap(
        a.position.z - a.size.z / 2,
        a.position.z + a.size.z / 2,
        b.position.z - b.size.z / 2,
        b.position.z + b.size.z / 2,
      )
    );
  }

  it('for every pair of same-kind members, their bounding boxes are disjoint (touch-only allowed)', () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const layout = computeLayout(design);
        // Group by kind, then all-pairs check.
        const byKind = new Map<string, LayoutMember[]>();
        for (const m of layout.members) {
          const list = byKind.get(m.kind) ?? [];
          list.push(m);
          byKind.set(m.kind, list);
        }
        for (const [, list] of byKind) {
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              expect(boxesOverlap(list[i]!, list[j]!)).toBe(false);
            }
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// AC4 — swap width/length → rotated layout with predictable count changes.
// ---------------------------------------------------------------------------
describe('layout engine — AC4 width/length swap ⇒ rotated layout', () => {
  function swap(d: DeckDesign): DeckDesign {
    return {
      ...d,
      footprint: {
        widthMm: d.footprint.lengthMm,
        lengthMm: d.footprint.widthMm,
        heightMm: d.footprint.heightMm,
      },
    };
  }

  it('joist count for D matches width-driven formula; joist count for swap(D) matches length-driven formula', () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const original = layoutJoists(design);
        const swapped = layoutJoists(swap(design));
        // Joist count is ceil((W - t) / S) + 1 (see joist-layout.ts header).
        const expectedOriginal = expectedJoistCount(
          design.footprint.widthMm,
          design.joist.spacingMm,
          JOIST_2X10_THICKNESS_MM,
        );
        const expectedSwapped = expectedJoistCount(
          design.footprint.lengthMm,
          design.joist.spacingMm,
          JOIST_2X10_THICKNESS_MM,
        );
        expect(original.length).toBe(expectedOriginal);
        expect(swapped.length).toBe(expectedSwapped);
      }),
      { numRuns: 40 },
    );
  });

  it('for a specific non-square design, swap swaps the x/z position RANGES of all members', () => {
    // Non-property test — a concrete example makes the "rotation" concept crisp.
    const D: DeckDesign = {
      id: '00000000-0000-4000-8000-000000000006',
      createdAt: '2026-07-02T00:00:00.000Z',
      footprint: { widthMm: 3660, lengthMm: 6096, heightMm: 914 },
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
    const layoutD = computeLayout(D);
    const layoutS = computeLayout(swap(D));

    // Original x range = ±widthMm/2 = ±1830
    // Original z range = ±lengthMm/2 = ±3048
    // After swap: x range = ±3048, z range = ±1830.
    const xRangeD = extentOnAxis(layoutD.members, 'x');
    const zRangeD = extentOnAxis(layoutD.members, 'z');
    const xRangeS = extentOnAxis(layoutS.members, 'x');
    const zRangeS = extentOnAxis(layoutS.members, 'z');
    // The swapped layout's x-range magnitude matches the original z-range magnitude.
    expect(Math.round(xRangeS)).toBe(Math.round(zRangeD));
    expect(Math.round(zRangeS)).toBe(Math.round(xRangeD));
  });

  function extentOnAxis(
    members: readonly LayoutMember[],
    axis: 'x' | 'z',
  ): number {
    let min = Infinity;
    let max = -Infinity;
    for (const m of members) {
      const lo = m.position[axis] - m.size[axis] / 2;
      const hi = m.position[axis] + m.size[axis] / 2;
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    }
    return max - min;
  }
});

// ---------------------------------------------------------------------------
// AC5 — monotonicity.
// ---------------------------------------------------------------------------
describe('layout engine — AC5 monotonicity', () => {
  it('joist count is INVARIANT under increasing lengthMm (joists span length; count is width-driven)', () => {
    // AC5 as ticket-worded says "increasing lengthMm never DECREASES joist
    // count". Under our joists-run-parallel-to-z convention the count is
    // width-driven, so the correct (stricter) statement is that it is
    // INVARIANT to length. Verifying invariance is a stronger property
    // than non-decreasing, so this satisfies AC5.
    fc.assert(
      fc.property(designArb, fc.integer({ min: 1, max: 20_000 }), (design, delta) => {
        const bigger: DeckDesign = {
          ...design,
          footprint: {
            ...design.footprint,
            lengthMm: design.footprint.lengthMm + delta,
          },
        };
        expect(layoutJoists(bigger).length).toBe(layoutJoists(design).length);
      }),
      { numRuns: 40 },
    );
  });

  it('joist count is NON-DECREASING under increasing widthMm (companion width-monotonic property)', () => {
    fc.assert(
      fc.property(designArb, fc.integer({ min: 1, max: 20_000 }), (design, delta) => {
        const wider: DeckDesign = {
          ...design,
          footprint: {
            ...design.footprint,
            widthMm: design.footprint.widthMm + delta,
          },
        };
        expect(layoutJoists(wider).length).toBeGreaterThanOrEqual(layoutJoists(design).length);
      }),
      { numRuns: 40 },
    );
  });
});
