/**
 * `src/domain/layout/floating/floating-framing.test.ts` — TDD RED for
 * the floating-framing REWORK.
 *
 * ## Regression target — the UAT bug
 *
 * Before this ticket the floating pipeline emitted ZERO joists and
 * IGNORED `design.joist.spacingMm` entirely; decking was laid
 * directly on widely-spaced beams (per-column, along +z), and no
 * rim beams existed at the two z-ends. The regressions codified
 * here PIN that broken behavior CANNOT return:
 *
 *   1. Method A (default `'beams-and-joists'`) produces REAL joists
 *      at `design.joist.spacingMm` — count matches the same formula
 *      the elevated `layoutJoists` uses.
 *   2. Changing `joist.spacingMm` from 406 → 305 mm STRICTLY
 *      INCREASES the joist count (the core "spacing not working"
 *      regression).
 *   3. Method A emits EXACTLY 2 rim beams (near/far) at the two
 *      z-ends — fixes "no beam at two ends."
 *   4. Method B emits joists resting directly on blocks with NO
 *      beams — user-selectable via `design.floatingFraming`.
 *   5. Elevated layouts are BYTE-IDENTICAL to before (golden
 *      fixtures unchanged) — this file only spot-checks the top-
 *      level invariant; the golden fixtures test suite carries the
 *      byte-identity contract.
 *
 * See the ticket + specs/mvp-deck-designer/spec.md for the full
 * two-method model description.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';
import { computeLayout } from '../layout-engine';

import { computeFloatingLayout } from './floating-layout';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};

interface FloatOverrides {
  widthFt?: number;
  lengthFt?: number;
  heightMm?: Mm;
  spacingMm?: Mm;
  floatingFraming?: DeckDesign['floatingFraming'];
  foundation?: FoundationSpec;
}

function makeFloatingDesign(overrides: FloatOverrides = {}): DeckDesign {
  const widthMm = (overrides.widthFt ?? 16) * MM_PER_FOOT;
  const lengthMm = (overrides.lengthFt ?? 14) * MM_PER_FOOT;
  return {
    id: '00000000-0000-4000-8000-000000000f01',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: {
      widthMm,
      lengthMm,
      // heightMm must clear the min stack for the selected method.
      // 2×8 beam (184) + 2×8 joist (184) + 5/4×6 decking (25) = 393 mm.
      // 500 mm comfortably clears Method A; Method B's stack is
      // strictly smaller (no beam layer).
      heightMm: overrides.heightMm ?? 500,
    },
    structure: 'floating',
    foundation: overrides.foundation ?? TUFFBLOCK_FOUNDATION,
    joist: { material: PT_2X8, spacingMm: overrides.spacingMm ?? 406 },
    beam: { material: PT_2X8 },
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    floatingFraming: overrides.floatingFraming ?? 'beams-and-joists',
  };
}

// ---------------------------------------------------------------------------
// Method A — beams + joists on blocks (default)
// ---------------------------------------------------------------------------

describe('Method A (beams-and-joists): rim beams + real joists', () => {
  it('emits joists whose count matches the elevated formula for widthMm/spacingMm', () => {
    // widthMm = 16 ft = 4876.8 mm, joist thickness (2×8) = 38 mm,
    // spacingMm = 406 mm.
    // Elevated formula: ceil((widthMm - thickness) / spacingMm) + 1
    //                 = ceil((4876.8 - 38) / 406) + 1
    //                 = ceil(11.918) + 1 = 12 + 1 = 13.
    const design = makeFloatingDesign({ widthFt: 16, spacingMm: 406 });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    expect(joists.length).toBe(13);
  });

  it('CORE REGRESSION: changing joist.spacingMm from 406→305 STRICTLY INCREASES joist count', () => {
    // The whole point of this ticket. 16 ft wide:
    //   spacing 406 → 13 joists
    //   spacing 305 → ceil((4876.8-38)/305)+1 = ceil(15.867)+1 = 16+1 = 17
    const wide = { widthFt: 16 };
    const at406 = computeFloatingLayout(
      makeFloatingDesign({ ...wide, spacingMm: 406 }),
    );
    const at305 = computeFloatingLayout(
      makeFloatingDesign({ ...wide, spacingMm: 305 }),
    );
    const count406 = at406.members.filter((m) => m.kind === 'joist').length;
    const count305 = at305.members.filter((m) => m.kind === 'joist').length;
    expect(count406).toBe(13);
    expect(count305).toBe(17);
    expect(count305).toBeGreaterThan(count406);
  });

  it('joists run along +z (size.z === footprint.lengthMm) and are laid on-edge', () => {
    const design = makeFloatingDesign({ lengthFt: 14 });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    for (const j of joists) {
      // Full length on +z.
      expect(j.size.z).toBeCloseTo(design.footprint.lengthMm, 6);
      // Joist THICKNESS on +x (2×8 dressed widthMm = 38).
      expect(j.size.x).toBe(38);
      // Joist DEPTH on +y (2×8 dressed heightMm = 184) — on-edge.
      expect(j.size.y).toBe(184);
      // Centered on +z (running through the deck).
      expect(j.position.z).toBe(0);
    }
  });

  it('emits EXACTLY 2 rim beams (near + far) at the two z-ends', () => {
    const design = makeFloatingDesign();
    const layout = computeFloatingLayout(design);
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(2);
    // One beam at −z-half, one at +z-half. Both beams run along +x
    // (perpendicular to joists), size.x = deck width.
    const zValues = beams.map((b) => b.position.z).sort((a, b) => a - b);
    expect(zValues[0]).toBeLessThan(0);
    expect(zValues[1]).toBeGreaterThan(0);
    // Rim beams sit near the deck ends (positive inset — but the
    // sign of the two z values must be opposite).
    expect(Math.sign(zValues[0]!)).toBe(-1);
    expect(Math.sign(zValues[1]!)).toBe(1);
    for (const b of beams) {
      // Beam runs along +x — its size.x equals the deck width.
      expect(b.size.x).toBeCloseTo(design.footprint.widthMm, 6);
    }
  });

  it('beam ids include "near" and "far" markers (matches elevated BEAM_IDS convention)', () => {
    const design = makeFloatingDesign();
    const layout = computeFloatingLayout(design);
    const beamIds = layout.members
      .filter((m) => m.kind === 'beam')
      .map((b) => b.id);
    expect(beamIds).toContain('beam-near');
    expect(beamIds).toContain('beam-far');
  });

  it('block grid supports the beams (block rows at the beam z-positions)', () => {
    const design = makeFloatingDesign();
    const layout = computeFloatingLayout(design);
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    // Every beam must have at least one block directly under it (within
    // a few block-widths).
    for (const beam of beams) {
      const underBeam = blocks.filter(
        (b) => Math.abs(b.position.z - beam.position.z) < 400,
      );
      expect(underBeam.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('joists rest ON TOP of beams (joist bottom flush with beam top)', () => {
    const design = makeFloatingDesign();
    const layout = computeFloatingLayout(design);
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const joists = layout.members.filter((m) => m.kind === 'joist');
    expect(beams.length).toBeGreaterThan(0);
    expect(joists.length).toBeGreaterThan(0);
    // Beam top = beam.position.y + beam.size.y / 2.
    // Joist bottom = joist.position.y - joist.size.y / 2.
    const beamTopY = beams[0]!.position.y + beams[0]!.size.y / 2;
    const joistBottomY = joists[0]!.position.y - joists[0]!.size.y / 2;
    expect(joistBottomY).toBeCloseTo(beamTopY, 6);
  });

  it('decking rests ON TOP of joists (deck board bottom flush with joist top)', () => {
    const design = makeFloatingDesign();
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const boards = layout.members.filter((m) => m.kind === 'board');
    const joistTopY = joists[0]!.position.y + joists[0]!.size.y / 2;
    const boardBottomY = boards[0]!.position.y - boards[0]!.size.y / 2;
    expect(boardBottomY).toBeCloseTo(joistTopY, 6);
  });
});

// ---------------------------------------------------------------------------
// Method B — joists on blocks, no beams
// ---------------------------------------------------------------------------

describe('Method B (joists-on-blocks): joists directly on blocks, no beams', () => {
  it('emits joists at design.joist.spacingMm and ZERO beams', () => {
    const design = makeFloatingDesign({
      floatingFraming: 'joists-on-blocks',
    });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(joists.length).toBeGreaterThan(0);
    expect(beams.length).toBe(0);
  });

  it('joist count follows the SAME elevated formula (spacing → count)', () => {
    // Same formula as elevated / Method A.
    const design = makeFloatingDesign({
      widthFt: 16,
      spacingMm: 406,
      floatingFraming: 'joists-on-blocks',
    });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    expect(joists.length).toBe(13);
  });

  it('joists rest ON TOP of blocks (joist bottom flush with block top y=0)', () => {
    const design = makeFloatingDesign({
      floatingFraming: 'joists-on-blocks',
    });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    // Block top = 0 (block extends into -y).
    const blockTopY = blocks[0]!.position.y + blocks[0]!.size.y / 2;
    expect(blockTopY).toBeCloseTo(0, 6);
    const joistBottomY = joists[0]!.position.y - joists[0]!.size.y / 2;
    expect(joistBottomY).toBeCloseTo(0, 6);
  });

  it('decking sits directly on joists (Method B stack is decking → joists → blocks)', () => {
    const design = makeFloatingDesign({
      floatingFraming: 'joists-on-blocks',
    });
    const layout = computeFloatingLayout(design);
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const boards = layout.members.filter((m) => m.kind === 'board');
    const joistTopY = joists[0]!.position.y + joists[0]!.size.y / 2;
    const boardBottomY = boards[0]!.position.y - boards[0]!.size.y / 2;
    expect(boardBottomY).toBeCloseTo(joistTopY, 6);
  });
});

// ---------------------------------------------------------------------------
// Cross-method — height stack comparison
// ---------------------------------------------------------------------------

describe('Floating y-stack — method-dependent minimum height', () => {
  it('Method A stack is TALLER than Method B (adds a beam layer)', () => {
    // Method A above-ground: beam.depth + joist.depth + decking.thickness
    // Method B above-ground: joist.depth + decking.thickness
    // Delta = beam.depth (184 mm for 2×8).
    const methodA = makeFloatingDesign({
      floatingFraming: 'beams-and-joists',
      heightMm: 500,
    });
    const methodB = makeFloatingDesign({
      floatingFraming: 'joists-on-blocks',
      heightMm: 500,
    });
    const layoutA = computeFloatingLayout(methodA);
    const layoutB = computeFloatingLayout(methodB);
    // Decking top of A must be > decking top of B for the same
    // material inputs (an extra beam layer sits underneath).
    const deckA = layoutA.members.find((m) => m.kind === 'board');
    const deckB = layoutB.members.find((m) => m.kind === 'board');
    expect(deckA).toBeDefined();
    expect(deckB).toBeDefined();
    const topA = deckA!.position.y + deckA!.size.y / 2;
    const topB = deckB!.position.y + deckB!.size.y / 2;
    expect(topA).toBeGreaterThan(topB);
    // Delta approximately beam depth (184 mm for 2×8).
    expect(topA - topB).toBeCloseTo(184, 1);
  });
});

// ---------------------------------------------------------------------------
// Elevated regression — the elevated path is UNCHANGED
// ---------------------------------------------------------------------------

describe('Elevated path is unaffected by floatingFraming', () => {
  it('elevated layout ignores design.floatingFraming (byte-identical member counts)', () => {
    // Two elevated designs, one with each floatingFraming value.
    // The elevated pipeline reads only structure/foundation/joist/
    // beam/decking, so the two layouts must be deep-equal.
    const base: DeckDesign = {
      id: '11111111-1111-4111-8111-000000000001',
      createdAt: '2026-07-04T00:00:00.000Z',
      footprint: {
        widthMm: 12 * MM_PER_FOOT,
        lengthMm: 12 * MM_PER_FOOT,
        heightMm: 3 * MM_PER_FOOT,
      },
      structure: 'elevated',
      foundation: {
        type: 'posts-on-footings',
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        footing: { widthMm: 300, depthMm: 300 },
      },
      joist: { material: PT_2X8, spacingMm: 406 },
      beam: { material: PT_2X8 },
      decking: { material: PT_54, orientation: 'parallel-to-width' },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
      floatingFraming: 'beams-and-joists',
    };
    const layoutA = computeLayout(base, { now: () => base.createdAt });
    const layoutB = computeLayout(
      { ...base, floatingFraming: 'joists-on-blocks' },
      { now: () => base.createdAt },
    );
    // Identical member counts across every kind.
    const counts = (l: typeof layoutA): Record<string, number> => {
      const c: Record<string, number> = {};
      for (const m of l.members) c[m.kind] = (c[m.kind] ?? 0) + 1;
      return c;
    };
    expect(counts(layoutA)).toEqual(counts(layoutB));
  });
});

// ---------------------------------------------------------------------------
// Determinism — same input → deep-equal output
// ---------------------------------------------------------------------------

describe('Determinism — floating layout is a pure function of (design, now)', () => {
  it('two calls on the same design (both methods) produce deep-equal layouts', () => {
    for (const framing of [
      'beams-and-joists',
      'joists-on-blocks',
    ] as const) {
      const design = makeFloatingDesign({ floatingFraming: framing });
      const now = (): string => design.createdAt;
      const a = computeFloatingLayout(design, { now });
      const b = computeFloatingLayout(design, { now });
      expect(a).toEqual(b);
    }
  });
});
