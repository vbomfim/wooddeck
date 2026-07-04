/**
 * `src/scene/layers/shared/geometries.ts` — module-level singleton
 * geometries shared across every rectangular / block mesh in the
 * scene.
 *
 * ## Why a dedicated file
 *
 * A `THREE.BoxGeometry` is a JS-heap + GPU-buffer allocation. In
 * a 40'×40' deck we render ~1900 rectangular members. Constructing
 * a fresh `BoxGeometry` per mesh (which is what
 * `<boxGeometry args={[...]}/>` inside a JSX child does — r3f
 * treats every declarative descendant as a distinct instance)
 * would allocate ~1900 identical 24-vertex + 36-index buffers.
 * GPT review #3 flagged this — the module-header comment claimed
 * "shared geometry" but the actual JSX child created per-mesh
 * geometry.
 *
 * The fix: one module-level `UNIT_BOX_GEOMETRY` passed via the
 * imperative `geometry` prop that r3f accepts on `<mesh>`. Every
 * `<BoxMember>` gets `mesh.geometry === UNIT_BOX_GEOMETRY` —
 * reference-equal, asserted by `BoxMember.test.tsx`.
 *
 * ## Why a UNIT cube (not per-size)
 *
 * The `<mesh scale={[sx, sy, sz]}/>` prop applies a scale matrix
 * to the model transform. Scaling a unit cube by full-extent
 * `size` gives the correct box — matching `THREE.BoxGeometry`'s
 * `(width, height, depth)` full-extent convention (see
 * `domain/model.ts` LAYOUT COORDINATE FRAME note).
 *
 * ## S22 — block-layer additions (Epic 2 / FR-029)
 *
 * The two MVP block products each get their own shared geometry:
 *
 *   - `DECK_BLOCK_GEOMETRY` — `BoxGeometry(1,1,1)`, per-instance
 *     scaled to the Oldcastle 11×11×7 catalog dims (279 × 178 × 279
 *     mm). Shape-identical to `UNIT_BOX_GEOMETRY` but kept as a
 *     separate constant so the concrete-block representation can
 *     evolve independently of the framing box (e.g. a future
 *     revision to a slotted-top mesh does not drag framing along).
 *   - `TUFFBLOCK_GEOMETRY` — `CylinderGeometry(topR, botR, 1, 6)`,
 *     per-instance scaled to the TuffBlock 12×12×4 dims (305 ×
 *     102 × 305 mm). The `radialSegments = 6` argument produces a
 *     HEXAGONAL top-down silhouette (matches the user's drawing —
 *     AC4). Top radius < bottom radius gives the truncated-pyramid
 *     side view (visible taper).
 *
 * All three geometries follow the same "unit primitive × per-instance
 * scale" discipline — the scene never does arithmetic on member
 * fields (Code Review Guardian finding #3), and the per-mesh cost
 * is one scale-matrix multiplication in the vertex shader.
 *
 * ## Disposal
 *
 * Lifecycle-wise, these singletons live for the JS module lifetime
 * (which in the app is the tab lifetime). Browser tab teardown
 * reclaims the underlying GPU handles regardless of any explicit
 * dispose call. {@link disposeSharedGeometry} and
 * {@link disposeSharedGeometries} are therefore explicitly
 * **test/HMR-only** helpers — they are NOT wired to scene unmount:
 *
 *   - Wiring them to scene unmount would break a scene REMOUNT
 *     (module-level `const` geometries can't be safely
 *     rebuilt without a lazy-accessor wrapper, which we
 *     intentionally do NOT add — the scene doesn't remount in the
 *     MVP; S12 mounts it once and it stays live).
 *   - The tab's process teardown reclaims the GPU handles regardless
 *     — no leak in production.
 *
 * The two helpers exist for TWO tooling scenarios:
 *   1. **HMR** — proving rebuild-friendliness during `vite dev`.
 *   2. **Test isolation** — freeing GPU handles between test
 *      fixtures that construct+dispose their own scene subtrees.
 *
 *   - `disposeSharedGeometry()`  — disposes ONLY `UNIT_BOX_GEOMETRY`
 *     (kept for backwards compatibility with the S10 test surface).
 *   - `disposeSharedGeometries()` — plural: disposes every shared
 *     geometry the scene owns (S22 addition — used by the S22
 *     block-layer test-isolation path and future HMR helpers).
 *
 * See pair-fix iter 2 GPT#2 for the "not scene-unmount" rationale.
 *
 * ## Boundary discipline
 *
 * Only imports `three`. No React, no state store — pure geometry.
 */
import { BoxGeometry, CylinderGeometry } from 'three';

/**
 * The single unit-cube geometry every `<BoxMember>` shares.
 * `new BoxGeometry(1, 1, 1)` — 12 triangles / 24 vertices / 36
 * indices. All members bind this ONE buffer; the per-mesh
 * `scale` prop stretches it to the member's `size`.
 */
export const UNIT_BOX_GEOMETRY: BoxGeometry = new BoxGeometry(1, 1, 1);

/**
 * Shared box geometry for `deck-blocks` foundation products (e.g.
 * Oldcastle 11×11×7 precast concrete). `BoxGeometry(1, 1, 1)` —
 * shape-identical to `UNIT_BOX_GEOMETRY` but a DISTINCT instance so
 * the block-layer can evolve its representation independently of
 * the framing-member primitive (see module header).
 *
 * Per-instance scale = `member.size` = full catalog dims (whole mm).
 */
export const DECK_BLOCK_GEOMETRY: BoxGeometry = new BoxGeometry(1, 1, 1);

/**
 * ## `TUFFBLOCK_GEOMETRY` geometry constants
 *
 * The following radii + segment count are the ONLY block-shape
 * numbers that live in this file — every OTHER dimension is derived
 * per-instance from `member.size` at render time.
 *
 *   - `TUFFBLOCK_BOTTOM_RADIUS_UNIT = 0.5`
 *     Chosen so the bottom face's vertex-vertex diameter is 1.0
 *     BEFORE the AABB normalization pre-scale (see below).
 *
 *   - `TUFFBLOCK_TOP_RADIUS_UNIT = 0.4`
 *     Top face is 80% of the bottom — visible truncated-pyramid
 *     taper matching the TuffBlock's cast form (AC4 side view).
 *     A future refinement can shift this ratio if the user rejects
 *     the current visual; the number lives here so the change is a
 *     one-line edit.
 *
 * The `radialSegments = 6` argument produces the HEXAGONAL top-down
 * silhouette AC4 mandates.
 *
 * ### AABB normalization (pair-fix iter 2 — GPT#1 HIGH)
 *
 * three.js `CylinderGeometry` emits its first cap vertex at
 * `x = r·sin(0) = 0`, `z = r·cos(0) = r` — i.e. the FIRST vertex is on
 * the +Z axis. With six equally-spaced segments, the resulting
 * hexagon has:
 *
 *   - Z-axis (vertex-to-vertex): span `2·r` = 1.0
 *   - X-axis (flat-to-flat):     span `2·r·cos(30°)` = `r·√3` ≈ 0.866
 *
 * The raw unit-space X/Z bounding box is therefore NOT square
 * (0.866 × 1.0). A caller doing `<mesh scale={[305, 102, 305]}/>`
 * would render 264 × 102 × 305 mm — a ~13% Z-axis undersize on the
 * flat-flat axis. GPT review caught this.
 *
 * The fix: pre-scale the geometry's X axis by `2/√3 ≈ 1.1547` so
 * the flat-flat span also reaches 1.0. After the pre-scale the
 * unit-space AABB is exactly 1 × 1 × 1, and a `<mesh scale={size}>`
 * gives the correct full-extent block dims. The hexagon is now
 * slightly elongated (non-regular), but the 6-vertex silhouette
 * (AC4) is preserved and the taper (AC4 side view) is preserved.
 *
 * `TUFFBLOCK_HEX_AABB_NORMALIZATION` is the flat-flat/vertex-vertex
 * ratio's reciprocal — kept as a named constant so a future
 * radial-segment change (unlikely, AC4 pins 6) only needs the math
 * updated in one place.
 */
const TUFFBLOCK_TOP_RADIUS_UNIT = 0.4;
const TUFFBLOCK_BOTTOM_RADIUS_UNIT = 0.5;
const TUFFBLOCK_RADIAL_SEGMENTS = 6;
const TUFFBLOCK_HEIGHT_UNIT = 1;
/**
 * `2 / √3` — the X-axis pre-scale factor that stretches the
 * flat-flat span (originally `r·√3` = 0.866) up to 1.0, matching
 * the vertex-vertex span. Result: unit-space AABB is exactly 1×1×1
 * so `<mesh scale={size}>` gives the correct catalog dims. See
 * module JSDoc "AABB normalization" for the full derivation.
 */
const TUFFBLOCK_HEX_AABB_NORMALIZATION = 2 / Math.sqrt(3);

/**
 * Shared cylinder-frustum geometry for `tuffblocks` foundation
 * products (polypropylene puck — TuffBlock 12×12×4). Hex silhouette
 * from `radialSegments = 6` (AC4); truncated-pyramid form from
 * top-radius < bottom-radius; AABB normalized to a unit 1×1 square
 * footprint via an X-axis pre-scale (see module JSDoc — GPT#1
 * pair-fix iter 2). Per-instance scale = `member.size` = full
 * catalog dims.
 */
const tuffblockRaw = new CylinderGeometry(
  TUFFBLOCK_TOP_RADIUS_UNIT,
  TUFFBLOCK_BOTTOM_RADIUS_UNIT,
  TUFFBLOCK_HEIGHT_UNIT,
  TUFFBLOCK_RADIAL_SEGMENTS,
);
// Stretch the flat-flat (X) axis so the unit AABB is exactly 1×1
// in X and Z. See module JSDoc for the derivation.
tuffblockRaw.scale(TUFFBLOCK_HEX_AABB_NORMALIZATION, 1, 1);
export const TUFFBLOCK_GEOMETRY: CylinderGeometry = tuffblockRaw;

/**
 * Test-only helper — dispose the framing-member geometry so a HMR
 * / test rebuild can prove the singleton is re-createable. Not
 * called in production. See module header.
 */
export function disposeSharedGeometry(): void {
  UNIT_BOX_GEOMETRY.dispose();
}

/**
 * Test-only helper — dispose EVERY shared geometry the scene owns
 * (framing + block primitives).
 *
 * ## NOT wired to scene unmount (pair-fix iter 2 — GPT#2)
 *
 * The scene lives for the whole app / tab lifetime (it's the lazy
 * r3f chunk mounted by S12's `<AppShell>`; the user's design is
 * always renderable). Eagerly disposing these singletons on scene
 * unmount would BREAK a remount — the exported `const`s cannot be
 * re-created without a lazy-accessor wrapper, and we intentionally
 * did not add one (YAGNI — the scene doesn't remount in production).
 *
 * This helper is therefore for TWO test/tooling scenarios only:
 *
 *   1. **HMR** — a save-and-reload cycle during `vite dev` where a
 *      developer wants to prove the geometries survive rebuild.
 *   2. **Unit-test isolation** — a `.test.tsx` file that constructs
 *      + disposes its own scene fixture and wants to guarantee no
 *      GPU-handle leak between tests.
 *
 * Browser tab teardown reclaims the underlying GPU handles regardless
 * of whether this helper is called — this is a debug/tooling
 * convenience, not a production lifecycle hook.
 *
 * S22 plural addition — the singular `disposeSharedGeometry` stays
 * for backwards compat and disposes ONLY `UNIT_BOX_GEOMETRY`.
 */
export function disposeSharedGeometries(): void {
  UNIT_BOX_GEOMETRY.dispose();
  DECK_BLOCK_GEOMETRY.dispose();
  TUFFBLOCK_GEOMETRY.dispose();
}
