/**
 * `src/ui/ParameterPanel.tsx` — S13 issue #14.
 *
 * ## Responsibility (single)
 *
 * Render the leftPanel of the AppShell — every parameter of the
 * current `DeckDesign` as a labelled input, wired to
 * `useDesignStore.getState().applyParameters(patch)`.
 *
 * ## Interaction shape
 *
 *   - Reads `useDesign()` for the current design (hook — the panel
 *     re-renders on every design mutation, which is what we want:
 *     an external change like undo/redo or load-from-file must
 *     re-format every field).
 *   - Reads `useUiUnits()` for the current display system.
 *   - Reads `useDesignStatus()` for the `{status, lastError}` tuple
 *     so it can surface `lastError.message` inline near the fields
 *     when `applyParameters` threw (AC8 — LayoutError flow).
 *   - Writes via `useDesignStore.getState().applyParameters(patch)`
 *     — NEVER a direct `application/*` call (S13 issue #14 Boundary
 *     Resolution §2).
 *
 * ## Fields (see ticket §2 table)
 *
 *   - Width / Length / Height / Joist spacing → LengthField.
 *   - Joist / Beam / Post / Decking size → SelectField (nominal SKU).
 *   - Species / Grade → SelectField.
 *   - Decking orientation → SelectField.
 *
 * ## AC6 — Composite grade lock
 *
 * When species is `'Composite'`, Grade select disables and its value
 * is forced to `'NA'` (the sentinel used for composite materials in
 * the catalog). The available Grade options list is filtered by
 * species — `'Composite'` shows only `'NA'`; non-composite shows
 * `'No1' | 'No2' | 'Select'`.
 *
 * ## AC7 — Species broadcast
 *
 * Changing Species broadcasts to `joist.material.species`,
 * `beam.material.species`, and `post.material.species` in one patch
 * (matches ticket §17 "one species control" decision). Decking
 * species is INDEPENDENT (a composite deck on wood frame is common;
 * the ticket calls this out explicitly).
 *
 * ## Composite → post size caveat
 *
 * The MVP catalog has NO composite posts (2×6/2×8/2×10/2×12/5/4×6
 * exist in Composite, but 4×4 and 6×6 do NOT — composite posts are
 * a rare architectural product). Two possible responses:
 *
 *   A. Filter the Post-size options to catalog-valid combos and
 *      let the store update succeed.
 *   B. Let the store throw a LayoutError and surface it inline.
 *
 * The panel takes approach A for the FIELD options (so the user
 * cannot pick an invalid combo mid-edit) but approach B is the
 * safety net (the store WILL throw if the current combo is invalid
 * after a species change — this catches "species changed to
 * Composite while post is 4×4"). Both paths keep the previous
 * bundle intact.
 *
 * ## Boundary
 *
 *   - `../state`                       — DesignBundle + actions (useDesignStore direct for getState())
 *   - `../domain/units`                — formatLength / parseLength (via LengthField).
 *   - `../domain/materials-catalog`    — listMaterials for option filtering.
 *   - `../domain/model` (types only)   — Species, Grade, LumberNominal, etc.
 *   - NO `../domain/layout`            — LayoutError surfaced via useDesignStatus().
 *   - NO `../application`              — apply through the store.
 *   - NO `../persistence`, `../scene`  — hard rule.
 */
import { useMemo, type JSX } from 'react';

import { listMaterials } from '../domain/materials-catalog';
import type {
  DeckDesign,
  Grade,
  LumberNominal,
  Species,
} from '../domain/model';
import {
  useDesign,
  useDesignStatus,
  useDesignStore,
  useUiUnits,
} from '../state';

import { LengthField } from './fields/LengthField';
import { SelectField, type SelectOption } from './fields/SelectField';
import { UnitSwitcher } from './UnitSwitcher';
import './styles/parameter-panel.css';

// --------------------------------------------------------------------------
// Local DeepPartial — mirrors `application/types.ts`'s type of the
// same name. We define it here (rather than importing) because the
// dep-cruiser `ui-allowlist` rule forbids `ui/ → application/`
// (Boundary Resolution #2 for S13: the panel talks to the store,
// not directly to the application layer). The types are structurally
// identical, so a change to either is a compile-time break at the
// store call site if they ever drift — but the risk is small
// because `DeepPartial` is a general-purpose recursive utility.
// --------------------------------------------------------------------------
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

// --------------------------------------------------------------------------
// Static option lists — extracted so tests can inspect them and so
// hot-reload doesn't rebuild them on every render.
// --------------------------------------------------------------------------

const SPECIES_OPTIONS: readonly SelectOption<Species>[] = [
  { value: 'PT', label: 'Pressure-treated (PT)' },
  { value: 'Cedar', label: 'Cedar' },
  { value: 'Composite', label: 'Composite' },
];

/**
 * Non-composite grades. Composite always uses `'NA'`. See AC6 lock
 * behaviour: when species is `'Composite'`, the Grade select
 * disables + the options list is `[{ value: 'NA', label: 'NA' }]`.
 */
const GRADE_OPTIONS_WOOD: readonly SelectOption<Grade>[] = [
  { value: 'No1', label: 'No1' },
  { value: 'No2', label: 'No2' },
  { value: 'Select', label: 'Select' },
];

const GRADE_OPTIONS_COMPOSITE: readonly SelectOption<Grade>[] = [
  { value: 'NA', label: 'NA (composite)' },
];

const JOIST_SIZE_OPTIONS: readonly LumberNominal[] = ['2x6', '2x8', '2x10', '2x12'];
const BEAM_SIZE_OPTIONS: readonly LumberNominal[] = ['2x8', '2x10', '2x12'];
const POST_SIZE_OPTIONS: readonly LumberNominal[] = ['4x4', '6x6'];
const DECKING_SIZE_OPTIONS: readonly LumberNominal[] = ['5/4x6', '2x6'];

const ORIENTATION_OPTIONS: readonly SelectOption<
  DeckDesign['decking']['orientation']
>[] = [
  { value: 'parallel-to-length', label: 'Parallel to length' },
  { value: 'parallel-to-width', label: 'Parallel to width' },
];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Build a SelectField option list from a nominals array, keeping
 * only those the catalog stocks under the given species (any grade
 * for that species counts). This is the AC-edge "invalid select
 * combos filtered" guarantee — e.g., 4×4 and 6×6 disappear from the
 * Post size list when species = Composite.
 */
function filterNominalsByCatalog(
  nominals: readonly LumberNominal[],
  species: Species,
): readonly SelectOption<LumberNominal>[] {
  const validSet = new Set<LumberNominal>();
  for (const material of listMaterials()) {
    if (material.species === species) {
      validSet.add(material.nominal);
    }
  }
  return nominals
    .filter((n) => validSet.has(n))
    .map<SelectOption<LumberNominal>>((n) => ({ value: n, label: n }));
}

/**
 * Apply a design patch through the store. Wrapped as a helper so
 * every field handler reads the same way and so a future rewrite
 * (batching, undo-tag) has one call site.
 */
function apply(patch: DeepPartial<DeckDesign>): void {
  useDesignStore.getState().applyParameters(patch);
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export function ParameterPanel(): JSX.Element {
  const design = useDesign();
  const units = useUiUnits();
  const { status, lastError } = useDesignStatus();

  // Catalog-filtered option lists. Each SelectField's options list
  // reflects that member's OWN species, not a shared "panel species"
  // — so if the user picks Composite (which broadcasts to joist +
  // beam but NOT post — see onSpeciesChange), the post size options
  // stay 4×4/6×6 (valid for PT) while the joist/beam size options
  // filter down to composite-valid nominals.
  //
  // Recomputed per render — cheap (each pass iterates the ~19-entry
  // catalog once) but memoized on the specific member's species so
  // option-list identity stays stable when an unrelated field
  // mutates.
  const joistSpeciesForOpts = design.joist.material.species;
  const beamSpeciesForOpts = design.beam.material.species;
  const postSpeciesForOpts = design.post.material.species;
  const deckingSpeciesForOpts = design.decking.material.species;

  const joistSizeOptions = useMemo(
    () => filterNominalsByCatalog(JOIST_SIZE_OPTIONS, joistSpeciesForOpts),
    [joistSpeciesForOpts],
  );
  const beamSizeOptions = useMemo(
    () => filterNominalsByCatalog(BEAM_SIZE_OPTIONS, beamSpeciesForOpts),
    [beamSpeciesForOpts],
  );
  const postSizeOptions = useMemo(
    () => filterNominalsByCatalog(POST_SIZE_OPTIONS, postSpeciesForOpts),
    [postSpeciesForOpts],
  );
  const deckingSizeOptions = useMemo(
    () => filterNominalsByCatalog(DECKING_SIZE_OPTIONS, deckingSpeciesForOpts),
    [deckingSpeciesForOpts],
  );

  // "Panel species" is the JOIST species — the primary framing
  // species the broadcast originates from. AC6 Grade lock keys on
  // it (Composite framing joist → Grade select disabled + 'NA').
  const panelSpecies = joistSpeciesForOpts;

  const gradeOptions =
    panelSpecies === 'Composite' ? GRADE_OPTIONS_COMPOSITE : GRADE_OPTIONS_WOOD;
  const gradeDisabled = panelSpecies === 'Composite';

  // Species change → broadcast to joist + beam + post per AC7,
  // BUT only for members whose current nominal is stocked in the
  // catalog under the new species+grade combo.
  //
  // ## Why the safe-broadcast (Option B in the module header)
  //
  // If we broadcast blindly and the resulting combo isn't in the
  // catalog (e.g. 6×6 Composite — the MVP catalog has no composite
  // posts), `applyParameters` throws `LayoutError` and the whole
  // update rolls back. The user ends up "stuck" — clicking
  // Composite in the Species select does nothing and shows a
  // layout error, with no obvious next step.
  //
  // Real-world usage backs the safe-broadcast: a composite deck on
  // wood frame is common (the ticket §17 Open Questions calls this
  // out for decking; the same logic applies to posts — no one
  // builds composite posts). By keeping the post's species when
  // the target combo isn't stocked, the user gets:
  //   - joist + beam updated to Composite (as many members as the
  //     catalog supports)
  //   - post unchanged (still PT — a valid wood post supporting
  //     a composite deck frame)
  //   - Grade select locks to NA (because the JOIST species IS
  //     Composite — AC6 satisfied)
  //   - Post size options remain 4×4/6×6 (because postSpecies is
  //     still PT — the per-member `postSizeOptions` above reflect
  //     that).
  //
  // Autonomous decision — flagged in the handoff for user review.
  function onSpeciesChange(nextSpecies: Species): void {
    const nextGrade: Grade =
      nextSpecies === 'Composite'
        ? 'NA'
        : design.joist.material.grade === 'NA'
          ? 'No2'
          : design.joist.material.grade;

    function canStock(nominal: LumberNominal): boolean {
      // A member update is safe iff the target (nominal, species,
      // grade) triple is in the catalog. `some` on the ~19-entry
      // catalog is O(n) but n is tiny — no need for a Map here.
      return listMaterials().some(
        (m) =>
          m.nominal === nominal && m.species === nextSpecies && m.grade === nextGrade,
      );
    }

    // DeepPartial<DeckDesign> preserves `readonly` on every field
    // (the domain model marks everything readonly). Build the patch
    // as a mutable draft, then assert it back to the readonly
    // DeepPartial before handing it to `apply`.
    interface MutableMemberPatch {
      material?: { species?: Species; grade?: Grade };
    }
    interface MutableFramingPatch {
      joist?: MutableMemberPatch;
      beam?: MutableMemberPatch;
      post?: MutableMemberPatch;
    }
    const draft: MutableFramingPatch = {};
    if (canStock(design.joist.material.nominal)) {
      draft.joist = { material: { species: nextSpecies, grade: nextGrade } };
    }
    if (canStock(design.beam.material.nominal)) {
      draft.beam = { material: { species: nextSpecies, grade: nextGrade } };
    }
    if (canStock(design.post.material.nominal)) {
      draft.post = { material: { species: nextSpecies, grade: nextGrade } };
    }
    apply(draft);
  }

  function onGradeChange(nextGrade: Grade): void {
    // Broadcast alongside the species change model — one grade
    // control for framing members. Decking grade is independent
    // (mirrors species behaviour).
    apply({
      joist: { material: { grade: nextGrade } },
      beam: { material: { grade: nextGrade } },
      post: { material: { grade: nextGrade } },
    });
  }

  // Errors surfaced by the store's applyParameters catch. LayoutError
  // (or ApplyParametersError) → status='error' + lastError.message
  // ready-to-render. See issue #14 Boundary Resolution §3.
  const errorMessage: string | null =
    status === 'error' && lastError !== null ? lastError.message : null;

  return (
    <section aria-labelledby="wd-parameter-panel__title" className="wd-parameter-panel">
      <h2 id="wd-parameter-panel__title">Parameters</h2>

      <UnitSwitcher />

      {errorMessage !== null && (
        <div
          className="wd-parameter-panel__error"
          role="alert"
          aria-live="polite"
        >
          {errorMessage}
        </div>
      )}

      <div className="wd-parameter-panel__fields">
        <LengthField
          label="Width"
          mmValue={design.footprint.widthMm}
          system={units}
          onChangeMm={(widthMm): void => apply({ footprint: { widthMm } })}
        />
        <LengthField
          label="Length"
          mmValue={design.footprint.lengthMm}
          system={units}
          onChangeMm={(lengthMm): void => apply({ footprint: { lengthMm } })}
        />
        <LengthField
          label="Height (top of decking to ground)"
          mmValue={design.footprint.heightMm}
          system={units}
          hint="Ground clearance from top of decking."
          onChangeMm={(heightMm): void => apply({ footprint: { heightMm } })}
        />
        <LengthField
          label="Joist spacing"
          mmValue={design.joist.spacingMm}
          system={units}
          hint="16 in o.c. (406 mm) is the common IRC choice."
          onChangeMm={(spacingMm): void => apply({ joist: { spacingMm } })}
        />

        <SelectField<LumberNominal>
          label="Joist size"
          value={design.joist.material.nominal}
          options={joistSizeOptions}
          onChange={(nominal): void => apply({ joist: { material: { nominal } } })}
        />
        <SelectField<LumberNominal>
          label="Beam size"
          value={design.beam.material.nominal}
          options={beamSizeOptions}
          onChange={(nominal): void => apply({ beam: { material: { nominal } } })}
        />
        <SelectField<LumberNominal>
          label="Post size"
          value={design.post.material.nominal}
          options={postSizeOptions}
          onChange={(nominal): void => apply({ post: { material: { nominal } } })}
        />
        <SelectField<LumberNominal>
          label="Decking board size"
          value={design.decking.material.nominal}
          options={deckingSizeOptions}
          onChange={(nominal): void => apply({ decking: { material: { nominal } } })}
        />

        <SelectField<Species>
          label="Species"
          value={panelSpecies}
          options={SPECIES_OPTIONS}
          onChange={onSpeciesChange}
        />
        <SelectField<Grade>
          label="Grade"
          value={design.joist.material.grade}
          options={gradeOptions}
          disabled={gradeDisabled}
          onChange={onGradeChange}
        />
        <SelectField<DeckDesign['decking']['orientation']>
          label="Decking orientation"
          value={design.decking.orientation}
          options={ORIENTATION_OPTIONS}
          onChange={(orientation): void => apply({ decking: { orientation } })}
        />
      </div>
    </section>
  );
}
