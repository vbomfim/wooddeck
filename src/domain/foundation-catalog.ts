/**
 * `src/domain/foundation-catalog.ts` — the static SKU → block-product
 * lookup for MVP wooddeck (Epic 2 / S17 / FR-028).
 *
 * ## Purpose
 *
 * Given a `FoundationProductId` string literal, return the canonical
 * `FoundationProduct` record — actual mm dimensions and all — that
 * the layout engine (S19/S20), scene (S22), and BOM (S24) need. This
 * is the ONLY module that translates a block-product id into concrete
 * millimeters + capability data (which lumber the block accepts,
 * whether it carries a post pocket).
 *
 * Mirrors `materials-catalog.ts`'s discipline:
 *
 *   - Frozen records built at module-load time
 *   - Single-source-of-truth `Map` for O(1) lookup
 *   - Hard `Error` (naming this module) on unknown id — never a
 *     silent `undefined`
 *   - Dimensions computed from inches via `MM_PER_INCH` (no
 *     hard-coded `25.4` outside `units.ts`)
 *
 * ## Data source (authoritative)
 *
 * The MVP stocks two block products, both broadly available at
 * Home Depot:
 *
 *   - Oldcastle 11″ × 11″ × 7″ precast concrete deck block. The
 *     block has three slots (2× framing on top) and a central
 *     pocket sized for a 4×4 post. Actual dressed dimensions:
 *     11″ × 11″ × 7″ = 279 mm × 279 mm × 178 mm (rounded to whole
 *     mm via `inToMm`).
 *   - TuffBlock 12″ × 12″ × 4″ polypropylene "instant foundation"
 *     puck. Slotted top accepts 2× framing directly; NO post
 *     pocket (this is a floating-deck product). Actual dimensions:
 *     12″ × 12″ × 4″ = 305 mm × 305 mm × 102 mm.
 *
 * Reference URLs are hardcoded catalog literals for provenance — NOT
 * user input, so no injection surface (§6 Security of ticket #39).
 *
 * ## Complexity contract
 *
 * `lookupFoundationProduct` is O(1). `listFoundationProducts` returns
 * an insertion-ordered readonly array of every product.
 *
 * ## Immutability & sharing
 *
 * Every `FoundationProduct` record is deeply `Object.freeze`'d at
 * load time (top-level record, `actual` sub-record, `acceptsLumber`
 * array, `acceptsPost` array when not null). The top-level array
 * returned by `listFoundationProducts` is also frozen. There is NO
 * mutation API (spec § "block catalog: static, checked-in TypeScript
 * module for MVP").
 *
 * ## Layer boundary
 *
 * Pure `src/domain/**` module. Imports only from sibling `./units`
 * and `./model` (type-only). No runtime dependency on any other
 * layer. dependency-cruiser's `domain-allowlist` rule permits both.
 */
import type { LumberNominal } from './model';
import { MM_PER_INCH } from './units';
import type { Mm } from './units';

// ==========================================================
// Public types
// ==========================================================

/**
 * Stable id union for every block product the MVP catalog stocks.
 * Adding a new product = add a literal here + a row to
 * `MVP_PRODUCTS` below. Downstream consumers `switch(productId)`
 * with an exhaustive `default: never` so an omitted branch
 * fails-compile.
 */
export type FoundationProductId = 'oldcastle-11x11x7' | 'tuffblock-12x12x4';

/**
 * Product family / material category. Kept as an open (but
 * documented) union so a future addition (e.g. `'aluminum'` for
 * anchored aluminum jack stands) does not require touching the
 * `FoundationProduct` shape — only this union.
 */
export type FoundationCategory = 'concrete-precast' | 'polypropylene';

/**
 * Every field on `FoundationProduct` is declared readonly and the
 * value returned by the catalog is `Object.freeze`d recursively at
 * load time — AC7. Consumers must NOT construct these records
 * directly; use `lookupFoundationProduct(id)`.
 */
export interface FoundationProduct {
  readonly productId: FoundationProductId;
  /** Human-readable name — safe to render in the UI unchanged. */
  readonly displayName: string;
  readonly category: FoundationCategory;
  /** Actual (measured) dimensions. Whole millimeters. */
  readonly actual: {
    readonly widthMm: Mm;
    readonly depthMm: Mm;
    readonly heightMm: Mm;
  };
  /**
   * Where the block sits. `'on-grade'` = directly on prepared
   * ground / gravel bed. This is the only value for the MVP two
   * products; extended if a future product buries into the soil
   * (frost-line footing sleeve, etc.).
   */
  readonly placement: 'on-grade';
  /**
   * Which lumber nominals the block's top slot(s) accept as
   * framing. A downstream compatibility check uses this to reject a
   * design that pairs (say) a 2×12 joist with a 2×6-only block.
   */
  readonly acceptsLumber: readonly LumberNominal[];
  /**
   * If the block has a center pocket for a post (Oldcastle: yes;
   * TuffBlock: no), the array of nominals the pocket accepts.
   * `null` means "no post pocket" — floating-only product.
   */
  readonly acceptsPost: readonly LumberNominal[] | null;
  /**
   * Human-readable purchase link — sourced at spec-authoring time
   * from the vendor product page. Hardcoded literal, NEVER user
   * input; no XSS/injection surface.
   */
  readonly referenceUrl: string;
}

// ==========================================================
// Internal — inch → mm helper (same pattern as materials-catalog.ts)
// ==========================================================

/**
 * Convert an inch value to whole millimeters using the ONE inch
 * constant in `units.ts`. We do NOT hard-code `25.4` here — that
 * literal is banned outside `units.ts` per the S2 checklist.
 */
function inToMm(inches: number): Mm {
  return Math.round(inches * MM_PER_INCH);
}

// ==========================================================
// MVP product manifest — the two initial products
// ==========================================================

/**
 * Internal "spec" — the raw catalog entry BEFORE freezing. Kept as
 * a plain object literal so the reader can grep the file for a
 * specific SKU and immediately see the source-of-truth row.
 *
 * Each row records dimensions in INCHES (not mm) because the vendor
 * SKUs are labelled in inches and the reviewer / on-call
 * carpenter's mental model is imperial. The `inToMm` helper
 * converts on record build so the runtime record stores whole
 * millimeters.
 */
interface CatalogSpec {
  readonly productId: FoundationProductId;
  readonly displayName: string;
  readonly category: FoundationCategory;
  readonly widthIn: number;
  readonly depthIn: number;
  readonly heightIn: number;
  readonly placement: 'on-grade';
  readonly acceptsLumber: readonly LumberNominal[];
  readonly acceptsPost: readonly LumberNominal[] | null;
  readonly referenceUrl: string;
}

/**
 * The two products the S17 ticket §AC3 mandates. Adding a third
 * product is a spec change — update FR-028 and add a row here (and
 * the id literal at the top of the file); no other module needs to
 * change.
 */
const MVP_PRODUCTS: readonly CatalogSpec[] = [
  {
    productId: 'oldcastle-11x11x7',
    displayName: 'Oldcastle 11″ × 11″ × 7″ precast concrete deck block',
    category: 'concrete-precast',
    widthIn: 11,
    depthIn: 11,
    heightIn: 7,
    placement: 'on-grade',
    // Slots on the top face accept common framing nominals used for
    // joist rests. 2×6 / 2×8 / 2×10 are the MVP set — see FR-012
    // for the full lumber catalog.
    acceptsLumber: ['2x6', '2x8', '2x10'],
    // Center pocket sized for a 4×4 post — the classic use of an
    // Oldcastle block in the elevated-with-blocks configuration.
    acceptsPost: ['4x4'],
    referenceUrl:
      'https://www.homedepot.com/p/Oldcastle-11-in-x-11-in-x-7-in-Concrete-Deck-Block-8053112/202094188',
  },
  {
    productId: 'tuffblock-12x12x4',
    displayName: 'TuffBlock 12″ × 12″ × 4″ polypropylene instant deck foundation',
    category: 'polypropylene',
    widthIn: 12,
    depthIn: 12,
    heightIn: 4,
    placement: 'on-grade',
    // Slotted top accepts 2× framing directly. TuffBlock's marketing
    // material specifically calls out 2×6 and 2×8 joist rest —
    // reflected in the MVP subset.
    acceptsLumber: ['2x6', '2x8'],
    // NO post pocket — TuffBlock is a ground-level product; the
    // compat matrix rejects `elevated + tuffblocks` for exactly this
    // reason (see `compat-matrix.ts`, FR-030).
    acceptsPost: null,
    referenceUrl:
      'https://www.homedepot.com/p/TuffBlock-Modular-Instant-Foundation-Deck-Post-TB-Deck/319932999',
  },
];

// ==========================================================
// Freeze + index at module-load time
// ==========================================================

/**
 * Build a fully-frozen `FoundationProduct` record from a spec. Every
 * nested array / object is frozen so a downstream `Object.assign`
 * throws in strict mode (AC7).
 */
function buildProduct(spec: CatalogSpec): FoundationProduct {
  const acceptsLumber = Object.freeze([...spec.acceptsLumber]);
  const acceptsPost =
    spec.acceptsPost === null ? null : Object.freeze([...spec.acceptsPost]);
  return Object.freeze({
    productId: spec.productId,
    displayName: spec.displayName,
    category: spec.category,
    actual: Object.freeze({
      widthMm: inToMm(spec.widthIn),
      depthMm: inToMm(spec.depthIn),
      heightMm: inToMm(spec.heightIn),
    }),
    placement: spec.placement,
    acceptsLumber,
    acceptsPost,
    referenceUrl: spec.referenceUrl,
  });
}

/**
 * Materialize the catalog exactly once. The `Map` is used for O(1)
 * `lookupFoundationProduct`; the array mirrors it for
 * `listFoundationProducts` and preserves `MVP_PRODUCTS` insertion
 * order (matches the ticket + test expectations).
 */
const CATALOG: ReadonlyMap<FoundationProductId, FoundationProduct> = (() => {
  const map = new Map<FoundationProductId, FoundationProduct>();
  for (const spec of MVP_PRODUCTS) {
    map.set(spec.productId, buildProduct(spec));
  }
  return map;
})();

const CATALOG_ARRAY: readonly FoundationProduct[] = Object.freeze(
  Array.from(CATALOG.values()),
);

// ==========================================================
// Public API
// ==========================================================

/**
 * Look up the `FoundationProduct` for a given `productId`. Throws
 * `Error` naming the offending id AND naming this module when the
 * id is not in the catalog — a HARD error, not a fallback, because
 * silently returning `undefined` would corrupt downstream layout
 * math without a visible symptom. Matches the fail-loud discipline
 * of `materials-catalog.lookupMaterial`.
 *
 * @throws {Error} with message `Unknown foundation product: id=<id>` and
 *   a pointer to `src/domain/foundation-catalog.ts` for the catalog
 *   source.
 */
export function lookupFoundationProduct(id: FoundationProductId): FoundationProduct {
  const hit = CATALOG.get(id);
  if (!hit) {
    throw new Error(
      `Unknown foundation product: id="${id}". ` +
        `The MVP catalog does not stock this id. ` +
        `See src/domain/foundation-catalog.ts (MVP_PRODUCTS) for the full ` +
        `product list, or specs/mvp-deck-designer/spec.md FR-028.`,
    );
  }
  return hit;
}

/**
 * Return every product in the catalog, in the insertion order of
 * `MVP_PRODUCTS`. The returned array is FROZEN — mutating it (or its
 * elements) at runtime is a bug and will throw in strict mode.
 */
export function listFoundationProducts(): readonly FoundationProduct[] {
  return CATALOG_ARRAY;
}
