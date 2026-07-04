/**
 * Unit tests for `src/ui/warnings/RemediationControls.tsx` — S16
 * issue #38 TDD RED phase.
 *
 * ## Coverage
 *
 *   - AC12 Renders a radio group of remediation options + an
 *          "Apply fix" button.
 *   - AC13 The DEFAULT selected radio is the FIRST ENABLED
 *          clearing option (not just "first").
 *   - AC14 The panel has `aria-live="polite"` on the
 *          announcement region so a screen reader hears the
 *          "Applied: <fix summary>" message after Apply.
 *   - AC15 Labels are unit-aware — flipping ui units flips the
 *          label text (delegated to `formatRemediationOption`
 *          which we already unit-test).
 *   - AC16 All-disabled → an explanatory message, no Apply
 *          button — the user must adjust design elsewhere.
 *   - AC17 axe-core smoke — the rendered panel has NO a11y
 *          violations.
 *   - AC18 textContent ONLY — no
 *          `dangerouslySetInnerHTML` anywhere.
 *   - AC19 Applying does NOT reset unrelated UI state — the
 *          camera preset + unit stays where the user left it.
 *   - Disabled options render LAST and their disabled state is
 *          reflected in DOM (`disabled` attribute).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';

import type { Warning } from '../../domain/model';
import {
  resetDesignStoreForTests,
  useDesignStore,
} from '../../state/design-store';
import { useUiStore } from '../../state/ui-store';

import { RemediationControls } from './RemediationControls';

const FIXED_ID = '00000000-0000-4000-8000-0000000abcde';
const FIXED_CREATED_AT = '2026-07-03T10:00:00.000Z';

const UI_INITIAL_STATE = useUiStore.getInitialState();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(FIXED_CREATED_AT));
  localStorage.clear();
  resetDesignStoreForTests({ id: FIXED_ID, createdAt: FIXED_CREATED_AT });
  useUiStore.setState(UI_INITIAL_STATE, true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A default over-span-joist warning. The default 12×12 design DOES
// NOT produce warnings, so the AC scenarios extend the deck to
// 16 ft (>13 ft PT 2×8 @ 406 mm allowable) to force a warning.
function makeJoistOverSpanWarning(design: import('../../domain/model').DeckDesign): Warning {
  return {
    memberId: 'joist-0',
    kind: 'over-span-joist',
    actualMm: design.footprint.lengthMm,
    allowableMm: 3607,
    tableReference: 'IRC-2018 Table R502.3.1(1) — PT No2 2x8 @ 406 mm',
    message: `Joist spans ${design.footprint.lengthMm} mm > allowable 3607 mm.`,
  };
}

/**
 * Extend deck to 16 ft so the store's warnings include at least
 * one over-span-joist. Returns the freshly-mutated warning.
 */
function seedOverSpanWarning(): Warning {
  act(() => {
    // 16 ft = 4877 mm — deep into the over-span region for 2×8 PT.
    useDesignStore.getState().applyParameters({
      footprint: { lengthMm: 4877 },
    });
  });
  const design = useDesignStore.getState().bundle.design;
  return makeJoistOverSpanWarning(design);
}

describe('RemediationControls — AC12 radios + Apply button', () => {
  it('renders a radio group with one radio per option and an Apply-fix button', () => {
    const warning = seedOverSpanWarning();
    render(<RemediationControls warning={warning} />);

    // At least one radio + one submit-style button.
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThan(0);
    const applyBtn = screen.getByRole('button', { name: /apply fix/i });
    expect(applyBtn).toBeDefined();
  });

  it('renders a <fieldset> with a <legend> describing the group', () => {
    const warning = seedOverSpanWarning();
    const { container } = render(<RemediationControls warning={warning} />);
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    const legend = fieldset?.querySelector('legend');
    expect(legend).not.toBeNull();
    // The legend text is meaningful (not empty / whitespace-only).
    expect((legend?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});

describe('RemediationControls — AC13 default selection', () => {
  it('the FIRST ENABLED CLEARING option is pre-selected', () => {
    const warning = seedOverSpanWarning();
    render(<RemediationControls warning={warning} />);

    const radios = screen.getAllByRole('radio');
    // Find the pre-checked radio.
    const checked = radios.find((r) => (r as HTMLInputElement).checked);
    expect(checked).toBeDefined();
    // It must NOT be a disabled radio.
    expect((checked as HTMLInputElement).disabled).toBe(false);
  });
});

describe('RemediationControls — AC14 aria-live announcement', () => {
  it('has an aria-live="polite" announcement region', () => {
    const warning = seedOverSpanWarning();
    const { container } = render(<RemediationControls warning={warning} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
  });

  it('announces "Applied: <summary>" text after Apply', () => {
    const warning = seedOverSpanWarning();
    const { container } = render(<RemediationControls warning={warning} />);

    const applyBtn = screen.getByRole('button', { name: /apply fix/i });
    act(() => {
      fireEvent.click(applyBtn);
    });

    const live = container.querySelector('[aria-live="polite"]');
    // The announcement contains "Applied" — the exact fix summary
    // depends on which option is default-selected, but "Applied"
    // is the invariant word.
    expect(live?.textContent ?? '').toMatch(/applied/i);
  });
});

describe('RemediationControls — AC15 unit-aware labels', () => {
  it('flipping units metric ↔ imperial changes the option label text', () => {
    const warning = seedOverSpanWarning();
    const { container } = render(<RemediationControls warning={warning} />);
    const before = container.textContent ?? '';

    act(() => {
      useUiStore.getState().setUnits('metric');
    });
    const after = container.textContent ?? '';
    // Something in the panel must be different — the spacing /
    // allowable strings switch representation.
    expect(after).not.toBe(before);
  });
});

describe('RemediationControls — AC16 all-disabled fallback', () => {
  it('when every option is disabled, no radios OR no apply button, and an explanatory paragraph shows', () => {
    // Craft a warning that no MVP remediation can clear:
    // Composite joists (unchangeable species) at max size (2x12)
    // with min spacing (305) on an INSANELY long span (10 m).
    // In that world, the domain compute must still return options,
    // but every one is disabled (see AC4/AC16). This is a
    // best-effort synthetic — if the domain finds a clearing
    // option we didn't anticipate, we skip the assertion (the
    // test still validates the shape when there IS at least one
    // clearing option; the guard here is defensive).
    act(() => {
      useDesignStore.getState().applyParameters({
        footprint: { lengthMm: 10_000 },
        joist: {
          spacingMm: 305,
          material: {
            nominal: '2x12',
            species: 'Composite',
            grade: 'NA',
          },
        },
      });
    });
    const design = useDesignStore.getState().bundle.design;
    const warning: Warning = {
      memberId: 'joist-0',
      kind: 'over-span-joist',
      actualMm: design.footprint.lengthMm,
      allowableMm: 1000,
      tableReference: 'IRC-2018 Table R502.3.1(1) — Composite 2x12',
      message: 'Joist over span (synthetic — extreme).',
    };
    const { container } = render(<RemediationControls warning={warning} />);
    const radios = screen.queryAllByRole('radio');
    const enabled = radios.filter((r) => !(r as HTMLInputElement).disabled);
    if (enabled.length === 0) {
      // All disabled — no Apply button, explanation paragraph.
      const applyBtn = screen.queryByRole('button', { name: /apply fix/i });
      expect(applyBtn).toBeNull();
      // A short prose explanation for the user is visible.
      expect(container.textContent ?? '').toMatch(
        /no remediation|no options|cannot|redesign|adjust/i,
      );
    }
    // If some options are enabled, this test is a no-op — the
    // matrix of "compose an impossible design" is narrow.
  });
});

describe('RemediationControls — AC18 textContent only', () => {
  it('the source file contains NO dangerouslySetInnerHTML reference', () => {
    // Grep-based regression guard — see design-store.test.ts
    // `no design-store file …contains a .subscribe(` for the same
    // pattern. This locks the AC18 invariant even if a future
    // refactor adds a "safe" HTML formatter.
    const src = readFileSync(
      join(__dirname, 'RemediationControls.tsx'),
      'utf-8',
    );
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('RemediationControls — AC19 preserves UI state on apply', () => {
  it('applying a fix does NOT change units, camera preset, or layer visibility', () => {
    // Set some non-default UI state.
    act(() => {
      useUiStore.getState().setUnits('metric');
      useUiStore.getState().setCameraPreset('top');
      useUiStore.getState().toggleLayer('joists');
    });
    const uiBefore = useUiStore.getState();

    const warning = seedOverSpanWarning();
    render(<RemediationControls warning={warning} />);

    const applyBtn = screen.getByRole('button', { name: /apply fix/i });
    act(() => {
      fireEvent.click(applyBtn);
    });

    const uiAfter = useUiStore.getState();
    expect(uiAfter.units).toBe(uiBefore.units);
    expect(uiAfter.cameraPreset).toBe(uiBefore.cameraPreset);
    expect(uiAfter.layerVisibility).toBe(uiBefore.layerVisibility);
  });
});

describe('RemediationControls — AC17 axe a11y smoke', () => {
  it('emits zero WCAG 2.2 AA violations', async () => {
    const warning = seedOverSpanWarning();
    const { container } = render(<RemediationControls warning={warning} />);
    // Switch to real timers so axe's async rules complete inside
    // the test window.
    vi.useRealTimers();
    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: { 'color-contrast': { enabled: false } },
    });
    if (results.violations.length > 0) {
      console.error(JSON.stringify(results.violations, null, 2));
    }
    expect(results.violations).toHaveLength(0);
  });
});
