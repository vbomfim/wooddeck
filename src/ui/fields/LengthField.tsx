/**
 * `src/ui/fields/LengthField.tsx` — S13 issue #14.
 *
 * ## Responsibility (single)
 *
 * A labelled length input that:
 *
 *   1. Displays the current `mmValue` formatted via `formatLength`
 *      in the currently-selected `system` (imperial / metric).
 *   2. Holds the user's in-flight raw string in LOCAL state while
 *      the field has focus — this is the ONLY state the field owns
 *      (ticket §2 Rewritability check: "No state owned beyond
 *      in-flight input strings").
 *   3. Commits on blur OR Enter:
 *      - `parseLength(raw, system)` succeeds → `onChangeMm(mm)`.
 *      - `UnitParseError` → inline error, no `onChangeMm`.
 *   4. Discards the in-flight string when `system` or `mmValue`
 *      changes from a parent update (AC5 edge — a unit switch or
 *      an external store update while mid-edit re-formats from the
 *      new canonical `mmValue`).
 *
 * ## Why NOT a controlled `<input value={format(mm)} />` on every keystroke
 *
 * A pure controlled input that formats on every keystroke:
 *   - Destroys cursor position (formatter inserts unit suffixes).
 *   - Fights the user's typing ("12" formats to "12'"; the next
 *     keystroke sees "12'" and appends to the wrong place).
 *   - Fires onChange constantly — SC-003 latency budget applies at
 *     BLUR granularity per the AC3 trade-off, not per keystroke.
 *
 * The in-flight local-state pattern is standard for numeric inputs
 * that accept unit-suffixed strings (React docs: "Uncontrolled
 * component with a defaultValue prop"). We track the last committed
 * `[mmValue, system]` pair so a parent update while we're editing
 * discards the in-flight string cleanly.
 *
 * ## Boundary
 *
 * Imports from `../../domain/units` (parseLength, formatLength,
 * UnitParseError, Mm, UnitSystem) — the S13 boundary resolution
 * (issue #14) explicitly permits `ui/ → domain/units`. This module
 * does NOT touch `domain/layout` — a below-min mm value is caught
 * by the store's `applyParameters → LayoutError` flow, not
 * pre-validated here.
 */
import { useId, useState, type JSX, type KeyboardEvent } from 'react';

import {
  formatLength,
  parseLength,
  UnitParseError,
  type Mm,
  type UnitSystem,
} from '../../domain/units';

/**
 * The exact copy the ticket AC4 mandates. Extracted so tests can
 * assert on the constant rather than re-typing the string, and so a
 * future copy edit lives in ONE place.
 */
const PARSE_ERROR_MESSAGE =
  'Enter a number, optionally with units — e.g., 12 or 12 ft';

/**
 * Props for {@link LengthField}. See ticket §2 Interface Contract.
 *
 * `min`/`max` are optional UX hints only — they do NOT gate the
 * commit (the store's `applyParameters` throws `LayoutError` with a
 * UI-ready message for material-dependent minimums; see issue #14
 * Boundary Resolution §3). Passing them still lets us set HTML5
 * `min`/`max` attributes for keyboard-up/down step behaviour.
 */
export interface LengthFieldProps {
  readonly label: string;
  readonly mmValue: Mm;
  readonly system: UnitSystem;
  /** UX-hint minimum in mm (NOT authoritative — layout engine owns). */
  readonly min?: number;
  /** UX-hint maximum in mm (NOT authoritative — layout engine owns). */
  readonly max?: number;
  onChangeMm(mm: Mm): void;
  /** Optional guidance rendered under the input (e.g., "16 in o.c. is common"). */
  readonly hint?: string;
}

export function LengthField(props: LengthFieldProps): JSX.Element {
  const { label, mmValue, system, hint } = props;

  // Stable ids for label ↔ input ↔ aria-describedby wiring.
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  // The in-flight raw string the user is typing. Initialised from
  // the formatted canonical value.
  const [rawInput, setRawInput] = useState<string>(() =>
    formatLength(mmValue, system),
  );

  // Track the last (mmValue, system) pair we synchronised the raw
  // input to via two co-owned state slots. When a re-render arrives
  // with a NEW pair, we know the parent updated the canonical value
  // — discard the in-flight string and re-format. This is React's
  // official "Adjusting State When a Prop Changes" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect) — the
  // three setState calls during render tell React to schedule a
  // fresh render with the updated state; the fresh render is what
  // the user sees, with no flash of stale content.
  //
  // Not a `useRef` because the react-hooks/refs lint rule (React
  // Compiler alignment) forbids reading `.current` during render.
  // The state-slot approach passes the compiler check because it
  // uses the officially-supported pattern.
  const [prevMm, setPrevMm] = useState<Mm>(mmValue);
  const [prevSystem, setPrevSystem] = useState<UnitSystem>(system);
  if (prevMm !== mmValue || prevSystem !== system) {
    setPrevMm(mmValue);
    setPrevSystem(system);
    setRawInput(formatLength(mmValue, system));
  }

  // Inline parse error (null when the field is clean).
  const [parseError, setParseError] = useState<string | null>(null);

  /**
   * Commit the current raw input.
   *   - Empty / whitespace-only → keep the previous value silently.
   *     (Blurring an empty field is not a user intent to "delete"
   *     the value; it's a common accidental interaction.)
   *   - Parses cleanly → call onChangeMm; the parent updates the
   *     canonical value, which flows back via the trackedPair
   *     refresh above.
   *   - UnitParseError → set the inline error; the caller does NOT
   *     see an onChangeMm.
   */
  function commit(): void {
    const trimmed = rawInput.trim();
    if (trimmed === '') {
      // Silent revert to canonical. The user gets the formatted
      // value back — no error surfaced because they didn't type
      // anything wrong.
      setParseError(null);
      setRawInput(formatLength(mmValue, system));
      return;
    }
    try {
      const mm = parseLength(trimmed, system);
      setParseError(null);
      props.onChangeMm(mm);
    } catch (err) {
      if (err instanceof UnitParseError) {
        setParseError(PARSE_ERROR_MESSAGE);
        return;
      }
      // Any other Error class from parseLength is unexpected — bubble
      // it so it's not silently swallowed. In practice parseLength
      // only throws `UnitParseError`.
      throw err;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  }

  // Build the aria-describedby list: hint (if any) + error (if any).
  // Multiple ids space-separated per ARIA spec.
  const describedByIds: string[] = [];
  if (hint !== undefined) {
    describedByIds.push(hintId);
  }
  if (parseError !== null) {
    describedByIds.push(errorId);
  }
  const describedBy = describedByIds.length > 0 ? describedByIds.join(' ') : undefined;

  return (
    <div className="wd-length-field">
      <label className="wd-length-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="wd-length-field__input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={rawInput}
        onChange={(e): void => {
          // Uncontrolled-style behaviour: track the raw string in
          // local state; do NOT parse/commit here (AC3).
          setRawInput(e.target.value);
        }}
        onBlur={(): void => commit()}
        onKeyDown={onKeyDown}
        aria-invalid={parseError !== null ? 'true' : 'false'}
        aria-describedby={describedBy}
      />
      {hint !== undefined && (
        <p id={hintId} className="wd-length-field__hint">
          {hint}
        </p>
      )}
      {parseError !== null && (
        <p id={errorId} className="wd-length-field__error" role="alert">
          {parseError}
        </p>
      )}
    </div>
  );
}
