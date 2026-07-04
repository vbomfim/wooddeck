/**
 * `src/application/apply-remediation.ts` — S16 issue #38.
 *
 * ## Purpose
 *
 * Thin use-case that converts a `RemediationOption.patch`
 * (discriminated union) into a `DeepPartial<DeckDesign>` and
 * delegates to `applyParameters`. Every prototype-pollution +
 * unknown-key + LayoutError guarantee `applyParameters` provides is
 * INHERITED unchanged.
 *
 * ## Why a delegator (not a direct `set(...)`)
 *
 * The state-store's `applyParameters` action already:
 *   - deep-merges the patch into the current design,
 *   - re-runs `computeLayout` + `spanCheck` for the merged design,
 *   - throws the correct typed errors on failure,
 *   - returns a canonical `DesignBundle`.
 *
 * A remediation is SEMANTICALLY a specific kind of parameter edit
 * (with a nicer name for the user). Duplicating any of that
 * pipeline here would double the surface area for prototype-
 * pollution / dimension-guard / autosave-debounce discipline; a
 * pass-through delegator keeps ONE seam.
 *
 * ## Type-safe patch mapping
 *
 * The patch discriminant is exhaustively narrowed via a `switch`
 * with a `never` default — a new `RemediationKind` fail-compiles
 * the switch, guaranteeing the ui + application layers cannot
 * drift.
 *
 * ## Error contract
 *
 * WHATEVER `applyParameters` throws, `applyRemediation` throws
 * unchanged. No catch, no wrap, no rewrite. That's the whole
 * point of the delegator pattern (AC8).
 */

import type { RemediationOption } from '../domain/spans';
import type { DeckDesign } from '../domain/model';
import type { SpanTable } from '../domain/spans';

import { applyParameters } from './apply-parameters';
import type { DeepPartial, DesignBundle } from './types';

/**
 * Convert a `RemediationOption.patch` (discriminated union) into a
 * `DeepPartial<DeckDesign>` the state's `applyParameters` deep-merge
 * consumes. Every branch produces a MINIMAL patch — only the leaf
 * that changed — so a future domain-model addition doesn't require
 * touching every remediation kind.
 *
 * @internal — exported for unit-test symmetry only. Consumers
 *             use `applyRemediation`.
 */
export function patchFromRemediation(
  option: RemediationOption,
): DeepPartial<DeckDesign> {
  const { patch } = option;
  switch (patch.kind) {
    case 'reduce-joist-spacing':
      return { joist: { spacingMm: patch.newSpacingMm } };
    case 'upgrade-joist-size':
      return { joist: { material: { nominal: patch.newNominal } } };
    case 'upgrade-beam-size':
      return { beam: { material: { nominal: patch.newNominal } } };
    case 'change-joist-species':
      return { joist: { material: { species: patch.newSpecies } } };
    case 'change-beam-species':
      return { beam: { material: { species: patch.newSpecies } } };
    /* c8 ignore next 6 */
    default: {
      // Compile-time exhaustiveness. A new RemediationKind
      // fail-compiles here — no runtime throw, matching the
      // spanCheck NEVER-throws discipline.
      const _exhaustive: never = patch;
      void _exhaustive;
      return {};
    }
  }
}

/**
 * Apply a remediation option to the current design. Delegates to
 * `applyParameters` — inheriting its prototype-pollution defence,
 * unknown-key rejection, and `LayoutError` propagation unchanged.
 *
 * @param current The design AS OF the last accepted edit.
 * @param option  The `RemediationOption` the user selected. Must
 *                come from a call to `computeRemediations` — the
 *                shape is validated at the domain boundary.
 * @param table   The `SpanTable` the store owns (same instance the
 *                store passes to `applyParameters`).
 *
 * @throws {ApplyParametersError} — from `applyParameters` (unchanged).
 * @throws {LayoutError} — from downstream `computeLayout` (unchanged).
 */
export function applyRemediation(
  current: DeckDesign,
  option: RemediationOption,
  table: SpanTable,
): DesignBundle {
  return applyParameters(current, patchFromRemediation(option), table);
}
