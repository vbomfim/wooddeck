/**
 * `src/ui/fields/FloatingFramingSelector.tsx` — S26
 * (fix/floating-framing-joists).
 *
 * ## Responsibility (single)
 *
 * When `design.structure === 'floating'`, present a segmented
 * radio-group with the two `FloatingFraming` values:
 *
 *   - `'beams-and-joists'` (DEFAULT) — 2 rim beams + N joists
 *     resting on a supporting block grid. Elevated framing on
 *     blocks.
 *   - `'joists-on-blocks'` — joists rest directly on blocks; no
 *     beam layer.
 *
 * When `design.structure === 'elevated'`, the selector renders
 * NOTHING (returns null). Elevated framing is fixed (elevated has
 * no user-selectable framing method — beams+joists+posts+footings
 * is the only model). Hiding — not disabling — matches the
 * S23 idiom for structure-scoped controls.
 *
 * ## Boundary (dependency rule)
 *
 * `ui → state` + `ui → domain/model` (type-only). No touching
 * `application/`, `domain/spans`, `domain/layout` — the store
 * mediates all of those.
 *
 * ## a11y
 *
 * Rendered as `<fieldset role="radiogroup"><legend>…</legend>
 * <input type="radio">*</fieldset>` — same idiom as
 * `StructureSelector`. Screen readers announce "Floating framing"
 * on focus of the first radio; native arrow-key navigation moves
 * within the group; space/enter activate.
 */
import { useCallback, useId, type JSX } from 'react';

import type { FloatingFraming } from '../../domain/model';
import { useDesign, useDesignStore } from '../../state';

import '../styles/tokens.css';
import '../styles/structure-selector.css';

/**
 * `<FloatingFramingSelector />` — see module header for the
 * visibility contract. Reads the current `design.floatingFraming`
 * from the design-store; writes back via `applyParameters` on user
 * input. A same-value click is a no-op (matches the S23
 * StructureSelector pattern — "don't run the layout engine when
 * nothing changed").
 */
export function FloatingFramingSelector(): JSX.Element | null {
  const design = useDesign();
  const groupId = useId();

  const handleChange = useCallback(
    (next: FloatingFraming) => {
      if (next === design.floatingFraming) return; // no-op
      useDesignStore.getState().applyParameters({ floatingFraming: next });
    },
    [design.floatingFraming],
  );

  // Visibility gate — the selector is meaningful only for
  // floating construction. Returning null (not an empty fieldset)
  // keeps the DOM lean and the a11y tree free of a stray
  // radiogroup landmark. Downstream layout code sees
  // `design.floatingFraming` on every design (elevated included
  // — the field is REQUIRED per S26 model.ts doc-block) but
  // ignores its value for elevated pipelines.
  if (design.structure !== 'floating') {
    return null;
  }

  return (
    <fieldset
      className="wd-structure-selector"
      role="radiogroup"
      aria-labelledby={`${groupId}-legend`}
    >
      <legend
        id={`${groupId}-legend`}
        className="wd-structure-selector__legend"
      >
        Floating framing
      </legend>
      <label className="wd-structure-selector__option">
        <input
          type="radio"
          name={`${groupId}-framing`}
          value="beams-and-joists"
          checked={design.floatingFraming === 'beams-and-joists'}
          onChange={() => {
            handleChange('beams-and-joists');
          }}
        />
        <span>Beams + joists (on blocks)</span>
      </label>
      <label className="wd-structure-selector__option">
        <input
          type="radio"
          name={`${groupId}-framing`}
          value="joists-on-blocks"
          checked={design.floatingFraming === 'joists-on-blocks'}
          onChange={() => {
            handleChange('joists-on-blocks');
          }}
        />
        <span>Joists on blocks (no beams)</span>
      </label>
    </fieldset>
  );
}
