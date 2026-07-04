/**
 * `src/ui/SidePanels.tsx` — S14 issue #15 §2 wrapper.
 *
 * Composes the four right-panel sections into a single vertical
 * stack passed to AppShell's `rightPanel` slot. Each nested
 * `<section>` carries its own `<h2>`, satisfying the AppShell
 * landmark invariant.
 *
 * ## Why a wrapper (not inline in App.tsx)
 *
 * Keeping the composition in `ui/` (not `App.tsx`) means every
 * panel test can mount `<SidePanels />` and cover the integration
 * concern (side-panels.test.tsx) without dragging in the full
 * application root. App.tsx stays the composition-root and just
 * places `<SidePanels />` in the slot.
 *
 * ## Boundary
 *
 *   - `./LayerTogglePanel` / `./WarningsPanel` / `./BomPanel` /
 *     `./ExportMenu` — sibling ui modules.
 *   - NO state / domain / etc. — this is pure composition.
 */
import type { JSX } from 'react';

import { BomPanel } from './BomPanel';
import { ExportMenu } from './ExportMenu';
import { LayerTogglePanel } from './LayerTogglePanel';
import { WarningsPanel } from './WarningsPanel';

import './styles/tokens.css';
import './styles/side-panels.css';

/**
 * The right-panel composition. Ordered: view controls → warnings
 * → BOM → export. Rationale: users tweak view first, react to
 * warnings, review the material list, then save/export.
 */
export function SidePanels(): JSX.Element {
  return (
    <div className="wd-side-panels">
      <LayerTogglePanel />
      <WarningsPanel />
      <BomPanel />
      <ExportMenu />
    </div>
  );
}
