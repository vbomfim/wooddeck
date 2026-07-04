/**
 * `src/ui/fields/BlockProductSelector.tsx` — S23 issue #45 AC3.
 *
 * ## Responsibility (single)
 *
 * Present a labelled `<select>` of foundation-block product IDs
 * filtered by the current `design.foundation.type`:
 *
 *   - `deck-blocks`  → `category === 'concrete-precast'`  (Oldcastle SKUs)
 *   - `tuffblocks`   → `category === 'polypropylene'`     (TuffBlock SKUs)
 *
 * When `design.foundation.type === 'posts-on-footings'` the selector
 * renders NOTHING (returns `null`) — post-supported construction
 * has no block-product field.
 *
 * On user selection dispatch `applyParameters({ foundation: {
 * type: <current>, product: { productId } } })`. Preserving `type`
 * makes the deep-merge STAY on the current variant (the S23
 * discriminator-switch REPLACE only fires when the type STRING
 * differs). The `product` sub-object is replaced wholesale so
 * a future product with different fields wouldn't leak stale keys.
 *
 * ## Extensibility note
 *
 * The MVP catalog currently ships one product per category
 * (Oldcastle for concrete-precast, TuffBlock for polypropylene).
 * Adding a third SKU (e.g. a rival concrete deck block) is a data-
 * only change in `domain/foundation-catalog.ts`; this selector
 * picks it up automatically via `listFoundationProducts()` filter.
 *
 * ## Boundary
 *
 * `ui → state` + `ui → domain/{model, foundation-catalog}`.
 */
import { useId, useMemo, type ChangeEvent, type JSX } from 'react';

import {
  listFoundationProducts,
  type FoundationCategory,
  type FoundationProductId,
} from '../../domain/foundation-catalog';
import type { DeckDesign, FoundationSpec } from '../../domain/model';
import { type DeepPartial, useDesign, useDesignStore } from '../../state';

import '../styles/tokens.css';
import '../styles/block-product-selector.css';

// ==========================================================
// Variant → catalog category mapping
// ==========================================================

/**
 * Which `FoundationCategory` do we filter for a given block-
 * carrying variant? Exhaustive on the two block-carrying types;
 * returns `null` for `posts-on-footings` — that variant has no
 * product field and the selector short-circuits before this
 * function runs.
 */
function categoryFor(
  type: FoundationSpec['type'],
): FoundationCategory | null {
  switch (type) {
    case 'deck-blocks':
      return 'concrete-precast';
    case 'tuffblocks':
      return 'polypropylene';
    case 'posts-on-footings':
      return null;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

// ==========================================================
// Component
// ==========================================================

export function BlockProductSelector(): JSX.Element | null {
  const design = useDesign();
  const selectId = useId();

  // Hooks stay unconditional (React rules-of-hooks). We compute
  // the category regardless of variant — `categoryFor` returns
  // `null` for `posts-on-footings`, and the useMemo produces an
  // empty list for that case (dropped on the floor when we bail
  // out below).
  const category = categoryFor(design.foundation.type);
  const products = useMemo(
    () =>
      category === null
        ? []
        : listFoundationProducts().filter((p) => p.category === category),
    [category],
  );

  // Single variant-narrowing guard (S23 pair-fix Opus NICE #7).
  // Replaces two structurally-equivalent early returns (a
  // `categoryFor(...) === null` check plus a `type === 'posts-…'`
  // narrow) with one check on the discriminator itself. Both
  // predicates were logically identical because `categoryFor`
  // returns `null` iff type === 'posts-on-footings'. Keying the
  // guard on the discriminator makes the intent explicit AND lets
  // TypeScript narrow `design.foundation` to the block variants
  // below — so `.product` is type-safe without a cast.
  if (design.foundation.type === 'posts-on-footings') return null;

  const currentProductId = design.foundation.product.productId;

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const productId = event.target.value as FoundationProductId;
    if (productId === currentProductId) return; // no-op

    // Preserve the discriminator (no REPLACE fires); only the
    // `product` subtree is patched.
    const patch: DeepPartial<DeckDesign> = {
      foundation: {
        type: design.foundation.type,
        product: { productId },
      },
    };
    useDesignStore.getState().applyParameters(patch);
  };

  return (
    <div className="wd-block-product-selector">
      <label htmlFor={selectId} className="wd-block-product-selector__label">
        Block product
      </label>
      <select
        id={selectId}
        className="wd-block-product-selector__select"
        value={currentProductId}
        onChange={handleChange}
      >
        {products.map((p) => (
          <option key={p.productId} value={p.productId}>
            {p.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
