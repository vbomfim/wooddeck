/**
 * Unit tests for `src/domain/layout/post-layout.ts` — TDD RED phase.
 *
 * MVP conventions covered:
 *   - Post count per beam = `ceil(widthMm / MAX_BEAM_SPAN_MM) + 1`
 *     (formula scoped to the axis the beam RUNS along; ticket's literal
 *     `lengthMm` is inconsistent with beams running perpendicular to
 *     joists along +x — see post-layout.ts header for the reconciliation).
 *   - `MAX_BEAM_SPAN_MM = 2438` (~8 ft) conservative residential default.
 *   - One footing per post, centered directly under the post at ground level.
 *   - Post height = beamBottomY, no clamping (Fix B: validateDesign at
 *     the engine layer ensures the beam bottom stays above ground plane).
 */
import { describe, expect, it } from 'vitest';

import { lookupFoundationProduct } from '../foundation-catalog';
import { MM_PER_FOOT } from '../units';
import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign, FoundationSpec, LayoutMember } from '../model';

import { layoutBeams } from './beam-layout';
import { MIN_POST_HEIGHT_MM } from './y-stack';
import { computeMinStructuralHeightMm } from './layout-engine';
import {
  FOOTING_DEPTH_MM,
  FOOTING_WIDTH_MM,
  MAX_BEAM_SPAN_MM,
  layoutPostsAndBlocks,
  layoutPostsAndFootings,
} from './post-layout';

function makeDesign(overrides: Partial<{
  widthMm: number;
  lengthMm: number;
  heightMm: number;
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    createdAt: '2026-07-02T00:00:00.000Z',
    footprint: {
      widthMm: overrides.widthMm ?? 3660,
      lengthMm: overrides.lengthMm ?? 4880,
      heightMm: overrides.heightMm ?? 914,
    },
    structure: 'elevated',
    foundation: {
      type: 'posts-on-footings',
      post: { nominal: '6x6', species: 'PT', grade: 'No2' },
      footing: { widthMm: 300, depthMm: 300 },
    },
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: 406,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

function callWithBeams(design: DeckDesign): {
  posts: LayoutMember[];
  footings: LayoutMember[];
} {
  const beams = layoutBeams(design);
  return layoutPostsAndFootings(design, beams);
}

describe('post-layout — constants', () => {
  it('MAX_BEAM_SPAN_MM is documented as an 8-ft conservative default (unrounded)', () => {
    // Kept unrounded so nice-foot deck widths divide evenly (see post-layout.ts header).
    expect(MAX_BEAM_SPAN_MM).toBe(8 * MM_PER_FOOT);
  });

  it('FOOTING_WIDTH_MM and FOOTING_DEPTH_MM are positive integers', () => {
    expect(FOOTING_WIDTH_MM).toBeGreaterThan(0);
    expect(FOOTING_DEPTH_MM).toBeGreaterThan(0);
  });
});

describe('post-layout — post count formula per beam', () => {
  it('reference 20 × 30 ft deck: posts per beam = ceil(20ft/8ft)+1 = 4 → 8 posts total', () => {
    // widthMm = 20 * MM_PER_FOOT = 6096; MAX_BEAM_SPAN_MM = 8 * MM_PER_FOOT = 2438.4.
    // 6096 / 2438.4 = 2.5 → ceil = 3 → 3+1 = 4 posts per beam × 2 beams = 8.
    const design = makeDesign({ widthMm: 20 * MM_PER_FOOT, lengthMm: 30 * MM_PER_FOOT });
    const { posts } = callWithBeams(design);
    expect(posts).toHaveLength(8);
  });

  it('minimum 4 ft × 4 ft × 2 ft deck: at least 4 posts (2 per beam × 2 beams)', () => {
    // 2 ft height chosen to satisfy Fix B MIN_STRUCTURAL_HEIGHT_MM (≈520 mm)
    // for the 2x10 PT stack; 1 ft (304.8 mm) would fail engine validation.
    // (post-layout itself does NOT validate, so a direct call with 1 ft
    // would still succeed but produce underground beams — see the
    // dedicated Fix B tests below.)
    const design = makeDesign({
      widthMm: 4 * MM_PER_FOOT,
      lengthMm: 4 * MM_PER_FOOT,
      heightMm: 2 * MM_PER_FOOT,
    });
    const { posts } = callWithBeams(design);
    expect(posts.length).toBeGreaterThanOrEqual(4);
  });

  it('40 × 40 ft deck: posts per beam = ceil(40ft/8ft)+1 = 6 → 12 posts total', () => {
    // 40 * MM_PER_FOOT = 12192 exactly divisible by 8*MM_PER_FOOT = 2438.4 → 5 bays → 6 posts.
    const design = makeDesign({ widthMm: 40 * MM_PER_FOOT, lengthMm: 40 * MM_PER_FOOT });
    const { posts } = callWithBeams(design);
    expect(posts).toHaveLength(12);
  });
});

describe('post-layout — footing count invariant', () => {
  it('exactly one footing per post', () => {
    const design = makeDesign({ widthMm: 20 * MM_PER_FOOT, lengthMm: 30 * MM_PER_FOOT });
    const { posts, footings } = callWithBeams(design);
    expect(footings).toHaveLength(posts.length);
  });

  it('each footing is centered under its post (matching x and z)', () => {
    const design = makeDesign();
    const { posts, footings } = callWithBeams(design);
    // Same insertion order → each pair.
    for (let i = 0; i < posts.length; i++) {
      expect(footings[i]!.position.x).toBeCloseTo(posts[i]!.position.x, 6);
      expect(footings[i]!.position.z).toBeCloseTo(posts[i]!.position.z, 6);
    }
  });
});

describe('post-layout — post geometry', () => {
  it('post size.x and size.z equal the post material dressed dims', () => {
    const design = makeDesign();
    const postMat = lookupMaterial('6x6', 'PT', 'No2');
    const { posts } = callWithBeams(design);
    for (const p of posts) {
      expect(p.size.x).toBe(postMat.actual.widthMm);
      expect(p.size.z).toBe(postMat.actual.heightMm);
    }
  });

  it('post size.y = space between ground (y=0) and beam bottom', () => {
    const design = makeDesign({ heightMm: 914 });
    const deckingMat = lookupMaterial('5/4x6', 'PT', 'No2');
    const joistMat = lookupMaterial('2x10', 'PT', 'No2');
    const beamMat = lookupMaterial('2x10', 'PT', 'No2');
    const expectedPostHeight =
      914 - deckingMat.actual.widthMm - joistMat.actual.heightMm - beamMat.actual.heightMm;
    const { posts } = callWithBeams(design);
    for (const p of posts) {
      expect(p.size.y).toBeCloseTo(expectedPostHeight, 6);
    }
  });

  it('every post is positioned along one of the two beams (z matches beam z)', () => {
    const design = makeDesign();
    const beams = layoutBeams(design);
    const beamZs = new Set(beams.map((b) => b.position.z));
    const { posts } = layoutPostsAndFootings(design, beams);
    for (const p of posts) {
      // Post z must equal exactly one of the two beam z values.
      const zs = Array.from(beamZs);
      expect(zs.some((bz) => Math.abs(bz - p.position.z) < 1e-6)).toBe(true);
    }
  });

  it('posts on the same beam are within [-widthMm/2, +widthMm/2] on x', () => {
    const design = makeDesign({ widthMm: 20 * MM_PER_FOOT });
    const { posts } = callWithBeams(design);
    for (const p of posts) {
      expect(p.position.x).toBeGreaterThanOrEqual(-design.footprint.widthMm / 2);
      expect(p.position.x).toBeLessThanOrEqual(design.footprint.widthMm / 2);
    }
  });

  it('every post has a stable, unique id (post-<beam>-<index>)', () => {
    const { posts } = callWithBeams(makeDesign());
    const ids = posts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^post-(near|far)-\d+$/);
  });
});

describe('post-layout — footing geometry', () => {
  it('footings have fixed size (FOOTING_WIDTH_MM × FOOTING_DEPTH_MM × FOOTING_WIDTH_MM)', () => {
    const design = makeDesign();
    const { footings } = callWithBeams(design);
    for (const f of footings) {
      expect(f.size.x).toBe(FOOTING_WIDTH_MM);
      expect(f.size.y).toBe(FOOTING_DEPTH_MM);
      expect(f.size.z).toBe(FOOTING_WIDTH_MM);
    }
  });

  it('footing top is at y=0 (ground); footings extend into -y', () => {
    const design = makeDesign();
    const { footings } = callWithBeams(design);
    for (const f of footings) {
      // Center y = -depth/2 (top at 0, bottom at -depth).
      expect(f.position.y).toBeCloseTo(-FOOTING_DEPTH_MM / 2, 6);
    }
  });

  it('every footing has a stable, unique id (footing-<beam>-<index>)', () => {
    const { footings } = callWithBeams(makeDesign());
    const ids = footings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^footing-(near|far)-\d+$/);
  });
});

describe('post-layout — height boundary (Fix B / QA-Gap#5)', () => {
  it('at heightMm == MIN_STRUCTURAL_HEIGHT_MM, post.size.y == MIN_POST_HEIGHT_MM exactly', () => {
    const proto = makeDesign();
    const minHeight = computeMinStructuralHeightMm(proto);
    const design = makeDesign({ heightMm: minHeight });
    const { posts } = callWithBeams(design);
    for (const p of posts) {
      expect(p.size.y).toBeCloseTo(MIN_POST_HEIGHT_MM, 6);
    }
  });

  it('just above MIN_STRUCTURAL_HEIGHT_MM, post height grows 1:1 with heightMm', () => {
    const proto = makeDesign();
    const minHeight = computeMinStructuralHeightMm(proto);
    const growth = 137;
    const design = makeDesign({ heightMm: minHeight + growth });
    const { posts } = callWithBeams(design);
    for (const p of posts) {
      expect(p.size.y).toBeCloseTo(MIN_POST_HEIGHT_MM + growth, 6);
    }
  });

  it('at large heightMm (e.g. 3000 mm), posts have size.y ≈ heightMm - full framing stack', () => {
    const heightMm = 3000;
    const design = makeDesign({ heightMm });
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    const joist = lookupMaterial('2x10', 'PT', 'No2');
    const beam = lookupMaterial('2x10', 'PT', 'No2');
    const expected =
      heightMm - decking.actual.widthMm - joist.actual.heightMm - beam.actual.heightMm;
    const { posts } = callWithBeams(design);
    for (const p of posts) {
      expect(p.size.y).toBeCloseTo(expected, 6);
    }
  });

  it('is deterministic — same design + same beams yields deeply-equal arrays', () => {
    const design = makeDesign();
    const beams = layoutBeams(design);
    const a = layoutPostsAndFootings(design, beams);
    const b = layoutPostsAndFootings(design, beams);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// S20 — layoutPostsAndBlocks (elevated + deck-blocks)
// ---------------------------------------------------------------------------
//
// The second post-emitting entry point in this module. It differs from
// `layoutPostsAndFootings` in exactly three places:
//
//   1. It emits `block` members (via
//      `foundation/blocks-under-posts.computeBlocksUnderPosts`)
//      instead of `footing` members.
//   2. Post `position.y` is re-anchored so the post BOTTOM sits on
//      the block TOP (`post.position.y = blockHeightMm +
//      post.size.y / 2`). Under `layoutPostsAndFootings` the post
//      BOTTOM sits at y=0 (grade).
//   3. Post `size.y` (length) shrinks by exactly `blockHeightMm` —
//      the space the block now occupies used to be part of the post.

const OLDCASTLE_FOUNDATION: FoundationSpec = {
  type: 'deck-blocks',
  product: { productId: 'oldcastle-11x11x7' },
};

function makeDeckBlocksDesign(overrides: Partial<{
  widthMm: number;
  lengthMm: number;
  heightMm: number;
}> = {}): DeckDesign {
  // Height chosen so that after re-anchoring the post over an
  // Oldcastle 178 mm block, the post still has ≥ MIN_POST_HEIGHT_MM
  // y-extent. Default 1200 mm ≈ 4′ — comfortably above the block-
  // adjusted structural minimum (~700 mm for the reference 2×10
  // stack).
  return {
    id: '00000000-0000-4000-8000-000000000020',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: {
      widthMm: overrides.widthMm ?? 3660,
      lengthMm: overrides.lengthMm ?? 4880,
      heightMm: overrides.heightMm ?? 1200,
    },
    structure: 'elevated',
    foundation: OLDCASTLE_FOUNDATION,
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: 406,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

describe('layoutPostsAndBlocks — AC1 posts + blocks emission', () => {
  it('emits exactly one block per post (same array length)', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const { posts, blocks } = layoutPostsAndBlocks(design, beams);
    expect(blocks).toHaveLength(posts.length);
  });

  it('post count follows the same ceil(widthMm/MAX_BEAM_SPAN_MM)+1 formula (20 ft → 8 posts)', () => {
    const design = makeDeckBlocksDesign({
      widthMm: 20 * MM_PER_FOOT,
      lengthMm: 30 * MM_PER_FOOT,
    });
    const beams = layoutBeams(design);
    const { posts } = layoutPostsAndBlocks(design, beams);
    // 6096 / 2438.4 = 2.5 → ceil=3 → +1 = 4 posts per beam × 2 beams.
    expect(posts).toHaveLength(8);
  });

  it('does NOT emit any footing members (block-only foundation)', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    // The return type has NO `footings` field — the shape difference
    // itself enforces the AC1 zero-footings invariant. This test
    // confirms every emitted member is either a post or a block.
    const { posts, blocks } = layoutPostsAndBlocks(design, beams);
    for (const p of posts) expect(p.kind).toBe('post');
    for (const b of blocks) expect(b.kind).toBe('block');
  });
});

describe('layoutPostsAndBlocks — AC3 block dimensions from catalog', () => {
  it('every block has the Oldcastle actual dims (279 × 178 × 279)', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const { blocks } = layoutPostsAndBlocks(design, beams);
    for (const b of blocks) {
      expect(b.size.x).toBe(product.actual.widthMm);
      expect(b.size.y).toBe(product.actual.heightMm);
      expect(b.size.z).toBe(product.actual.depthMm);
    }
  });

  it('every block carries a {kind:"block", productId} material', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const { blocks } = layoutPostsAndBlocks(design, beams);
    for (const b of blocks) {
      expect(b.material.kind).toBe('block');
      if (b.material.kind === 'block') {
        expect(b.material.productId).toBe('oldcastle-11x11x7');
      }
    }
  });
});

describe('layoutPostsAndBlocks — AC4 block centered under post, on grade', () => {
  it('each block position.x and position.z match its parent post', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const { posts, blocks } = layoutPostsAndBlocks(design, beams);
    for (let i = 0; i < posts.length; i++) {
      expect(blocks[i]!.position.x).toBeCloseTo(posts[i]!.position.x, 6);
      expect(blocks[i]!.position.z).toBeCloseTo(posts[i]!.position.z, 6);
    }
  });

  it('every block position.y equals product.actual.heightMm / 2 (on grade at y=0)', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const { blocks } = layoutPostsAndBlocks(design, beams);
    for (const b of blocks) {
      expect(b.position.y).toBe(product.actual.heightMm / 2);
    }
  });
});

describe('layoutPostsAndBlocks — AC5 post rests on block top', () => {
  it('post position.y == blockHeightMm + post.size.y / 2 (bottom on block top)', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const blockHeightMm = product.actual.heightMm; // 178
    const { posts } = layoutPostsAndBlocks(design, beams);
    for (const p of posts) {
      expect(p.position.y).toBeCloseTo(blockHeightMm + p.size.y / 2, 6);
    }
  });

  it('post size.y == beamBottomY - blockHeightMm (block occupies what used to be post span)', () => {
    // Reference 2×10 stack: deckingThickness 25 + joistDepth 235 +
    // beamDepth 235 = 495 mm above the beam bottom. Design height
    // 1200 → beamBottomY = 705 mm. Block height 178 → post size.y
    // = 705 − 178 = 527 mm.
    const design = makeDeckBlocksDesign({ heightMm: 1200 });
    const beams = layoutBeams(design);
    const deckingMat = lookupMaterial('5/4x6', 'PT', 'No2');
    const joistMat = lookupMaterial('2x10', 'PT', 'No2');
    const beamMat = lookupMaterial('2x10', 'PT', 'No2');
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const beamBottomY =
      1200 -
      deckingMat.actual.widthMm -
      joistMat.actual.heightMm -
      beamMat.actual.heightMm;
    const expectedPostHeight = beamBottomY - product.actual.heightMm;
    const { posts } = layoutPostsAndBlocks(design, beams);
    for (const p of posts) {
      expect(p.size.y).toBeCloseTo(expectedPostHeight, 6);
    }
  });

  it('post top y (position.y + size.y/2) equals beamBottomY (post supports the beam)', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const deckingMat = lookupMaterial('5/4x6', 'PT', 'No2');
    const joistMat = lookupMaterial('2x10', 'PT', 'No2');
    const beamMat = lookupMaterial('2x10', 'PT', 'No2');
    const beamBottomY =
      design.footprint.heightMm -
      deckingMat.actual.widthMm -
      joistMat.actual.heightMm -
      beamMat.actual.heightMm;
    const { posts } = layoutPostsAndBlocks(design, beams);
    for (const p of posts) {
      expect(p.position.y + p.size.y / 2).toBeCloseTo(beamBottomY, 6);
    }
  });

  it('post bottom y (position.y − size.y/2) equals blockHeightMm (post BOTTOM on block TOP)', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const { posts } = layoutPostsAndBlocks(design, beams);
    for (const p of posts) {
      expect(p.position.y - p.size.y / 2).toBeCloseTo(product.actual.heightMm, 6);
    }
  });
});

describe('layoutPostsAndBlocks — ids, determinism, caller-contract guard', () => {
  it('post ids follow the same post-<beam>-<index> pattern as posts-on-footings', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const { posts } = layoutPostsAndBlocks(design, beams);
    for (const p of posts) expect(p.id).toMatch(/^post-(near|far)-\d+$/);
  });

  it('block ids mirror the post ids (block-<beam>-<index>)', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const { blocks } = layoutPostsAndBlocks(design, beams);
    for (const b of blocks) expect(b.id).toMatch(/^block-(near|far)-\d+$/);
  });

  it('is deterministic — same design + same beams yields deeply-equal arrays', () => {
    const design = makeDeckBlocksDesign();
    const beams = layoutBeams(design);
    const a = layoutPostsAndBlocks(design, beams);
    const b = layoutPostsAndBlocks(design, beams);
    expect(a).toEqual(b);
  });

  it('throws when called with a non-deck-blocks foundation (caller-contract guard)', () => {
    // Mirrors the defensive throw in `layoutPostsAndFootings`. The
    // layout-engine dispatcher never routes a posts-on-footings
    // design here, but a future direct caller that skips the
    // dispatcher must fail loudly rather than silently produce
    // nonsense.
    const design: DeckDesign = {
      ...makeDeckBlocksDesign(),
      foundation: {
        type: 'posts-on-footings',
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        footing: { widthMm: 300, depthMm: 300 },
      },
    };
    const beams = layoutBeams(design);
    expect(() => layoutPostsAndBlocks(design, beams)).toThrow(
      /deck-blocks|foundation/i,
    );
  });
});

describe('layoutPostsAndBlocks — height boundary (block-adjusted MIN)', () => {
  it('at heightMm just above the block-adjusted MIN, post.size.y ≥ MIN_POST_HEIGHT_MM', () => {
    // block-adjusted MIN = existing MIN (520 for 2×10 stack) + block
    // heightMm (178) = 698 mm. At heightMm = 700, post.size.y ≈ 27
    // mm (just above the 25 mm floor).
    const design = makeDeckBlocksDesign({ heightMm: 700 });
    const beams = layoutBeams(design);
    const { posts } = layoutPostsAndBlocks(design, beams);
    for (const p of posts) {
      expect(p.size.y).toBeGreaterThanOrEqual(MIN_POST_HEIGHT_MM);
    }
  });

  it('at heightMm = computeMinStructuralHeightMm (deck-blocks branch), post.size.y ≈ MIN_POST_HEIGHT_MM', () => {
    const proto = makeDeckBlocksDesign();
    const minHeight = computeMinStructuralHeightMm(proto);
    const design = makeDeckBlocksDesign({ heightMm: minHeight });
    const beams = layoutBeams(design);
    const { posts } = layoutPostsAndBlocks(design, beams);
    for (const p of posts) {
      expect(p.size.y).toBeCloseTo(MIN_POST_HEIGHT_MM, 6);
    }
  });
});
