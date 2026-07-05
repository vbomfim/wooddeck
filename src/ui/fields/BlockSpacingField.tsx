/**
 * `src/ui/fields/BlockSpacingField.tsx` — feat/block-spacing.
 *
 * ## Responsibility (single)
 *
 * When `design.structure === 'floating'` AND `design.floatingFraming
 * === 'joists-on-blocks'` (Method B), render a length input for
 * `foundation.blockSpacingMm` — the user-controllable distance
 * between adjacent foundation blocks (grid PITCH, mm). Dispatch
 * commits via `applyParameters({ foundation: { blockSpacingMm } })`.
 *
 * When EITHER precondition fails (elevated construction, Method A
 * framing, or a non-block foundation) render NOTHING (return
 * null). The field is meaningless outside Method B; hiding — not
 * disabling — matches the S23 idiom for structure-scoped controls.
 *
 * ## Default surface
 *
 * When `design.foundation.blockSpacingMm` is UNSET the input
 * displays `DEFAULT_METHOD_B_BLOCK_SPACING_MM` (1220 mm). Editing
 * the field ALWAYS commits an explicit value; the user cannot
 * "restore default" via the input (would require a Clear button).
 * A future enhancement can add one; the MVP field is write-only
 * relative to the default.
 *
 * ## Boundary (dependency rule)
 *
 * `ui → state` — the state barrel is the sanctioned seam. The
 * `DEFAULT_METHOD_B_BLOCK_SPACING_MM` value is re-exported by
 * `state/index.ts` from its source in
 * `domain/layout/floating/floating-layout.ts`, so this field can
 * display a default that is guaranteed identical to what
 * `computeMethodB` uses at layout time — WITHOUT crossing the
 * `ui → domain/layout` boundary directly (forbidden by
 * dep-cruiser rule `ui-no-domain-layout`).
 */
import { useCallback, type JSX } from 'react';

import type { DeckDesign } from '../../domain/model';
import {
  DEFAULT_METHOD_B_BLOCK_SPACING_MM,
  useDesign,
  useDesignStore,
  useUiUnits,
} from '../../state';

import { LengthField } from './LengthField';

/**
 * Narrow `DeckDesign` foundation types to the block-carrying
 * variants that accept `blockSpacingMm`. `posts-on-footings` does
 * not carry the field.
 */
function hasBlockFoundation(
  design: DeckDesign,
): design is DeckDesign & {
  foundation: Extract<
    DeckDesign['foundation'],
    { type: 'deck-blocks' | 'tuffblocks' }
  >;
} {
  return (
    design.foundation.type === 'deck-blocks' ||
    design.foundation.type === 'tuffblocks'
  );
}

/**
 * `<BlockSpacingField />` — see module header for the visibility
 * contract. Reads the current `design.foundation.blockSpacingMm`
 * (with fallback to the default) and writes back via
 * `applyParameters` on user commit. Uses the shared `LengthField`
 * idiom for imperial/metric parsing + inline error display.
 */
export function BlockSpacingField(): JSX.Element | null {
  const design = useDesign();
  const units = useUiUnits();

  const handleChange = useCallback((blockSpacingMm: number) => {
    useDesignStore
      .getState()
      .applyParameters({ foundation: { blockSpacingMm } });
  }, []);

  // Visibility gate — Method B only. Return null for elevated,
  // Method A, or non-block foundations. Returning null (not an
  // empty div) keeps the DOM lean and the a11y tree focused.
  if (design.structure !== 'floating') return null;
  if (design.floatingFraming !== 'joists-on-blocks') return null;
  if (!hasBlockFoundation(design)) return null;

  const currentSpacingMm =
    design.foundation.blockSpacingMm ?? DEFAULT_METHOD_B_BLOCK_SPACING_MM;

  return (
    <LengthField
      label="Block spacing"
      mmValue={currentSpacingMm}
      system={units}
      hint="Distance between adjacent foundation blocks (grid pitch)."
      onChangeMm={handleChange}
    />
  );
}
