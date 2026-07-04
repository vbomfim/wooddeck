/**
 * `src/domain/layout/__fixtures__/fixtures-data.ts` — the enumerated
 * list of `(name, DeckDesign)` pairs the golden-fixture test iterates.
 *
 * Rationale for keeping the DESIGNS in TypeScript (rather than raw JSON)
 * while the EXPECTED LAYOUTS live in JSON:
 *
 *   - Designs benefit from the strict `DeckDesign` type — a typo in a
 *     species / grade / nominal shows up at compile-time here rather
 *     than as a runtime "Unknown material" throw from the catalog.
 *   - Expected layouts are LARGE (thousands of numbers each) and change
 *     as the engine grows. Storing them as JSON lets a human eyeball a
 *     diff without wading through TypeScript syntax noise.
 *
 * Every entry's `design.id` is a hard-coded UUID so the fixture is
 * fully deterministic (see AC7). Every `design.createdAt` is a fixed
 * ISO timestamp; the golden test injects `now: () => design.createdAt`
 * so the resulting `Layout.computedAt` is byte-stable.
 *
 * The `MM_PER_FOOT` constant from `units.ts` is used for every
 * foot-based dimension — no bare `304.8` literals per the S2 rule.
 *
 * Coverage matrix and regeneration workflow: see `./README.md`.
 */

import { MM_PER_FOOT } from '../../units';
import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { FOOTING_DEPTH_MM, FOOTING_WIDTH_MM } from '../y-stack';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
const PT_6X6: MaterialRef = { nominal: '6x6', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };
const CEDAR_54: MaterialRef = {
  nominal: '5/4x6',
  species: 'Cedar',
  grade: 'No2',
};
const CEDAR_2X10: MaterialRef = {
  nominal: '2x10',
  species: 'Cedar',
  grade: 'No2',
};
const COMPOSITE_54: MaterialRef = {
  nominal: '5/4x6',
  species: 'Composite',
  grade: 'NA',
};

// S17: every fixture DeckDesign carries the SAME structure/foundation
// (elevated + posts-on-footings) so the pre-S17 layout math is
// unchanged and SC-004 golden fixtures stay byte-stable. Reused by
// every literal + factory below.
const FIXTURE_FOUNDATION = {
  type: 'posts-on-footings' as const,
  post: PT_6X6,
  footing: { widthMm: FOOTING_WIDTH_MM, depthMm: FOOTING_DEPTH_MM },
};

// S19 floating fixture foundations — one per block product variant.
const FIXTURE_TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};
const FIXTURE_OLDCASTLE_FOUNDATION: FoundationSpec = {
  type: 'deck-blocks',
  product: { productId: 'oldcastle-11x11x7' },
};

/**
 * Build a `DeckDesign` from the minimum-viable field set. Keeps every
 * fixture's construction on ONE line each so a scanning reader can see
 * the shape/spacing/orientation trio at a glance.
 */
function design(args: {
  id: string;
  createdAt: string;
  widthFt: number;
  lengthFt: number;
  heightFt: number;
  spacingMm: number;
  orientation?: DeckDesign['decking']['orientation'];
  species?: 'PT' | 'Cedar' | 'Composite';
  bayRemainderStrategy?: DeckDesign['layout']['bayRemainderStrategy'];
}): DeckDesign {
  const decking =
    args.species === 'Cedar' ? CEDAR_54 : args.species === 'Composite' ? COMPOSITE_54 : PT_54;
  const joistMat = args.species === 'Cedar' ? CEDAR_2X10 : PT_2X10;
  return {
    id: args.id,
    createdAt: args.createdAt,
    footprint: {
      widthMm: args.widthFt * MM_PER_FOOT,
      lengthMm: args.lengthFt * MM_PER_FOOT,
      heightMm: args.heightFt * MM_PER_FOOT,
    },
    structure: 'elevated',
    foundation: FIXTURE_FOUNDATION,
    joist: { material: joistMat, spacingMm: args.spacingMm },
    beam: { material: joistMat },
    decking: {
      material: decking,
      orientation: args.orientation ?? 'parallel-to-width',
    },
    layout: {
      bayRemainderStrategy: args.bayRemainderStrategy ?? 'extra-bay-at-end',
    },
  };
}

/**
 * The 12 canonical fixtures. Each `id` is a hand-generated v4-shaped
 * UUID (do not regenerate — changing an `id` invalidates the JSON
 * golden's `designId` field and its member `id` derivations).
 */
export const FIXTURE_DESIGNS: readonly { name: string; design: DeckDesign }[] = [
  {
    name: 'small-4x4',
    design: design({
      id: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-07-02T00:00:00.000Z',
      widthFt: 4,
      lengthFt: 4,
      heightFt: 2,
      spacingMm: 406,
    }),
  },
  {
    name: 'small-4x4-parallel',
    design: design({
      id: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-07-02T00:00:01.000Z',
      widthFt: 4,
      lengthFt: 4,
      heightFt: 2,
      spacingMm: 406,
      orientation: 'parallel-to-length',
    }),
  },
  {
    name: 'medium-10x14',
    design: design({
      id: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-07-02T00:00:02.000Z',
      widthFt: 10,
      lengthFt: 14,
      heightFt: 3,
      spacingMm: 406,
    }),
  },
  {
    name: 'medium-10x14-cedar',
    design: design({
      id: '44444444-4444-4444-8444-444444444444',
      createdAt: '2026-07-02T00:00:03.000Z',
      widthFt: 10,
      lengthFt: 14,
      heightFt: 3,
      spacingMm: 406,
      species: 'Cedar',
    }),
  },
  {
    name: 'reference-20x30',
    design: design({
      id: '55555555-5555-4555-8555-555555555555',
      createdAt: '2026-07-02T00:00:04.000Z',
      widthFt: 20,
      lengthFt: 30,
      heightFt: 3,
      spacingMm: 406,
    }),
  },
  {
    name: 'reference-20x30-composite',
    design: design({
      id: '66666666-6666-4666-8666-666666666666',
      createdAt: '2026-07-02T00:00:05.000Z',
      widthFt: 20,
      lengthFt: 30,
      heightFt: 3,
      spacingMm: 406,
      species: 'Composite',
    }),
  },
  {
    name: 'exact-multiples',
    // 4064 × 6096 mm (13.333ft × 20ft) with spacing 508 mm (20"). 4064/508 = 8 → floor+1 = 9 joists,
    // last joist flush with far edge (no trailing bay).
    design: {
      id: '77777777-7777-4777-8777-777777777777',
      createdAt: '2026-07-02T00:00:06.000Z',
      footprint: { widthMm: 4064, lengthMm: 6096, heightMm: 914 },
      structure: 'elevated',
      foundation: FIXTURE_FOUNDATION,
      joist: { material: PT_2X10, spacingMm: 508 },
      beam: { material: PT_2X10 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    },
  },
  {
    name: 'remainder-heavy',
    // 3660 × 4880 mm with 406 mm spacing — both dims leave notable remainder.
    design: {
      id: '88888888-8888-4888-8888-888888888888',
      createdAt: '2026-07-02T00:00:07.000Z',
      footprint: { widthMm: 3660, lengthMm: 4880, heightMm: 914 },
      structure: 'elevated',
      foundation: FIXTURE_FOUNDATION,
      joist: { material: PT_2X10, spacingMm: 406 },
      beam: { material: PT_2X10 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    },
  },
  {
    name: 'large-40x40',
    design: design({
      id: '99999999-9999-4999-8999-999999999999',
      createdAt: '2026-07-02T00:00:08.000Z',
      widthFt: 40,
      lengthFt: 40,
      heightFt: 3,
      spacingMm: 406,
    }),
  },
  {
    name: 'large-40x40-wider-spacing',
    design: design({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      createdAt: '2026-07-02T00:00:09.000Z',
      widthFt: 40,
      lengthFt: 40,
      heightFt: 3,
      spacingMm: 610, // 24" o.c.
    }),
  },
  {
    name: 'tall-narrow',
    design: design({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      createdAt: '2026-07-02T00:00:10.000Z',
      widthFt: 4,
      lengthFt: 20,
      heightFt: 2,
      spacingMm: 406,
      orientation: 'parallel-to-length',
    }),
  },
  {
    name: 'min-valid-height',
    // Height set to `computeMinStructuralHeightMm(design)` for the
    // reference PT 5/4x6 decking + 2x10 joist + 2x10 beam stack:
    //
    //   deckingThicknessMm (25) + joistDepthMm (235) + beamDepthMm (235)
    //   + MIN_POST_HEIGHT_MM (25) = 520 mm.
    //
    // This is the boundary case for Fix B: at exactly 520 mm the design
    // is valid and posts have EXACTLY MIN_POST_HEIGHT_MM (25 mm) of
    // y-extent. One millimetre less would throw a LayoutError. See
    // `layout-engine.ts` `computeMinStructuralHeightMm` for the
    // per-design derivation.
    design: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      createdAt: '2026-07-02T00:00:11.000Z',
      footprint: { widthMm: 10 * MM_PER_FOOT, lengthMm: 10 * MM_PER_FOOT, heightMm: 520 },
      structure: 'elevated',
      foundation: FIXTURE_FOUNDATION,
      joist: { material: PT_2X10, spacingMm: 406 },
      beam: { material: PT_2X10 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    },
  },
  {
    name: 'extreme-narrow-4x40',
    // Extreme aspect ratio: 4 ft × 40 ft. Only 2 joists across width;
    // many boards down the length. Exercises the "narrow" corner of
    // the layout engine's numerical range (QA-Gap#4).
    design: design({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      createdAt: '2026-07-02T00:00:12.000Z',
      widthFt: 4,
      lengthFt: 40,
      heightFt: 3,
      spacingMm: 406,
    }),
  },
  {
    name: 'extreme-wide-40x4',
    // Extreme aspect ratio: 40 ft × 4 ft. Many joists across width;
    // only 2 boards down the length (short spans). Complement to
    // extreme-narrow-4x40 (QA-Gap#4). Confirms the width/length
    // asymmetry in joist / board counts is symmetric under swap.
    design: design({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      createdAt: '2026-07-02T00:00:13.000Z',
      widthFt: 40,
      lengthFt: 4,
      heightFt: 3,
      spacingMm: 406,
    }),
  },
  // -----------------------------------------------------------------
  // S19 — floating layout goldens (Epic 2)
  //
  // AC10: the user's hand-drawn 16 ft × 14 ft 2×8-PT-on-TuffBlocks
  //       reference deck.
  // AC1:  the small 8 ft × 8 ft deck-blocks (Oldcastle) variant —
  //       proves the second block product path is covered.
  // Regression: the min-dimension 4 ft × 4 ft floating deck exercises
  //       the trust-boundary MIN_DECK_DIMENSION_MM edge on the
  //       floating path.
  //
  // Note the DIFFERENT foundation, structure, and heightMm values
  // vs. the elevated fixtures above. `heightMm` is set exactly to
  // `computeMinFloatingHeightMm(design)` for the 2×8 beam + 5/4×6
  // decking stack (184 + 25 = 209 mm) — the minimum legal floating
  // height at which validation still passes.
  // -----------------------------------------------------------------
  {
    name: 'floating-16x14-tuffblock',
    // AC10 — user's hand-drawn example.
    // Expected: 3 beams × 8 blocks/beam = 24 blocks (verified in the
    // floating-layout AC10 unit test); block count MUST land in
    // [24, 30] per AC10.
    design: {
      id: '11111111-1111-4111-8111-000000000019',
      createdAt: '2026-07-04T00:00:00.000Z',
      footprint: {
        widthMm: 16 * MM_PER_FOOT,
        lengthMm: 14 * MM_PER_FOOT,
        heightMm: 209, // MIN legal for 2×8 beam + 5/4×6 decking
      },
      structure: 'floating',
      foundation: FIXTURE_TUFFBLOCK_FOUNDATION,
      joist: { material: PT_2X8, spacingMm: 406 },
      beam: { material: PT_2X8 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    },
  },
  {
    name: 'floating-8x8-deckblocks',
    // AC1 — smaller floating deck on the Oldcastle deck-block product.
    // Uses a heavier 2×10 beam so the block layout is exercised with
    // a different beam-depth / min-height combination (235 + 25 = 260).
    design: {
      id: '22222222-2222-4222-8222-000000000019',
      createdAt: '2026-07-04T00:00:01.000Z',
      footprint: {
        widthMm: 8 * MM_PER_FOOT,
        lengthMm: 8 * MM_PER_FOOT,
        heightMm: 260, // MIN legal for 2×10 beam + 5/4×6 decking
      },
      structure: 'floating',
      foundation: FIXTURE_OLDCASTLE_FOUNDATION,
      joist: { material: PT_2X10, spacingMm: 406 },
      beam: { material: PT_2X10 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    },
  },
  {
    name: 'floating-4x4-min-tuffblock',
    // MIN_DECK_DIMENSION_MM boundary — floating variant. Every
    // dimension at the smallest legal value:
    //   - widthMm / lengthMm = MIN_DECK_DIMENSION_MM (4 ft)
    //   - heightMm = computeMinFloatingHeightMm (2×8 + 5/4×6 = 209 mm)
    // One millimetre less on ANY dim throws a LayoutError. This
    // fixture is the "yes it's still valid at the boundary" proof.
    design: {
      id: '33333333-3333-4333-8333-000000000019',
      createdAt: '2026-07-04T00:00:02.000Z',
      footprint: {
        widthMm: 4 * MM_PER_FOOT,
        lengthMm: 4 * MM_PER_FOOT,
        heightMm: 209,
      },
      structure: 'floating',
      foundation: FIXTURE_TUFFBLOCK_FOUNDATION,
      joist: { material: PT_2X8, spacingMm: 406 },
      beam: { material: PT_2X8 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    },
  },
  {
    // Review-gate FIX 5 — non-square floating golden. Exercises the
    // row/col grid formulas independently (width and length differ
    // by 5×). At 8 ft wide × 40 ft long with the 8 ft beam-max spec
    // gives 2 beam columns; the ~24″ block-row-max spec gives
    // 40 ft / 2 ft + 1 = 21 rows → 42 blocks total. Verifies the
    // engine doesn't accidentally square-off the grid on aspect
    // ratios other than 1:1.
    name: 'floating-8x40-oldcastle',
    design: {
      id: '44444444-4444-4444-8444-000000000019',
      createdAt: '2026-07-04T00:00:03.000Z',
      footprint: {
        widthMm: 8 * MM_PER_FOOT,
        lengthMm: 40 * MM_PER_FOOT,
        heightMm: 209, // MIN legal for 2×8 beam + 5/4×6 decking
      },
      structure: 'floating',
      foundation: FIXTURE_OLDCASTLE_FOUNDATION,
      joist: { material: PT_2X8, spacingMm: 406 },
      beam: { material: PT_2X8 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    },
  },
];
