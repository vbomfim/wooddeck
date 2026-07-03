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
 *   3. Commits on blur OR Enter (but see FIX 2 / AC5 exceptions):
 *      - `parseLength(raw, system)` succeeds AND the value differs
 *        from the current canonical display → `onChangeMm(mm)`.
 *      - `UnitParseError` → inline error, no `onChangeMm`.
 *      - Blur → UnitSwitcher (AC5): DISCARD in-flight edit, do
 *        NOT commit — a unit switch is display-only.
 *      - Blur without an intervening keystroke (FIX 2 dirty flag):
 *        NO-OP — nothing to commit.
 *      - Blur where the parsed value round-trips to the current
 *        canonical display (FIX 2 no-op-skip): NO-OP — the user
 *        typed the visible display back in, so no state change.
 *   4. Discards the in-flight string AND clears any parse-error
 *      state when `system` or `mmValue` changes from a parent
 *      update (AC5 edge — a unit switch or an external store
 *      update while mid-edit re-formats from the new canonical
 *      `mmValue` and the field is guaranteed to return to a
 *      `aria-invalid="false"` clean state; FIX 3 review gate).
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
import { useId, useState, type FocusEvent, type JSX, type KeyboardEvent } from 'react';

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
 * FIX 2 (S13 review gate) — DOM selector matching the
 * `<UnitSwitcher />` container (`role="group"` +
 * `aria-label="Display units"`). We use this in the field's blur
 * handler to detect when focus is moving INTO the unit switcher —
 * a display-only control that must NEVER cause the focused field
 * to commit its in-flight value (AC5 invariant, which
 * pre-fix broke because focus-to-button blurred the field first
 * and the field's commit ran unconditionally).
 *
 * Choosing an attribute-only selector (no data-* on UnitSwitcher)
 * keeps the field decoupled from its parent's structure — if the
 * switcher moves to a different container, only its aria contract
 * matters. Any element carrying `role="group"` +
 * `aria-label="Display units"` will match.
 */
const UNIT_SWITCHER_SELECTOR =
  '[role="group"][aria-label="Display units"]';

/**
 * Props for {@link LengthField}. See ticket §2 Interface Contract.
 */
export interface LengthFieldProps {
  readonly label: string;
  readonly mmValue: Mm;
  readonly system: UnitSystem;
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

  // Inline parse error (null when the field is clean).
  const [parseError, setParseError] = useState<string | null>(null);

  // FIX 2 (S13 review gate) — dirty tracks whether the user has
  // typed since the last canonical resync. commit() short-circuits
  // when NOT dirty, so a blur without an edit (e.g. focus moving to
  // another control after the user just clicked into the field) is
  // a no-op — no spurious `onChangeMm` firing with the round-tripped
  // formatter/parser value (QA G4).
  const [dirty, setDirty] = useState<boolean>(false);

  // Track the last (mmValue, system) pair we synchronised the raw
  // input to via two co-owned state slots. When a re-render arrives
  // with a NEW pair, we know the parent updated the canonical value
  // — discard the in-flight string, re-format, AND (FIX 3 review
  // gate) clear any stale parse-error state so a resync doesn't
  // leave the field in a "clean display + red aria-invalid" limbo.
  // This is React's official "Adjusting State When a Prop Changes"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect)
  // — the setState calls during render tell React to schedule a
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
    // FIX 3 — clear any stale parse-error on canonical resync so
    // the field returns to `aria-invalid="false"` when the display
    // reflects a fresh, valid canonical value.
    setParseError(null);
    // Also reset dirty on canonical resync — the user's in-flight
    // edit has been discarded by definition when the parent
    // changed the canonical value; nothing to commit.
    setDirty(false);
  }

  /**
   * Commit the current raw input.
   *
   *   - Not dirty (FIX 2 review gate): NO-OP — the user hasn't
   *     typed since the last canonical resync, so there is nothing
   *     to commit. Pre-fix the field committed on every blur,
   *     including drift-round-trips like 3657.6 → 3658 through
   *     formatLength → parseLength (QA G4).
   *   - Empty / whitespace-only: keep the previous value silently
   *     (blurring an empty field is not a user intent to delete).
   *   - Parses to the SAME canonical value (FIX 2 no-op-skip):
   *     also a NO-OP — the user typed the current display back in,
   *     unchanged.
   *   - Parses cleanly to a NEW value → call onChangeMm; the parent
   *     updates the canonical value, which flows back via the
   *     tracked-pair refresh above.
   *   - `UnitParseError` → set the inline error; the caller does
   *     NOT see an onChangeMm.
   */
  function commit(): void {
    if (!dirty) {
      // FIX 2 — nothing to commit. Also clear any parse error that
      // survived from an earlier edit that got abandoned.
      setParseError(null);
      return;
    }
    const trimmed = rawInput.trim();
    if (trimmed === '') {
      // Silent revert to canonical. The user gets the formatted
      // value back — no error surfaced because they didn't type
      // anything wrong.
      setParseError(null);
      setRawInput(formatLength(mmValue, system));
      setDirty(false);
      return;
    }
    try {
      const parsedMm = parseLength(trimmed, system);
      // FIX 2 no-op-skip: compare the parsed input against the
      // parsed CURRENT DISPLAY. Non-integer canonical mm (see
      // units.ts "Non-integer Mm policy") means an exact
      // `parsedMm === mmValue` check misses the round-trip case
      // — e.g. mmValue=3657.6 displays as "12'" which parses back
      // to 3658. Comparing parseLength(rawInput) to
      // parseLength(formatLength(mmValue)) makes the check
      // idempotent through the display layer: typing the current
      // display back in is always a no-op.
      const currentDisplayMm = parseLength(
        formatLength(mmValue, system),
        system,
      );
      if (parsedMm === currentDisplayMm) {
        setParseError(null);
        setDirty(false);
        return;
      }
      setParseError(null);
      setDirty(false);
      props.onChangeMm(parsedMm);
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

  /**
   * FIX 2 (S13 review gate) — blur handler.
   *
   * If focus is moving to the UnitSwitcher, DO NOT commit the
   * in-flight edit — a unit switch is display-only (AC5). The
   * incoming re-render with the new `system` prop will discard
   * the in-flight raw string via the tracked-pair refresh and
   * re-format from the canonical `mmValue`.
   *
   * The `relatedTarget` check is the accepted browser primitive
   * for "where is focus going?" and is stable across React
   * synthetic events; falling back to `null` when the browser
   * did not populate it (jsdom sometimes doesn't) means we default
   * to the normal commit path — safe, because the dirty-flag +
   * no-op-skip logic in `commit()` still prevents the most
   * common drift.
   */
  function onBlur(event: FocusEvent<HTMLInputElement>): void {
    const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof Element &&
      relatedTarget.closest(UNIT_SWITCHER_SELECTOR) !== null
    ) {
      // Discard the in-flight edit + clear any parse-error state
      // — the subsequent re-render with the new `system` prop
      // will re-format from the canonical `mmValue` via the
      // tracked-pair refresh (no need to touch rawInput here).
      setParseError(null);
      setDirty(false);
      return;
    }
    commit();
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
          // local state; do NOT parse/commit here (AC3). Flip the
          // dirty flag so `commit()` knows the user actually edited.
          setRawInput(e.target.value);
          setDirty(true);
        }}
        onBlur={onBlur}
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
