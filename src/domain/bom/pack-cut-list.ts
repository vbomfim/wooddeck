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
 * 1. Compute `L_max = max(cut.lengthMm)` over ALL cuts (not per
 *    board — see §16 "OUT OF SCOPE: Multiple stock-length offerings
 *    within one pack"). Pick ONE stock length for the entire pack:
 *    the SMALLEST value in `stockLengthsMm` that is ≥ `L_max`. If
 *    none exists, throw naming the offending cut (AC5).
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
 * 2. Sort the cut-list by `lengthMm` DESCENDING. Ties tie-break by
 *    `memberId` ASCENDING → deterministic output, byte-for-byte.
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
 *   - Any `cut.lengthMm` exceeds the maximum stock length — throws
 *     naming the offender AND the max available stock length so the
 *     UI (S24) can surface a contextful "cut too long — choose
 *     longer stock or split the member" hint. The check uses the
 *     RAW `lengthMm` (not `lengthMm + kerfMm`) because the first
 *     cut on a bin pays no preceding kerf — a cut of exactly the
 *     max stock length is a valid single-cut board.
 *   - The internal FFD loop fails to make progress (defense-in-
 *     depth: a bug that let an unplaceable cut past the pre-checks
 *     would otherwise hang the process). Throws an invariant
 *     error naming the stuck cut.
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

  // ---- Validate every cut fits SOME stock length -------------------------
  // We check every cut individually (not just the largest) so the
  // error message names the actual offender when multiple cuts
  // exceed the max stock length. The first cut in a bin does NOT
  // pay a preceding kerf, so the check is against `lengthMm` alone
  // (not `lengthMm + kerfMm`) — a cut of exactly the max stock is
  // permissible (single-cut board, offcut = 0).
  for (const c of orderedCuts) {
    if (c.lengthMm > maxStockMm) {
      throw new Error(
        `packCutList: cut '${c.memberId}' has lengthMm=${String(c.lengthMm)} ` +
          `which exceeds the maximum stock length ${String(maxStockMm)}. ` +
          `Choose a longer stock length for this SKU or split the member ` +
          `into shorter pieces.`,
      );
    }
  }

  // ---- FFD pack (single stock length, fixed-size bins) -------------------
  // Per ticket §16, the pack uses ONE stock length for the entire
  // pack — the smallest that fits the LONGEST cut. This choice is
  // the "shop-friendly" trade-off (Q3) AND is required by the AC7
  // golden fixture (mixing 8 ft blocking boards with 16 ft beam
  // boards over-counts total stock; see module header).
  let longestCutMm = 0;
  for (const c of orderedCuts) {
    if (c.lengthMm > longestCutMm) longestCutMm = c.lengthMm;
  }
  const packStockLengthMm = smallestStockThatFits(stocksAsc, longestCutMm);
  // The AC5 pre-check above guarantees this is non-null.
  /* istanbul ignore next -- defensive: pre-check accepted the longest cut */
  if (packStockLengthMm === null) {
    /* istanbul ignore next -- same */
    throw new Error(
      `packCutList: internal invariant violated — no stock fits the ` +
        `longest cut ${String(longestCutMm)} after the pre-check accepted it.`,
    );
  }

  // `placed` is a boolean per cut index in `orderedCuts`. We open
  // fixed-size boards one at a time and greedily fill each in DESC
  // order, skipping cuts already placed on a prior board.
  const placed = new Array<boolean>(orderedCuts.length).fill(false);
  const boards: PackedBoard[] = [];
  let placedCount = 0;

  while (placedCount < orderedCuts.length) {
    // Open a new board of the FIXED pack stock length.
    const boardCuts: Cut[] = [];
    let remaining = packStockLengthMm;
    const placedCountAtBoardStart = placedCount;
    for (let i = 0; i < orderedCuts.length; i++) {
      if (placed[i]) continue;
      const candidate = orderedCuts[i]!;
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
    // oversize cut). A future refactor that introduces a fourth
    // cause without updating the pre-check would surface HERE with
    // an actionable diagnostic instead of a UI-thread hang. The
    // guard fires only when the board began empty (remaining ==
    // packStockLengthMm) and stayed empty (placedCount unchanged).
    /* istanbul ignore next -- defense-in-depth; pre-checks make this unreachable */
    if (placedCount === placedCountAtBoardStart) {
      const stuck = orderedCuts.find((_c, i) => !placed[i])!;
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

  const totalOffcutMm = boards.reduce((s, b) => s + b.offcutMm, 0);
  return Object.freeze({
    stockBoards: Object.freeze(boards),
    totalStockBoards: boards.length,
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
