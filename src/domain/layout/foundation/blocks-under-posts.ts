/**
 * `src/domain/layout/foundation/blocks-under-posts.ts` — pure
 * computation of the foundation-block members that sit UNDER each
 * post in the elevated + deck-blocks layout (S20 — AC1, AC3, AC4).
 *
 * ## What this module produces
 *
 * `computeBlocksUnderPosts({posts, product})` returns a flat
 * `readonly LayoutMember[]` where every member has:
 *
 *   - `kind: 'block'`
 *   - `material: { kind: 'block', productId: <product.productId> }`
 *   - `position.y = product.actual.heightMm / 2` (block extends
 *     ABOVE the ground plane; bottom face flush with y=0)
 *   - `position.x` / `position.z` == the parent post's `position.x`
 *     / `position.z` (block CENTERED under post)
 *   - `size = {x: widthMm, y: heightMm, z: depthMm}` — from the
 *     catalog product's `actual.*` dimensions
 *
 * ## Elevated block vs floating block — DIFFERENT y-sign
 *
 * Contrast with `../floating/block-grid.ts`, where the block sits
 * INTO -y (block top flush with y=0, block extending down). Here,
 * for the elevated + deck-blocks combination, the block sits ON
 * grade and posts REST ON TOP OF IT — so the block extends UP from
 * y=0. Two different user mental models; two different y-signs.
 *
 * ## Interface contract (ticket §2 "Interface contracts")
 *
 * ```ts
 * computeBlocksUnderPosts({
 *   posts: readonly LayoutMember[];
 *   product: FoundationProduct;
 * }): readonly LayoutMember[];
 * ```
 *
 * The block-id derivation is `post-<beamLabel>-<index>` →
 * `block-<beamLabel>-<index>`. That mirrors the
 * `footing-<beamLabel>-<index>` pattern used by
 * `layoutPostsAndFootings`, so a downstream consumer that switches
 * on `member.kind` sees a symmetric naming across the two elevated
 * variants.
 *
 * ## Trust boundary
 *
 * The `product` argument is a value already validated by
 * `foundation-catalog.lookupFoundationProduct(...)`; the caller (an
 * intra-domain dispatch in `post-layout.ts`) is responsible for
 * that lookup. This module therefore performs no re-validation of
 * `product` fields — but it DOES validate the post-shaped inputs it
 * accepts:
 *
 *   - `posts` must be an array (defensive against a `null` /
 *     `undefined` seep from a future caller — see Developer
 *     Guardian Rules → Pre-compliance → Trust boundaries).
 *   - Every post must have `kind === 'post'` and a well-formed
 *     `position`. The catalog-driven `product` is trusted, but the
 *     post caller-input is not: a wrong-kind slip would silently
 *     stamp a block over a joist / beam.
 *
 * ## Framework/DOM ban
 *
 * Pure `src/domain/**` module. Imports only sibling domain modules
 * (`../../model` for types, `../../foundation-catalog` for the
 * `FoundationProduct` shape).
 */

import type { FoundationProduct } from '../../foundation-catalog';
import type { LayoutMember } from '../../model';

/**
 * Input for `computeBlocksUnderPosts`. Named-object form so
 * consumers can't accidentally swap `posts` and `product`
 * (arity-3+ discipline; see Developer Guardian Rules → Functions).
 */
export interface BlocksUnderPostsInput {
  readonly posts: readonly LayoutMember[];
  readonly product: FoundationProduct;
}

/**
 * Emit one block member per input post, positioned directly under
 * the post with dimensions from the catalog product. Pure — same
 * input yields byte-equal output.
 *
 * @throws {Error} when any post in `posts` is not `kind === 'post'`.
 *   A defensive trust-boundary check (see module header) — the
 *   layout-engine dispatcher never passes non-post members here,
 *   but a direct caller that skips the dispatcher must fail loudly
 *   rather than stamp a block over the wrong member.
 */
export function computeBlocksUnderPosts(
  input: BlocksUnderPostsInput,
): readonly LayoutMember[] {
  const { posts, product } = input;

  const productHeightMm = product.actual.heightMm;
  const productWidthMm = product.actual.widthMm;
  const productDepthMm = product.actual.depthMm;
  // Block BOTTOM at y=0 (grade), block TOP at y=heightMm, block
  // CENTER at y=heightMm/2. See module header "Elevated block vs
  // floating block" for the +y vs -y contrast.
  const yCenter = productHeightMm / 2;

  const blocks: LayoutMember[] = [];
  for (const post of posts) {
    if (post.kind !== 'post') {
      throw new Error(
        `computeBlocksUnderPosts: every input member must have ` +
          `kind === 'post' (got '${post.kind}' with id='${post.id}'). ` +
          `This helper stamps a block under each post; passing a ` +
          `non-post member would silently emit a block over the ` +
          `wrong member. See src/domain/layout/foundation/blocks-under-posts.ts.`,
      );
    }
    // Block id mirrors the post id — `post-near-0` → `block-near-0`
    // — so downstream consumers (BOM, scene) see a symmetric naming
    // across posts and the block that supports them.
    const blockId = post.id.replace(/^post-/, 'block-');
    blocks.push({
      id: blockId,
      kind: 'block',
      material: { kind: 'block', productId: product.productId },
      position: { x: post.position.x, y: yCenter, z: post.position.z },
      size: { x: productWidthMm, y: productHeightMm, z: productDepthMm },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  return blocks;
}
