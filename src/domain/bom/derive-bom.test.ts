/**
 * `src/domain/bom/derive-bom.test.ts` — S21 issue #43 TDD RED for the
 * WIDENED bill-of-materials derivation (moved from `src/ui/bom/`).
 *
 * ## Coverage
 *
 *   - AC6: `foundation` section separates blocks from lumber. A
 *          floating-shaped Layout with 27 TuffBlocks yields
 *          `foundation = [{productId: 'tuffblock-12x12x4', count: 27,
 *          displayName: '…'}]` and no lumber row lists blocks.
 *   - AC7: THE USER'S HAND-DRAWN EXAMPLE fixture. 13 × 2×8×16 full-length
 *          beams + blocking (14 × 16″ + 2 × 14″ + 18 × 6″ = 30 ft)
 *          all in one 2×8 PT No.2 SKU → `pack.totalStockBoards === 15`
 *          (13 beams + 2 for blocking offcuts) at the 16 ft stock size.
 *   - Grouping: two members of the SAME SKU + species + grade fold
 *          into the SAME BomSection_Lumber; two members with a DIFFERENT
 *          nominal produce two sections.
 *   - kerfMm option: default is 3 mm; a caller-supplied 0 mm changes
 *          the pack result (regression check).
 *   - Empty layout → `{ lumber: [], foundation: [], generatedAt: string }`.
 *   - Deterministic ordering: two calls on the same layout produce
 *          byte-identical output; sections are sorted (lumber by SKU,
 *          foundation by productId).
 *   - Non-lumber, non-block member kind is a compile-error surface
 *          — the discriminant switch is exhaustive.
 *   - Mixed lumber + block members yield the correct SPLIT.
 *
 * ## RED
 *
 * `deriveBom` (new signature) does not exist at `src/domain/bom/` yet
 * — every test in this file will fail with a module-not-found error
 * until the implementation lands.
 */
import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT, MM_PER_INCH } from '../units';
import type { Mm } from '../units';
import type {
  BlockMemberMaterial,
  Layout,
  LayoutMember,
  LumberMemberMaterial,
  MemberKind,
} from '../model';

import { deriveBom, type BomResult } from './derive-bom';

// ---------------------------------------------------------------------------
// Test helpers — kept tiny so tests read top-down.
// ---------------------------------------------------------------------------

const ftMm = (feet: number): Mm => Math.round(feet * MM_PER_FOOT);
const inMm = (inches: number): Mm => Math.round(inches * MM_PER_INCH);

const PT_2x8: LumberMemberMaterial = {
  kind: 'lumber',
  nominal: '2x8',
  species: 'PT',
  grade: 'No2',
};
const CEDAR_2x8: LumberMemberMaterial = {
  kind: 'lumber',
  nominal: '2x8',
  species: 'Cedar',
  grade: 'No2',
};
const PT_5_4x6: LumberMemberMaterial = {
  kind: 'lumber',
  nominal: '5/4x6',
  species: 'PT',
  grade: 'No2',
};
const TUFFBLOCK: BlockMemberMaterial = {
  kind: 'block',
  productId: 'tuffblock-12x12x4',
};
const OLDCASTLE: BlockMemberMaterial = {
  kind: 'block',
  productId: 'oldcastle-11x11x7',
};

/**
 * Build a layout member with axis-aligned size. `lengthMm` is placed
 * on the correct axis for the member's kind (see `derive-bom.ts` for
 * the axis convention). Block members use `size.x` for x-extent and
 * `.y` for height; `lengthMm` is ignored (blocks are counted, not cut).
 */
function makeMember(
  id: string,
  kind: MemberKind,
  material: LumberMemberMaterial | BlockMemberMaterial,
  lengthMm: number,
): LayoutMember {
  const dressed =
    material.kind === 'lumber'
      ? material.nominal === '2x8'
        ? { w: 38, h: 184 }
        : material.nominal === '5/4x6'
          ? { w: 25, h: 140 }
          : { w: 140, h: 140 }
      : { w: 305, h: 102 }; // TuffBlock nominal
  let sx = dressed.w;
  let sy = dressed.h;
  let sz = dressed.w;
  switch (kind) {
    case 'joist':
      sz = lengthMm;
      break;
    case 'beam':
      sx = lengthMm;
      sz = dressed.w;
      break;
    case 'post':
      sy = lengthMm;
      break;
    case 'board':
      sx = lengthMm;
      sy = 25;
      sz = dressed.h;
      break;
    case 'footing':
      sx = 400;
      sy = 300;
      sz = 400;
      break;
    case 'block':
      // A block is roughly cubic — width/depth on x/z, short height on y.
      sx = dressed.w;
      sy = dressed.h;
      sz = dressed.w;
      break;
    case 'blocking':
      // A blocking piece is short lumber between joists — runs +x.
      sx = lengthMm;
      sz = dressed.w;
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

function makeLayout(members: LayoutMember[]): Layout {
  return {
    designId: 'test-design',
    computedAt: '2026-07-04T00:00:00.000Z',
    bounds: { widthMm: 0, lengthMm: 0, heightMm: 0 },
    members,
  };
}

// ---------------------------------------------------------------------------
// Baseline shape
// ---------------------------------------------------------------------------

describe('deriveBom — return shape', () => {
  it('returns { lumber: [], foundation: [], generatedAt: string } for empty layout', () => {
    const result = deriveBom(makeLayout([]), {});
    expect(result.lumber).toEqual([]);
    expect(result.foundation).toEqual([]);
    expect(typeof result.generatedAt).toBe('string');
    // ISO-8601 formatted.
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generatedAt is a valid ISO-8601 timestamp', () => {
    const result = deriveBom(makeLayout([]), {});
    expect(() => new Date(result.generatedAt).toISOString()).not.toThrow();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });

  it('does NOT mutate the input layout', () => {
    const layout = makeLayout([
      makeMember('j-0', 'joist', PT_2x8, 3000),
      makeMember('b-0', 'block', TUFFBLOCK, 0),
    ]);
    const before = JSON.stringify(layout);
    deriveBom(layout, {});
    expect(JSON.stringify(layout)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Lumber grouping — one section per (nominal + species + grade) SKU
// ---------------------------------------------------------------------------

describe('deriveBom — lumber section grouping', () => {
  it('two members of the same SKU fold into ONE lumber section', () => {
    const layout = makeLayout([
      makeMember('j-0', 'joist', PT_2x8, 3000),
      makeMember('j-1', 'joist', PT_2x8, 3000),
    ]);
    const result = deriveBom(layout, {});
    expect(result.lumber).toHaveLength(1);
    const section = result.lumber[0]!;
    expect(section.sku).toMatch(/2x8/);
    expect(section.sku).toMatch(/PT/);
    expect(section.pack.stockBoards.length).toBeGreaterThan(0);
    // Every cut appears exactly once across all boards in the pack.
    const packedIds = new Set(
      section.pack.stockBoards.flatMap((b) => b.cuts.map((c) => c.memberId)),
    );
    expect(packedIds).toEqual(new Set(['j-0', 'j-1']));
  });

  it('two members with DIFFERENT nominal produce TWO lumber sections', () => {
    const layout = makeLayout([
      makeMember('j-0', 'joist', PT_2x8, 3000),
      makeMember('d-0', 'board', PT_5_4x6, 3000),
    ]);
    const result = deriveBom(layout, {});
    expect(result.lumber).toHaveLength(2);
    const nominals = result.lumber.map((s) => s.sku);
    expect(nominals.some((s) => s.includes('2x8'))).toBe(true);
    expect(nominals.some((s) => s.includes('5/4x6'))).toBe(true);
  });

  it('two members with SAME nominal but DIFFERENT species produce TWO sections', () => {
    const layout = makeLayout([
      makeMember('j-0', 'joist', PT_2x8, 3000),
      makeMember('j-1', 'joist', CEDAR_2x8, 3000),
    ]);
    const result = deriveBom(layout, {});
    expect(result.lumber).toHaveLength(2);
    const species = result.lumber.map((s) => s.sku);
    expect(species.some((s) => s.includes('Cedar'))).toBe(true);
    expect(species.some((s) => s.includes('PT'))).toBe(true);
  });

  it('each lumber section carries the catalog stockLengthsAvailableMm array', () => {
    const layout = makeLayout([makeMember('j-0', 'joist', PT_2x8, 3000)]);
    const result = deriveBom(layout, {});
    expect(result.lumber).toHaveLength(1);
    const section = result.lumber[0]!;
    // 2× framing has [8, 10, 12, 14, 16, 20] ft — six entries.
    expect(section.stockLengthsAvailableMm).toHaveLength(6);
    expect(section.stockLengthsAvailableMm[0]).toBe(ftMm(8));
    expect(section.stockLengthsAvailableMm[5]).toBe(ftMm(20));
  });

  it('lumber sections are sorted deterministically by SKU', () => {
    // Random insertion order — should sort to (2x8 Cedar, 2x8 PT,
    // 5/4x6 PT) or similar canonical order.
    const layout = makeLayout([
      makeMember('d-0', 'board', PT_5_4x6, 3000),
      makeMember('j-0', 'joist', PT_2x8, 3000),
      makeMember('j-1', 'joist', CEDAR_2x8, 3000),
    ]);
    const a = deriveBom(layout, {});
    // Run the same layout twice — output must be identical (aside
    // from generatedAt, which we normalize).
    const b = deriveBom(layout, {});
    const stripTime = (r: BomResult): unknown => ({
      lumber: r.lumber,
      foundation: r.foundation,
    });
    expect(JSON.stringify(stripTime(a))).toBe(JSON.stringify(stripTime(b)));
  });
});

// ---------------------------------------------------------------------------
// AC6 — Foundation section separation
// ---------------------------------------------------------------------------

describe('deriveBom — AC6 foundation section (blocks separated from lumber)', () => {
  it('27 TuffBlocks yield foundation = [{ productId, count: 27, displayName }] and no lumber', () => {
    const members = Array.from({ length: 27 }, (_v, i) =>
      makeMember(`block-${String(i)}`, 'block', TUFFBLOCK, 0),
    );
    const result = deriveBom(makeLayout(members), {});
    expect(result.foundation).toHaveLength(1);
    const [only] = result.foundation;
    expect(only!.productId).toBe('tuffblock-12x12x4');
    expect(only!.count).toBe(27);
    expect(only!.displayName).toContain('TuffBlock');
    expect(result.lumber).toEqual([]);
  });

  it('displayName reads from the foundation-catalog (not a hard-coded string)', () => {
    const members = [makeMember('b-0', 'block', OLDCASTLE, 0)];
    const result = deriveBom(makeLayout(members), {});
    expect(result.foundation).toHaveLength(1);
    // The catalog's displayName for oldcastle contains "Oldcastle"
    // and the dimension descriptor — parametric on the catalog, so
    // an update there propagates without a BOM code change.
    expect(result.foundation[0]!.displayName).toContain('Oldcastle');
    expect(result.foundation[0]!.productId).toBe('oldcastle-11x11x7');
    expect(result.foundation[0]!.count).toBe(1);
  });

  it('mixed block productIds group by productId (each with own displayName)', () => {
    const members = [
      ...Array.from({ length: 5 }, (_v, i) =>
        makeMember(`t-${String(i)}`, 'block', TUFFBLOCK, 0),
      ),
      ...Array.from({ length: 3 }, (_v, i) =>
        makeMember(`o-${String(i)}`, 'block', OLDCASTLE, 0),
      ),
    ];
    const result = deriveBom(makeLayout(members), {});
    expect(result.foundation).toHaveLength(2);
    const byId = new Map(result.foundation.map((f) => [f.productId, f]));
    expect(byId.get('tuffblock-12x12x4')?.count).toBe(5);
    expect(byId.get('oldcastle-11x11x7')?.count).toBe(3);
  });

  it('foundation sections are sorted deterministically (by productId)', () => {
    const members = [
      makeMember('t-0', 'block', TUFFBLOCK, 0),
      makeMember('o-0', 'block', OLDCASTLE, 0),
    ];
    const a = deriveBom(makeLayout(members), {});
    const b = deriveBom(makeLayout(members), {});
    const stripTime = (r: BomResult): unknown => ({
      lumber: r.lumber,
      foundation: r.foundation,
    });
    expect(JSON.stringify(stripTime(a))).toBe(JSON.stringify(stripTime(b)));
    // Sort by productId ascending: "oldcastle-…" < "tuffblock-…"
    expect(a.foundation.map((f) => f.productId)).toEqual([
      'oldcastle-11x11x7',
      'tuffblock-12x12x4',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Mixed lumber + block layout
// ---------------------------------------------------------------------------

describe('deriveBom — mixed lumber + block layout', () => {
  it('splits lumber into lumber[] and blocks into foundation[]', () => {
    const members: LayoutMember[] = [
      makeMember('j-0', 'joist', PT_2x8, 3000),
      makeMember('j-1', 'joist', PT_2x8, 3000),
      makeMember('block-0', 'block', TUFFBLOCK, 0),
      makeMember('block-1', 'block', TUFFBLOCK, 0),
      makeMember('block-2', 'block', TUFFBLOCK, 0),
    ];
    const result = deriveBom(makeLayout(members), {});
    expect(result.lumber).toHaveLength(1);
    expect(result.foundation).toHaveLength(1);
    expect(result.foundation[0]!.count).toBe(3);
    // Every LUMBER member (only) appears in the lumber pack.
    const packedIds = new Set(
      result.lumber[0]!.pack.stockBoards.flatMap((b) => b.cuts.map((c) => c.memberId)),
    );
    expect(packedIds).toEqual(new Set(['j-0', 'j-1']));
  });
});

// ---------------------------------------------------------------------------
// Footing-kind members are skipped (MVP quirk: post-layout stamps
// footings with lumber material as a placeholder; they belong in
// NEITHER the lumber nor the foundation section).
// ---------------------------------------------------------------------------

describe('deriveBom — footing-kind members are skipped', () => {
  it('footing members do not appear in lumber pack (documented MVP quirk)', () => {
    // The elevated-deck layout engine (`post-layout.ts` ~line 175)
    // stamps footings with `material.kind='lumber'` as a placeholder
    // because `LayoutMember.material` is required. Footings are
    // actually concrete — S21's BomResult has no "footing" section,
    // so a footing member must be SKIPPED. If a future refactor
    // drops the skip, the lumber pack would incorrectly count
    // footings AND `getMemberLengthMm` would throw at runtime.
    const members: LayoutMember[] = [
      makeMember('joist-0', 'joist', PT_2x8, 3000),
      // Footing with lumber material (MVP producer quirk):
      makeMember('footing-0', 'footing', PT_2x8, 0),
      makeMember('footing-1', 'footing', PT_2x8, 0),
    ];
    const result = deriveBom(makeLayout(members), {});
    // Only the joist is packed — footings are absent from the pack.
    expect(result.lumber).toHaveLength(1);
    const packedIds = result.lumber[0]!.pack.stockBoards.flatMap((b) =>
      b.cuts.map((c) => c.memberId),
    );
    expect(packedIds).toEqual(['joist-0']);
    // Footings are ALSO absent from the foundation section (that
    // section is for `material.kind='block'` products only).
    expect(result.foundation).toEqual([]);
  });

  it('a layout of only footings yields an empty BomResult', () => {
    // The default test deck has posts + footings; if footings were
    // counted as lumber, a footing-only fixture would yield a
    // lumber section — this test locks in the empty-result
    // contract.
    const members: LayoutMember[] = [
      makeMember('footing-0', 'footing', PT_2x8, 0),
      makeMember('footing-1', 'footing', PT_2x8, 0),
    ];
    const result = deriveBom(makeLayout(members), {});
    expect(result.lumber).toEqual([]);
    expect(result.foundation).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// kerfMm option
// ---------------------------------------------------------------------------

describe('deriveBom — kerfMm option', () => {
  it('defaults to 3 mm when no kerfMm is passed', () => {
    // Two 4 ft cuts on 8 ft stock (2×8 SKU's smallest stock):
    //   default kerf (3 mm) → 2 boards (blade width pushes 2nd cut out;
    //     4 ft + kerf + 4 ft = 2441 mm > 2438 mm stock)
    //   kerf 0 → 1 board (2 × 4 ft = 2438 mm fits exactly in 8 ft stock)
    const members = [
      makeMember('m-0', 'joist', PT_2x8, ftMm(4)),
      makeMember('m-1', 'joist', PT_2x8, ftMm(4)),
    ];
    const layout = makeLayout(members);
    const withDefault = deriveBom(layout, {});
    expect(withDefault.lumber[0]!.pack.totalStockBoards).toBe(2);
  });

  it('caller-supplied kerfMm=0 collapses two 4 ft cuts into one 8 ft board', () => {
    // Same fixture as above, kerf zero → 2 × 4 ft cuts fit exactly on
    // one 8 ft stock board. This locks in that (a) kerfMm=0 is
    // accepted (fail-fast validation permits it) and (b) the fixed-
    // single-stock policy (ticket §16) picks 8 ft — the smallest
    // stock length that fits the longest cut — for a pack of 4 ft
    // cuts. Documents the packer's sensitivity to kerf.
    const members = [
      makeMember('m-0', 'joist', PT_2x8, ftMm(4)),
      makeMember('m-1', 'joist', PT_2x8, ftMm(4)),
    ];
    const layout = makeLayout(members);
    const noKerf = deriveBom(layout, { kerfMm: 0 });
    expect(noKerf.lumber[0]!.pack.totalStockBoards).toBe(1);
    expect(noKerf.lumber[0]!.pack.stockBoards[0]!.stockLengthMm).toBe(ftMm(8));
  });
});

// ---------------------------------------------------------------------------
// Member-kind length semantics (see derive-bom.ts's `getMemberLengthMm`)
// ---------------------------------------------------------------------------

describe('deriveBom — member-kind length semantics', () => {
  it('joist length is size.z (runs along +z)', () => {
    const layout = makeLayout([makeMember('j-0', 'joist', PT_2x8, 4200)]);
    const result = deriveBom(layout, {});
    const cut = result.lumber[0]!.pack.stockBoards[0]!.cuts[0]!;
    expect(cut.lengthMm).toBe(4200);
  });

  it('beam length is size.x (runs along +x)', () => {
    const layout = makeLayout([makeMember('b-0', 'beam', PT_2x8, 4200)]);
    const result = deriveBom(layout, {});
    const cut = result.lumber[0]!.pack.stockBoards[0]!.cuts[0]!;
    expect(cut.lengthMm).toBe(4200);
  });

  it('post length is size.y (stands along +y)', () => {
    const layout = makeLayout([makeMember('p-0', 'post', PT_2x8, 914)]);
    const result = deriveBom(layout, {});
    const cut = result.lumber[0]!.pack.stockBoards[0]!.cuts[0]!;
    expect(cut.lengthMm).toBe(914);
  });

  it('blocking length is size.x (short pieces between joists, run +x)', () => {
    const layout = makeLayout([makeMember('bl-0', 'blocking', PT_2x8, inMm(16))]);
    const result = deriveBom(layout, {});
    const cut = result.lumber[0]!.pack.stockBoards[0]!.cuts[0]!;
    expect(cut.lengthMm).toBe(inMm(16));
  });

  it('board length is max(size.x, size.z) (either axis may be the run)', () => {
    const layout = makeLayout([makeMember('d-0', 'board', PT_5_4x6, 3600)]);
    const result = deriveBom(layout, {});
    const cut = result.lumber[0]!.pack.stockBoards[0]!.cuts[0]!;
    expect(cut.lengthMm).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// AC7 — THE USER'S HAND-DRAWN EXAMPLE (golden fixture)
// ---------------------------------------------------------------------------

describe("deriveBom — AC7 user's hand-drawn example (15 × 2×8×16)", () => {
  /**
   * The user's worked example (see ticket §0 / Origin):
   *
   *   - 13 × 2×8 PT No.2 beam members, each 16 ft long → 13 full-
   *     length 2×8×16 stock boards, offcut = 0 per board.
   *   - 14 × 16″ blocking pieces
   *   - 2  × 14″ blocking pieces
   *   - 18 × 6″  blocking pieces
   *     (all 2×8 PT No.2 — same SKU as the beams)
   *
   * The FFD packer folds the beams and blocking into a SINGLE 2×8
   * PT No.2 lumber section. The pack yields:
   *
   *   - 13 boards with a single 16 ft cut, offcut 0.
   *   - 2  boards packed with the 14 × 16″ + 2 × 14″ + 18 × 6″
   *     blocking pieces (30 ft total blocking / 16 ft stock = 2 boards).
   *
   * Total = 15 stock boards, all at the 16 ft stock length.
   *
   * This is the SC-011 golden fixture — the acceptance test the
   * user cited when originally requesting the feature. A change
   * that breaks this (e.g. splitting into a different stock length
   * or over-counting boards) fails LOUDLY with the exact fixture
   * described in the ticket.
   */
  function makeUserExampleLayout(): Layout {
    const members: LayoutMember[] = [];
    // 13 full-length beams — each 16 ft
    for (let i = 0; i < 13; i++) {
      members.push(makeMember(`beam-${String(i).padStart(2, '0')}`, 'beam', PT_2x8, ftMm(16)));
    }
    // 14 × 16″ blocking
    for (let i = 0; i < 14; i++) {
      members.push(
        makeMember(`blk16-${String(i).padStart(2, '0')}`, 'blocking', PT_2x8, inMm(16)),
      );
    }
    // 2 × 14″ blocking
    for (let i = 0; i < 2; i++) {
      members.push(
        makeMember(`blk14-${String(i).padStart(2, '0')}`, 'blocking', PT_2x8, inMm(14)),
      );
    }
    // 18 × 6″ blocking
    for (let i = 0; i < 18; i++) {
      members.push(
        makeMember(`blk06-${String(i).padStart(2, '0')}`, 'blocking', PT_2x8, inMm(6)),
      );
    }
    return makeLayout(members);
  }

  it('packs exactly 15 × 2×8×16 stock boards (13 beams + 2 blocking)', () => {
    const layout = makeUserExampleLayout();
    const result = deriveBom(layout, {});
    // ONE 2×8 PT No.2 lumber section (all members share the SKU).
    expect(result.lumber).toHaveLength(1);
    const section = result.lumber[0]!;
    expect(section.sku).toMatch(/2x8/);
    expect(section.sku).toMatch(/PT/);
    // AC7 EXACTLY: 15 stock boards.
    expect(section.pack.totalStockBoards).toBe(15);
    // Every board is at the 16 ft stock length (the smallest stock
    // that fits the longest cut, which is the 16 ft beam).
    for (const b of section.pack.stockBoards) {
      expect(b.stockLengthMm).toBe(ftMm(16));
    }
    // 13 boards have exactly ONE cut (the full-length beam),
    // offcut = 0.
    const singleCutBoards = section.pack.stockBoards.filter((b) => b.cuts.length === 1);
    expect(singleCutBoards).toHaveLength(13);
    for (const b of singleCutBoards) {
      expect(b.cuts[0]!.lengthMm).toBe(ftMm(16));
      expect(b.offcutMm).toBe(0);
    }
    // The remaining 2 boards carry the blocking (mixed 16″ / 14″ / 6″).
    const blockingBoards = section.pack.stockBoards.filter((b) => b.cuts.length > 1);
    expect(blockingBoards).toHaveLength(2);
    const totalBlockingCuts = blockingBoards.reduce((s, b) => s + b.cuts.length, 0);
    // 14 + 2 + 18 = 34 blocking cuts.
    expect(totalBlockingCuts).toBe(14 + 2 + 18);
  });

  it('produces NO foundation section (all members are lumber)', () => {
    const layout = makeUserExampleLayout();
    const result = deriveBom(layout, {});
    expect(result.foundation).toEqual([]);
  });
});
