/**
 * Unit tests for `src/domain/layout/layout-engine.ts` — TDD RED phase.
 *
 * Covers:
 *   - AC6 complete render contract: every member has position, size (nonzero on
 *     all 3 axes for a valid design), rotation, kind, material, id.
 *   - AC7 determinism: identical design → identical Layout (with computedAt
 *     injected to a fixed clock so the timestamp is stable).
 *   - LayoutError contract: throws for width/length below MIN_DECK_DIMENSION_MM,
 *     for negative dims, for spacing < joist thickness, for height <
 *     MIN_STRUCTURAL_HEIGHT_MM, and for unknown material triples.
 *   - `Layout.designId === design.id`, `Layout.bounds` matches footprint.
 *   - Every MemberKind is represented in the output.
 *   - Error wrap contract (QA-Gap#3): unknown-material downstream throws
 *     are wrapped as LayoutError with `cause`; validateDesign LayoutErrors
 *     are NOT double-wrapped.
 */
import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT } from '../units';
import type { DeckDesign, MemberKind } from '../model';

import {
  LayoutError,
  MIN_DECK_DIMENSION_MM,
  MIN_POST_HEIGHT_MM,
  computeLayout,
  computeMinStructuralHeightMm,
} from './layout-engine';

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
    structure: 'elevated',
    foundation: {
      type: 'posts-on-footings',
      post: { nominal: '6x6', species: 'PT', grade: 'No2' },
      footing: { widthMm: 300, depthMm: 300 },
    },
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: overrides.spacingMm ?? 406,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
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
      // S17: LayoutMember.material is the widened MemberMaterialRef
      // discriminated union — every layout produced by the current
      // engine (elevated + posts-on-footings only) stamps the lumber
      // variant.
      expect(m.material.kind).toBe('lumber');
      if (m.material.kind === 'lumber') {
        expect(m.material.nominal).toBeDefined();
        expect(m.material.species).toBeDefined();
        expect(m.material.grade).toBeDefined();
      }
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
    // AC6 as ticket-worded. Under Fix B, every VALID design produces
    // strictly positive post size.y (posts collapse to zero only for
    // designs rejected by validateDesign as heightMm < MIN_STRUCTURAL_HEIGHT_MM).
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
    expect(() => computeLayout(design)).toThrow(/height/i);
  });

  it('throws LayoutError when heightMm is 0 (framing would land underground) — Fix B', () => {
    const design = makeDesign({ heightMm: 0 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    expect(() => computeLayout(design)).toThrow(/height/i);
    expect(() => computeLayout(design)).toThrow(/structural minimum/i);
  });

  it('throws LayoutError when heightMm is below MIN_STRUCTURAL_HEIGHT_MM — Fix B', () => {
    const design = makeDesign({ heightMm: 100 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    // The error message must include the computed minimum so S13's UI can clamp.
    const minHeight = computeMinStructuralHeightMm(design);
    expect(() => computeLayout(design)).toThrow(new RegExp(`${minHeight}`));
  });

  it('accepts heightMm == MIN_STRUCTURAL_HEIGHT_MM (Fix B boundary — inclusive)', () => {
    const proto = makeDesign();
    const minHeight = computeMinStructuralHeightMm(proto);
    const design = makeDesign({ heightMm: minHeight });
    expect(() => computeLayout(design)).not.toThrow();
    // At exactly the minimum, posts have exactly MIN_POST_HEIGHT_MM y-extent.
    const layout = computeLayout(design);
    const posts = layout.members.filter((m) => m.kind === 'post');
    for (const p of posts) {
      expect(p.size.y).toBeCloseTo(MIN_POST_HEIGHT_MM, 6);
    }
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

  it('throws LayoutError when spacingMm < joist thickness — Fix A', () => {
    // 2x10 PT joist actual.widthMm = 38. spacingMm=1 would produce overlap.
    const design = makeDesign({ spacingMm: 1 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    expect(() => computeLayout(design)).toThrow(/spacing/i);
    expect(() => computeLayout(design)).toThrow(/thickness/i);
    // Must name the minimum (the joist thickness in mm).
    expect(() => computeLayout(design)).toThrow(/38/);
  });

  it('accepts spacingMm == joist thickness (Fix A boundary — inclusive)', () => {
    // 2x10 PT joist thickness = 38 mm; spacingMm=38 is right at the min.
    const design = makeDesign({ spacingMm: 38 });
    expect(() => computeLayout(design)).not.toThrow();
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

  it('accepts the minimum viable 4 ft × 4 ft × 2 ft design without throwing', () => {
    // 2 ft (609.6 mm) is above the ~520 mm structural min for the PT 2x10
    // stack. 1 ft would fail Fix B validation (framing underground).
    const design = makeDesign({
      widthMm: 4 * MM_PER_FOOT,
      lengthMm: 4 * MM_PER_FOOT,
      heightMm: 2 * MM_PER_FOOT,
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

describe('computeLayout — error wrap contract (QA-Gap#3)', () => {
  it('wraps an unknown-material downstream throw as LayoutError with cause', () => {
    const design = makeDesign();
    // Cast through unknown to inject an unsupported joist material.
    const bogus: DeckDesign = {
      ...design,
      joist: {
        ...design.joist,
        material: {
          nominal: 'not-a-nominal' as DeckDesign['joist']['material']['nominal'],
          species: 'PT',
          grade: 'No2',
        },
      },
    };
    let caught: unknown;
    try {
      computeLayout(bogus);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LayoutError);
    const layoutErr = caught as LayoutError;
    // Since fix A also looks up joist material in validateDesign, the
    // wrap here goes through the "Invalid joist material" validation
    // path — still a LayoutError with the original catalog error as
    // `cause` (not a double-wrap of LayoutError).
    expect(layoutErr.cause).toBeDefined();
    expect(layoutErr.cause).toBeInstanceOf(Error);
    expect((layoutErr.cause as Error).message).toMatch(/not-a-nominal|unknown|material/i);
  });

  it('does NOT double-wrap a validateDesign LayoutError as its own cause', () => {
    // Width violation: caught by validateDesign, thrown as LayoutError,
    // then MUST bubble up unchanged (not re-caught by the outer
    // try/catch and wrapped with itself as cause).
    const design = makeDesign({ widthMm: 100 });
    let caught: unknown;
    try {
      computeLayout(design);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LayoutError);
    const layoutErr = caught as LayoutError;
    // No `cause` on a raw validation error (it wasn't wrapped from a
    // downstream throw). If we re-wrapped, `cause` would be the same
    // LayoutError — assert that hasn't happened.
    expect(layoutErr.cause).toBeUndefined();
  });

  it('wraps an unknown-material downstream throw during decking layout as LayoutError', () => {
    // Bypass validateDesign's joist-material check by keeping the joist
    // material valid but making the decking material invalid — the
    // catalog lookup for the decking happens inside layoutDecking(),
    // deep in the try/catch of computeLayout, exercising the
    // "downstream throw → LayoutError wrap" path.
    const design = makeDesign();
    const bogus: DeckDesign = {
      ...design,
      decking: {
        ...design.decking,
        material: {
          nominal: 'not-a-decking-nominal' as DeckDesign['decking']['material']['nominal'],
          species: 'PT',
          grade: 'No2',
        },
      },
    };
    let caught: unknown;
    try {
      computeLayout(bogus);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LayoutError);
    // The wrap MUST NOT be an instance of an inner LayoutError (would
    // indicate double-wrap); it must have `cause` set to the original.
    const layoutErr = caught as LayoutError;
    expect(layoutErr.cause).toBeDefined();
  });
});

describe('computeLayout — MIN_DECK_DIMENSION_MM', () => {
  it('MIN_DECK_DIMENSION_MM is exactly 4 ft (unrounded)', () => {
    expect(MIN_DECK_DIMENSION_MM).toBe(4 * MM_PER_FOOT);
  });
});

// ---------------------------------------------------------------------------
// Review-gate FIX 1 — compat matrix + support gate at the layout boundary
// ---------------------------------------------------------------------------
//
// `validateFoundationCombination` (FR-030) MUST be enforced by
// `computeLayout` itself — file-load, localStorage-load, and
// applyParameters all funnel through it, so a single choke-point
// there covers every ingress. The support gate follows: only
// `elevated`+`posts-on-footings` has a layout implementation in
// this branch; every other compat-legal combo throws "not yet
// implemented (arrives in Epic 2 stories S19/S20)".
//
// This block does NOT set `design.post` on the alternate combos —
// FIX 2 dropped the top-level `design.post` field in favour of the
// canonical `foundation.post`, and the alternate combos have no
// post at all (`deck-blocks` / `tuffblocks` are block-supported).

describe('computeLayout — FR-030 compat matrix (FIX 1)', () => {
  it('throws LayoutError with the compat reason for elevated + tuffblocks (FR-030 illegal)', () => {
    const design = makeDesign();
    const illegal: DeckDesign = {
      ...design,
      structure: 'elevated',
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
    };
    expect(() => computeLayout(illegal)).toThrowError(LayoutError);
    expect(() => computeLayout(illegal)).toThrowError(/TuffBlock/i);
  });

  it('throws LayoutError with the compat reason for floating + posts-on-footings (FR-030 illegal)', () => {
    const design = makeDesign();
    const illegal: DeckDesign = {
      ...design,
      structure: 'floating',
      foundation: {
        type: 'posts-on-footings',
        post: { nominal: '6x6', species: 'PT', grade: 'No2' },
        footing: { widthMm: 300, depthMm: 300 },
      },
    };
    expect(() => computeLayout(illegal)).toThrowError(LayoutError);
    expect(() => computeLayout(illegal)).toThrowError(/floating/i);
    expect(() => computeLayout(illegal)).toThrowError(/footing/i);
  });
});

describe('computeLayout — support-gate for not-yet-implemented combos (FIX 1)', () => {
  it('throws LayoutError "not yet implemented" for elevated + deck-blocks (S20)', () => {
    const design = makeDesign();
    const notImpl: DeckDesign = {
      ...design,
      structure: 'elevated',
      foundation: { type: 'deck-blocks', product: { productId: 'oldcastle-11x11x7' } },
    };
    expect(() => computeLayout(notImpl)).toThrowError(LayoutError);
    expect(() => computeLayout(notImpl)).toThrowError(/not yet implemented/i);
    expect(() => computeLayout(notImpl)).toThrowError(/S19|S20/);
  });

  it('floating + deck-blocks dispatches to the S19 floating pipeline (produces a layout, no throw)', () => {
    const design = makeDesign();
    const impl: DeckDesign = {
      ...design,
      structure: 'floating',
      foundation: { type: 'deck-blocks', product: { productId: 'oldcastle-11x11x7' } },
    };
    const layout = computeLayout(impl);
    expect(layout.members.length).toBeGreaterThan(0);
    const kinds = new Set(layout.members.map((m) => m.kind));
    expect(kinds).toContain('block');
    expect(kinds).toContain('beam');
    expect(kinds).not.toContain('post');
    expect(kinds).not.toContain('footing');
  });

  it('floating + tuffblocks dispatches to the S19 floating pipeline (produces a layout, no throw)', () => {
    const design = makeDesign();
    const impl: DeckDesign = {
      ...design,
      structure: 'floating',
      foundation: { type: 'tuffblocks', product: { productId: 'tuffblock-12x12x4' } },
      // TuffBlock accepts 2x6 / 2x8 only (foundation-catalog.ts).
      // makeDesign() defaults to 2x10 which is FR-028-invalid here,
      // so override the beam nominal for this combo. The elevated
      // default is intentionally 2x10; overriding here documents the
      // per-foundation-product constraint.
      joist: {
        material: { nominal: '2x8', species: 'PT', grade: 'No2' },
        spacingMm: 406,
      },
      beam: { material: { nominal: '2x8', species: 'PT', grade: 'No2' } },
    };
    const layout = computeLayout(impl);
    expect(layout.members.length).toBeGreaterThan(0);
    const kinds = new Set(layout.members.map((m) => m.kind));
    expect(kinds).toContain('block');
    expect(kinds).toContain('beam');
    expect(kinds).not.toContain('post');
    expect(kinds).not.toContain('footing');
    // TuffBlock's productId is stamped on every block member.
    const blocks = layout.members.filter((m) => m.kind === 'block');
    for (const b of blocks) {
      if (b.material.kind === 'block') {
        expect(b.material.productId).toBe('tuffblock-12x12x4');
      }
    }
  });

  it('elevated + posts-on-footings still produces a valid layout (the only supported combo)', () => {
    // Regression guard: the support-gate MUST NOT swallow the sole
    // supported combo. This is the "happy path" all pre-Epic-2
    // fixtures rely on.
    const layout = computeLayout(makeDesign());
    expect(layout.members.length).toBeGreaterThan(0);
  });
});
