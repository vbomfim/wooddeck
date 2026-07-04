/**
 * `src/domain/foundation-defaults.ts` — the SINGLE source of truth
 * for "what does a fresh `<FoundationSpec>` variant look like when a
 * user first switches to it?"
 *
 * ## Why this module exists (S23 pair-fix — Opus DRY/OCP #4)
 *
 * Before extraction the four defaults (6×6 PT No2 post,
 * 300 × 300 mm footing, `tuffblock-12x12x4`, `oldcastle-11x11x7`)
 * were duplicated in THREE places:
 *
 *   1. `state/default-design.ts` — for the initial boot design
 *      (elevated + posts-on-footings variant).
 *   2. `ui/fields/StructureSelector.tsx` — for the atomic re-stamp
 *      when the user flips construction mode.
 *   3. `ui/fields/FoundationTypeSelector.tsx` — for the atomic
 *      re-stamp when the user picks a different foundation type.
 *
 * A defaults revision (a new catalog product, a footing-size change)
 * had to touch all three files in lockstep — a DRY violation and an
 * Open/Closed Principle violation (the "closed for modification"
 * intent of the frozen-catalog values was compromised every time).
 * This module owns the defaults; every caller reads through
 * `defaultFoundationFor(type)`.
 *
 * ## Contract
 *
 * `defaultFoundationFor(type)` returns a WELL-TYPED, LAYOUT-VALID
 * `FoundationSpec` of the requested variant with:
 *
 *   - `type` matching the input argument (round-trip identity).
 *   - Enough own keys to be assignable to the variant's TS type
 *     — no undefined / missing required fields.
 *   - No inherited or stray keys — `Object.keys(result)` is exactly
 *     the discriminant's required set.
 *   - A FRESH object graph on every call — nested subrecords are
 *     re-instantiated per call (defensive against a caller that
 *     illegally mutates a shared reference).
 *
 * Every catalog product id referenced here is a real entry in
 * `foundation-catalog.MVP_PRODUCTS`; the accompanying unit test
 * verifies this by round-tripping through `lookupFoundationProduct`.
 *
 * ## Why the footing dimensions are LOCAL constants (not imported)
 *
 * The canonical `FOOTING_WIDTH_MM` / `FOOTING_DEPTH_MM` values live
 * in `domain/layout/y-stack.ts` (300 mm × 300 mm — used by the
 * elevated deck's layout math). This module CANNOT import from
 * `domain/layout/**` for two orthogonal reasons:
 *
 *   1. The `ui-no-domain-layout` dep-cruiser rule forbids the UI
 *      selectors from ever touching `domain/layout/**` transitively.
 *      A UI consumer that imports `foundation-defaults` would
 *      pull the layout module along for the ride, tripping the
 *      boundary.
 *   2. Direction: `domain/layout` CONSUMES `domain/model` types and
 *      is downstream of this file semantically. Importing upstream
 *      into a defaults-provider would invert the dependency
 *      direction.
 *
 * The values are pinned as module-scope constants with a comment
 * matching the layout-module source. `default-design.test.ts` keeps
 * the invariant `spanCheck === []` — a value drift here that
 * differs from `y-stack.ts` would produce warnings on boot and be
 * caught by that regression test.
 *
 * ## Boundary
 *
 * `domain/foundation-defaults` imports ONLY from sibling
 * `./model` (type) and `./foundation-catalog` (type). It exports
 * ONE function. `dependency-cruiser`'s `domain-allowlist` permits
 * both edges.
 */
import type { FoundationSpec, MaterialRef } from './model';
import type { FoundationProductId } from './foundation-catalog';

// ==========================================================
// Pinned defaults (ticket §2 real paths — S23 issue #45)
// ==========================================================

/**
 * Default post material for a fresh `posts-on-footings` variant —
 * 6×6 PT No2. Matches `default-design.ts DEFAULT_DESIGN_PARAMS`
 * (postNominal + species + grade). Kept as a factory (not a
 * frozen singleton) so each call returns a fresh object — see
 * "no shared mutable references" in the AC4 test.
 */
function makeDefaultPost(): MaterialRef {
  return { nominal: '6x6', species: 'PT', grade: 'No2' };
}

/**
 * Default footing dimensions — 300 mm × 300 mm. Mirrors
 * `FOOTING_WIDTH_MM` / `FOOTING_DEPTH_MM` from
 * `domain/layout/y-stack.ts`; see the module header for why we do
 * NOT import them (boundary + direction). The
 * `default-design.test.ts` `spanCheck === []` invariant catches
 * any drift.
 */
const DEFAULT_FOOTING_WIDTH_MM = 300;
const DEFAULT_FOOTING_DEPTH_MM = 300;

/**
 * The preferred initial concrete-precast deck block — Oldcastle
 * 11″ × 11″ × 7″. FR-028 pinned. A future preferred SKU (e.g. a
 * rival concrete block) is a data-only revision — update this
 * literal and the catalog row; every caller picks up the new
 * default automatically.
 */
const DECK_BLOCKS_DEFAULT_PRODUCT_ID: FoundationProductId = 'oldcastle-11x11x7';

/**
 * The preferred initial polypropylene puck — TuffBlock
 * 12″ × 12″ × 4″. FR-028 pinned.
 */
const TUFFBLOCKS_DEFAULT_PRODUCT_ID: FoundationProductId = 'tuffblock-12x12x4';

// ==========================================================
// Public factory — exhaustive on FoundationSpec['type']
// ==========================================================

/**
 * Return a fresh, layout-valid `FoundationSpec` for the requested
 * variant. Every field is stamped with the module's pinned MVP
 * defaults; the caller (`StructureSelector`, `FoundationTypeSelector`,
 * `default-design`) plugs the result into an `applyParameters` patch
 * (UI callers) or the boot `DeckDesign` (state caller).
 *
 * Exhaustive `switch` with a `never` guard — a future variant added
 * to `FoundationSpec` fails-compile until this function is
 * extended.
 *
 * @param type The discriminant of the desired variant.
 */
export function defaultFoundationFor(
  type: FoundationSpec['type'],
): FoundationSpec {
  switch (type) {
    case 'posts-on-footings':
      return {
        type: 'posts-on-footings',
        post: makeDefaultPost(),
        footing: {
          widthMm: DEFAULT_FOOTING_WIDTH_MM,
          depthMm: DEFAULT_FOOTING_DEPTH_MM,
        },
      };
    case 'deck-blocks':
      return {
        type: 'deck-blocks',
        product: { productId: DECK_BLOCKS_DEFAULT_PRODUCT_ID },
      };
    case 'tuffblocks':
      return {
        type: 'tuffblocks',
        product: { productId: TUFFBLOCKS_DEFAULT_PRODUCT_ID },
      };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
