/**
 * `src/domain/layout/floating/floating-layout.test.ts` — TDD RED
 * phase for the floating-layout orchestrator (S19 — AC1, AC10, edges).
 *
 * ## Contract under test
 *
 * `computeFloatingLayout(design)` — asserted `design.structure ===
 * 'floating'` and `design.foundation.type ∈ {'deck-blocks','tuffblocks'}`
 * by the caller (the layout-engine dispatcher). Returns a `Layout`
 * with the SAME shape as the elevated pipeline:
 *
 *   - `designId = design.id`
 *   - `computedAt = options.now()` (identical injection pattern as
 *     elevated — locked to `design.createdAt` in tests for
 *     byte-stability)
 *   - `bounds = design.footprint`
 *   - `members = [...boards, ...blocking, ...beams, ...blocks]`
 *     (top-to-bottom order — matches the y-stack for a floating deck)
 *
 * ## AC1 — kinds present
 *
 * A floating layout has AT LEAST one `block`, one `beam`, one
 * `blocking`, one `board` — and ZERO `post` / `footing`.
 *
 * ## AC10 — user hand-drawn example
 *
 * A ≈16′×14′ floating deck on TuffBlocks with 2×8 PT beams produces
 * a block count within [24, 30] and beam count = 3.
 *
 * ## Edge — footprint below MIN_DECK_DIMENSION_MM throws
 *
 * The layout-engine's existing size guard extends to the floating
 * pipeline (via a shared validator; see the module implementation).
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import type { SpanTable } from '../../spans/span-table';
import { MM_PER_FOOT, type Mm } from '../../units';
import { LayoutError, MIN_DECK_DIMENSION_MM } from '../layout-engine';

import { computeFloatingLayout } from './floating-layout';

const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK_FOUNDATION: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};
const OLDCASTLE_FOUNDATION: FoundationSpec = {
  type: 'deck-blocks',
  product: { productId: 'oldcastle-11x11x7' },
};

function makeFloating(overrides: Partial<{
  widthFt: number;
  lengthFt: number;
  widthMm: Mm;
  lengthMm: Mm;
  heightMm: Mm;
  foundation: FoundationSpec;
  beam: MaterialRef;
  decking: MaterialRef;
}> = {}): DeckDesign {
  const widthMm = overrides.widthMm ?? (overrides.widthFt ?? 16) * MM_PER_FOOT;
  const lengthMm =
    overrides.lengthMm ?? (overrides.lengthFt ?? 14) * MM_PER_FOOT;
  return {
    id: '00000000-0000-4000-8000-000000000019',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: {
      widthMm,
      lengthMm,
      heightMm: overrides.heightMm ?? 300,
    },
    structure: 'floating',
    foundation: overrides.foundation ?? TUFFBLOCK_FOUNDATION,
    joist: { material: overrides.beam ?? PT_2X8, spacingMm: 406 },
    beam: { material: overrides.beam ?? PT_2X8 },
    decking: {
      material: overrides.decking ?? PT_54,
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

// ---------------------------------------------------------------------------
// AC1 — kinds present / absent
// ---------------------------------------------------------------------------

describe('computeFloatingLayout — AC1 kinds contract', () => {
  it('produces at least one block, beam, blocking, board and ZERO posts / footings (TuffBlock)', () => {
    const design = makeFloating();
    const layout = computeFloatingLayout(design);
    const kinds = new Set(layout.members.map((m) => m.kind));
    expect(kinds).toContain('block');
    expect(kinds).toContain('beam');
    expect(kinds).toContain('blocking');
    expect(kinds).toContain('board');
    expect(kinds).not.toContain('post');
    expect(kinds).not.toContain('footing');
    expect(kinds).not.toContain('joist'); // no joists in a floating layout
  });

  it('AC1 also holds for a deck-blocks foundation (Oldcastle path)', () => {
    const design = makeFloating({ foundation: OLDCASTLE_FOUNDATION });
    const layout = computeFloatingLayout(design);
    const kinds = new Set(layout.members.map((m) => m.kind));
    expect(kinds).toContain('block');
    expect(kinds).toContain('beam');
    expect(kinds).toContain('blocking');
    expect(kinds).toContain('board');
    expect(kinds).not.toContain('post');
    expect(kinds).not.toContain('footing');
  });

  it('every block member stamps productId matching the design foundation product', () => {
    const design = makeFloating(); // TuffBlock
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b.material.kind).toBe('block');
      if (b.material.kind === 'block') {
        expect(b.material.productId).toBe('tuffblock-12x12x4');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC10 — user's hand-drawn example (16 ft × 14 ft TuffBlock + 2x8 PT)
// ---------------------------------------------------------------------------

describe('computeFloatingLayout — AC10 user example', () => {
  it('16 ft × 14 ft TuffBlock + 2x8 PT beams → beam count = 3, block count ∈ [24, 30]', () => {
    const design = makeFloating({ widthFt: 16, lengthFt: 14, beam: PT_2X8 });
    const layout = computeFloatingLayout(design);
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(beams.length).toBe(3);
    expect(blocks.length).toBeGreaterThanOrEqual(24);
    expect(blocks.length).toBeLessThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// Layout shape — designId, computedAt injection, bounds
// ---------------------------------------------------------------------------

describe('computeFloatingLayout — layout shape', () => {
  it('layout.designId === design.id', () => {
    const design = makeFloating();
    const layout = computeFloatingLayout(design);
    expect(layout.designId).toBe(design.id);
  });

  it('computedAt is injected via options.now (byte-deterministic)', () => {
    const design = makeFloating();
    const fixedNow = () => '2099-01-01T00:00:00.000Z';
    const layout = computeFloatingLayout(design, { now: fixedNow });
    expect(layout.computedAt).toBe('2099-01-01T00:00:00.000Z');
  });

  it('layout.bounds enclose the outer-block overhang (FIX 3: AABB, not footprint)', () => {
    // Blocks overhang the footprint by ~½ block on each side (AC4).
    // Layout.bounds MUST therefore be STRICTLY LARGER than
    // design.footprint in width + length so the S22 scene camera
    // frames the true extent (and blocks don't clip out of view).
    // Also below-grade extent adds to heightMm.
    const design = makeFloating();
    const layout = computeFloatingLayout(design);

    // Bounds widen by product.actual.widthMm/depthMm (½ on each side ×2).
    // TuffBlock 12x12 → 305mm actual; expect ~+305 each dim.
    expect(layout.bounds.widthMm).toBeGreaterThan(design.footprint.widthMm);
    expect(layout.bounds.lengthMm).toBeGreaterThan(design.footprint.lengthMm);
    // Below-grade blocks push heightMm past design.footprint.heightMm.
    expect(layout.bounds.heightMm).toBeGreaterThan(design.footprint.heightMm);
  });

  it('layout.bounds match the true AABB of members (numeric)', () => {
    const design = makeFloating();
    const layout = computeFloatingLayout(design);
    // Independent AABB computation from the members themselves.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const m of layout.members) {
      minX = Math.min(minX, m.position.x - m.size.x / 2);
      maxX = Math.max(maxX, m.position.x + m.size.x / 2);
      minY = Math.min(minY, m.position.y - m.size.y / 2);
      maxY = Math.max(maxY, m.position.y + m.size.y / 2);
      minZ = Math.min(minZ, m.position.z - m.size.z / 2);
      maxZ = Math.max(maxZ, m.position.z + m.size.z / 2);
    }
    expect(layout.bounds.widthMm).toBeCloseTo(maxX - minX, 6);
    expect(layout.bounds.lengthMm).toBeCloseTo(maxZ - minZ, 6);
    expect(layout.bounds.heightMm).toBeCloseTo(maxY - minY, 6);
  });

  it('member ids are globally unique across all kinds', () => {
    const design = makeFloating();
    const layout = computeFloatingLayout(design);
    const ids = layout.members.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Edge — MIN_DECK_DIMENSION_MM guard (must fire in the floating path too)
// ---------------------------------------------------------------------------

describe('computeFloatingLayout — trust-boundary defensive checks', () => {
  it('throws LayoutError when widthMm is below MIN_DECK_DIMENSION_MM', () => {
    const design = makeFloating({ widthMm: (MIN_DECK_DIMENSION_MM - 1) });
    expect(() => computeFloatingLayout(design)).toThrow(LayoutError);
    expect(() => computeFloatingLayout(design)).toThrow(/width/i);
  });

  it('throws LayoutError when lengthMm is below MIN_DECK_DIMENSION_MM', () => {
    const design = makeFloating({ lengthMm: (MIN_DECK_DIMENSION_MM - 1) });
    expect(() => computeFloatingLayout(design)).toThrow(LayoutError);
    expect(() => computeFloatingLayout(design)).toThrow(/length/i);
  });

  it('throws LayoutError when heightMm is below the floating minimum stack (beam.h + decking.thickness)', () => {
    // 2x8 beam depth 184 + 5/4x6 decking thickness 25 = 209 mm.
    // 100 mm is well below → LayoutError expected.
    const design = makeFloating({ heightMm: 100 });
    expect(() => computeFloatingLayout(design)).toThrow(LayoutError);
    expect(() => computeFloatingLayout(design)).toThrow(/height/i);
  });

  it('throws when called with a non-floating design (caller-contract violation)', () => {
    // The layout-engine dispatcher normally guards this, but the
    // orchestrator must also fail-loud so a test / future caller
    // that skips the dispatcher doesn't silently produce nonsense.
    const bad: DeckDesign = {
      ...makeFloating(),
      structure: 'elevated',
      foundation: {
        type: 'posts-on-footings',
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        footing: { widthMm: 300, depthMm: 300 },
      },
    };
    expect(() => computeFloatingLayout(bad)).toThrow(/floating/i);
  });
});

// ---------------------------------------------------------------------------
// Review-gate FIX 2 — foundation-block × beam-nominal compatibility (FR-028)
// ---------------------------------------------------------------------------
//
// A floating design that pairs a foundation-block product with a
// beam nominal the block does not accept is physically invalid: the
// beam sits on a bearing surface the manufacturer did not size for.
// The orchestrator MUST reject at the trust boundary before the
// grid math runs.
//
// Data source: `foundation-catalog.ts` — the `acceptsLumber` array
// per product. Current MVP catalog:
//   - `tuffblock-12x12x4`   → accepts 2×6, 2×8       (rejects 2×10, 2×12)
//   - `oldcastle-11x11x7`   → accepts 2×6, 2×8, 2×10 (rejects 2×12)

describe('computeFloatingLayout — FIX 2 acceptsLumber compat', () => {
  it('throws LayoutError when TuffBlock is paired with a 2x10 beam', () => {
    // TuffBlock accepts only 2×6 / 2×8. A 2×10 beam is FR-028-invalid.
    const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
    const design = makeFloating({
      foundation: TUFFBLOCK_FOUNDATION,
      beam: PT_2X10,
      heightMm: 400, // clear the min-stack floor for 2x10
    });
    expect(() => computeFloatingLayout(design)).toThrow(LayoutError);
    expect(() => computeFloatingLayout(design)).toThrow(/2x10/);
    expect(() => computeFloatingLayout(design)).toThrow(/tuffblock/i);
  });

  it('throws LayoutError when Oldcastle is paired with a 2x12 beam', () => {
    // Oldcastle accepts 2×6 / 2×8 / 2×10 — 2×12 is FR-028-invalid.
    const PT_2X12: MaterialRef = { nominal: '2x12', species: 'PT', grade: 'No2' };
    const design = makeFloating({
      foundation: OLDCASTLE_FOUNDATION,
      beam: PT_2X12,
      heightMm: 450, // clear the min-stack floor for 2x12
    });
    expect(() => computeFloatingLayout(design)).toThrow(LayoutError);
    expect(() => computeFloatingLayout(design)).toThrow(/2x12/);
    expect(() => computeFloatingLayout(design)).toThrow(/oldcastle/i);
  });

  it('does NOT throw when Oldcastle is paired with a 2x10 beam (supported combo)', () => {
    const PT_2X10: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
    const design = makeFloating({
      foundation: OLDCASTLE_FOUNDATION,
      beam: PT_2X10,
      heightMm: 400,
    });
    expect(() => computeFloatingLayout(design)).not.toThrow();
  });

  it('does NOT throw when TuffBlock is paired with a 2x8 beam (default combo)', () => {
    const design = makeFloating({
      foundation: TUFFBLOCK_FOUNDATION,
      beam: PT_2X8,
    });
    expect(() => computeFloatingLayout(design)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Review-gate FIX 5 — edge cases + defensive tests
// ---------------------------------------------------------------------------

describe('computeFloatingLayout — FIX 5 edges', () => {
  it('AC1 edge: a 4×4 minimum deck produces ZERO blocking pieces (physically correct — beam-pair gap < 48″ min-spacing)', () => {
    // A 4×4 min deck has 2 beams at ±half-width. Beam-pair gap is
    // less than the IRC-R502.7 48″ (1220 mm) minimum blocking
    // spacing → NO blocking is required (a single bracing piece
    // between beams would be dead weight, not add rigidity). The
    // "≥1 blocking" invariant only holds for beam-count ≥ 2 AND
    // length ≥ MAX_BLOCKING_SPACING_MM.
    const design = makeFloating({ widthFt: 4, lengthFt: 4 });
    const layout = computeFloatingLayout(design);
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    expect(blocking.length).toBe(0);
  });

  it('AC4 edge: outer-block centers lie exactly on the footprint edges (½-block overhang under the rim)', () => {
    // The FR-029/AC4 geometry: the outermost block CENTERS anchor at
    // ±widthMm/2 and ±lengthMm/2. That means each outer block extends
    // half its product width/depth OUTSIDE the deck footprint — a
    // deliberate ½-block overhang under the rim beam (matches the
    // user's hand-drawn example). The AABB bounds (FIX 3) must widen
    // by exactly product.actual.widthMm (½ on each side ×2).
    const design = makeFloating(); // 16×14 TuffBlock — 305×305 mm blocks
    const layout = computeFloatingLayout(design);
    const productWidthMm = 305;
    // Bounds should be footprint + product width (½ + ½).
    expect(layout.bounds.widthMm).toBeCloseTo(
      design.footprint.widthMm + productWidthMm,
      6,
    );
    expect(layout.bounds.lengthMm).toBeCloseTo(
      design.footprint.lengthMm + productWidthMm,
      6,
    );
  });

  it('blocking uniformity invariant: every blocking piece between the same beam-pair has identical size.x', () => {
    // AC6: blocking members are cut to fit between adjacent beams.
    // Between one beam PAIR every blocking piece MUST share one
    // length (they occupy the same gap). This is invariant even
    // though S21 has already merged its BOM aggregator.
    const design = makeFloating();
    const layout = computeFloatingLayout(design);
    const beams = layout.members.filter((m) => m.kind === 'beam');
    // Sort beams by x so we can partition blocking by which pair
    // they sit between.
    const beamsSorted = [...beams].sort((a, b) => a.position.x - b.position.x);
    const blockings = layout.members.filter((m) => m.kind === 'blocking');
    for (let i = 0; i < beamsSorted.length - 1; i++) {
      const left = beamsSorted[i]!;
      const right = beamsSorted[i + 1]!;
      const midX = (left.position.x + right.position.x) / 2;
      // Blocking between this pair has position.x ≈ midX (within
      // half a beam width).
      const inPair = blockings.filter(
        (b) => Math.abs(b.position.x - midX) < 50,
      );
      if (inPair.length < 2) continue;
      const size0 = inPair[0]!.size.x;
      for (const b of inPair) {
        expect(b.size.x).toBeCloseTo(size0, 6);
      }
    }
  });

  it('degenerate single-beam case: computeFloatingBeams handles a design whose width forces exactly one beam column', () => {
    // A design narrower than BEAM_TO_BEAM_MAX_SPACING_MM (2438 mm ≈ 8 ft)
    // still produces ≥ 1 beam. Verified indirectly via a 4×20 layout:
    // 4 ft width = 1219 mm < 2438 mm → ceil(1219/2438)+1 = 1+1 = 2
    // beams. To force `numBeams === 1` we'd need width ≤ 0, which
    // the trust boundary rejects. So this test asserts the smallest
    // legal deck (4 ft width) yields 2 beams — the boundary is
    // proved unreachable and any future change to the formula that
    // could produce 1 beam would break this test.
    const design = makeFloating({ widthFt: 4, lengthFt: 20 });
    const layout = computeFloatingLayout(design);
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBe(2);
  });

  it('beam-max-span exceeds deck length edge (small deck → 2×2 block grid minimum)', () => {
    // Ticket §4b: a deck whose length is below the derived block-row
    // spacing still gets a 2×2 grid — the outer-block anchoring rule
    // forces 2 rows minimum (one at each length edge), guaranteeing
    // any beam has 2 supports. A 4×4 min deck exercises this: 4 ft
    // ≈ 1219 mm << 610 mm block-row spacing does NOT hold (1219 > 610);
    // ceil(1219/610)+1 = 2+1 = 3 rows. Small enough to check every
    // grid cell exists.
    const design = makeFloating({ widthFt: 4, lengthFt: 4 });
    const layout = computeFloatingLayout(design);
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // At minimum a 2×2 grid = 4 blocks. Actual: 2 cols × 3 rows = 6.
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    // Verify grid: unique x-positions ≥ 2, unique z-positions ≥ 2.
    const uniqX = new Set(blocks.map((b) => b.position.x));
    const uniqZ = new Set(blocks.map((b) => b.position.z));
    expect(uniqX.size).toBeGreaterThanOrEqual(2);
    expect(uniqZ.size).toBeGreaterThanOrEqual(2);
  });

  it('performance: a 4×20 floating layout runs in well under 16 ms (ticket §9)', () => {
    // ticket §9 sets a 16 ms budget for computeLayout to keep the
    // parameter-panel edit → 3D scene loop < 60 fps-worst-case. On
    // CI hardware a 4×20 floating layout with 2 beams × ~11 block
    // rows = 22 blocks + 2 beams + boards + blocking runs in ~1 ms
    // locally. We allow a generous 32 ms budget for CI variance
    // (2× the 16 ms target — a failure here still indicates a real
    // regression, and the local-dev-fast bound stays tight).
    const design = makeFloating({ widthFt: 4, lengthFt: 20 });
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      // 10 iterations → per-call time; smoothes JIT warmup + timer
      // jitter without inflating the assertion.
      computeFloatingLayout(design);
    }
    const perCall = (performance.now() - start) / 10;
    expect(perCall).toBeLessThan(32);
  });

  it('non-square deck: an 8×40 floating layout produces a rectangular grid with correct row/col counts', () => {
    // A non-square floating deck exercises the two axis-independent
    // grid formulas together. 8 ft width / 8 ft beam-max = 1 span
    // + 1 = 2 beams; 40 ft length / 24 in block-row-max ≈ 20 rows.
    // Golden count = 2 × ~21 = ~42 blocks (row-count = ceil + 1
    // gives 21). Uses OLDCASTLE_FOUNDATION so we can pair with any
    // supported lumber.
    const design = makeFloating({
      widthFt: 8,
      lengthFt: 40,
      foundation: OLDCASTLE_FOUNDATION,
    });
    const layout = computeFloatingLayout(design);
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(beams.length).toBe(2);
    // uniqX = 2, uniqZ ≈ 21 → 42 blocks.
    expect(blocks.length).toBeGreaterThanOrEqual(38);
    expect(blocks.length).toBeLessThanOrEqual(44);
    // Verify rectangular (not accidentally square) — bounds are
    // clearly non-square.
    expect(layout.bounds.lengthMm).toBeGreaterThan(layout.bounds.widthMm * 4);
  });

  it('defensive raw-Error wrap: an internal non-LayoutError thrown by a downstream helper surfaces as a LayoutError (line 262)', () => {
    // The orchestrator catches `err` inside `try { … } catch(err) {
    // if (err instanceof LayoutError) throw err; throw new LayoutError(
    //   'computeFloatingLayout failed: …', { cause: err }); }`. The
    // instanceof-check branch is exercised by every trust-boundary
    // failure; the "wrap raw Error" branch is exercised only when a
    // helper throws a *plain* Error (a bug in a domain module).
    //
    // We simulate by injecting a SpanTable whose `lookupBeamMaxSpan`
    // throws a plain Error — this is called from
    // `deriveBlockRowMaxSpacingMm` early in the pipeline. The
    // resulting LayoutError MUST wrap the plain Error's message.
    const design = makeFloating();
    const throwingTable: SpanTable = {
      edition: 'THROW',
      lookupJoistMaxSpan: () => 0,
      lookupBeamMaxSpan: () => {
        throw new Error('deliberate downstream failure');
      },
      citationFor: () => '',
    };
    expect(() =>
      computeFloatingLayout(design, { spanTable: throwingTable }),
    ).toThrow(LayoutError);
    expect(() =>
      computeFloatingLayout(design, { spanTable: throwingTable }),
    ).toThrow(/deliberate downstream failure/);
    expect(() =>
      computeFloatingLayout(design, { spanTable: throwingTable }),
    ).toThrow(/computeFloatingLayout failed/);
  });
});
