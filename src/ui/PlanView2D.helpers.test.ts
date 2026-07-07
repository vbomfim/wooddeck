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
import { beforeEach, describe, expect, it } from 'vitest';

import type { Layout, LayoutMember } from '../domain/model';
import { MM_PER_FOOT } from '../domain/units';
import { resetDesignStoreForTests, useDesignStore } from '../state/design-store';

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
  const widthMm = 3658;
  const lengthMm = 4877;
  const thicknessMm = 38;
  const depthMm = 184;
  // Center around x=0 so the joist centers are symmetric about the
  // footprint centerline — matches production `computeJoistXCenters`
  // (even-centered anchor pattern; see `src/domain/layout/joist-layout.ts`).
  // Each joist runs ALONG the length axis: `size.z = lengthMm`,
  // thin `size.x = thicknessMm`. `position.z = 0` for every joist,
  // exactly like production.
  const halfSpan = ((count - 1) * spacingMm) / 2;
  for (let i = 0; i < count; i++) {
    members.push(
      makeMember({
        kind: 'joist',
        id: `joist-${String(i)}`,
        position: { x: -halfSpan + i * spacingMm, y: 100, z: 0 },
        size: { x: thicknessMm, y: depthMm, z: lengthMm },
      }),
    );
  }
  return {
    designId: 'test',
    computedAt: '2024-01-01T00:00:00.000Z',
    bounds: { widthMm, lengthMm, heightMm: 900 },
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
  it('returns the adjacent-neighbor delta for uniformly-spaced joists (along x)', () => {
    const layout = makeJoistLayout(406, 10);
    expect(computeJoistSpacingMm(layout.members)).toBeCloseTo(406, 3);
  });

  it('returns the MEDIAN of adjacent-x deltas (robust to a single outlier bay)', () => {
    // 5 joists at x = 0, 400, 800, 1200, 1700 → deltas 400, 400, 400, 500.
    // Sorted deltas: [400, 400, 400, 500] → median = (400+400)/2 = 400.
    // (MIN would be 400 too here, but the point is median ignores the
    //  500 outlier; a fixture with a leading outlier confirms MIN is NOT used.)
    const members: LayoutMember[] = [
      makeMember({ kind: 'joist', id: 'j1', position: { x: 0, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j2', position: { x: 400, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j3', position: { x: 800, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j4', position: { x: 1200, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j5', position: { x: 1700, y: 0, z: 0 } }),
    ];
    expect(computeJoistSpacingMm(members)).toBe(400);
  });

  it('median ignores a single narrow outlier bay (would trip a MIN implementation)', () => {
    // 4 joists at x = 0, 400, 402, 800 → deltas 400, 2, 398.
    // Sorted: [2, 398, 400] → median = 398 (odd length → middle element).
    // MIN would return 2 — this test locks in that we DO NOT return MIN.
    const members: LayoutMember[] = [
      makeMember({ kind: 'joist', id: 'j1', position: { x: 0, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j2', position: { x: 400, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j3', position: { x: 402, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j4', position: { x: 800, y: 0, z: 0 } }),
    ];
    expect(computeJoistSpacingMm(members)).toBe(398);
  });

  it('returns null when there are fewer than 2 joists', () => {
    expect(computeJoistSpacingMm([])).toBeNull();
    const one = [makeMember({ kind: 'joist', id: 'j1' })];
    expect(computeJoistSpacingMm(one)).toBeNull();
  });

  it('ignores non-joist members (uses only joist x-positions)', () => {
    const members: LayoutMember[] = [
      makeMember({ kind: 'beam', id: 'b1', position: { x: 0, y: 0, z: 0 } }),
      makeMember({ kind: 'beam', id: 'b2', position: { x: 500, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j1', position: { x: 0, y: 0, z: 0 } }),
      makeMember({ kind: 'joist', id: 'j2', position: { x: 406, y: 0, z: 0 } }),
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

// ---------------------------------------------------------------------------
// Integration regression pin — production engine → buildPlanDescription
// ---------------------------------------------------------------------------
//
// Review-gate pair-fix (BLOCKING #1, Opus CRITICAL + GPT HIGH):
//
//   `computeJoistSpacingMm` used to diff `position.z`, but production
//   joists (see `src/domain/layout/joist-layout.ts`) run ALONG the
//   length axis — `size.z = footprint.lengthMm`, `position.z = 0`
//   for EVERY joist — and are spaced ALONG `position.x`. So for
//   every real layout the old helper saw all-equal z (0) → returned
//   null → the `<desc>` dropped the AC5-required "at {spacing}
//   on-center." clause.
//
// This test bypasses hand-built fixtures entirely: it runs the REAL
// `computeLayoutAndCheck` (via `resetDesignStoreForTests` →
// `makeDefaultBundle`) and pipes the resulting `Layout` through
// `buildPlanDescription`. It MUST FAIL on the pre-fix code and PASS
// after the fix — this is the regression pin the review demanded.
//
// Boundary-safe: we import from `../state/design-store` (already
// legal for UI) — NOT `../domain/layout` (would trip
// `ui-no-domain-layout` in dep-cruiser).

describe('buildPlanDescription — integration with production layout engine (pair-fix regression pin)', () => {
  beforeEach(() => {
    resetDesignStoreForTests({ id: 'plan-view-int', createdAt: '2024-01-01T00:00:00.000Z' });
  });

  it('includes the "at {spacing} on-center" clause on the DEFAULT design (real engine)', () => {
    const layout = useDesignStore.getState().bundle.layout;
    // Sanity: the default has ≥2 joists so a spacing IS computable.
    const joistCount = layout.members.filter((m) => m.kind === 'joist').length;
    expect(joistCount).toBeGreaterThanOrEqual(2);

    const desc = buildPlanDescription(layout, 'imperial');
    // The FIX: description must contain "on-center" for a real layout.
    expect(desc).toMatch(/on-center/);
    // And the joist count should be present.
    expect(desc).toMatch(new RegExp(`${String(joistCount)} joists`));
    // Spacing should be a plausible imperial fragment (feet+inches or inches).
    expect(desc).toMatch(/at\s+.+\s+on-center/);
  });

  it('quotes a plausible joist spacing (production is ~16 in nominal for the default)', () => {
    const layout = useDesignStore.getState().bundle.layout;
    const spacing = computeJoistSpacingMm(layout.members);
    expect(spacing).not.toBeNull();
    // Production default is 16 in ≈ 406.4 mm; even-centered spacing
    // usually rounds within ±80 mm depending on the footprint width.
    expect(spacing!).toBeGreaterThan(150); // sanity floor
    expect(spacing!).toBeLessThan(700); // sanity ceiling (never > code max)
  });
});
