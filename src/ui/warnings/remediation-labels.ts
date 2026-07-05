/**
 * `src/ui/warnings/remediation-labels.ts` — S16 issue #38.
 *
 * ## Purpose
 *
 * Convert a `RemediationOption` (produced in the domain layer, kind
 * + patch + numbers + wouldClear + disabledReason) into a
 * PRESENTATION shape suitable for a radio-button + apply-fix UI:
 *
 *   ```ts
 *   { headline: string; detail: string }
 *   ```
 *
 * `headline` is short (fits a radio label). `detail` includes the
 * clearance context (allowable → new allowable, "clears" vs "still
 * over" framing) and, when disabled, the reason.
 *
 * ## Unit-awareness (AC15)
 *
 * The formatter takes a `UnitSystem` (`'imperial' | 'metric'`) and
 * uses `formatLength` from `domain/units` for any `Mm` value it
 * surfaces. Nominal identifiers (`2x8`, `2x10`) are unit-invariant
 * carpentry shorthand — they pass through as-is. Species labels
 * are likewise unit-invariant (`PT`, `Cedar`, `Composite`).
 *
 * ## Purity
 *
 * `formatRemediationOption` is a pure function — no globals, no
 * console output, no I/O, no memoization. That makes it trivially
 * testable and — more importantly — safe to call inside a React
 * render without triggering a re-render cascade.
 *
 * ## textContent-only (AC18)
 *
 * The strings this module returns are consumed by
 * `<RemediationControls>` as REACT children (JSX text nodes) —
 * never `dangerouslySetInnerHTML`. Any innocuous character (`<`,
 * `>`, `&`) is safe as textContent — React handles the escaping.
 */

import type { UnitSystem } from '../../domain/units';
import { formatLength } from '../../domain/units';
import type { RemediationOption } from '../../state';

/**
 * The two-line output shape the ui consumes.
 *
 * - `headline` — one short sentence that identifies the option;
 *   goes on the radio button LABEL. Should read well next to the
 *   radio (`Reduce joist spacing to 12 in.`).
 * - `detail` — the follow-up sentence rendered below the radio
 *   label — gives the clearance context OR the disabled reason
 *   so a screen reader user hears WHY the option is or isn't a
 *   good fit for their design.
 */
export interface RemediationLabel {
  readonly headline: string;
  readonly detail: string;
}

/**
 * Format a species enum ('PT' | 'Cedar' | 'Composite') into the
 * carpenter-facing label. `PT` is a proper acronym and stays
 * uppercase; the other two are camelcase-friendly title-case.
 */
function formatSpecies(species: string): string {
  if (species === 'PT') {
    return 'PT';
  }
  return species;
}

/**
 * Build the headline for each `RemediationKind`. Kept private —
 * `formatRemediationOption` composes headline + detail.
 */
function headlineFor(option: RemediationOption, units: UnitSystem): string {
  const { patch } = option;
  switch (patch.kind) {
    case 'reduce-joist-spacing':
      return `Reduce joist spacing to ${formatLength(patch.newSpacingMm, units)}`;
    case 'upgrade-joist-size':
      return `Upgrade joists to ${patch.newNominal}`;
    case 'upgrade-beam-size':
      return `Upgrade beams to ${patch.newNominal}`;
    case 'change-joist-species':
      return `Change joist species to ${formatSpecies(patch.newSpecies)}`;
    case 'change-beam-species':
      return `Change beam species to ${formatSpecies(patch.newSpecies)}`;
    case 'add-support-row':
      // S25 pair-fix (Opus MED#4): when the option is disabled,
      // render `option.summary` instead of building an "N → M"
      // arrow. Reason: some disabled paths (elevated design,
      // SpanTable fail-safe) carry PLACEHOLDER
      // `currentRows`/`proposedRows` because the row count is not
      // meaningful for those states — the arrow would contradict
      // the `disabledReason` ("Switch to Floating..." + "(2 → 2)"
      // reads as broken). For enabled and densification-cap /
      // no-clear disabled cases, `currentRows` and `proposedRows`
      // are real, and the arrow is truthful; we could special-case
      // those, but routing every disabled add-support-row through
      // the summary keeps the presentation uniformly-safe and the
      // detail (`disabledReason`) still tells the user the real
      // reason.
      if (option.disabled) {
        return option.summary;
      }
      // Code Review Fix #1 (feat/block-count-per-joist review):
      // the ACTIVE Method-B path now uses a COUNT knob
      // (`blockRowsHint`) — NOT a distance. Render the count-
      // based label using `currentRows`/`proposedRows` on the
      // patch. The prior length-based label ("Reduce block
      // spacing to add support (12′ → 3′)") was misleading:
      //   (a) the UI no longer has a "block spacing" control,
      //   (b) X and Y were LENGTHS while the user's knob is a
      //       COUNT (mismatch — user can't relate the arrow to
      //       the field they'll edit),
      //   (c) "reduce" contradicts the count INCREASING.
      // The spacing fields on the patch (`currentSpacingMm` /
      // `proposedSpacingMm`) are IGNORED for the label — they
      // remain on the patch for back-compat with legacy
      // consumers that read them (e.g. persistence, audit).
      return `Add support rows (${patch.currentRows} → ${patch.proposedRows})`;
    /* c8 ignore next 6 */
    default: {
      const _exhaustive: never = patch;
      void _exhaustive;
      return option.summary;
    }
  }
}

/**
 * Build the detail sentence. Priority:
 *
 *   1. If disabled → surface `disabledReason` (screen readers hear
 *      WHY the option isn't a good fit).
 *   2. If `wouldClear` → positive framing ("Clears the warning —
 *      new allowable X").
 *   3. Otherwise (edge case: enabled but non-clearing — MVP treats
 *      as disabled, but the branch is defensive) → "Still over the
 *      allowable span."
 */
function detailFor(option: RemediationOption, units: UnitSystem): string {
  if (option.disabled && option.disabledReason !== null) {
    return option.disabledReason;
  }
  if (option.wouldClear) {
    const newAllowable = formatLength(option.newAllowableMm, units);
    return `Clears the warning — new allowable ${newAllowable}.`;
  }
  return 'Still exceeds allowable span.';
}

/**
 * Format a `RemediationOption` for display. Pure, deterministic,
 * unit-aware. Consumed by `<RemediationControls>`.
 *
 * @param option The option to format.
 * @param units  The active unit system (`useUiUnits()` result).
 *
 * @returns A `{headline, detail}` object with plain, text-content-
 *          safe strings (no HTML markup, no injections).
 */
export function formatRemediationOption(
  option: RemediationOption,
  units: UnitSystem,
): RemediationLabel {
  return {
    headline: headlineFor(option, units),
    detail: detailFor(option, units),
  };
}
