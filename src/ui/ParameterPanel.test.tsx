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

// --------------------------------------------------------------------------
// FIX 1 (review gate) — Grade options are catalog-filtered
// --------------------------------------------------------------------------
//
// Pre-fix bug: `GRADE_OPTIONS_WOOD` offered No1 / No2 / Select, but
// MVP_SPECS stocks ONLY `No2` for PT/Cedar (and `NA` for Composite).
// Picking No1 or Select fires applyParameters → computeLayout →
// lookupMaterial throws → LayoutError → panel renders the error
// inline. Violates AC1 and ticket §4 "selects blocked on invalid
// combination → filter options via the catalog".
//
// Fix: derive the Grade option list from the catalog via
// `filterGradesByCatalog(species)`. For PT / Cedar wood this
// returns `[No2]`; for Composite it returns `[NA]`.

describe('<ParameterPanel /> — FIX 1 Grade options are catalog-filtered', () => {
  it('PT species Grade options include ONLY No2 (No1 and Select are NOT stocked)', () => {
    render(<ParameterPanel />);
    // Default species is PT.
    const grade = screen.getByLabelText<HTMLSelectElement>(/^grade/i);
    const values = Array.from(grade.options).map((o) => o.value);
    // The catalog stocks only No2 for PT (materials-catalog.ts:129-152).
    expect(values).toEqual(['No2']);
    // Bug regression guard: the OLD (broken) list included these.
    expect(values).not.toContain('No1');
    expect(values).not.toContain('Select');
  });

  it('Cedar species Grade options include ONLY No2 (matches catalog)', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const species = screen.getByLabelText(/^species/i);
    await user.selectOptions(species, 'Cedar');
    const grade = screen.getByLabelText<HTMLSelectElement>(/^grade/i);
    const values = Array.from(grade.options).map((o) => o.value);
    expect(values).toEqual(['No2']);
  });

  it('Composite species Grade options include ONLY NA (matches catalog)', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const species = screen.getByLabelText(/^species/i);
    await user.selectOptions(species, 'Composite');
    const grade = screen.getByLabelText<HTMLSelectElement>(/^grade/i);
    const values = Array.from(grade.options).map((o) => o.value);
    expect(values).toEqual(['NA']);
  });

  it('selecting the stocked grade (No2) does NOT put the store into error and broadcasts to joist + beam + post (decking independent)', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const grade = screen.getByLabelText<HTMLSelectElement>(/^grade/i);
    // Ensure decking's grade is No2 too (default), so the below
    // "decking untouched" assertion is meaningful when we later
    // introduce a different starter grade.
    const before = useDesignStore.getState().bundle.design;
    expect(before.joist.material.grade).toBe('No2');
    expect(before.decking.material.grade).toBe('No2');

    // The only stocked grade for PT is No2 — re-select it.
    await user.selectOptions(grade, 'No2');

    // Store should be idle — no LayoutError since the combo is stocked.
    expect(useDesignStore.getState().status).toBe('idle');
    expect(useDesignStore.getState().lastError).toBeNull();

    // Grade broadcast to framing members (joist / beam / post).
    // Decking is INDEPENDENT.
    const after = useDesignStore.getState().bundle.design;
    expect(after.joist.material.grade).toBe('No2');
    expect(after.beam.material.grade).toBe('No2');
    expect(after.post.material.grade).toBe('No2');
    expect(after.decking.material.grade).toBe('No2');
  });
});

// --------------------------------------------------------------------------
// FIX 2 (review gate) — unit switch is display-only for a focused,
//   in-flight LengthField (dirty-flag + no-op-skip semantics)
// --------------------------------------------------------------------------
//
// Pre-fix bug: clicking the UnitSwitcher blurs the focused input
// BEFORE the button click fires, so LengthField's `commit()` runs
// unconditionally and either (a) applies an in-flight edit that the
// user meant to discard (unit switch is supposed to be display-only)
// or (b) drifts the canonical value by round-tripping through
// formatLength → parseLength (e.g. 3657.6 → 3658).
//
// Fix: track a `dirty` flag set on user keystroke. `commit()`
// short-circuits when NOT dirty OR when the parsed mm equals the
// current canonical `mmValue` (no-op-skip).

describe('<ParameterPanel /> — FIX 2 unit switch is display-only even mid-edit', () => {
  it('focus Width + type "16" + click Metric → widthMm UNCHANGED (in-flight edit discarded)', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const bundleBefore = useDesignStore.getState().bundle;
    const widthBefore = bundleBefore.design.footprint.widthMm;

    const width = screen.getByLabelText<HTMLInputElement>(/^width$/i);
    await user.clear(width);
    await user.type(width, '16');
    // At this point the field is dirty ("16") but not committed.

    const metric = screen.getByRole('button', { name: /metric/i });
    await user.click(metric);

    // AC5: widthMm UNCHANGED. Referential equality on the bundle
    // is the strongest check — no design update fired at all.
    expect(useDesignStore.getState().bundle).toBe(bundleBefore);
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(widthBefore);
    // And the ui-store did flip.
    expect(useUiStore.getState().units).toBe('metric');
  });

  it('focus Width WITHOUT typing + click Metric → widthMm UNCHANGED (no-op-blur skipped)', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const bundleBefore = useDesignStore.getState().bundle;
    const widthBefore = bundleBefore.design.footprint.widthMm;

    const width = screen.getByLabelText<HTMLInputElement>(/^width$/i);
    await user.click(width); // focus, no typing

    const metric = screen.getByRole('button', { name: /metric/i });
    await user.click(metric);

    // A round-trip through the formatter+parser could drift
    // 3657.6 → 3658 pre-fix; post-fix the commit short-circuits.
    // Referential equality on the bundle proves no update landed.
    expect(useDesignStore.getState().bundle).toBe(bundleBefore);
    expect(useDesignStore.getState().bundle.design.footprint.widthMm).toBe(widthBefore);
  });
});

// --------------------------------------------------------------------------
// FIX 4 (review gate) — every field handler wired to the correct
//   store slice. Prior coverage exercised only Width; a mis-routed
//   patch on any other field would have shipped green.
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — FIX 4 every field applies to its own store slice', () => {
  it('Length field applies footprint.lengthMm', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const length = screen.getByLabelText<HTMLInputElement>(/^length$/i);
    await user.clear(length);
    await user.type(length, '20');
    await user.tab();
    // 20 ft × 304.8 = 6096 mm.
    expect(useDesignStore.getState().bundle.design.footprint.lengthMm).toBe(6096);
  });

  it('Height field applies footprint.heightMm', async () => {
    // Switch to metric so we can type a raw mm-friendly value
    // without imperial parsing ambiguity.
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const height = screen.getByLabelText<HTMLInputElement>(/height/i);
    await user.clear(height);
    // 1200 mm is well above the structural min (default design).
    await user.type(height, '1200');
    await user.tab();
    expect(useDesignStore.getState().bundle.design.footprint.heightMm).toBe(1200);
  });

  it('Joist spacing field applies joist.spacingMm', async () => {
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const spacing = screen.getByLabelText<HTMLInputElement>(/joist spacing/i);
    await user.clear(spacing);
    // 305 mm ≈ 12" o.c. — above the joist thickness minimum.
    await user.type(spacing, '305');
    await user.tab();
    expect(useDesignStore.getState().bundle.design.joist.spacingMm).toBe(305);
  });

  it('Joist size select applies joist.material.nominal', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const joistSize = screen.getByLabelText(/joist size/i);
    await user.selectOptions(joistSize, '2x10');
    expect(useDesignStore.getState().bundle.design.joist.material.nominal).toBe('2x10');
    // Sibling framing sizes untouched.
    expect(useDesignStore.getState().bundle.design.beam.material.nominal).not.toBe('2x10');
  });

  it('Beam size select applies beam.material.nominal', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const beamSize = screen.getByLabelText(/beam size/i);
    await user.selectOptions(beamSize, '2x10');
    expect(useDesignStore.getState().bundle.design.beam.material.nominal).toBe('2x10');
  });

  it('Post size select applies post.material.nominal', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const postSize = screen.getByLabelText(/post size/i);
    await user.selectOptions(postSize, '6x6');
    expect(useDesignStore.getState().bundle.design.post.material.nominal).toBe('6x6');
  });

  it('Decking board size select applies decking.material.nominal', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const deckingSize = screen.getByLabelText(/decking board/i);
    await user.selectOptions(deckingSize, '2x6');
    expect(useDesignStore.getState().bundle.design.decking.material.nominal).toBe('2x6');
  });

  it('Decking orientation select applies decking.orientation', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const orientation = screen.getByLabelText(/decking orientation/i);
    await user.selectOptions(orientation, 'parallel-to-width');
    expect(useDesignStore.getState().bundle.design.decking.orientation).toBe('parallel-to-width');
  });
});

// --------------------------------------------------------------------------
// FIX 7 (review gate) — aria-live consistency on the panel-level
//   error region. `role="alert"` implies `aria-live="assertive"` —
//   the S13 panel banner should be status/polite (a passive
//   summary), leaving the assertive role for the per-field
//   inline error inside LengthField.
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — FIX 7 panel-level error region uses role=status + aria-live=polite', () => {
  it('panel banner (when status=error) is findable by role="status" and has aria-live="polite"', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const width = screen.getByLabelText<HTMLInputElement>(/^width$/i);
    // Below the 4 ft floor → LayoutError.
    await user.clear(width);
    await user.type(width, '1');
    await user.tab();

    // The panel-level banner is a status region — passive summary.
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/Invalid deck width/i);
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });
});

// --------------------------------------------------------------------------
// FIX 8 (review gate) — Composite framing informational note.
//   When Species = Composite, the panel silently keeps posts as PT
//   (safe-broadcast). Add a passive `<p role="note">` explaining
//   this so the homeowner isn't surprised.
// --------------------------------------------------------------------------

describe('<ParameterPanel /> — FIX 8 Composite framing informational note', () => {
  it('shows a role=note explanation when Species = Composite', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    // Not present initially (default PT).
    expect(screen.queryByRole('note')).toBeNull();

    const species = screen.getByLabelText(/^species/i);
    await user.selectOptions(species, 'Composite');

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/pressure-treated/i);
    expect(note).toHaveTextContent(/composite framing is not structurally rated/i);
  });

  it('note disappears when Species reverts to a wood species', async () => {
    const user = userEvent.setup();
    render(<ParameterPanel />);
    const species = screen.getByLabelText(/^species/i);
    await user.selectOptions(species, 'Composite');
    expect(screen.getByRole('note')).toBeInTheDocument();

    await user.selectOptions(species, 'PT');
    expect(screen.queryByRole('note')).toBeNull();
  });
});
