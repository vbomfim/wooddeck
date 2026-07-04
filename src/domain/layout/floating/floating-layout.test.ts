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

  it('layout.bounds === design.footprint', () => {
    const design = makeFloating();
    const layout = computeFloatingLayout(design);
    expect(layout.bounds).toEqual(design.footprint);
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
