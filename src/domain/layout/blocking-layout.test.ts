/**
 * Unit tests for `src/domain/layout/blocking-layout.ts` — TDD RED
 * phase.
 *
 * ## Ticket #72 coverage
 *
 * The blocking-between-joists helper is a pure function that emits
 * solid lumber "noggins" between adjacent joists for lateral
 * restraint (IRC R502.7 / R502.7.1). The helper does NOT dispatch
 * on `design.structure` — it takes primitives (joist x-centers,
 * y-center, thickness, depth, deck length, lumber material) and
 * emits a `LayoutMember[]` — that way the elevated and floating
 * pipelines can each derive their own y-anchor (elevated from
 * `computeYStack`, floating from `computeYStackFloating`) but share
 * the SAME emitter geometry.
 *
 * ## What we pin here (per-AC breakdown from #72)
 *
 *   - AC "≥1 interior row when ≥2 joists"   → `bays × N` members;
 *     `N = max(1, ceil(lengthMm / MAX) - 1)` with a documented
 *     `MAX_BLOCKING_SPACING_MM = 2438` (8 ft per IRC R502.7.1).
 *   - AC "no overlap into joists, no gap"   → each member's
 *     `size.x = xCenters[i+1] - xCenters[i] - joistThickness`
 *     and `position.x = (xCenters[i] + xCenters[i+1]) / 2`.
 *   - AC "same depth as joists"             → `size.y = joistDepth`,
 *     `position.y = joistCenterY`.
 *   - AC "runs +x"                          → `size.z = joistThickness`
 *     (the blocking's 2x lumber is oriented with its thickness
 *     along +z, i.e. it is the same nominal 2× as the joist and
 *     is stood on edge just like the joist).
 *   - AC "interior rows only"               → NO row at ±L/2.
 *   - AC "on-center ≤ 8 ft"                 → adjacent-row pitch
 *     equals `lengthMm / (N + 1)` ≤ `MAX_BLOCKING_SPACING_MM`.
 *   - AC "<2 joists ⇒ zero blocking"        → empty array, no throw.
 *   - AC "stable, deterministic ids"        → `blocking-r{row}-b{bay}`;
 *     two calls with the same input emit deep-equal arrays.
 *   - AC "material is joist's lumber"       → `material.kind === 'lumber'`
 *     and the joist material triple is preserved.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module test — imports only vitest + the
 * domain module under test + `../units` for the foot conversion.
 */
import { describe, expect, it } from 'vitest';

import type { LumberMemberMaterial } from '../model';
import { MM_PER_FOOT, type Mm } from '../units';

import {
  MAX_BLOCKING_SPACING_MM,
  layoutBlockingBetweenJoists,
  type BlockingLayoutInput,
} from './blocking-layout';

/**
 * The reference lumber material — a `2x10` PT joist. Tests that
 * only care about the material tag can use this verbatim; tests
 * that care about material propagation vary the field.
 */
const PT_2X10: LumberMemberMaterial = {
  kind: 'lumber',
  nominal: '2x10',
  species: 'PT',
  grade: 'No2',
};

/**
 * Reference joist dimensions for `2x10` PT (S17 materials
 * catalog): dressed thickness 38 mm × dressed depth 235 mm.
 * Hard-coded here rather than looked up so the domain-test
 * boundary stays clean (no catalog dependency in a pure geometry
 * test).
 */
const JOIST_THICKNESS_MM: Mm = 38;
const JOIST_DEPTH_MM: Mm = 235;
const JOIST_CENTER_Y: Mm = 500; // arbitrary but non-zero — geometry independent.

/**
 * Build a synthetic `computeJoistXCenters` result — evenly-spaced,
 * flush at ±widthMm/2. Independent from `joist-layout.ts` so this
 * suite proves the emitter contract WITHOUT re-testing the joist
 * anchor formula.
 */
function makeXCenters(widthMm: Mm, bays: number): number[] {
  if (bays < 1) return [-widthMm / 2 + JOIST_THICKNESS_MM / 2];
  const flushLeft = -widthMm / 2 + JOIST_THICKNESS_MM / 2;
  const flushRight = +widthMm / 2 - JOIST_THICKNESS_MM / 2;
  const step = (flushRight - flushLeft) / bays;
  const out: number[] = [];
  for (let i = 0; i <= bays; i++) out.push(flushLeft + i * step);
  return out;
}

function makeInput(overrides: Partial<BlockingLayoutInput> = {}): BlockingLayoutInput {
  return {
    joistXCenters: overrides.joistXCenters ?? makeXCenters(16 * MM_PER_FOOT, 12),
    joistCenterY: overrides.joistCenterY ?? JOIST_CENTER_Y,
    joistThicknessMm: overrides.joistThicknessMm ?? JOIST_THICKNESS_MM,
    joistDepthMm: overrides.joistDepthMm ?? JOIST_DEPTH_MM,
    lengthMm: overrides.lengthMm ?? 16 * MM_PER_FOOT,
    material: overrides.material ?? PT_2X10,
  };
}

// ---------------------------------------------------------------
// MAX_BLOCKING_SPACING_MM constant
// ---------------------------------------------------------------

describe('MAX_BLOCKING_SPACING_MM', () => {
  it('equals 2438 mm (8 ft per IRC R502.7.1)', () => {
    // 8 ft * 304.8 mm/ft = 2438.4 mm; the constant is exposed as an
    // integer to keep the ceil-count arithmetic exact for the
    // typical 8/10/12/14/16 ft deck-length inputs.
    expect(MAX_BLOCKING_SPACING_MM).toBe(2438);
  });
});

// ---------------------------------------------------------------
// Edge cases — narrow / single joist / empty
// ---------------------------------------------------------------

describe('layoutBlockingBetweenJoists — edge cases', () => {
  it('single-joist deck (0 bays) emits ZERO blocking (no throw)', () => {
    // A single-joist deck has no adjacent bay — there is nothing
    // to place blocking between. Physically impossible ≠ crash.
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: [0] }),
    );
    expect(result).toEqual([]);
  });

  it('empty-joist input emits ZERO blocking (no throw)', () => {
    // Zero joists is a degenerate input the pipeline should never
    // produce (a valid design always has ≥ 2 joists), but the
    // helper must not throw on it — fail-loud is the caller's
    // responsibility upstream.
    const result = layoutBlockingBetweenJoists(makeInput({ joistXCenters: [] }));
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------
// Row count & spacing — IRC R502.7.1
// ---------------------------------------------------------------

describe('layoutBlockingBetweenJoists — row count (IRC R502.7.1)', () => {
  it('emits exactly 1 interior row for a 12 ft deck (L < 2 × MAX)', () => {
    // 12 ft = 3657.6 mm. ceil(3657.6/2438) = 2 → N = max(1, 2-1) = 1.
    // (A 16 ft deck L=4876.8 mm > 2 × 2438 exceeds the threshold
    // by 0.8 mm and legitimately gets N=2 — pick 12 ft so the
    // single-row branch is exercised without ambiguity.)
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8); // 9 joists → 8 bays
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 12 * MM_PER_FOOT }),
    );
    const bays = xCenters.length - 1;
    expect(result).toHaveLength(bays * 1);
  });

  it('emits ≥1 interior row for a very short deck (below the 8-ft threshold)', () => {
    // 4 ft = 1219 mm; ceil(1219/2438) = 1 → N = max(1, 0) = 1.
    // The min-row floor guarantees at least one mid-span row per
    // bay even on the smallest legal deck.
    const xCenters = makeXCenters(4 * MM_PER_FOOT, 3);
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 4 * MM_PER_FOOT }),
    );
    const bays = xCenters.length - 1;
    expect(result).toHaveLength(bays * 1);
  });

  it('emits ceil(L/MAX)-1 rows for L > 2 × MAX (L=20 ft ⇒ 2 rows)', () => {
    // 6096 mm / 2438 mm ≈ 2.5 → ceil = 3 → N = 2.
    // Row pitch = 6096 / 3 = 2032 mm ≤ 2438 ✓.
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 20 * MM_PER_FOOT }),
    );
    const bays = xCenters.length - 1;
    expect(result).toHaveLength(bays * 2);
  });

  it('emits ceil(L/MAX)-1 rows for L=40 ft ⇒ 5 rows', () => {
    // 12192 mm / 2438 mm ≈ 5.001 → ceil = 6 → N = 5.
    // (The 0.4 mm rounding from `MAX = 2438` vs the exact 8 ft
    // = 2438.4 mm tips the ceiling up — deliberately conservative
    // per the R502.7.1 "≤ 8 ft" bound; extra rows waste a bit of
    // lumber but never violate code.)
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 40 * MM_PER_FOOT }),
    );
    const bays = xCenters.length - 1;
    expect(result).toHaveLength(bays * 5);
  });

  it('adjacent-row pitch stays ≤ MAX_BLOCKING_SPACING_MM for every legal deck length', () => {
    // For any legal L (≥ 4 ft), the pitch L/(N+1) must be ≤ MAX.
    // Sweep 4..40 ft to prove the formula honors R502.7.1.
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    for (let ft = 4; ft <= 40; ft += 2) {
      const lengthMm = ft * MM_PER_FOOT;
      const result = layoutBlockingBetweenJoists(
        makeInput({ joistXCenters: xCenters, lengthMm }),
      );
      const bays = xCenters.length - 1;
      const rows = result.length / bays;
      const pitch = lengthMm / (rows + 1);
      expect(pitch).toBeLessThanOrEqual(MAX_BLOCKING_SPACING_MM);
    }
  });
});

// ---------------------------------------------------------------
// Row placement along Z — interior only, evenly spread
// ---------------------------------------------------------------

describe('layoutBlockingBetweenJoists — row placement along +z', () => {
  it('no row sits at ±L/2 (ends are restrained by rim joist / ledger — interior only)', () => {
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    const lengthMm = 20 * MM_PER_FOOT;
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm }),
    );
    const halfL = lengthMm / 2;
    for (const m of result) {
      expect(Math.abs(m.position.z)).toBeLessThan(halfL);
    }
  });

  it('single-row deck (12 ft) places the row exactly at z=0 (mid-span)', () => {
    // 12 ft = 3657.6 mm → N=1 (see the row-count suite for why
    // 12 ft resolves to a single row while 16 ft rolls over to
    // N=2 by 0.8 mm).
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    const lengthMm = 12 * MM_PER_FOOT;
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm }),
    );
    for (const m of result) {
      expect(m.position.z).toBeCloseTo(0, 6);
    }
  });

  it('row z-positions are evenly spread: z_k = -L/2 + k*L/(N+1)', () => {
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    const lengthMm = 20 * MM_PER_FOOT;
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm }),
    );
    // Two rows expected for L=20 ft: z = -L/6 and +L/6.
    const uniqueZ = [...new Set(result.map((m) => m.position.z))].sort(
      (a, b) => a - b,
    );
    expect(uniqueZ).toHaveLength(2);
    expect(uniqueZ[0]).toBeCloseTo(-lengthMm / 6, 6);
    expect(uniqueZ[1]).toBeCloseTo(+lengthMm / 6, 6);
  });
});

// ---------------------------------------------------------------
// Bay geometry — one blocking per bay, no overlap into joists
// ---------------------------------------------------------------

describe('layoutBlockingBetweenJoists — bay geometry (no overlap, no gap)', () => {
  it('emits exactly ONE blocking per (bay × row): count = (N_joists - 1) × N_rows', () => {
    // 12 ft = single-row branch (see row-count suite). 9 joists,
    // 8 bays, 1 row ⇒ 8 members total.
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8); // 9 joists, 8 bays
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 12 * MM_PER_FOOT }),
    );
    expect(result).toHaveLength(8 * 1);
  });

  it('each blocking sits exactly between its two joists (position.x = midpoint)', () => {
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 12 * MM_PER_FOOT }),
    );
    // For each blocking member, find the pair of joist x-centers
    // whose midpoint matches its position.x.
    for (const m of result) {
      // Find the bay this blocking belongs to.
      const pairIndex = xCenters.findIndex(
        (_, i) =>
          i < xCenters.length - 1 &&
          Math.abs(m.position.x - (xCenters[i]! + xCenters[i + 1]!) / 2) < 1e-6,
      );
      expect(pairIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('each blocking size.x = clear gap (xCenter[i+1] - xCenter[i] - joistThickness)', () => {
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 12 * MM_PER_FOOT }),
    );
    // Every result is at the SAME single row z=0; group by bay
    // index via midpoint reverse-lookup.
    for (const m of result) {
      // Reverse-find the bay by matching midpoint.
      let bay = -1;
      for (let i = 0; i < xCenters.length - 1; i++) {
        const midpoint = (xCenters[i]! + xCenters[i + 1]!) / 2;
        if (Math.abs(m.position.x - midpoint) < 1e-6) {
          bay = i;
          break;
        }
      }
      expect(bay).toBeGreaterThanOrEqual(0);
      const expectedGap =
        xCenters[bay + 1]! - xCenters[bay]! - JOIST_THICKNESS_MM;
      expect(m.size.x).toBeCloseTo(expectedGap, 6);
    }
  });

  it('blocking does NOT overlap the adjacent joists (blocking end faces are inside the bay gap)', () => {
    // For each blocking: its +x face at position.x + size.x/2 must
    // land EXACTLY at the left face of joist i+1 (which is at
    // xCenters[i+1] - joistThickness/2). Same for -x face at
    // joist i's right face. Verifies the "no overlap into joists,
    // no gap/float" AC directly.
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 8);
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 12 * MM_PER_FOOT }),
    );
    for (const m of result) {
      const leftFace = m.position.x - m.size.x / 2;
      const rightFace = m.position.x + m.size.x / 2;
      // Find the pair of joists this blocking belongs to.
      let bay = -1;
      for (let i = 0; i < xCenters.length - 1; i++) {
        const midpoint = (xCenters[i]! + xCenters[i + 1]!) / 2;
        if (Math.abs(m.position.x - midpoint) < 1e-6) {
          bay = i;
          break;
        }
      }
      expect(bay).toBeGreaterThanOrEqual(0);
      const leftJoistRightFace = xCenters[bay]! + JOIST_THICKNESS_MM / 2;
      const rightJoistLeftFace = xCenters[bay + 1]! - JOIST_THICKNESS_MM / 2;
      expect(leftFace).toBeCloseTo(leftJoistRightFace, 6);
      expect(rightFace).toBeCloseTo(rightJoistLeftFace, 6);
    }
  });
});

// ---------------------------------------------------------------
// Member field contract — kind, material, y-plane, sizes
// ---------------------------------------------------------------

describe('layoutBlockingBetweenJoists — LayoutMember field contract', () => {
  it('every member has kind === "blocking"', () => {
    const result = layoutBlockingBetweenJoists(makeInput());
    expect(result.length).toBeGreaterThan(0);
    for (const m of result) expect(m.kind).toBe('blocking');
  });

  it('every member carries the caller-provided lumber material verbatim', () => {
    const cedar: LumberMemberMaterial = {
      kind: 'lumber',
      nominal: '2x8',
      species: 'Cedar',
      grade: 'No2',
    };
    const result = layoutBlockingBetweenJoists(makeInput({ material: cedar }));
    for (const m of result) {
      expect(m.material).toEqual(cedar);
    }
  });

  it('every member sits at joistCenterY (co-planar with joists)', () => {
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistCenterY: 723 }),
    );
    for (const m of result) {
      expect(m.position.y).toBe(723);
    }
  });

  it('every member has size.y === joistDepth (full-depth solid blocking)', () => {
    const result = layoutBlockingBetweenJoists(makeInput({ joistDepthMm: 235 }));
    for (const m of result) {
      expect(m.size.y).toBe(235);
    }
  });

  it('every member has size.z === joistThickness (blocking oriented same-thickness as the joist)', () => {
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistThicknessMm: 38 }),
    );
    for (const m of result) {
      expect(m.size.z).toBe(38);
    }
  });

  it('every member has rotation === (0,0,0) (axis-aligned framing)', () => {
    const result = layoutBlockingBetweenJoists(makeInput());
    for (const m of result) {
      expect(m.rotation).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('emits stable, deterministic ids of the shape "blocking-r{row}-b{bay}"', () => {
    const xCenters = makeXCenters(12 * MM_PER_FOOT, 3); // 4 joists, 3 bays
    const result = layoutBlockingBetweenJoists(
      makeInput({ joistXCenters: xCenters, lengthMm: 20 * MM_PER_FOOT }),
    );
    // 20 ft → N = 2 rows × 3 bays = 6 members.
    expect(result).toHaveLength(6);
    const ids = result.map((m) => m.id).sort();
    expect(ids).toEqual([
      'blocking-r0-b0',
      'blocking-r0-b1',
      'blocking-r0-b2',
      'blocking-r1-b0',
      'blocking-r1-b1',
      'blocking-r1-b2',
    ]);
  });

  it('is pure: same input yields deep-equal output on repeated invocation', () => {
    // Byte-identity for the same input is the "no hidden clock,
    // no RNG, no I/O" invariant every pure domain helper honors.
    // Golden fixtures rely on this.
    const a = layoutBlockingBetweenJoists(makeInput());
    const b = layoutBlockingBetweenJoists(makeInput());
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------
// Zero-width blocking guard — PR #73 review response
// ---------------------------------------------------------------
//
// `validateJoistSpacing` (layout-shared.ts) rejects `actualSpacing +
// EPS_MM < joistThickness` — so `actualSpacing == joistThickness`
// (adjacent joists touching face-to-face) is LEGAL. At that exact
// boundary the CLEAR gap between joist faces is zero, and the
// blocking bay is physically DEGENERATE — there is no room to nail
// a noggin between two touching joists. Emitting a `size.x == 0`
// mesh + a zero-length BOM cut is a "lying UI" (invisible mesh,
// dropped cut). The helper MUST SKIP any bay whose clear gap ≤
// `EPS_MM = 1e-6` (same EPS the upstream validator uses so the
// two seams agree on "how close to zero counts as zero").
//
// A separate rim/band member (issue #74) will eventually restrain
// the joist ENDS on Method B, but for INTERIOR blocking the
// physically-correct answer for touching joists is "none in that
// bay" — safer than "invisible zero-size stub."

describe('layoutBlockingBetweenJoists — zero-width bay guard [PR #73 review]', () => {
  it('SKIPS bays with clear gap == 0 exactly (touching joists — no blocking emitted for those bays)', () => {
    // Construct a joist grid where every adjacent pair of centers
    // is EXACTLY `joistThicknessMm` apart, i.e. every clear gap is
    // zero. `computeJoistXCenters` produces exactly this whenever
    // `widthMm − joistThicknessMm` is an integer multiple of
    // `joistThicknessMm`. E.g. thickness=38, widthMm = 38 + 4×38 =
    // 190 → xCenters at [-76, -38, 0, 38, 76], every adjacent gap
    // = 38 = thickness → clear gap = 0.
    const thickness = JOIST_THICKNESS_MM;
    const centers = [-2, -1, 0, 1, 2].map((k) => k * thickness);
    const result = layoutBlockingBetweenJoists(
      makeInput({
        joistXCenters: centers,
        joistThicknessMm: thickness,
      }),
    );
    // All 4 bays are degenerate ⇒ nothing emitted at ALL for
    // this deck (interior rows still counted, but every bay in
    // every row skipped).
    expect(result).toEqual([]);
  });

  it('never emits any member with size.x ≤ 0 for a mixed grid (some touching, some open bays)', () => {
    // Mixed grid — bays 0, 1 touch (clear gap = 0), bays 2, 3
    // have a healthy positive gap. The 2 touching bays must be
    // SKIPPED; the 2 open bays must still emit blocking.
    const thickness = JOIST_THICKNESS_MM;
    const centers = [
      -3 * thickness,
      -2 * thickness,
      -1 * thickness, // bays 0, 1: touching
       200,           // gap from -thickness ⇒ 200 - (-38) - 38 = 200 (positive)
       400,           // gap from 200      ⇒ 400 - 200      - 38 = 162 (positive)
    ];
    const result = layoutBlockingBetweenJoists(
      makeInput({
        joistXCenters: centers,
        joistThicknessMm: thickness,
      }),
    );
    expect(result.length).toBeGreaterThan(0);
    for (const m of result) {
      expect(m.size.x).toBeGreaterThan(0);
    }
    // Verify we still have blocking in the open bays: rows × open-bay-count.
    // 16 ft deck ⇒ N = 2 interior rows (see other suite). 2 open bays × 2 rows = 4.
    expect(result.length).toBe(4);
  });

  it('still emits blocking when the clear gap is tiny but strictly positive (near-touch, gap > EPS)', () => {
    // 1 mm clear gap is degenerate carpentry but the emitter is
    // NOT a code-check tool — its job is to reflect what
    // `validateJoistSpacing` admitted. As long as the gap is
    // strictly > EPS the member is emitted with a truthful
    // positive size.x.
    const thickness = JOIST_THICKNESS_MM;
    const gap = 1; // 1 mm clear gap
    const centers = [0, thickness + gap];
    const result = layoutBlockingBetweenJoists(
      makeInput({
        joistXCenters: centers,
        joistThicknessMm: thickness,
      }),
    );
    expect(result.length).toBeGreaterThan(0);
    for (const m of result) {
      expect(m.size.x).toBeCloseTo(gap, 9);
      expect(m.size.x).toBeGreaterThan(0);
    }
  });
});
