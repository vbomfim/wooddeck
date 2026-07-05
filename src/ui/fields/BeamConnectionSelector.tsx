/**
 * `src/ui/fields/BeamConnectionSelector.tsx` — S27
 * (feat/joist-beam-connection).
 *
 * ## Responsibility (single)
 *
 * Present a segmented radio-group with the two `BeamConnection`
 * values (see `../../domain/model.ts` doc-block):
 *
 *   - `'drop'` (DEFAULT) — drop beam: joists rest ON TOP of the
 *     beam; joist bottom = beam top. Classic MVP construction.
 *   - `'flush'` — flush beam: joists are hung on the SIDE of the
 *     beam with joist hangers; joist TOP is flush with beam TOP.
 *
 * ## Visibility (matches the ticket contract)
 *
 * The selector is meaningful only for designs that have BOTH
 * beams AND joists. It renders NOTHING (returns null) when:
 *
 *   - `structure === 'floating'` AND
 *     `floatingFraming === 'joists-on-blocks'` (Method B — no beam
 *     layer; `beamConnection` is IGNORED downstream anyway).
 *
 * Otherwise (elevated OR floating Method A) it renders a radio
 * group. Hiding (not disabling) matches the S26 idiom for
 * structure-scoped controls.
 *
 * ## Boundary (dependency rule)
 *
 * `ui → state` + `ui → domain/model` (type-only). No touching
 * `application/`, `domain/spans`, `domain/layout` — the store
 * mediates all of those. Confirmed by the boundary self-test
 * (BLOCK-1 series).
 *
 * ## a11y
 *
 * Rendered as `<fieldset role="radiogroup"><legend>…</legend>
 * <input type="radio">*</fieldset>` — same idiom as
 * `FloatingFramingSelector` and `StructureSelector`. Screen
 * readers announce "Beam connection" on focus of the first radio;
 * native arrow-key navigation moves within the group.
 */
import { useCallback, useId, type JSX } from 'react';

import type { BeamConnection } from '../../domain/model';
import { useDesign, useDesignStore } from '../../state';

import '../styles/tokens.css';
import '../styles/structure-selector.css';

/**
 * `<BeamConnectionSelector />` — see module header for the
 * visibility contract. Reads the current `design.beamConnection`
 * from the design-store; writes back via `applyParameters` on
 * user input. A same-value click is a no-op (matches the S23
 * StructureSelector pattern — "don't run the layout engine when
 * nothing changed").
 */
export function BeamConnectionSelector(): JSX.Element | null {
  const design = useDesign();
  const groupId = useId();

  const handleChange = useCallback(
    (next: BeamConnection) => {
      if (next === design.beamConnection) return; // no-op — see class doc
      useDesignStore.getState().applyParameters({ beamConnection: next });
    },
    [design.beamConnection],
  );

  // Visibility gate. Method B floating has NO beam layer, so
  // `beamConnection` is a meaningless choice — hide the selector
  // entirely. Elevated always has beams (2 rim beams + posts);
  // floating Method A (`'beams-and-joists'`) has 2 rim beams too;
  // both are legitimate uses of the selector.
  const hidden =
    design.structure === 'floating' &&
    design.floatingFraming === 'joists-on-blocks';
  if (hidden) {
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
        Beam connection
      </legend>
      <label className="wd-structure-selector__option">
        <input
          type="radio"
          name={`${groupId}-beam-connection`}
          value="drop"
          checked={design.beamConnection === 'drop'}
          onChange={() => {
            handleChange('drop');
          }}
        />
        <span>Drop beam (joists rest on top)</span>
      </label>
      <label className="wd-structure-selector__option">
        <input
          type="radio"
          name={`${groupId}-beam-connection`}
          value="flush"
          checked={design.beamConnection === 'flush'}
          onChange={() => {
            handleChange('flush');
          }}
        />
        <span>Flush beam (joists hung level / tops flush)</span>
      </label>
    </fieldset>
  );
}
