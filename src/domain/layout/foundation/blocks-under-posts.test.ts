/**
 * `src/domain/layout/foundation/blocks-under-posts.test.ts` — TDD
 * RED phase for the elevated + deck-blocks foundation adaptation
 * (S20 — AC3, AC4).
 *
 * ## What the module produces
 *
 * `computeBlocksUnderPosts({posts, product})` returns a flat
 * `readonly LayoutMember[]` where each block:
 *
 *   - has `kind === 'block'`
 *   - carries `material === {kind: 'block', productId: <product.productId>}`
 *   - sits on grade for an ELEVATED deck: `position.y ===
 *     product.actual.heightMm / 2` (block BOTTOM at y=0, block CENTER
 *     half-way up the block, block TOP at y=heightMm — ABOVE grade).
 *     Contrast with the FLOATING pipeline (`floating/block-grid.ts`)
 *     where the block extends INTO -y — different mental model.
 *   - is CENTERED under its parent post (`position.x` and `position.z`
 *     match the post's).
 *   - has `size = {x: product.widthMm, y: product.heightMm, z:
 *     product.depthMm}` — full product actual dimensions.
 *   - has all-zero `rotation`.
 *
 * Emitting one block per post is the AC1 invariant that ties block
 * count to post count exactly.
 */
import { describe, expect, it } from 'vitest';

import { lookupFoundationProduct } from '../../foundation-catalog';
import type { LayoutMember } from '../../model';

import { computeBlocksUnderPosts } from './blocks-under-posts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const OLDCASTLE = lookupFoundationProduct('oldcastle-11x11x7');

/**
 * Build a synthetic post `LayoutMember` at the given `(x, z)` with a
 * plausible elevated-deck y (post CENTER above the block TOP). The
 * fixture's y is intentionally NOT read by `computeBlocksUnderPosts`
 * (the block y is derived from `product`, not from the post) — the
 * ONLY properties the function should consume are `position.x`,
 * `position.z`, and `id` (for block id derivation).
 */
function makePost(id: string, x: number, z: number): LayoutMember {
  return {
    id,
    kind: 'post',
    material: { kind: 'lumber', nominal: '6x6', species: 'PT', grade: 'No2' },
    position: { x, y: 500, z },
    size: { x: 140, y: 800, z: 140 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

// ---------------------------------------------------------------------------
// AC1 — one block per post
// ---------------------------------------------------------------------------

describe('computeBlocksUnderPosts — AC1 one block per post', () => {
  it('returns exactly one block for each post in the input', () => {
    const posts: readonly LayoutMember[] = [
      makePost('post-near-0', -1500, -900),
      makePost('post-near-1', 0, -900),
      makePost('post-near-2', 1500, -900),
      makePost('post-far-0', -1500, 900),
      makePost('post-far-1', 0, 900),
      makePost('post-far-2', 1500, 900),
    ];
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    expect(blocks).toHaveLength(posts.length);
  });

  it('returns an empty array when given no posts', () => {
    const blocks = computeBlocksUnderPosts({ posts: [], product: OLDCASTLE });
    expect(blocks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC3 — block dimensions mirror the catalog product actual dims
// ---------------------------------------------------------------------------

describe('computeBlocksUnderPosts — AC3 block dimensions', () => {
  it('Oldcastle 11×11×7 → size = 279 × 178 × 279 mm', () => {
    // AC3 (ticket wording): size.x=widthMm, size.y=heightMm, size.z=depthMm.
    // Oldcastle: 11″ × 11″ × 7″ → 279 mm × 279 mm × 178 mm (see
    // foundation-catalog.ts `inToMm` — 11″ rounds to 279, 7″ rounds
    // to 178).
    const posts = [makePost('post-near-0', -1500, -900)];
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    for (const b of blocks) {
      expect(b.size.x).toBe(279);
      expect(b.size.y).toBe(178);
      expect(b.size.z).toBe(279);
    }
  });

  it('size mirrors product.actual exactly (parametric — no hard-coded numbers)', () => {
    // Regression guard: if a future catalog revision changes the
    // dimensions, this test refreshes against the catalog rather than
    // holding the old numbers.
    const posts = [makePost('post-near-0', 0, 0)];
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    for (const b of blocks) {
      expect(b.size.x).toBe(OLDCASTLE.actual.widthMm);
      expect(b.size.y).toBe(OLDCASTLE.actual.heightMm);
      expect(b.size.z).toBe(OLDCASTLE.actual.depthMm);
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 — block centered under post, y = heightMm / 2 (block on grade)
// ---------------------------------------------------------------------------

describe('computeBlocksUnderPosts — AC4 block placement', () => {
  it('each block position.x and position.z match its parent post exactly', () => {
    const posts: readonly LayoutMember[] = [
      makePost('post-near-0', -1500.5, -900.25),
      makePost('post-near-1', 0.75, -900.25),
      makePost('post-far-0', -1500.5, 900.25),
    ];
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    for (let i = 0; i < posts.length; i++) {
      expect(blocks[i]!.position.x).toBe(posts[i]!.position.x);
      expect(blocks[i]!.position.z).toBe(posts[i]!.position.z);
    }
  });

  it('every block position.y equals product.actual.heightMm / 2 (block on grade at y=0)', () => {
    // AC4: block BOTTOM at y=0 (on grade), CENTER at y=heightMm/2,
    // TOP at y=heightMm. For Oldcastle heightMm=178 → center y=89.
    const posts = [
      makePost('post-a', -1500, -900),
      makePost('post-b', 1500, 900),
    ];
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    const expectedY = OLDCASTLE.actual.heightMm / 2;
    for (const b of blocks) {
      expect(b.position.y).toBe(expectedY);
    }
    // Sanity: at product Oldcastle 178 mm, expectedY = 89.
    expect(expectedY).toBe(89);
  });

  it('block y is ABOVE grade (positive) — contrast with the floating pipeline (negative y)', () => {
    // Elevated + deck-blocks: block sits ON grade. Floating: block
    // sits INTO grade (`floating/block-grid.ts` uses
    // `-heightMm/2`). This test locks in the sign for elevated so a
    // future refactor doesn't accidentally unify the two models.
    const posts = [makePost('post-x', 0, 0)];
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    expect(blocks[0]!.position.y).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// LayoutMember shape — material stamp, rotation, ids
// ---------------------------------------------------------------------------

describe('computeBlocksUnderPosts — LayoutMember shape', () => {
  const posts: readonly LayoutMember[] = [
    makePost('post-near-0', -1500, -900),
    makePost('post-far-0', -1500, 900),
  ];

  it('every block has kind="block"', () => {
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    for (const b of blocks) {
      expect(b.kind).toBe('block');
    }
  });

  it('every block has a {kind:"block", productId} material — NO lumber stamp', () => {
    // The historical @todo S14/BOM debt (footings carrying a lumber
    // triple) does NOT extend to blocks — blocks carry a real block
    // material tag so BOM / scene can dispatch on material.kind
    // without extra special-casing.
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    for (const b of blocks) {
      expect(b.material.kind).toBe('block');
      if (b.material.kind === 'block') {
        expect(b.material.productId).toBe('oldcastle-11x11x7');
      }
    }
  });

  it('every block has all-zero rotation (axis-aligned)', () => {
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    for (const b of blocks) {
      expect(b.rotation).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('block ids are unique, stable, and derived from the parent post id', () => {
    const blocks = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The public contract: block id is deterministic per input.
    // Concrete pattern: `block-<beamLabel>-<index>` (mirrors the
    // `footing-<beamLabel>-<index>` naming for symmetry — see
    // post-layout.ts `layoutPostsAndFootings`).
    for (const id of ids) {
      expect(id).toMatch(/^block-(near|far)-\d+$/);
    }
    // Byte-for-byte determinism — two calls yield identical arrays.
    const again = computeBlocksUnderPosts({ posts, product: OLDCASTLE });
    expect(again).toEqual(blocks);
  });
});
