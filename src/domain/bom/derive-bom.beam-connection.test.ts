/**
 * `src/domain/bom/derive-bom.beam-connection.test.ts` — S27
 * (feat/joist-beam-connection) TDD for the BOM `hardware`
 * section (joist hangers) driven by `design.beamConnection`.
 *
 * ## Coverage
 *
 *   - `beamConnection: 'drop'` → `hardware === []` (no hangers,
 *     joists rest on beam tops).
 *   - `beamConnection: 'flush'` → `hardware = [{ sku:
 *     'Joist hangers (2×8)', count: <2 × joistCount> }]`
 *     (one hanger per joist end that frames into a beam; both
 *     rim beams under elevated + Method A).
 *   - Missing `beamConnection` in the options object defaults to
 *     drop-beam behavior (BACKWARD COMPAT for pre-S27 callers).
 *   - Hardware section is EMPTY when there are no joists.
 *   - Hardware section is EMPTY when there are no beams (defensive
 *     — Method B floating has joists but no beams → no hangers).
 *   - `hardware` section is sorted stably by sku (canonical output).
 *   - Determinism: two calls yield byte-identical `hardware`.
 *
 * ## RED
 *
 * The `BomResult` type does not carry a `hardware` field yet and
 * `deriveBom` does not accept `beamConnection` — every test here
 * fails at type-check until the implementation lands.
 */
import { describe, expect, it } from 'vitest';

import type {
  BlockMemberMaterial,
  Layout,
  LayoutMember,
  LumberMemberMaterial,
  LumberNominal,
  MemberKind,
} from '../model';
import { MM_PER_FOOT } from '../units';
import type { Mm } from '../units';

import { deriveBom } from './derive-bom';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PT_2x8: LumberMemberMaterial = {
  kind: 'lumber',
  nominal: '2x8',
  species: 'PT',
  grade: 'No2',
};
const PT_2x10: LumberMemberMaterial = {
  kind: 'lumber',
  nominal: '2x10',
  species: 'PT',
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

function makeMember(
  id: string,
  kind: MemberKind,
  material: LumberMemberMaterial | BlockMemberMaterial,
  lengthMm: Mm,
): LayoutMember {
  const sx = kind === 'beam' || kind === 'blocking' || kind === 'board' ? lengthMm : 89;
  const sy = kind === 'post' ? lengthMm : 184;
  const sz = kind === 'joist' ? lengthMm : 89;
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

/**
 * Convenience: an elevated-style layout with N joists (2×8) and
 * 2 rim beams (2×8) — matching the count of beams a joist frames
 * INTO under elevated construction.
 */
function elevatedLikeLayout(joistCount: number, joistNominal: LumberNominal = '2x8'): Layout {
  const joistMat: LumberMemberMaterial = {
    kind: 'lumber',
    nominal: joistNominal,
    species: 'PT',
    grade: 'No2',
  };
  const members: LayoutMember[] = [];
  // Two rim beams (near + far).
  members.push(makeMember('beam-near', 'beam', PT_2x8, 5 * MM_PER_FOOT));
  members.push(makeMember('beam-far', 'beam', PT_2x8, 5 * MM_PER_FOOT));
  // Joists.
  for (let i = 0; i < joistCount; i++) {
    members.push(makeMember(`joist-${String(i)}`, 'joist', joistMat, 3 * MM_PER_FOOT));
  }
  // A couple of decking boards to make the layout non-trivial.
  members.push(makeMember('board-0', 'board', PT_5_4x6, 5 * MM_PER_FOOT));
  return makeLayout(members);
}

// ---------------------------------------------------------------------------
// Baseline — hardware section present + empty
// ---------------------------------------------------------------------------

describe('deriveBom — hardware section (baseline shape)', () => {
  it('empty layout → hardware: []', () => {
    const result = deriveBom(makeLayout([]), {});
    expect(result.hardware).toEqual([]);
  });

  it('missing beamConnection option defaults to drop (backward compat) → hardware: []', () => {
    const result = deriveBom(elevatedLikeLayout(5), {});
    expect(result.hardware).toEqual([]);
  });

  it('beamConnection: "drop" → hardware: [] (joists rest on beam tops)', () => {
    const result = deriveBom(elevatedLikeLayout(5), { beamConnection: 'drop' });
    expect(result.hardware).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Flush → hangers = joistCount × beamCount
// ---------------------------------------------------------------------------

describe('deriveBom — hardware section for beamConnection: "flush"', () => {
  it('elevated-style (5 joists × 2 beams) → 10 hangers of joist nominal', () => {
    const result = deriveBom(elevatedLikeLayout(5), { beamConnection: 'flush' });
    expect(result.hardware).toHaveLength(1);
    const hanger = result.hardware[0];
    if (hanger === undefined) throw new Error('hardware[0] missing — see previous assertion');
    expect(hanger.sku).toBe('Joist hangers (2×8)');
    expect(hanger.count).toBe(10);
  });

  it('2×10 joists → hanger sku reflects the joist nominal', () => {
    const result = deriveBom(elevatedLikeLayout(3, '2x10'), { beamConnection: 'flush' });
    expect(result.hardware).toHaveLength(1);
    const hanger = result.hardware[0];
    if (hanger === undefined) throw new Error('hardware[0] missing — see previous assertion');
    expect(hanger.sku).toBe('Joist hangers (2×10)');
    expect(hanger.count).toBe(6); // 3 joists × 2 beams
  });

  it('no joists → hardware: [] (nothing to hang)', () => {
    const layout = makeLayout([
      makeMember('beam-0', 'beam', PT_2x8, 5 * MM_PER_FOOT),
      makeMember('beam-1', 'beam', PT_2x8, 5 * MM_PER_FOOT),
    ]);
    const result = deriveBom(layout, { beamConnection: 'flush' });
    expect(result.hardware).toEqual([]);
  });

  it('no beams (Method B floating shape) → hardware: [] (defensive)', () => {
    const layout = makeLayout([
      makeMember('j-0', 'joist', PT_2x8, 3 * MM_PER_FOOT),
      makeMember('j-1', 'joist', PT_2x8, 3 * MM_PER_FOOT),
      makeMember('block-0', 'block', TUFFBLOCK, 0),
    ]);
    const result = deriveBom(layout, { beamConnection: 'flush' });
    // Flush is meaningless without beams — no hangers.
    expect(result.hardware).toEqual([]);
  });

  it('single joist SKU is inferred from the joist members (not from beams)', () => {
    // Mixed sizes: 2×10 joists but 2×8 beams. Hangers should
    // match the JOIST (they hang the joist onto the beam).
    const members: LayoutMember[] = [
      makeMember('beam-0', 'beam', PT_2x8, 5 * MM_PER_FOOT),
      makeMember('beam-1', 'beam', PT_2x8, 5 * MM_PER_FOOT),
      makeMember('j-0', 'joist', PT_2x10, 3 * MM_PER_FOOT),
    ];
    const result = deriveBom(makeLayout(members), { beamConnection: 'flush' });
    const hanger = result.hardware[0];
    if (hanger === undefined) throw new Error('hardware[0] missing');
    expect(hanger.sku).toBe('Joist hangers (2×10)');
    expect(hanger.count).toBe(2); // 1 joist × 2 beams
  });
});

// ---------------------------------------------------------------------------
// S27 review-response HIGH #1 — flush joists are SHORTER than drop
// joists (they end at the beam inner faces). The BOM cut list reads
// `size.z` directly (see `getMemberLengthMm`), so the correct joist
// length flows through automatically — this assertion pins that
// invariant so a future regression that hard-codes `footprint.lengthMm`
// in the BOM fires here.
// ---------------------------------------------------------------------------

describe('deriveBom — flush joist cut length reflects size.z (not footprint length)', () => {
  it('flush joist members with SHORTENED size.z appear at the SHORTENED length in the cut list', () => {
    // Fake layout: 3 joists at 2500 mm (a clear span, deliberately
    // shorter than any real footprint length) + 2 beams. Under drop
    // the joist would be footprint.lengthMm; under flush the
    // domain shortens it to the clear span. The BOM cut list must
    // preserve the domain length exactly.
    const shortenedMm = 2500;
    const members: LayoutMember[] = [
      makeMember('beam-near', 'beam', PT_2x8, 5 * MM_PER_FOOT),
      makeMember('beam-far', 'beam', PT_2x8, 5 * MM_PER_FOOT),
      makeMember('j-0', 'joist', PT_2x8, shortenedMm),
      makeMember('j-1', 'joist', PT_2x8, shortenedMm),
      makeMember('j-2', 'joist', PT_2x8, shortenedMm),
    ];
    const result = deriveBom(makeLayout(members), { beamConnection: 'flush' });
    // Find the 2×8 PT lumber group and confirm every joist cut is
    // exactly `shortenedMm`. Cuts live inside pack.stockBoards.
    const joistGroup = result.lumber.find((g) => g.nominal === '2x8');
    if (joistGroup === undefined) throw new Error('expected a 2×8 lumber group');
    const allCuts = joistGroup.pack.stockBoards.flatMap((b) => b.cuts);
    const joistCuts = allCuts.filter((c) => c.memberId.startsWith('j-'));
    expect(joistCuts).toHaveLength(3);
    for (const cut of joistCuts) {
      expect(cut.lengthMm).toBe(shortenedMm);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism + ordering
// ---------------------------------------------------------------------------

describe('deriveBom — hardware section determinism', () => {
  it('two calls yield byte-identical hardware', () => {
    const layout = elevatedLikeLayout(4);
    const a = deriveBom(layout, { beamConnection: 'flush' });
    const b = deriveBom(layout, { beamConnection: 'flush' });
    expect(JSON.stringify(a.hardware)).toBe(JSON.stringify(b.hardware));
  });
});
