/**
 * `src/ui/warnings/RemediationControls.tsx` — S16 issue #38.
 *
 * ## Responsibility (single)
 *
 * Render the per-warning "choose a fix" UI:
 *
 *   1. `<fieldset>` with a `<legend>` naming the group.
 *   2. Radio group of `RemediationOption`s — enabled first,
 *      disabled last, each with a headline + detail label.
 *   3. "Apply fix" button that calls
 *      `useDesignStore.getState().applyRemediation(selected)`.
 *   4. `<div aria-live="polite">` for post-apply announcement.
 *
 * ## Default selection (AC13)
 *
 * The first ENABLED CLEARING option (not just "first") is
 * pre-selected. If no clearing option exists, the whole panel
 * degrades to the all-disabled fallback (AC16).
 *
 * ## textContent only (AC18)
 *
 * Every label / announcement is rendered as JSX children —
 * React uses `textContent`, never `dangerouslySet` +
 * `InnerHTML`. A regression-guard test greps this file for the
 * escape hatch.
 *
 * ## Boundary
 *
 *   - `../../state`     — useDesignStore, useUiUnits,
 *                         useRemediationsForWarning.
 *   - `../../domain/model` — Warning shape (via type-only import).
 *   - `react`          — hooks + JSX.
 *   - `./remediation-labels` — sibling helper (pure formatter).
 *   - NO domain/spans, NO application, NO persistence, NO scene.
 */
import { useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { Warning } from '../../domain/model';
import {
  useDesignStore,
  useRemediationsForWarning,
  useUiUnits,
} from '../../state';
import type { RemediationOption } from '../../state';

import { formatRemediationOption } from './remediation-labels';

// ---------------------------------------------------------------------------
// Copy constants
// ---------------------------------------------------------------------------

/**
 * The legend text. Exported so tests can grep against the exact
 * string rather than re-implement the wording.
 */
export const REMEDIATION_LEGEND = 'Choose a fix';

/**
 * The all-disabled explanatory paragraph shown when NO option is
 * enabled — MVP tells the user to adjust the design elsewhere.
 * See AC16.
 */
export const NO_REMEDIATION_TEXT =
  'No remediation clears this warning at the current design. Adjust the deck size, joist spacing, or lumber species from the design panel.';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RemediationControlsProps {
  readonly warning: Warning;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The per-warning "choose a fix" fieldset. Renders NOTHING when
 * the warning has no options at all — the compute layer should
 * always return at least one option (see AC4), so this branch is
 * defensive.
 */
export function RemediationControls(
  props: RemediationControlsProps,
): JSX.Element | null {
  const { warning } = props;
  const options = useRemediationsForWarning(warning);
  const units = useUiUnits();

  // Order: enabled clearing options first, then any enabled
  // non-clearing (MVP treats non-clearing as disabled, but the
  // check is defensive), then disabled last. Within each bucket
  // the compute layer's cheapest-first ordering is preserved via
  // `Array.prototype.filter` (stable).
  const orderedOptions = useMemo(() => {
    const enabled = options.filter((o) => !o.disabled);
    const disabled = options.filter((o) => o.disabled);
    return [...enabled, ...disabled];
  }, [options]);

  // The first ENABLED CLEARING option is the default selection.
  const defaultId = useMemo(() => {
    const firstEnabled = orderedOptions.find(
      (o) => !o.disabled && o.wouldClear,
    );
    return firstEnabled ? optionId(firstEnabled) : null;
  }, [orderedOptions]);

  // Local UI state — which radio is currently selected. Uses the
  // React "derived state" idiom (docs.react.dev/reference/react/useState
  // §Storing information from previous renders) rather than a
  // useEffect(→ setState) cascade: we track `prevDefaultId` in a
  // ref and, when the compute produces a new default (parameters
  // changed under the panel), sync `selectedId` INLINE. This is
  // what the `react-hooks/set-state-in-effect` lint rule
  // recommends over `useEffect(() => setSelectedId(defaultId))`.
  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  const prevDefaultIdRef = useRef<string | null>(defaultId);
  if (prevDefaultIdRef.current !== defaultId) {
    prevDefaultIdRef.current = defaultId;
    setSelectedId(defaultId);
  }

  // Announcement text — read by the aria-live region after Apply.
  const [announcement, setAnnouncement] = useState<string>('');

  // All-disabled fallback (AC16). NEVER null options (compute
  // returns at least one) → but the "no clearing" case IS a
  // possibility; render the explanatory paragraph instead of a
  // useless radio group.
  const hasAnyEnabled = orderedOptions.some((o) => !o.disabled);
  if (!hasAnyEnabled) {
    return (
      <div
        className="wd-remediation-controls wd-remediation-controls--empty"
        // aria-live only carries the announcement — the paragraph
        // itself is a plain <p> so screen readers announce it as
        // a normal reading-order element on first render.
      >
        <p className="wd-remediation-controls__empty-text">
          {NO_REMEDIATION_TEXT}
        </p>
      </div>
    );
  }

  const selected = orderedOptions.find((o) => optionId(o) === selectedId);

  function onApply(): void {
    if (!selected || selected.disabled) {
      return;
    }
    useDesignStore.getState().applyRemediation(selected);
    const { headline } = formatRemediationOption(selected, units);
    setAnnouncement(`Applied: ${headline}.`);
  }

  return (
    <fieldset className="wd-remediation-controls">
      <legend className="wd-remediation-controls__legend">
        {REMEDIATION_LEGEND}
      </legend>

      {/*
       * A plain <div> wrapper — the parent <fieldset><legend> is
       * the accessible group container for the radios (implicit
       * role). Making this an inner <ul>/<li> would break the
       * parent <WarningsPanel>'s `getByRole('listitem')` queries.
       */}
      <div className="wd-remediation-controls__list">
        {orderedOptions.map((option) => {
          const id = optionId(option);
          const { headline, detail } = formatRemediationOption(option, units);
          return (
            <div
              key={id}
              className={
                option.disabled
                  ? 'wd-remediation-controls__item wd-remediation-controls__item--disabled'
                  : 'wd-remediation-controls__item'
              }
            >
              <label className="wd-remediation-controls__label">
                <input
                  type="radio"
                  name={`remediation-${warning.memberId}`}
                  value={id}
                  checked={selectedId === id}
                  disabled={option.disabled}
                  onChange={(): void => {
                    setSelectedId(id);
                  }}
                />
                <span className="wd-remediation-controls__headline">
                  {headline}
                </span>
                <small className="wd-remediation-controls__detail">
                  {detail}
                </small>
              </label>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="wd-remediation-controls__apply"
        disabled={!selected || selected.disabled}
        onClick={onApply}
      >
        Apply fix
      </button>

      {/*
       * aria-live announcement region. `polite` so it doesn't
       * interrupt the user; textContent-only per AC18 (React
       * escapes the interpolated headline).
       */}
      <div
        className="wd-remediation-controls__announcement"
        aria-live="polite"
        role="status"
      >
        {announcement}
      </div>
    </fieldset>
  );
}

/**
 * Stable string id for a `RemediationOption`, unique within the
 * per-warning group. Composed from kind + patch discriminant leaf
 * so two options with the same kind but different targets get
 * different ids (e.g. `upgrade-joist-size:2x10` vs
 * `upgrade-joist-size:2x12`).
 */
function optionId(option: RemediationOption): string {
  const { patch } = option;
  switch (patch.kind) {
    case 'reduce-joist-spacing':
      return `${patch.kind}:${String(patch.newSpacingMm)}`;
    case 'upgrade-joist-size':
      return `${patch.kind}:${patch.newNominal}`;
    case 'upgrade-beam-size':
      return `${patch.kind}:${patch.newNominal}`;
    case 'change-joist-species':
      return `${patch.kind}:${patch.newSpecies}`;
    case 'change-beam-species':
      return `${patch.kind}:${patch.newSpecies}`;
    /* c8 ignore next 6 */
    default: {
      const _exhaustive: never = patch;
      void _exhaustive;
      return option.kind;
    }
  }
}
