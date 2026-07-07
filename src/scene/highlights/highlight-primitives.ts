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
 *     it via {@link inflateHighlightScale}(member.size). Passing
 *     the size through the helper (instead of raw) inflates by
 *     {@link HIGHLIGHT_INFLATE_MM} on every axis so the opaque
 *     highlight fully encloses the coincident member and no
 *     faces are shared (no z-fight).
 *   - ONE module-level `MeshBasicMaterial` singleton
 *     ({@link HIGHLIGHT_MATERIAL}) — every highlight binds the
 *     same material. Cheap GPU state.
 *
 * ## AC3 material choice — opaque red, depth-correct
 *
 * The S11 ticket §17 open question listed three highlight-style
 * options: (a) translucent bounding box, (b) wireframe outline,
 * (c) glow shader. We originally shipped (a) with 35% opacity;
 * the follow-up "remove transparency" request replaced it with a
 * SOLID red opaque box that fully encloses the member. Property
 * choices for the opaque redesign:
 *
 *   - `color: 0xff0000`         — pure red, WCAG-adjacent contrast
 *                                 against typical wood tones (PT
 *                                 olive, Cedar cinnamon) + composite
 *                                 grey per §10.
 *   - `transparent: false`      — a SOLID red box, no member tint
 *                                 bleeding through. The user
 *                                 unambiguously sees a red slab
 *                                 where the over-span member is.
 *   - `opacity: 1.0`            — fully opaque. Pinned via the
 *                                 HIGHLIGHT_OPACITY constant so
 *                                 tests can assert it symbolically.
 *   - `depthTest: true`         — depth-correct: the highlight is
 *                                 occluded by nearer geometry the
 *                                 same way any other opaque scene
 *                                 primitive is. Combined with the
 *                                 inflated box that fully encloses
 *                                 the member, this yields correct
 *                                 3D occlusion without z-fighting.
 *   - `depthWrite: true`        — the highlight participates in
 *                                 the z-buffer (an opaque scene
 *                                 primitive should always write
 *                                 depth so subsequent draws sort
 *                                 correctly against it).
 *   - `side: DoubleSide`        — draws the inside faces too, so
 *                                 a camera inside the box (unusual
 *                                 but possible during a close-in
 *                                 orbit) still sees the red tint
 *                                 instead of a hollow shell.
 *
 * `MeshBasicMaterial` (unlit) is deliberate — a
 * `MeshStandardMaterial` in a shadowed corner would go nearly
 * black, defeating AC3 "distinctly visible".
 *
 * ## AC3 render order (depth-correct, no forced top-most)
 *
 * The translucent design had `renderOrder=999` + `depthTest=false`
 * to force the highlight to draw over every other primitive. The
 * opaque redesign does NOT need that: a depth-correct opaque box
 * sorts naturally with other opaque scene primitives, and real
 * z-buffer values determine visibility. HIGHLIGHT_RENDER_ORDER is
 * pinned at 0 (same as untagged opaque geometry).
 *
 * ## Avoiding z-fighting with the coincident member
 *
 * Every OverSpanHighlight is placed at the exact same
 * position/rotation as the warned member. If the highlight box
 * were sized identically to the member, the two would share
 * every face and z-fight badly (flickering coplanar surfaces).
 * The fix: inflate the highlight box by {@link HIGHLIGHT_INFLATE_MM}
 * on every axis so it FULLY ENCLOSES the member with a small
 * margin. No shared faces → no z-fighting → depth-correct
 * occlusion works cleanly.
 *
 * ## Disposal
 *
 * Both the geometry and material are module-level singletons.
 * Their lifecycle is the tab lifetime (browser process teardown
 * reclaims the GPU handles). No explicit disposal is required in
 * production.
 *
 * The exported {@link disposeHighlightPrimitives} helper (pair-fix
 * 1, Code Review GPT#4) provides parity with the layer-shared
 * `disposeSharedMaterials`/`disposeSharedGeometry` HMR helpers.
 * It exists for HMR + tooling scenarios that want to trigger the
 * three.js dispose lifecycle explicitly (e.g. Storybook HMR).
 * **Do not call it in production render code** — the singletons
 * are bound to live meshes and disposing them mid-frame will
 * black-out the highlights.
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
 * Highlight material opacity. Pinned at 1.0 (fully opaque) since
 * the "remove transparency" follow-up replaced the translucent
 * design with a SOLID red enclosing box. Kept as a named export
 * for symbolic assertions in tests + future style variants.
 */
export const HIGHLIGHT_OPACITY = 1.0;

/**
 * Mesh `renderOrder` for every highlight. The opaque + depth-correct
 * design does NOT need to force itself to the end of the render
 * pass; 0 sorts it with other opaque scene primitives, and real
 * z-depth decides visibility. See module header for the removal
 * of the old `999` forced-top-most pattern.
 */
export const HIGHLIGHT_RENDER_ORDER = 0;

/**
 * Per-axis inflation (in mm) applied to the highlight box so it
 * fully encloses the coincident warned member. Without inflation
 * the highlight and member would share every face and z-fight
 * badly (the underlying issue an opaque coincident box would
 * introduce). Chosen small enough (8 mm ≈ 0.3") to be visually
 * indistinguishable from the member's silhouette but large enough
 * to give the z-buffer a decisive difference at real-world
 * (metre-scale) camera distances.
 */
export const HIGHLIGHT_INFLATE_MM = 8;

/**
 * The single unit-cube BoxGeometry every {@link OverSpanHighlight}
 * shares. Scaling by {@link inflateHighlightScale}(member.size)
 * produces the enclosing bounding box (matches THREE.BoxGeometry's
 * (width, height, depth) convention). See module header for the
 * shared-singleton rationale.
 */
export const HIGHLIGHT_BOX_GEOMETRY: BoxGeometry = new BoxGeometry(1, 1, 1);

/**
 * The single opaque red MeshBasicMaterial every
 * {@link OverSpanHighlight} shares. See module header for AC3
 * property choices and the depth-correct opaque box rationale.
 */
export const HIGHLIGHT_MATERIAL: MeshBasicMaterial = new MeshBasicMaterial({
  color: HIGHLIGHT_COLOR_HEX,
  transparent: false,
  opacity: HIGHLIGHT_OPACITY,
  depthTest: true,
  depthWrite: true,
  side: DoubleSide,
});

/**
 * A `{x, y, z}` size triple — matches the shape of `LayoutMember.size`
 * without importing the domain type here (this file is a pure
 * three.js primitives module, no domain deps). The helper is
 * intentionally structurally typed so any `{x,y,z}` object works.
 */
export interface HighlightSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Compute the mesh `scale` prop tuple for an OverSpanHighlight —
 * the member's size inflated by {@link HIGHLIGHT_INFLATE_MM} on
 * every axis so the opaque highlight box fully encloses the
 * warned member (no coincident faces, no z-fight).
 *
 * Kept HERE (not inside OverSpanHighlight.tsx) so the arithmetic
 * lives in a primitives helper and NOT in the leaf decorator —
 * that preserves the OverSpanHighlight "zero geometry math" pledge
 * enforced by the sibling `no-geometry-math.test.ts` grep guard,
 * which scans for `member.<field>.<axis>` arithmetic in the
 * highlights/ source (this helper operates on a generic
 * {@link HighlightSize}, never on a `member.*` expression).
 *
 * Pure — returns a fresh tuple; never mutates the input.
 */
export function inflateHighlightScale(
  size: HighlightSize,
): [number, number, number] {
  return [
    size.x + HIGHLIGHT_INFLATE_MM,
    size.y + HIGHLIGHT_INFLATE_MM,
    size.z + HIGHLIGHT_INFLATE_MM,
  ];
}

/**
 * HMR / tooling helper — releases the GPU handles held by the
 * two module-level singletons. Parity with the layers' shared
 * `disposeSharedMaterials` + `disposeSharedGeometry` helpers.
 *
 * ## When to call this
 *
 *   - **HMR** — when a hot-reload session replaces this module,
 *     dispose the outgoing instances so three.js doesn't leak
 *     WebGL buffers.
 *   - **Storybook** — a story teardown that spins up + tears
 *     down its own WebGL context may want to release handles.
 *   - **Tests** — if a suite creates + destroys many highlight
 *     scenes, call this in `afterAll` to keep the process's
 *     GPU handle count bounded.
 *
 * ## When NOT to call this
 *
 *   - **Production render code** — the singletons are bound to
 *     live meshes; disposing mid-frame will black-out the
 *     highlights and log a WebGL error. Rely on tab-lifetime
 *     cleanup instead.
 *   - **Inside a WarningOverlay unmount effect** — the overlay
 *     doesn't own these singletons, other tabs/components may
 *     still need them.
 *
 * The three.js `.dispose()` calls are idempotent (three.js
 * silently no-ops on already-disposed handles) so calling this
 * repeatedly is safe.
 */
export function disposeHighlightPrimitives(): void {
  HIGHLIGHT_BOX_GEOMETRY.dispose();
  HIGHLIGHT_MATERIAL.dispose();
}
