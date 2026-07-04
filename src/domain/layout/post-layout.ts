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
 * ## Footings — MVP placeholder material (concrete, not lumber!)
 *
 * One footing per post, centered directly under it (same x and z). The
 * footing is a `FOOTING_WIDTH_MM × FOOTING_DEPTH_MM × FOOTING_WIDTH_MM`
 * concrete cube with its TOP at y=0 (ground plane) and its BOTTOM at
 * y = −FOOTING_DEPTH_MM. Real footings key on frost-line data; MVP
 * uses a fixed cube for visualization.
 *
 * **MVP simplification — the footing member carries the post
 * `MaterialRef` (read from `design.foundation.post`, the single
 * source of truth per review-gate FIX 2) as its `material` field
 * (which is a lumber ref like `6x6 PT No2`), even though the
 * physical member is CONCRETE, not lumber.** This is a conscious
 * placeholder so the S4 render contract stays uniform (every
 * `LayoutMember` has a `material: MemberMaterialRef`) without S4
 * having to invent a `Concrete` catalog entry.
 *
 * @todo S14/BOM: footings are concrete, not lumber. The bill-of-materials
 *       story MUST special-case `kind === 'footing'` and NOT count it as
 *       6×6 lumber — instead compute concrete volume from
 *       `FOOTING_WIDTH_MM × FOOTING_DEPTH_MM × FOOTING_WIDTH_MM` per
 *       footing and roll up to a "concrete piers" line item. See the
 *       inline comment where `design.foundation.post` is assigned to the
 *       footing below.
 */

import { MM_PER_FOOT, type Mm } from '../units';
import { lookupFoundationProduct, type FoundationProduct } from '../foundation-catalog';
import { hasMaterial, lookupMaterial } from '../materials-catalog';
import type { DeckDesign, LayoutMember, MaterialRef } from '../model';

import { BEAM_IDS, beamLabelForId, type BeamLabel } from './beam-layout';
import { computeBlocksUnderPosts } from './foundation/blocks-under-posts';
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
  // Review-gate FIX 2 — `foundation.post` is the SINGLE source of
  // truth for the post material (the pre-S17 top-level `design.post`
  // field was removed to eliminate a dual-SoT drift bug — see
  // `model.ts` FoundationSpec doc). `layoutPostsAndFootings` is
  // invoked ONLY from the elevated + posts-on-footings dispatch
  // branch in `layout-engine.ts`, so the discriminant MUST be
  // 'posts-on-footings' here. A defensive throw naming the module
  // catches a future call site that skipped the compat gate.
  if (design.foundation.type !== 'posts-on-footings') {
    throw new Error(
      `layoutPostsAndFootings: expected foundation.type === 'posts-on-footings', ` +
        `got '${design.foundation.type}'. This function is only valid for the ` +
        `elevated / posts-on-footings dispatch branch of computeLayout. ` +
        `See src/domain/layout/post-layout.ts, src/domain/layout/layout-engine.ts, ` +
        `and Epic 2 / S19/S20.`,
    );
  }
  const postMaterialRef = design.foundation.post;
  const postMat = lookupMaterial(
    postMaterialRef.nominal,
    postMaterialRef.species,
    postMaterialRef.grade,
  );
  const postThicknessX = postMat.actual.widthMm; // 6×6 post: 140 mm on x
  const postThicknessZ = postMat.actual.heightMm; // 6×6 post: 140 mm on z (square posts)

  const stack = computeYStack(design);
  const postsPerBeam = computePostsPerBeam(design.footprint.widthMm);
  const xCenters = computePostXCenters(design.footprint.widthMm, postsPerBeam);

  const posts: LayoutMember[] = [];
  const footings: LayoutMember[] = [];

  for (const beam of beams) {
    const beamLabel = beamLabelForId(beam.id);
    if (beamLabel === null) {
      // Defensive: the only supported beam ids are BEAM_IDS.near/far.
      // If we ever add intermediate beams, this branch will fire loudly
      // instead of silently producing `post-unknown-*` ids.
      throw new Error(
        `layoutPostsAndFootings: unrecognized beam id ${JSON.stringify(beam.id)} — ` +
          `expected one of ${JSON.stringify(Object.values(BEAM_IDS))}.`,
      );
    }
    for (let i = 0; i < postsPerBeam; i++) {
      const x = xCenters[i]!;
      const z = beam.position.z;
      posts.push({
        id: `post-${beamLabel}-${i}`,
        kind: 'post',
        // S17: stamp the lumber variant of the widened MemberMaterialRef.
        material: { kind: 'lumber', ...postMaterialRef },
        position: { x, y: stack.postCenterY, z },
        size: { x: postThicknessX, y: stack.postHeightMm, z: postThicknessZ },
        rotation: { x: 0, y: 0, z: 0 },
      });
      footings.push({
        id: `footing-${beamLabel}-${i}`,
        kind: 'footing',
        // MVP placeholder: footings are CONCRETE, but the LayoutMember
        // schema requires a material ref. We reuse the post lumber ref
        // here purely so the render contract stays uniform. The BOM
        // story (S14) MUST special-case kind==='footing' and NOT count
        // this as lumber — see the module header TODO(S14/BOM).
        material: { kind: 'lumber', ...postMaterialRef },
        position: { x, y: stack.footingCenterY, z },
        size: { x: FOOTING_WIDTH_MM, y: FOOTING_DEPTH_MM, z: FOOTING_WIDTH_MM },
        rotation: { x: 0, y: 0, z: 0 },
      });
    }
  }

  return { posts, footings };
}

// ---------------------------------------------------------------------------
// S20 — elevated + deck-blocks variant
// ---------------------------------------------------------------------------

/**
 * Derive a STOCKED post `MaterialRef` for the elevated + deck-blocks
 * variant (S20 review-gate FIX 1).
 *
 * ## Contract
 *
 * The `deck-blocks` variant of `FoundationSpec` has no explicit
 * `post` field (see `model.ts` FoundationSpec doc — that field only
 * exists on the `posts-on-footings` variant). We derive the post
 * material from two inputs:
 *
 *   1. **Nominal** — always `product.acceptsPost[0]`. The block's
 *      center pocket dictates the post's cross-section. For the MVP
 *      Oldcastle block this is `'4x4'`. A block with `acceptsPost`
 *      null or empty is not compatible with elevated construction
 *      and MUST be rejected earlier by the FR-030 compat matrix;
 *      this helper does not defend against that case (the caller
 *      does).
 *   2. **Species / grade** — the beam's species/grade IF that
 *      triple is stocked for the post nominal. Otherwise fall back
 *      to `PT No2` — the most common stocked post material.
 *
 * ## Why the fallback exists (FIX 1)
 *
 * The MVP catalog explicitly excludes composite posts (see
 * `materials-catalog.ts` MVP_SPECS: "Post sizes — PT and Cedar only"
 * comment). A valid FR-030 combination — Composite decking / beam
 * / joist on a deck-block foundation — has no matching stocked
 * post SKU. Pre-FIX-1 the naive derivation produced
 * `{'4x4', 'Composite', 'NA'}` and `lookupMaterial` threw
 * `Unknown material`, so the deck failed to lay out for a
 * compat-matrix-legal combination.
 *
 * `PT No2` is a safe default: pressure-treated posts are the
 * default homeowner-deck choice and the species is stocked for
 * every post nominal in the catalog. The user can override the
 * default at a per-design level in a follow-up ticket (see the
 * Epic 2 amendment note in `specs/mvp-deck-designer/spec.md`).
 *
 * ## Purity
 *
 * This helper is a pure function of its inputs — no I/O, no clock,
 * no globals. Deterministic and safe to call any number of times.
 */
export function deriveStockedPostMaterial(
  product: FoundationProduct,
  beamMaterial: MaterialRef,
): MaterialRef {
  const acceptsPost = product.acceptsPost;
  if (acceptsPost === null || acceptsPost.length === 0) {
    // Caller-contract violation — the FR-030 compat matrix should
    // have rejected an elevated pairing with a post-less block
    // (tuffblocks, or a future product with no pocket). We fail
    // loudly rather than silently returning a PT No2 default.
    throw new Error(
      `deriveStockedPostMaterial: foundation product '${product.productId}' has ` +
        `no acceptsPost pocket. This helper is only valid for elevated + ` +
        `deck-blocks combinations where the block has a post pocket; the ` +
        `FR-030 compat matrix should reject this pairing earlier. See ` +
        `src/domain/compat-matrix.ts.`,
    );
  }
  const nominal = acceptsPost[0]!;
  if (hasMaterial(nominal, beamMaterial.species, beamMaterial.grade)) {
    return {
      nominal,
      species: beamMaterial.species,
      grade: beamMaterial.grade,
    };
  }
  // FIX 1 fallback — PT No2 is guaranteed stocked for every post
  // nominal (see materials-catalog.ts MVP_SPECS). If the fallback
  // itself is ever missing, that is an invariant violation and
  // `lookupMaterial` at the call site will fail loudly.
  return { nominal, species: 'PT', grade: 'No2' };
}

/**
 * Return shape for the elevated + deck-blocks post-layout entry
 * point. Same posts-first-then-foundation-members shape as
 * `PostAndFootingResult`, but the foundation members are `block`s
 * (concrete deck-block products from `foundation-catalog.ts`)
 * instead of the pre-Epic-2 `footing`s.
 *
 * The type is DIFFERENT — an `.blocks` field, not `.footings` —
 * because a mistaken caller that expected `footings` would
 * fail-compile against this result rather than silently receive an
 * empty array.
 */
export interface PostAndBlockResult {
  readonly posts: LayoutMember[];
  readonly blocks: LayoutMember[];
}

/**
 * Emit the posts + foundation blocks for an ELEVATED deck resting
 * on precast deck-blocks (S20 — AC1, AC3, AC4, AC5).
 *
 * ## Contract vs. `layoutPostsAndFootings`
 *
 * Same beam-iteration + x-anchor logic as the posts-on-footings
 * path (see `computePostsPerBeam` / `computePostXCenters` module
 * header). The two differences:
 *
 *   1. Post `position.y` is re-anchored so the post BOTTOM sits on
 *      the block TOP (`post.position.y = blockHeightMm + postHeight
 *      / 2`), and post `size.y` shrinks by exactly `blockHeightMm`
 *      — the space the block now occupies used to be part of the
 *      post (AC5).
 *   2. The foundation members are `block`s carrying a real
 *      `{kind: 'block', productId}` material (via
 *      `computeBlocksUnderPosts`) — NOT the lumber-placeholder
 *      stamp used by the historical footing path.
 *
 * `layoutPostsAndFootings` is invoked from a different dispatch
 * branch and must stay byte-identical (AC2 — SC-004 golden). This
 * function is invoked ONLY from the elevated + deck-blocks branch
 * of `computeLayout`.
 *
 * @throws {Error} when `design.foundation.type !== 'deck-blocks'`.
 *   Defensive caller-contract check — mirrors the guard on
 *   `layoutPostsAndFootings`.
 * @throws {Error} when the foundation product id is not in the
 *   catalog (re-thrown from `lookupFoundationProduct`).
 */
export function layoutPostsAndBlocks(
  design: DeckDesign,
  beams: readonly LayoutMember[],
): PostAndBlockResult {
  if (design.foundation.type !== 'deck-blocks') {
    throw new Error(
      `layoutPostsAndBlocks: expected foundation.type === 'deck-blocks', ` +
        `got '${design.foundation.type}'. This function is only valid for the ` +
        `elevated / deck-blocks dispatch branch of computeLayout. ` +
        `See src/domain/layout/post-layout.ts, src/domain/layout/layout-engine.ts, ` +
        `and Epic 2 / S20.`,
    );
  }

  // Look up the foundation block product FIRST — every downstream
  // step (post material derivation via `acceptsPost`, y-anchor
  // adjustment via `heightMm`, block emission) depends on it.
  const product = lookupFoundationProduct(design.foundation.product.productId);
  const blockHeightMm = product.actual.heightMm;

  // ---- Post material derivation (S20 autonomous decision, FIX 1) -------
  //
  // Delegated to the pure `deriveStockedPostMaterial` helper above.
  // The helper picks the block's first accepted post nominal, then
  // borrows the beam's species/grade IF that combination is stocked;
  // otherwise it falls back to PT No2. See the helper doc for the
  // rationale.
  //
  // Reversible when a follow-up ticket surfaces a per-design post
  // material for the deck-blocks foundation variant (spec change +
  // S18 persistence migration). Documented in the handoff table.
  const postMaterialRef = deriveStockedPostMaterial(product, design.beam.material);
  const postMat = lookupMaterial(
    postMaterialRef.nominal,
    postMaterialRef.species,
    postMaterialRef.grade,
  );
  const postThicknessX = postMat.actual.widthMm; // e.g. 4×4 post: 89 mm on x
  const postThicknessZ = postMat.actual.heightMm; // e.g. 4×4 post: 89 mm on z (square posts)

  // Beam-bottom y = same as posts-on-footings (foundation type does
  // NOT change the height of decking / joist / beam — only where
  // the post starts). `computeYStack` treats `postCenterY /
  // postHeightMm` as if the post rested on grade; we override those
  // fields locally for the block-adjusted post.
  const stack = computeYStack(design);
  const postBottomY = blockHeightMm; // post rests on block TOP
  const postTopY = stack.beamBottomY;
  const postHeightMm = postTopY - postBottomY;
  const postCenterY = postBottomY + postHeightMm / 2;

  const postsPerBeam = computePostsPerBeam(design.footprint.widthMm);
  const xCenters = computePostXCenters(design.footprint.widthMm, postsPerBeam);

  const posts: LayoutMember[] = [];

  for (const beam of beams) {
    const beamLabel = beamLabelForId(beam.id);
    if (beamLabel === null) {
      throw new Error(
        `layoutPostsAndBlocks: unrecognized beam id ${JSON.stringify(beam.id)} — ` +
          `expected one of ${JSON.stringify(Object.values(BEAM_IDS))}.`,
      );
    }
    for (let i = 0; i < postsPerBeam; i++) {
      const x = xCenters[i]!;
      const z = beam.position.z;
      posts.push({
        id: `post-${beamLabel}-${i}`,
        kind: 'post',
        material: { kind: 'lumber', ...postMaterialRef },
        position: { x, y: postCenterY, z },
        size: { x: postThicknessX, y: postHeightMm, z: postThicknessZ },
        rotation: { x: 0, y: 0, z: 0 },
      });
    }
  }

  // Delegate block emission to the pure foundation helper — one
  // block per post, centered under. Coupling stays low (this
  // function only produces `posts`; `computeBlocksUnderPosts` does
  // block geometry) and the block-id derivation stays in one place.
  const blocks = [...computeBlocksUnderPosts({ posts, product })];

  return { posts, blocks };
}

function computePostsPerBeam(widthMm: Mm): number {
  // A beam always needs at least two end supports; `Math.max(2, …)`
  // guards against widths so small that `ceil(widthMm / MAX_BEAM_SPAN_MM)`
  // rounds to 0 (impossible under the MIN_DECK_DIMENSION_MM validator
  // in layout-engine.ts, but kept as a belt-and-braces).
  const raw = Math.ceil(widthMm / MAX_BEAM_SPAN_MM) + 1;
  return Math.max(2, raw);
}

function computePostXCenters(widthMm: Mm, count: number): number[] {
  // MIN_DECK_DIMENSION_MM (4 ft, enforced in layout-engine.ts) guarantees
  // `count >= 2` via `computePostsPerBeam`. We assert defensively so an
  // erroneous internal caller trips loudly instead of returning a
  // degenerate 1-post layout.
  if (count < 2) {
    throw new Error(
      `computePostXCenters: count must be >= 2 (got ${count}) — ` +
        `caller violated MIN_DECK_DIMENSION_MM invariant.`,
    );
  }
  // Posts inset from the footprint x-edges by FOOTING_WIDTH_MM/2 so the
  // corner footings (larger than posts) fit entirely inside `bounds`.
  const halfInnerX = -widthMm / 2 + FOOTING_WIDTH_MM / 2;
  const usable = widthMm - FOOTING_WIDTH_MM;
  const step = usable / (count - 1);
  const centers: number[] = [];
  for (let i = 0; i < count; i++) {
    centers.push(halfInnerX + i * step);
  }
  return centers;
}

// (beamLabelFromId helper removed — replaced by the imported
// `beamLabelForId` from beam-layout.ts, which uses the shared
// `BEAM_IDS` constant. Re-exported here for backwards compatibility.)
export { beamLabelForId, BEAM_IDS, type BeamLabel };
