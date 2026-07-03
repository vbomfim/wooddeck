/**
 * `src/ui/fields/SelectField.tsx` — S13 issue #14 generic labelled
 * `<select>` used for species, grade, board SKU, sizes, and
 * orientation.
 *
 * ## Responsibility (single)
 *
 * Render a `<label>` + `<select>` pair with the given options.
 * Fires `onChange` with the new string value when the user picks
 * a different option. Supports a `disabled` state (used for AC6
 * Composite grade lock).
 *
 * ## Why a generic component (not one per field kind)
 *
 * Every categorical parameter — species, grade, size, orientation —
 * boils down to the same shape: a fixed list of `(value, label)`
 * pairs and one selected value. Extracting that into ONE component
 * means:
 *   - a11y wiring (label ↔ select) lives in ONE place.
 *   - CSS tokens (grid, border, focus) apply uniformly.
 *   - A future replacement (native `<select>` → a combobox with a
 *     search input) touches ONE file.
 *
 * ## Boundary
 *
 * No domain imports — the caller supplies `options` typed as
 * `readonly SelectOption<T>[]`. This keeps the field usable with
 * any string-derived union.
 */
import { useId, type JSX } from 'react';

/**
 * An option in the select list. The `value` is the DOM value the
 * `<option>` uses; the `label` is the user-facing text.
 *
 * Generic over the caller's string-union type (e.g., `Species`,
 * `Grade`) so `onChange`'s payload is typed correctly.
 */
export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
}

export interface SelectFieldProps<T extends string = string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SelectOption<T>[];
  readonly disabled?: boolean;
  onChange(next: T): void;
}

export function SelectField<T extends string = string>(
  props: SelectFieldProps<T>,
): JSX.Element {
  const { label, value, options, disabled } = props;
  const selectId = useId();

  return (
    <div className="wd-select-field">
      <label className="wd-select-field__label" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className="wd-select-field__select"
        value={value}
        disabled={disabled === true}
        onChange={(e): void => {
          // Narrow the raw event value to T. Options come from the
          // caller's typed union, so any value present in the
          // select IS a valid T.
          props.onChange(e.target.value as T);
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
