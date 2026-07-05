/**
 * `src/scene/layers/index.ts` — the public entry point for the
 * scene-layer package.
 *
 * ## Consumer contract (frozen — issue #11 §2)
 *
 * S12's `AppShell`, S11's warning overlay, and any future scene-
 * layer consumer imports from THIS barrel — never from a private
 * submodule. A submodule split / rename stays invisible to
 * downstream code.
 *
 * ## Public surface
 *
 *   components  EnvironmentLayer, FootingsLayer, BlocksLayer,
 *               PostsLayer, BeamsLayer, BlockingLayer,
 *               JoistsLayer, DeckingLayer
 *   component   DeckLayers               — the eight-in-order bundle
 *   constant    DECK_LAYER_ORDER         — the pinned eight-entry order
 *   constant    LAYER_USER_DATA_KEY      — well-known key stamped on
 *                                         every layer group's userData
 *                                         (S12/S14 can grep-find a
 *                                         group by its logical id)
 *   function    materialForKind          — shared per-kind material
 *                                          (replaces materialForSpecies)
 *   function    materialForMember        — helper for a LayoutMember
 *                                          (routes lumber members by kind)
 *   function    materialForBlock         — block-material picker for
 *                                          BlocksLayer (routes through
 *                                          the same kind map)
 *   constant    MATERIAL_KIND_COLORS     — kind → hex palette (replaces
 *                                          MATERIAL_COLORS + MATERIAL_BLOCK_COLORS)
 *   type        BoxMemberProps           — reusable rectangular-member props
 *
 * ## Excluded surface
 *
 *   - `BoxMember` component itself is exported so S11's warning
 *     overlay (which highlights the SAME rectangular members with
 *     a red outline) can reuse the exact position / scale / rotation
 *     translation without re-implementing.
 *   - `disposeSharedMaterials` / `disposeSharedGeometries` are
 *     test/HMR-only — imported from `./shared/materials` and
 *     `./shared/geometries` directly in `.test.ts` files, kept out
 *     of the barrel so a production consumer reaching for them is a
 *     red flag.
 *   - `KindLayer` is an internal helper for the kind-scoped
 *     layers — NOT exported. Adding a new kind layer would go
 *     through this file, not through direct helper reuse.
 */

// ---- layer components ------------------------------------------------------
export { EnvironmentLayer, GROUND_PLANE_SIZE_MM, GROUND_GRID_DIVISIONS } from './EnvironmentLayer';
export { FootingsLayer } from './FootingsLayer';
export { BlocksLayer } from './BlocksLayer';
export { PostsLayer } from './PostsLayer';
export { BeamsLayer } from './BeamsLayer';
export { BlockingLayer } from './BlockingLayer';
export { JoistsLayer } from './JoistsLayer';
export { DeckingLayer } from './DeckingLayer';

// ---- bundle + order --------------------------------------------------------
export { DeckLayers } from './DeckLayers';
export { DECK_LAYER_ORDER } from './deck-layer-order';
export { LAYER_USER_DATA_KEY } from './shared/kind-layer';

// ---- shared building blocks (S11 will reuse) -------------------------------
export { BoxMember } from './shared/BoxMember';
export type { BoxMemberProps } from './shared/BoxMember';

export {
  MATERIAL_KIND_COLORS,
  materialForBlock,
  materialForKind,
  materialForMember,
} from './shared/materials';
