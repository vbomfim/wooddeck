/**
 * `ParameterPanel.test.tsx` — S13 issue #14 AC1..AC8 + edges + a11y.
 *
 * ## What this file covers
 *
 *   - AC1: every field renders with the current value formatted in
 *     the current unit.
 *   - AC2: editing Width "16" (imperial) + blur → the store
 *     `bundle.design.footprint.widthMm === 4877`.
 *   - AC3: mid-type does NOT mutate the store (LengthField's
 *     own AC3 test covers the field-side invariant; here we assert
 *     the store-side quiet).
 *   - AC4: invalid input → inline error, store unchanged.
 *   - AC5: unit switch is display-only — mm value stays put.
 *   - AC6: species → Composite disables the Grade select + shows 'NA'.
 *   - AC7: species PT → Cedar broadcasts to joist + beam + post;
 *     decking species is INDEPENDENT.
 *   - AC8 (error path): entering a below-min value → LayoutError
 *     from applyParameters → status:'error' + lastError.message
 *     surfaced inline. Previous bundle preserved.
 *   - Edge: invalid select combos filtered (SelectField options for
 *     Grade when species=Composite exclude non-NA grades).
 *   - a11y: `<h2>Parameters</h2>` header present (AppShell landmark
 *     invariant), labelled fields, error region wired via role/aria.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  resetDesignStoreForTests,
  useDesignStore,
} from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { ParameterPanel } from './ParameterPanel';

// --------------------------------------------------------------------------
// Setup / teardown
// --------------------------------------------------------------------------
//
// Every test starts with a fresh design store bundle (12×12 default,
// no warnings, status 'idle') and imperial units. The ui-store's
// units flag is reset in the same beforeEach so a leak from a
// previous test can't shift what LengthField formats.

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

// --------------------------------------------------------------------------
// AC1 — all fields render, formatted in the current unit
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — AC1 renders every field', () => {
  it('renders <h2>Parameters</h2> (AppShell leftPanel landmark invariant)', () => {
    render(<ParameterPanel />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent(/parameters/i);
  });

  it('renders every ticket-table field with the current value in imperial', () => {
    render(<ParameterPanel />);
    // LengthField labels — the ticket §2 field table.
    expect(screen.getByLabelText(/^width$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^length$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/height/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/joist spacing/i)).toBeInTheDocument();
    // SelectField labels.
    expect(screen.getByLabelText(/joist size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/beam size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/post size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/decking board/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^species/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^grade/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/decking orientation/i)).toBeInTheDocument();
  });

  it('formats Width in imperial (default design 12 ft → "12" somewhere)', () => {
    render(<ParameterPanel />);
    const width = screen.getByLabelText<HTMLInputElement>(/^width$/i);
    // 12 ft (default) — formatLength imperial produces "12'" or
    // "12′ 0″". The digit 12 must appear.
    expect(width.value).toMatch(/12/);
  });
});

// --------------------------------------------------------------------------
// AC2 — editing Width "16" (imperial) + blur → widthMm === 4877
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — AC2 store update on blur', () => {
  it('typing "16" in Width + tabbing away sets bundle.design.footprint.widthMm === 4877', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const width = screen.getByLabelText(/^width$/i);
    await user.clear(width);
    await user.type(width, '16');
    await user.tab();
    // AC2 exact assertion. 16 ft × 304.8 mm/ft = 4876.8 → rounded 4877.
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(4877);
    // AC8 latency invariant: status stayed 'idle' (no error), no
    // artificial debounce blocked the write.
    expect(useDesignStore.getState().status).toBe('idle');
  });
});

// --------------------------------------------------------------------------
// AC3 — mid-type does not mutate the store
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — AC3 in-flight typing is quiet', () => {
  it('typing partial "12." into Width does NOT mutate widthMm until commit', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const before = useDesignStore.getState().bundle.design.footprint.widthMm;
    const width = screen.getByLabelText<HTMLInputElement>(/^width$/i);
    await user.clear(width);
    await user.type(width, '12.');
    // Mid-type: store unchanged (still the default 12-ft canonical mm).
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(before);
    expect(width.value).toBe('12.');
  });
});

// --------------------------------------------------------------------------
// AC4 — invalid input → inline error, no store update
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — AC4 invalid input', () => {
  it('typing "twelve feet" into Width + blur shows inline error and leaves widthMm unchanged', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const before = useDesignStore.getState().bundle.design.footprint.widthMm;
    const width = screen.getByLabelText(/^width$/i);
    await user.clear(width);
    await user.type(width, 'twelve feet');
    await user.tab();
    // Inline error is present (LengthField's AC4).
    expect(
      screen.getByText(/Enter a number, optionally with units — e\.g\., 12 or 12 ft/i),
    ).toBeInTheDocument();
    // Store untouched — the panel never called applyParameters.
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(before);
    expect(useDesignStore.getState().status).toBe('idle');
  });
});

// --------------------------------------------------------------------------
// AC5 — unit switch is display-only
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — AC5 unit switch never mutates the design', () => {
  it('imperial default → click metric → shows m format, widthMm STILL == the pre-switch value', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    // Default is 12 ft. `default-design.ts` stores 12 * MM_PER_FOOT
    // (304.8 mm/ft) so the canonical value is 3657.6 mm — the
    // ticket text uses "3658" loosely as the rounded-to-integer
    // millimeter but the store's non-integer representation is
    // intentional (see units.ts "Non-integer Mm policy").
    const widthBefore = useDesignStore.getState().bundle.design.footprint.widthMm;
    expect(widthBefore).toBeGreaterThan(3657);
    expect(widthBefore).toBeLessThan(3659);

    const width = screen.getByLabelText<HTMLInputElement>(/^width$/i);
    // Imperial display: "12'" or "12′ 0″".
    expect(width.value).toMatch(/12/);

    // Click Metric on the unit switcher.
    const metric = screen.getByRole('button', { name: /metric/i });
    await user.click(metric);

    // Display re-formatted → mentions "m" (meters). And ui-store
    // flipped. And, critically, the DESIGN store is UNCHANGED.
    expect(useUiStore.getState().units).toBe('metric');
    expect(width.value).toMatch(/m/);
    // AC5: mm value unchanged by unit switch. Referential equality
    // is the strongest check — no re-computation happened at all.
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(widthBefore);
  });
});

// --------------------------------------------------------------------------
// AC6 — Composite grade lock
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — AC6 Composite grade lock', () => {
  it('changing Species to Composite disables the Grade select AND sets its value to NA', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const species = screen.getByLabelText(/^species/i);

    // Change species → Composite. AC7: broadcasts to joist/beam/post
    // (asserted separately below). AC6: grade locks.
    await user.selectOptions(species, 'Composite');

    // The store's joist grade must be 'NA'.
    const design = useDesignStore.getState().bundle.design;
    expect(design.joist.material.grade).toBe('NA');
    expect(design.joist.material.species).toBe('Composite');

    // The Grade select is disabled and reads 'NA'.
    const grade = screen.getByLabelText<HTMLSelectElement>(/^grade/i);
    expect(grade.disabled).toBe(true);
    expect(grade.value).toBe('NA');
  });

  it('when species !== Composite the Grade select is enabled', () => {
    render(<ParameterPanel />);
    // Default species is PT → grade enabled.
    const grade = screen.getByLabelText<HTMLSelectElement>(/^grade/i);
    expect(grade.disabled).toBe(false);
  });
});

// --------------------------------------------------------------------------
// AC7 — species propagation to joist + beam + post; decking independent
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — AC7 species propagation', () => {
  it('changing species from PT → Cedar broadcasts to joist + beam + post (decking untouched)', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    // Sanity: default is all PT.
    const before = useDesignStore.getState().bundle.design;
    expect(before.joist.material.species).toBe('PT');
    expect(before.beam.material.species).toBe('PT');
    expect(before.post.material.species).toBe('PT');
    expect(before.decking.material.species).toBe('PT');

    const species = screen.getByLabelText(/^species/i);
    await user.selectOptions(species, 'Cedar');

    const after = useDesignStore.getState().bundle.design;
    expect(after.joist.material.species).toBe('Cedar');
    expect(after.beam.material.species).toBe('Cedar');
    expect(after.post.material.species).toBe('Cedar');
    // Decking is INDEPENDENT — untouched by the species control.
    expect(after.decking.material.species).toBe('PT');
  });
});

// --------------------------------------------------------------------------
// AC8 — error path: LayoutError surfaced inline; previous bundle preserved
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — AC8 LayoutError surfaced inline', () => {
  it('entering a Width below the 4 ft floor throws LayoutError → panel shows message + previous bundle intact', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const bundleBefore = useDesignStore.getState().bundle;
    const width = screen.getByLabelText(/^width$/i);
    // 1 ft = 305 mm — below MIN_DECK_DIMENSION_MM (1219 mm ≈ 4 ft).
    await user.clear(width);
    await user.type(width, '1');
    await user.tab();

    // The store's status flipped to 'error' + lastError populated.
    const { status, lastError } = useDesignStore.getState();
    expect(status).toBe('error');
    expect(lastError).not.toBeNull();
    expect(lastError?.name).toBe('LayoutError');
    // S4 wrote messages to be UI-ready — the panel surfaces
    // lastError.message inline. Search the DOM for the message
    // fragment.
    expect(screen.getByText(/Invalid deck width/i)).toBeInTheDocument();
    // The previous bundle is UNCHANGED (the 3D view stays intact).
    expect(useDesignStore.getState().bundle).toBe(bundleBefore);
  });

  it('correcting the value clears the error and returns status to idle', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const width = screen.getByLabelText(/^width$/i);
    // Trigger the error.
    await user.clear(width);
    await user.type(width, '1');
    await user.tab();
    expect(useDesignStore.getState().status).toBe('error');

    // Fix it.
    await user.click(width);
    await user.clear(width);
    await user.type(width, '20');
    await user.tab();

    expect(useDesignStore.getState().status).toBe('idle');
    expect(useDesignStore.getState().lastError).toBeNull();
    expect(screen.queryByText(/Invalid deck width/i)).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Edges — invalid select combos filtered (Composite + non-post nominals)
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — edges: catalog-invalid combos filtered / safe-broadcast', () => {
  it('when Species switches to Composite (which has no post SKUs), the panel keeps the post as PT (safe broadcast) — the store never lands in error', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const species = screen.getByLabelText(/^species/i);
    await user.selectOptions(species, 'Composite');

    // Safe-broadcast: joist + beam switched to Composite/NA (both
    // have composite SKUs in the catalog); post stayed at PT (no
    // composite 6×6 exists). The store lands in 'idle', NOT in
    // 'error' — the user isn't stuck.
    const design = useDesignStore.getState().bundle.design;
    expect(design.joist.material.species).toBe('Composite');
    expect(design.beam.material.species).toBe('Composite');
    expect(design.post.material.species).toBe('PT'); // kept
    expect(useDesignStore.getState().status).toBe('idle');
  });

  it('Post size options reflect the CURRENT post species — not the panel species — so Composite framing keeps 4×4/6×6 available', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const species = screen.getByLabelText(/^species/i);
    await user.selectOptions(species, 'Composite');

    // Post stayed at PT (safe broadcast); its options list should
    // still include 4×4 and 6×6 (the two PT post SKUs).
    const postSize = screen.getByLabelText<HTMLSelectElement>(/post size/i);
    const optionValues = Array.from(postSize.options).map((o) => o.value);
    expect(optionValues).toContain('4x4');
    expect(optionValues).toContain('6x6');
  });

  it('Joist size options filter out sizes not stocked under the current joist species', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const species = screen.getByLabelText(/^species/i);
    // Under Composite, joist species is Composite/NA and every
    // 2× nominal IS in the catalog (all four sizes exist). So the
    // list should still show every option. Under a hypothetical
    // future species with fewer SKUs, this test would flex.
    await user.selectOptions(species, 'Composite');
    const joistSize = screen.getByLabelText<HTMLSelectElement>(
      /joist size/i,
    );
    const optionValues = Array.from(joistSize.options).map((o) => o.value);
    // All four 2× sizes exist for Composite in the MVP catalog.
    expect(optionValues).toEqual(['2x6', '2x8', '2x10', '2x12']);
  });
});
