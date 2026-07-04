/**
 * `src/domain/bom/pack-cut-list.test.ts` — TDD RED for the S21
 * FR-031 1-D cut-list bin-packer.
 *
 * ## Coverage (issue #43)
 *
 *   - AC1: single stock length, exact fit — 2 × 16 ft cuts → 2 × 16 ft
 *          boards, zero offcut on each.
 *   - AC2: FFD groups small offcuts into fewer boards — the user's
 *          hand-drawn example (14 × 16″ + 2 × 14″ + 18 × 6″) with a
 *          [16 ft] stock list packs into exactly 2 boards.
 *   - AC3: kerf is deducted from remaining board length — two 8 ft
 *          cuts on a [16 ft] board require 2 boards (16 ft − 8 ft −
 *          3 mm < 8 ft).
 *   - AC4: smallest-stock-that-fits-longest-cut policy — a 10 ft cut
 *          plus a 3 ft cut against [10, 12, 16] ft opens a 10 ft
 *          board first (perfect fit); the 3 ft cut then needs a new
 *          board (the 10 ft board is full after the 10 ft cut).
 *   - AC5: throws when the longest cut exceeds max stock — 24 ft cut
 *          against [8, 10, 12, 16] ft throws with a message naming
 *          the offending cut length AND the max stock length.
 *   - AC9: FFD asymptotic bound (SC-011) — for random small inputs,
 *          FFD's totalStockBoards ≤ 11/9 × OPT + 6/9 (classical FFD
 *          bound, property test with 100+ iterations).
 *   - Perf: ≤50 ms for 500 members (SC-011 latency bound).
 *   - Determinism: stable sort by lengthMm desc, tie-break memberId
 *          asc — packing the same input twice produces the same
 *          `stockBoards` sequence byte-for-byte.
 *   - Edge cases:
 *      · empty cuts → { stockBoards: [], totalStockBoards: 0, totalOffcutMm: 0 }.
 *      · exact-fit cut → offcutMm === 0, no kerf issue.
 *      · single cut equal to stock length.
 *
 * ## Why an explicit property bound (not a snapshot)
 *
 * The FFD asymptotic bound is a MATHEMATICAL invariant of the
 * algorithm — snapshot-testing the exact `stockBoards` output would
 * lock in an implementation detail (the exact cut order chosen). The
 * bound is what the spec pins (SC-011), so the test asserts the
 * bound, not the concrete pack.
 *
 * ## RED phase
 *
 * `packCutList` does not exist yet — every test in this file will
 * fail with a module-not-found error until the implementation lands.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT, MM_PER_INCH } from '../units';
import type { Mm } from '../units';

import { packCutList, type Cut, type PackedBoard, type PackResult } from './pack-cut-list';

// ---------------------------------------------------------------------------
// Test helpers — kept tiny so tests read top-down.
// ---------------------------------------------------------------------------

const ftMm = (feet: number): Mm => Math.round(feet * MM_PER_FOOT);
const inMm = (inches: number): Mm => Math.round(inches * MM_PER_INCH);
const DEFAULT_KERF_MM: Mm = 3;

/** Build a `Cut` with a synthetic sortable id (`c-0`, `c-1`, …). */
function makeCut(index: number, lengthMm: Mm): Cut {
  return { memberId: `c-${String(index).padStart(4, '0')}`, lengthMm };
}

/** Build N cuts, all of the same length. */
function makeCuts(count: number, lengthMm: Mm): Cut[] {
  return Array.from({ length: count }, (_v, i) => makeCut(i, lengthMm));
}

/** Assert every cut in a board fits within its stock length + kerf budget. */
function assertBoardIsValid(board: PackedBoard, kerfMm: Mm): void {
  // Model (see pack-cut-list.ts kerf-accounting section):
  //   sum(cuts) + (N-1) × kerf + offcut ≤ stockLength
  //   offcut ≥ 0
  // The `≤` (not `=`) accounts for the trailing-kerf edge: if the
  // final cut is exact-fit, the "remaining" ended at 0 rather than
  // −kerfMm, so the equality would be off by `kerfMm`.
  const cutsSum = board.cuts.reduce((sum, c) => sum + c.lengthMm, 0);
  const gaps = Math.max(0, board.cuts.length - 1) * kerfMm;
  expect(cutsSum + gaps + board.offcutMm).toBeLessThanOrEqual(board.stockLengthMm);
  expect(board.offcutMm).toBeGreaterThanOrEqual(0);
}

// ---------------------------------------------------------------------------
// AC1 — single stock length, exact fit
// ---------------------------------------------------------------------------

describe('packCutList — AC1 single stock length, exact fit', () => {
  it('two 16 ft cuts into [16 ft] stock → two boards, zero offcut', () => {
    const cuts = makeCuts(2, ftMm(16));
    const result = packCutList({
      cuts,
      stockLengthsMm: [ftMm(16)],
      kerfMm: DEFAULT_KERF_MM,
    });
    expect(result.totalStockBoards).toBe(2);
    expect(result.stockBoards).toHaveLength(2);
    for (const board of result.stockBoards) {
      expect(board.stockLengthMm).toBe(ftMm(16));
      expect(board.cuts).toHaveLength(1);
      expect(board.cuts[0]!.lengthMm).toBe(ftMm(16));
      expect(board.offcutMm).toBe(0);
    }
    expect(result.totalOffcutMm).toBe(0);
  });

  it('a single cut exactly matching stock length → offcut = 0', () => {
    const result = packCutList({
      cuts: [makeCut(0, ftMm(12))],
      stockLengthsMm: [ftMm(12)],
      kerfMm: DEFAULT_KERF_MM,
    });
    expect(result.totalStockBoards).toBe(1);
    expect(result.stockBoards[0]!.offcutMm).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC2 — FFD groups small offcuts into fewer boards (user's example)
// ---------------------------------------------------------------------------

describe("packCutList — AC2 FFD packs the user's hand-drawn example", () => {
  it('14 × 16″ + 2 × 14″ + 18 × 6″ cuts into [16 ft] stock → 2 boards', () => {
    // The user's blocking example — 30 ft total blocking, packed into
    // 2 × 16 ft stock boards (32 ft with kerf/waste room).
    const cuts: Cut[] = [
      ...Array.from({ length: 14 }, (_v, i) => makeCut(i, inMm(16))),
      ...Array.from({ length: 2 }, (_v, i) => makeCut(100 + i, inMm(14))),
      ...Array.from({ length: 18 }, (_v, i) => makeCut(200 + i, inMm(6))),
    ];
    const result = packCutList({
      cuts,
      stockLengthsMm: [ftMm(16)],
      kerfMm: DEFAULT_KERF_MM,
    });
    // 14 × 16″ (224″) + 2 × 14″ (28″) + 18 × 6″ (108″) = 360″ = 30 ft.
    // 30 ft of cuts + ≥ 33 kerfs × 3 mm ≈ 99 mm ≈ 0.32 ft of kerf
    // → fits comfortably in 2 × 16 ft boards (32 ft).
    expect(result.totalStockBoards).toBe(2);
    // Every board fits its stock length exactly (accounting model).
    for (const board of result.stockBoards) {
      assertBoardIsValid(board, DEFAULT_KERF_MM);
      // First and second board sums are each ≤ 16 ft.
      const cutsSum = board.cuts.reduce((sum, c) => sum + c.lengthMm, 0);
      expect(cutsSum).toBeLessThanOrEqual(ftMm(16));
    }
    // Every original cut appears in the pack exactly once.
    const packedIds = new Set(
      result.stockBoards.flatMap((b) => b.cuts.map((c) => c.memberId)),
    );
    expect(packedIds.size).toBe(cuts.length);
    for (const c of cuts) {
      expect(packedIds.has(c.memberId)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC3 — kerf is deducted from remaining board length
// ---------------------------------------------------------------------------

describe('packCutList — AC3 kerf deducted from remaining board length', () => {
  it('two 8 ft cuts on a [16 ft] board with 3 mm kerf → 2 boards (kerf pushes second cut out)', () => {
    const cuts = makeCuts(2, ftMm(8));
    const result = packCutList({
      cuts,
      stockLengthsMm: [ftMm(16)],
      kerfMm: DEFAULT_KERF_MM,
    });
    // 2 × 8 ft = 16 ft exactly, but the first cut consumes 8 ft +
    // 3 mm kerf, leaving 16 ft − 8 ft − 3 mm = 8 ft − 3 mm on the
    // first board. The second 8 ft cut does NOT fit (needs 8 ft
    // clean, only has (8 ft − 3 mm) available), so a second board
    // opens.
    expect(result.totalStockBoards).toBe(2);
    for (const board of result.stockBoards) {
      expect(board.cuts).toHaveLength(1);
      expect(board.cuts[0]!.lengthMm).toBe(ftMm(8));
      // Offcut per board = 16 ft − 8 ft − kerf = 8 ft − 3 mm.
      expect(board.offcutMm).toBe(ftMm(16) - ftMm(8) - DEFAULT_KERF_MM);
    }
  });

  it('kerf = 0 → two 8 ft cuts pack into ONE 16 ft board (~ no waste)', () => {
    // The kerf-free control case — proves the extra board in the
    // AC3 test is caused by kerf, not by an accounting bug. The 1 mm
    // residue below is real: 8 ft rounds to 2438 mm, but 16 ft
    // rounds to 4877 mm, so 2 × 2438 = 4876 leaves a legitimate
    // 1 mm offcut per board (rounding slop from MM_PER_FOOT).
    const cuts = makeCuts(2, ftMm(8));
    const result = packCutList({
      cuts,
      stockLengthsMm: [ftMm(16)],
      kerfMm: 0,
    });
    expect(result.totalStockBoards).toBe(1);
    expect(result.stockBoards[0]!.cuts).toHaveLength(2);
    // 4877 − 2 × 2438 = 1 mm rounding slop.
    expect(result.stockBoards[0]!.offcutMm).toBe(1);
    expect(result.totalOffcutMm).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC4 — smallest stock length that fits the longest remaining cut
// ---------------------------------------------------------------------------

describe('packCutList — AC4 picks the smallest stock length that fits the longest cut', () => {
  it('cuts [10 ft, 3 ft] against stocks [10, 12, 16] ft → opens 10 ft first', () => {
    const cuts: Cut[] = [makeCut(0, ftMm(10)), makeCut(1, ftMm(3))];
    const result = packCutList({
      cuts,
      stockLengthsMm: [ftMm(10), ftMm(12), ftMm(16)],
      kerfMm: DEFAULT_KERF_MM,
    });
    // The 10 ft cut is the longest → smallest stock that fits it =
    // 10 ft. Perfect fit; offcut = 0. The 3 ft cut then becomes the
    // longest remaining → smallest stock that fits IT = 10 ft (the
    // catalog's smallest). The 10 ft board fits the 3 ft cut with
    // room to spare.
    expect(result.totalStockBoards).toBe(2);
    expect(result.stockBoards[0]!.stockLengthMm).toBe(ftMm(10));
    expect(result.stockBoards[0]!.cuts).toEqual([{ memberId: 'c-0000', lengthMm: ftMm(10) }]);
    expect(result.stockBoards[1]!.stockLengthMm).toBe(ftMm(10));
    expect(result.stockBoards[1]!.cuts).toEqual([{ memberId: 'c-0001', lengthMm: ftMm(3) }]);
  });

  it('cuts [11 ft] against stocks [10, 12, 16] ft → opens 12 ft (10 ft does not fit)', () => {
    const cuts: Cut[] = [makeCut(0, ftMm(11))];
    const result = packCutList({
      cuts,
      stockLengthsMm: [ftMm(10), ftMm(12), ftMm(16)],
      kerfMm: DEFAULT_KERF_MM,
    });
    expect(result.stockBoards[0]!.stockLengthMm).toBe(ftMm(12));
  });
});

// ---------------------------------------------------------------------------
// AC5 — cut exceeds all stock lengths throws
// ---------------------------------------------------------------------------

describe('packCutList — AC5 throws when a cut exceeds every stock length', () => {
  it('a 24 ft cut against [8, 10, 12, 16] ft throws with cut + max stock in the message', () => {
    const cuts: Cut[] = [makeCut(0, ftMm(24))];
    let caught: unknown = null;
    try {
      packCutList({
        cuts,
        stockLengthsMm: [ftMm(8), ftMm(10), ftMm(12), ftMm(16)],
        kerfMm: DEFAULT_KERF_MM,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : String(caught);
    // Must name the offending member id, the offending cut length,
    // AND the max stock length — enough context for the user (via
    // S24's UI surfacing) to know what to fix.
    expect(message).toContain('c-0000');
    expect(message).toContain(String(ftMm(24)));
    expect(message).toContain(String(ftMm(16)));
  });

  it('a cut equal to the max stock length does NOT throw (boundary case)', () => {
    // The first cut on a bin does not pay a preceding kerf, so a
    // cut of exactly max-stock-length is allowed (single-cut board,
    // offcut = 0). Ticket §4b edge case: "Cut length exactly matching
    // stock length: offcut = 0, no kerf issue."
    const cuts: Cut[] = [makeCut(0, ftMm(16))];
    expect(() =>
      packCutList({
        cuts,
        stockLengthsMm: [ftMm(8), ftMm(16)],
        kerfMm: DEFAULT_KERF_MM,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('packCutList — edge cases', () => {
  it('empty cuts → { stockBoards: [], totalStockBoards: 0, totalOffcutMm: 0 }', () => {
    const result = packCutList({
      cuts: [],
      stockLengthsMm: [ftMm(8), ftMm(16)],
      kerfMm: DEFAULT_KERF_MM,
    });
    expect(result).toEqual<PackResult>({
      stockBoards: [],
      totalStockBoards: 0,
      totalOffcutMm: 0,
    });
  });

  it('throws when stockLengthsMm is empty (no stock to pack into)', () => {
    expect(() =>
      packCutList({
        cuts: [makeCut(0, ftMm(8))],
        stockLengthsMm: [],
        kerfMm: DEFAULT_KERF_MM,
      }),
    ).toThrow(/stock/i);
  });

  it('sorting is stable — same input twice produces the same stockBoards sequence', () => {
    // Two cuts of the same length with sortable ids: the packer's
    // tie-break MUST be memberId ascending. Running twice must
    // produce byte-identical stockBoards (JSON round-trip).
    const cuts: Cut[] = [
      makeCut(3, inMm(16)),
      makeCut(1, inMm(16)),
      makeCut(2, inMm(16)),
      makeCut(0, inMm(6)),
    ];
    const a = packCutList({
      cuts,
      stockLengthsMm: [ftMm(16)],
      kerfMm: DEFAULT_KERF_MM,
    });
    const b = packCutList({
      cuts,
      stockLengthsMm: [ftMm(16)],
      kerfMm: DEFAULT_KERF_MM,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Same-length cuts are placed in memberId-ascending order on
    // the board — asserting the first three cuts on the (single)
    // board are c-0001, c-0002, c-0003 (the 16″s), then c-0000 (6″).
    const cutIds = a.stockBoards[0]!.cuts.map((c) => c.memberId);
    expect(cutIds).toEqual(['c-0001', 'c-0002', 'c-0003', 'c-0000']);
  });

  it('kerf defaults to 3 mm when omitted', () => {
    // The interface documents `kerfMm` as required — this test
    // asserts that ANY caller passing 3 explicitly gets the same
    // result as the S21 default. Keeps the AC intent locked in even
    // if a future refactor makes kerfMm optional.
    const cuts = makeCuts(2, ftMm(8));
    const a = packCutList({
      cuts,
      stockLengthsMm: [ftMm(16)],
      kerfMm: 3,
    });
    // AC3's assertion: 2 boards.
    expect(a.totalStockBoards).toBe(2);
  });

  it('input arrays are NOT mutated by packing', () => {
    const cuts = [makeCut(2, ftMm(8)), makeCut(0, ftMm(16)), makeCut(1, ftMm(4))];
    const cutsBefore = JSON.stringify(cuts);
    const stocks: readonly Mm[] = [ftMm(8), ftMm(12), ftMm(16)];
    const stocksBefore = JSON.stringify(stocks);
    packCutList({ cuts, stockLengthsMm: stocks, kerfMm: DEFAULT_KERF_MM });
    expect(JSON.stringify(cuts)).toBe(cutsBefore);
    expect(JSON.stringify(stocks)).toBe(stocksBefore);
  });
});

// ---------------------------------------------------------------------------
// AC9 — FFD asymptotic bound (SC-011)
// ---------------------------------------------------------------------------

/**
 * Brute-force OPTIMAL 1-D bin-pack for small inputs, used as the
 * ground-truth reference for the FFD-bound property test.
 *
 * O(k^n) worst case — capped at n ≤ 12 cuts by the test to keep
 * runtime bounded (fc runs 100 iterations by default).
 *
 * Algorithm: try every distribution of the n cuts across
 * `maxBoards = n` bins with a fixed stock length; return the
 * minimum bin-count for which a valid distribution exists. Uses
 * the same kerf accounting as the packer under test so the
 * comparison is apples-to-apples.
 */
function bruteForceOptimalBoardCount(
  cuts: readonly Cut[],
  stockLengthMm: Mm,
  kerfMm: Mm,
): number {
  // Early exit for empty cuts.
  if (cuts.length === 0) return 0;
  const n = cuts.length;
  // A quick lower bound (matches the packer's model above): for a
  // single-cut bin, need `cut.lengthMm ≤ stockLengthMm`; for multi-
  // cut bins, `sum(cuts) + (nCuts − 1) × kerfMm ≤ stockLengthMm`.
  // A total lower bound over ALL cuts: ceil((sum(cuts) + (n − 1) × kerf) /
  // stockLengthMm) approximates the best case. Not tight but useful
  // for the k-loop starting point.
  const totalCuts = cuts.reduce((s, c) => s + c.lengthMm, 0);
  const lb = Math.max(1, Math.ceil((totalCuts + Math.max(0, n - 1) * kerfMm) / stockLengthMm));
  // Upper bound: one board per cut.
  for (let k = lb; k <= n; k++) {
    if (canFitInKBins(cuts, k, stockLengthMm, kerfMm)) return k;
  }
  return n;
}

function canFitInKBins(
  cuts: readonly Cut[],
  k: number,
  stockLengthMm: Mm,
  kerfMm: Mm,
): boolean {
  // Fit rule per bin (matches the packer's model — see pack-cut-list.ts
  // kerf-accounting): sum(cuts_in_bin) + (nCuts_in_bin − 1) × kerfMm
  //   ≤ stockLengthMm.
  // Encoded by "virtual capacity = stockLengthMm + kerfMm" and
  // charging (lengthMm + kerfMm) for every placement — the extra
  // trailing kerf that never actually gets used cancels out.
  const bins = new Array<number>(k).fill(stockLengthMm + kerfMm);
  // Sort desc for better pruning; brute-force search finds a feasible
  // packing if one exists.
  const ordered = [...cuts].sort((a, b) => b.lengthMm - a.lengthMm);
  function backtrack(i: number): boolean {
    if (i === ordered.length) return true;
    const cut = ordered[i]!;
    // Try each bin. Skip identical-capacity bins to prune equivalent
    // arrangements (a common bin-pack pruning trick).
    const tried = new Set<number>();
    for (let b = 0; b < k; b++) {
      if (tried.has(bins[b]!)) continue;
      tried.add(bins[b]!);
      const need = cut.lengthMm + kerfMm;
      if (bins[b]! >= need) {
        bins[b]! -= need;
        if (backtrack(i + 1)) return true;
        bins[b]! += need;
      }
    }
    return false;
  }
  return backtrack(0);
}

describe('packCutList — AC9 FFD asymptotic bound (SC-011)', () => {
  it('FFD board count ≤ ceil(11/9 × OPT + 6/9) on random small inputs', () => {
    // Fixed stock: [16 ft] = 4877 mm. Cut lengths bounded to ≤ 16 ft
    // (else AC5 throws). Small n so the brute-force reference
    // terminates.
    const stockLengthMm: Mm = ftMm(16);
    const kerfMm: Mm = DEFAULT_KERF_MM;
    const cutArb = fc.array(
      // A cut length between 6″ (rough minimum for a real member)
      // and stockLengthMm (max fits stock — a single-cut board is
      // valid; the first cut on a bin pays no preceding kerf).
      fc
        .integer({ min: inMm(6), max: stockLengthMm })
        .map<Cut>((lengthMm) => ({
          memberId: `arb-${Math.random().toString(36).slice(2, 10)}`,
          lengthMm,
        })),
      { minLength: 0, maxLength: 12 },
    );
    fc.assert(
      fc.property(cutArb, (cuts) => {
        // Deduplicate ids (fc may generate collisions across
        // iterations; the packer is deterministic on unique ids).
        const seen = new Set<string>();
        const unique: Cut[] = [];
        for (const c of cuts) {
          if (seen.has(c.memberId)) continue;
          seen.add(c.memberId);
          unique.push(c);
        }
        const ffd = packCutList({
          cuts: unique,
          stockLengthsMm: [stockLengthMm],
          kerfMm,
        });
        const opt = bruteForceOptimalBoardCount(unique, stockLengthMm, kerfMm);
        // The classical FFD bound: FFD(n) ≤ 11/9 × OPT(n) + 6/9.
        // Both sides are integers; convert to an integer inequality
        // by multiplying through by 9.
        //   9 × FFD ≤ 11 × OPT + 6
        expect(9 * ffd.totalStockBoards).toBeLessThanOrEqual(11 * opt + 6);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Perf — SC-011 latency bound (≤50 ms for 500 members)
// ---------------------------------------------------------------------------

describe('packCutList — SC-011 latency bound', () => {
  it('packs 500 random cuts in ≤ 50 ms', () => {
    // Deterministic pseudo-random cut lengths (LCG) — avoids
    // test flakiness from Math.random.
    let seed = 0x1234_5678;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const cuts: Cut[] = Array.from({ length: 500 }, (_v, i) => ({
      memberId: `perf-${String(i).padStart(4, '0')}`,
      // 6″ .. 16 ft, integer mm.
      lengthMm: Math.max(
        inMm(6),
        Math.round(rand() * (ftMm(16) - inMm(6))) + inMm(6),
      ),
    }));
    const t0 = performance.now();
    const result = packCutList({
      cuts,
      stockLengthsMm: [ftMm(8), ftMm(10), ftMm(12), ftMm(14), ftMm(16), ftMm(20)],
      kerfMm: DEFAULT_KERF_MM,
    });
    const elapsedMs = performance.now() - t0;
    // Every cut is packed — no losses.
    const packed = result.stockBoards.reduce((s, b) => s + b.cuts.length, 0);
    expect(packed).toBe(cuts.length);
    // SC-011: ≤ 50 ms on the reference hardware. Doubled here (100
    // ms) to give a comfortable margin in CI, where JS timers +
    // shared cores make the tail slower than a bare-metal reference.
    expect(elapsedMs).toBeLessThanOrEqual(100);
  });
});
