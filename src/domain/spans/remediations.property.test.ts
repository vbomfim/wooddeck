/**
 * `src/domain/spans/remediations.property.test.ts` — S16 pair-fix
 * property test (Opus review #9, PR §18).
 *
 * ## Purpose
 *
 * A `fast-check` property that pairs naturally with the S16 pair-fix:
 *
 *   `wouldClear=true && !disabled` ⟹ `applyPatch(design, option)`
 *   produces a design whose recompute NO LONGER contains a warning
 *   at `(warning.memberId, warning.kind)`.
 *
 * Before the pair-fix, the compute derived `wouldClear` from
 * SpanTable proxies that DIVERGED from the real recompute. The
 * property test would have found counterexamples with high
 * probability across the reviewers' repros (12×18 beam,
 * 8×10 beam, 10×8 joist-spacing-drift, 16×14 floating). The
 * deterministic `it.each` cross-check test in `remediations.test.ts`
 * exercises specific repro cases; this property test provides
 * defence-in-depth by sweeping a wider randomized input space.
 *
 * ## Why a SEPARATE file
 *
 * The main `remediations.test.ts` has 30+ deterministic tests and is
 * already large. A property test iterates 100+ times per run and
 * benefits from being isolated (a failure here signals a
 * fundamentally different class of bug — a WRONG `wouldClear`
 * decision — vs the deterministic tests, which check specific
 * shape/ordering invariants).
 *
 * ## Property scope
 *
 * The generator produces designs with:
 *   - width 8–20 ft, length 8–24 ft (covers common backyard scale)
 *   - joist / beam nominal in { 2x6, 2x8, 2x10, 2x12 }
 *   - species in { Cedar, PT }
 *   - joist spacing in { 305, 406, 610 } mm
 *   - structure elevated or floating (S19 floating span-check)
 *
 * If the recompute produces no over-span warnings for a generated
 * design, the property is vacuously true and moves on.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT } from '../units';
import type { DeckDesign, LumberNominal, Species, Warning } from '../model';
import { computeLayout } from '../layout';

import { IrcSpanTable } from './irc-2018-tables';
import { spanCheck } from './span-check';
import { computeRemediations } from './remediations';
import type { RemediationOption } from './remediations';

const IRC = new IrcSpanTable();
const RECOMPUTE = (design: DeckDesign): readonly Warning[] =>
  spanCheck(computeLayout(design), IRC);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const NOMINALS: readonly LumberNominal[] = [
  '2x6',
  '2x8',
  '2x10',
  '2x12',
] as const;
const SPECIES: readonly Species[] = ['Cedar', 'PT'] as const;
const SPACINGS = [305, 406, 610] as const;

interface GeneratedDesignSpec {
  readonly widthFt: number;
  readonly lengthFt: number;
  readonly joistNominal: LumberNominal;
  readonly joistSpecies: Species;
  readonly beamNominal: LumberNominal;
  readonly beamSpecies: Species;
  readonly spacingMm: 305 | 406 | 610;
  readonly floating: boolean;
}

const designSpecArb: fc.Arbitrary<GeneratedDesignSpec> = fc.record({
  widthFt: fc.integer({ min: 8, max: 20 }),
  lengthFt: fc.integer({ min: 8, max: 24 }),
  joistNominal: fc.constantFrom(...NOMINALS),
  joistSpecies: fc.constantFrom(...SPECIES),
  beamNominal: fc.constantFrom(...NOMINALS),
  beamSpecies: fc.constantFrom(...SPECIES),
  spacingMm: fc.constantFrom(...SPACINGS),
  floating: fc.boolean(),
});

function buildDesign(spec: GeneratedDesignSpec): DeckDesign {
  const base: DeckDesign = {
    id: '00000000-0000-4000-8000-00000000fc00',
    createdAt: '2026-07-04T00:00:00.000Z',
    footprint: {
      widthMm: spec.widthFt * MM_PER_FOOT,
      lengthMm: spec.lengthFt * MM_PER_FOOT,
      heightMm: 914,
    },
    structure: 'elevated',
    floatingFraming: 'beams-and-joists',
    foundation: {
      type: 'posts-on-footings',
      post: { nominal: '6x6', species: 'PT', grade: 'No2' },
      footing: { widthMm: 300, depthMm: 300 },
    },
    joist: {
      material: {
        nominal: spec.joistNominal,
        species: spec.joistSpecies,
        grade: 'No2',
      },
      spacingMm: spec.spacingMm,
    },
    beam: {
      material: {
        nominal: spec.beamNominal,
        species: spec.beamSpecies,
        grade: 'No2',
      },
    },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
  if (spec.floating) {
    return {
      ...base,
      structure: 'floating',
      floatingFraming: 'beams-and-joists',
      // Foundation for floating: tuffblocks. Same block SKU used
      // by span-check-floating.test.ts.
      foundation: {
        type: 'tuffblocks',
        product: { productId: 'tuffblock-12x12x4' },
      },
    };
  }
  return base;
}

/**
 * Mirrors the domain module's `applyPatchForVerification` — kept
 * LOCAL to the test to avoid crossing the domain-internal seam.
 */
function applyPatch(
  design: DeckDesign,
  option: RemediationOption,
): DeckDesign {
  const { patch } = option;
  switch (patch.kind) {
    case 'reduce-joist-spacing':
      return {
        ...design,
        joist: { ...design.joist, spacingMm: patch.newSpacingMm },
      };
    case 'upgrade-joist-size':
      return {
        ...design,
        joist: {
          ...design.joist,
          material: { ...design.joist.material, nominal: patch.newNominal },
        },
      };
    case 'upgrade-beam-size':
      return {
        ...design,
        beam: {
          ...design.beam,
          material: { ...design.beam.material, nominal: patch.newNominal },
        },
      };
    case 'change-joist-species':
      return {
        ...design,
        joist: {
          ...design.joist,
          material: {
            ...design.joist.material,
            species: patch.newSpecies,
            grade: 'No2',
          },
        },
      };
    case 'change-beam-species':
      return {
        ...design,
        beam: {
          ...design.beam,
          material: {
            ...design.beam.material,
            species: patch.newSpecies,
            grade: 'No2',
          },
        },
      };
    case 'add-support-row': {
      // S25 — the property test synthesizes designs on the fly
      // and asserts "wouldClear ⟹ actually clears" after
      // applying the patch. Add-support-row only fires on
      // FLOATING + block foundations, and the arbitrary can
      // produce those variants; mirror the domain module's
      // `applyPatchForVerification` behavior so the property
      // still holds for this KIND.
      if (design.foundation.type === 'posts-on-footings') {
        return design; // Guard — producer never emits for this.
      }
      return {
        ...design,
        foundation: {
          ...design.foundation,
          blockRowsHint: patch.proposedRows,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('computeRemediations — property: wouldClear ⟹ actually-clears', () => {
  it('for every generated design, every wouldClear option truly clears its warning', () => {
    fc.assert(
      fc.property(designSpecArb, (spec) => {
        // The layout engine throws LayoutError for designs below
        // the minimum size or with invalid dimensions. Filter
        // those out; they're not what this property tests.
        let design: DeckDesign;
        try {
          design = buildDesign(spec);
        } catch {
          return true;
        }
        let initialWarnings: readonly Warning[];
        try {
          initialWarnings = RECOMPUTE(design);
        } catch {
          return true;
        }
        const modelled = initialWarnings.filter(
          (w) => w.kind === 'over-span-joist' || w.kind === 'over-span-beam',
        );
        if (modelled.length === 0) {
          // Compliant design — property is vacuously true.
          return true;
        }
        for (const warning of modelled) {
          const options = computeRemediations(warning, design, IRC, RECOMPUTE);
          const clearing = options.filter(
            (o) => o.wouldClear && !o.disabled,
          );
          for (const opt of clearing) {
            const patched = applyPatch(design, opt);
            let afterWarnings: readonly Warning[];
            try {
              afterWarnings = RECOMPUTE(patched);
            } catch {
              // The patch produced an invalid design — that
              // means the SAME candidate should have been marked
              // `invalidPatch` inside `verifyPatchClears` and
              // returned as `disabled`. If we got here with
              // `wouldClear=true && !disabled`, it's a bug.
              return false;
            }
            const stillPresent = afterWarnings.find(
              (w) =>
                w.memberId === warning.memberId && w.kind === warning.kind,
            );
            if (stillPresent !== undefined) {
              // COUNTEREXAMPLE: the option claimed wouldClear but
              // the real recompute still has the warning.
              return false;
            }
          }
        }
        return true;
      }),
      // 100 iterations balances signal vs runtime; layout engine
      // is <0.1ms per call, so 100 × ~15 recomputes × ~3
      // warnings = ~4500 layouts = < 1s. Keep the default seed
      // so failing cases can be reproduced deterministically.
      { numRuns: 100 },
    );
    // If fc.assert didn't throw, all iterations passed.
    expect(true).toBe(true);
  });
});
