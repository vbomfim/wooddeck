/**
 * `src/scene/layers/shared/materials.ts` — shared per-species
 * `MeshStandardMaterial` cache.
 *
 * ## Responsibility (single)
 *
 * Provide ONE `MeshStandardMaterial` instance per {@link Species}
 * for every scene mesh in {@link BoxMember} to bind to. Callers
 * NEVER `new MeshStandardMaterial(...)` themselves — that would
 * defeat the "shared per species" trade-off in issue #11 §17 and
 * balloon the GPU material count with `N` copies of one colour.
 *
 * ## Palette (AC6 pinned)
 *
 * The three MVP species map to distinct base colours picked to be
 * recognisable in an unlit-ish scene under a soft ambient + a
 * single key light (see `../lighting.tsx`):
 *
 *   PT         → `0x6b7a4a`  — greenish-brown olive/tan. Southern-
 *                              pine PT boards fresh from the mill
 *                              read as an olive-tan under natural
 *                              light; the copper-based treatment
 *                              adds a mild green cast.
 *   Cedar      → `0xa0623c`  — reddish-brown warm cinnamon/salmon.
 *                              Western Red Cedar's characteristic
 *                              warm heartwood tone.
 *   Composite  → `0x7a7a7a`  — neutral gray. Composite decking is
 *                              available in many colours in reality,
 *                              but the MVP catalog is a single grey
 *                              tone (Trex "Clam Shell"–like).
 *
 * The `MATERIAL_COLORS` map is EXPORTED so `materials.test.ts` can
 * assert the numerical property (green-dominant / red-dominant /
 * neutral) rather than pinning a fragile exact hex — a future
 * palette tweak still needs to preserve the recognisable species
 * cast, but the tests won't fight cosmetic adjustments.
 *
 * ## Why MeshStandardMaterial (not MeshBasicMaterial)
 *
 * `MeshStandardMaterial` responds to the ambient + directional
 * lights from `lighting.tsx`, giving each member shape and
 * shadow-side depth (SIDES read darker than the top). A
 * `MeshBasicMaterial` would draw every face at the same brightness,
 * flattening the visual read of the framing stack — the whole
 * "peel back the layers" UX depends on the visual depth cue.
 *
 * `metalness: 0` + a mid roughness match the natural-material
 * appearance and avoid PBR "wet plastic" artifacts.
 *
 * ## Memoization contract
 *
 * The module-scope `SHARED_MATERIALS` `Map` seeds materials
 * lazily on first request. Subsequent calls return the SAME
 * instance. Referential equality is the whole point — every joist
 * shares one material, every beam shares one, and so on.
 *
 * ## Disposal
 *
 * `disposeSharedMaterials()` is exported for HMR scenarios and
 * tests that want to prove the cache is not leaking across
 * renders. Real users never call it — the browser's process
 * teardown reclaims GPU handles when the tab closes.
 *
 * ## Boundary discipline
 *
 * Imports only `three` (the shared MeshStandardMaterial) and the
 * `Species` type from `../../../domain/model`. No React, no state
 * store, no drei — pure three.js utility that any scene component
 * can consume.
 */
import { MeshStandardMaterial } from 'three';

import type { LayoutMember, Species } from '../../../domain/model';
import type { FoundationCategory } from '../../../domain/foundation-catalog';
import { lookupFoundationProduct } from '../../../domain/foundation-catalog';

/**
 * The canonical hex colours for each species. Exported so tests
 * can assert the palette without hard-coding the same numbers in
 * two places. See module header for the perceptual rationale.
 */
export const MATERIAL_COLORS: Readonly<Record<Species, number>> = Object.freeze({
  PT: 0x6b7a4a,
  Cedar: 0xa0623c,
  Composite: 0x7a7a7a,
});

/**
 * Roughness applied to every species. A mid value reads as
 * "real wood" in the r3f Standard shader — 0 is chrome-mirror,
 * 1 is chalky matte. Roughness of 0.85 lands close to weathered
 * matte lumber.
 */
const WOOD_ROUGHNESS = 0.85;

/**
 * Metalness of every species. Wood and composite are non-metallic
 * — the Standard shader's PBR metal path is skipped when this is
 * 0, giving a natural diffuse look.
 */
const WOOD_METALNESS = 0;

/**
 * Module-scope cache. `Map` (not a plain object) so `.get` returns
 * `undefined` — the strictly-typed `Species | undefined` union
 * matches the code path more clearly than `k in obj` sniffing.
 */
const SHARED_MATERIALS = new Map<Species, MeshStandardMaterial>();

/**
 * Return the shared `MeshStandardMaterial` for a species,
 * constructing it on first request. Every subsequent call returns
 * the SAME instance — asserted by `materials.test.ts`.
 */
export function materialForSpecies(species: Species): MeshStandardMaterial {
  const cached = SHARED_MATERIALS.get(species);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({
    color: MATERIAL_COLORS[species],
    roughness: WOOD_ROUGHNESS,
    metalness: WOOD_METALNESS,
  });
  SHARED_MATERIALS.set(species, material);
  return material;
}

/**
 * Convenience helper — every {@link BoxMember} calls this to pick
 * its species-specific material from its `LayoutMember.material.species`
 * field. Delegates to {@link materialForSpecies}; keeps `BoxMember`
 * unaware of the cache implementation.
 *
 * ## S17 — MemberMaterialRef widening
 *
 * The layout engine now emits a discriminated union for
 * `LayoutMember.material` (lumber | block). Only the `lumber`
 * variant carries a `species` field. The MVP scene layers (S22 owns
 * the block-layer surface) currently only render lumber members, so
 * a `block` material triggers a defensive throw naming the module —
 * that surfaces upstream misuse loudly rather than silently rendering
 * with a wrong colour. S22's block layer will introduce its OWN
 * material picker and never route through this helper.
 */
export function materialForMember(member: LayoutMember): MeshStandardMaterial {
  if (member.material.kind !== 'lumber') {
    throw new Error(
      `materialForMember: expected lumber material, got kind="${member.material.kind}". ` +
        `Block-typed members must be rendered by a dedicated block layer (see Epic 2 / S22), ` +
        `not routed through src/scene/layers/shared/materials.ts.`,
    );
  }
  return materialForSpecies(member.material.species);
}

/**
 * Test-only helper — dispose every cached material and clear the
 * cache. Used by `materials.test.ts` to prove the cache is
 * rebuild-friendly. Real users never call this: the browser's
 * process teardown reclaims GPU handles.
 */
export function disposeSharedMaterials(): void {
  for (const mat of SHARED_MATERIALS.values()) {
    mat.dispose();
  }
  SHARED_MATERIALS.clear();
}

// ==========================================================
// S22 — block materials (Epic 2 / FR-029)
// ==========================================================
//
// The two MVP block products (Oldcastle precast concrete and
// TuffBlock polypropylene) render with their OWN palette — a
// concrete-precast grey and a polypropylene near-black — chosen
// so a mixed scene visually distinguishes both foundation types
// from every lumber species (see the `does not collide with any
// lumber species colour` test in materials.test.ts).
//
// The picker dispatches by `member.material.productId` → the
// foundation catalog's `FoundationCategory`, so a future third
// product in the same category shares its palette automatically.
// ==========================================================

/**
 * The canonical hex colours for each foundation-block CATEGORY.
 * Exported so tests can assert the palette without hard-coding
 * duplicate numbers.
 *
 *   concrete-precast → 0x9e9e98  — light-mid grey, "concrete pier"
 *                                  read. Distinct from Composite
 *                                  lumber's 0x7a7a7a (darker) so a
 *                                  mixed scene doesn't confuse
 *                                  "concrete block" with "composite
 *                                  decking".
 *   polypropylene    → 0x2a2a2a  — dark charcoal / near-black plastic.
 *                                  Matches TuffBlock's manufactured
 *                                  colour.
 */
export const MATERIAL_BLOCK_COLORS: Readonly<Record<FoundationCategory, number>> =
  Object.freeze({
    'concrete-precast': 0x9e9e98,
    polypropylene: 0x2a2a2a,
  });

/**
 * Concrete is rough / porous — roughness near 1 gives a diffuse,
 * matte read that matches real precast piers. Metalness stays 0
 * (concrete is not metallic).
 */
const CONCRETE_ROUGHNESS = 0.95;
const CONCRETE_METALNESS = 0;

/**
 * Polypropylene puck is slightly less rough than concrete — the
 * moulded plastic has a subtle diffuse sheen. Still non-metallic.
 * A mid-high roughness of 0.7 lands between "plastic" and "matte
 * paint" so the puck reads distinctly from the mostly-matte
 * concrete.
 */
const POLYPROPYLENE_ROUGHNESS = 0.7;
const POLYPROPYLENE_METALNESS = 0;

/**
 * Module-scope cache of block-materials keyed by category. Same
 * discipline as `SHARED_MATERIALS` — memoization returns the SAME
 * instance so every block mesh of a given category shares one
 * GPU material binding.
 */
const SHARED_BLOCK_MATERIALS = new Map<FoundationCategory, MeshStandardMaterial>();

/**
 * Roughness / metalness lookup keyed by category — kept as a
 * frozen table so a new category (e.g. `'aluminum'`) is one row
 * away.
 */
const BLOCK_PBR: Readonly<
  Record<FoundationCategory, { readonly roughness: number; readonly metalness: number }>
> = Object.freeze({
  'concrete-precast': Object.freeze({
    roughness: CONCRETE_ROUGHNESS,
    metalness: CONCRETE_METALNESS,
  }),
  polypropylene: Object.freeze({
    roughness: POLYPROPYLENE_ROUGHNESS,
    metalness: POLYPROPYLENE_METALNESS,
  }),
});

/**
 * Return the shared `MeshStandardMaterial` for a foundation
 * category. Every call for the same category returns the SAME
 * instance — same referential-equality contract as
 * {@link materialForSpecies}.
 */
function materialForBlockCategory(category: FoundationCategory): MeshStandardMaterial {
  const cached = SHARED_BLOCK_MATERIALS.get(category);
  if (cached !== undefined) return cached;
  const pbr = BLOCK_PBR[category];
  const material = new MeshStandardMaterial({
    color: MATERIAL_BLOCK_COLORS[category],
    roughness: pbr.roughness,
    metalness: pbr.metalness,
  });
  SHARED_BLOCK_MATERIALS.set(category, material);
  return material;
}

/**
 * Pick the shared block material for one block-kind
 * {@link LayoutMember}. Delegates to {@link materialForBlockCategory}
 * after resolving the member's `productId` through the foundation
 * catalog.
 *
 * ## Fail-loud on misuse
 *
 * Passing a LUMBER member here is the mirror of routing a block
 * member through {@link materialForMember} (S17 guard) — a caller
 * bug. We throw a descriptive `Error` naming the module so triage
 * is fast; there is NO silent-wrong-color fallback.
 *
 * ## Complexity
 *
 * O(1) after the first call per category — the catalog lookup is
 * an O(1) `Map.get`, and the material cache is another `Map.get`.
 */
export function materialForBlock(member: LayoutMember): MeshStandardMaterial {
  if (member.material.kind !== 'block') {
    throw new Error(
      `materialForBlock: expected block material, got kind="${member.material.kind}". ` +
        `Lumber-typed members must be rendered through materialForMember (see ` +
        `src/scene/layers/shared/materials.ts), not the block picker.`,
    );
  }
  const product = lookupFoundationProduct(member.material.productId);
  return materialForBlockCategory(product.category);
}

/**
 * Test-only helper — dispose every cached block material and clear
 * the cache. Same rationale as {@link disposeSharedMaterials} —
 * HMR / test rebuild-friendliness. Production code never calls it.
 */
export function disposeSharedBlockMaterials(): void {
  for (const mat of SHARED_BLOCK_MATERIALS.values()) {
    mat.dispose();
  }
  SHARED_BLOCK_MATERIALS.clear();
}
