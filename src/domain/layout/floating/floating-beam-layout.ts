/**
 * `src/domain/layout/floating/floating-beam-layout.ts` — position the
 * beams of a floating deck (S19 — AC5).
 *
 * ## Contract
 *
 * `computeFloatingBeams(design, blockGrid)` returns ONE beam per
 * UNIQUE x-position in the supplied block grid. Every beam:
 *
 *   - `kind = 'beam'`
 *   - `material = { kind: 'lumber', ...design.beam.material }` — the
 *     widened `MemberMaterialRef` lumber variant
 *   - `size.x` = beam actual widthMm (small dressed dim — thickness
 *     on +x, laid on-edge)
 *   - `size.y` = beam actual heightMm (large dressed dim — depth on
 *     +y, on-edge)
 *   - `size.z` = `design.footprint.lengthMm` (beam runs the full
 *     deck length)
 *   - `position.x` = the block column's x-center (so the beam sits
 *     directly over its supporting blocks)
 *   - `position.y` = `beam.actual.heightMm / 2` (beam bottom flush
 *     with block top at y=0; see `y-stack-floating.ts`)
 *   - `position.z` = 0 (centered on the length axis)
 *   - `rotation = { x:0, y:0, z:0 }` (axis-aligned)
 *
 * ## User Q1 (prompt-confirmed): beams run along the LENGTH axis.
 *
 * The alternative "beams along WIDTH axis" (matching the elevated
 * beam-layout) is REJECTED — it would produce a beam grid rotated
 * 90° from the user's hand-drawn ~16′ beam example. Flipping this
 * default is a single-file change here.
 *
 * ## Stable ids
 *
 * `beam-{i}` where `i` is the 0-indexed column position from -x
 * (i=0) to +x (i=numBeams-1). Deliberately does NOT reuse the
 * elevated `BEAM_IDS.near / .far` labels — those are 2-beam
 * specific and would be misleading for a floating N-beam grid.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules
 * (types + materials-catalog).
 */

import { lookupMaterial } from '../../materials-catalog';
import type { DeckDesign, LayoutMember } from '../../model';
import type { Mm } from '../../units';

/**
 * Build the floating beams from a block grid.
 *
 * @throws {Error} when `blockGrid` is empty, contains a member with
 *   `kind !== 'block'`, or the beam material triple is not in the
 *   catalog. Wrapped as `LayoutError` by the layout engine.
 */
export function computeFloatingBeams(
  design: DeckDesign,
  blockGrid: readonly LayoutMember[],
): readonly LayoutMember[] {
  validateBlockGrid(blockGrid);

  const beamMat = lookupMaterial(
    design.beam.material.nominal,
    design.beam.material.species,
    design.beam.material.grade,
  );
  const thicknessMm = beamMat.actual.widthMm; // extent on +x
  const depthMm = beamMat.actual.heightMm; // extent on +y (on-edge)
  const lengthMm: Mm = design.footprint.lengthMm;

  // Beam CENTER x = block column CENTER x. The block grid may have
  // blocks in row-major order; project down to the unique x-values
  // and sort ascending so `beam-{i}` ids run from -x to +x.
  const columnXs = uniqueSorted(blockGrid.map((b) => b.position.x));

  const yCenter = depthMm / 2; // beam bottom at y=0

  return columnXs.map<LayoutMember>((x, i) => ({
    id: `beam-${i}`,
    kind: 'beam',
    material: { kind: 'lumber', ...design.beam.material },
    position: { x, y: yCenter, z: 0 },
    size: { x: thicknessMm, y: depthMm, z: lengthMm },
    rotation: { x: 0, y: 0, z: 0 },
  }));
}

/**
 * Trust-boundary defensive check. The caller (the floating-layout
 * orchestrator) is trusted, BUT a defensive throw here catches a
 * future refactor that passes the wrong array (e.g. `[]`, or a
 * mixed-kind array). Silent failure would produce an empty beam
 * list → no beams → the AC1 zero-post-and-footing / at-least-one-
 * beam invariant would be violated with no surfaced error.
 */
function validateBlockGrid(blockGrid: readonly LayoutMember[]): void {
  if (blockGrid.length === 0) {
    throw new Error(
      `computeFloatingBeams: block grid is empty — no beams derivable. ` +
        `A floating deck MUST have at least one block (per AC1). ` +
        `Check that the caller ran computeBlockGrid before invoking this helper.`,
    );
  }
  for (const m of blockGrid) {
    if (m.kind !== 'block') {
      throw new Error(
        `computeFloatingBeams: block grid contains a non-'block' member ` +
          `(id=${JSON.stringify(m.id)}, kind=${JSON.stringify(m.kind)}). ` +
          `Only block members are valid inputs to this helper.`,
      );
    }
  }
}

/**
 * De-duplicate a numeric list and sort ascending. Used to project
 * the block grid down to its unique x-column set. `Set` alone would
 * preserve insertion order (which happens to be row-major grid
 * order — coincidentally sorted); the explicit sort makes the
 * assertion "beam-0 is the smallest-x beam" independent of the
 * block-grid producer's iteration order.
 *
 * NOTE: float-equality via `Set` is fine here — every block in the
 * grid was placed by `computeBlockGrid` with the SAME derived x
 * value per column (`-widthMm/2 + col * step`), so identical
 * columns have byte-equal x. If a future refactor injects a
 * per-block x jitter this de-dup will over-count columns — a future
 * bug we accept until it manifests.
 */
function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
