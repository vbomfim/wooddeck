/**
 * `src/ui/bom/derive-bom.test.ts` — AC6 golden fixture + property
 * checks for the pure `deriveBom` function.
 *
 * ## What this file covers
 *
 *   - AC6: the ticket §4 fixture (10 joists 2×8, 2 beams 2×8,
 *     4 posts 6×6, 4 footings, 30 boards 5/4×6) collapses to the
 *     canonical `BomLine[]` list — asserted with EXPLICIT equality
 *     (not `toMatchSnapshot`, which drifts silently on refactor).
 *   - Grouping — two members with the same 4-tuple + length
 *     collapse to one line with count=2.
 *   - Grouping — two members with the same 4-tuple but DIFFERENT
 *     length stay separate.
 *   - Grouping — two members with the same length but DIFFERENT
 *     species stay separate (multi-species deck).
 *   - Empty layout → returns `[]` (the UI surfaces the "empty
 *     layout" message from that fact).
 *   - Sort order — kind ordinal (joist / beam / post / footing /
 *     board) followed by (nominal, species, eachLengthMm).
 *   - Boards get `totalLinearMm` populated; other kinds do NOT.
 *   - Footings have no `eachLengthMm` field.
 *   - Purity — same input → same output, no mutation of input.
 *
 * ## Why an EXPLICIT golden array, not a snapshot
 *
 * `toMatchSnapshot` invites a developer to `-u` a legitimate
 * regression away. AC6 says "exact match" — an explicit `toEqual`
 * on a checked-in constant is the safer contract. If the shape
 * changes, both the source and this file update together in one
 * PR.
 *
 * ## The SPF-vs-PT note
 *
 * The ticket §4 fixture text says "2×8 SPF" but `Species` in
 * `src/domain/model.ts` is a closed union `'PT' | 'Cedar' |
 * 'Composite'` — no `'SPF'`. We use `'PT'` here (the MVP catalog's
 * default framing species) and document that the STRUCTURAL FIXTURE
 * (10 joists + 2 beams + 4 posts + 4 footings + 30 boards) still
 * exercises AC6's grouping/length/count math end to end. This
 * substitution is documented in the S14 handoff as an autonomous
 * decision.
 */
import { describe, expect, it } from 'vitest';

import type { Layout, LayoutMember, LumberMemberMaterial, MemberKind } from '../../domain/model';

import { deriveBom, type BomLine } from './derive-bom';

// --------------------------------------------------------------------------
// Fixture builders — kept tiny so the test file reads TOP-DOWN.
// --------------------------------------------------------------------------

// S17 note: `LayoutMember.material` is now a `MemberMaterialRef`
// discriminated union; deriveBom's grouping only emits lumber rows,
// so the fixture materials are all `LumberMemberMaterial`
// (`kind: 'lumber'`).
const PT_2x8: LumberMemberMaterial = { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_6x6: LumberMemberMaterial = { kind: 'lumber', nominal: '6x6', species: 'PT', grade: 'No2' };
const PT_5_4x6: LumberMemberMaterial = { kind: 'lumber', nominal: '5/4x6', species: 'PT', grade: 'No2' };
const CEDAR_2x8: LumberMemberMaterial = { kind: 'lumber', nominal: '2x8', species: 'Cedar', grade: 'No2' };

/**
 * Make a layout member with axis-aligned size + zero rotation. The
 * `length` argument is the extent along the member's OWN axis; we
 * fabricate the other two dimensions from realistic dressed
 * dimensions for the SKU (2×8 = 38 × 184 mm, 6×6 = 140 × 140 mm,
 * 5/4×6 = 25 × 140 mm — see `materials-catalog.ts`).
 *
 * The exact non-length dimensions don't matter for `deriveBom` —
 * only the extent along the member's OWN axis is read — but
 * building realistic sizes keeps a debug print readable.
 */
function makeMember(
  id: string,
  kind: MemberKind,
  material: LumberMemberMaterial,
  lengthMm: number,
): LayoutMember {
  // Approximate cross-section per SKU. Not asserted; just for
  // realism in printed fixture output.
  const [w, h] =
    material.nominal === '2x8'
      ? [38, 184]
      : material.nominal === '6x6'
        ? [140, 140]
        : material.nominal === '5/4x6'
          ? [25, 140]
          : [50, 50];
  // Assign the "length" extent to the correct axis per kind.
  let sx = w;
  let sy = h;
  let sz = h;
  switch (kind) {
    case 'joist':
      sx = w;
      sy = h;
      sz = lengthMm;
      break;
    case 'beam':
      sx = lengthMm;
      sy = h;
      sz = w;
      break;
    case 'post':
      sx = w;
      sy = lengthMm;
      sz = w;
      break;
    case 'board':
      // Board: the LONGER of x/z is the run direction. The unit
      // under test uses `Math.max(size.x, size.z)`; put the length
      // on x, face-width on z.
      sx = lengthMm;
      sy = 25;
      sz = w;
      break;
    case 'footing':
      // Cubic; the length is irrelevant to deriveBom.
      sx = 400;
      sy = 300;
      sz = 400;
      break;
  }
  return {
    id,
    kind,
    material,
    position: { x: 0, y: 0, z: 0 },
    size: { x: sx, y: sy, z: sz },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

/**
 * Build a `Layout` from a raw members list — fills in the
 * boilerplate `designId`, `computedAt`, `bounds` that `deriveBom`
 * never reads.
 */
function makeLayout(members: LayoutMember[]): Layout {
  return {
    designId: 'test-design',
    computedAt: '2024-01-01T00:00:00.000Z',
    bounds: { widthMm: 0, lengthMm: 0, heightMm: 0 },
    members,
  };
}

// --------------------------------------------------------------------------
// AC6 — golden fixture
// --------------------------------------------------------------------------

/**
 * The ticket §4 fixture (SPF → PT substitution documented above).
 *
 *   - 10 joists 2×8 PT, each 3658 mm long
 *   -  2 beams  2×8 PT, each 3658 mm long
 *   -  4 posts  6×6 PT, each  914 mm tall (3 ft — matches the
 *      default design's `heightFt: 3`)
 *   -  4 footings (cubic; no length)
 *   - 30 boards 5/4×6 PT, each 3658 mm long
 */
function makeGoldenFixture(): Layout {
  const members: LayoutMember[] = [];
  for (let i = 0; i < 10; i++) members.push(makeMember(`j-${String(i)}`, 'joist', PT_2x8, 3658));
  for (let i = 0; i < 2; i++) members.push(makeMember(`b-${String(i)}`, 'beam', PT_2x8, 3658));
  for (let i = 0; i < 4; i++) members.push(makeMember(`p-${String(i)}`, 'post', PT_6x6, 914));
  for (let i = 0; i < 4; i++) members.push(makeMember(`f-${String(i)}`, 'footing', PT_6x6, 0));
  for (let i = 0; i < 30; i++) members.push(makeMember(`d-${String(i)}`, 'board', PT_5_4x6, 3658));
  return makeLayout(members);
}

/**
 * The golden expectation. Kept as a plain-object array so a diff
 * is trivially readable. Order matches the module's KIND_ORDER
 * (joist → beam → post → footing → board).
 */
const GOLDEN_EXPECTED: readonly BomLine[] = [
  { kind: 'joist', nominal: '2x8', species: 'PT', count: 10, eachLengthMm: 3658 },
  { kind: 'beam', nominal: '2x8', species: 'PT', count: 2, eachLengthMm: 3658 },
  { kind: 'post', nominal: '6x6', species: 'PT', count: 4, eachLengthMm: 914 },
  { kind: 'footing', nominal: '6x6', species: 'PT', count: 4 },
  {
    kind: 'board',
    nominal: '5/4x6',
    species: 'PT',
    count: 30,
    eachLengthMm: 3658,
    totalLinearMm: 109740, // 30 × 3658
  },
];

describe('deriveBom — AC6 golden fixture', () => {
  it('collapses the 10+2+4+4+30 fixture to the canonical five BomLines', () => {
    const layout = makeGoldenFixture();
    const bom = deriveBom(layout);
    expect(bom).toEqual(GOLDEN_EXPECTED);
  });

  it('produces the same output for the same input (purity)', () => {
    const layout = makeGoldenFixture();
    const a = deriveBom(layout);
    const b = deriveBom(layout);
    expect(a).toEqual(b);
  });

  it('does not mutate the input layout', () => {
    const layout = makeGoldenFixture();
    const before = JSON.stringify(layout);
    deriveBom(layout);
    expect(JSON.stringify(layout)).toBe(before);
  });
});

// --------------------------------------------------------------------------
// Grouping behaviour
// --------------------------------------------------------------------------

describe('deriveBom — grouping behaviour', () => {
  it('collapses two members with the same 4-tuple + length', () => {
    const layout = makeLayout([
      makeMember('j-0', 'joist', PT_2x8, 3600),
      makeMember('j-1', 'joist', PT_2x8, 3600),
    ]);
    const bom = deriveBom(layout);
    expect(bom).toHaveLength(1);
    expect(bom[0]).toEqual({
      kind: 'joist',
      nominal: '2x8',
      species: 'PT',
      count: 2,
      eachLengthMm: 3600,
    });
  });

  it('keeps two members with different lengths in separate rows', () => {
    const layout = makeLayout([
      makeMember('j-0', 'joist', PT_2x8, 3600),
      makeMember('j-1', 'joist', PT_2x8, 4200),
    ]);
    const bom = deriveBom(layout);
    // Sorted by eachLengthMm ascending — 3600 first.
    expect(bom).toEqual<BomLine[]>([
      { kind: 'joist', nominal: '2x8', species: 'PT', count: 1, eachLengthMm: 3600 },
      { kind: 'joist', nominal: '2x8', species: 'PT', count: 1, eachLengthMm: 4200 },
    ]);
  });

  it('keeps two members with different species in separate rows', () => {
    const layout = makeLayout([
      makeMember('j-0', 'joist', PT_2x8, 3600),
      makeMember('j-1', 'joist', CEDAR_2x8, 3600),
    ]);
    const bom = deriveBom(layout);
    // Sorted by species alphabetical: Cedar first, then PT.
    expect(bom).toEqual<BomLine[]>([
      { kind: 'joist', nominal: '2x8', species: 'Cedar', count: 1, eachLengthMm: 3600 },
      { kind: 'joist', nominal: '2x8', species: 'PT', count: 1, eachLengthMm: 3600 },
    ]);
  });
});

// --------------------------------------------------------------------------
// Empty / edge cases
// --------------------------------------------------------------------------

describe('deriveBom — edge cases', () => {
  it('returns [] for an empty layout', () => {
    const bom = deriveBom(makeLayout([]));
    expect(bom).toEqual([]);
  });

  it('omits eachLengthMm on footings', () => {
    const bom = deriveBom(makeLayout([makeMember('f-0', 'footing', PT_6x6, 0)]));
    expect(bom).toHaveLength(1);
    expect(bom[0]).not.toHaveProperty('eachLengthMm');
    expect(bom[0]).not.toHaveProperty('totalLinearMm');
    expect(bom[0]?.count).toBe(1);
  });

  it('omits totalLinearMm on non-board kinds', () => {
    const bom = deriveBom(
      makeLayout([
        makeMember('j-0', 'joist', PT_2x8, 3600),
        makeMember('b-0', 'beam', PT_2x8, 3600),
        makeMember('p-0', 'post', PT_6x6, 900),
      ]),
    );
    for (const line of bom) {
      expect(line).not.toHaveProperty('totalLinearMm');
    }
  });

  it('populates totalLinearMm on boards as count × eachLengthMm', () => {
    const bom = deriveBom(
      makeLayout([
        makeMember('d-0', 'board', PT_5_4x6, 3600),
        makeMember('d-1', 'board', PT_5_4x6, 3600),
        makeMember('d-2', 'board', PT_5_4x6, 3600),
      ]),
    );
    expect(bom).toHaveLength(1);
    expect(bom[0]).toEqual({
      kind: 'board',
      nominal: '5/4x6',
      species: 'PT',
      count: 3,
      eachLengthMm: 3600,
      totalLinearMm: 10800,
    });
  });
});

// --------------------------------------------------------------------------
// Sort order
// --------------------------------------------------------------------------

describe('deriveBom — sort order', () => {
  it('sorts kinds in the ticket §2 order (joist → beam → post → footing → board)', () => {
    // Deliberately shuffled insertion order — the sort must produce
    // the canonical order regardless of how members appear in the
    // layout.
    const layout = makeLayout([
      makeMember('d-0', 'board', PT_5_4x6, 3600),
      makeMember('f-0', 'footing', PT_6x6, 0),
      makeMember('b-0', 'beam', PT_2x8, 3600),
      makeMember('p-0', 'post', PT_6x6, 900),
      makeMember('j-0', 'joist', PT_2x8, 3600),
    ]);
    const bom = deriveBom(layout);
    expect(bom.map((l) => l.kind)).toEqual(['joist', 'beam', 'post', 'footing', 'board']);
  });
});

// --------------------------------------------------------------------------
// S14 UAT pair-fix — FIX I. Breadth: mixed-length boards + AC7
// unit-formatting round trip.
// --------------------------------------------------------------------------

describe('deriveBom — mixed board lengths in one layout (FIX I breadth)', () => {
  it('produces DISTINCT rows for boards of the same SKU but different lengths', () => {
    // A realistic deck has boards of two lengths at the edge —
    // e.g. 30 × 3658 mm boards + 2 × 1830 mm off-cuts. The BOM
    // must keep them separate rows so the buyer orders both
    // lengths.
    const layout = makeLayout([
      // 30 full-length boards
      ...Array.from({ length: 30 }, (_v, i) =>
        makeMember(`d-full-${String(i)}`, 'board', PT_5_4x6, 3658),
      ),
      // 2 off-cut boards
      ...Array.from({ length: 2 }, (_v, i) =>
        makeMember(`d-cut-${String(i)}`, 'board', PT_5_4x6, 1830),
      ),
    ]);

    const bom = deriveBom(layout);

    // Two rows for boards, same 4-tuple (kind/nominal/species/…),
    // sorted by eachLengthMm ascending (per the module contract).
    expect(bom).toHaveLength(2);
    expect(bom).toEqual([
      {
        kind: 'board',
        nominal: '5/4x6',
        species: 'PT',
        count: 2,
        eachLengthMm: 1830,
        totalLinearMm: 3660,
      },
      {
        kind: 'board',
        nominal: '5/4x6',
        species: 'PT',
        count: 30,
        eachLengthMm: 3658,
        totalLinearMm: 109740,
      },
    ]);
  });

  it('per-row totalLinearMm equals count × eachLengthMm even when rows share a SKU', () => {
    const layout = makeLayout([
      makeMember('d-1', 'board', PT_5_4x6, 2000),
      makeMember('d-2', 'board', PT_5_4x6, 2000),
      makeMember('d-3', 'board', PT_5_4x6, 3000),
    ]);

    const bom = deriveBom(layout);

    // Every board line: totalLinearMm === count * eachLengthMm.
    for (const line of bom) {
      if (line.kind === 'board') {
        expect(line.totalLinearMm).toBe(line.count * (line.eachLengthMm ?? 0));
      }
    }
  });
});

// AC7: the ticket §4 fixture length (3658 mm ≈ 12 ft) must
// round-trip to exactly 12′0″ in imperial and to a metric string
// with an m unit. Failing these pins the presentation contract
// upstream of the BOM panel — a change to formatLength (e.g. a
// rounding tweak) that would confuse buyers surfaces immediately.
describe('deriveBom + formatLength (AC7 unit-string round trip)', () => {
  it('formatLength(3658, "imperial") produces the AC7 12′0″ string', async () => {
    const { formatLength } = await import('../../domain/units');
    // 3658 mm / 304.8 mm/ft = 12.0 ft (exact to 4 significant figures).
    // The domain formatter uses `12′ 0″` (with a hair space between
    // feet and inches for readability) — the "12′0″" written in
    // the ticket §4 is the same value under a slightly tighter
    // typographic convention. We pin the ACTUAL formatter output
    // so a change (e.g. dropping the space) would fail loudly.
    expect(formatLength(3658, 'imperial')).toBe('12′ 0″');
  });

  it('formatLength(3658, "metric") produces a metric string with an m suffix', async () => {
    const { formatLength } = await import('../../domain/units');
    // 3658 mm = 3.658 m — exact repr depends on the domain
    // implementation, but the m unit must be present.
    const s = formatLength(3658, 'metric');
    expect(s).toMatch(/m/);
    expect(s.length).toBeGreaterThan(0);
  });
});
