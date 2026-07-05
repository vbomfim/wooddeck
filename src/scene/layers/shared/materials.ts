/**
 * `src/scene/layers/shared/materials.ts` — shared per-KIND
 * `MeshStandardMaterial` cache.
 *
 * ## Responsibility (single)
 *
 * Provide ONE `MeshStandardMaterial` instance per {@link MemberKind}
 * for every scene mesh in {@link BoxMember} and `BlocksLayer` to
 * bind to. Callers NEVER `new MeshStandardMaterial(...)` themselves
 * — that would defeat the "shared per kind" trade-off and balloon
 * the GPU material count with `N` copies of one colour.
 *
 * ## Palette — coloured by PART KIND, not by species (user directive)
 *
 * Before this file was rewritten, colour was keyed by
 * `LumberMemberMaterial.species` (PT / Cedar / Composite), so every
 * lumber member of a Pressure-Treated deck rendered in the same
 * olive-tan green — beams, joists, and blocking were visually
 * indistinguishable. The user directive for `fix/part-type-colors`
 * is: **ignore species entirely; colour each member by its
 * `MemberKind`.** A joist and a beam of the same PT stock now
 * render distinct colours; a joist of PT and a joist of Cedar
 * render the SAME colour.
 *
 * The seven `MemberKind` variants map to distinct base colours
 * picked to be recognisable in an unlit-ish scene under a soft
 * ambient + a single key light (see `../lighting.tsx`) AND
 * mutually distinguishable when the "peel back the layers" UX
 * shows several kinds side-by-side:
 *
 *   post     → `0x3e2618`  — very dark chocolate brown. Physical
 *                            pressure-treated posts read as almost
 *                            black; bottom of the luminance ladder.
 *   beam     → `0x1e40af`  — deep royal blue. Strong cool primary
 *                            per the user request. The most saturated
 *                            colour in the palette so beams are the
 *                            most visually prominent structural
 *                            element.
 *   footing  → `0x6b6b6b`  — mid concrete-pier gray. Neutral
 *                            gray to read as "concrete", distinct
 *                            from the block gray by luminance.
 *   blocking → `0x059669`  — emerald green. Cool-green hue is far
 *                            from beam blue AND from joist amber, so
 *                            the interior-framing triad (beam,
 *                            blocking, joist) reads as three clear
 *                            colours.
 *   board    → `0xb08258`  — medium wood-plank tan. Real-decking
 *                            warm brown; sits between blocking and
 *                            block on the luminance ladder.
 *   block    → `0x9e9e98`  — concrete-precast gray. PRESERVED from
 *                            the previous per-category block palette
 *                            (was `MATERIAL_BLOCK_COLORS['concrete-precast']`)
 *                            per user directive — foundation blocks
 *                            were already visually distinct.
 *   joist    → `0xf59e0b`  — warm amber. High-luminance warm hue
 *                            per the user request; distinct from
 *                            beam (cool) and blocking (green).
 *
 * The `MATERIAL_KIND_COLORS` map is EXPORTED so `materials.test.ts`
 * can assert numerical properties (warm / cool / gray / etc.)
 * rather than pinning fragile exact hexes — a future palette tweak
 * still needs to preserve each kind's recognisable cast, but tests
 * don't fight cosmetic adjustments.
 *
 * ### Colorblind considerations
 *
 * The palette varies both hue and luminance (Wong 2011 principle:
 * pairs distinguished by luminance survive every colour-vision
 * deficiency). The luminance ladder is:
 *
 *   post (0.03) < beam (0.07) < footing (0.15) < blocking (0.23)
 *   < board (0.26) < block (0.34) < joist (0.44)
 *
 * Close-luminance pairs (blocking/board, board/block) differ
 * strongly in hue (emerald vs tan; tan vs neutral gray), so they
 * remain distinguishable under deuteranopia and protanopia.
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
 * `metalness: 0` + a mid-to-high roughness match the natural-material
 * appearance and avoid PBR "wet plastic" artifacts.
 *
 * ## Memoization contract
 *
 * The module-scope `SHARED_MATERIALS` `Map` seeds materials lazily
 * on first request. Subsequent calls return the SAME instance —
 * referential equality is the whole point. Every joist mesh shares
 * one material, every beam shares one, and so on.
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
 * `LayoutMember` / `MemberKind` types from `../../../domain/model`.
 * No React, no state store, no drei — pure three.js utility that
 * any scene component can consume.
 */
import { MeshStandardMaterial } from 'three';

import type { LayoutMember, MemberKind } from '../../../domain/model';

/**
 * The canonical hex colours for each {@link MemberKind}. Exported
 * so tests can assert the palette without hard-coding the same
 * numbers in two places. See module header for the perceptual +
 * colorblind rationale for each colour.
 *
 * The `Record<MemberKind, number>` typing is exhaustive — if a
 * new kind is added to the domain model without a matching row
 * here, TypeScript fails to compile.
 */
export const MATERIAL_KIND_COLORS: Readonly<Record<MemberKind, number>> = Object.freeze({
  joist: 0xf59e0b,
  beam: 0x1e40af,
  post: 0x3e2618,
  footing: 0x6b6b6b,
  board: 0xb08258,
  block: 0x9e9e98,
  blocking: 0x059669,
});

/**
 * Roughness applied to non-concrete kinds (framing + decking).
 * A mid-to-high value reads as "real wood / painted structural
 * member" in the r3f Standard shader — 0 is chrome-mirror, 1 is
 * chalky matte. 0.85 lands close to weathered matte lumber.
 */
const LUMBER_ROUGHNESS = 0.85;

/**
 * Roughness applied to concrete-family kinds (footing + block).
 * Concrete is rough / porous — roughness near 1 gives a diffuse,
 * matte read that matches real precast piers. Kept as a separate
 * constant so a future adjustment does not touch the framing.
 */
const CONCRETE_ROUGHNESS = 0.95;

/**
 * Metalness of every kind. Wood, composite, painted steel-toned
 * finishes, and concrete are all non-metallic in this shader —
 * the Standard shader's PBR metal path is skipped when this is 0,
 * giving a natural diffuse look. Metalness of a REAL steel beam
 * would be > 0.5, but MVP scene readability prefers a uniform
 * diffuse look across kinds.
 */
const KIND_METALNESS = 0;

/**
 * Per-kind PBR (roughness + metalness) table. Concrete-family
 * kinds are declared with a higher roughness than lumber; every
 * kind is non-metallic in MVP. Kept as a frozen record so a new
 * kind added upstream is one row away (compile-enforced).
 */
const KIND_PBR: Readonly<
  Record<MemberKind, { readonly roughness: number; readonly metalness: number }>
> = Object.freeze({
  joist: Object.freeze({ roughness: LUMBER_ROUGHNESS, metalness: KIND_METALNESS }),
  beam: Object.freeze({ roughness: LUMBER_ROUGHNESS, metalness: KIND_METALNESS }),
  post: Object.freeze({ roughness: LUMBER_ROUGHNESS, metalness: KIND_METALNESS }),
  footing: Object.freeze({ roughness: CONCRETE_ROUGHNESS, metalness: KIND_METALNESS }),
  board: Object.freeze({ roughness: LUMBER_ROUGHNESS, metalness: KIND_METALNESS }),
  block: Object.freeze({ roughness: CONCRETE_ROUGHNESS, metalness: KIND_METALNESS }),
  blocking: Object.freeze({ roughness: LUMBER_ROUGHNESS, metalness: KIND_METALNESS }),
});

/**
 * Module-scope cache. `Map` (not a plain object) so `.get` returns
 * `undefined` — the strictly-typed `MemberKind | undefined` union
 * matches the code path more clearly than `k in obj` sniffing.
 */
const SHARED_MATERIALS = new Map<MemberKind, MeshStandardMaterial>();

/**
 * Return the shared `MeshStandardMaterial` for a `MemberKind`,
 * constructing it on first request. Every subsequent call for the
 * same kind returns the SAME instance — asserted by `materials.test.ts`.
 *
 * ## Complexity
 *
 * O(1) after the first call per kind — the cache is a `Map.get` +
 * reference return.
 */
export function materialForKind(kind: MemberKind): MeshStandardMaterial {
  const cached = SHARED_MATERIALS.get(kind);
  if (cached !== undefined) return cached;
  const pbr = KIND_PBR[kind];
  const material = new MeshStandardMaterial({
    color: MATERIAL_KIND_COLORS[kind],
    roughness: pbr.roughness,
    metalness: pbr.metalness,
  });
  SHARED_MATERIALS.set(kind, material);
  return material;
}

/**
 * Convenience helper — every {@link BoxMember} calls this to pick
 * its kind-specific material from its `LayoutMember.kind` field.
 * Delegates to {@link materialForKind}; keeps `BoxMember` unaware
 * of the cache implementation.
 *
 * ## S17 — MemberMaterialRef guard (retained across the kind refactor)
 *
 * The layout engine emits a discriminated union for
 * `LayoutMember.material` (lumber | block). Block-material members
 * belong to `BlocksLayer` (which needs per-productId geometry
 * dispatch) — this helper renders LUMBER members only. A block-
 * material member here triggers a defensive throw naming the module
 * so upstream misuse surfaces loudly.
 *
 * ## Kind vs material.kind
 *
 * `LayoutMember.kind` (MemberKind) is what we colour on. `LayoutMember
 * .material.kind` (lumber vs block) is what tells us which picker
 * owns the member. The `blocking` MemberKind carries a `lumber`
 * material (short 2x lumber between beams) — so `blocking` is
 * routed here, coloured by `MATERIAL_KIND_COLORS.blocking`.
 */
export function materialForMember(member: LayoutMember): MeshStandardMaterial {
  if (member.material.kind !== 'lumber') {
    throw new Error(
      `materialForMember: expected lumber material, got kind="${member.material.kind}". ` +
        `Block-typed members must be rendered by BlocksLayer (see ` +
        `src/scene/layers/BlocksLayer.tsx), not routed through ` +
        `src/scene/layers/shared/materials.ts.`,
    );
  }
  return materialForKind(member.kind);
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
// S22 — block material picker (Epic 2 / FR-029), refactored
// to route through the shared per-kind cache
// ==========================================================
//
// Before `fix/part-type-colors`, block members had their own
// per-CATEGORY palette (concrete-precast grey vs polypropylene
// near-black). The user directive removes that split and routes
// every block member through the SAME kind-level colour
// (`MATERIAL_KIND_COLORS.block`). `BlocksLayer` still uses this
// picker because it needs a block-only defensive guard (a lumber
// member here is a caller bug) and because the block geometry
// dispatch by productId lives adjacent to it.
// ==========================================================

/**
 * Pick the shared kind-material for one block-kind
 * {@link LayoutMember}. Delegates to {@link materialForKind};
 * exists so `BlocksLayer` can call ONE helper (parallel to
 * `materialForMember` for lumber layers) without touching the
 * kind-cache directly.
 *
 * ## Fail-loud on misuse
 *
 * Passing a LUMBER member here is the mirror of routing a block
 * member through {@link materialForMember} — a caller bug. We
 * throw a descriptive `Error` naming the module so triage is
 * fast; there is NO silent-wrong-color fallback.
 *
 * ## Complexity
 *
 * O(1) — the underlying `materialForKind` is O(1) after the
 * first call per kind.
 */
export function materialForBlock(member: LayoutMember): MeshStandardMaterial {
  if (member.material.kind !== 'block') {
    throw new Error(
      `materialForBlock: expected block material, got kind="${member.material.kind}". ` +
        `Lumber-typed members must be rendered through materialForMember (see ` +
        `src/scene/layers/shared/materials.ts), not the block picker.`,
    );
  }
  // Route through the shared kind cache — every block member,
  // regardless of `productId`, resolves to the SAME
  // `MATERIAL_KIND_COLORS.block` material (per user directive).
  return materialForKind('block');
}
