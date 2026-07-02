import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the "Hello wooddeck" heading (AC1: scaffold boots with a visible page)', () => {
    render(<App />);
    const heading = screen.getByRole('heading', { level: 1, name: /hello wooddeck/i });
    expect(heading).toBeInTheDocument();
  });

  it('renders the non-dismissable planning-aid disclaimer (spec US3 AC2)', () => {
    render(<App />);
    // Disclaimer copy is the exact spec-mandated wording so users can never
    // mistake the tool for an engineering document.
    expect(
      screen.getByText(
        /planning aid, not an engineering document — consult a licensed professional or your local building department/i,
      ),
    ).toBeInTheDocument();
  });
});
