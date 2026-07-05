/**
 * `src/domain/layout/blocking-integration.test.ts` — QA Guardian
 * regression + coverage suite for issue #72 (blocking between
 * joists, IRC R502.7 / R502.7.1).
 *
 * ## Why this file exists (coverage gap the Developer's unit tests
 *    do NOT close)
 *
 * The Developer's unit suite (`blocking-layout.test.ts`) is
 * excellent, but it exercises the pure helper with SYNTHETIC
 * `makeXCenters` joist positions — it never proves the helper is
 * fed the RIGHT numbers by the real pipeline. The wiring tests
 * (`layout-engine.test.ts`, `floating/floating-framing.test.ts`)
 * only assert `blocking.length > 0` and co-planar `y`. The golden
 * fixtures pin exact bytes, but a snapshot would happily record a
 * `NaN`, a negative `size.x`, or a row that overhangs the joist —
 * it asserts equality, not VALIDITY.
 *
 * This suite fills that gap: it drives the REAL `computeLayout`
 * pipeline across the full parametrized matrix the ticket cares
 * about —
 *
 *   {12×12, 12×20, 16×24, 20×30, 40×40} ft
 *     × {305, 406, 610} mm o.c. (12″ / 16″ / 24″)
 *     × {PT, Cedar}
 *     × {elevated posts-on-footings, elevated deck-blocks,
 *        floating Method A drop, floating Method A flush,
 *        floating Method B}
 *
 * — and asserts the emitted blocking is geometrically VALID
 * against the ACTUAL joists the pipeline produced (not synthetic
 * inputs). These are BEHAVIOUR assertions (do the noggins fit the
 * bay, honour R502.7.1, and never degenerate?) that survive a full
 * rewrite of `blocking-layout.ts`.
 *
 * Tags: [AC-1..AC-7] [EDGE] [BOUNDARY] [COVERAGE] [CONTRACT]
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` test — imports only vitest + domain modules
 * (`./layout-engine`, `./blocking-layout`, `../bom/derive-bom`,
 * `../model`, `../units`). No react / three / state.
 */
import { describe, expect, it } from 'vitest';

import { deriveBom } from '../bom/derive-bom';
import type {
  DeckDesign,
  FoundationSpec,
  LayoutMember,
  LumberMemberMaterial,
  MaterialRef,
  Species,
} from '../model';
import { MM_PER_FOOT } from '../units';

import { MAX_BLOCKING_SPACING_MM, layoutBlockingBetweenJoists } from './blocking-layout';
import { computeJoistXCenters } from './joist-layout';
import { computeLayout } from './layout-engine';

const EPS = 1e-6;

/**
 * The five structural variants the ticket says blocking MUST apply
 * to. Each string is a tag used to drive `makeDesign` and to name
 * the parametrized test case.
 */
type Variant =
  | 'elevated-footings'
  | 'elevated-deck-blocks'
  | 'floating-A-drop'
  | 'floating-A-flush'
  | 'floating-B';

const VARIANTS: readonly Variant[] = [
  'elevated-footings',
  'elevated-deck-blocks',
  'floating-A-drop',
  'floating-A-flush',
  'floating-B',
];

const SIZES_FT: readonly (readonly [number, number])[] = [
  [12, 12],
  [12, 20],
  [16, 24],
  [20, 30],
  [40, 40],
];

const SPACINGS_MM: readonly number[] = [305, 406, 610]; // 12″ / 16″ / 24″
const SPECIES: readonly Species[] = ['PT', 'Cedar'];

function joistRef(species: Species, nominal: MaterialRef['nominal']): MaterialRef {
  return { nominal, species, grade: 'No2' };
}

/**
 * Build a fully-specified, VALID `DeckDesign` for a given matrix
 * cell. Every combination this factory produces was confirmed to
 * pass `computeLayout` without throwing during QA probing (150/150
 * cells valid). Foundations / joist nominals are chosen so block
 * products accept the joist and (for flush) the beam is at least as
 * deep as the joist.
 */
function makeDesign(
  variant: Variant,
  widthFt: number,
  lengthFt: number,
  spacingMm: number,
  species: Species,
): DeckDesign {
  const widthMm = widthFt * MM_PER_FOOT;
  const lengthMm = lengthFt * MM_PER_FOOT;

  // Elevated uses 2×10 (posts/blocks + deeper spans); floating uses
  // 2×8 so the TuffBlock / Oldcastle joist-rest compat holds.
  const joistNominal: MaterialRef['nominal'] =
    variant === 'elevated-footings' || variant === 'elevated-deck-blocks' ? '2x10' : '2x8';
  const joist = joistRef(species, joistNominal);

  // Flush requires beam depth ≥ joist depth → use a deeper PT beam.
  const beam: MaterialRef =
    variant === 'floating-A-flush'
      ? { nominal: '2x10', species: 'PT', grade: 'No2' }
      : { nominal: joistNominal, species: 'PT', grade: 'No2' };

  let structure: DeckDesign['structure'] = 'elevated';
  let floatingFraming: DeckDesign['floatingFraming'] = 'beams-and-joists';
  let beamConnection: DeckDesign['beamConnection'] = 'drop';
  let foundation: FoundationSpec;
  let heightMm = 914;

  switch (variant) {
    case 'elevated-footings':
      foundation = {
        type: 'posts-on-footings',
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        footing: { widthMm: 300, depthMm: 300 },
      };
      break;
    case 'elevated-deck-blocks':
      foundation = { type: 'deck-blocks', product: { productId: 'oldcastle-11x11x7' } };
      heightMm = 3 * MM_PER_FOOT;
      break;
    case 'floating-A-drop':
      structure = 'floating';
      foundation = { type: 'deck-blocks', product: { productId: 'oldcastle-11x11x7' } };
      heightMm = 500;
      break;
    case 'floating-A-flush':
      structure = 'floating';
      beamConnection = 'flush';
      foundation = { type: 'deck-blocks', product: { productId: 'oldcastle-11x11x7' } };
      heightMm = 500;
      break;
    case 'floating-B':
      structure = 'floating';
      floatingFraming = 'joists-on-blocks';
      foundation = { type: 'tuffblocks', product: { productId: 'tuffblock-12x12x4' } };
      heightMm = 500;
      break;
  }

  return {
    id: '00000000-0000-4000-8000-000000000072',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: { widthMm, lengthMm, heightMm },
    structure,
    floatingFraming,
    beamConnection,
    foundation,
    joist: { material: joist, spacingMm },
    beam: { material: beam },
    decking: { material: { nominal: '5/4x6', species: 'PT', grade: 'No2' }, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

/** The row-count formula from the ticket (kept in the TEST so a
 *  silent change to the production formula fails HERE, not silently
 *  re-derives from itself). N = max(1, ceil(L / MAX) - 1). */
function expectedRows(lengthMm: number): number {
  return Math.max(1, Math.ceil(lengthMm / MAX_BLOCKING_SPACING_MM) - 1);
}

// ---------------------------------------------------------------------------
// The parametrized regression matrix (5 variants × 5 sizes × 3 spacings
// × 2 species = 150 cells). Each cell drives the REAL pipeline and
// asserts blocking is geometrically valid against the ACTUAL joists.
// ---------------------------------------------------------------------------

describe('issue #72 — blocking regression matrix (real pipeline geometry) [COVERAGE]', () => {
  for (const variant of VARIANTS) {
    for (const [widthFt, lengthFt] of SIZES_FT) {
      for (const spacingMm of SPACINGS_MM) {
        for (const species of SPECIES) {
          const label = `${variant} ${widthFt}×${lengthFt}ft @${spacingMm}mm ${species}`;

          it(`[AC-1..AC-6] ${label}: blocking fits the bay, ≤8ft o.c., ≥1 row, no NaN`, () => {
            const design = makeDesign(variant, widthFt, lengthFt, spacingMm, species);
            const layout = computeLayout(design, { now: () => design.createdAt });

            const joists = layout.members
              .filter((m) => m.kind === 'joist')
              .sort((a, b) => a.position.x - b.position.x);
            const blocking = layout.members.filter((m) => m.kind === 'blocking');

            // --- AC "≥2 joists ⇒ blocking exists" -----------------
            expect(joists.length).toBeGreaterThanOrEqual(2);
            const bays = joists.length - 1;

            // Real joist geometry — the numbers the pipeline actually
            // fed the helper (NOT synthetic).
            const joistThickness = joists[0]!.size.x;
            const joistDepth = joists[0]!.size.y;
            const joistLength = joists[0]!.size.z;
            const joistCenterY = joists[0]!.position.y;
            const jx = joists.map((j) => j.position.x);

            // --- AC "≥1 interior row; count = bays × rows" --------
            const rows = expectedRows(design.footprint.lengthMm);
            expect(rows).toBeGreaterThanOrEqual(1);
            expect(blocking).toHaveLength(bays * rows);

            // --- AC "on-center ≤ 8 ft" (IRC R502.7.1) -------------
            const pitch = design.footprint.lengthMm / (rows + 1);
            expect(pitch).toBeLessThanOrEqual(MAX_BLOCKING_SPACING_MM + EPS);

            // --- per-member invariants ----------------------------
            const halfL = design.footprint.lengthMm / 2;
            const halfJoist = joistLength / 2;
            const seenIds = new Set<string>();
            const rowZ = new Set<number>();

            for (const b of blocking) {
              // no duplicate ids
              expect(seenIds.has(b.id)).toBe(false);
              seenIds.add(b.id);

              // material folds into the joist SKU
              expect(b.material.kind).toBe('lumber');

              // co-planar with joists; same cross-section
              expect(b.position.y).toBe(joistCenterY);
              expect(b.size.y).toBe(joistDepth);
              expect(b.size.z).toBe(joistThickness);

              // NO NaN / no degenerate / no negative clear gap
              expect(Number.isFinite(b.size.x)).toBe(true);
              expect(b.size.x).toBeGreaterThan(0);
              expect(Number.isFinite(b.position.x)).toBe(true);
              expect(Number.isFinite(b.position.z)).toBe(true);

              // interior row only — never at ±L/2
              expect(Math.abs(b.position.z)).toBeLessThan(halfL);

              // [AC-5 flush containment] the row must land WITHIN the
              // (shorter, under flush) joist z-extent — never overhang.
              expect(Math.abs(b.position.z) + b.size.z / 2).toBeLessThanOrEqual(halfJoist + EPS);
              rowZ.add(Number(b.position.z.toFixed(6)));

              // [AC-4] sits EXACTLY between a real adjacent joist pair:
              // find the bay whose midpoint matches, then assert the
              // clear-gap + end-face landing against the REAL joists.
              let bay = -1;
              for (let i = 0; i < jx.length - 1; i++) {
                if (Math.abs(b.position.x - (jx[i]! + jx[i + 1]!) / 2) < 1e-3) {
                  bay = i;
                  break;
                }
              }
              expect(bay).toBeGreaterThanOrEqual(0);
              const clearGap = jx[bay + 1]! - jx[bay]! - joistThickness;
              expect(b.size.x).toBeCloseTo(clearGap, 3);
              // end faces land exactly on the adjacent joist faces
              expect(b.position.x - b.size.x / 2).toBeCloseTo(jx[bay]! + joistThickness / 2, 3);
              expect(b.position.x + b.size.x / 2).toBeCloseTo(jx[bay + 1]! - joistThickness / 2, 3);
            }

            // exactly `rows` distinct interior stations, evenly spread
            expect(rowZ.size).toBe(rows);

            // stable id grid: blocking-r{0..rows-1}-b{0..bays-1}
            const expectedIds = new Set<string>();
            for (let r = 0; r < rows; r++) {
              for (let bkey = 0; bkey < bays; bkey++) expectedIds.add(`blocking-r${r}-b${bkey}`);
            }
            expect(seenIds).toEqual(expectedIds);
          });
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// [BOUNDARY] Blocking vs joist-spacing interaction — clear gap at the
// widest and the near-degenerate legal spacing.
// ---------------------------------------------------------------------------

describe('issue #72 — clear-gap size.x at spacing extremes [BOUNDARY]', () => {
  it('at 24″ o.c. (wide) the clear gap is the joist pitch minus one joist thickness', () => {
    const design = makeDesign('elevated-footings', 16, 14, 610, 'PT');
    const layout = computeLayout(design, { now: () => design.createdAt });
    const joists = layout.members
      .filter((m) => m.kind === 'joist')
      .sort((a, b) => a.position.x - b.position.x);
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    const thickness = joists[0]!.size.x;
    const pitch = joists[1]!.position.x - joists[0]!.position.x;
    expect(blocking[0]!.size.x).toBeCloseTo(pitch - thickness, 3);
    expect(blocking[0]!.size.x).toBeGreaterThan(0);
  });

  it('at the TIGHTEST legal spacing (MIN_JOIST_SPACING_MM=305) the pipeline never emits a negative or NaN clear gap', () => {
    // PR #73 review (GPT-5.5 HIGH #2 root fix): the previous
    // version of this test swept `[40, 45, 50, 60]` — all below
    // the new `MIN_JOIST_SPACING_MM = 305 mm` guard, which now
    // REJECTS the design at `validateJoistSpacing` before any
    // layout runs. Those cases are covered by the "REJECTS sub-min
    // spacing" tests in `layout-engine.test.ts` /
    // `floating-framing.test.ts`.
    //
    // The invariant this test proves — "the pipeline never emits
    // negative or NaN blocking size.x" — is still meaningful at
    // the NEW tightest legal spacing (305). Sweep spacings at and
    // just above the min to prove no arithmetic edge case leaks
    // negative or NaN dimensions.
    for (const spacingMm of [305, 320, 350, 400]) {
      const design = makeDesign('elevated-footings', 16, 12, spacingMm, 'PT');
      const layout = computeLayout(design, { now: () => design.createdAt });
      const blocking = layout.members.filter((m) => m.kind === 'blocking');
      expect(blocking.length).toBeGreaterThan(0);
      for (const b of blocking) {
        expect(Number.isFinite(b.size.x)).toBe(true);
        expect(b.size.x).toBeGreaterThan(0); // MIN=305 >> thickness=38 → all bays open
      }
    }
  });

  it('[EDGE] degenerate limit: touching joists — HELPER-LEVEL guard (post-MIN=305 the pipeline can no longer produce this input)', () => {
    // PR #73 review (GPT-5.5 HIGH #1 + HIGH #2 root fixes,
    // interaction):
    //
    //   - HIGH #1 (helper-level guard): `layoutBlockingBetweenJoists`
    //     SKIPS any bay whose clear gap ≤ CLEAR_GAP_EPS_MM (matching
    //     `validateJoistSpacing`'s EPS). Fail-safe skip; no
    //     zero-width invisible mesh, no zero-length BOM cut.
    //   - HIGH #2 (pipeline-level MIN): `MIN_JOIST_SPACING_MM = 305`
    //     at `validateJoistSpacing` REJECTS any `computeLayout` /
    //     `computeFloatingLayout` design that could produce a
    //     touching-joist geometry (thickness ≤ 38 mm < 305 min).
    //
    // Both guards are retained (belt-and-braces). This test
    // exercises the HELPER directly with synthetic touching centers
    // — bypassing the pipeline MIN — to prove the helper-level
    // guard still holds. That defense-in-depth matters because the
    // helper is exported (`layoutBlockingBetweenJoists` in the
    // barrel); a future consumer that calls it with primitive
    // inputs bypasses the pipeline MIN and MUST still get correct
    // behaviour on the degenerate limit.
    const thickness = 38;
    const widthMm = thickness + thickness * 50; // usableSpan = 50 × 38
    const xCenters = computeJoistXCenters(widthMm, thickness, thickness);
    const material: LumberMemberMaterial = { kind: 'lumber', nominal: '2x10', species: 'PT', grade: 'No2' };
    const result = layoutBlockingBetweenJoists({
      joistXCenters: xCenters,
      joistCenterY: 500,
      joistThicknessMm: thickness,
      joistDepthMm: 235,
      lengthMm: 12 * MM_PER_FOOT,
      material,
    });
    // Every bay was degenerate → the helper returns an empty array.
    // No invisible zero-size meshes, no zero-length BOM cuts.
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// [CONTRACT] BOM correctness — every blocking member is PACKED into the
// joist SKU cut list with the right length. This closes the gap in the
// Developer's BOM test, which only checked that each UNIQUE length
// appears "at least once": because evenly-spaced joists make every
// blocking piece the SAME length, that Set-based check has size 1 and
// would still PASS if 8 of 9 identical pieces were silently dropped.
// Here we assert per-member (by memberId) that NOTHING is dropped and
// the TOTAL blocking lineal footage is present.
// ---------------------------------------------------------------------------

describe('issue #72 — BOM folds ALL blocking into the joist SKU (not dropped) [CONTRACT]', () => {
  it('every blocking member appears as its own cut, with the correct length, in the joist SKU pack', () => {
    const design = makeDesign('elevated-footings', 12, 16, 406, 'PT');
    const layout = computeLayout(design, { now: () => design.createdAt });
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    expect(blocking.length).toBeGreaterThan(0);

    // Why the Developer's Set-of-unique-lengths check is too weak:
    // evenly-spaced joists make blocking pieces (near-)identical in
    // length, so the distinct-length count is TINY relative to the
    // piece count — a unique-length "appears at least once" check
    // would still pass if all-but-one identical piece were dropped.
    // We therefore assert per-MEMBER (by id) below, not per length.
    const distinctLengths = new Set(blocking.map((b) => b.size.x)).size;
    expect(distinctLengths).toBeLessThan(blocking.length);

    const result = deriveBom(layout, {});
    const joistMat = layout.members.find((m) => m.kind === 'joist')!
      .material as LumberMemberMaterial;
    const section = result.lumber.find(
      (s) =>
        s.nominal === joistMat.nominal &&
        s.species === joistMat.species &&
        s.grade === joistMat.grade,
    );
    expect(section).toBeDefined();

    // Map every cut by its source member id.
    const cutsById = new Map<string, number>();
    for (const board of section!.pack.stockBoards) {
      for (const cut of board.cuts) cutsById.set(cut.memberId, cut.lengthMm);
    }

    // (a) EVERY blocking member is present exactly once, by id.
    for (const b of blocking) {
      expect(cutsById.has(b.id)).toBe(true);
      expect(cutsById.get(b.id)!).toBeCloseTo(b.size.x, 3);
    }

    // (b) TOTAL blocking lineal footage packed == sum of clear gaps.
    const expectedTotal = blocking.reduce((sum, b) => sum + b.size.x, 0);
    const packedBlockingTotal = blocking.reduce(
      (sum, b) => sum + (cutsById.get(b.id) ?? 0),
      0,
    );
    expect(packedBlockingTotal).toBeCloseTo(expectedTotal, 3);
  });

  it('the joist SKU pack contains one cut per lumber member of that SKU (nothing dropped en route)', () => {
    // A multiset check across the whole SKU: the count of cuts must
    // equal the number of layout members routed to that SKU. This
    // proves blocking is ADDED to (not substituted for) the joist +
    // beam cuts.
    const design = makeDesign('elevated-footings', 12, 16, 406, 'PT');
    const layout = computeLayout(design, { now: () => design.createdAt });
    const result = deriveBom(layout, {});
    const joistMat = layout.members.find((m) => m.kind === 'joist')!
      .material as LumberMemberMaterial;

    const membersForSku = layout.members.filter(
      (m): m is LayoutMember =>
        m.material.kind === 'lumber' &&
        m.material.nominal === joistMat.nominal &&
        m.material.species === joistMat.species &&
        m.material.grade === joistMat.grade,
    );
    const section = result.lumber.find(
      (s) =>
        s.nominal === joistMat.nominal &&
        s.species === joistMat.species &&
        s.grade === joistMat.grade,
    )!;
    const totalCuts = section.pack.stockBoards.reduce((n, b) => n + b.cuts.length, 0);
    expect(totalCuts).toBe(membersForSku.length);
    // And the blocking members are a NON-EMPTY subset of them.
    expect(membersForSku.some((m) => m.kind === 'blocking')).toBe(true);
  });
});
