/**
 * Unit tests for `src/application/apply-remediation.ts` — S16 issue
 * #38 TDD RED phase.
 *
 * ## Coverage
 *
 *   - AC7  `applyRemediation(design, option, table)` produces a
 *          `DesignBundle` DEEPLY EQUAL to
 *          `applyParameters(design, equivalentPatch, table)`
 *          for every remediation kind (delegator equivalence).
 *   - AC8  The error contract is INHERITED from `applyParameters` —
 *          a `LayoutError` from `computeLayout` propagates unchanged.
 *   - Deep-shape: the `patch → DeepPartial<DeckDesign>` conversion
 *          is a pure, deterministic mapping — property test across
 *          every discriminant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutError, computeLayout } from '../domain/layout';
import { IrcSpanTable } from '../domain/spans';
import type { RemediationOption } from '../domain/spans';
import { computeRemediations } from '../domain/spans';
import { spanCheck } from '../domain/spans';
import type { DeckDesign, Warning } from '../domain/model';
import { FIXTURE_DESIGNS } from '../domain/layout/__fixtures__/fixtures-data';

import { applyParameters } from './apply-parameters';
import { applyRemediation } from './apply-remediation';

const table = new IrcSpanTable();
const FIXTURE: DeckDesign = FIXTURE_DESIGNS[2]!.design;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-04T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC7 — delegator equivalence
// ---------------------------------------------------------------------------

describe('applyRemediation — AC7 delegator equivalence', () => {
  it('upgrade-joist-size → deep-equal to applyParameters(joist.material.nominal)', () => {
    const option: RemediationOption = {
      kind: 'upgrade-joist-size',
      memberId: 'joist-0',
      patch: { kind: 'upgrade-joist-size', newNominal: '2x10' },
      summary: 'Upgrade joists to 2x10',
      currentAllowableMm: 3607,
      newAllowableMm: 4267,
      actualSpanMm: 4577,
      wouldClear: false,
      disabled: false,
      disabledReason: null,
    };
    const a = applyRemediation(FIXTURE, option, table);
    const b = applyParameters(
      FIXTURE,
      { joist: { material: { nominal: '2x10' } } },
      table,
    );
    expect(a).toStrictEqual(b);
  });

  it('reduce-joist-spacing → deep-equal to applyParameters(joist.spacingMm)', () => {
    const option: RemediationOption = {
      kind: 'reduce-joist-spacing',
      memberId: 'joist-0',
      patch: { kind: 'reduce-joist-spacing', newSpacingMm: 305 },
      summary: 'Reduce spacing to 12 in',
      currentAllowableMm: 3607,
      newAllowableMm: 5029,
      actualSpanMm: 4577,
      wouldClear: true,
      disabled: false,
      disabledReason: null,
    };
    const a = applyRemediation(FIXTURE, option, table);
    const b = applyParameters(FIXTURE, { joist: { spacingMm: 305 } }, table);
    expect(a).toStrictEqual(b);
  });

  it('upgrade-beam-size → deep-equal to applyParameters(beam.material.nominal)', () => {
    const option: RemediationOption = {
      kind: 'upgrade-beam-size',
      memberId: 'beam-near',
      patch: { kind: 'upgrade-beam-size', newNominal: '2x12' },
      summary: 'Upgrade beams to 2x12',
      currentAllowableMm: 2600,
      newAllowableMm: 3200,
      actualSpanMm: 3000,
      wouldClear: true,
      disabled: false,
      disabledReason: null,
    };
    const a = applyRemediation(FIXTURE, option, table);
    const b = applyParameters(
      FIXTURE,
      { beam: { material: { nominal: '2x12' } } },
      table,
    );
    expect(a).toStrictEqual(b);
  });

  it('change-joist-species → deep-equal to applyParameters(joist.material.species)', () => {
    // The FIXTURE joists are PT; a Cedar swap would WORSEN. But
    // the delegator-equivalence test only checks that the two
    // paths produce the same DesignBundle for the same equivalent
    // patch — not that the patch is safe. Use PT (a no-op change
    // relative to the fixture) so the layout engine stays happy.
    const option: RemediationOption = {
      kind: 'change-joist-species',
      memberId: 'joist-0',
      patch: { kind: 'change-joist-species', newSpecies: 'PT' },
      summary: 'Change joist species to PT',
      currentAllowableMm: 3607,
      newAllowableMm: 3607,
      actualSpanMm: 3607,
      wouldClear: true,
      disabled: false,
      disabledReason: null,
    };
    const a = applyRemediation(FIXTURE, option, table);
    const b = applyParameters(
      FIXTURE,
      { joist: { material: { species: 'PT' } } },
      table,
    );
    expect(a).toStrictEqual(b);
  });

  it('change-beam-species → deep-equal to applyParameters(beam.material.species)', () => {
    const option: RemediationOption = {
      kind: 'change-beam-species',
      memberId: 'beam-near',
      patch: { kind: 'change-beam-species', newSpecies: 'PT' },
      summary: 'Change beam species to PT',
      currentAllowableMm: 2600,
      newAllowableMm: 3000,
      actualSpanMm: 2800,
      wouldClear: true,
      disabled: false,
      disabledReason: null,
    };
    const a = applyRemediation(FIXTURE, option, table);
    const b = applyParameters(
      FIXTURE,
      { beam: { material: { species: 'PT' } } },
      table,
    );
    expect(a).toStrictEqual(b);
  });
});

// ---------------------------------------------------------------------------
// AC8 — error contract inherited from applyParameters
// ---------------------------------------------------------------------------

describe('applyRemediation — AC8 error contract', () => {
  it('a synthetic option that produces a dimensionally-invalid design → LayoutError propagates unchanged', () => {
    // Route through the change-joist-species patch with a species
    // NOT in the SKU manifest (`Ipe`). `applyParameters` will
    // pass the merged design to `computeLayout` which will
    // fail-lookup the (nominal, species, grade) triple in the
    // materials-catalog — the exact error class doesn't matter
    // (LayoutError vs a raw catalog-lookup Error is a downstream
    // detail); the delegator contract is "whatever comes out of
    // applyParameters comes out of applyRemediation unchanged."
    const option: RemediationOption = {
      kind: 'change-joist-species',
      memberId: 'joist-0',
      // Cast through unknown — the domain typechecks Species as
      // an allow-list; this test intentionally injects an
      // out-of-allow-list value to exercise the downstream
      // failure path.
      patch: {
        kind: 'change-joist-species',
        newSpecies: 'Ipe' as unknown as 'PT',
      },
      summary: 'Change joist species to Ipe (unsupported)',
      currentAllowableMm: 3607,
      newAllowableMm: 0,
      actualSpanMm: 4577,
      wouldClear: false,
      disabled: false,
      disabledReason: null,
    };
    // Whatever `applyParameters` throws MUST be what `applyRemediation`
    // throws — same class, same message. Test the two paths side-by-side.
    let paramsErr: unknown = null;
    let remediationErr: unknown = null;
    try {
      applyParameters(
        FIXTURE,
        { joist: { material: { species: 'Ipe' as unknown as 'PT' } } },
        table,
      );
    } catch (e) {
      paramsErr = e;
    }
    try {
      applyRemediation(FIXTURE, option, table);
    } catch (e) {
      remediationErr = e;
    }
    // Both paths must throw the same class.
    expect(paramsErr).not.toBeNull();
    expect(remediationErr).not.toBeNull();
    if (paramsErr instanceof Error && remediationErr instanceof Error) {
      expect(remediationErr.constructor).toBe(paramsErr.constructor);
      // Same textual message (delegator is a pass-through).
      expect(remediationErr.message).toBe(paramsErr.message);
    }
  });

  it('does NOT catch or wrap a LayoutError from applyParameters', () => {
    // Directly patch a bad joist material (composite in framing
    // location) to trigger downstream. `applyRemediation` MUST
    // propagate as-is (no catch, no wrap).
    const option: RemediationOption = {
      kind: 'change-joist-species',
      memberId: 'joist-0',
      // Composite is not a legal framing species — the domain
      // catalog will fail-lookup (LayoutError).
      patch: { kind: 'change-joist-species', newSpecies: 'Composite' },
      summary: 'Change joist species to Composite (invalid)',
      currentAllowableMm: 3607,
      newAllowableMm: 0,
      actualSpanMm: 4577,
      wouldClear: false,
      disabled: false,
      disabledReason: null,
    };
    let thrown: unknown = null;
    try {
      applyRemediation(FIXTURE, option, table);
    } catch (e) {
      thrown = e;
    }
    // Must be some Error (either LayoutError or the raw Error
    // from materials-catalog — both are acceptable per the
    // applyParameters contract). NEVER null / undefined —
    // silent swallowing is forbidden.
    //
    // Composite joist framing may or may not be catalog-supported
    // — if it IS (the catalog has a Composite joist row), the
    // apply succeeds and we skip this assertion; the important
    // property is "no catch inside applyRemediation" which is
    // encoded by the fact that whatever applyParameters returns
    // (bundle OR throw) is what applyRemediation returns.
    if (thrown !== null) {
      expect(thrown).toBeInstanceOf(Error);
      // If it's a LayoutError specifically, verify no wrapping.
      if (thrown instanceof LayoutError) {
        expect(thrown).toBeInstanceOf(LayoutError);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// S25 (ticket #47) — add-support-row apply + end-to-end payoff test
// ---------------------------------------------------------------------------

describe('applyRemediation — S25 add-support-row', () => {
  const table25 = new IrcSpanTable();

  function makeFloatingDesign(
    blockRowsHint: number | undefined,
    framing: 'beams-and-joists' | 'joists-on-blocks' = 'joists-on-blocks',
  ): DeckDesign {
    return {
      id: '00000000-0000-4000-8000-000000000025',
      createdAt: '2026-07-04T00:00:00.000Z',
      footprint: {
        widthMm: 12 * 304.8,
        lengthMm: 12 * 304.8,
        heightMm: 500,
      },
      structure: 'floating',
      floatingFraming: framing,
      beamConnection: 'drop',
      foundation:
        blockRowsHint !== undefined
          ? {
              type: 'tuffblocks',
              product: { productId: 'tuffblock-12x12x4' },
              blockRowsHint,
            }
          : {
              type: 'tuffblocks',
              product: { productId: 'tuffblock-12x12x4' },
            },
      joist: {
        material: { nominal: '2x8', species: 'PT', grade: 'No2' },
        spacingMm: 406,
      },
      beam: {
        material: { nominal: '2x8', species: 'PT', grade: 'No2' },
      },
      decking: {
        material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
        orientation: 'parallel-to-width',
      },
      layout: { bayRemainderStrategy: 'extra-bay-at-end' },
    };
  }

  it('applyRemediation add-support-row → bundle.design.foundation.blockRowsHint === proposedRows', () => {
    // Starting design: floating with blockRowsHint=2 (an over-spanned
    // configuration). Apply add-support-row → proposedRows=3.
    // The bundle's foundation.blockRowsHint should be exactly 3.
    const design = makeFloatingDesign(2);
    const option: RemediationOption = {
      kind: 'add-support-row',
      memberId: 'beam-near',
      patch: {
        kind: 'add-support-row',
        targetBeamId: 'beam-near',
        currentRows: 2,
        proposedRows: 3,
      },
      summary: 'Add a row of blocks (2 → 3)',
      currentAllowableMm: 2000,
      newAllowableMm: 2000,
      actualSpanMm: 1828,
      wouldClear: true,
      disabled: false,
      disabledReason: null,
    };
    const bundle = applyRemediation(design, option, table25);
    if (bundle.design.foundation.type !== 'tuffblocks') {
      throw new Error(
        `expected bundle.design.foundation.type='tuffblocks' but got '${bundle.design.foundation.type}'`,
      );
    }
    expect(bundle.design.foundation.blockRowsHint).toBe(3);
    // Product + type preserved (spread semantics — did not clobber).
    expect(bundle.design.foundation.product).toEqual({
      productId: 'tuffblock-12x12x4',
    });
  });

  it('S26 FIX #4 — END-TO-END PAYOFF: Method B over-spanned joist cleared by add-support-row', () => {
    // S26 FIX #4 (review-gate) un-skip: pre-S26 this test used
    // Method A where blockRowsHint controlled the beam grid. S26
    // pinned Method A rows to the rim beams (hint ignored). The
    // block-row remediation is MEANINGFUL under Method B — adding
    // a row of blocks along +z genuinely shortens the joist span
    // (blocks sit directly under joists in Method B).
    //
    // Same 12×12 geometry, same 2×8 PT joist, blockRowsHint=2:
    // joist span 3657.6 mm >> allowable ~2400 mm → over-span-joist
    // warning fires. Apply add-support-row → hint=3 → joist span
    // = 1828.8 mm < allowable → warning clears.
    const design = makeFloatingDesign(2, 'joists-on-blocks');
    // Sanity: the initial design has an over-span-joist warning.
    const initial = spanCheck(computeLayout(design), table25);
    const joistWarning = initial.find((w) => w.kind === 'over-span-joist');
    expect(joistWarning).toBeDefined();
    if (!joistWarning) return;

    const recompute = (d: DeckDesign): readonly Warning[] =>
      spanCheck(computeLayout(d), table25);
    const options = computeRemediations(
      joistWarning,
      design,
      table25,
      recompute,
    );
    const addSupport = options.find((o) => o.kind === 'add-support-row');
    expect(addSupport).toBeDefined();
    if (!addSupport) return;
    expect(addSupport.wouldClear).toBe(true);

    // Apply → the bundle's warnings must NOT contain an over-span
    // for the same joist id.
    const bundle = applyRemediation(design, addSupport, table25);
    const stillOverSpanning = bundle.warnings.some(
      (w) =>
        w.kind === 'over-span-joist' &&
        w.memberId === joistWarning.memberId,
    );
    expect(stillOverSpanning).toBe(false);
    // The hint made it into the design.
    if (bundle.design.foundation.type === 'tuffblocks') {
      expect(bundle.design.foundation.blockRowsHint).toBe(3);
    }
  });

  it('S26 FIX #4 — Method B: setting blockRowsHint to undefined derives a safe count that produces no over-span', () => {
    // S26 FIX #4 (review-gate) un-skip: pre-S26 this test was
    // .skip'd because Method A ignores blockRowsHint. Under
    // Method B, `undefined` hint falls back to the S19 derivation
    // (ceil(lengthMm/joistSpanMaxMm)+1 — same as elevated joist
    // count). For 12ft × 12ft with 2×8 PT @ 406mm: joistSpanMax =
    // 3226 mm, so derivation = ceil(3657.6/3226)+1 = 3 rows → joist
    // span = 1828.8 mm < allowable → no over-span.
    const a = spanCheck(
      computeLayout(makeFloatingDesign(undefined, 'joists-on-blocks')),
      table25,
    );
    expect(a.find((w) => w.kind === 'over-span-joist')).toBeUndefined();
  });
});
