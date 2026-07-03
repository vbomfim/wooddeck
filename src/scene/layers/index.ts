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
 *   components  EnvironmentLayer, FootingsLayer, PostsLayer,
 *               BeamsLayer, JoistsLayer, DeckingLayer
 *   component   DeckLayers               — the six-in-order bundle
 *   constant    DECK_LAYER_ORDER         — the pinned six-entry order
 *   function    materialForSpecies       — shared per-species material
 *   function    materialForMember        — helper for a LayoutMember
 *   constant    MATERIAL_COLORS          — the AC6 palette (S11 uses)
 *   type        BoxMemberProps           — reusable rectangular-member props
 *
 * ## Excluded surface
 *
 *   - `BoxMember` component itself is exported so S11's warning
 *     overlay (which highlights the SAME rectangular members with
 *     a red outline) can reuse the exact position / scale / rotation
 *     translation without re-implementing.
 *   - `disposeSharedMaterials` is test/HMR-only — imported from
 *     `./shared/materials` directly in `.test.ts` files, kept out
 *     of the barrel so a production consumer reaching for it is a
 *     red flag.
 *   - `renderKindLayer` is an internal helper for the five kind
 *     layers — NOT exported. Adding a seventh kind layer would go
 *     through this file, not through direct helper reuse.
 */

// ---- layer components ------------------------------------------------------
export { EnvironmentLayer, GROUND_PLANE_SIZE_MM, GROUND_GRID_DIVISIONS } from './EnvironmentLayer';
export { FootingsLayer } from './FootingsLayer';
export { PostsLayer } from './PostsLayer';
export { BeamsLayer } from './BeamsLayer';
export { JoistsLayer } from './JoistsLayer';
export { DeckingLayer } from './DeckingLayer';

// ---- bundle + order --------------------------------------------------------
export { DeckLayers } from './DeckLayers';
export { DECK_LAYER_ORDER } from './deck-layer-order';

// ---- shared building blocks (S11 will reuse) -------------------------------
export { BoxMember } from './shared/BoxMember';
export type { BoxMemberProps } from './shared/BoxMember';

export { MATERIAL_COLORS, materialForMember, materialForSpecies } from './shared/materials';
