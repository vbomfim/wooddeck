/**
 * `src/domain/layout/post-layout.ts` — position the posts that carry
 * the two beams AND the footings that carry the posts.
 *
 * ## Post-count formula: physically anchored to the axis the beam RUNS along
 *
 *   postsPerBeam = ceil(deckWidthMm / MAX_BEAM_SPAN_MM) + 1
 *
 * ### Why `widthMm`, not `lengthMm`
 *
 * Beams run along +x (perpendicular to joists, which run along +z —
 * see beam-layout.ts). A beam's own length equals the deck WIDTH. Post
 * spacing along the beam is bounded by the beam's structural span
 * (how far a single beam can safely span between two posts before it
 * sags too much) — that's the `MAX_BEAM_SPAN_MM` cap. Consequently
 * the RELEVANT dimension for post count is the beam's length, i.e. the
 * deck WIDTH.
 *
 * Issue #5 §4 and the pinned correction comment BOTH use
 * `lengthMm` in the formula (`ceil(lengthMm / maxBeamSpanMm) + 1`),
 * which contradicts the corrected coordinate frame where beams run
 * along +x. This implementation uses `widthMm` to keep the formula
 * physically meaningful (a wider deck really does need more posts per
 * beam; a longer deck does not). The autonomous decision is documented
 * in the PR body under "Autonomous decisions".
 *
 * ## `MAX_BEAM_SPAN_MM = 2438` (≈ 8 ft) — the conservative MVP default
 *
 * A conservative one-size-fits-all cap for MVP. Real spans depend on
 * beam ply-count, species, grade, tributary width, and live/dead load —
 * data that lives with S5 (`span-check`). This constant is a placeholder
 * so S4 can ship BEFORE S5 exists (S5 depends on S4). Do not tune it
 * downstream; refine it via a proper span table in S5.
 *
 * @todo S5: refine post spacing from real beam-span tables. The
 *       existing `Layout` shape is stable — S5 only needs to swap
 *       this constant for a per-design lookup.
 *
 * ## Post X-placement (post-count is `postsPerBeam`)
 *
 * With N posts on one beam, they are equally spaced along +x with both
 * end posts inset from the footprint edge by `FOOTING_WIDTH_MM / 2` so
 * the corner footings (300 × 300 mm) fit entirely inside `bounds` on x
 * (AC2). Concretely:
 *
 *   halfInnerX = -widthMm/2 + FOOTING_WIDTH_MM/2
 *   step       = (widthMm - FOOTING_WIDTH_MM) / (postsPerBeam - 1)
 *   post_i.x   = halfInnerX + i * step        for i = 0..postsPerBeam−1
 *
 * The corner posts thus sit `FOOTING_WIDTH_MM/2 - postThickness/2` mm
 * inside the deck edge (typically ~80 mm for a 6×6 post + 300 mm
 * footing). The beam cantilevers by that same distance past the corner
 * posts, matching normal residential-deck construction.
 *
 * ## Post Z-placement
 *
 * Post z matches its parent beam's z (the beam sits on top of the post,
 * center-of-mass over center-of-mass).
 *
 * ## Post height clamping (height-zero edge case)
 *
 * When `footprint.heightMm` is so small that the top-of-deck y is BELOW
 * the sum of decking + joist + beam depths, `postHeightMm` clamps to 0
 * (see `computeYStack`). At height=0 the posts collapse to zero y-extent
 * — the ticket explicitly requires this ("Height = 0 → posts have zero
 * z-extent [read: y-extent in the corrected frame]; footings still
 * placed"). Footings retain their full extent.
 *
 * ## Footings
 *
 * One footing per post, centered directly under it (same x and z). The
 * footing is a `FOOTING_WIDTH_MM × FOOTING_DEPTH_MM × FOOTING_WIDTH_MM`
 * concrete cube with its TOP at y=0 (ground plane) and its BOTTOM at
 * y = −FOOTING_DEPTH_MM. Real footings key on frost-line data; MVP
 * uses a fixed cube for visualization.
 */

import { MM_PER_FOOT, type Mm } from '../units';
import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign, LayoutMember } from '../model';

import { FOOTING_DEPTH_MM, FOOTING_WIDTH_MM, computeYStack } from './y-stack';

// Re-export so callers (and tests) have one canonical import path.
export { FOOTING_DEPTH_MM, FOOTING_WIDTH_MM };

/**
 * Conservative MVP cap on the distance between two adjacent posts on
 * the same beam. Exactly 8 ft (in millimeters — kept unrounded so that
 * nice foot-multiples of the deck width divide evenly, e.g. a 40 ft
 * deck yields 5 bays × 8 ft with no off-by-one from rounding). See
 * module header for the rationale and the S5 replacement plan.
 */
export const MAX_BEAM_SPAN_MM: Mm = 8 * MM_PER_FOOT;

export interface PostAndFootingResult {
  readonly posts: LayoutMember[];
  readonly footings: LayoutMember[];
}

export function layoutPostsAndFootings(
  design: DeckDesign,
  beams: readonly LayoutMember[],
): PostAndFootingResult {
  const postMat = lookupMaterial(
    design.post.material.nominal,
    design.post.material.species,
    design.post.material.grade,
  );
  const postThicknessX = postMat.actual.widthMm; // 6×6 post: 140 mm on x
  const postThicknessZ = postMat.actual.heightMm; // 6×6 post: 140 mm on z (square posts)

  const stack = computeYStack(design);
  const postsPerBeam = computePostsPerBeam(design.footprint.widthMm);
  const xCenters = computePostXCenters(design.footprint.widthMm, postsPerBeam);

  const posts: LayoutMember[] = [];
  const footings: LayoutMember[] = [];

  for (const beam of beams) {
    const beamLabel = beamLabelFromId(beam.id);
    for (let i = 0; i < postsPerBeam; i++) {
      const x = xCenters[i]!;
      const z = beam.position.z;
      posts.push({
        id: `post-${beamLabel}-${i}`,
        kind: 'post',
        material: design.post.material,
        position: { x, y: stack.postCenterY, z },
        size: { x: postThicknessX, y: stack.postHeightMm, z: postThicknessZ },
        rotation: { x: 0, y: 0, z: 0 },
      });
      footings.push({
        id: `footing-${beamLabel}-${i}`,
        kind: 'footing',
        material: design.post.material,
        position: { x, y: stack.footingCenterY, z },
        size: { x: FOOTING_WIDTH_MM, y: FOOTING_DEPTH_MM, z: FOOTING_WIDTH_MM },
        rotation: { x: 0, y: 0, z: 0 },
      });
    }
  }

  return { posts, footings };
}

function computePostsPerBeam(widthMm: Mm): number {
  // Guard against the pathological "widthMm exactly 0" — the layout
  // engine's LayoutError check should have already rejected it, but
  // defensive: never return < 2 posts (a beam always needs at least
  // two end supports).
  const raw = Math.ceil(widthMm / MAX_BEAM_SPAN_MM) + 1;
  return Math.max(2, raw);
}

function computePostXCenters(widthMm: Mm, count: number): number[] {
  // Posts inset from the footprint x-edges by FOOTING_WIDTH_MM/2 so the
  // corner footings (larger than posts) fit entirely inside `bounds`.
  // With `count === 1` (impossible for a real beam but kept for safety)
  // the single post sits at x=0.
  if (count <= 1) return [0];
  const halfInnerX = -widthMm / 2 + FOOTING_WIDTH_MM / 2;
  const usable = widthMm - FOOTING_WIDTH_MM;
  const step = usable / (count - 1);
  const centers: number[] = [];
  for (let i = 0; i < count; i++) {
    centers.push(halfInnerX + i * step);
  }
  return centers;
}

/**
 * Extract the "near" / "far" label from a beam id (`beam-near` /
 * `beam-far`). Keeps post/footing ids readable and stable.
 */
function beamLabelFromId(beamId: string): string {
  const suffix = beamId.replace(/^beam-/, '');
  return suffix || 'unknown';
}
