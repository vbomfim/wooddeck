/**
 * `SelectField.test.tsx` — S13 issue #14 species / grade / SKU /
 * orientation control tests.
 *
 * Generic labelled `<select>` — takes an option list, a value,
 * and an onChange. Disabled state is used for the AC6 Composite
 * grade lock (grade select is disabled + shows 'NA' when species
 * is Composite).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SelectField } from './SelectField';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('<SelectField /> — rendering', () => {
  it('renders every option in order', () => {
    render(
      <SelectField
        label="Species"
        value="PT"
        options={[
          { value: 'PT', label: 'PT' },
          { value: 'Cedar', label: 'Cedar' },
          { value: 'Composite', label: 'Composite' },
        ]}
        onChange={(): void => {}}
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('Species');
    // Every option present, in insertion order.
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'PT',
      'Cedar',
      'Composite',
    ]);
  });

  it('reflects the current value', () => {
    render(
      <SelectField
        label="Species"
        value="Cedar"
        options={[
          { value: 'PT', label: 'PT' },
          { value: 'Cedar', label: 'Cedar' },
        ]}
        onChange={(): void => {}}
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('Species');
    expect(select.value).toBe('Cedar');
  });

  it('associates label ↔ select via htmlFor / id', () => {
    render(
      <SelectField
        label="Species"
        value="PT"
        options={[{ value: 'PT', label: 'PT' }]}
        onChange={(): void => {}}
      />,
    );
    // getByLabelText succeeds only when the wiring is correct.
    expect(screen.getByLabelText('Species').tagName).toBe('SELECT');
  });
});

describe('<SelectField /> — change events', () => {
  it('fires onChange with the new value when the user picks another option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        label="Species"
        value="PT"
        options={[
          { value: 'PT', label: 'PT' },
          { value: 'Cedar', label: 'Cedar' },
          { value: 'Composite', label: 'Composite' },
        ]}
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText('Species');
    await user.selectOptions(select, 'Cedar');
    expect(onChange).toHaveBeenCalledWith('Cedar');
  });
});

describe('<SelectField /> — disabled', () => {
  it('renders a disabled select when disabled=true (AC6 Composite grade lock)', () => {
    render(
      <SelectField
        label="Grade"
        value="NA"
        options={[
          { value: 'No1', label: 'No1' },
          { value: 'No2', label: 'No2' },
          { value: 'Select', label: 'Select' },
          { value: 'NA', label: 'NA' },
        ]}
        disabled
        onChange={(): void => {}}
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('Grade');
    expect(select.disabled).toBe(true);
    expect(select.value).toBe('NA');
  });

  it('does NOT fire onChange when disabled — user cannot pick', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        label="Grade"
        value="NA"
        options={[
          { value: 'NA', label: 'NA' },
          { value: 'No2', label: 'No2' },
        ]}
        disabled
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText('Grade');
    // A disabled select rejects user interaction. userEvent throws
    // on `selectOptions` against a disabled select, so guard with a
    // try/catch and assert onChange stayed quiet.
    await user
      .selectOptions(select, 'No2')
      .catch(() => {
        /* expected — the disabled select rejects the click. */
      });
    expect(onChange).not.toHaveBeenCalled();
  });
});
