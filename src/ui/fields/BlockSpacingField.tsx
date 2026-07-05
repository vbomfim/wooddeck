/**
 * `src/ui/fields/BlockSpacingField.tsx` — feat/block-spacing.
 *
 * ## Responsibility (single)
 *
 * When `design.structure === 'floating'` AND `design.floatingFraming
 * === 'joists-on-blocks'` (Method B), render a length input for
 * `foundation.blockSpacingMm` — the user-controllable distance
 * between adjacent block ROWS ALONG each joist (mm). This is the
 * span-relevant dimension that bounds the joist span between
 * supports (the pitch is what `over-span-joist` in
 * `span-check.ts` measures against the IRC allowable). Block
 * COLUMNS are pinned to the joist x-centers — one column per
 * joist, no user knob (a joist that flew unsupported was the
 * fix/joists-on-blocks-flying UAT bug). Dispatch commits via
 * `applyParameters({ foundation: { blockSpacingMm } })`.
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
 *
 * ## HIGH #2 (review) — clamp AT the input boundary
 *
 * `MIN_BLOCK_SPACING_MM` / `MAX_BLOCK_SPACING_MM` are re-exported
 * through the state barrel for the same reason. `handleChange`
 * clamps the parsed value into the schema-legal range BEFORE
 * dispatching. Pre-fix, an out-of-range value survived the
 * dispatch (layout would still clamp for geometry, but the STORED
 * design was poisoned) — the next `serialize` + `deserialize`
 * round-trip would then throw `schema-validation-failed` on a
 * design the user believed was fine.
 */
import { useCallback, type JSX } from 'react';

import type { DeckDesign } from '../../domain/model';
import {
  DEFAULT_METHOD_B_BLOCK_SPACING_MM,
  MAX_BLOCK_SPACING_MM,
  MIN_BLOCK_SPACING_MM,
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
 * HIGH #2 (review) — clamp a user-typed spacing into the
 * schema-legal range so the STORED design is always
 * round-trip-safe. Non-finite (defensive — `LengthField` already
 * rejects) → default.
 */
function clampSpacingForDispatch(spacingMm: number): number {
  if (!Number.isFinite(spacingMm)) return DEFAULT_METHOD_B_BLOCK_SPACING_MM;
  if (spacingMm < MIN_BLOCK_SPACING_MM) return MIN_BLOCK_SPACING_MM;
  if (spacingMm > MAX_BLOCK_SPACING_MM) return MAX_BLOCK_SPACING_MM;
  return spacingMm;
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
    // HIGH #2 (review) — clamp BEFORE dispatch so the STORED
    // design is always within the schema range. Prevents a
    // save-then-reload trap where a layout-clamped-but-stored-raw
    // value throws on the next `deserialize`.
    const safe = clampSpacingForDispatch(blockSpacingMm);
    useDesignStore
      .getState()
      .applyParameters({ foundation: { blockSpacingMm: safe } });
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
      hint="Distance between block rows along each joist (bounds the joist span between supports)."
      onChangeMm={handleChange}
    />
  );
}
