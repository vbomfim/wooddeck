/**
 * `src/scene/layers/shared/geometries.ts` — module-level singleton
 * geometries shared across every `<BoxMember>` in the scene.
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
 * ## Disposal
 *
 * Lifecycle-wise, this singleton lives for the JS module lifetime
 * (which in the app is the tab lifetime). Browser tab teardown
 * reclaims the GPU handle. In HMR / test scenarios that want to
 * prove rebuild-friendliness, {@link disposeSharedGeometry} tears
 * it down and lets the next access re-create — but the current
 * export is `const`, so a "re-create" would need a wrapping
 * accessor. YAGNI for MVP; the reset is done in test-only
 * `disposeSharedResources` (see `./materials.ts`).
 *
 * ## Boundary discipline
 *
 * Only imports `three`. No React, no state store — pure geometry.
 */
import { BoxGeometry } from 'three';

/**
 * The single unit-cube geometry every `<BoxMember>` shares.
 * `new BoxGeometry(1, 1, 1)` — 12 triangles / 24 vertices / 36
 * indices. All members bind this ONE buffer; the per-mesh
 * `scale` prop stretches it to the member's `size`.
 */
export const UNIT_BOX_GEOMETRY: BoxGeometry = new BoxGeometry(1, 1, 1);

/**
 * Test-only helper — dispose the module-level geometry so a HMR
 * / test rebuild can prove the singleton is re-createable. Not
 * called in production. See module header.
 */
export function disposeSharedGeometry(): void {
  UNIT_BOX_GEOMETRY.dispose();
}
