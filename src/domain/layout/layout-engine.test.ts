/**
 * Unit tests for `src/domain/layout/layout-engine.ts` — TDD RED phase.
 *
 * Covers:
 *   - AC6 complete render contract: every member has position, size (nonzero on
 *     all 3 axes when heightMm > 0), rotation, kind, material, id.
 *   - AC7 determinism: identical design → identical Layout (with computedAt
 *     injected to a fixed clock so the timestamp is stable).
 *   - LayoutError contract: throws for width/length below MIN_DECK_DIMENSION_MM,
 *     for negative dims, for spacing ≤ 0, and for unknown material triples.
 *   - `Layout.designId === design.id`, `Layout.bounds` matches footprint.
 *   - Every MemberKind is represented in the output.
 */
import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT } from '../units';
import type { DeckDesign, MemberKind } from '../model';

import { LayoutError, MIN_DECK_DIMENSION_MM, computeLayout } from './layout-engine';

function makeDesign(overrides: Partial<{
  widthMm: number;
  lengthMm: number;
  heightMm: number;
  spacingMm: number;
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000005',
    createdAt: '2026-07-02T00:00:00.000Z',
    footprint: {
      widthMm: overrides.widthMm ?? 3660,
      lengthMm: overrides.lengthMm ?? 4880,
      heightMm: overrides.heightMm ?? 914,
    },
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: overrides.spacingMm ?? 406,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
    post: { material: { nominal: '6x6', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

describe('computeLayout — AC6 complete render contract', () => {
  it('produces a Layout with designId matching the source design', () => {
    const design = makeDesign();
    const layout = computeLayout(design);
    expect(layout.designId).toBe(design.id);
  });

  it('produces a Layout whose bounds mirror the source footprint', () => {
    const design = makeDesign({ widthMm: 3660, lengthMm: 4880, heightMm: 914 });
    const layout = computeLayout(design);
    expect(layout.bounds).toEqual(design.footprint);
  });

  it('every member has non-undefined position, size, rotation, kind, material, id', () => {
    const layout = computeLayout(makeDesign());
    for (const m of layout.members) {
      expect(m.id).toBeTypeOf('string');
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.kind).toBeTypeOf('string');
      expect(m.material).toBeDefined();
      expect(m.material.nominal).toBeDefined();
      expect(m.material.species).toBeDefined();
      expect(m.material.grade).toBeDefined();
      expect(m.position.x).toBeTypeOf('number');
      expect(m.position.y).toBeTypeOf('number');
      expect(m.position.z).toBeTypeOf('number');
      expect(m.size.x).toBeTypeOf('number');
      expect(m.size.y).toBeTypeOf('number');
      expect(m.size.z).toBeTypeOf('number');
      expect(m.rotation.x).toBeTypeOf('number');
      expect(m.rotation.y).toBeTypeOf('number');
      expect(m.rotation.z).toBeTypeOf('number');
    }
  });

  it('every member has non-zero size on all 3 axes for a typical design (heightMm > 0)', () => {
    // AC6 as ticket-worded; the height=0 edge case is exercised separately in
    // post-layout.test.ts where posts intentionally collapse to zero y-extent.
    const layout = computeLayout(makeDesign());
    for (const m of layout.members) {
      expect(m.size.x).toBeGreaterThan(0);
      expect(m.size.y).toBeGreaterThan(0);
      expect(m.size.z).toBeGreaterThan(0);
    }
  });

  it('all five MemberKind values appear in members[]', () => {
    const layout = computeLayout(makeDesign());
    const kinds = new Set<MemberKind>(layout.members.map((m) => m.kind));
    expect(kinds).toEqual(new Set<MemberKind>(['joist', 'beam', 'post', 'footing', 'board']));
  });

  it('every member id is unique across the whole layout', () => {
    const layout = computeLayout(makeDesign());
    const ids = layout.members.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('computeLayout — AC7 determinism', () => {
  it('same design + injected clock → deeply equal layouts (including computedAt)', () => {
    const design = makeDesign();
    const now = () => '2026-07-02T12:00:00.000Z';
    const a = computeLayout(design, { now });
    const b = computeLayout(design, { now });
    expect(a).toEqual(b);
  });

  it('same design across two calls → equal layouts ignoring computedAt (default clock)', () => {
    const design = makeDesign();
    const a = computeLayout(design);
    const b = computeLayout(design);
    const { computedAt: _a, ...ax } = a;
    const { computedAt: _b, ...bx } = b;
    expect(ax).toEqual(bx);
  });

  it('the injected now() is called exactly once per layout compute', () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      return '2026-07-02T00:00:00.000Z';
    };
    computeLayout(makeDesign(), { now });
    expect(calls).toBe(1);
  });

  it('the default clock produces a valid ISO-8601 timestamp', () => {
    const layout = computeLayout(makeDesign());
    // ISO-8601 with milliseconds and Z suffix.
    expect(layout.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('computeLayout — LayoutError contract', () => {
  it('throws LayoutError when widthMm is below MIN_DECK_DIMENSION_MM', () => {
    const design = makeDesign({ widthMm: MIN_DECK_DIMENSION_MM - 1 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    expect(() => computeLayout(design)).toThrow(/width/i);
  });

  it('throws LayoutError when lengthMm is below MIN_DECK_DIMENSION_MM', () => {
    const design = makeDesign({ lengthMm: MIN_DECK_DIMENSION_MM - 1 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    expect(() => computeLayout(design)).toThrow(/length/i);
  });

  it('throws LayoutError when widthMm is negative', () => {
    const design = makeDesign({ widthMm: -100 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
  });

  it('throws LayoutError when heightMm is negative', () => {
    const design = makeDesign({ heightMm: -100 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
  });

  it('throws LayoutError when spacingMm is zero', () => {
    const design = makeDesign({ spacingMm: 0 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    expect(() => computeLayout(design)).toThrow(/spacing/i);
  });

  it('throws LayoutError when spacingMm is negative', () => {
    const design = makeDesign({ spacingMm: -406 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
  });

  it('LayoutError is a subclass of Error and has name "LayoutError"', () => {
    try {
      computeLayout(makeDesign({ widthMm: 0 }));
      throw new Error('expected LayoutError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(LayoutError);
      expect((err as Error).name).toBe('LayoutError');
    }
  });

  it('accepts the minimum viable 4 ft × 4 ft × 1 ft design without throwing', () => {
    const design = makeDesign({
      widthMm: 4 * MM_PER_FOOT,
      lengthMm: 4 * MM_PER_FOOT,
      heightMm: MM_PER_FOOT,
    });
    expect(() => computeLayout(design)).not.toThrow();
    // And the minimum-viable member counts are met (edge case in ticket).
    const layout = computeLayout(design);
    const byKind = (k: MemberKind) => layout.members.filter((m) => m.kind === k);
    expect(byKind('joist').length).toBeGreaterThanOrEqual(2);
    expect(byKind('beam').length).toBe(2);
    expect(byKind('post').length).toBeGreaterThanOrEqual(4);
    expect(byKind('footing').length).toBe(byKind('post').length);
    expect(byKind('board').length).toBeGreaterThan(0);
  });
});

describe('computeLayout — MIN_DECK_DIMENSION_MM', () => {
  it('MIN_DECK_DIMENSION_MM is exactly 4 ft (unrounded)', () => {
    expect(MIN_DECK_DIMENSION_MM).toBe(4 * MM_PER_FOOT);
  });
});
