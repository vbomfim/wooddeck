/**
 * Unit tests for `src/state/default-design.ts`.
 *
 * ## Coverage map (issue #9 acceptance criteria)
 *
 *   - AC8  Frozen parameter set — 12 ft × 12 ft × 3 ft, 2×8 PT
 *          joists @ 406 mm o.c., 5/4×6 PT decking. Assertions match
 *          the ticket wording verbatim so a spec-tightening (change
 *          the defaults) fail-first here rather than silently drift.
 *   - AC8  Produces a `DeckDesign` that computes a valid `Layout`
 *          without throwing `LayoutError` (min-structural-height +
 *          min-4-ft-dimension guards satisfied). This is the
 *          load-bearing assertion: if the default fails, boot
 *          silently or otherwise falls apart.
 *   - AC8-A (pair-fix regression): `spanCheck` on the default's
 *          layout MUST return `[]`. Twelve span warnings on first
 *          paint (the pre-fix behavior with 12×16 + 2×8 material)
 *          contradicts AC8's "sensible default" spirit. This
 *          assertion is the permanent guard against re-introducing
 *          the regression via a material or footprint edit.
 *   - Edge Injected `id` and `createdAt` flow through — pure factory,
 *          no clock reads inside.
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). Pure test — no globals used.
 */
import { describe, expect, it } from 'vitest';

import { computeLayout, LayoutError } from '../domain/layout';
// `computeMinStructuralHeightMm` is not on the layout barrel; the
// direct-path import is a test-only concession (boundary rules
// exclude *.test.ts). If a later story surfaces the constant on
// the barrel (e.g. S13's height-input clamp), switch to that path.
import { computeMinStructuralHeightMm } from '../domain/layout/layout-engine';
import { IrcSpanTable, spanCheck } from '../domain/spans';
import { MM_PER_FOOT } from '../domain/units';

import { DEFAULT_DESIGN_PARAMS, makeDefaultDesign } from './default-design';

const FIXED_ID = '00000000-0000-4000-8000-000000000001';
const FIXED_CREATED_AT = '2026-07-03T10:00:00.000Z';

describe('DEFAULT_DESIGN_PARAMS — AC8 frozen values', () => {
  it('matches the (pair-fix revised) ticket defaults exactly', () => {
    // The values below are the pair-fix-revised AC8 (12×12 instead
    // of the original 12×16 that over-spanned 2×8 joists). A change
    // here MUST be paired with a ticket revision — this assertion
    // is the RED gate that catches accidental drift.
    expect(DEFAULT_DESIGN_PARAMS.widthFt).toBe(12);
    expect(DEFAULT_DESIGN_PARAMS.lengthFt).toBe(12);
    expect(DEFAULT_DESIGN_PARAMS.heightFt).toBe(3);
    expect(DEFAULT_DESIGN_PARAMS.joistSpacingMm).toBe(406);
    expect(DEFAULT_DESIGN_PARAMS.joistNominal).toBe('2x8');
    expect(DEFAULT_DESIGN_PARAMS.beamNominal).toBe('2x8');
    expect(DEFAULT_DESIGN_PARAMS.postNominal).toBe('6x6');
    expect(DEFAULT_DESIGN_PARAMS.deckingNominal).toBe('5/4x6');
    expect(DEFAULT_DESIGN_PARAMS.species).toBe('PT');
    expect(DEFAULT_DESIGN_PARAMS.grade).toBe('No2');
    expect(DEFAULT_DESIGN_PARAMS.deckingOrientation).toBe('parallel-to-width');
    expect(DEFAULT_DESIGN_PARAMS.bayRemainderStrategy).toBe('extra-bay-at-end');
  });

  it('is frozen (Object.freeze) — accidental mutation is loud', () => {
    expect(Object.isFrozen(DEFAULT_DESIGN_PARAMS)).toBe(true);
  });
});

describe('makeDefaultDesign — AC8 factory', () => {
  it('injects id and createdAt (pure — no clock read)', () => {
    const design = makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT);
    expect(design.id).toBe(FIXED_ID);
    expect(design.createdAt).toBe(FIXED_CREATED_AT);
  });

  it('converts foot dimensions to mm using MM_PER_FOOT', () => {
    const design = makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT);
    expect(design.footprint.widthMm).toBe(12 * MM_PER_FOOT);
    expect(design.footprint.lengthMm).toBe(12 * MM_PER_FOOT);
    expect(design.footprint.heightMm).toBe(3 * MM_PER_FOOT);
  });

  it('sets the material triples from DEFAULT_DESIGN_PARAMS', () => {
    const design = makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT);
    expect(design.joist.material).toEqual({ nominal: '2x8', species: 'PT', grade: 'No2' });
    expect(design.joist.spacingMm).toBe(406);
    expect(design.beam.material).toEqual({ nominal: '2x8', species: 'PT', grade: 'No2' });
    expect(design.post.material).toEqual({ nominal: '6x6', species: 'PT', grade: 'No2' });
    expect(design.decking.material).toEqual({
      nominal: '5/4x6',
      species: 'PT',
      grade: 'No2',
    });
    expect(design.decking.orientation).toBe('parallel-to-width');
    expect(design.layout.bayRemainderStrategy).toBe('extra-bay-at-end');
  });
});

describe('makeDefaultDesign — AC8 computes without LayoutError', () => {
  it('the default heightMm (914 mm) is at or above computeMinStructuralHeightMm', () => {
    // The load-bearing invariant: 3 ft = 914 mm MUST be enough for
    // decking + 2x8 joist depth + 2x8 beam depth + MIN_POST_HEIGHT_MM.
    // If future changes to material actual sizes push the minimum
    // above 914 mm, the RED here forces us to revise the default.
    const design = makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT);
    const minHeight = computeMinStructuralHeightMm(design);
    expect(design.footprint.heightMm).toBeGreaterThanOrEqual(minHeight);
  });

  it('computeLayout succeeds and produces a non-empty member list', () => {
    // The ultimate AC8 verification — if this throws, boot is broken.
    const design = makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT);
    expect(() => computeLayout(design, { now: () => FIXED_CREATED_AT })).not.toThrow();
    const layout = computeLayout(design, { now: () => FIXED_CREATED_AT });
    expect(layout.members.length).toBeGreaterThan(0);
    expect(layout.designId).toBe(FIXED_ID);
  });

  it('propagates NOT a LayoutError (defensive — engine would throw for invalid designs)', () => {
    // Belt-and-suspenders: prove the exception type isn't
    // silently a `LayoutError` in disguise.
    let thrown: unknown = null;
    try {
      computeLayout(makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeNull();
    expect(thrown).not.toBeInstanceOf(LayoutError);
  });
});

describe('makeDefaultDesign — AC8-A pair-fix regression (zero span warnings)', () => {
  // Pair-fix Review, HIGH: the default MUST produce zero span-check
  // warnings on first paint. The pre-fix default (12×16 + 2×8
  // joists/beams) emitted twelve warnings — a wall of red on boot
  // that contradicts the "sensible default" spirit of AC8. This
  // test locks the invariant permanently so a future material or
  // footprint edit that reintroduces over-spans fails RED here
  // before it can reach a user.
  it('spanCheck on the default layout returns [] (zero warnings)', () => {
    const design = makeDefaultDesign(FIXED_ID, FIXED_CREATED_AT);
    const layout = computeLayout(design, { now: () => FIXED_CREATED_AT });
    const warnings = spanCheck(layout, new IrcSpanTable());
    // Emit the offenders in the failure message so a future
    // regression is diagnosable without re-running a probe by hand.
    expect(warnings, `default produced ${warnings.length} warning(s): ${JSON.stringify(warnings)}`).toEqual([]);
  });
});
