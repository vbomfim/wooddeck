/**
 * `src/scene/highlights/OverSpanHighlight.tsx` — a single
 * self-contained highlight mesh for one over-span `LayoutMember`.
 *
 * ## Responsibility (single)
 *
 * Translate ONE {@link LayoutMember} into ONE `<mesh>` — an
 * opaque red enclosing box positioned and rotated per the
 * member's pre-computed geometry fields, scaled to the member's
 * inflated size (via {@link inflateHighlightScale}) so the box
 * fully encloses the coincident member and avoids z-fighting.
 * This is the leaf decorator for the S11 WarningOverlay; the
 * overlay (`../WarningOverlay.tsx`) maps each `Warning` to the
 * corresponding member and renders one of these per warning.
 *
 * ## ZERO geometry math — the S10 finding-#3 pledge
 *
 * OverSpanHighlight NEVER does arithmetic on `member.position`,
 * `member.size`, or `member.rotation`. It ONLY passes the fields
 * through as `<mesh>` props:
 *
 *   position = [ m.position.x, m.position.y, m.position.z ]
 *   scale    = inflateHighlightScale(m.size)   ← helper, no math here
 *   rotation = [ m.rotation.x, m.rotation.y, m.rotation.z ]
 *
 * The scale prop delegates to {@link inflateHighlightScale}
 * (defined in `./highlight-primitives.ts`) so the per-axis
 * inflation arithmetic lives in a primitives helper rather than
 * inline here. The sibling `no-geometry-math.test.ts` grep scans
 * this file for any `member.position.<axis>` / `member.size.<axis>`
 * followed by an arithmetic operator (`+`, `-`, `*`, `slash`,
 * `%`), plus unary-minus and bracket-notation variants, and fires
 * if one appears — passing `member.size` through the helper
 * preserves that pledge.
 *
 * ## 1 three.js unit = 1 mm
 *
 * Same as BoxMember (S10): the scene is authored at millimeter
 * world scale, and the highlight mesh inherits that convention
 * for free by passing member fields through unchanged.
 *
 * ## S11 boundary rule — no imports from `../layers/`
 *
 * The S11 `warning-overlay-no-layers` dep-cruiser rule (finding
 * #7) forbids `src/scene/highlights/**` from importing anything
 * under `src/scene/layers/**`. This file imports its shared
 * geometry + material + inflation helper from the sibling
 * `./highlight-primitives` module (a self-contained copy of the
 * S10 shared-primitive pattern), NEVER from `layers/shared/`.
 * Enforced structurally by dep-cruiser + BLOCK-2q boundary
 * self-test + the sibling `no-geometry-math.test.ts` grep guard.
 *
 * ## Reusability contract for future stories
 *
 * A stretch story (AC6 tooltip on hover) would wrap this mesh
 * in a group and attach an event handler — the rewritable shape
 * stays the same. A future distinct-per-severity style story
 * would extend `./highlight-primitives.ts` with additional
 * material singletons and switch on `warning.kind` in the
 * overlay, still routing through this component.
 */
import type { JSX } from 'react';

import type { LayoutMember } from '../../domain/model';

import {
  HIGHLIGHT_BOX_GEOMETRY,
  HIGHLIGHT_MATERIAL,
  HIGHLIGHT_RENDER_ORDER,
  inflateHighlightScale,
} from './highlight-primitives';

/**
 * Props for {@link OverSpanHighlight}. Single required `member`
 * field — the overlay above filters warnings and resolves each
 * `warning.memberId` to a member before rendering us. We take
 * the member (not the warning) because the highlight is a
 * geometry-only decoration; the warning payload (`message`,
 * `tableReference`) is displayed by the S14 WarningsPanel, not
 * by the 3D decorator.
 */
export interface OverSpanHighlightProps {
  readonly member: LayoutMember;
}

export function OverSpanHighlight({ member }: OverSpanHighlightProps): JSX.Element {
  return (
    <mesh
      position={[member.position.x, member.position.y, member.position.z]}
      scale={inflateHighlightScale(member.size)}
      rotation={[member.rotation.x, member.rotation.y, member.rotation.z]}
      geometry={HIGHLIGHT_BOX_GEOMETRY}
      material={HIGHLIGHT_MATERIAL}
      renderOrder={HIGHLIGHT_RENDER_ORDER}
    />
  );
}
