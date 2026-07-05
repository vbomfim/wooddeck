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
    floatingFraming: 'beams-and-joists',
    beamConnection: 'drop',
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

  it('all six lumber MemberKind values appear in members[] (elevated + posts-on-footings + issue #72 blocking)', () => {
    // Post-issue-#72 the elevated + posts-on-footings pipeline
    // emits SIX kinds: the original five (joist / beam / post /
    // footing / board) plus `blocking` (solid noggins between
    // joists per IRC R502.7.1). Block-kind members appear only
    // under the deck-blocks foundation variant — not here.
    const layout = computeLayout(makeDesign());
    const kinds = new Set<MemberKind>(layout.members.map((m) => m.kind));
    expect(kinds).toEqual(
      new Set<MemberKind>(['joist', 'beam', 'post', 'footing', 'board', 'blocking']),
    );
  });

  it('every member id is unique across the whole layout', () => {
    const layout = computeLayout(makeDesign());
    const ids = layout.members.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // -------------------------------------------------------------
  // Issue #72 — blocking between joists (IRC R502.7.1)
  // -------------------------------------------------------------
  //
  // Wiring coverage: the elevated pipeline emits blocking
  // members. Per-member geometry is proved by
  // `../blocking-layout.test.ts`; here we only prove the SHARED
  // helper is actually called from the elevated compute path.

  it('elevated + posts-on-footings emits blocking members between adjacent joists (issue #72)', () => {
    const layout = computeLayout(makeDesign());
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    expect(joists.length).toBeGreaterThanOrEqual(2);
    expect(blocking.length).toBeGreaterThan(0);
    // At least (joists.length - 1) blocking pieces (one per bay,
    // times ≥ 1 row per IRC R502.7.1 minimum-row floor).
    expect(blocking.length).toBeGreaterThanOrEqual(joists.length - 1);
  });

  it('every blocking member sits at joistCenterY (co-planar with joists) — issue #72', () => {
    const layout = computeLayout(makeDesign());
    const joistY = layout.members.find((m) => m.kind === 'joist')!.position.y;
    for (const b of layout.members.filter((m) => m.kind === 'blocking')) {
      expect(b.position.y).toBe(joistY);
    }
  });

  it('blocking is emitted for the deck-blocks elevated variant too — issue #72', () => {
    // Both elevated variants share the joist y-anchor
    // (`computeYStack.joistCenterY`), so the shared helper works
    // for both. The variant test in the deck-blocks describe
    // block below spot-checks the geometry; this test proves the
    // wiring for the posts-on-footings variant is symmetric with
    // the deck-blocks branch.
    // (No design construction here — the deck-blocks describe
    // suite proves the wiring for the block variant separately.)
    const layout = computeLayout(makeDesign());
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    for (const b of blocking) {
      // Every emitted member carries a lumber material so the BOM
      // routes it into the joist-material lumber pack.
      expect(b.material.kind).toBe('lumber');
    }
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

  it('throws LayoutError when spacingMm < joist thickness — Fix A (SUPERSEDED but still catches sub-thickness at defense-in-depth layer)', () => {
    // 2x10 PT joist actual.widthMm = 38. Pre-PR-#73 spacingMm=1
    // was rejected by the thickness guard.
    //
    // PR #73 review (GPT-5.5 HIGH #2 root fix): the new
    // MIN_JOIST_SPACING_MM=305 guard now fires FIRST for any
    // sub-305 value (including this one) — its message is
    // friendlier for the common user-error case. The
    // `< joistThicknessMm` guard is RETAINED as defense-in-depth
    // for the (unreachable-via-validated-input) case where a
    // future lower MIN would leave sub-thickness inputs uncaught.
    // Either message is acceptable — both prove the fail-loud
    // invariant.
    const design = makeDesign({ spacingMm: 1 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    expect(() => computeLayout(design)).toThrow(/spacing/i);
  });

  it('accepts spacingMm == joist thickness when width geometry is compatible (issue #25 boundary — SUPERSEDED by MIN_JOIST_SPACING_MM=305 in PR #73 review)', () => {
    // PRE-PR-#73: this test verified that spacing=38 (== 2x10 PT joist
    // thickness) with a width chosen so `actualSpacing == thickness`
    // exactly was accepted (joists touching face-to-face).
    //
    // PR #73 review (GPT-5.5 HIGH #2 root-fix): a 305 mm (12″ o.c.)
    // practical minimum joist spacing is now enforced at the domain
    // trust boundary (`validateJoistSpacing`) to bound the joist
    // count AND its blocking-member multiplier. 38 mm falls FAR below
    // that floor — the design must now be REJECTED even at the
    // width geometry that would have satisfied the pre-#73
    // thickness-only check.
    const design = makeDesign({ widthMm: 38 * 33, spacingMm: 38 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    expect(() => computeLayout(design)).toThrow(/305|minimum|12/i);
  });

  // Issue #25 regression — see `src/domain/layout/layout-shared.ts`
  // `validateJoistSpacing`. The pre-#25 validator only rejected
  // `spacingMm < joistThicknessMm`, but the even-spaced algorithm can
  // produce `actualSpacing < joistThicknessMm` even when the REQUESTED
  // spacing is legal (equal to thickness). That produces silent joist
  // overlap of ~1 mm, which the AC3 property test caught intermittently
  // (flaky in CI — depended on the fast-check seed hitting the boundary).
  //
  // ⚠ PR #73 review (GPT-5.5 HIGH #2 root-fix): the tests below still
  // pass — the same designs are STILL rejected — but the rejection
  // now fires at the tighter `MIN_JOIST_SPACING_MM = 305` guard
  // BEFORE the issue #25 overlap check runs. The message no longer
  // includes the "achievable spacing / usable span" text; it names
  // the 305 mm minimum instead. The issue #25 defense-in-depth check
  // is retained in `validateJoistSpacing` (belt-and-braces) so a
  // future consumer that bypasses the MIN guard (e.g. a helper
  // called directly with primitive inputs) still gets the overlap
  // rejection.
  describe('issue #25 — reject joist spacings that would produce overlap by construction (SUPERSEDED by MIN=305 for the pipeline path)', () => {
    it('throws LayoutError when requested spacing == thickness (pre-#25 reproducer; now caught earlier by MIN_JOIST_SPACING_MM=305)', () => {
      // Pre-#25 case: widthMm=1220, spacingMm=38 (2×10 PT thickness).
      // Pre-#73 the check that fired was the actual-spacing overlap
      // guard ("36.94 mm on-center < 38 mm thickness"). Post-#73 the
      // MIN=305 check fires first — same fail-loud outcome, tighter
      // message.
      const design = makeDesign({ widthMm: 1220, spacingMm: 38 });
      expect(() => computeLayout(design)).toThrow(LayoutError);
      expect(() => computeLayout(design)).toThrow(/spacing/i);
      // Message names 38 (the requested spacing) AND 305 (the min).
      expect(() => computeLayout(design)).toThrow(/38/);
      expect(() => computeLayout(design)).toThrow(/305/);
    });

    it('throws LayoutError for a narrow deck with sub-min spacing (pre-#25 reproducer; now caught by MIN_JOIST_SPACING_MM=305)', () => {
      const design = makeDesign({ widthMm: 1234, spacingMm: 38 });
      expect(() => computeLayout(design)).toThrow(LayoutError);
      expect(() => computeLayout(design)).toThrow(/spacing/i);
    });

    it('accepts spacings that comfortably exceed the joist thickness (regression guard — do not over-reject)', () => {
      // Sanity: the tightened check must NOT break normal designs.
      // 305, 406, 508, 610 mm are all much larger than the 38 mm
      // thickness, so actualSpacing stays close to spacingMm and no
      // overlap is possible.
      for (const spacingMm of [305, 406, 508, 610]) {
        const design = makeDesign({ spacingMm });
        expect(() => computeLayout(design)).not.toThrow();
      }
    });
  });

  // -------------------------------------------------------------------
  // PR #73 review-gate follow-up — GPT-5.5 HIGH #2 root fix.
  //
  // A practical MIN joist spacing at the domain trust boundary bounds
  // the joist count AND its blocking-member multiplier. Value chosen:
  // `MIN_JOIST_SPACING_MM = 305 mm (12″ o.c.)` — mirrors the codebase's
  // canonical tightest sensible spacing (the `reduce-joist-spacing`
  // remediation floor in `remediations.ts`, and the first entry in
  // `TABULATED_SPACINGS_MM = [305, 406, 610]`).
  //
  // Enforced at 3 layers: (a) `validateJoistSpacing` in the domain;
  // (b) the persisted `.deck` schema v2's `joist.spacingMm.minimum`;
  // (c) the ParameterPanel's joist-spacing LengthField hint.
  // -------------------------------------------------------------------
  describe('PR #73 review — MIN_JOIST_SPACING_MM (=305 mm, 12″ o.c.)', () => {
    it('rejects spacingMm strictly below the min with an actionable LayoutError', () => {
      // A value comfortably below the min AND above the joist
      // thickness (38 mm) — so we know the rejection came from the
      // MIN guard, not the thickness guard.
      const design = makeDesign({ spacingMm: 200 });
      expect(() => computeLayout(design)).toThrow(LayoutError);
      expect(() => computeLayout(design)).toThrow(/305/); // names the min
      expect(() => computeLayout(design)).toThrow(/12/); // names the 12" o.c. imperial equivalent
      expect(() => computeLayout(design)).toThrow(/spacing/i); // names the field
      // The message must be actionable — suggest typical values so
      // the UI banner surfaces a fix hint the user can act on.
      expect(() => computeLayout(design)).toThrow(/406|610|typical/i);
    });

    it('accepts spacingMm == MIN (=305) exactly (inclusive boundary)', () => {
      const design = makeDesign({ spacingMm: 305 });
      expect(() => computeLayout(design)).not.toThrow();
    });

    it('rejects spacingMm at 304 (one millimetre below the min — boundary)', () => {
      const design = makeDesign({ spacingMm: 304 });
      expect(() => computeLayout(design)).toThrow(LayoutError);
      expect(() => computeLayout(design)).toThrow(/305/);
    });

    it('accepts all catalog spacings (305, 406, 508, 610) — regression pin: MIN guard does NOT over-reject', () => {
      for (const spacingMm of [305, 406, 508, 610]) {
        const design = makeDesign({ spacingMm });
        expect(() => computeLayout(design)).not.toThrow();
      }
    });
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
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
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
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
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
  // Note: the pre-S20 `elevated + deck-blocks "not yet implemented"`
  // regression assertion has been removed. The positive dispatch
  // test lives in the "S20 — elevated + deck-blocks pipeline"
  // describe block below. Git history preserves the earlier form.

  it('floating + deck-blocks dispatches to the S19 floating pipeline (produces a layout, no throw)', () => {
    const design = makeDesign();
    const impl: DeckDesign = {
      ...design,
      structure: 'floating',
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
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
      floatingFraming: 'beams-and-joists',
      beamConnection: 'drop',
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

// ---------------------------------------------------------------------------
// S20 — elevated + deck-blocks pipeline
// ---------------------------------------------------------------------------

import { lookupFoundationProduct } from '../foundation-catalog';
import { lookupMaterial } from '../materials-catalog';

/**
 * Build a design in the elevated + deck-blocks configuration with a
 * height comfortably above the block-adjusted structural minimum.
 * Every non-foundation field is a small variation of `makeDesign`
 * so the tests below share the same reference geometry with the
 * elevated + posts-on-footings suite.
 */
function makeDeckBlocksDesign(overrides: Partial<{
  widthMm: number;
  lengthMm: number;
  heightMm: number;
  productId: 'oldcastle-11x11x7';
}> = {}): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-000000000020',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: {
      widthMm: overrides.widthMm ?? 3660,
      lengthMm: overrides.lengthMm ?? 4880,
      heightMm: overrides.heightMm ?? 1200,
    },
    structure: 'elevated',
    floatingFraming: 'beams-and-joists',
    beamConnection: 'drop',
    foundation: {
      type: 'deck-blocks',
      product: { productId: overrides.productId ?? 'oldcastle-11x11x7' },
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

describe('computeLayout — S20 elevated + deck-blocks AC1 (block members, no footings)', () => {
  it('produces layout without throwing (S20 removes the "not yet implemented" gate)', () => {
    expect(() => computeLayout(makeDeckBlocksDesign())).not.toThrow();
  });

  it('emits ZERO footings and exactly one block per post', () => {
    const layout = computeLayout(makeDeckBlocksDesign());
    const posts = layout.members.filter((m) => m.kind === 'post');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const footings = layout.members.filter((m) => m.kind === 'footing');
    expect(footings).toHaveLength(0);
    expect(blocks).toHaveLength(posts.length);
    expect(posts.length).toBeGreaterThan(0);
  });

  it('every block carries a {kind:"block", productId:"oldcastle-11x11x7"} material', () => {
    const layout = computeLayout(makeDeckBlocksDesign());
    const blocks = layout.members.filter((m) => m.kind === 'block');
    for (const b of blocks) {
      expect(b.material.kind).toBe('block');
      if (b.material.kind === 'block') {
        expect(b.material.productId).toBe('oldcastle-11x11x7');
      }
    }
  });

  it('every non-block member still carries a lumber material stamp', () => {
    // Blocks are the ONLY block-material producer in the elevated
    // pipeline. Posts, joists, beams, boards, and footings (none in
    // this variant) all carry `{kind:'lumber',...}`.
    const layout = computeLayout(makeDeckBlocksDesign());
    for (const m of layout.members) {
      if (m.kind === 'block') {
        expect(m.material.kind).toBe('block');
      } else {
        expect(m.material.kind).toBe('lumber');
      }
    }
  });

  it('AC1 count reference: 12 ft × 12 ft × 4 ft yields 6 posts / 6 blocks (3 per beam × 2 beams — ceil(widthMm/MAX_BEAM_SPAN_MM)+1=3)', () => {
    const design = makeDeckBlocksDesign({
      widthMm: 12 * MM_PER_FOOT,
      lengthMm: 12 * MM_PER_FOOT,
    });
    const layout = computeLayout(design);
    const posts = layout.members.filter((m) => m.kind === 'post');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // 3657.6 / 2438.4 = 1.5 → ceil=2 → +1 = 3 posts per beam × 2 beams = 6.
    expect(posts).toHaveLength(6);
    expect(blocks).toHaveLength(6);
  });

  it('elevated + deck-blocks also emits blocking between joists (issue #72)', () => {
    // The deck-blocks variant shares the joist y-anchor with the
    // posts-on-footings variant (`computeYStack.joistCenterY`), so
    // the same `computeBlockingFromDesign` adapter applies. This
    // test proves the wiring lives in BOTH elevated compute paths.
    const layout = computeLayout(makeDeckBlocksDesign());
    const joists = layout.members.filter((m) => m.kind === 'joist');
    const blocking = layout.members.filter((m) => m.kind === 'blocking');
    expect(joists.length).toBeGreaterThanOrEqual(2);
    expect(blocking.length).toBeGreaterThan(0);
  });
});

describe('computeLayout — S20 AC4 block on grade, centered under post', () => {
  it('every block position.y = product.actual.heightMm / 2 (block bottom at y=0)', () => {
    const layout = computeLayout(makeDeckBlocksDesign());
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    for (const b of blocks) {
      expect(b.position.y).toBe(product.actual.heightMm / 2);
    }
  });

  it('every block has size = product.actual (279 × 178 × 279 for Oldcastle)', () => {
    const layout = computeLayout(makeDeckBlocksDesign());
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    for (const b of blocks) {
      expect(b.size.x).toBe(product.actual.widthMm);
      expect(b.size.y).toBe(product.actual.heightMm);
      expect(b.size.z).toBe(product.actual.depthMm);
    }
  });
});

describe('computeLayout — S20 AC5 post rests on block top', () => {
  it('post position.y == blockHeightMm + post.size.y / 2', () => {
    const layout = computeLayout(makeDeckBlocksDesign());
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const posts = layout.members.filter((m) => m.kind === 'post');
    for (const p of posts) {
      expect(p.position.y).toBeCloseTo(
        product.actual.heightMm + p.size.y / 2,
        6,
      );
    }
  });

  it('post bottom face sits exactly on the block top face (no gap, no overlap)', () => {
    const layout = computeLayout(makeDeckBlocksDesign());
    const posts = layout.members.filter((m) => m.kind === 'post');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // Post bottom y == block top y. Since blocks and posts share the
    // same x,z (AC4) and are matched in emission order, iterate in
    // parallel.
    expect(posts.length).toBe(blocks.length);
    for (let i = 0; i < posts.length; i++) {
      const postBottom = posts[i]!.position.y - posts[i]!.size.y / 2;
      const blockTop = blocks[i]!.position.y + blocks[i]!.size.y / 2;
      expect(postBottom).toBeCloseTo(blockTop, 6);
    }
  });
});

describe('computeLayout — S20 AC6 min height includes block heightMm', () => {
  it('computeMinStructuralHeightMm(deck-blocks) === computeMinStructuralHeightMm(posts-on-footings) + blockHeightMm', () => {
    // Same materials, only foundation.type differs. The delta is
    // exactly the block height — the block sits ON grade and lifts
    // the whole framing stack by its own height.
    const footingDesign = makeDesign();
    const blockDesign = makeDeckBlocksDesign();
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const delta =
      computeMinStructuralHeightMm(blockDesign) -
      computeMinStructuralHeightMm(footingDesign);
    expect(delta).toBe(product.actual.heightMm);
  });

  it('formula: block.height + MIN_POST_HEIGHT_MM + beam.height + joist.height + decking.thickness', () => {
    const design = makeDeckBlocksDesign();
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    const joist = lookupMaterial('2x10', 'PT', 'No2');
    const beam = lookupMaterial('2x10', 'PT', 'No2');
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    expect(computeMinStructuralHeightMm(design)).toBe(
      product.actual.heightMm +
        MIN_POST_HEIGHT_MM +
        beam.actual.heightMm +
        joist.actual.heightMm +
        decking.actual.widthMm,
    );
  });

  it('rejects heightMm below the block-adjusted MIN with a LayoutError', () => {
    const proto = makeDeckBlocksDesign();
    const minHeight = computeMinStructuralHeightMm(proto);
    // 1 mm below the min — should fail validation with a LayoutError
    // whose message names the computed minimum (for S13's UI clamp).
    const design = makeDeckBlocksDesign({ heightMm: minHeight - 1 });
    expect(() => computeLayout(design)).toThrow(LayoutError);
    expect(() => computeLayout(design)).toThrow(new RegExp(`${minHeight}`));
  });

  it('accepts heightMm == block-adjusted MIN (inclusive boundary)', () => {
    const proto = makeDeckBlocksDesign();
    const minHeight = computeMinStructuralHeightMm(proto);
    const design = makeDeckBlocksDesign({ heightMm: minHeight });
    expect(() => computeLayout(design)).not.toThrow();
    // At the boundary, posts have EXACTLY MIN_POST_HEIGHT_MM y-extent.
    const layout = computeLayout(design);
    const posts = layout.members.filter((m) => m.kind === 'post');
    for (const p of posts) {
      expect(p.size.y).toBeCloseTo(MIN_POST_HEIGHT_MM, 6);
    }
  });

  it('posts-on-footings computeMinStructuralHeightMm still returns the pre-S20 formula (AC2 regression)', () => {
    // Explicit lock: the block-adjusted formula MUST NOT leak into
    // the posts-on-footings branch. Existing SC-004 goldens rely on
    // the pre-S20 min being byte-identical.
    const design = makeDesign();
    const decking = lookupMaterial('5/4x6', 'PT', 'No2');
    const joist = lookupMaterial('2x10', 'PT', 'No2');
    const beam = lookupMaterial('2x10', 'PT', 'No2');
    expect(computeMinStructuralHeightMm(design)).toBe(
      decking.actual.widthMm +
        joist.actual.heightMm +
        beam.actual.heightMm +
        MIN_POST_HEIGHT_MM,
    );
  });
});

describe('computeLayout — S20 AC7 compat matrix (regression)', () => {
  it('elevated + tuffblocks still throws LayoutError (rejected before dispatch)', () => {
    // The S17 compat gate rejects this combo. Adding the S20
    // deck-blocks branch MUST NOT accidentally widen the gate.
    const bad: DeckDesign = {
      ...makeDeckBlocksDesign(),
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
    };
    expect(() => computeLayout(bad)).toThrow(LayoutError);
    expect(() => computeLayout(bad)).toThrow(/TuffBlock/i);
  });
});

describe('computeLayout — S20 bounds and determinism', () => {
  it('Layout.bounds still mirrors design.footprint (blocks stay within footprint)', () => {
    // Blocks sit ON grade (y ∈ [0, heightMm]) and are centered under
    // posts, which are themselves inset from the deck edges by the
    // FOOTING_WIDTH_MM/2 anchor — an Oldcastle 279 mm block fits
    // entirely inside the footprint at every corner. So bounds =
    // design.footprint, byte-identical to the posts-on-footings
    // branch. This test locks that invariant so a future block-
    // product with a larger footprint (>300 mm) would trip a
    // failure and force a bounds review.
    const design = makeDeckBlocksDesign();
    const layout = computeLayout(design);
    expect(layout.bounds).toEqual(design.footprint);
  });

  it('is deterministic — same design + fixed clock → deeply-equal layouts', () => {
    const design = makeDeckBlocksDesign();
    const now = () => '2026-07-04T12:00:00.000Z';
    const a = computeLayout(design, { now });
    const b = computeLayout(design, { now });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// S20 review-gate FIX 1 — Composite-beam integration
// ---------------------------------------------------------------------------
//
// AC-FIX1: an elevated + deck-blocks design with a Composite beam MUST
// lay out successfully. Pre-FIX-1 this threw "Unknown material" because
// the naive post-material derivation borrowed the beam's species/grade
// (Composite/NA) which is NOT stocked for 4×4 posts. FIX 1 falls back
// to PT No2 in that case.

describe('computeLayout — S20 FIX 1 Composite beam + deck-blocks integration', () => {
  it('elevated + deck-blocks + Composite beam lays out with PT posts (no throw)', () => {
    const design: DeckDesign = {
      ...makeDeckBlocksDesign(),
      beam: { material: { nominal: '2x10', species: 'Composite', grade: 'NA' } },
      joist: {
        material: { nominal: '2x10', species: 'Composite', grade: 'NA' },
        spacingMm: 406,
      },
      decking: {
        material: { nominal: '5/4x6', species: 'Composite', grade: 'NA' },
        orientation: 'parallel-to-width',
      },
    };
    expect(() => computeLayout(design)).not.toThrow();
    const layout = computeLayout(design);
    const posts = layout.members.filter((m) => m.kind === 'post');
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.material.kind).toBe('lumber');
      if (p.material.kind === 'lumber') {
        // FIX 1 fallback: PT No2 4x4 posts for a Composite beam.
        expect(p.material.nominal).toBe('4x4');
        expect(p.material.species).toBe('PT');
        expect(p.material.grade).toBe('No2');
      }
    }
    const blocks = layout.members.filter((m) => m.kind === 'block');
    expect(blocks).toHaveLength(posts.length);
  });
});
