/**
 * `src/domain/layout/floating/floating-joist-layout.ts` — the joist
 * layer for a floating deck.
 *
 * ## Why a floating-specific joist helper
 *
 * The elevated `layoutJoists(design)` in `../joist-layout.ts` computes
 * every joist's y from `computeYStack(design).joistCenterY`, which is
 * anchored to `footprint.heightMm` (top-down stack — see `../y-stack.ts`).
 * A floating deck stacks BOTTOM-UP from y=0 (see `./y-stack-floating.ts`)
 * so the y-anchor is different — but the x-center placement (spacing,
 * anchoring, count formula) is IDENTICAL to elevated. This module
 * reuses the shared `computeJoistXCenters` helper to guarantee no
 * spacing drift between the elevated and floating pipelines.
 *
 * ## Issue #77 — segmented joists under flush + interior
 *
 * When `beamConnection === 'flush' && totalRows ≥ 3` (i.e. flush AND
 * at least one interior beam row per issue #75), each joist x-center
 * emits `totalRows − 1` SEGMENT members (one per bay), hung off the
 * two enclosing beam faces via joist hangers. Ids `joist-{i}-bay-{k}`
 * where `i` is the joist column index (asc +x) and `k` is the bay
 * index (asc +z). Every other case (DROP, flush-2-beam, Method B)
 * emits ONE continuous joist per x-center with id `joist-{i}` —
 * BYTE-IDENTICAL to pre-#77. See the ticket §2 C1..C3 for the full
 * derivation and §17 Q1 for the segmentation rationale (face-to-face
 * clear gaps; interior-beam faces carry two hangers, one per
 * adjacent segment).
 *
 * ## Contract
 *
 * `layoutFloatingJoists(design, options?)` returns joist members whose:
 *   - `kind = 'joist'`
 *   - `material = { kind: 'lumber', ...design.joist.material }`
 *   - `position.x` = center from `computeJoistXCenters(width, spacing, thickness)`
 *     — byte-identical formula to the elevated joist layer
 *   - `position.y` = `computeYStackFloating(design).joistCenterY`
 *     — Method A: beam-top + joistDepth/2 (drop) or beam-top −
 *     joistDepth/2 (flush); Method B: blockTop + joistDepth/2
 *   - `rotation = { x:0, y:0, z:0 }`
 *
 * Un-segmented case (DROP, flush-2-beam, Method B):
 *   - `position.z` = 0 (joist centered on the length axis)
 *   - `size.x` = joist thickness (small edge)
 *   - `size.y` = joist depth (large edge, on-edge)
 *   - `size.z` = `computeJoistLengthMm(design)` (see `../joist-layout.ts`)
 *   - `id = joist-{i}` for i ∈ [0, N−1]
 *
 * Segmented case (flush + interior; requires
 * `options.beamZCentersSorted.length ≥ 3` and
 * `options.beamThicknessMm > 0`):
 *   - `position.z` = bay midpoint = `(beamZ[k] + beamZ[k+1]) / 2`
 *   - `size.x`, `size.y` unchanged
 *   - `size.z` = bay CLEAR gap = `(beamZ[k+1] − beamZ[k]) − beamThickness`
 *   - `id = joist-{i}-bay-{k}` for i ∈ [0, numJoists−1], k ∈ [0, bays−1]
 *   - Emit order: iterate columns asc +x, then per column iterate
 *     bays asc +z (`joist-0-bay-0`, `joist-0-bay-1`, `joist-1-bay-0`, …).
 *
 * ## Stable ids
 *
 * `joist-{i}` for the un-segmented case (byte-identical to pre-#77).
 * `joist-{i}-bay-{k}` for segmented flush + interior — a NEW id shape
 * that no pre-#77 consumer greps for. BOM aggregators and 2D
 * plan-view code treat every `kind:'joist'` member uniformly.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules.
 */

import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign, LayoutMember } from '../../model';
import type { Mm } from '../../units';

import { computeJoistLengthMm, computeJoistXCenters } from '../joist-layout';

import { computeYStackFloating } from './y-stack-floating';

/**
 * Options bag for {@link layoutFloatingJoists} (issue #77).
 *
 * Both fields are OPTIONAL. When both are supplied AND the design
 * is `flush + interior` (i.e. `beamConnection === 'flush' &&
 * beamZCentersSorted.length ≥ 3`), the joist layer emits SEGMENTED
 * joists (one per bay). Otherwise the emitter falls back to the
 * pre-#77 un-segmented behavior (byte-identical).
 *
 * The orchestrator (`computeMethodA` in `./floating-layout.ts`)
 * threads these values in from `computeFloatingBeams(...)` +
 * `lookupMaterial(design.beam.material...).actual.widthMm`, so the
 * segment geometry stays in lock-step with the beam layout.
 */
export interface LayoutFloatingJoistsOptions {
  /**
   * Beam z-centers, ascending. Length ≥ 2. When omitted OR when
   * the design is not flush + interior, joists are emitted
   * un-segmented (byte-identical to pre-#77).
   */
  readonly beamZCentersSorted?: readonly number[];
  /**
   * Beam thickness on +z (`lookupMaterial(...).actual.widthMm`).
   * Required when segmentation dispatches (see the ticket §11).
   */
  readonly beamThicknessMm?: Mm;
}

/**
 * Bay descriptor returned by {@link computeBayClearGapsMm}. `midZ` is
 * the bay midpoint on +z (the joist segment's `position.z`);
 * `clearSpanMm` is the CLEAR gap between the two enclosing beam
 * faces on +z (the joist segment's `size.z`).
 *
 * Face-to-face (clear gap) — issue #77 §17 Q1 — is physically
 * correct: joists hang IN the space BETWEEN beam faces, they do
 * not pass through beams. Using center-to-center would either
 * overlap the beam AABB or misrepresent the cut length.
 */
export interface BayGap {
  readonly midZ: Mm;
  readonly clearSpanMm: Mm;
}

/**
 * Issue #77 — pure per-bay CLEAR-gap helper.
 *
 * For N ≥ 2 beam z-centers sorted ascending, returns N − 1 bay
 * descriptors: each entry is the midpoint on +z and the clear
 * gap between the two enclosing beam FACES on +z.
 *
 *   bay k: midZ = (beamZ[k] + beamZ[k+1]) / 2
 *          clearSpanMm = (beamZ[k+1] − beamZ[k]) − beamThicknessMm
 *
 * Bay `k` is bounded by beams k and k+1 (asc +z). The `−
 * beamThicknessMm` reduces the center-to-center gap to the actual
 * space between beam FACES — the physical volume a joist segment
 * hangs in. For N = 2 the return is a single-element array whose
 * `clearSpanMm` equals `computeJoistLengthMm`'s flush-2-beam result
 * (`lengthMm − FOOTING_WIDTH_MM − beamThickness`), so this helper
 * is a generalization of the flush-2-beam formula to N ≥ 2 bays.
 *
 * Pure — same input yields byte-equal output.
 *
 * @param beamZCentersSorted beam z-centers, ascending. Length ≥ 2.
 * @param beamThicknessMm    beam thickness on +z (positive number).
 * @returns array of length `beamZCentersSorted.length − 1`.
 */
export function computeBayClearGapsMm(
  beamZCentersSorted: readonly number[],
  beamThicknessMm: Mm,
): readonly BayGap[] {
  const out: BayGap[] = [];
  for (let k = 0; k + 1 < beamZCentersSorted.length; k++) {
    const near = beamZCentersSorted[k]!;
    const far = beamZCentersSorted[k + 1]!;
    out.push({
      midZ: (near + far) / 2,
      clearSpanMm: far - near - beamThicknessMm,
    });
  }
  return out;
}

/**
 * Build the floating joist layer. Pure — same input yields
 * byte-equal output. See module header for the field contract.
 *
 * When `options.beamZCentersSorted.length ≥ 3` AND
 * `design.beamConnection === 'flush'` AND
 * `design.floatingFraming === 'beams-and-joists'`, each joist column
 * is split into `totalRows − 1` bay SEGMENTS (issue #77). Every
 * other case emits ONE continuous joist per column (byte-identical
 * to pre-#77).
 *
 * @throws {Error} from `lookupMaterial` when the joist material
 *   triple is not in the catalog (wrapped as `LayoutError` by the
 *   layout engine).
 */
export function layoutFloatingJoists(
  design: DeckDesign,
  options: LayoutFloatingJoistsOptions = {},
): readonly LayoutMember[] {
  const joistMat = lookupMaterial(
    design.joist.material.nominal,
    design.joist.material.species,
    design.joist.material.grade,
  );
  const thicknessMm = joistMat.actual.widthMm;
  const depthMm = joistMat.actual.heightMm;
  const widthMm = design.footprint.widthMm;
  const spacingMm = design.joist.spacingMm;

  const xCenters = computeJoistXCenters(widthMm, spacingMm, thicknessMm);
  const yCenter = computeYStackFloating(design).joistCenterY;

  const material = { kind: 'lumber' as const, ...design.joist.material };

  // ---- Issue #77 segmentation dispatch ----------------------------------
  //
  // Fires only when ALL of the following hold:
  //   (a) Method A (beams-and-joists) — Method B has no beam layer.
  //   (b) beamConnection === 'flush' — drop joists cantilever over
  //       beams and remain continuous (see FR-C in the ticket).
  //   (c) beamZCentersSorted.length ≥ 3 — an INTERIOR beam exists.
  //       The 2-beam flush case (totalRows === 2, i.e. rim-only)
  //       degenerates to a single continuous joist per column —
  //       byte-identical to pre-#77 flush-2-beam.
  //   (d) beamThicknessMm > 0 — segmentation depends on the clear
  //       gap formula. When absent (defensive), fall back to the
  //       un-segmented path.
  //
  // §17 Q1 rationale: physical correctness — joists hang IN the
  // space BETWEEN beam faces, not through them. Face-to-face gaps
  // guarantee no segment overlaps a beam AABB. §17 Q3: two hangers
  // per segment (one at each end) — the BOM's per-segment hanger
  // formula (issue #77 C10 in `derive-bom.ts`) reads directly off
  // the emitted joist member count.
  const wantSegmentation =
    design.floatingFraming === 'beams-and-joists' &&
    design.beamConnection === 'flush' &&
    options.beamZCentersSorted !== undefined &&
    options.beamZCentersSorted.length >= 3 &&
    options.beamThicknessMm !== undefined &&
    options.beamThicknessMm > 0;

  if (wantSegmentation) {
    // Narrowed by `wantSegmentation` above — TS follows the guard.
    const beamZs = options.beamZCentersSorted;
    const beamThickness = options.beamThicknessMm;
    const bays = computeBayClearGapsMm(beamZs, beamThickness);
    const out: LayoutMember[] = [];
    // Emit order: joist column ASC +x (outer loop), then bay ASC
    // +z (inner loop). Reproduces the deterministic order the
    // regression tests pin (AC11).
    for (let i = 0; i < xCenters.length; i++) {
      const x = xCenters[i]!;
      for (let k = 0; k < bays.length; k++) {
        const bay = bays[k]!;
        out.push({
          id: `joist-${String(i)}-bay-${String(k)}`,
          kind: 'joist',
          material,
          position: { x, y: yCenter, z: bay.midZ },
          size: { x: thicknessMm, y: depthMm, z: bay.clearSpanMm },
          rotation: { x: 0, y: 0, z: 0 },
        });
      }
    }
    return out;
  }

  // ---- Un-segmented (pre-#77 byte-identical) ----------------------------
  // S27 review-response HIGH #1 — same clear-span dispatch as the
  // elevated joist layer. For Method A + flush + totalRows === 2,
  // joists END at the rim-beam inner faces; for Method A + drop OR
  // Method B they run the full deck length (Method B has no beams
  // so `beamConnection` is irrelevant — `computeJoistLengthMm`
  // returns full length for any non-flush design).
  const lengthMm = computeJoistLengthMm(design);

  return xCenters.map<LayoutMember>((x, i) => ({
    id: `joist-${String(i)}`,
    kind: 'joist',
    material,
    position: { x, y: yCenter, z: 0 },
    size: { x: thicknessMm, y: depthMm, z: lengthMm },
    rotation: { x: 0, y: 0, z: 0 },
  }));
}
