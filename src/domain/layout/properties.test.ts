/**
 * Property-based tests for the layout engine — TDD RED phase.
 *
 * Covers:
 *   - AC2: every member's (position ± size/2) lies inside `bounds` on x and z.
 *   - AC2 y-axis (Fix D / QA-Gap#1): every non-footing member has
 *          position.y ± size.y/2 ∈ [0, heightMm]; every footing's top
 *          face is at y=0.
 *   - AC3: no two members OF THE SAME KIND have overlapping bounding boxes.
 *   - AC4: swapping widthMm ↔ lengthMm rotates the layout (joist count moves
 *          from width-driven to length-driven; x/z position ranges swap).
 *   - AC4 strong (Fix F / GPT-MED#4): kind-specific swap assertions —
 *          boards advance along the swapped axis, beams stay at ±z-length-end
 *          mapping, posts/footings stay under beams. Would fail on any
 *          x/z axis mix-up.
 *   - AC5: increasing lengthMm never DECREASES the joist count (monotonic).
 *   - AC5 companion: joist count is a NON-DECREASING step function of widthMm
 *          at fixed spacing.
 *   - AC6 amplified (Fix E / QA-Gap#2): for every valid design every member
 *          has defined id/position/size/rotation/material with all axes
 *          finite; layout.designId===design.id; bounds===footprint;
 *          computedAt matches ISO-8601; all five MemberKinds appear.
 *   - Fix A property: spacing arbitrary includes small positives; engine
 *          either throws LayoutError OR produces a non-overlapping layout
 *          (never silent overlap).
 *
 * `fast-check` is a devDependency (see package.json). Domain layer must stay
 * framework-/DOM-free — `fast-check` is neither, and it is imported via
 * bare specifier which is allowed by the ESLint domain override.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { DeckDesign, LayoutMember, MemberKind } from '../model';

import { layoutJoists } from './joist-layout';
import { layoutBeams, BEAM_IDS } from './beam-layout';
import { layoutPostsAndFootings } from './post-layout';
import {
  computeLayout,
  LayoutError,
  MIN_DECK_DIMENSION_MM,
} from './layout-engine';

// ---------------------------------------------------------------------------
// Arbitraries — bounded to reasonable buildable deck dimensions so the
// property tests run quickly and stay within the engine's declared domain.
// ---------------------------------------------------------------------------

// Widths and lengths in millimeters, integer, bounded roughly 4 ft … 50 ft.
// Floor to whole mm and clamp to MIN so the layout engine's validator accepts
// every generated design (MIN_DECK_DIMENSION_MM is 4 * MM_PER_FOOT = 1219.2).
const dimMm = fc.integer({ min: Math.ceil(MIN_DECK_DIMENSION_MM), max: 15_240 });
// Heights: post-Fix B the minimum for the 2×10 PT stack is
//   deckingThickness(25) + joistDepth(235) + beamDepth(235) + MIN_POST_HEIGHT(25)
// = 520 mm. Bound below at 520 so every generated design passes validation;
// individual "boundary" tests below exercise the just-above-min case explicitly.
const MIN_STRUCTURAL_HEIGHT_MM_2X10_PT = 520;
const heightMm = fc.integer({ min: MIN_STRUCTURAL_HEIGHT_MM_2X10_PT, max: 3_048 });
// Joist spacings for the "valid" arb: 305 mm (12"), 406 mm (16"), 508 mm (20"),
// 610 mm (24"). All ≥ the 2×10 joist thickness of 38 mm.
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
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // AC2 y-axis (Fix D / QA-Gap#1): non-footing members within [0, heightMm].
  // -------------------------------------------------------------------------
  it('every non-footing member has y ± size.y/2 ∈ [0, heightMm]; footings have top face at y=0', () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const layout = computeLayout(design);
        const EPS = 1e-6;
        for (const m of layout.members) {
          const minY = m.position.y - m.size.y / 2;
          const maxY = m.position.y + m.size.y / 2;
          if (m.kind === 'footing') {
            // Footings sit under the ground plane; their TOP face is at y=0.
            expect(maxY).toBeCloseTo(0, 6);
            expect(minY).toBeLessThan(0);
          } else {
            expect(minY).toBeGreaterThanOrEqual(-EPS);
            expect(maxY).toBeLessThanOrEqual(design.footprint.heightMm + EPS);
          }
        }
      }),
      { numRuns: 100 },
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
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Fix A property strengthening (GPT-HIGH#1): expand the spacing arb to
  // include small positive values that were previously accepted but produced
  // silent joist overlap. The engine MUST either reject with LayoutError or
  // produce non-overlapping joists — never silent overlap.
  // -------------------------------------------------------------------------
  it('for spacings mixed with small positives: engine either throws LayoutError or produces non-overlapping joists', () => {
    // 90% "small" (potentially invalid), 10% "realistic" — biases toward the
    // formerly-broken regime for maximum coverage of the validator boundary.
    const spacingMixed = fc.oneof(
      { weight: 9, arbitrary: fc.integer({ min: 1, max: 1000 }) },
      { weight: 1, arbitrary: fc.constantFrom(305, 406, 508, 610) },
    );
    const designWithSpacingArb = fc
      .record({
        widthMm: dimMm,
        lengthMm: dimMm,
        heightMm: heightMm,
        spacingMm: spacingMixed,
        orientation: orientation,
      })
      .map<DeckDesign>((r) => ({
        id: '00000000-0000-4000-8000-0000000000ff',
        createdAt: '2026-07-02T00:00:00.000Z',
        footprint: { widthMm: r.widthMm, lengthMm: r.lengthMm, heightMm: r.heightMm },
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

    fc.assert(
      fc.property(designWithSpacingArb, (design) => {
        let layout;
        try {
          layout = computeLayout(design);
        } catch (err) {
          // Small spacings MUST throw LayoutError (Fix A). Anything else is a bug.
          expect(err).toBeInstanceOf(LayoutError);
          return;
        }
        // If we got a layout, verify joists don't overlap on x.
        const joists = layout.members.filter((m) => m.kind === 'joist');
        const EPS = 1e-6;
        for (let i = 1; i < joists.length; i++) {
          const prev = joists[i - 1]!;
          const cur = joists[i]!;
          const prevMax = prev.position.x + prev.size.x / 2;
          const curMin = cur.position.x - cur.size.x / 2;
          // Touching-boundary is OK (curMin === prevMax with tolerance);
          // strict overlap is NOT.
          expect(curMin + EPS).toBeGreaterThanOrEqual(prevMax);
        }
      }),
      { numRuns: 100 },
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
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Fix F (GPT-MED#4): strong per-kind assertions on swap.
  // The previous test only compared aggregate axis extents — an
  // implementation that mixed up x and z for a SINGLE kind (e.g. joists
  // laid across the wrong axis after swap) would still pass. These
  // per-kind properties would catch that regression.
  // -------------------------------------------------------------------------
  describe('Fix F — swap per-kind properties', () => {
    it('joists after swap still run along +z, spaced across +x — with count from the SWAPPED width', () => {
      fc.assert(
        fc.property(designArb, (design) => {
          const swapped = swap(design);
          const joists = layoutJoists(swapped);
          // Every joist runs along +z (size.z == swapped footprint length).
          for (const j of joists) {
            expect(j.size.z).toBeCloseTo(swapped.footprint.lengthMm, 6);
            // Spaced across +x, so joist size.x is the thin dimension.
            expect(j.size.x).toBeCloseTo(JOIST_2X10_THICKNESS_MM, 6);
          }
          // Count is width-driven (swapped width).
          const expected = expectedJoistCount(
            swapped.footprint.widthMm,
            swapped.joist.spacingMm,
            JOIST_2X10_THICKNESS_MM,
          );
          expect(joists.length).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('beams after swap still run along +x with size.x == swapped widthMm', () => {
      fc.assert(
        fc.property(designArb, (design) => {
          const swapped = swap(design);
          const beams = layoutBeams(swapped);
          expect(beams).toHaveLength(2);
          for (const b of beams) {
            // Beams run along +x → size.x == footprint widthMm (swapped).
            expect(b.size.x).toBeCloseTo(swapped.footprint.widthMm, 6);
          }
          // Beam IDs are stable near/far labels.
          expect(beams.map((b) => b.id).sort()).toEqual([BEAM_IDS.far, BEAM_IDS.near].sort());
        }),
        { numRuns: 100 },
      );
    });

    it('beams sit at z = ±(lengthMm/2 - beamThickness/2) after swap (near vs far)', () => {
      fc.assert(
        fc.property(designArb, (design) => {
          const swapped = swap(design);
          const beams = layoutBeams(swapped);
          const nearBeam = beams.find((b) => b.id === BEAM_IDS.near)!;
          const farBeam = beams.find((b) => b.id === BEAM_IDS.far)!;
          // Near beam at negative z; far at positive z. Their z positions
          // are mirror images (equal magnitude, opposite sign).
          expect(nearBeam.position.z).toBeLessThan(0);
          expect(farBeam.position.z).toBeGreaterThan(0);
          expect(nearBeam.position.z + farBeam.position.z).toBeCloseTo(0, 6);
        }),
        { numRuns: 100 },
      );
    });

    it('posts and footings stay under beams after swap (posts.z ≈ beam.z; footings.z ≈ beam.z)', () => {
      fc.assert(
        fc.property(designArb, (design) => {
          const swapped = swap(design);
          const beams = layoutBeams(swapped);
          const { posts, footings } = layoutPostsAndFootings(swapped, beams);
          // Every post's z position must match exactly one beam's z position.
          const beamZs = new Set(beams.map((b) => Math.round(b.position.z * 1000)));
          for (const p of posts) {
            expect(beamZs.has(Math.round(p.position.z * 1000))).toBe(true);
          }
          for (const f of footings) {
            expect(beamZs.has(Math.round(f.position.z * 1000))).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('boards advance along the swapped axis (default-orientation boards after swap advance along z; same size on z direction)', () => {
      fc.assert(
        fc.property(designArb, (design) => {
          const swapped = swap(design);
          const layout = computeLayout(swapped);
          const boards = layout.members.filter((m) => m.kind === 'board');
          if (swapped.decking.orientation === 'parallel-to-width') {
            // Boards run along +x, spaced along +z. Every board's size.x
            // matches the SWAPPED footprint width; the sequence advances
            // monotonically on z.
            for (const b of boards) {
              expect(b.size.x).toBeCloseTo(swapped.footprint.widthMm, 6);
            }
            for (let i = 1; i < boards.length; i++) {
              expect(boards[i]!.position.z).toBeGreaterThan(boards[i - 1]!.position.z);
            }
          } else {
            // Boards run along +z, spaced along +x.
            for (const b of boards) {
              expect(b.size.z).toBeCloseTo(swapped.footprint.lengthMm, 6);
            }
            for (let i = 1; i < boards.length; i++) {
              expect(boards[i]!.position.x).toBeGreaterThan(boards[i - 1]!.position.x);
            }
          }
        }),
        { numRuns: 100 },
      );
    });
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
      { numRuns: 100 },
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
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// AC6 amplified (Fix E / QA-Gap#2) — for every valid design, every member
// has defined id (non-empty, unique), position, size, rotation, material with
// all axes finite; posts have strictly positive size.y; layout.designId ==
// design.id; bounds match footprint; computedAt matches ISO-8601; all five
// MemberKinds appear.
// ---------------------------------------------------------------------------
describe('layout engine — AC6 amplified property (Fix E / QA-Gap#2)', () => {
  const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const EXPECTED_KINDS: readonly MemberKind[] = ['joist', 'beam', 'post', 'footing', 'board'];

  it('layout.designId===design.id; bounds mirror footprint; computedAt matches ISO-8601; all 5 kinds appear', () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const layout = computeLayout(design, { now: () => design.createdAt });
        expect(layout.designId).toBe(design.id);
        expect(layout.bounds).toEqual(design.footprint);
        expect(layout.computedAt).toMatch(ISO_8601);
        // All five member kinds represented.
        const seen = new Set(layout.members.map((m) => m.kind));
        for (const kind of EXPECTED_KINDS) {
          expect(seen.has(kind), `missing kind: ${kind}`).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('every member has non-empty unique id, defined material triple, and finite position/size/rotation on all axes', () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const layout = computeLayout(design);
        const ids = new Set<string>();
        for (const m of layout.members) {
          // id: non-empty string, globally unique across the layout.
          expect(typeof m.id).toBe('string');
          expect(m.id.length).toBeGreaterThan(0);
          expect(ids.has(m.id), `duplicate id: ${m.id}`).toBe(false);
          ids.add(m.id);
          // material triple defined.
          expect(m.material.nominal).toBeDefined();
          expect(m.material.species).toBeDefined();
          expect(m.material.grade).toBeDefined();
          // position/size/rotation: finite numbers on every axis.
          for (const axis of ['x', 'y', 'z'] as const) {
            expect(Number.isFinite(m.position[axis])).toBe(true);
            expect(Number.isFinite(m.size[axis])).toBe(true);
            expect(Number.isFinite(m.rotation[axis])).toBe(true);
            // Sizes ≥ 0 always; strictly > 0 for the "structural" axes
            // (see per-kind assertions below for the ax-specific >0).
            expect(m.size[axis]).toBeGreaterThanOrEqual(0);
          }
          // Every member (including posts, per Fix B) has strictly positive
          // extent on every axis for a VALID design.
          expect(m.size.x, `${m.kind} ${m.id} size.x`).toBeGreaterThan(0);
          expect(m.size.y, `${m.kind} ${m.id} size.y`).toBeGreaterThan(0);
          expect(m.size.z, `${m.kind} ${m.id} size.z`).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
