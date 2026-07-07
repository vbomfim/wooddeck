/**
 * `src/ui/fields/StructureSelector.tsx` — S23 issue #45 AC1.
 *
 * ## Responsibility (single)
 *
 * Present a segmented radio-group with the two `StructureMode`
 * values (`elevated`, `floating`). On user selection:
 *
 *   1. If the chosen mode equals the current `design.structure` →
 *      NO-OP (do not dispatch — keep the store quiet).
 *   2. Otherwise dispatch a SINGLE `applyParameters` patch that
 *      atomically:
 *      - updates `design.structure`, AND
 *      - IF the current `foundation.type` is incompatible with the
 *        new `structure` per FR-030 (see `domain/compat-matrix`),
 *        re-stamps `design.foundation` to a compat-valid default
 *        via the domain-owned `defaultFoundationFor` factory
 *        (elevated → posts-on-footings with 6×6 PT No2 post + 300×300
 *        mm footing; floating → tuffblocks with the standard
 *        12×12×4 product). The defaults live in
 *        `src/domain/foundation-defaults.ts` — that is the SINGLE
 *        source of truth (S23 pair-fix — Opus #4).
 *
 * The two updates land in ONE `applyParameters` call so the store
 * NEVER passes through an invalid intermediate state — the S17
 * defensive compat check in `computeLayoutAndCheck` sees only the
 * post-switch snapshot.
 *
 * ## Why the atomic re-stamp lives HERE (not in the store)
 *
 * The design-store's `applyParameters` action is a thin adapter
 * over the application-layer use case; it accepts a patch and
 * validates the result. The "which default do I stamp?" policy is
 * a UI-level decision because:
 *
 *   - It reads a `previous` value (current post material) and
 *     picks a fallback — that's presentation logic.
 *   - Automatic re-stamping is CONTEXTUAL to this selector; a
 *     programmatic `applyParameters({structure:'floating'})` from
 *     a file-load pathway does NOT want silent re-stamping — the
 *     file-load layer expects to fail-loud on an incompatible pair.
 *
 * Encoding the policy in the store would export the re-stamp to
 * every writer; keeping it in the selector matches the S17
 * "component owns its policy" principle.
 *
 * ## Boundary (dependency rule)
 *
 * `ui → state` + `ui → domain/{model,compat-matrix}`. No touching
 * `application/`, `domain/spans`, `domain/layout` — the store
 * mediates all of those.
 *
 * ## a11y (AC7/AC8)
 *
 * Rendered as `<fieldset role="radiogroup"><legend>…</legend>
 * <input type="radio">*</fieldset>` so:
 *
 *   - Screen readers announce the group name ("Construction
 *     model") on focus of the first radio.
 *   - Tab / Shift+Tab moves in/out of the group; arrow keys move
 *     WITHIN it (native radio-group behaviour — no keyboard code
 *     of ours to maintain).
 *   - Space / Enter activate the focused radio.
 *
 * Focus ring: default browser outline styled by tokens.css
 * (`--wd-focus-outline-*`) — the same rule the S13 fields use.
 */
import { useCallback, useId, type JSX } from 'react';

import { validateFoundationCombination } from '../../domain/compat-matrix';
import { defaultFoundationFor } from '../../domain/foundation-defaults';
import type { FoundationSpec, StructureMode } from '../../domain/model';
import { useDesign, useDesignStore } from '../../state';

import '../styles/tokens.css';
import '../styles/structure-selector.css';

// ==========================================================
// Foundation re-stamp policy
// ==========================================================

/**
 * Given the CURRENT foundation and the NEXT structure mode, return
 * either:
 *   - `null` — the current foundation is already compat-valid with
 *     the new structure; leave it alone (no re-stamp).
 *   - A fresh `FoundationSpec` that IS compat-valid — the caller
 *     should include this in the `applyParameters` patch.
 *
 * Pure — no store reads, no I/O. Testable in isolation.
 *
 * ## S23 pair-fix — Opus #5: always stamp the default, no
 * "preserve previous post" branch
 *
 * The pre-pair-fix version tried to carry the outgoing foundation's
 * `post` material forward "when it had one" — e.g. a hypothetical
 * elevated + deck-blocks with a post pocket back to
 * posts-on-footings. Two problems:
 *
 *   1. It was DEAD CODE. Under the current spec every
 *      elevated↔floating switch pairs with a foundation type that
 *      also flips (posts-on-footings ↔ tuffblocks), and neither of
 *      the two floating variants (deck-blocks, tuffblocks) carries
 *      a `post` field, so `'post' in current` is ALWAYS false when
 *      this branch runs (it only fires when the CURRENT foundation
 *      is compat-INVALID with the new structure, i.e. we're
 *      switching AWAY from a floating variant).
 *   2. Its comment contradicted the S20 spec amendment. The
 *      elevated + deck-blocks post is DERIVED from the block
 *      catalog's `acceptsPost`, not user-selected — so
 *      "preserve previous post" is spec-wrong even in the
 *      hypothetical it invoked.
 *
 * Dropping the branch simplifies the function AND matches the
 * spec. The `defaultFoundationFor(type)` module owns the pinned
 * defaults (6×6 PT No2 post, 300×300 mm footing, tuffblock-12x12x4)
 * — see `src/domain/foundation-defaults.ts` for the DRY/OCP
 * rationale (Opus #4).
 */
function pickFoundationForStructure(
  current: FoundationSpec,
  next: StructureMode,
): FoundationSpec | null {
  // Ask the compat matrix directly. If the current pair is valid,
  // do nothing — preserves user's product choice on a same-side
  // flip (e.g. floating + deck-blocks stays deck-blocks when the
  // user briefly toggles to elevated and back — well, no, that
  // path re-stamps to posts-on-footings anyway; but floating +
  // tuffblocks correctly stays put on a floating→floating null
  // switch).
  const compat = validateFoundationCombination({
    structure: next,
    foundation: current,
  });
  if (compat.ok) return null;

  // Re-stamp to the pinned default for the target structure. The
  // domain-owned defaults module is the single source of truth —
  // updating a default (post size, footing dim, preferred SKU) is
  // a one-file change.
  return next === 'elevated'
    ? defaultFoundationFor('posts-on-footings')
    : defaultFoundationFor('tuffblocks');
}

// ==========================================================
// Component
// ==========================================================

/**
 * `<StructureSelector />` — see the module header for the atomic
 * re-stamp contract. Reads the current `design.structure` from the
 * design-store; writes back via `applyParameters` on user input.
 */
export function StructureSelector(): JSX.Element {
  const design = useDesign();
  const groupId = useId();

  const handleChange = useCallback(
    (next: StructureMode) => {
      if (next === design.structure) return; // no-op — already selected

      // Build the patch as a mutable draft, then assert back to
      // the readonly `DeepPartial<DeckDesign>` — the domain model
      // marks every field readonly so we can't write directly to
      // the typed patch.
      interface MutablePatch {
        structure?: StructureMode;
        foundation?: FoundationSpec;
      }
      const draft: MutablePatch = { structure: next };
      const restamp = pickFoundationForStructure(design.foundation, next);
      if (restamp !== null) {
        draft.foundation = restamp;
      }
      // SINGLE dispatch — atomic w.r.t. `computeLayoutAndCheck`.
      useDesignStore.getState().applyParameters(draft);
    },
    [design.structure, design.foundation],
  );

  return (
    <fieldset
      className="wd-structure-selector"
      role="radiogroup"
      aria-labelledby={`${groupId}-legend`}
    >
      <legend id={`${groupId}-legend`} className="wd-structure-selector__legend">
        Construction model
      </legend>
      <label className="wd-structure-selector__option">
        <input
          type="radio"
          name={`${groupId}-structure`}
          value="elevated"
          checked={design.structure === 'elevated'}
          onChange={() => {
            handleChange('elevated');
          }}
        />
        <span>Elevated</span>
      </label>
      <label className="wd-structure-selector__option">
        <input
          type="radio"
          name={`${groupId}-structure`}
          value="floating"
          checked={design.structure === 'floating'}
          onChange={() => {
            handleChange('floating');
          }}
        />
        <span>Floating</span>
      </label>
    </fieldset>
  );
}
