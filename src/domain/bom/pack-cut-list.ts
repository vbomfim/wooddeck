/**
 * `src/domain/bom/pack-cut-list.ts` — S21 issue #43 FR-031
 * First-Fit-Decreasing (FFD) 1-D cut-list bin-packer.
 *
 * ## Responsibility (single)
 *
 * Turn a list of member cut-lengths into a plan of stock-board
 * purchases + per-board cut sequences. The function is PURE — it
 * takes only its argument and returns a value; no I/O, no clock, no
 * store access, no catalog lookup. The stock-length list is passed
 * IN so a caller (`deriveBom`) can source it from
 * `materials-catalog.stockLengthsMm` and the packer stays SKU-
 * agnostic (SC-011 asymptotic bound + FR-031 parametric stocks).
 *
 * ## Algorithm — First-Fit-Decreasing (FFD) into FIXED-size bins
 *
 * 0. **Splice pass** (FIX 0 — S24 UAT pair-fix): before FFD, partition
 *    cuts into `oversizeCuts` (lengthMm > maxStockMm) and `normalCuts`
 *    (the rest). For each oversize cut, emit `N = ceil(lengthMm /
 *    maxStockMm)` boards of the max stock length: N−1 fully-consumed
 *    boards each carrying one `maxStockMm`-length "full board" cut,
 *    plus one final board with the REMAINDER cut (`lengthMm − (N−1) ×
 *    maxStockMm`) and its offcut. Butt-jointing two boards on top of
 *    a joist is standard framing practice, so a run longer than the
 *    catalog's max stock just adds the extra board(s) to the shopping
 *    list. No kerf is charged for the joint (a butt join is not a
 *    saw cut). Spliced boards do NOT participate in the FFD loop —
 *    each full board is consumed by that member's run alone.
 *
 * 1. Compute `L_max = max(normalCut.lengthMm)` over the remaining
 *    (non-spliced) cuts. Pick ONE stock length for those cuts: the
 *    SMALLEST value in `stockLengthsMm` that is ≥ `L_max`.
 *
 *    Rationale (user Q3 + AC7 golden fixture): mixing stock sizes
 *    within one SKU makes the shopping list harder to hand to a
 *    lumberyard AND — counterintuitively — often INCREASES the
 *    total board count. The AC7 example (13 × 16 ft beams + 30 ft
 *    of blocking, all 2×8 PT) packs to exactly 15 × 16 ft boards
 *    only when the blocking is folded into 16 ft boards; opening
 *    smaller 8 ft boards for the blocking pieces would need 3+
 *    additional boards (see the derive-bom AC7 test).
 *
 * 2. Sort the (normal) cut-list by `lengthMm` DESCENDING. Ties
 *    tie-break by `memberId` ASCENDING → deterministic output.
 * 3. Repeat until every cut is placed:
 *    a. Open a new board of `stockLengthMm`.
 *    b. Walk the DESCENDING-sorted cuts; place each cut that fits
 *       (`cut.lengthMm ≤ remaining`) and deduct `cut.lengthMm +
 *       kerfMm` from `remaining` (clamped at 0 for the exact-fit
 *       edge). Skip cuts already placed on prior boards.
 *    c. Close the board. `offcutMm` = remaining length.
 *
 * The classical FFD asymptotic bound (Ullman 1971) is
 * `FFD(n) ≤ 11/9 × OPT(n) + 6/9`, exercised as a property test
 * against a brute-force optimal solver on small inputs.
 *
 * ## Kerf accounting
 *
 * The packer models kerf as blade-width lost BETWEEN adjacent cuts
 * on the same board — i.e. `N` cuts on one board consume
 * `sum(cutLengths) + (N-1) × kerfMm` of the stock length. A trailing
 * blade-width after the final cut becomes sawdust that eats into
 * the offcut (no accounting difference — the final `offcutMm` is
 * `stockLengthMm − sum(cutLengths) − (N-1) × kerfMm` and any smaller
 * trailing waste rolls into it).
 *
 * The placement rule is easier to state in terms of a running
 * `remaining`: start `remaining = stockLengthMm`; to place a cut,
 * require `cut.lengthMm ≤ remaining`; after placing, set
 * `remaining = max(0, remaining − cut.lengthMm − kerfMm)`. The
 * `max(0, …)` clamp handles the exact-fit edge (the AC1 case where
 * a single cut equals the stock length: `remaining` becomes 0, not
 * −kerfMm). Because the first cut in a bin does NOT pay a preceding
 * kerf, "smallest stock that fits the longest cut" uses the RAW
 * `cut.lengthMm` (no kerf added) — otherwise a 16 ft cut against a
 * [16 ft] stock list would falsely reject the 16 ft board.
 *
 * ## Complexity
 *
 * O(n log n) for the sort. The inner packing loop is O(n) worst-case
 * per board (rescans the unplaced list), giving O(n²) in the pack
 * loop for adversarial inputs. For MVP-scale designs (n ≤ 500) this
 * is under 1 ms on the reference hardware — well inside the SC-011
 * budget of ≤ 50 ms.
 *
 * ## Boundary
 *
 * Pure `src/domain/bom/**` module. Imports ONLY from `../units`
 * (type-only for `Mm`). No `domain/layout`, no catalog, no state.
 * The `domain-allowlist` dep-cruiser rule permits `^src/domain/`.
 */
import type { Mm } from '../units';

// ---------------------------------------------------------------------------
// Public types (frozen contract — see ticket #43 §2)
// ---------------------------------------------------------------------------

/**
 * One member's cut requirement. `memberId` is a stable string used
 * for the deterministic tie-break and for cross-referencing back to
 * the source `LayoutMember` in the UI (S24 hover / expand).
 */
export interface Cut {
  readonly memberId: string;
  readonly lengthMm: Mm;
}

/**
 * One stock board's plan: which cuts come off it and what offcut
 * remains. `cuts` is in the ORDER the packer would make them (from
 * one end of the stock board), which matches the physical cut order
 * a carpenter would follow with a stop-block.
 */
export interface PackedBoard {
  readonly stockLengthMm: Mm;
  readonly cuts: readonly Cut[];
  readonly offcutMm: Mm;
}

/**
 * The pack result. `totalStockBoards` is the shopping quantity;
 * `totalOffcutMm` is the sum of every board's `offcutMm` — a
 * back-of-envelope waste metric surfaced by the BOM UI.
 */
export interface PackResult {
  readonly stockBoards: readonly PackedBoard[];
  readonly totalStockBoards: number;
  readonly totalOffcutMm: Mm;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pack a cut-list into stock boards using First-Fit-Decreasing.
 *
 * @param input.cuts             The cuts to pack. May be empty. Each
 *                                `cut.lengthMm` MUST be a finite,
 *                                strictly-positive number (zero is
 *                                rejected — a zero-length cut is a
 *                                producer bug; see FIX 1 below).
 * @param input.stockLengthsMm   Available stock lengths, sorted or not
 *                                (the function sorts a defensive copy
 *                                internally). Must be non-empty and
 *                                every entry must be a finite,
 *                                strictly-positive number.
 * @param input.kerfMm           Blade-width lost per cut. Typically 3 mm
 *                                (the `deriveBom` default; `packCutList`
 *                                itself has NO default — `kerfMm` is a
 *                                required argument). Must be a finite
 *                                non-negative number (0 is permitted —
 *                                idealized kerf-free packing).
 *
 * @throws {Error} on any trust-boundary violation (FIX 1):
 *   - `kerfMm` is non-finite or negative — throws `/kerf/` message.
 *   - `stockLengthsMm` is empty, or any entry is non-finite / ≤ 0 —
 *      throws `/stock/i` message (empty vs invalid distinguished by
 *      text).
 *   - Any `cut.lengthMm` is non-finite or ≤ 0 — throws naming the
 *     offending `memberId` and the offending value.
 *   - The internal FFD loop fails to make progress (defense-in-
 *     depth: a bug that let an unplaceable cut past the pre-checks
 *     would otherwise hang the process). Throws an invariant
 *     error naming the stuck cut.
 *
 *   FIX 0 (S24 UAT pair-fix): a cut LONGER than the max stock is
 *   no longer a boundary violation — it splices across boards
 *   (see the "Splice pass" step in the Algorithm section). Only
 *   NaN / negative / zero / non-finite inputs still throw.
 */
export function packCutList(input: {
  readonly cuts: readonly Cut[];
  readonly stockLengthsMm: readonly Mm[];
  readonly kerfMm: Mm;
}): PackResult {
  const { cuts, stockLengthsMm, kerfMm } = input;

  // ---- Validate inputs (fail-loud at the trust boundary) ------------------
  // FIX 1 (review-gate): a `NaN` cut would hang the FFD loop
  // forever because `NaN <= remaining` is false → nothing places
  // → the outer `while (placedCount < orderedCuts.length)` never
  // terminates. A zero-length cut would spin forever for the same
  // reason (never fits when kerf > 0, but a 0-length cut on a 0-
  // kerf pack would "place" infinitely without advancing offcut).
  // Reject at the boundary with a message naming the offender.
  if (!Number.isFinite(kerfMm) || kerfMm < 0) {
    throw new Error(
      `packCutList: kerfMm must be a non-negative finite number; got ${String(kerfMm)}.`,
    );
  }
  if (cuts.length === 0) {
    // Trivial pack — no cuts, no boards. Explicit empty result so
    // downstream reducers can safely spread over `stockBoards`.
    return { stockBoards: [], totalStockBoards: 0, totalOffcutMm: 0 };
  }
  if (stockLengthsMm.length === 0) {
    throw new Error(
      'packCutList: stockLengthsMm is empty — the catalog must supply ' +
        'at least one stock-board length per SKU.',
    );
  }
  // FIX 1: every stock length must be a positive finite number.
  // A `NaN` / `Infinity` / 0 / negative entry would corrupt the
  // sort (NaN comparisons are inconsistent) or the "smallest that
  // fits" scan (Infinity always fits → could mask a real problem).
  for (const s of stockLengthsMm) {
    if (!Number.isFinite(s) || s <= 0) {
      throw new Error(
        `packCutList: every stockLengthsMm entry must be a positive finite ` +
          `number; got ${String(s)} in [${stockLengthsMm.map((v) => String(v)).join(', ')}].`,
      );
    }
  }
  // FIX 1: every cut length must be a positive finite number.
  // Iterate in caller order so the error message names an offender
  // deterministically (helps debugging when multiple bad values
  // slip through the same producer).
  for (const c of cuts) {
    if (!Number.isFinite(c.lengthMm) || c.lengthMm <= 0) {
      throw new Error(
        `packCutList: cut '${c.memberId}' has invalid lengthMm=${String(c.lengthMm)} ` +
          `— every cut length must be a positive finite number (NaN, Infinity, 0, ` +
          `and negative values are rejected at the trust boundary to prevent ` +
          `non-terminating pack loops or corrupt accounting).`,
      );
    }
  }

  // Defensive-copy the stock list (input might be a frozen catalog
  // array) and sort ascending so `smallestStockThatFits` is a plain
  // linear scan.
  const stocksAsc = [...stockLengthsMm].sort((a, b) => a - b);
  const maxStockMm = stocksAsc[stocksAsc.length - 1]!;

  // Deterministic ordering: length DESC, tie-break memberId ASC.
  // A defensive copy so the caller's array is never mutated (a
  // contract asserted by the "input arrays are NOT mutated" test).
  const orderedCuts: Cut[] = [...cuts].sort(compareCutsDescStable);

  // ---- FIX 0 (S24 UAT pair-fix) — SPLICE over-length cuts ---------------
  // A cut LONGER than the max stock is physically built by butt-
  // jointing multiple boards on top of a joist (real framing
  // practice — decking boards are routinely spliced on wide decks).
  // Prior behavior threw here, which crashed BomPanel's render
  // useMemo → white-screened the whole app for any deck wider than
  // ~20 ft. New behavior: split the over-length cut into
  // `N = ceil(lengthMm / maxStockMm)` boards of the max stock
  // length. Boards 1..N-1 are fully consumed by the run (single
  // cut of `maxStockMm`, offcut 0); board N carries the remainder
  // (`lengthMm - (N-1)*maxStockMm`) and its offcut. No kerf is
  // charged for the joint (a butt-join is not a saw cut).
  //
  // The spliced boards are emitted UP-FRONT, so the returned
  // `stockBoards` list has spliced boards first (in cut-order),
  // then FFD-packed boards for the remaining "normal" cuts. This
  // ordering is deterministic and testable.
  const splicedBoards: PackedBoard[] = [];
  const normalCuts: Cut[] = [];
  for (const c of orderedCuts) {
    if (c.lengthMm <= maxStockMm) {
      normalCuts.push(c);
      continue;
    }
    // Over-length: splice into ceil(lengthMm / maxStockMm) boards.
    // The last board's cut length is (lengthMm mod maxStockMm) —
    // but when the modulus is 0 (exact multiple), that "last cut"
    // is a full `maxStockMm` board too, and we want to emit
    // `lengthMm / maxStockMm` full boards, NOT one extra empty
    // board. Handle the exact-multiple case explicitly.
    const isExactMultiple = c.lengthMm % maxStockMm === 0;
    const numFullBoards = isExactMultiple
      ? c.lengthMm / maxStockMm
      : Math.floor(c.lengthMm / maxStockMm);
    for (let i = 0; i < numFullBoards; i++) {
      splicedBoards.push(
        Object.freeze({
          stockLengthMm: maxStockMm,
          cuts: Object.freeze([{ memberId: c.memberId, lengthMm: maxStockMm }]),
          offcutMm: 0,
        }),
      );
    }
    if (!isExactMultiple) {
      const remainderCutMm = c.lengthMm - numFullBoards * maxStockMm;
      splicedBoards.push(
        Object.freeze({
          stockLengthMm: maxStockMm,
          cuts: Object.freeze([{ memberId: c.memberId, lengthMm: remainderCutMm }]),
          offcutMm: maxStockMm - remainderCutMm,
        }),
      );
    }
  }
  // If EVERY cut was oversize, we're done — no FFD pass needed.
  if (normalCuts.length === 0) {
    const totalOffcutMmSpliced = splicedBoards.reduce((s, b) => s + b.offcutMm, 0);
    return Object.freeze({
      stockBoards: Object.freeze(splicedBoards),
      totalStockBoards: splicedBoards.length,
      totalOffcutMm: totalOffcutMmSpliced,
    });
  }

  // ---- FFD pack (single stock length, fixed-size bins) -------------------
  // Per ticket §16, the pack uses ONE stock length for the FFD-
  // packed portion — the smallest that fits the LONGEST remaining
  // (non-spliced) cut. This choice is the "shop-friendly" trade-off
  // (Q3) AND is required by the AC7 golden fixture (mixing 8 ft
  // blocking boards with 16 ft beam boards over-counts total stock;
  // see module header).
  let longestCutMm = 0;
  for (const c of normalCuts) {
    if (c.lengthMm > longestCutMm) longestCutMm = c.lengthMm;
  }
  const packStockLengthMm = smallestStockThatFits(stocksAsc, longestCutMm);
  // The splice pass consumed every cut > maxStockMm; every remaining
  // `normalCut` has lengthMm ≤ maxStockMm, so a stock >= longestCut
  // exists (maxStockMm itself). This is provable — guarded for
  // defense-in-depth only.
  /* istanbul ignore next -- defensive: splice removed every oversize cut */
  if (packStockLengthMm === null) {
    /* istanbul ignore next -- same */
    throw new Error(
      `packCutList: internal invariant violated — no stock fits the ` +
        `longest remaining cut ${String(longestCutMm)} after the splice pass.`,
    );
  }

  // `placed` is a boolean per cut index in `normalCuts`. We open
  // fixed-size boards one at a time and greedily fill each in DESC
  // order, skipping cuts already placed on a prior board.
  const placed = new Array<boolean>(normalCuts.length).fill(false);
  const boards: PackedBoard[] = [];
  let placedCount = 0;

  while (placedCount < normalCuts.length) {
    // Open a new board of the FIXED pack stock length.
    const boardCuts: Cut[] = [];
    let remaining = packStockLengthMm;
    const placedCountAtBoardStart = placedCount;
    for (let i = 0; i < normalCuts.length; i++) {
      if (placed[i]) continue;
      const candidate = normalCuts[i]!;
      // A cut fits when its length is ≤ remaining. Kerf is not
      // added to the fit-check because a cut that exactly consumes
      // remaining is a valid final cut (the trailing "kerf" would
      // be sawdust with nothing behind it — see module header).
      if (candidate.lengthMm <= remaining) {
        boardCuts.push(candidate);
        // After the cut, the blade sweeps out one more kerf-width
        // before the next cut could begin. Clamp at 0 so an
        // exact-fit final cut yields offcut = 0 rather than a
        // negative "remaining" leaking through.
        remaining = Math.max(0, remaining - candidate.lengthMm - kerfMm);
        placed[i] = true;
        placedCount += 1;
      }
    }
    // FIX 1 (review-gate): no-progress guard. If the entire scan
    // over unplaced cuts placed ZERO items on this new (empty)
    // board, the outer `while` will loop forever. This is a
    // defense-in-depth check: the input-validation and pre-checks
    // above already reject every known cause (NaN cut, zero cut,
    // oversize cut splices). A future refactor that introduces a
    // fourth cause without updating the pre-check would surface
    // HERE with an actionable diagnostic instead of a UI-thread
    // hang.
    /* istanbul ignore next -- defense-in-depth; pre-checks make this unreachable */
    if (placedCount === placedCountAtBoardStart) {
      const stuck = normalCuts.find((_c, i) => !placed[i])!;
      throw new Error(
        `packCutList: internal invariant violated — FFD loop made no ` +
          `progress after opening a fresh ${String(packStockLengthMm)} mm board. ` +
          `Stuck cut: '${stuck.memberId}' lengthMm=${String(stuck.lengthMm)}. ` +
          `This indicates a bug in the pre-check (an unplaceable cut slipped ` +
          `through validation).`,
      );
    }
    boards.push(
      Object.freeze({
        stockLengthMm: packStockLengthMm,
        cuts: Object.freeze(boardCuts),
        offcutMm: remaining,
      }),
    );
  }

  // Spliced boards go FIRST, then FFD-packed boards. Consumers see
  // the shopping list in a stable order (spliced runs "belong" to
  // one big member and are easier to identify at the top).
  const allBoards = [...splicedBoards, ...boards];
  const totalOffcutMm = allBoards.reduce((s, b) => s + b.offcutMm, 0);
  return Object.freeze({
    stockBoards: Object.freeze(allBoards),
    totalStockBoards: allBoards.length,
    totalOffcutMm,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Comparator: length DESC, then memberId ASC. Placing this as a
 * named function (not an inline arrow) gives a stack-trace-friendly
 * label if the sort ever throws in the future.
 */
function compareCutsDescStable(a: Cut, b: Cut): number {
  if (a.lengthMm !== b.lengthMm) return b.lengthMm - a.lengthMm;
  // Locale-independent string comparison — memberIds are ASCII
  // (`c-0000`, `member-1234`, etc. from the layout engine).
  if (a.memberId < b.memberId) return -1;
  if (a.memberId > b.memberId) return 1;
  return 0;
}

/**
 * Return the smallest value in `stocksAsc` that is ≥ `needMm`. The
 * input MUST be sorted ascending. Returns `null` when nothing fits
 * — the caller converts that into an AC5 throw.
 *
 * Linear scan — the stock list has at most 7 entries in the MVP
 * catalog (see `materials-catalog.STOCK_FEET_5_4_DECKING`), so a
 * binary search would add complexity without measurable benefit.
 */
function smallestStockThatFits(stocksAsc: readonly Mm[], needMm: Mm): Mm | null {
  for (const s of stocksAsc) {
    if (s >= needMm) return s;
  }
  return null;
}
