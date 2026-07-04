/**
 * `src/ui/fields/FoundationTypeSelector.tsx` — S23 issue #45 AC2.
 *
 * ## Responsibility (single)
 *
 * Present a `<select>` with the three `FoundationSpec` variants
 * (`posts-on-footings`, `deck-blocks`, `tuffblocks`) and let the
 * user pick one. Options that are INCOMPATIBLE with the current
 * `design.structure` per FR-030 (see `domain/compat-matrix`) are
 * DISABLED with a visible + a11y reason string — never silently
 * omitted (ticket §2 real paths bullet 2: "Do NOT silently omit —
 * disable with reason").
 *
 * On enable-option selection, dispatch a `applyParameters` patch
 * with a NEW `foundation` subtree that ALREADY carries the fields
 * the target discriminator requires (product for the block
 * variants, post + footing for posts-on-footings). This side-steps
 * the "type-only patch" trap where the deep-merge would either
 * throw `ApplyParametersError('Unknown key...')` or leave a
 * mismatched partial variant. The S23 discriminator-switch REPLACE
 * semantics (see `apply-parameters.ts`) picks up the whole subtree
 * atomically.
 *
 * ## Why the `SelectField` primitive from S13 isn't used
 *
 * `SelectField` (S13) is a labelled `<select>` but does NOT thread
 * a per-option `disabled` OR `title`. Extending it would touch
 * every S13 caller (post-material select, etc.) whose semantics
 * don't need per-option disabling. This selector is a small custom
 * `<label>` + `<select>` pair that keeps the S23 concern local.
 *
 * ## Boundary
 *
 * `ui → state` + `ui → domain/{model, compat-matrix, foundation-
 * catalog}`. No touching `application/` or `domain/spans/layout`.
 */
import { useId, useMemo, type ChangeEvent, type JSX } from 'react';

import { validateFoundationCombination } from '../../domain/compat-matrix';
import { defaultFoundationFor } from '../../domain/foundation-defaults';
import type {
  DeckDesign,
  FoundationSpec,
  StructureMode,
} from '../../domain/model';
import { type DeepPartial, useDesign, useDesignStore } from '../../state';

import '../styles/tokens.css';
import '../styles/foundation-type-selector.css';

// ==========================================================
// Variant enumeration — displayed in this exact order in the <select>
// ==========================================================

const VARIANTS: readonly {
  readonly type: FoundationSpec['type'];
  readonly label: string;
}[] = [
  { type: 'posts-on-footings', label: 'Posts on footings' },
  { type: 'deck-blocks', label: 'Deck blocks' },
  { type: 'tuffblocks', label: 'TuffBlocks' },
] as const;

// ==========================================================
// Build a fresh compat-valid `FoundationSpec` for a chosen type.
//
// The domain-owned `defaultFoundationFor(next)` factory is the
// single source of truth for the per-variant defaults (6×6 PT
// No2 post, 300 × 300 mm footing, Oldcastle 11×11×7, TuffBlock
// 12×12×4). See `src/domain/foundation-defaults.ts` for the
// DRY/OCP rationale (S23 pair-fix — Opus #4).
//
// The `current` argument is currently unused — the pair-fix
// (Opus #5) removed the "carry the previous post" branch that
// was dead code and spec-inconsistent (elevated + deck-blocks
// post is DERIVED, not user-selected per S20 amendment).
// Kept as a thin wrapper because the callsite reads clearest
// with a name that conveys "for the target type, respecting the
// current foundation shape" — a future rewrite that needs the
// current parameter (e.g. to preserve `blockRowsHint` on a
// deck-blocks→tuffblocks flip) has a natural seam.
// ==========================================================

function buildFoundationForType(
  _current: FoundationSpec,
  next: FoundationSpec['type'],
): FoundationSpec {
  return defaultFoundationFor(next);
}

// ==========================================================
// Compat probe — given the current `structure` and a candidate
// variant type, return the compat reason if disabled, or `null`.
// ==========================================================

/**
 * We build a MINIMAL specimen of the candidate variant so the
 * compat matrix can rule on it. Uses the domain-owned defaults
 * factory — same source of truth as `buildFoundationForType`.
 * The specimen carries only the discriminator + the fields the
 * matrix reads (it dispatches on `type`; the additional fields
 * are there to satisfy the union's variant shape).
 */
function compatReasonForCandidate(
  structure: StructureMode,
  candidate: FoundationSpec['type'],
): string | null {
  const specimen: FoundationSpec = defaultFoundationFor(candidate);
  const result = validateFoundationCombination({
    structure,
    foundation: specimen,
  });
  return result.ok ? null : result.reason;
}

// ==========================================================
// Component
// ==========================================================

export function FoundationTypeSelector(): JSX.Element {
  const design = useDesign();
  const selectId = useId();
  const describedById = useId();

  // Memoize the compat probe so a re-render on unrelated design
  // fields doesn't recompute the reason strings.
  const variantMeta = useMemo(
    () =>
      VARIANTS.map((v) => ({
        ...v,
        reason: compatReasonForCandidate(design.structure, v.type),
      })),
    [design.structure],
  );

  // Active-reasons list (S23 pair-fix Opus MED #3, FR-030). Each
  // entry is `<label>: <reason>`; empty when no variant is
  // incompatible with the current structure. Rendered as VISIBLE
  // caption text below the <select> so a sighted keyboard-only
  // user sees WHY the disabled options are disabled, not just
  // that they are disabled. Also wired via `aria-describedby` for
  // screen readers (single source of description).
  const activeReasonEntries = variantMeta
    .filter((v) => v.reason !== null)
    .map((v) => ({ type: v.type, label: v.label, reason: v.reason as string }));
  const hasActiveReasons = activeReasonEntries.length > 0;
  const activeReasonsText = activeReasonEntries
    .map((v) => `${v.label}: ${v.reason}`)
    .join(' ');

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value as FoundationSpec['type'];
    if (next === design.foundation.type) return; // no-op

    const foundation = buildFoundationForType(design.foundation, next);
    const patch: DeepPartial<DeckDesign> = { foundation };
    useDesignStore.getState().applyParameters(patch);
  };

  return (
    <div className="wd-foundation-type-selector">
      <label
        htmlFor={selectId}
        className="wd-foundation-type-selector__label"
      >
        Foundation type
      </label>
      <select
        id={selectId}
        className="wd-foundation-type-selector__select"
        value={design.foundation.type}
        onChange={handleChange}
        aria-describedby={describedById}
      >
        {variantMeta.map((v) => (
          <option
            key={v.type}
            value={v.type}
            disabled={v.reason !== null}
            title={v.reason ?? undefined}
          >
            {v.label}
            {v.reason !== null ? ' — unavailable' : ''}
          </option>
        ))}
      </select>
      {/*
        Description region — S23 pair-fix Opus MED #3 (FR-030).
        When at least one variant is incompatible with the current
        structure, render the reason(s) as VISIBLE caption text
        under the <select>. When all are compatible, fall back to
        the a11y-only default hint (still readable by screen
        readers on focus via `aria-describedby`, invisible in
        layout). Both branches share the same DOM id so the
        described-by wiring is stable regardless of which is
        active.
      */}
      {hasActiveReasons ? (
        <p
          id={describedById}
          className="wd-foundation-type-selector__reason"
          data-testid="foundation-type-reason"
        >
          {activeReasonsText}
        </p>
      ) : (
        <span
          id={describedById}
          className="wd-foundation-type-selector__hint"
        >
          Choose how the deck rests on the ground.
        </span>
      )}
    </div>
  );
}
