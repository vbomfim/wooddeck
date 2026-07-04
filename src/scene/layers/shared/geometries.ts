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
 * reclaims the GPU handle. In HMR / test scenarios that want to
 * prove rebuild-friendliness, {@link disposeSharedGeometry} and
 * {@link disposeSharedGeometries} tear them down and let the next
 * access re-create — but the current exports are `const`, so a
 * "re-create" would need a wrapping accessor. YAGNI for MVP.
 *
 *   - `disposeSharedGeometry()`  — disposes ONLY `UNIT_BOX_GEOMETRY`
 *     (kept for backwards compatibility with the S10 test surface).
 *   - `disposeSharedGeometries()` — plural: disposes every shared
 *     geometry the scene owns (S22 addition — used by the S22
 *     block-layer teardown path and future scene-wide HMR helpers).
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
 * The following two radii are the ONLY block-shape numbers that live
 * in this file — every OTHER dimension is derived per-instance from
 * `member.size` at render time.
 *
 *   - `TUFFBLOCK_BOTTOM_RADIUS_UNIT = 0.5`
 *     Makes the bottom face a UNIT-DIAMETER hex — so a
 *     `<mesh scale={[widthMm, heightMm, depthMm]}/>` produces a
 *     hex whose bottom-face width equals `widthMm`. Same "unit
 *     primitive × per-instance scale" discipline as
 *     `UNIT_BOX_GEOMETRY`.
 *
 *   - `TUFFBLOCK_TOP_RADIUS_UNIT = 0.4`
 *     Top face is 80% of the bottom — visible truncated-pyramid
 *     taper matching the TuffBlock's cast form (AC4 side view).
 *     A future refinement can shift this ratio if the user
 *     rejects the current visual; the number lives here so the
 *     change is a one-line edit.
 *
 * The `radialSegments = 6` argument produces the HEXAGONAL top-down
 * silhouette AC4 mandates.
 */
const TUFFBLOCK_TOP_RADIUS_UNIT = 0.4;
const TUFFBLOCK_BOTTOM_RADIUS_UNIT = 0.5;
const TUFFBLOCK_RADIAL_SEGMENTS = 6;
const TUFFBLOCK_HEIGHT_UNIT = 1;

/**
 * Shared cylinder-frustum geometry for `tuffblocks` foundation
 * products (polypropylene puck — TuffBlock 12×12×4). Hex silhouette
 * from `radialSegments = 6` (AC4); truncated-pyramid form from
 * top-radius < bottom-radius.
 *
 * Per-instance scale = `member.size` = full catalog dims. The
 * bottom-radius of 0.5 makes the bottom face a unit-diameter hex,
 * so `<mesh scale.x = widthMm>` produces the correct product width.
 */
export const TUFFBLOCK_GEOMETRY: CylinderGeometry = new CylinderGeometry(
  TUFFBLOCK_TOP_RADIUS_UNIT,
  TUFFBLOCK_BOTTOM_RADIUS_UNIT,
  TUFFBLOCK_HEIGHT_UNIT,
  TUFFBLOCK_RADIAL_SEGMENTS,
);

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
 * (framing + block primitives). Not called in production; the
 * browser tab's process teardown reclaims GPU handles. This is the
 * S22 plural addition — the singular `disposeSharedGeometry` stays
 * for backwards compat and disposes ONLY `UNIT_BOX_GEOMETRY`.
 */
export function disposeSharedGeometries(): void {
  UNIT_BOX_GEOMETRY.dispose();
  DECK_BLOCK_GEOMETRY.dispose();
  TUFFBLOCK_GEOMETRY.dispose();
}
