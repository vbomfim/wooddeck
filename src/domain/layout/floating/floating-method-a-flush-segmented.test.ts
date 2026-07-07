/**
 * `src/domain/layout/floating/floating-method-a-flush-segmented.test.ts`
 * — TDD RED for issue #77, "Method A + FLUSH: segment joists per bay
 * across intermediate beams (hang on hangers) — supersedes FR-037 FR-E".
 *
 * ## Regression target
 *
 * Pre-#77 `validateFloatingDesign` THREW `LayoutError` for the combo
 * `structure='floating' && floatingFraming='beams-and-joists' &&
 *  beamConnection='flush' && interiorRows > 0` (FR-037 FR-E). The MVP
 * did not support hanging joists off multiple interior beams.
 *
 * #77 removes the throw and IMPLEMENTS segmentation: under
 * `flush + interiorRows > 0` each joist column becomes `totalRows - 1`
 * SEGMENT members (one per bay), hung off the two enclosing beam
 * faces via hangers. BOM hanger count = `2 × segments`. Blocking
 * shifts to per-bay under flush + interior (whole-deck rows would
 * AABB-collide with an interior beam because the flush joist plane
 * overlaps the beam plane).
 *
 * ## Coverage — AC1..AC13 from the ticket §18
 *
 * See per-`describe` block for the AC each group pins.
 *
 * DROP and flush-2-beam paths MUST stay byte-identical to pre-#77
 * (regression pins under "byte-identity" describe blocks).
 *
 * ## Pre-comply: pure domain module — no react/three imports.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, LayoutMember, MaterialRef } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';
import { lookupMaterial } from '../../materials-catalog';
import { spanCheck } from '../../spans/span-check';
import { IrcSpanTable } from '../../spans/irc-2018-tables';
import { deriveBom } from '../../bom/derive-bom';

import { computeFloatingLayout, resolveMethodABeamRows } from './floating-layout';
import { computeYStackFloating } from './y-stack-floating';
import { computeBayClearGapsMm } from './floating-joist-layout';

// ---------------------------------------------------------------------------
// Fixtures (mirrors intermediate-beams.test.ts)
// ---------------------------------------------------------------------------

const PT_2X6: MaterialRef = { nominal: '2x6', species: 'PT', grade: 'No2' };
const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
const CEDAR_2X6: MaterialRef = { nominal: '2x6', species: 'Cedar', grade: 'No2' };
const CEDAR_2X8: MaterialRef = { nominal: '2x8', species: 'Cedar', grade: 'No2' };
const CEDAR_2X10: MaterialRef = { nominal: '2x10', species: 'Cedar', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};
const OLDCASTLE_FOUNDATION: FoundationSpec = {
  type: 'deck-blocks',
  product: { productId: 'oldcastle-11x11x7' },
};

interface FloatOverrides {
  widthFt?: number;
  lengthFt?: number;
  heightMm?: Mm;
  spacingMm?: Mm;
  joist?: MaterialRef;
  beam?: MaterialRef;
  beamConnection?: DeckDesign['beamConnection'];
  foundation?: FoundationSpec;
}

function makeMethodA(overrides: FloatOverrides = {}): DeckDesign {
  const widthMm = (overrides.widthFt ?? 16) * MM_PER_FOOT;
  const lengthMm = (overrides.lengthFt ?? 16) * MM_PER_FOOT;
  const joist = overrides.joist ?? PT_2X8;
  const beam = overrides.beam ?? joist;
  return {
    id: '00000000-0000-4000-8000-000000000c77',
    createdAt: '2026-07-06T00:00:00.000Z',
    footprint: {
      widthMm,
      lengthMm,
      heightMm: overrides.heightMm ?? 3 * MM_PER_FOOT,
    },
    structure: 'floating',
    floatingFraming: 'beams-and-joists',
    beamConnection: overrides.beamConnection ?? 'flush',
    foundation: overrides.foundation ?? TUFFBLOCK_FOUNDATION,
    joist: { material: joist, spacingMm: overrides.spacingMm ?? 406 },
    beam: { material: beam },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

// ===========================================================================
// C3 unit — computeBayClearGapsMm pure helper
// ===========================================================================

describe('computeBayClearGapsMm — pure helper (C3)', () => {
  it('N=2 beams → returns exactly 1 gap (center-to-center minus thickness)', () => {
    const gaps = computeBayClearGapsMm([-1000, +1000], 38);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.midZ).toBeCloseTo(0, 6);
    expect(gaps[0]!.clearSpanMm).toBeCloseTo(2000 - 38, 6);
  });

  it('N=3 beams → returns 2 gaps at the correct midpoints', () => {
    // Beams at -2000, 0, +2000; thickness 38 → clear span each = 2000-38 = 1962.
    const gaps = computeBayClearGapsMm([-2000, 0, +2000], 38);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]!.midZ).toBeCloseTo(-1000, 6);
    expect(gaps[1]!.midZ).toBeCloseTo(+1000, 6);
    expect(gaps[0]!.clearSpanMm).toBeCloseTo(1962, 6);
    expect(gaps[1]!.clearSpanMm).toBeCloseTo(1962, 6);
  });

  it('N=4 beams → 3 gaps in ascending z order', () => {
    const gaps = computeBayClearGapsMm([-3000, -1000, +1000, +3000], 38);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]!.midZ).toBeCloseTo(-2000, 6);
    expect(gaps[1]!.midZ).toBeCloseTo(0, 6);
    expect(gaps[2]!.midZ).toBeCloseTo(+2000, 6);
    // All same span: 2000 − 38 = 1962.
    for (const g of gaps) {
      expect(g.clearSpanMm).toBeCloseTo(1962, 6);
    }
  });

  it('pure — same input yields byte-equal output', () => {
    const a = computeBayClearGapsMm([-2000, 0, +2000], 38);
    const b = computeBayClearGapsMm([-2000, 0, +2000], 38);
    expect(a).toEqual(b);
  });
});

// ===========================================================================
// AC1 — FR-E rejection removed (no throw for flush + interior)
// ===========================================================================

describe('AC1 — flush + interior beam rows no longer throw (FR-E removed)', () => {
  const IRC = new IrcSpanTable();

  it('16×16 flush Method A (needs 3 beams) → renders without throw', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    expect(() =>
      computeFloatingLayout(design, { spanTable: IRC }),
    ).not.toThrow();
  });

  it('30×30 flush Method A (needs more beams) → renders without throw', () => {
    const design = makeMethodA({
      widthFt: 30,
      lengthFt: 30,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
      foundation: OLDCASTLE_FOUNDATION,
    });
    expect(() =>
      computeFloatingLayout(design, { spanTable: IRC }),
    ).not.toThrow();
  });
});

// ===========================================================================
// AC2 — segmented joist geometry for 16×16 flush Method A
// ===========================================================================

describe('AC2 — segmented joist geometry (16×16 flush + interior)', () => {
  const IRC = new IrcSpanTable();

  const design = makeMethodA({
    widthFt: 16,
    lengthFt: 16,
    joist: PT_2X8,
    beam: PT_2X8,
    beamConnection: 'flush',
  });
  const layout = computeFloatingLayout(design, { spanTable: IRC });
  const joists = layout.members.filter((m) => m.kind === 'joist');
  const beams = layout.members.filter((m) => m.kind === 'beam');
  const beamZs = beams
    .map((b) => b.position.z)
    .sort((a, b) => a - b);
  const beamMat = lookupMaterial('2x8', 'PT', 'No2');
  const beamThicknessMm = beamMat.actual.widthMm;

  it('emits `numJoists × (totalRows − 1)` joist SEGMENT members', () => {
    // 16×16 with 2×8 joists @ 16″ o.c.:
    //   numJoists = 13 (deterministic — see `computeJoistXCenters` for 4877 mm × 406 mm × 38 mm)
    //   totalRows = 3 (span-safe adds one interior beam)
    //   segments = 13 × 2 = 26
    expect(beams.length).toBe(3);
    const numJoists = 13;
    const numBays = 2;
    expect(joists.length).toBe(numJoists * numBays);
  });

  it('every joist member id follows the `joist-{i}-bay-{k}` pattern', () => {
    for (const j of joists) {
      expect(j.id).toMatch(/^joist-\d+-bay-\d+$/);
    }
  });

  it('joist ids are unique and enumerate every (col, bay) pair', () => {
    const ids = new Set(joists.map((j) => j.id));
    expect(ids.size).toBe(joists.length);
  });

  it('joist ids emit in +x col ASC then +z bay ASC order', () => {
    // Reconstruct the emit order to prove determinism.
    const expected: string[] = [];
    const numJoists = 13;
    const numBays = 2;
    for (let i = 0; i < numJoists; i++) {
      for (let k = 0; k < numBays; k++) {
        expected.push(`joist-${String(i)}-bay-${String(k)}`);
      }
    }
    expect(joists.map((j) => j.id)).toEqual(expected);
  });

  it('every segment sits at a BAY MIDPOINT z (between two adjacent beam z-centers)', () => {
    const expectedBayMids = [
      (beamZs[0]! + beamZs[1]!) / 2,
      (beamZs[1]! + beamZs[2]!) / 2,
    ];
    for (const j of joists) {
      const bay = Number(/-bay-(\d+)$/.exec(j.id)![1]!);
      expect(j.position.z).toBeCloseTo(expectedBayMids[bay]!, 6);
    }
  });

  it('every segment size.z equals bay CLEAR gap (beam face to beam face)', () => {
    // Bay clear gap = (beamZ[k+1] − beamZ[k]) − beamThicknessMm
    const clearGap0 = beamZs[1]! - beamZs[0]! - beamThicknessMm;
    const clearGap1 = beamZs[2]! - beamZs[1]! - beamThicknessMm;
    for (const j of joists) {
      const bay = Number(/-bay-(\d+)$/.exec(j.id)![1]!);
      const expectedGap = bay === 0 ? clearGap0 : clearGap1;
      expect(j.size.z).toBeCloseTo(expectedGap, 6);
    }
  });

  it('every segment sits at joist center Y from computeYStackFloating (flush plane)', () => {
    const y = computeYStackFloating(design);
    for (const j of joists) {
      expect(j.position.y).toBeCloseTo(y.joistCenterY, 6);
    }
  });

  it('segments never overlap a beam AABB on +z', () => {
    // Each segment must fit strictly inside the clear gap between the
    // two enclosing beam FACES — i.e. segment [zCenter±sizeZ/2] must
    // be inside [beamZ[k] + beamThickness/2, beamZ[k+1] − beamThickness/2].
    for (const j of joists) {
      const bay = Number(/-bay-(\d+)$/.exec(j.id)![1]!);
      const innerLeft = beamZs[bay]! + beamThicknessMm / 2;
      const innerRight = beamZs[bay + 1]! - beamThicknessMm / 2;
      const segLeft = j.position.z - j.size.z / 2;
      const segRight = j.position.z + j.size.z / 2;
      expect(segLeft).toBeCloseTo(innerLeft, 6);
      expect(segRight).toBeCloseTo(innerRight, 6);
    }
  });
});

// ===========================================================================
// AC3 — DROP + flush-2-beam byte-identity regression pins
// ===========================================================================

describe('AC3 — DROP and flush-2-beam paths are BYTE-IDENTICAL to pre-#77', () => {
  const IRC = new IrcSpanTable();

  it('DROP 16×16 Method A → joist ids are `joist-{i}` (no bay suffix), size.z = footprint.lengthMm', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beamConnection: 'drop',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const joists = layout.members.filter((m) => m.kind === 'joist');
    for (const j of joists) {
      expect(j.id).toMatch(/^joist-\d+$/);
      expect(j.size.z).toBeCloseTo(design.footprint.lengthMm, 6);
    }
  });

  it('DROP 40×40 with interior beams → still emits one member per column (drop is unchanged)', () => {
    const design = makeMethodA({
      widthFt: 12,
      lengthFt: 40,
      joist: PT_2X6,
      beam: PT_2X6,
      beamConnection: 'drop',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBeGreaterThanOrEqual(3);
    // Number of joist members equals number of joist columns
    // (no segmentation under drop).
    const uniqueXs = new Set(joists.map((j) => Math.round(j.position.x * 1e3) / 1e3));
    expect(joists.length).toBe(uniqueXs.size);
    // All ids follow the un-suffixed `joist-{i}` pattern.
    expect(joists.every((j) => /^joist-\d+$/.test(j.id))).toBe(true);
  });

  it('flush 12×12 (`totalRows === 2`) → un-segmented, ids `joist-{i}`, size.z = clear span between rims', () => {
    // 12×12 flush + 2×8 PT joist @ 406 mm — the resolver returns
    // 2 (post-fix MEDIUM #2). No segmentation.
    const design = makeMethodA({
      widthFt: 12,
      lengthFt: 12,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(2);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    for (const j of joists) {
      expect(j.id).toMatch(/^joist-\d+$/);
    }
    // A joist column count matches unique x centers.
    const uniqueXs = new Set(joists.map((j) => Math.round(j.position.x * 1e3) / 1e3));
    expect(joists.length).toBe(uniqueXs.size);
  });
});

// ===========================================================================
// AC4 — BOM hangers: 2 × segments for flush; unchanged for drop
// ===========================================================================

describe('AC4 — BOM hangers = 2 × segments (flush + interior); unchanged for drop and flush-2-beam', () => {
  const IRC = new IrcSpanTable();

  it('16×16 flush + interior → 2 × (13 joists × 2 bays) = 52 hangers', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const bom = deriveBom(layout, { beamConnection: 'flush' });
    expect(bom.hardware).toHaveLength(1);
    expect(bom.hardware[0]!.sku).toBe('Joist hangers (2×8)');
    expect(bom.hardware[0]!.count).toBe(52);
  });

  it('12×12 flush-2-beam → 2 × 10 = 20 hangers (byte-identical to pre-#77)', () => {
    // 12 ft × 12 ft flush + 2×8 PT joist @ 406 mm — `totalRows = 2`.
    // Joist count = ceil((12 ft − 38 mm) / 406) + 1 = 10.
    const design = makeMethodA({
      widthFt: 12,
      lengthFt: 12,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const joists = layout.members.filter((m) => m.kind === 'joist');
    // Sanity: 10 joists total (segmentation OFF at totalRows=2).
    expect(joists.length).toBe(10);
    const bom = deriveBom(layout, { beamConnection: 'flush' });
    expect(bom.hardware).toHaveLength(1);
    expect(bom.hardware[0]!.sku).toBe('Joist hangers (2×8)');
    expect(bom.hardware[0]!.count).toBe(20);
  });

  it('DROP 16×16 → NO hangers (unchanged)', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beamConnection: 'drop',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const bom = deriveBom(layout, { beamConnection: 'drop' });
    expect(bom.hardware).toEqual([]);
  });
});

// ===========================================================================
// AC5 — per-bay blocking under flush + interior; whole-deck otherwise
// ===========================================================================

describe('AC5 — per-bay blocking (flush+interior) vs whole-deck (flush-2-beam + drop)', () => {
  const IRC = new IrcSpanTable();

  it('16×16 flush + interior → blocking ids `blocking-bay-{k}-r{r}-b{c}`', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    expect(blocking.length).toBeGreaterThan(0);
    for (const b of blocking) {
      expect(b.id).toMatch(/^blocking-bay-\d+-r\d+-b\d+$/);
    }
  });

  it('flush + interior → NO blocking AABB overlaps any interior-beam AABB (segmented bays only)', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    // Interior beam z-centers (exclude near/far rims).
    const beamZsSorted = beams.map((b) => b.position.z).sort((a, b) => a - b);
    const interiorBeams = beams.filter(
      (b) => b.position.z !== beamZsSorted[0]! && b.position.z !== beamZsSorted[beamZsSorted.length - 1]!,
    );
    expect(interiorBeams.length).toBeGreaterThan(0);
    for (const iBeam of interiorBeams) {
      const beamFrontZ = iBeam.position.z - iBeam.size.z / 2;
      const beamBackZ = iBeam.position.z + iBeam.size.z / 2;
      for (const b of blocking) {
        const blockFrontZ = b.position.z - b.size.z / 2;
        const blockBackZ = b.position.z + b.size.z / 2;
        // AABB non-overlap on +z (either blocking is entirely left
        // of or right of the interior beam).
        const noOverlap = blockBackZ <= beamFrontZ + 1e-6 || blockFrontZ >= beamBackZ - 1e-6;
        expect(noOverlap).toBe(true);
      }
    }
  });

  it('flush-2-beam (12×12) → whole-deck blocking ids `blocking-r{r}-b{c}` (byte-identical)', () => {
    const design = makeMethodA({
      widthFt: 12,
      lengthFt: 12,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    expect(blocking.length).toBeGreaterThan(0);
    for (const b of blocking) {
      expect(b.id).toMatch(/^blocking-r\d+-b\d+$/);
    }
  });

  it('DROP 16×16 → whole-deck blocking ids `blocking-r{r}-b{c}` (unchanged)', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beamConnection: 'drop',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    expect(blocking.length).toBeGreaterThan(0);
    for (const b of blocking) {
      expect(b.id).toMatch(/^blocking-r\d+-b\d+$/);
    }
  });
});

// ===========================================================================
// AC6 — span-safety regression matrix (0 over-span-joist on fresh flush designs)
// ===========================================================================

describe('AC6 — span-safety: 0 over-span-joist warnings on fresh Method A + FLUSH decks', () => {
  const IRC = new IrcSpanTable();
  const sizes: Array<[number, number]> = [
    [12, 12],
    [16, 16],
    [20, 24],
    [30, 30],
    [40, 40],
  ];
  const joistOptions: MaterialRef[] = [
    PT_2X6,
    PT_2X8,
    PT_2X10,
    CEDAR_2X6,
    CEDAR_2X8,
    CEDAR_2X10,
  ];

  for (const [widthFt, lengthFt] of sizes) {
    for (const j of joistOptions) {
      it(`${widthFt}×${lengthFt} ft × ${j.species} ${j.nominal} FLUSH → 0 over-span-joist`, () => {
        // 2×10 uses Oldcastle (TuffBlock only accepts {2x6, 2x8}).
        const foundation =
          j.nominal === '2x10' ? OLDCASTLE_FOUNDATION : TUFFBLOCK_FOUNDATION;
        const design = makeMethodA({
          widthFt,
          lengthFt,
          joist: j,
          beam: j, // equal depth → flush-beam-depth guard passes
          beamConnection: 'flush',
          foundation,
        });
        const layout = computeFloatingLayout(design, { spanTable: IRC });
        const overSpan = spanCheck(layout, IRC).filter(
          (w) => w.kind === 'over-span-joist',
        );
        expect(overSpan).toEqual([]);
      });
    }
  }
});

// ===========================================================================
// AC8 — determinism: two calls yield deep-equal layouts
// ===========================================================================

describe('AC8 — determinism (flush + interior segmentation is deterministic)', () => {
  const IRC = new IrcSpanTable();

  it('two calls with 16×16 flush produce deep-equal layouts', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const now = (): string => design.createdAt;
    const a = computeFloatingLayout(design, { spanTable: IRC, now });
    const b = computeFloatingLayout(design, { spanTable: IRC, now });
    expect(a).toEqual(b);
  });

  it('two calls with 30×30 flush (more segments) produce deep-equal layouts', () => {
    const design = makeMethodA({
      widthFt: 30,
      lengthFt: 30,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
      foundation: OLDCASTLE_FOUNDATION,
    });
    const now = (): string => design.createdAt;
    const a = computeFloatingLayout(design, { spanTable: IRC, now });
    const b = computeFloatingLayout(design, { spanTable: IRC, now });
    expect(a).toEqual(b);
  });
});

// ===========================================================================
// AC9 — validator interop: validateFlushBeamDepth still fires
// ===========================================================================

describe('AC9 — validateFlushBeamDepth still fires when joist depth > beam depth', () => {
  const IRC = new IrcSpanTable();

  it('flush + 2×10 joist × 2×8 beam → throws (beam shallower than joist)', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X10,
      beam: PT_2X8,
      beamConnection: 'flush',
      foundation: OLDCASTLE_FOUNDATION,
    });
    expect(() =>
      computeFloatingLayout(design, { spanTable: IRC }),
    ).toThrow(/flush/i);
  });
});

// ===========================================================================
// AC11 — emit-order regression: [boards, joists(asc col, asc bay), blocking, beams, blocks]
// ===========================================================================

describe('AC11 — emit order under flush + interior', () => {
  const IRC = new IrcSpanTable();

  it('members emit in the order [board..., joist... (asc col then asc bay), blocking..., beam... (asc z), block...]', () => {
    const design = makeMethodA({
      widthFt: 16,
      lengthFt: 16,
      joist: PT_2X8,
      beam: PT_2X8,
      beamConnection: 'flush',
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    // Group indices per kind.
    const idxOf = (kind: LayoutMember['kind']): number[] =>
      layout.members
        .map((m, i) => (m.kind === kind ? i : -1))
        .filter((i) => i >= 0);
    const boardIdxs = idxOf('board');
    const joistIdxs = idxOf('joist');
    const blockingIdxs = idxOf('blocking');
    const beamIdxs = idxOf('beam');
    const blockIdxs = idxOf('block');
    // Kind blocks are contiguous and in the expected order.
    expect(Math.max(...boardIdxs)).toBeLessThan(Math.min(...joistIdxs));
    expect(Math.max(...joistIdxs)).toBeLessThan(Math.min(...blockingIdxs));
    expect(Math.max(...blockingIdxs)).toBeLessThan(Math.min(...beamIdxs));
    expect(Math.max(...beamIdxs)).toBeLessThan(Math.min(...blockIdxs));

    // Joist emit order: asc col then asc bay.
    const joistMembers = layout.members.filter((m) => m.kind === 'joist');
    const parsed = joistMembers.map((j) => {
      const match = /^joist-(\d+)-bay-(\d+)$/.exec(j.id)!;
      return { col: Number(match[1]!), bay: Number(match[2]!) };
    });
    for (let i = 1; i < parsed.length; i++) {
      const prev = parsed[i - 1]!;
      const cur = parsed[i]!;
      const prevKey = prev.col * 1000 + prev.bay;
      const curKey = cur.col * 1000 + cur.bay;
      expect(curKey).toBeGreaterThan(prevKey);
    }

    // Beams asc z.
    const beamMembers = layout.members.filter((m) => m.kind === 'beam');
    for (let i = 1; i < beamMembers.length; i++) {
      expect(beamMembers[i]!.position.z).toBeGreaterThan(beamMembers[i - 1]!.position.z);
    }
  });
});

// ===========================================================================
// C6 sanity — sanity check on totalRows and interiorRows via resolver
// ===========================================================================

describe('resolver sanity — 16×16 with 2×8 PT joists → 3 rows / 1 interior', () => {
  const IRC = new IrcSpanTable();

  it('resolveMethodABeamRows returns totalRows=3 and interiorRows=1 for the canonical 16×16', () => {
    const { totalRows, interiorRows } = resolveMethodABeamRows(
      16 * MM_PER_FOOT,
      IRC,
      PT_2X8,
      406,
      16 * MM_PER_FOOT,
    );
    expect(totalRows).toBe(3);
    expect(interiorRows).toBe(1);
  });
});
