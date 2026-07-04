/**
 * `FoundationRow.test.tsx` — S24 issue #46 AC4.
 *
 * ## Coverage (S24)
 *
 *   - AC4: renders a `<tr>` with `<th scope="row">` (displayName)
 *     + `<td>` (integer count).
 *   - textContent-only: displayName is rendered as text (no
 *     `dangerouslySetInnerHTML`) — the catalog string may contain
 *     Unicode primes but must NOT be interpreted as HTML.
 *   - Component is composable inside any `<table><tbody>` — the
 *     test wraps it in a minimal table so `<tr>` is legal per HTML5.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { BomSection_Foundation } from '../../domain/bom/derive-bom';

import { FoundationRow } from './FoundationRow';

afterEach(() => {
  cleanup();
});

/**
 * Wrap the `<tr>` in a minimal `<table>` — a bare `<tr>` is not
 * legal top-level HTML (browsers hoist it into a `<tbody>`), and
 * testing-library / jsdom will silently strip it. The wrapper
 * makes the test faithful to how BomPanel uses the component.
 */
function renderRow(section: BomSection_Foundation) {
  return render(
    <table>
      <tbody>
        <FoundationRow section={section} />
      </tbody>
    </table>,
  );
}

const TUFFBLOCK: BomSection_Foundation = {
  productId: 'tuffblock-12x12x4',
  displayName: 'TuffBlock 12″ × 12″ × 4″ instant foundation',
  count: 27,
};

describe('<FoundationRow /> — AC4 row structure', () => {
  it('renders one <tr> with a <th scope="row"> + a <td>', () => {
    renderRow(TUFFBLOCK);
    const rows = screen.getAllByRole('row');
    // Table sometimes includes a header row placeholder — filter
    // to the row with the product name.
    const productRow = rows.find((r) => (r.textContent ?? '').includes('TuffBlock'));
    expect(productRow).toBeDefined();
    const th = productRow!.querySelector('th[scope="row"]');
    expect(th).not.toBeNull();
    const td = productRow!.querySelector('td');
    expect(td).not.toBeNull();
  });

  it('displayName is rendered inside the row-header <th>', () => {
    renderRow(TUFFBLOCK);
    const th = screen
      .getAllByRole('row')
      .find((r) => (r.textContent ?? '').includes('TuffBlock'))!
      .querySelector('th[scope="row"]');
    expect(th?.textContent).toBe(TUFFBLOCK.displayName);
  });

  it('count is rendered inside the <td> as a plain integer', () => {
    renderRow(TUFFBLOCK);
    const td = screen
      .getAllByRole('row')
      .find((r) => (r.textContent ?? '').includes('TuffBlock'))!
      .querySelector('td');
    expect(td?.textContent).toBe('27');
  });
});

describe('<FoundationRow /> — textContent-only (XSS defence)', () => {
  it('renders a displayName with HTML metacharacters as literal text (no injection)', () => {
    // A hostile catalog entry (defense in depth — the catalog is
    // static, but the sanitization contract must hold either way).
    const hostile: BomSection_Foundation = {
      productId: 'tuffblock-12x12x4',
      displayName: '<img src=x onerror="alert(1)">',
      count: 1,
    };
    renderRow(hostile);
    // The <th> textContent must equal the raw string; no <img>
    // must appear in the DOM.
    const th = screen
      .getAllByRole('row')
      .find((r) => (r.textContent ?? '').includes('<img'))!
      .querySelector('th[scope="row"]');
    expect(th?.textContent).toBe(hostile.displayName);
    // No script/img child anywhere.
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
});
