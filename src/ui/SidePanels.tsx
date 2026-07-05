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
 * ## Why each panel is wrapped in a `<PanelErrorBoundary>` (S24 UAT FIX 0(b))
 *
 * A live UAT for a 24 ft-wide deck exposed a critical crash:
 * `deriveBom` (called inside `<BomPanel>`'s render `useMemo`) threw
 * an over-length-cut error, which propagated up through the WHOLE
 * render tree because no boundary sat between the panel and the
 * app root. Result: white screen — parameter panel, disclaimer,
 * and 3D scene all lost.
 *
 * The domain fix (splicing over-length cuts) removed THAT crash;
 * `<PanelErrorBoundary>` catches any FUTURE panel-compute
 * exception. Each panel is wrapped INDIVIDUALLY (not one boundary
 * around all four) so a bug in the BOM panel does NOT knock out
 * the export menu or the warnings panel — defense-in-depth on a
 * per-panel granularity.
 *
 * ## S15 (issue #16) addition — 2D plan view
 *
 * `<PlanView2D />` is appended as the FIFTH section (below export
 * menu). Placement decision + rationale:
 *
 *   - Ticket suggests "within the right tools <aside> (below the
 *     existing tools)". SidePanels IS that aside's content, so
 *     appending a fifth section here is the literal fulfillment.
 *   - Concurrency: AppShell.tsx is being modified by S23
 *     (MigrationToast). Mounting here — NOT in AppShell — means
 *     the S15 branch adds ZERO lines to AppShell, so the S23
 *     rebase is a clean fast-forward with no manual merge.
 *   - Defense-in-depth: wrapping in a `<PanelErrorBoundary>` is
 *     consistent with every other panel and prevents any
 *     projection-math bug in a future revision from taking down
 *     the whole side stack.
 *
 * ## Boundary
 *
 *   - `./LayerTogglePanel` / `./WarningsPanel` / `./BomPanel` /
 *     `./ExportMenu` / `./PanelErrorBoundary` / `./PlanView2D` —
 *     sibling ui modules.
 *   - NO state / domain / etc. — this is pure composition.
 */
import type { JSX } from 'react';

import { BomPanel } from './BomPanel';
import { ExportMenu } from './ExportMenu';
import { LayerTogglePanel } from './LayerTogglePanel';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { PlanView2D } from './PlanView2D';
import { WarningsPanel } from './WarningsPanel';

import './styles/tokens.css';
import './styles/side-panels.css';

/**
 * The right-panel composition. Ordered: view controls → warnings
 * → BOM → export → plan view. Rationale: users tweak view first,
 * react to warnings, review the material list, then save/export;
 * the plan view sits LAST as a supplementary reference (§16
 * "read-only" — no need for interaction priority).
 */
export function SidePanels(): JSX.Element {
  return (
    <div className="wd-side-panels">
      <PanelErrorBoundary>
        <LayerTogglePanel />
      </PanelErrorBoundary>
      <PanelErrorBoundary>
        <WarningsPanel />
      </PanelErrorBoundary>
      <PanelErrorBoundary>
        <BomPanel />
      </PanelErrorBoundary>
      <PanelErrorBoundary>
        <ExportMenu />
      </PanelErrorBoundary>
      <PanelErrorBoundary>
        <PlanView2D />
      </PanelErrorBoundary>
    </div>
  );
}
