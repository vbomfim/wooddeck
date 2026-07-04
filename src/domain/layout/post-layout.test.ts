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

import { MM_PER_FOOT } from '../units';
import { lookupMaterial } from '../materials-catalog';
import type { DeckDesign, LayoutMember } from '../model';

import { layoutBeams } from './beam-layout';
import { MIN_POST_HEIGHT_MM } from './y-stack';
import { computeMinStructuralHeightMm } from './layout-engine';
import {
  FOOTING_DEPTH_MM,
  FOOTING_WIDTH_MM,
  MAX_BEAM_SPAN_MM,
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
    post: { material: { nominal: '6x6', species: 'PT', grade: 'No2' } },
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
