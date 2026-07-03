/**
 * `side-panels.test.tsx` — S14 issue #15 §2 integration test.
 *
 * Mounts the `<SidePanels />` composition (all four panels
 * together) and asserts:
 *
 *   - Every panel's `<h2>` renders (the AppShell rightPanel
 *     aside landmark invariant — see AppShell test).
 *   - Panels do not clobber each other (unique headings; the
 *     count matches).
 *   - Toggling a layer AND clicking a preset button in the
 *     LayerTogglePanel does NOT affect the BOM row count (the
 *     bill of materials must not re-derive from ui-store).
 *
 * This test is `panels.integration`-style — it does NOT mount
 * the r3f Canvas (jsdom can't) and does NOT do full E2E.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { resetDesignStoreForTests } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { SidePanels } from './SidePanels';

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({
      units: 'imperial',
      storageBanner: null,
      cameraPreset: 'orbit',
    });
  });
});

afterEach(() => {
  cleanup();
});

describe('<SidePanels /> — integration', () => {
  it('renders all four panel headings (Layers & view, Warnings, BOM, Save & export)', () => {
    render(<SidePanels />);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    // Every panel MUST provide its own <h2> — 4 total.
    expect(h2s).toHaveLength(4);
    const texts = h2s.map((h) => h.textContent?.toLowerCase().trim() ?? '');
    expect(texts.some((t) => t.includes('layers'))).toBe(true);
    expect(texts.some((t) => t.startsWith('warnings'))).toBe(true);
    expect(texts.some((t) => t.includes('bill of materials'))).toBe(true);
    expect(texts.some((t) => t.includes('save') && t.includes('export'))).toBe(true);
  });

  it('renders panels in the ticket order (toggles → warnings → BOM → export)', () => {
    render(<SidePanels />);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    // documentPosition — first heading must come first in DOM.
    expect(h2s[0]?.textContent?.toLowerCase()).toMatch(/layers/);
    expect(h2s[1]?.textContent?.toLowerCase()).toMatch(/^warnings/);
    expect(h2s[2]?.textContent?.toLowerCase()).toMatch(/bill of materials/);
    expect(h2s[3]?.textContent?.toLowerCase()).toMatch(/save.*export/);
  });

  it('toggling a layer in LayerTogglePanel does NOT change BOM row count', async () => {
    const user = userEvent.setup();
    render(<SidePanels />);

    const rowsBefore = screen.getAllByRole('row').length;
    await user.click(screen.getByRole('checkbox', { name: 'Joists' }));
    const rowsAfter = screen.getAllByRole('row').length;

    expect(rowsAfter).toBe(rowsBefore);
  });

  it('changing camera preset in LayerTogglePanel does NOT change BOM row count', async () => {
    const user = userEvent.setup();
    render(<SidePanels />);

    const rowsBefore = screen.getAllByRole('row').length;
    await user.click(screen.getByRole('button', { name: 'Iso' }));
    const rowsAfter = screen.getAllByRole('row').length;

    expect(rowsAfter).toBe(rowsBefore);
    expect(useUiStore.getState().cameraPreset).toBe('iso');
  });
});
