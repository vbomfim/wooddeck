/**
 * `src/ui/fields/BlockRowCountField.tsx` — feat/block-count-per-joist.
 *
 * ## Responsibility (single)
 *
 * When `design.structure === 'floating'` AND
 * `design.floatingFraming === 'joists-on-blocks'` (Method B),
 * render an INTEGER stepper for `foundation.blockRowsHint` — the
 * user-controllable NUMBER of block ROWS along each joist. This
 * is the span-relevant control: more rows → shorter joist support
 * span → over-span-joist warning clears; fewer rows → longer
 * span → warning fires.
 *
 * Rows are spread EVENLY end-to-end at layout time
 * (`computeAxisCenters`) — outer rows at ±length/2, interior rows
 * at equal spacing. Block COLUMNS are pinned to joist x-centers
 * (one column per joist) — see FR-035 / no-flying-joists
 * invariant. Total blocks = `numJoists × rowsHint`.
 *
 * When EITHER precondition fails (elevated construction, Method A
 * framing, or a non-block foundation) render NOTHING (return
 * null). The field is meaningless outside Method B; hiding — not
 * disabling — matches the S23 idiom for structure-scoped controls.
 *
 * ## Rationale — replacing `BlockSpacingField`
 *
 * The prior `BlockSpacingField` (feat/block-spacing) exposed the
 * DISTANCE between block rows. UAT feedback: users think in
 * "how many blocks under each joist", not in "how many
 * millimeters between them". Combined with the default 2-row
 * floor tripping every user on a large deck (over-span → red),
 * the DISTANCE control was hard to reason about. The COUNT
 * control lets the user pick a physical support density they
 * understand ("3 blocks", "4 blocks") and the layout spreads
 * them evenly.
 *
 * `blockSpacingMm` remains in the model + schema for backwards
 * compatibility (a design saved under the previous model still
 * loads), but is IGNORED by the layout when `blockRowsHint` is
 * set (see `resolveMethodBGrid` — priority
 * `blockRowsHint > blockSpacingMm > default`).
 *
 * ## Default surface
 *
 * When `design.foundation.blockRowsHint` is UNSET the input
 * displays the count the current layout is producing — derived
 * from `resolveMethodBGrid` (either the legacy spacing path or
 * the absent-hint default). This means the displayed count
 * matches the number of block ROWS the user sees in the 3D
 * scene at ALL times. Editing the field commits an explicit
 * `blockRowsHint`.
 *
 * ## Clamp AT the input boundary (input-boundary safety)
 *
 * The schema pins `blockRowsHint` to `[2, 100]`. This field
 * clamps the parsed value into that range BEFORE dispatching so
 * a save/reload cannot trap the user with a schema-invalid
 * value. `MIN_BLOCK_ROWS_HINT` / `MAX_BLOCK_ROWS_HINT` are
 * consumed via the state barrel.
 *
 * ## Boundary (dependency rule)
 *
 * `ui → state` — the state barrel is the sanctioned seam. The
 * schema bounds + the cap `MAX_METHOD_B_BLOCK_COUNT` are re-
 * exported by `state/index.ts`, so this field can display a
 * safe stepper range WITHOUT crossing the `ui → domain/layout`
 * boundary directly (forbidden by dep-cruiser rule
 * `ui-no-domain-layout`).
 */
import { useCallback, useId, useState, type JSX } from 'react';

import type { DeckDesign } from '../../domain/model';
import {
  MAX_BLOCK_ROWS_HINT,
  MIN_BLOCK_ROWS_HINT,
  useDesign,
  useDesignStore,
} from '../../state';

/**
 * Narrow `DeckDesign` foundation types to the block-carrying
 * variants that accept `blockRowsHint`. `posts-on-footings` does
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
 * Clamp a user-typed integer count into the schema-legal range
 * so the STORED design is always round-trip-safe. Non-finite /
 * non-numeric → minimum (fail-safe — 2 rows is the perimeter
 * floor and never over-constrains).
 */
function clampCountForDispatch(count: number): number {
  if (!Number.isFinite(count)) return MIN_BLOCK_ROWS_HINT;
  const asInt = Math.floor(count);
  if (asInt < MIN_BLOCK_ROWS_HINT) return MIN_BLOCK_ROWS_HINT;
  if (asInt > MAX_BLOCK_ROWS_HINT) return MAX_BLOCK_ROWS_HINT;
  return asInt;
}

/**
 * `<BlockRowCountField />` — see module header for the
 * visibility contract. Reads the current
 * `design.foundation.blockRowsHint` (with fallback to a starter
 * integer) and writes back via `applyParameters` on user commit.
 *
 * ## Input state pattern
 *
 * The input is UNCONTROLLED-style: a local `rawInput` string
 * tracks what the user is typing; a `useEffect` re-syncs the
 * local state ONLY when the store's `blockRowsHint` changes
 * behind the field (e.g. remediation applies from elsewhere).
 * This avoids the "type '6', get '36'" bug from a naive
 * controlled input where the store-fallback value re-injects
 * itself into `value` between keystrokes.
 */
export function BlockRowCountField(): JSX.Element | null {
  const design = useDesign();
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  // The current store-side hint (or undefined). Local raw string
  // reflects it initially; user typing updates `rawInput`
  // directly so the DOM value reflects EXACTLY what the user
  // typed (no controlled-input desync).
  const storeHint = hasBlockFoundation(design)
    ? design.foundation.blockRowsHint
    : undefined;
  const initialRaw = String(storeHint ?? MIN_BLOCK_ROWS_HINT + 1);
  const [rawInput, setRawInput] = useState<string>(initialRaw);

  // Re-sync when the store's hint changes from OUTSIDE this
  // field (e.g. remediation, undo, reset). Follows the React
  // docs pattern "Storing information from previous renders" —
  // setState during render is fine when it triggers a re-render
  // with the corrected state before painting. We compare on
  // stringified hint so a "field wrote 6 → store carries 6"
  // no-op does not fight the user's cursor. When the user is
  // in the middle of clearing the input (rawInput === ''), we
  // do NOT force a re-sync — that would repaint the last
  // committed value while the user is still typing.
  //
  // Ref: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [lastSeenStoreHint, setLastSeenStoreHint] = useState<
    number | undefined
  >(storeHint);
  if (storeHint !== lastSeenStoreHint) {
    setLastSeenStoreHint(storeHint);
    if (rawInput !== '') {
      const next = String(storeHint ?? MIN_BLOCK_ROWS_HINT + 1);
      if (next !== rawInput) setRawInput(next);
    }
  }

  const handleChange = useCallback((rowsHint: number) => {
    const safe = clampCountForDispatch(rowsHint);
    useDesignStore
      .getState()
      .applyParameters({ foundation: { blockRowsHint: safe } });
  }, []);

  // Visibility gate — Method B only. Return null for elevated,
  // Method A, or non-block foundations. Returning null (not an
  // empty div) keeps the DOM lean and the a11y tree focused.
  if (design.structure !== 'floating') return null;
  if (design.floatingFraming !== 'joists-on-blocks') return null;
  if (!hasBlockFoundation(design)) return null;

  return (
    <div className="wd-block-row-count-field">
      <label className="wd-block-row-count-field__label" htmlFor={inputId}>
        Blocks along each joist
      </label>
      <input
        id={inputId}
        className="wd-block-row-count-field__input"
        type="number"
        inputMode="numeric"
        step={1}
        min={MIN_BLOCK_ROWS_HINT}
        max={MAX_BLOCK_ROWS_HINT}
        value={rawInput}
        onChange={(e): void => {
          const raw = e.target.value;
          setRawInput(raw);
          if (raw === '') return; // wait for a valid number
          const parsed = Number.parseInt(raw, 10);
          if (!Number.isFinite(parsed)) return;
          handleChange(parsed);
        }}
        aria-describedby={hintId}
      />
      <p id={hintId} className="wd-block-row-count-field__hint">
        Number of blocks under each joist, spread evenly end-to-end.
      </p>
    </div>
  );
}
