/**
 * `src/scene/highlights/highlight-primitives.ts` — self-contained
 * module-level singletons for the S11 warning highlight decoration.
 *
 * ## Why this file exists (S11 boundary rule)
 *
 * The S11 `warning-overlay-no-layers` dep-cruiser rule (finding
 * #7) forbids `src/scene/highlights/**` from importing anything
 * under `src/scene/layers/**` — including the shared BoxMember
 * geometry (`layers/shared/geometries.ts`) and material
 * (`layers/shared/materials.ts`) primitives. That decoupling is
 * the whole point: the WarningOverlay is a peer of the layers,
 * not a consumer, so a layer being toggled off can never
 * accidentally hide a highlight. Reusing layer primitives would
 * couple the two.
 *
 * The trade-off: this file is a SEPARATE self-contained copy of
 * the same "shared unit cube + shared material" pattern S10 uses
 * for BoxMember. The pattern is:
 *
 *   - ONE module-level `BoxGeometry(1, 1, 1)` singleton
 *     ({@link HIGHLIGHT_BOX_GEOMETRY}) — every highlight scales
 *     it by `member.size` via the mesh `scale` prop. Full-extent
 *     matches `THREE.BoxGeometry`'s (width, height, depth)
 *     constructor convention.
 *   - ONE module-level `MeshBasicMaterial` singleton
 *     ({@link HIGHLIGHT_MATERIAL}) — every highlight binds the
 *     same material. Cheap GPU state.
 *
 * ## AC3 material choice — translucent red, always on top
 *
 * The S11 ticket §17 open question listed three highlight-style
 * options: (a) translucent bounding box, (b) wireframe outline,
 * (c) glow shader. We picked (a) — a translucent RED
 * `MeshBasicMaterial` with:
 *
 *   - `color: 0xff0000`         — pure red, WCAG-adjacent contrast
 *                                 against typical wood tones (PT
 *                                 olive, Cedar cinnamon) + composite
 *                                 grey per §10.
 *   - `transparent: true`       — user can still see the member
 *                                 through the highlight (an opaque
 *                                 red box would hide it entirely).
 *   - `opacity: 0.35`           — visible but not dominating; the
 *                                 warned member's silhouette shows
 *                                 through the tint.
 *   - `depthTest: false`        — the highlight renders regardless
 *                                 of what's in front of it. Combined
 *                                 with the high renderOrder below,
 *                                 this guarantees AC3's "renders on
 *                                 top so it isn't occluded".
 *   - `depthWrite: false`       — the highlight is an overlay, not
 *                                 a depth-buffer participant.
 *                                 Without this, the translucent
 *                                 box would still write its z-values
 *                                 and occlude subsequent transparent
 *                                 primitives behind it.
 *   - `side: DoubleSide`        — draws the inside faces too, so
 *                                 a camera inside the box (unusual
 *                                 but possible during a close-in
 *                                 orbit) still sees the tint.
 *
 * The chosen style is documented in `docs/ARCHITECTURE.md`.
 * `MeshBasicMaterial` (unlit) is deliberate — a
 * `MeshStandardMaterial` in a shadowed corner would go nearly
 * black, defeating AC3 "distinctly visible".
 *
 * ## AC3 render order
 *
 * three.js draws opaque objects first (typically `renderOrder=0`),
 * then transparent objects in reverse-depth order. A
 * `renderOrder=999` on the highlight mesh forces it to the END of
 * the transparent pass — so it draws over every other primitive
 * regardless of camera angle. Combined with `depthTest=false`,
 * this pins the highlight visually on top.
 *
 * ## Disposal
 *
 * Both the geometry and material are module-level singletons.
 * Their lifecycle is the tab lifetime (browser process teardown
 * reclaims the GPU handles). No explicit disposal is required in
 * production. If a future test/HMR scenario wants to prove the
 * singletons are rebuild-friendly, add a
 * `disposeHighlightPrimitives()` helper here — YAGNI for MVP.
 *
 * ## Boundary discipline
 *
 * This file imports ONLY from `three`. No React, no state store,
 * no drei, no `../layers/**`. That keeps it a pure three.js
 * resource module trivially reusable inside the highlights folder
 * without pulling in the layer stack.
 */
import { BoxGeometry, DoubleSide, MeshBasicMaterial } from 'three';

/**
 * The canonical highlight color — pure red (0xFF0000). Documented
 * in `docs/ARCHITECTURE.md`. Exported so tests can assert the
 * numerical property (dominant red channel) without hard-coding
 * the same literal in two places.
 */
export const HIGHLIGHT_COLOR_HEX = 0xff0000;

/**
 * Translucency amount — 35% opacity picks up the "obvious tint"
 * requirement (AC3) while keeping the warned member visible
 * through it. Higher (e.g. 0.6) hides the member; lower (e.g.
 * 0.15) risks being missed on a small/thin member.
 */
export const HIGHLIGHT_OPACITY = 0.35;

/**
 * Mesh `renderOrder` for every highlight. High enough (999) that
 * every opaque scene primitive (renderOrder=0) sorts before it
 * and the highlight draws LAST — visually on top. See module
 * header for the depthTest+renderOrder coupling.
 */
export const HIGHLIGHT_RENDER_ORDER = 999;

/**
 * The single unit-cube BoxGeometry every {@link OverSpanHighlight}
 * shares. Scaling by `member.size` produces the correct
 * full-extent bounding box (matches THREE.BoxGeometry's
 * (width, height, depth) convention). See module header for the
 * shared-singleton rationale.
 */
export const HIGHLIGHT_BOX_GEOMETRY: BoxGeometry = new BoxGeometry(1, 1, 1);

/**
 * The single translucent red MeshBasicMaterial every
 * {@link OverSpanHighlight} shares. See module header for AC3
 * property choices and the depthTest/depthWrite/renderOrder
 * combination.
 */
export const HIGHLIGHT_MATERIAL: MeshBasicMaterial = new MeshBasicMaterial({
  color: HIGHLIGHT_COLOR_HEX,
  transparent: true,
  opacity: HIGHLIGHT_OPACITY,
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
});
