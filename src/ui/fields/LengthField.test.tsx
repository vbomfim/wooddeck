/**
 * `LengthField.test.tsx` — S13 issue #14 AC1/AC2/AC3/AC4/AC5 + edges.
 *
 * ## What LengthField owns
 *
 *   - Displays the current canonical `mmValue` formatted via
 *     `formatLength` in the currently-selected `system` (imperial or
 *     metric).
 *   - Holds the user's in-flight input string in LOCAL state while
 *     the field has focus. That in-flight string is the ONLY piece
 *     of state the field owns (issue #14 §2 Rewritability check —
 *     "No state owned beyond in-flight input strings").
 *   - Commits on blur OR Enter: parses via `parseLength`, calls
 *     `onChangeMm(mm)` on success, surfaces an inline error on
 *     `UnitParseError` without calling onChange (AC3 + AC4).
 *   - Discards the in-flight string when `system` or `mmValue`
 *     changes from a parent update (AC5 edge — a unit switch or
 *     an external store update while the field is mid-edit must
 *     re-format from the new canonical `mmValue`).
 *
 * ## Why the in-flight state
 *
 * A controlled input that re-formats on every keystroke destroys
 * the user's cursor position and forces them to fight the formatter
 * ("12" formats to "12 in"; the next keystroke sees "12 in" not
 * "12" and appends to the wrong place). Holding the raw string
 * during edit and committing on blur / Enter matches the AC3
 * design decision and every well-behaved numeric input.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LengthField } from './LengthField';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// AC1 — renders current value formatted in the current unit
// --------------------------------------------------------------------------

describe('<LengthField /> — AC1 initial display', () => {
  it('formats mmValue in imperial when system=imperial', () => {
    render(
      <LengthField
        label="Width"
        mmValue={4877 /* 16 ft rounded */}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );
    // 16 ft (imperial) round-trip. formatLength(4877, 'imperial')
    // yields the AC5-style prime notation (see units.ts).
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    expect(input.value).toMatch(/16/); // "16'" or "16′ 0″" etc.
  });

  it('formats mmValue in metric when system=metric', () => {
    render(
      <LengthField
        label="Width"
        mmValue={3658 /* 12 ft */}
        system="metric"
        onChangeMm={(): void => {}}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    // formatLength(3658, 'metric') ≈ "3.66 m" — assert m-ish shape.
    expect(input.value).toMatch(/3\.6/);
    expect(input.value).toMatch(/m/);
  });

  it('renders the hint text under the input', () => {
    render(
      <LengthField
        label="Joist spacing"
        mmValue={406}
        system="imperial"
        hint="16 in o.c. is a common choice"
        onChangeMm={(): void => {}}
      />,
    );
    expect(screen.getByText(/16 in o\.c\.\s+is a common choice/i)).toBeInTheDocument();
  });
});

// --------------------------------------------------------------------------
// AC3 — in-flight typing does NOT fire onChange until commit
// --------------------------------------------------------------------------

describe('<LengthField /> — AC3 in-flight editing', () => {
  it('shows the raw string mid-type without calling onChangeMm', async () => {
    const user = userEvent.setup();
    const onChangeMm = vi.fn();
    render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={onChangeMm}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');

    // Clear + type "12." — a partial decimal.
    await user.clear(input);
    await user.type(input, '12.');

    // AC3: mid-type the field shows the raw string, onChange is quiet.
    expect(input.value).toBe('12.');
    expect(onChangeMm).not.toHaveBeenCalled();
  });

  it('commits on blur — parses and calls onChangeMm with mm', async () => {
    const user = userEvent.setup();
    const onChangeMm = vi.fn();
    render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={onChangeMm}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    await user.clear(input);
    await user.type(input, '16');
    // Tabbing out fires blur.
    await user.tab();
    // AC2: "16" (imperial, treated as feet) → 16 × 304.8 = 4877 mm.
    expect(onChangeMm).toHaveBeenCalledTimes(1);
    expect(onChangeMm).toHaveBeenCalledWith(4877);
  });

  it('commits on Enter — parses and calls onChangeMm', async () => {
    const user = userEvent.setup();
    const onChangeMm = vi.fn();
    render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={onChangeMm}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    await user.clear(input);
    await user.type(input, '16{Enter}');
    expect(onChangeMm).toHaveBeenCalledWith(4877);
  });
});

// --------------------------------------------------------------------------
// AC4 — invalid input surfaces inline error, no commit
// --------------------------------------------------------------------------

describe('<LengthField /> — AC4 invalid input', () => {
  it('shows inline error on unparseable input and does NOT call onChangeMm', async () => {
    const user = userEvent.setup();
    const onChangeMm = vi.fn();
    render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={onChangeMm}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    await user.clear(input);
    await user.type(input, 'twelve feet');
    await user.tab();

    // AC4 error copy: exact spec-mandated message.
    expect(
      screen.getByText(/Enter a number, optionally with units — e\.g\., 12 or 12 ft/i),
    ).toBeInTheDocument();
    expect(onChangeMm).not.toHaveBeenCalled();

    // The input is marked aria-invalid so screen readers announce it.
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // The error message is linked via aria-describedby.
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy!);
    expect(errorNode?.textContent).toMatch(/Enter a number/);
  });

  it('clears the inline error on the next successful commit', async () => {
    const user = userEvent.setup();
    const onChangeMm = vi.fn();
    render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={onChangeMm}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    // Invalid → shows error.
    await user.clear(input);
    await user.type(input, 'oops');
    await user.tab();
    expect(screen.getByText(/Enter a number/i)).toBeInTheDocument();

    // Valid → error clears.
    await user.click(input);
    await user.clear(input);
    await user.type(input, '10');
    await user.tab();
    expect(screen.queryByText(/Enter a number/i)).toBeNull();
    expect(onChangeMm).toHaveBeenLastCalledWith(3048); // 10 × 304.8
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });
});

// --------------------------------------------------------------------------
// AC5 edge — external `system` / `mmValue` change while editing
// --------------------------------------------------------------------------

describe('<LengthField /> — AC5 edge: unit switch mid-edit discards in-flight', () => {
  it('re-formats from the canonical mmValue when the system prop changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    // Start editing: put "12." partial into the input.
    await user.clear(input);
    await user.type(input, '12.');
    expect(input.value).toBe('12.');
    // Parent flips units WITHOUT the field having committed. AC5 edge:
    // the field must discard the in-flight "12." and re-format from
    // the canonical mmValue in the NEW system.
    rerender(
      <LengthField
        label="Width"
        mmValue={3658}
        system="metric"
        onChangeMm={(): void => {}}
      />,
    );
    // formatLength(3658, 'metric') should render metric — the display
    // shape includes "m".
    expect(input.value).toMatch(/m/);
    expect(input.value).not.toBe('12.');
  });

  it('re-formats from the new mmValue when the parent value changes externally', () => {
    const { rerender } = render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    expect(input.value).toMatch(/12/);

    // Parent updates the canonical value (e.g., via loadFromFile).
    rerender(
      <LengthField
        label="Width"
        mmValue={4877}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );
    expect(input.value).toMatch(/16/);
  });
});

// --------------------------------------------------------------------------
// A11y — label association + input attributes
// --------------------------------------------------------------------------

describe('<LengthField /> — accessibility', () => {
  it('associates the <label> with the input via htmlFor / id', () => {
    render(
      <LengthField
        label="Length"
        mmValue={3658}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );
    // getByLabelText only succeeds when the label→input wiring is
    // correct (either htmlFor+id, or a wrapping <label>).
    const input = screen.getByLabelText<HTMLInputElement>('Length');
    expect(input.tagName).toBe('INPUT');
  });

  it('exposes aria-describedby wired to the hint when no error', () => {
    render(
      <LengthField
        label="Joist spacing"
        mmValue={406}
        system="imperial"
        hint="16 in o.c. is a common choice"
        onChangeMm={(): void => {}}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Joist spacing');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hintNode = document.getElementById(describedBy!);
    expect(hintNode?.textContent).toMatch(/16 in o\.c\./i);
  });

  it('is a plain text input (not type=number, which strips the unit-suffix syntax)', () => {
    render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    // AC1 accepts input like "12 ft" — an HTML5 number input would
    // silently reject those characters. inputMode="decimal" hints at
    // a numeric keypad on touch devices without imposing the strict
    // number-parser semantics.
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');
  });
});

// --------------------------------------------------------------------------
// FIX 2 (review gate) — commit() short-circuits when NOT dirty or
//   when the parsed value round-trips to the same canonical mm.
//   The pre-fix behaviour committed on every blur, which:
//     (a) applied in-flight edits the user meant to discard when
//         focus moved to the UnitSwitcher (AC5 broke), and
//     (b) drifted the canonical value 3657.6 → 3658 via a pure
//         formatter/parser round-trip.
//   Fix: track a `dirty` flag on user keystroke; skip commit when
//   not dirty; also skip when the parsed mm equals the current
//   canonical mmValue (no-op-skip).
// --------------------------------------------------------------------------

describe('<LengthField /> — FIX 2 no-op blur is a NO-OP', () => {
  it('mount + focus + blur without typing → onChangeMm NEVER called', async () => {
    const user = userEvent.setup();
    const onChangeMm = vi.fn();
    render(
      <LengthField
        label="Width"
        mmValue={3657.6 /* the non-integer canonical mm for 12 ft */}
        system="imperial"
        onChangeMm={onChangeMm}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    // Focus the field. jsdom does not always fire focus from a
    // programmatic .focus(); use a user-driven click.
    await user.click(input);
    // Blur without typing anything.
    await user.tab();
    // Pre-fix bug would have called onChangeMm(3658) here (a drift
    // from 3657.6 → 3658 via the formatter/parser round-trip).
    expect(onChangeMm).not.toHaveBeenCalled();
  });

  it('typing then blurring with a value that ROUND-TRIPS to the same canonical mm does NOT fire onChangeMm', async () => {
    const user = userEvent.setup();
    const onChangeMm = vi.fn();
    render(
      <LengthField
        label="Width"
        mmValue={3657.6}
        system="imperial"
        onChangeMm={onChangeMm}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    // The default formatted display is "12'" or "12′ 0″" — clear
    // and re-type the SAME numeric intent. parseLength returns an
    // integer mm; since parsed mm !== canonical (integer !== float),
    // the no-op-skip predicate here is best exercised in the
    // display-round-trip variant. This test guards the mid-edit
    // canonicalisation invariant: retyping the current visible value
    // should not fire onChange.
    const current = input.value;
    await user.clear(input);
    await user.type(input, current);
    await user.tab();
    // The parsed value equals the current CANONICAL mmValue — the
    // no-op-skip fires and onChange stays quiet.
    expect(onChangeMm).not.toHaveBeenCalled();
  });

  it('typing a REAL change (different value) still commits normally', async () => {
    const user = userEvent.setup();
    const onChangeMm = vi.fn();
    render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={onChangeMm}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    await user.clear(input);
    await user.type(input, '16');
    await user.tab();
    // A real edit still commits.
    expect(onChangeMm).toHaveBeenCalledTimes(1);
    expect(onChangeMm).toHaveBeenCalledWith(4877);
  });
});

// --------------------------------------------------------------------------
// FIX 3 (review gate) — parseError must be cleared when the canonical
//   props change. Pre-fix: after an invalid input, the parent could
//   push a new mmValue (or the user could switch units) and the
//   display would re-format from the new canonical value BUT the
//   stale error message and aria-invalid=true would remain — a
//   confusing "clean field showing an error" state.
// --------------------------------------------------------------------------

describe('<LengthField /> — FIX 3 canonical resync clears parse error', () => {
  it('invalid input followed by a system prop change clears aria-invalid and the error text', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    // Trigger the error.
    await user.clear(input);
    await user.type(input, 'twelve feet');
    await user.tab();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText(
        /Enter a number, optionally with units — e\.g\., 12 or 12 ft/i,
      ),
    ).toBeInTheDocument();

    // Parent flips units — a canonical resync.
    rerender(
      <LengthField
        label="Width"
        mmValue={3658}
        system="metric"
        onChangeMm={(): void => {}}
      />,
    );

    // Error must be gone; aria-invalid must return to 'false'.
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(
      screen.queryByText(
        /Enter a number, optionally with units — e\.g\., 12 or 12 ft/i,
      ),
    ).toBeNull();
  });

  it('invalid input followed by an external mmValue update clears the error', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LengthField
        label="Width"
        mmValue={3658}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>('Width');
    await user.clear(input);
    await user.type(input, 'nope');
    await user.tab();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    // External update (e.g. undo/redo, load-from-file).
    rerender(
      <LengthField
        label="Width"
        mmValue={4877}
        system="imperial"
        onChangeMm={(): void => {}}
      />,
    );

    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input.value).toMatch(/16/);
  });
});
