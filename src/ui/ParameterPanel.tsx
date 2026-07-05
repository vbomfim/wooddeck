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
 * species via `filterGradesByCatalog` — Composite shows only `'NA'`;
 * PT/Cedar show only the wood grades stocked in the MVP catalog
 * (`'No2'` for the MVP). The pre-fix code hard-coded a
 * `[No1, No2, Select]` wood-grade list which triggered LayoutError
 * on submit for `No1`/`Select` — see `filterGradesByCatalog`
 * docstring for why.
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
  type DeepPartial,
} from '../state';

import { BlockProductSelector } from './fields/BlockProductSelector';
import { BlockSpacingField } from './fields/BlockSpacingField';
import { BeamConnectionSelector } from './fields/BeamConnectionSelector';
import { FloatingFramingSelector } from './fields/FloatingFramingSelector';
import { FoundationTypeSelector } from './fields/FoundationTypeSelector';
import { LengthField } from './fields/LengthField';
import { SelectField, type SelectOption } from './fields/SelectField';
import { StructureSelector } from './fields/StructureSelector';
import { UnitSwitcher } from './UnitSwitcher';
import './styles/parameter-panel.css';

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
 * All Grade values the domain model exposes. The DISPLAYED options
 * list is CATALOG-FILTERED per species via `filterGradesByCatalog`
 * — for the MVP catalog wood species stock only `'No2'` and
 * Composite stocks only `'NA'`, so this full list is a
 * defense-in-depth reference rather than a directly-used option
 * source. Keeping it as an ordered constant lets tests assert on
 * the intended stable ordering when the catalog widens.
 */
const ALL_GRADES: readonly Grade[] = ['No1', 'No2', 'Select', 'NA'];

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

/**
 * FIX 8 (S13 review gate) copy — the Composite framing informational
 * note. Extracted as a module constant so tests can assert on it
 * without duplicating the string.
 *
 * Homeowner-facing explanation of the safe-broadcast behaviour:
 * when Species = Composite, posts stay pressure-treated because the
 * MVP catalog has no composite post SKUs (see materials-catalog.ts
 * MVP_SPECS). This is standard practice for composite decks (see
 * ticket §17) but silent behaviour is surprising to a homeowner
 * seeing the Species selector — the note makes it discoverable
 * without an error state.
 */
const COMPOSITE_FRAMING_NOTE =
  'Posts remain pressure-treated; composite framing is not structurally rated.';

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
 * FIX 1 (S13 review gate) — build a Grade options list from the
 * catalog for the given species. Returns ONLY grades that ARE
 * stocked (any nominal for that species counts). For the MVP
 * catalog this returns `[{ value: 'No2', label: 'No2' }]` for
 * PT/Cedar and `[{ value: 'NA', label: 'NA (composite)' }]` for
 * Composite.
 *
 * ## Why this exists
 *
 * Pre-fix the panel offered a hard-coded `[No1, No2, Select]` for
 * wood — but the catalog stocks ONLY `No2`. Picking `No1` or
 * `Select` fired `applyParameters → computeLayout → lookupMaterial`
 * which threw a `LayoutError`, and the panel surfaced the error
 * inline. That violates AC1 ("valid combinations only in options")
 * and forced the user to correct a mistake the UI should not have
 * let them make. This helper is the AC-edge "invalid select combos
 * filtered" guarantee applied to Grade.
 */
function filterGradesByCatalog(
  species: Species,
): readonly SelectOption<Grade>[] {
  const validSet = new Set<Grade>();
  for (const material of listMaterials()) {
    if (material.species === species) {
      validSet.add(material.grade);
    }
  }
  // Preserve `ALL_GRADES` ordering so the list has a stable,
  // documented sequence — the catalog's insertion order is not a
  // load-bearing detail.
  return ALL_GRADES.filter((g) => validSet.has(g)).map<SelectOption<Grade>>(
    (g) => ({
      value: g,
      // Human-readable label. Composite `'NA'` gets the parenthetical
      // reminder so the disabled-select state (AC6) still reads
      // sensibly.
      label: g === 'NA' ? 'NA (composite)' : g,
    }),
  );
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

  // S23 issue #45 — `foundation.post` (inside the posts-on-footings
  // variant) is the SINGLE source of truth for post material — the
  // pre-S17 top-level `design.post` field was removed to eliminate
  // a dual-SoT drift bug (see model.ts FoundationSpec doc). S17
  // originally threw defensively when `foundation.type !==
  // 'posts-on-footings'`; S23 replaces that throw with conditional
  // rendering of the post-related controls so the block-carrying
  // variants (deck-blocks / tuffblocks) can be selected in the UI.
  //
  // `hasPostFoundation` narrows the `foundation` union so downstream
  // reads on `design.foundation.post` compile without any casts.
  const hasPostFoundation =
    design.foundation.type === 'posts-on-footings';
  // Non-null only when hasPostFoundation is true — TypeScript
  // narrows the discriminated union through the ternary.
  const postMaterialRef =
    design.foundation.type === 'posts-on-footings'
      ? design.foundation.post
      : null;

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
  const joistSpecies = design.joist.material.species;
  const beamSpecies = design.beam.material.species;
  // FIX (S23): When the foundation carries no post (deck-blocks /
  // tuffblocks), fall back to the joist species for the (unused)
  // Post-size options list. The Post-size SelectField itself is
  // gated on `hasPostFoundation` so the options never render — but
  // the useMemo still needs a defined species argument.
  const postSpecies = postMaterialRef?.species ?? joistSpecies;
  const deckingSpecies = design.decking.material.species;

  const joistSizeOptions = useMemo(
    () => filterNominalsByCatalog(JOIST_SIZE_OPTIONS, joistSpecies),
    [joistSpecies],
  );
  const beamSizeOptions = useMemo(
    () => filterNominalsByCatalog(BEAM_SIZE_OPTIONS, beamSpecies),
    [beamSpecies],
  );
  const postSizeOptions = useMemo(
    () => filterNominalsByCatalog(POST_SIZE_OPTIONS, postSpecies),
    [postSpecies],
  );
  const deckingSizeOptions = useMemo(
    () => filterNominalsByCatalog(DECKING_SIZE_OPTIONS, deckingSpecies),
    [deckingSpecies],
  );

  // The JOIST species is the primary framing species — AC6's Grade
  // lock and AC7's broadcast both key on it (Composite joist →
  // Grade select disabled + 'NA'; species control writes to joist +
  // beam + post). The variable is `joistSpecies` above; no separate
  // alias needed here.
  const gradeOptions = useMemo(
    () => filterGradesByCatalog(joistSpecies),
    [joistSpecies],
  );
  const gradeDisabled = joistSpecies === 'Composite';

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
    interface MutableFoundationPostPatch {
      post?: { species?: Species; grade?: Grade };
    }
    interface MutableFramingPatch {
      joist?: MutableMemberPatch;
      beam?: MutableMemberPatch;
      foundation?: MutableFoundationPostPatch;
    }
    const draft: MutableFramingPatch = {};
    if (canStock(design.joist.material.nominal)) {
      draft.joist = { material: { species: nextSpecies, grade: nextGrade } };
    }
    if (canStock(design.beam.material.nominal)) {
      draft.beam = { material: { species: nextSpecies, grade: nextGrade } };
    }
    if (postMaterialRef !== null && canStock(postMaterialRef.nominal)) {
      // FIX 2 — post material lives at `foundation.post` (SoT).
      // deep-merge preserves the discriminant `type` and the
      // `nominal` / `footing` siblings. S23: skipped entirely when
      // the foundation is a block variant (no `post` field).
      draft.foundation = { post: { species: nextSpecies, grade: nextGrade } };
    }
    apply(draft);
  }

  function onGradeChange(nextGrade: Grade): void {
    // Broadcast alongside the species change model — one grade
    // control for framing members. Decking grade is independent
    // (mirrors species behaviour). FIX 2 — post grade patch goes to
    // `foundation.post`, not the removed top-level `post`.
    // S23: only include the foundation post patch when the current
    // foundation actually HAS a post (posts-on-footings). For
    // block variants (deck-blocks / tuffblocks) the patch would
    // fail — the `foundation.post` key is not in that variant.
    interface FoundationPostPatch {
      post?: { grade?: Grade };
    }
    interface GradePatch {
      joist: { material: { grade: Grade } };
      beam: { material: { grade: Grade } };
      foundation?: FoundationPostPatch;
    }
    const patch: GradePatch = {
      joist: { material: { grade: nextGrade } },
      beam: { material: { grade: nextGrade } },
    };
    if (postMaterialRef !== null) {
      patch.foundation = { post: { grade: nextGrade } };
    }
    apply(patch);
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

      {/*
        S23 issue #45 — the three foundation-shape selectors. Placed
        at the TOP of the panel because a change to Structure or
        Foundation type CASCADES through the design (foundation
        atomically re-stamps, post fields appear/disappear). Users
        pick the shape first, then dial in dimensions and materials.
      */}
      <div className="wd-parameter-panel__foundation">
        <StructureSelector />
        <FoundationTypeSelector />
        <BlockProductSelector />
        <FloatingFramingSelector />
        <BeamConnectionSelector />
      </div>

      {errorMessage !== null && (
        // FIX 7 (S13 review gate) — passive summary. `role="alert"`
        // implies `aria-live="assertive"`, which is loud enough to
        // interrupt a screen reader mid-word; a panel-level "the
        // last apply failed" banner is a status update, not an
        // interruption. `role="status"` (implicit `aria-live=polite`)
        // matches the intent. The assertive channel is reserved for
        // the per-field `LengthField` inline error (per-keystroke
        // parse errors, where interrupting IS the right UX).
        <div
          className="wd-parameter-panel__error"
          role="status"
          aria-live="polite"
        >
          {errorMessage}
        </div>
      )}

      {joistSpecies === 'Composite' && (
        // FIX 8 (S13 review gate) — passive informational note. When
        // Species = Composite, the safe-broadcast (see
        // `onSpeciesChange`) leaves posts pressure-treated because
        // the MVP catalog has no composite post SKUs. Silent
        // behaviour is surprising to a homeowner who just picked
        // "Composite" and might expect every framing member to
        // change. `role="note"` is the ARIA landmark for a passive
        // callout — NOT `alert`/`status`, because this is
        // informational context, not a state change.
        <p className="wd-parameter-panel__note" role="note">
          {COMPOSITE_FRAMING_NOTE}
        </p>
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
        {/*
          feat/block-spacing — Method B foundation-block grid pitch.
          Renders only when floating + joists-on-blocks (Method B). The
          field is a NO-OP visual on any other structure/framing combo
          (returns null). Placed near "Joist spacing" so the two
          related distances read together in the panel.
        */}
        <BlockSpacingField />

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
        {hasPostFoundation && postMaterialRef !== null && (
          <SelectField<LumberNominal>
            label="Post size"
            value={postMaterialRef.nominal}
            options={postSizeOptions}
            // FIX 2 — post nominal patch goes to `foundation.post` (SoT).
            // S23: only rendered when the foundation is the
            // posts-on-footings variant.
            onChange={(nominal): void =>
              apply({ foundation: { post: { nominal } } })
            }
          />
        )}
        <SelectField<LumberNominal>
          label="Decking board size"
          value={design.decking.material.nominal}
          options={deckingSizeOptions}
          onChange={(nominal): void => apply({ decking: { material: { nominal } } })}
        />

        <SelectField<Species>
          label="Species"
          value={joistSpecies}
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
