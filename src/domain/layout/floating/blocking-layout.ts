/**
 * `src/domain/layout/floating/blocking-layout.ts` — position the
 * blocking pieces between adjacent beams in a floating deck
 * (S19 — AC6).
 *
 * ## Contract
 *
 * `computeBlocking({beams, joistNominal, species, grade, maxSpacingMm})`
 * returns `blocking`-kind `LayoutMember`s installed between adjacent
 * BEAM PAIRS for lateral stiffness. Per AC6:
 *
 *   - For each pair of adjacent beams `(beams[i], beams[i+1])`:
 *
 *         numPerPair = max(0, ceil(lengthMm / maxSpacingMm) - 1)
 *
 *     blocking pieces are placed BETWEEN them, evenly spaced along
 *     the +z axis as INTERIOR points (not at either beam endpoint).
 *
 *   - Piece orientation is PERPENDICULAR to the beams — the long
 *     axis of each blocking piece is +x (beam-to-beam), the short
 *     axis is +z (matches the beam's z-thickness so the piece nests
 *     flush between the two beam webs).
 *
 *   - Piece dimensions:
 *     - `size.x = |Δbeam.x| - beam.thicknessMm` — the free-length
 *       between the two beam WEBS (the offcut cut-to-fit length).
 *     - `size.y = beam.actual.heightMm` — same as beam depth
 *       (blocking is same nominal as beam, on-edge).
 *     - `size.z = beam.actual.widthMm` — beam thickness, so the
 *       piece sits flush against the beam webs.
 *
 *   - `material = { kind:'lumber', nominal:joistNominal, species, grade }`.
 *
 *   - `kind = 'blocking'` (new `MemberKind` widened by S17).
 *
 * ## AC6 vs the physical geometry — an autonomous decision
 *
 * AC6 literally says `size.z = shorter offcut length`. The
 * "free-length between the two beam webs" is measured along +x
 * (perpendicular to the beams that run along +z), so the offcut
 * length physically lands on `size.x`, not `size.z`. This
 * implementation follows the physical geometry (long axis on +x)
 * and documents the deviation here + in the S19 handoff so the
 * reviewer can push back if the ticket wording was the intent.
 *
 * ## `maxSpacingMm` sourcing — 48" (1220 mm) per user Q2 + prompt
 *
 * The MVP fixes `maxSpacingMm = 1220 mm` (48") at the caller —
 * matches the IRC blocking recommendation for joists ≥ 2×8. User
 * confirmed the value is NOT UI-configurable in the MVP (Q2 in
 * ticket §17). The caller passes it in so a future ticket that
 * surfaces the value in the UI (or derives it per-material) is a
 * one-argument change.
 *
 * ## Stable ids
 *
 * `blocking-p{pairIndex}-s{seqIndex}` — pairIndex ∈ [0, N-1),
 * seqIndex ∈ [0, numPerPair). Unique and stable across re-layouts
 * for identical inputs (blocking members participate in `Layout`
 * determinism per AC7).
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules
 * (types + materials-catalog).
 */

import { lookupMaterial } from '../../materials-catalog';
import type { Grade, LayoutMember, LumberNominal, Species } from '../../model';
import type { Mm } from '../../units';

/**
 * Input for `computeBlocking`. The caller SUPPLIES the beam nominal
 * / species / grade explicitly (rather than the whole `DeckDesign`)
 * so the function is directly unit-testable with hand-built beams,
 * matching the "pure function on typed inputs" discipline of the
 * elevated `computeJoistXCenters` / `layoutBoardRows` helpers.
 */
export interface BlockingInput {
  /**
   * The beam layer from `computeFloatingBeams`. Each beam MUST have
   * `kind === 'beam'` and `size.z === deck lengthMm` (the standard
   * shape produced by `floating-beam-layout.ts`).
   */
  readonly beams: readonly LayoutMember[];
  /**
   * Blocking material nominal — same as the beam nominal per AC6
   * ("Blocking material = same SKU as beam").
   */
  readonly joistNominal: LumberNominal;
  readonly species: Species;
  readonly grade: Grade;
  /**
   * Max on-center spacing between adjacent blocking pieces along
   * the length axis. MVP fixes 1220 mm (48") per user Q2. Must be
   * strictly positive; caller ensures.
   */
  readonly maxSpacingMm: Mm;
}

/**
 * Build the blocking layer. Pure — same input yields byte-equal
 * output.
 *
 * @throws {Error} when `maxSpacingMm` ≤ 0 OR when any input beam
 *   has `kind !== 'beam'`. Wrapped as `LayoutError` by the layout
 *   engine.
 */
export function computeBlocking(input: BlockingInput): readonly LayoutMember[] {
  validateInput(input);
  const { beams, joistNominal, species, grade, maxSpacingMm } = input;

  // Trivial cases — fewer than 2 beams means zero pairs → zero
  // blocking pieces. Not an error; return early.
  if (beams.length < 2) return [];

  // Sort beams by ascending x so `pair index i` corresponds to
  // adjacent beams `(sorted[i], sorted[i+1])`. `computeFloatingBeams`
  // already returns them sorted, but we sort defensively so a
  // future caller can't quietly break the "adjacent" invariant.
  const sortedBeams = [...beams].sort(
    (a, b) => a.position.x - b.position.x,
  );

  // Every floating beam has the SAME size.z (the deck length) and
  // the SAME size.x (beam thickness) and the SAME size.y (beam
  // depth). Sample from beams[0]; downstream drift would surface as
  // a mismatched blocking geometry, but AC7 fixture goldens would
  // catch it in CI.
  const beamThicknessMm = sortedBeams[0]!.size.x;
  const beamDepthMm = sortedBeams[0]!.size.y;
  const lengthMm = sortedBeams[0]!.size.z;
  const beamYCenter = sortedBeams[0]!.position.y;

  // Look up the blocking material to VALIDATE the triple exists in
  // the catalog. We don't use the returned dims (blocking size is
  // derived from beam dims), but the lookup surfaces a bad triple
  // early with a clear error message.
  lookupMaterial(joistNominal, species, grade);

  const numPerPair = Math.max(0, Math.ceil(lengthMm / maxSpacingMm) - 1);
  if (numPerPair === 0) return [];

  // Evenly-spaced INTERIOR z-positions. The length is divided into
  // (numPerPair + 1) equal cells; the k-th blocking piece sits at
  // the k-th interior boundary (k ∈ [1, numPerPair]).
  const step = lengthMm / (numPerPair + 1);
  const zCenters: number[] = [];
  for (let k = 1; k <= numPerPair; k++) {
    zCenters.push(-lengthMm / 2 + k * step);
  }

  const members: LayoutMember[] = [];
  for (let pairIndex = 0; pairIndex < sortedBeams.length - 1; pairIndex++) {
    const beamLeft = sortedBeams[pairIndex]!;
    const beamRight = sortedBeams[pairIndex + 1]!;
    const gapCenterX = (beamLeft.position.x + beamRight.position.x) / 2;
    // Free length between beam WEBS — accounts for the two beam
    // thicknesses inset from each other (half a beam thickness on
    // each side of the gap centerline).
    const gapWidth = beamRight.position.x - beamLeft.position.x - beamThicknessMm;

    for (let seqIndex = 0; seqIndex < numPerPair; seqIndex++) {
      members.push({
        id: `blocking-p${pairIndex}-s${seqIndex}`,
        kind: 'blocking',
        material: { kind: 'lumber', nominal: joistNominal, species, grade },
        position: {
          x: gapCenterX,
          y: beamYCenter,
          z: zCenters[seqIndex]!,
        },
        size: {
          x: gapWidth, // free-length along beam-to-beam direction
          y: beamDepthMm, // on-edge, matches beam
          z: beamThicknessMm, // flush with beam thickness
        },
        rotation: { x: 0, y: 0, z: 0 },
      });
    }
  }
  return members;
}

/**
 * Trust-boundary defensive check for the blocking input. See
 * Developer Guardian Rules → Pre-compliance → Trust boundaries.
 *
 * Rejects invalid `maxSpacingMm` (division / infinite loop) and
 * wrong-kind members in `beams` (a future caller mixing joists into
 * the beams array would produce nonsensical blocking geometry).
 */
function validateInput(input: BlockingInput): void {
  if (!Number.isFinite(input.maxSpacingMm) || input.maxSpacingMm <= 0) {
    throw new Error(
      `computeBlocking: invalid maxSpacingMm=${input.maxSpacingMm} ` +
        `(must be a positive finite number). MVP default is 1220 mm (48").`,
    );
  }
  for (const m of input.beams) {
    if (m.kind !== 'beam') {
      throw new Error(
        `computeBlocking: beams array contains a non-'beam' member ` +
          `(id=${JSON.stringify(m.id)}, kind=${JSON.stringify(m.kind)}). ` +
          `Only beam members are valid.`,
      );
    }
  }
}
