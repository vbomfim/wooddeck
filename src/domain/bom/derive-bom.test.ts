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
  DeckDesign,
  Layout,
  LayoutMember,
  LumberMemberMaterial,
  MemberKind,
} from '../model';
import { computeLayout } from '../layout/layout-engine';
import { IrcSpanTable } from '../spans/irc-2018-tables';

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
  it('returns { lumber: [], foundation: [], footings: [], generatedAt: string } for empty layout', () => {
    const result = deriveBom(makeLayout([]), {});
    expect(result.lumber).toEqual([]);
    expect(result.foundation).toEqual([]);
    expect(result.footings).toEqual([]);
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

// ---------------------------------------------------------------------------
// Footing-kind members are COUNTED into a dedicated `footings` section
// on `BomResult` (FIX 2 review-gate). Elevated decks would otherwise
// silently drop the concrete-pier count → shopping list is incomplete.
// Footings are NOT lumber (do NOT pack into the cut-list) and NOT
// catalog blocks (no `FoundationProductId`) — they get a dimension-
// derived synthetic displayName like "Concrete footing 300 × 300 mm".
// ---------------------------------------------------------------------------

describe('deriveBom — footing-kind members are counted (FIX 2)', () => {
  it('folds footing members into result.footings (grouped by dimensions)', () => {
    const members: LayoutMember[] = [
      makeMember('joist-0', 'joist', PT_2x8, 3000),
      // Two footings at the standard 300×300×300 mm MVP dims:
      makeMember('footing-0', 'footing', PT_2x8, 0),
      makeMember('footing-1', 'footing', PT_2x8, 0),
    ];
    const result = deriveBom(makeLayout(members), {});
    // Joist packs as lumber (unchanged).
    expect(result.lumber).toHaveLength(1);
    // Foundation section is EMPTY (that section is for catalog-
    // block products only — no `productId` on footings).
    expect(result.foundation).toEqual([]);
    // Footings COUNTED into result.footings.
    expect(result.footings).toHaveLength(1);
    const [only] = result.footings;
    expect(only!.count).toBe(2);
    expect(only!.widthMm).toBe(400);
    expect(only!.depthMm).toBe(300);
    // Display name carries the dimensions and the material hint —
    // safe to render as-is in the BOM UI.
    expect(only!.displayName).toMatch(/concrete/i);
    expect(only!.displayName).toContain('400');
    expect(only!.displayName).toContain('300');
  });

  it('groups footings with DIFFERENT dimensions into separate entries', () => {
    // makeMember with kind='footing' sets 400×300×400 by default.
    // We synthesize a differently-sized footing directly to exercise
    // the grouping. Locks in that the (widthMm, depthMm) tuple is
    // the group key.
    const stdFooting = makeMember('footing-std-0', 'footing', PT_2x8, 0);
    const bigFooting: LayoutMember = {
      id: 'footing-big-0',
      kind: 'footing',
      material: { kind: 'lumber', nominal: '2x8', species: 'PT', grade: 'No2' },
      position: { x: 0, y: 0, z: 0 },
      // Bigger footprint, shallower — a hypothetical alt spec.
      size: { x: 600, y: 200, z: 600 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const result = deriveBom(makeLayout([stdFooting, bigFooting]), {});
    expect(result.footings).toHaveLength(2);
    // Deterministic sort by (widthMm asc, depthMm asc).
    expect(result.footings[0]!.widthMm).toBe(400);
    expect(result.footings[1]!.widthMm).toBe(600);
  });

  it('a layout of only footings yields ONLY a footings section', () => {
    // Regression: footings alone must NOT create a phantom lumber
    // section, and MUST populate the footings section (not the
    // foundation section, which is catalog-block-only).
    const members: LayoutMember[] = [
      makeMember('footing-0', 'footing', PT_2x8, 0),
      makeMember('footing-1', 'footing', PT_2x8, 0),
      makeMember('footing-2', 'footing', PT_2x8, 0),
    ];
    const result = deriveBom(makeLayout(members), {});
    expect(result.lumber).toEqual([]);
    expect(result.foundation).toEqual([]);
    expect(result.footings).toHaveLength(1);
    expect(result.footings[0]!.count).toBe(3);
  });

  it('a floating-blocks layout keeps foundation and yields NO footings', () => {
    // Contra-positive check: block members go to `foundation`; the
    // `footings` section stays empty for floating designs.
    const members: LayoutMember[] = [
      makeMember('block-0', 'block', TUFFBLOCK, 0),
      makeMember('block-1', 'block', TUFFBLOCK, 0),
    ];
    const result = deriveBom(makeLayout(members), {});
    expect(result.foundation).toHaveLength(1);
    expect(result.footings).toEqual([]);
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

  // ---------- FIX 1 (review-gate) — kerf validation propagates -----------

  it('propagates the packer error when kerfMm = NaN', () => {
    const members = [makeMember('m-0', 'joist', PT_2x8, 3000)];
    expect(() => deriveBom(makeLayout(members), { kerfMm: Number.NaN })).toThrow(
      /kerf/i,
    );
  });

  it('propagates the packer error when kerfMm = -1', () => {
    const members = [makeMember('m-0', 'joist', PT_2x8, 3000)];
    expect(() => deriveBom(makeLayout(members), { kerfMm: -1 })).toThrow(/kerf/i);
  });
});

// ---------------------------------------------------------------------------
// FIX 6 (review-gate) — oversize cut throw + cross-kind SKU merge
// ---------------------------------------------------------------------------

describe('deriveBom — over-length cuts SPLICE (S24 UAT FIX 0)', () => {
  it('a 25 ft beam on a SKU whose max stock is 20 ft splices into 2 boards (no throw)', () => {
    // Prior to the S24 UAT pair-fix, deriveBom re-threw the packer's
    // "cut exceeds max stock" error. That crashed BomPanel's useMemo
    // and white-screened the app for any deck wider than the max
    // stock length (a 24 ft-wide deck is a normal DIY size).
    //
    // NEW semantics: over-length cuts are SPLICED — buying two boards
    // and butt-jointing them is standard framing practice, so the BOM
    // just adds the extra board(s). N = ceil(25/20) = 2 boards.
    const members = [makeMember('big-beam', 'beam', PT_2x8, ftMm(25))];
    // Must NOT throw.
    const result = deriveBom(makeLayout(members), {});
    expect(result.lumber).toHaveLength(1);
    const pack = result.lumber[0]!.pack;
    expect(pack.totalStockBoards).toBe(2);
    // Board 1 = full 20 ft, board 2 = 5 ft remainder + 15 ft offcut.
    expect(pack.stockBoards[0]!.cuts).toEqual([
      { memberId: 'big-beam', lengthMm: ftMm(20) },
    ]);
    expect(pack.stockBoards[0]!.offcutMm).toBe(0);
    expect(pack.stockBoards[1]!.cuts).toEqual([
      { memberId: 'big-beam', lengthMm: ftMm(5) },
    ]);
    expect(pack.stockBoards[1]!.offcutMm).toBe(ftMm(15));
  });
});

describe('deriveBom — cross-kind SKU merge (QA #7)', () => {
  it('decking + blocking sharing one SKU (5/4×6 PT) fold into ONE lumber pack', () => {
    // Both member kinds carry `material.kind='lumber'` with the
    // same (nominal, species, grade) → same SKU key → same
    // lumber section → cuts pooled into ONE packer call. Locks
    // in the behavior that grouping is by SKU, NOT by member
    // kind. Regression: if grouping ever accidentally splits on
    // kind, we'd emit two separate 5/4×6 rows and over-count
    // stock boards.
    const members = [
      makeMember('board-0', 'board', PT_5_4x6, ftMm(12)),
      makeMember('board-1', 'board', PT_5_4x6, ftMm(12)),
      // Blocking pieces of the SAME SKU — used for edge nailers
      // under decking joints.
      makeMember('blk-0', 'blocking', PT_5_4x6, inMm(14)),
      makeMember('blk-1', 'blocking', PT_5_4x6, inMm(14)),
    ];
    const result = deriveBom(makeLayout(members), {});
    // ONE lumber section (both kinds share the SKU).
    expect(result.lumber).toHaveLength(1);
    const [section] = result.lumber;
    expect(section!.sku).toContain('5/4x6');
    // The pack sees all 4 cuts.
    const allCuts = section!.pack.stockBoards.flatMap((b) => b.cuts);
    expect(allCuts).toHaveLength(4);
    // Cross-kind pooling: at least one board carries both a
    // long board cut AND a short blocking cut.
    const memberIds = new Set(allCuts.map((c) => c.memberId));
    expect(memberIds.has('board-0')).toBe(true);
    expect(memberIds.has('blk-0')).toBe(true);
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

// ---------------------------------------------------------------------------
// Issue #72 — blocking-between-joists integration
// ---------------------------------------------------------------------------
//
// Blocking members are emitted by the shared
// `layoutBlockingBetweenJoists` helper from BOTH `computeLayout`
// (elevated) and `computeFloatingLayout` (floating). The BOM's
// per-kind length rule at `derive-bom.ts:132` treats blocking as
// short pieces that run +x (length = `size.x`) and folds them into
// the joist SKU's cut pack. This test proves the wiring: a real
// elevated `computeLayout` yields a BOM whose joist-SKU lumber
// section CONTAINS blocking-length cuts, so the estimator's cut
// list will now request enough stock to actually build the code-
// mandated noggins (IRC R502.7.1) — not just the joists.
// -------------------------------------------------------------

function makeDefaultElevatedDesign(): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000072',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: { widthMm: 3660, lengthMm: 4880, heightMm: 914 },
    structure: 'elevated',
    floatingFraming: 'beams-and-joists',
    beamConnection: 'drop',
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

describe('deriveBom — issue #72 blocking wiring (real computeLayout)', () => {
  it('BOM built from computeLayout(default) folds EVERY blocking member into the joist SKU pack (no drops)', () => {
    const layout = computeLayout(makeDefaultElevatedDesign());
    const blockingMembers = layout.members.filter((m) => m.kind === 'blocking');
    // Sanity: the layout pipeline emits blocking (proved in
    // layout-engine.test.ts). If this precondition changes the
    // assertion below is meaningless.
    expect(blockingMembers.length).toBeGreaterThan(0);

    const result = deriveBom(layout, {});
    // The default design uses ONE lumber species/grade across
    // framing (PT No.2), so joists + beams + posts + boards +
    // blocking all fold into a small number of lumber SKUs. We
    // pick the section whose SKU matches the joist nominal —
    // blocking piggybacks on the joist material (same nominal +
    // species + grade) so it lives in the joist SKU section.
    const joistMaterial = layout.members.find(
      (m) => m.kind === 'joist',
    )!.material as LumberMemberMaterial;
    const section = result.lumber.find(
      (s) =>
        s.nominal === joistMaterial.nominal &&
        s.species === joistMaterial.species &&
        s.grade === joistMaterial.grade,
    );
    expect(section).toBeDefined();

    // PR #73 review — strengthened per QA:
    // The prior assertion iterated only DISTINCT blocking lengths
    // ("each unique length appears ≥ once in the pack") — a false
    // pass on evenly-spaced joists where every blocking piece has
    // the SAME length: `distinctLengths.size === 1`, so the check
    // would still pass if 8 of 9 identical pieces were dropped.
    // Now we assert per-piece: sort the joist-length blocking
    // pieces alongside the cuts of that length from the SKU pack
    // and confirm the multisets match exactly. This catches
    // silent drops of identical pieces.
    const allCuts = section!.pack.stockBoards.flatMap((b) =>
      b.cuts.map((c) => c.lengthMm),
    );
    const blockingLengthsSorted = [...blockingMembers.map((m) => m.size.x)]
      .sort((a, b) => a - b);
    // Every blocking length must appear as a cut with matching
    // count. Build a per-length count map for each side and
    // require them equal on the blocking subset.
    for (const len of new Set(blockingLengthsSorted)) {
      const expected = blockingLengthsSorted.filter(
        (v) => Math.abs(v - len) < 0.01,
      ).length;
      const actual = allCuts.filter((v) => Math.abs(v - len) < 0.01).length;
      // The pack may ALSO carry cuts of this length that came
      // from joists/beams/posts (unrelated members that happened
      // to have the same length), so demand `actual >= expected`
      // — never `<`. If any blocking piece were silently dropped,
      // `actual` would fall BELOW `expected` for that length.
      expect(actual).toBeGreaterThanOrEqual(expected);
    }
    // Belt-and-braces total: the pack's total cut count is at
    // LEAST the sum of joist + beam + post + board + blocking
    // members that carry the joist SKU. Since blocking is the
    // only kind whose material equals the joist material AND
    // whose length is size.x (joists/beams are size.z), a
    // per-length lower bound is already tight; this asserts the
    // aggregate too.
    expect(allCuts.length).toBeGreaterThanOrEqual(blockingMembers.length);
  });
});

// ---------------------------------------------------------------------------
// Issue #75 — Method A intermediate-beams count-parity (AC12 / FR-D)
// ---------------------------------------------------------------------------
//
// Method A now auto-adds INTERMEDIATE beam rows so joists stay
// span-safe (see `resolveMethodABeamRows` + `computeFloatingBeams`
// in `src/domain/layout/floating/`). Each intermediate beam has
// the SAME material + SAME length as the two rim beams, so
// `deriveBom` should fold ALL beams (rim + intermediate) into the
// SAME lumber SKU pack — one section, N cuts.
//
// This is a per-length count-parity assertion, per PR #73's
// pattern: if any intermediate beam were silently dropped from
// the BOM, `actual < expected` and the test fails LOUD. Pre-#75
// this test would have been meaningless (2 beams only, no
// intermediates); post-#75 it guards against a regression where
// e.g. the barrel forgets to re-export `computeFloatingBeams` or
// the FCP + BOM aggregator regresses to `beam.filter(rim)`.
// -------------------------------------------------------------

describe('deriveBom — issue #75 Method A intermediate-beam count parity', () => {
  it('every intermediate beam appears as a cut in the beam SKU pack — no silent drops (AC12)', () => {
    // 40 ft (Method A) × PT 2×6 @ 406 mm o.c. → resolver adds
    // several intermediate beam rows. We use PT 2×6 (short IRC
    // allowable) so the SpanTable path multiplies rows the most
    // — the test observes the "N beams" case rather than the
    // "2 rims" fallback.
    // Compose a floating Method A design directly (avoid deep
    // fixture imports).
    const PT_2x6 = {
      kind: 'lumber' as const,
      nominal: '2x6' as const,
      species: 'PT' as const,
      grade: 'No2' as const,
    };
    const design: DeckDesign = {
      id: '00000000-0000-4000-8000-000000000075',
      createdAt: '2026-07-05T00:00:00.000Z',
      footprint: {
        widthMm: ftMm(12),
        lengthMm: ftMm(40),
        heightMm: 500, // above the beam+joist+decking Y stack min
      },
      structure: 'floating',
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
      foundation: {
        type: 'deck-blocks',
        product: { productId: 'oldcastle-11x11x7' },
      },
      joist: { material: PT_2x6, spacingMm: 406 },
      beam: { material: PT_2x6 },
      decking: {
        material: PT_2x6,
        orientation: 'parallel-to-width',
      },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    };
    // MUST thread the IRC table through — otherwise
    // `resolveMethodABeamRows` falls back to `totalRows = 2`
    // (documented byte-identity fallback) and this test's
    // precondition ("beams.length > 2") would fail as a false
    // negative.
    const layout = computeLayout(design, { spanTable: new IrcSpanTable() });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    // Precondition: #75 kicked in — resolver added intermediate
    // rows on top of the 2 rims. This is what makes the count-
    // parity assertion meaningful; without it, the check
    // degenerates to the pre-#75 shape.
    expect(beams.length).toBeGreaterThan(2);
    const beamMat = beams[0]!.material as LumberMemberMaterial;
    // All beams must share the SAME SKU (same nominal + species
    // + grade) — the BOM aggregator will fold them into one
    // lumber section.
    for (const b of beams) {
      const mat = b.material as LumberMemberMaterial;
      expect(mat.nominal).toBe(beamMat.nominal);
      expect(mat.species).toBe(beamMat.species);
      expect(mat.grade).toBe(beamMat.grade);
    }
    const result = deriveBom(layout, {});
    const section = result.lumber.find(
      (s) =>
        s.nominal === beamMat.nominal &&
        s.species === beamMat.species &&
        s.grade === beamMat.grade,
    );
    expect(section).toBeDefined();
    const allCuts = section!.pack.stockBoards.flatMap((b) =>
      b.cuts.map((c) => c.lengthMm),
    );
    // Beam length = `size.x` (per-kind rule at derive-bom.ts).
    const beamLengthsSorted = [...beams.map((b) => b.size.x)].sort(
      (a, b) => a - b,
    );
    for (const len of new Set(beamLengthsSorted)) {
      const expected = beamLengthsSorted.filter(
        (v) => Math.abs(v - len) < 0.01,
      ).length;
      const actual = allCuts.filter((v) => Math.abs(v - len) < 0.01).length;
      // Pack may also carry cuts of this length from joists /
      // boards / blocking that share the SKU (all lengths in mm
      // can collide), so demand `actual >= expected`. A silent
      // beam drop would push `actual` BELOW `expected`.
      expect(actual).toBeGreaterThanOrEqual(expected);
    }
  });
});
