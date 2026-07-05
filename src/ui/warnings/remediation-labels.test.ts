/**
 * Unit tests for `src/ui/warnings/remediation-labels.ts` — S16
 * issue #38 TDD RED phase.
 *
 * ## Coverage
 *
 *   - AC15  Unit-aware — imperial system yields feet/inches,
 *           metric system yields millimeters. Same option
 *           produces DIFFERENT strings across the two systems.
 *   - Purity — no globals touched, no console output, no
 *           network / I/O. `formatRemediationOption` returns
 *           `{headline, detail}` with plain strings.
 *   - Disabled options still produce a headline + detail — the
 *           disabled REASON is surfaced in the detail so a screen
 *           reader user hears why the option is unavailable.
 *   - Every `RemediationKind` produces a non-empty headline and
 *           detail — no missing-branch fall-through.
 */
import { describe, expect, it } from 'vitest';

import type { RemediationOption } from '../../state';

import { formatRemediationOption } from './remediation-labels';

function makeOption(
  overrides: Partial<RemediationOption> & Pick<RemediationOption, 'kind' | 'patch'>,
): RemediationOption {
  return {
    memberId: 'joist-0',
    summary: 'placeholder',
    currentAllowableMm: 3607,
    newAllowableMm: 5029,
    actualSpanMm: 4577,
    wouldClear: true,
    disabled: false,
    disabledReason: null,
    ...overrides,
  };
}

describe('formatRemediationOption — AC15 unit-aware', () => {
  it('reduce-joist-spacing: imperial → inches; metric → mm/cm/m', () => {
    const option = makeOption({
      kind: 'reduce-joist-spacing',
      patch: { kind: 'reduce-joist-spacing', newSpacingMm: 305 },
    });
    const imperial = formatRemediationOption(option, 'imperial');
    const metric = formatRemediationOption(option, 'metric');
    expect(imperial.headline).not.toBe(metric.headline);
    // Imperial mentions inches OR feet somewhere.
    expect(imperial.headline + imperial.detail).toMatch(/in|ft|"|'/);
    // Metric mentions ANY metric unit (mm/cm/m). formatLength picks
    // the natural unit — 305 mm formats as `30.5 cm`, not `305 mm`.
    // Test the presence of a metric unit at all, not the specific
    // unit — that's a formatLength implementation detail.
    expect(metric.headline + metric.detail).toMatch(/\b(mm|cm|m)\b/);
  });

  it('upgrade-joist-size: nominal is a stable identifier across units', () => {
    // Nominals like `2x10` are conventional trade shorthand — they
    // don't change across units. The headline should mention the
    // nominal in both systems.
    const option = makeOption({
      kind: 'upgrade-joist-size',
      patch: { kind: 'upgrade-joist-size', newNominal: '2x10' },
    });
    const imperial = formatRemediationOption(option, 'imperial');
    const metric = formatRemediationOption(option, 'metric');
    expect(imperial.headline).toMatch(/2x10/);
    expect(metric.headline).toMatch(/2x10/);
  });

  it('upgrade-beam-size: nominal in headline', () => {
    const option = makeOption({
      kind: 'upgrade-beam-size',
      memberId: 'beam-0',
      patch: { kind: 'upgrade-beam-size', newNominal: '2x12' },
    });
    const imperial = formatRemediationOption(option, 'imperial');
    expect(imperial.headline).toMatch(/2x12/);
  });

  it('change-joist-species: species name in headline', () => {
    const option = makeOption({
      kind: 'change-joist-species',
      patch: { kind: 'change-joist-species', newSpecies: 'PT' },
    });
    const { headline } = formatRemediationOption(option, 'imperial');
    expect(headline).toMatch(/PT|pressure/i);
  });

  it('change-beam-species: species name in headline', () => {
    const option = makeOption({
      kind: 'change-beam-species',
      memberId: 'beam-0',
      patch: { kind: 'change-beam-species', newSpecies: 'PT' },
    });
    const { headline } = formatRemediationOption(option, 'imperial');
    expect(headline).toMatch(/PT|pressure/i);
  });
});

describe('formatRemediationOption — detail includes clearance context', () => {
  it('wouldClear=true → detail mentions "clears" (positive framing)', () => {
    const option = makeOption({
      kind: 'reduce-joist-spacing',
      patch: { kind: 'reduce-joist-spacing', newSpacingMm: 305 },
      wouldClear: true,
    });
    const { detail } = formatRemediationOption(option, 'imperial');
    expect(detail.toLowerCase()).toContain('clear');
  });

  it('wouldClear=false → detail mentions "partial" / "still over" / similar', () => {
    // A non-clearing option (which the domain still surfaces
    // per AC4/AC16 — with disabled=true) must communicate that
    // it won't clear. The detail is the natural place — the
    // headline should stay concise for the radio label.
    const option = makeOption({
      kind: 'upgrade-joist-size',
      patch: { kind: 'upgrade-joist-size', newNominal: '2x10' },
      wouldClear: false,
      disabled: true,
      disabledReason: 'Still exceeds allowable span',
    });
    const { detail } = formatRemediationOption(option, 'imperial');
    // The disabledReason should be woven into the detail so
    // assistive-tech users hear WHY it's disabled.
    expect(detail).toMatch(/still|exceed|not clear|does not clear|reason/i);
  });
});

describe('formatRemediationOption — purity + robustness', () => {
  it('returns {headline, detail} plain-string object', () => {
    const option = makeOption({
      kind: 'reduce-joist-spacing',
      patch: { kind: 'reduce-joist-spacing', newSpacingMm: 305 },
    });
    const out = formatRemediationOption(option, 'imperial');
    expect(typeof out.headline).toBe('string');
    expect(typeof out.detail).toBe('string');
    expect(out.headline.length).toBeGreaterThan(0);
    expect(out.detail.length).toBeGreaterThan(0);
  });

  it('is deterministic — same input → same output', () => {
    const option = makeOption({
      kind: 'change-beam-species',
      memberId: 'beam-0',
      patch: { kind: 'change-beam-species', newSpecies: 'PT' },
    });
    const a = formatRemediationOption(option, 'imperial');
    const b = formatRemediationOption(option, 'imperial');
    expect(a).toEqual(b);
  });

  it('never throws — even for edge-case values', () => {
    // Zero and very-large mm values are legal Mm; the formatter
    // must not blow up.
    const option = makeOption({
      kind: 'reduce-joist-spacing',
      patch: { kind: 'reduce-joist-spacing', newSpacingMm: 305 },
      newAllowableMm: 0,
      actualSpanMm: 999_999,
    });
    expect(() => formatRemediationOption(option, 'imperial')).not.toThrow();
    expect(() => formatRemediationOption(option, 'metric')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// S25 (ticket #47) — add-support-row label
// ---------------------------------------------------------------------------

describe('formatRemediationOption — S25 add-support-row', () => {
  it('produces a headline in the form "Add a row of blocks (N → M)"', () => {
    const option = makeOption({
      kind: 'add-support-row',
      memberId: 'beam-near',
      patch: {
        kind: 'add-support-row',
        targetBeamId: 'beam-near',
        currentRows: 2,
        proposedRows: 3,
      },
    });
    const imperial = formatRemediationOption(option, 'imperial');
    const metric = formatRemediationOption(option, 'metric');
    // The block-row count is a dimensionless integer — same string
    // across unit systems.
    expect(imperial.headline).toBe(metric.headline);
    // Must mention "row" and the count change 2 → 3.
    expect(imperial.headline).toMatch(/row/i);
    expect(imperial.headline).toContain('2');
    expect(imperial.headline).toContain('3');
  });

  it('non-empty headline + detail for both enabled and disabled variants', () => {
    const enabled = makeOption({
      kind: 'add-support-row',
      memberId: 'beam-near',
      patch: {
        kind: 'add-support-row',
        targetBeamId: 'beam-near',
        currentRows: 3,
        proposedRows: 4,
      },
    });
    const disabled = makeOption({
      kind: 'add-support-row',
      memberId: 'beam-near',
      patch: {
        kind: 'add-support-row',
        targetBeamId: 'beam-near',
        currentRows: 3,
        proposedRows: 4,
      },
      wouldClear: false,
      disabled: true,
      disabledReason:
        'One more row would still exceed the allowable beam span.',
    });
    for (const opt of [enabled, disabled]) {
      const out = formatRemediationOption(opt, 'imperial');
      expect(out.headline.length).toBeGreaterThan(0);
      expect(out.detail.length).toBeGreaterThan(0);
    }
  });

  // S25 pair-fix (Opus MED#4) — headlineFor MUST NOT render a
  // count-arrow when the option is disabled AND the placeholder
  // row counts on the patch would produce a contradictory label
  // (e.g. an elevated design's "(2 → 2)" or "(2 → 3)" alongside a
  // "Switch to Floating construction" disabled reason). The
  // `summary` field is the presentation-safe fallback.
  it('elevated-disabled variant renders `summary` as the headline, no "N → M" arrow', () => {
    const disabled: RemediationOption = {
      kind: 'add-support-row',
      memberId: 'beam-near',
      // Placeholder counts (equal) — meaningless for the elevated
      // path. `produceAddSupportRow` sets both to 2 in
      // `makeDisabledAddSupportRowNoRowCount`.
      patch: {
        kind: 'add-support-row',
        targetBeamId: 'beam-near',
        currentRows: 2,
        proposedRows: 2,
      },
      summary: 'Add a support row',
      currentAllowableMm: 1981,
      newAllowableMm: 0,
      actualSpanMm: 6000,
      wouldClear: false,
      disabled: true,
      disabledReason:
        'Switch to Floating construction to enable intermediate support rows.',
    };
    const out = formatRemediationOption(disabled, 'imperial');
    // Headline is the summary — no arrow, no numbers.
    expect(out.headline).toBe('Add a support row');
    expect(out.headline).not.toMatch(/→/);
    expect(out.headline).not.toMatch(/2/);
    // Detail carries the alternative-surfacing reason.
    expect(out.detail.toLowerCase()).toContain('floating');
  });
});

// ---------------------------------------------------------------------------
// HIGH #3 (review — feat/block-spacing): the ACTIVE Method-B
// path carries `currentSpacingMm` + `proposedSpacingMm` on the
// patch. The label MUST render length-based headlines
// ("Reduce block spacing to add support (X → Y)") when those
// fields are present — the user thinks in spacing, not row
// counts. Legacy path (fields undefined) still renders the
// count-arrow.
// ---------------------------------------------------------------------------

describe('formatRemediationOption — HIGH #3 Method-B spacing-primary headline', () => {
  it('renders "Reduce block spacing to add support (X → Y)" with unit-aware length values', () => {
    const option = makeOption({
      kind: 'add-support-row',
      memberId: 'joist-3',
      patch: {
        kind: 'add-support-row',
        targetBeamId: 'joist-3',
        currentRows: 2,
        proposedRows: 5,
        currentSpacingMm: 3657.6, // 12 ft
        proposedSpacingMm: 914.4, // 3 ft
      },
    });
    const imperial = formatRemediationOption(option, 'imperial');
    const metric = formatRemediationOption(option, 'metric');
    // Both systems mention "Reduce block spacing".
    expect(imperial.headline.toLowerCase()).toContain('reduce block spacing');
    expect(metric.headline.toLowerCase()).toContain('reduce block spacing');
    // Imperial displays feet/inches; metric displays SI units.
    expect(imperial.headline).toMatch(/′|ft/); // prime or "ft" (formatLength uses ′)
    expect(metric.headline).toMatch(/mm|cm|m\b/);
    // No misleading count-arrow "N → M" alongside the length arrow.
    // Only the length arrow present.
    expect(metric.headline).toContain('→');
    // No lying (5 → 8) — the counts are secondary; the headline
    // is length-primary.
    expect(imperial.headline).not.toMatch(/\(5 → 8\)/);
  });

  it('legacy patch (no spacing fields) still renders the count-arrow ("Add a row of blocks (N → M)")', () => {
    const option = makeOption({
      kind: 'add-support-row',
      memberId: 'beam-near',
      patch: {
        kind: 'add-support-row',
        targetBeamId: 'beam-near',
        currentRows: 2,
        proposedRows: 3,
        // no proposedSpacingMm — legacy path.
      },
    });
    const out = formatRemediationOption(option, 'imperial');
    expect(out.headline).toBe('Add a row of blocks (2 → 3)');
  });
});
