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
import type { DeckDesign } from '../../model';

const PT_2X10: DeckDesign['joist']['material'] = { nominal: '2x10', species: 'PT', grade: 'No2' };
const PT_6X6: DeckDesign['post']['material'] = { nominal: '6x6', species: 'PT', grade: 'No2' };
const PT_54: DeckDesign['decking']['material'] = { nominal: '5/4x6', species: 'PT', grade: 'No2' };
const CEDAR_54: DeckDesign['decking']['material'] = {
  nominal: '5/4x6',
  species: 'Cedar',
  grade: 'No2',
};
const CEDAR_2X10: DeckDesign['joist']['material'] = {
  nominal: '2x10',
  species: 'Cedar',
  grade: 'No2',
};
const COMPOSITE_54: DeckDesign['decking']['material'] = {
  nominal: '5/4x6',
  species: 'Composite',
  grade: 'NA',
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
    joist: { material: joistMat, spacingMm: args.spacingMm },
    beam: { material: joistMat },
    post: { material: PT_6X6 },
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
      heightFt: 1,
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
      heightFt: 1,
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
      joist: { material: PT_2X10, spacingMm: 508 },
      beam: { material: PT_2X10 },
      post: { material: PT_6X6 },
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
      joist: { material: PT_2X10, spacingMm: 406 },
      beam: { material: PT_2X10 },
      post: { material: PT_6X6 },
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
    name: 'height-zero',
    // Height 0 is a stress test — posts collapse to y-size 0 by design;
    // footings still placed. See computeLayout / post-layout comments.
    design: design({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      createdAt: '2026-07-02T00:00:11.000Z',
      widthFt: 10,
      lengthFt: 10,
      heightFt: 0,
      spacingMm: 406,
    }),
  },
];
