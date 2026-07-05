/**
 * `PlanView2D.helpers.test.ts` — S15 issue #16.
 *
 * Unit tests for the PURE helpers backing `<PlanView2D>`. Keeping
 * the geometry math in a plain `.ts` file lets us test every
 * projection / spacing / desc-builder rule WITHOUT rendering React
 * + jsdom + SVG for each assertion.
 *
 * ## What lives here (single-responsibility per helper)
 *
 *   - `mmToSvg(mm)`            — magnitude passthrough (viewBox is
 *                                 in mm, so 1 mm ↔ 1 user unit).
 *   - `worldXToSvgX`           — world +x → SVG x (translate so
 *                                 origin at footprint center → 0).
 *   - `worldZToSvgY`           — world +z → SVG y (FLIP: bigger z
 *                                 renders UP, i.e. smaller SVG y).
 *   - `computeSvgViewBox`      — the `viewBox` string + width/length
 *                                 (used by the <svg viewBox=…>).
 *   - `projectRect`            — top-down rect for a rectangular
 *                                 member (joist / beam / board /
 *                                 footing / block / blocking).
 *   - `projectCenter`          — 2D center for a post circle.
 *   - `computeJoistSpacingMm`  — nearest-neighbor delta along z.
 *                                 The `<desc>` announces this.
 *   - `formatFootprintLabel`   — "12′ 0″ × 16′ 0″" (or metric).
 *   - `buildPlanDescription`   — the a11y `<desc>` sentence.
 */
import { describe, expect, it } from 'vitest';

import type { Layout, LayoutMember } from '../domain/model';
import { MM_PER_FOOT } from '../domain/units';

import {
  buildPlanDescription,
  computeJoistSpacingMm,
  computeSvgViewBox,
  formatFootprintLabel,
  mmToSvg,
  projectCenter,
  projectRect,
  worldXToSvgX,
  worldZToSvgY,
} from './PlanView2D.helpers';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BOUNDS_12x16_FT = Object.freeze({
  widthMm: 12 * MM_PER_FOOT, // 3657.6 mm
  lengthMm: 16 * MM_PER_FOOT, // 4876.8 mm
  heightMm: 3 * MM_PER_FOOT,
});

function makeMember(
  overrides: Partial<LayoutMember> & Pick<LayoutMember, 'kind'>,
): LayoutMember {
  return {
    id: overrides.id ?? `m-${overrides.kind}-${Math.random().toString(36).slice(2)}`,
    kind: overrides.kind,
    position: overrides.position ?? { x: 0, y: 0, z: 0 },
    size: overrides.size ?? { x: 38, y: 184, z: 3658 },
    rotation: overrides.rotation ?? { x: 0, y: 0, z: 0 },
    material: overrides.material ?? {
      kind: 'lumber',
      species: 'PT',
      grade: 'No2',
      nominal: '2x8',
    },
  };
}

function makeJoistLayout(spacingMm: number, count: number): Layout {
  const members: LayoutMember[] = [];
  const lengthMm = 4877;
  // Center around z=0, so joist z positions run from -(count-1)/2 * spacing → +
  const half = ((count - 1) * spacingMm) / 2;
  for (let i = 0; i < count; i++) {
    members.push(
      makeMember({
        kind: 'joist',
        id: `joist-${String(i)}`,
        position: { x: 0, y: 100, z: -half + i * spacingMm },
        // A joist runs along the width axis (x) — thin in z.
        size: { x: 3658, y: 184, z: 38 },
      }),
    );
  }
  return {
    designId: 'test',
    computedAt: '2024-01-01T00:00:00.000Z',
    bounds: { widthMm: 3658, lengthMm, heightMm: 900 },
    members,
  };
}

// ---------------------------------------------------------------------------
// mmToSvg
// ---------------------------------------------------------------------------

describe('mmToSvg', () => {
  it('is an identity — the viewBox is expressed in mm so 1 mm = 1 user unit', () => {
    expect(mmToSvg(0)).toBe(0);
    expect(mmToSvg(1000)).toBe(1000);
    expect(mmToSvg(3657.6)).toBe(3657.6);
  });

  it('rejects a NaN input with a typed error', () => {
    expect(() => mmToSvg(Number.NaN)).toThrow(/finite/i);
  });

  it('rejects a non-finite input (Infinity)', () => {
    expect(() => mmToSvg(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
  });
});

// ---------------------------------------------------------------------------
// worldXToSvgX — translate so origin=center becomes origin=left edge
// ---------------------------------------------------------------------------

describe('worldXToSvgX', () => {
  it('maps world x=0 (footprint CENTER) to widthMm/2 (SVG midline)', () => {
    expect(worldXToSvgX(0, 4000)).toBe(2000);
  });

  it('maps world x=-widthMm/2 (LEFT edge) to SVG x=0', () => {
    expect(worldXToSvgX(-2000, 4000)).toBe(0);
  });

  it('maps world x=+widthMm/2 (RIGHT edge) to SVG x=widthMm', () => {
    expect(worldXToSvgX(2000, 4000)).toBe(4000);
  });
});

// ---------------------------------------------------------------------------
// worldZToSvgY — translate AND flip (SVG y grows downward, world +z is "up")
// ---------------------------------------------------------------------------

describe('worldZToSvgY', () => {
  it('maps world z=0 (footprint CENTER) to lengthMm/2 (SVG midline)', () => {
    expect(worldZToSvgY(0, 4000)).toBe(2000);
  });

  it('FLIPS: world z=+lengthMm/2 (far edge — "top") → SVG y=0 (top of svg)', () => {
    expect(worldZToSvgY(2000, 4000)).toBe(0);
  });

  it('FLIPS: world z=-lengthMm/2 (near edge — "bottom") → SVG y=lengthMm', () => {
    expect(worldZToSvgY(-2000, 4000)).toBe(4000);
  });
});

// ---------------------------------------------------------------------------
// computeSvgViewBox
// ---------------------------------------------------------------------------

describe('computeSvgViewBox', () => {
  it('emits a "0 0 W L" viewBox string for a 12×16 ft footprint', () => {
    const vb = computeSvgViewBox(BOUNDS_12x16_FT);
    expect(vb.viewBoxAttr).toBe(`0 0 ${String(BOUNDS_12x16_FT.widthMm)} ${String(BOUNDS_12x16_FT.lengthMm)}`);
    expect(vb.widthMm).toBe(BOUNDS_12x16_FT.widthMm);
    expect(vb.lengthMm).toBe(BOUNDS_12x16_FT.lengthMm);
  });

  it('accepts a very-wide 40×8 ft footprint (AC3 letterbox case)', () => {
    const bounds = { widthMm: 40 * MM_PER_FOOT, lengthMm: 8 * MM_PER_FOOT, heightMm: 900 };
    const vb = computeSvgViewBox(bounds);
    expect(vb.viewBoxAttr).toBe(`0 0 ${String(40 * MM_PER_FOOT)} ${String(8 * MM_PER_FOOT)}`);
  });

  it('rejects a zero/negative widthMm (invalid bounds)', () => {
    expect(() => computeSvgViewBox({ widthMm: 0, lengthMm: 1000, heightMm: 100 })).toThrow(
      /positive/i,
    );
    expect(() => computeSvgViewBox({ widthMm: -1, lengthMm: 1000, heightMm: 100 })).toThrow(
      /positive/i,
    );
  });

  it('rejects a zero/negative lengthMm', () => {
    expect(() => computeSvgViewBox({ widthMm: 1000, lengthMm: 0, heightMm: 100 })).toThrow(
      /positive/i,
    );
  });
});

// ---------------------------------------------------------------------------
// projectRect
// ---------------------------------------------------------------------------

describe('projectRect', () => {
  const bounds = { widthMm: 4000, lengthMm: 6000, heightMm: 900 };

  it('projects a member centered at world (0,y,0) to the SVG center rect (x,y = TL corner)', () => {
    const rect = projectRect(
      { x: 0, y: 100, z: 0 },
      { x: 3000, y: 184, z: 38 },
      bounds,
    );
    // TL corner = center - (size/2).
    expect(rect.x).toBeCloseTo(bounds.widthMm / 2 - 1500);
    expect(rect.y).toBeCloseTo(bounds.lengthMm / 2 - 19);
    expect(rect.width).toBe(3000);
    expect(rect.height).toBe(38);
  });

  it('a joist at world +z (far side) sits ABOVE center in SVG (smaller y)', () => {
    const rect = projectRect(
      { x: 0, y: 100, z: 2000 },
      { x: 3000, y: 184, z: 38 },
      bounds,
    );
    // svg-y-center for this z = bounds.lengthMm/2 - 2000 = 1000. TL corner = 1000 - 19 = 981.
    expect(rect.y).toBeCloseTo(981);
  });

  it('a joist at world -z (near side) sits BELOW center in SVG (larger y)', () => {
    const rect = projectRect(
      { x: 0, y: 100, z: -2000 },
      { x: 3000, y: 184, z: 38 },
      bounds,
    );
    // svg-y-center = bounds.lengthMm/2 - (-2000) = 5000. TL corner = 5000 - 19 = 4981.
    expect(rect.y).toBeCloseTo(4981);
  });
});

// ---------------------------------------------------------------------------
// projectCenter (for post circles)
// ---------------------------------------------------------------------------

describe('projectCenter', () => {
  const bounds = { widthMm: 4000, lengthMm: 6000, heightMm: 900 };

  it('projects a post at world (1000, 0, -2000) to the correct SVG (x, y)', () => {
    const c = projectCenter({ x: 1000, y: 0, z: -2000 }, bounds);
    expect(c.x).toBe(3000); // widthMm/2 + 1000 = 3000
    expect(c.y).toBe(5000); // lengthMm/2 - (-2000) = 5000
  });

  it('places world origin (0,0,0) at the SVG center', () => {
    const c = projectCenter({ x: 0, y: 0, z: 0 }, bounds);
    expect(c.x).toBe(bounds.widthMm / 2);
    expect(c.y).toBe(bounds.lengthMm / 2);
  });
});

// ---------------------------------------------------------------------------
// computeJoistSpacingMm
// ---------------------------------------------------------------------------

describe('computeJoistSpacingMm', () => {
  it('returns the nearest-neighbor delta for uniformly-spaced joists', () => {
    const layout = makeJoistLayout(406, 10);
    expect(computeJoistSpacingMm(layout.members)).toBeCloseTo(406, 3);
  });

  it('returns the MINIMUM adjacent-pair delta when the last bay is a remainder', () => {
    // 3 joists at z = 0, 400, 700 → deltas 400, 300 → min 300.
    const members: LayoutMember[] = [
      makeMember({ kind: 'joist', id: 'j1', position: { x: 0, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j2', position: { x: 0, y: 0, z: 400 } }),
      makeMember({ kind: 'joist', id: 'j3', position: { x: 0, y: 0, z: 700 } }),
    ];
    expect(computeJoistSpacingMm(members)).toBe(300);
  });

  it('returns null when there are fewer than 2 joists', () => {
    expect(computeJoistSpacingMm([])).toBeNull();
    const one = [makeMember({ kind: 'joist', id: 'j1' })];
    expect(computeJoistSpacingMm(one)).toBeNull();
  });

  it('ignores non-joist members', () => {
    const members: LayoutMember[] = [
      makeMember({ kind: 'beam', id: 'b1', position: { x: 0, y: 0, z: 0 } }),
      makeMember({ kind: 'beam', id: 'b2', position: { x: 0, y: 0, z: 500 } }),
      makeMember({ kind: 'joist', id: 'j1', position: { x: 0, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j2', position: { x: 0, y: 0, z: 406 } }),
    ];
    expect(computeJoistSpacingMm(members)).toBe(406);
  });
});

// ---------------------------------------------------------------------------
// formatFootprintLabel
// ---------------------------------------------------------------------------

describe('formatFootprintLabel', () => {
  it('formats a 12×16 ft footprint in imperial', () => {
    const label = formatFootprintLabel(BOUNDS_12x16_FT, 'imperial');
    // formatLength(3657.6, 'imperial') = "12′ 0″". Times sign is × (U+00D7).
    expect(label).toContain('12′');
    expect(label).toContain('16′');
    expect(label).toMatch(/×|x/);
  });

  it('formats the same footprint in metric', () => {
    const label = formatFootprintLabel(BOUNDS_12x16_FT, 'metric');
    expect(label).toContain('m');
    expect(label).toMatch(/×|x/);
    // 3657.6 mm ≈ 3.66 m
    expect(label).toMatch(/3\.6[56]/);
  });
});

// ---------------------------------------------------------------------------
// buildPlanDescription — the a11y <desc> string (AC5)
// ---------------------------------------------------------------------------

describe('buildPlanDescription', () => {
  it('follows the "Deck footprint: {W} by {L}. {N} joists at {spacing} on-center. {P} posts." shape', () => {
    const layout = makeJoistLayout(406, 5);
    // Add 4 posts
    const members: LayoutMember[] = [
      ...layout.members,
      makeMember({ kind: 'post', id: 'p1' }),
      makeMember({ kind: 'post', id: 'p2' }),
      makeMember({ kind: 'post', id: 'p3' }),
      makeMember({ kind: 'post', id: 'p4' }),
    ];
    const withPosts: Layout = { ...layout, members };
    const desc = buildPlanDescription(withPosts, 'imperial');
    expect(desc).toMatch(/Deck footprint:/);
    expect(desc).toMatch(/ by /);
    expect(desc).toMatch(/5 joists at /);
    expect(desc).toMatch(/on-center/);
    expect(desc).toMatch(/4 posts/);
  });

  it('omits the "at {spacing} on-center" clause when < 2 joists (no spacing computable)', () => {
    const layout: Layout = {
      designId: 't',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 3000, lengthMm: 3000, heightMm: 900 },
      members: [
        makeMember({ kind: 'joist', id: 'j1' }),
        makeMember({ kind: 'post', id: 'p1' }),
      ],
    };
    const desc = buildPlanDescription(layout, 'imperial');
    expect(desc).toMatch(/1 joist(s)?/);
    expect(desc).not.toMatch(/on-center/);
  });

  it('reformats dimensions + spacing when unit system flips (imperial ↔ metric)', () => {
    const layout = makeJoistLayout(406, 5);
    const imperial = buildPlanDescription(layout, 'imperial');
    const metric = buildPlanDescription(layout, 'metric');
    expect(imperial).not.toBe(metric);
    // Metric mentions "mm" or "m"; imperial has the prime marks.
    expect(metric).toMatch(/mm|m /);
    expect(imperial).toMatch(/′|"/);
  });

  it('uses SINGULAR "joist" / "post" when counts are 1', () => {
    const layout: Layout = {
      designId: 't',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 3000, lengthMm: 3000, heightMm: 900 },
      members: [
        makeMember({ kind: 'joist', id: 'j1' }),
        makeMember({ kind: 'post', id: 'p1' }),
      ],
    };
    const desc = buildPlanDescription(layout, 'imperial');
    // exactly "1 joist" (not "1 joists") and "1 post" (not "1 posts")
    expect(desc).toMatch(/\b1 joist\b/);
    expect(desc).toMatch(/\b1 post\b/);
  });
});
