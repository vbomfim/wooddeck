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
import { useCallback, useId, useMemo, useState, type JSX } from 'react';

import type { DeckDesign } from '../../domain/model';
import {
  MAX_BLOCK_ROWS_HINT,
  MIN_BLOCK_ROWS_HINT,
  useDesign,
  useDesignStore,
  useLayout,
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
  const layout = useLayout();
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  // The current store-side hint (or undefined). Local raw string
  // reflects it initially; user typing updates `rawInput`
  // directly so the DOM value reflects EXACTLY what the user
  // typed (no controlled-input desync).
  const storeHint = hasBlockFoundation(design)
    ? design.foundation.blockRowsHint
    : undefined;

  // Code Review Fix #2 — when `blockRowsHint` is UNSET, display
  // the ACTUAL current Method-B row count derived from the
  // rendered layout (unique block +z positions). Pre-fix the
  // field showed a hardcoded starter integer ("3") even when
  // the layout was drawing 4 rows (12×12) / 7 rows (16×24) — a
  // user "confirming" 3 would SILENTLY reduce support. The
  // displayed number MUST equal the rendered row count so the
  // user can never be lied to about the current state.
  //
  // Method B guarantees ONE column per joist and a REGULAR grid
  // along +z (see `resolveMethodBGrid`), so `uniqueZ.size`
  // equals the row count. `useMemo` keys on the block-layer
  // reference so the calculation only re-runs when the layout
  // recomputes.
  const effectiveRowCountFromLayout = useMemo(() => {
    let unique: Set<number> | null = null;
    for (const m of layout.members) {
      if (m.kind !== 'block') continue;
      if (unique === null) unique = new Set<number>();
      unique.add(m.position.z);
    }
    return unique === null ? null : unique.size;
  }, [layout.members]);

  // Effective displayed number when the hint is absent — the
  // layout's actual row count, clamped into the schema-legal
  // range (fail-safe against a degenerate layout with < MIN
  // blocks). Falls back to `MIN_BLOCK_ROWS_HINT + 1` = 3 ONLY
  // when there are no block members (e.g. the visibility gate
  // is about to return null anyway).
  const effectiveDisplayCount =
    effectiveRowCountFromLayout !== null && effectiveRowCountFromLayout >= 1
      ? Math.max(
          MIN_BLOCK_ROWS_HINT,
          Math.min(MAX_BLOCK_ROWS_HINT, effectiveRowCountFromLayout),
        )
      : MIN_BLOCK_ROWS_HINT + 1;
  const initialRaw = String(storeHint ?? effectiveDisplayCount);
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
  // Code Review Fix #2: the effective-count re-sync is ALSO
  // tracked — a layout recompute (deck resized while the field
  // is not being typed into) MUST update the displayed value
  // when `blockRowsHint` is unset. We combine the two signals
  // into a single "displayed number the store implies" and
  // compare against that.
  //
  // Ref: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const displayedFromStore = storeHint ?? effectiveDisplayCount;
  const [lastSeenDisplayed, setLastSeenDisplayed] = useState<number>(
    displayedFromStore,
  );
  if (displayedFromStore !== lastSeenDisplayed) {
    setLastSeenDisplayed(displayedFromStore);
    if (rawInput !== '') {
      const next = String(displayedFromStore);
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
