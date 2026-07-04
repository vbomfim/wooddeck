/**
 * `src/domain/materials-catalog.ts` — the static SKU → dressed-size
 * lookup for MVP wooddeck.
 *
 * ## Purpose
 *
 * Given a `(LumberNominal, Species, Grade)` triple, return the
 * canonical `Material` record — actual mm dimensions and all — that
 * the layout engine (S4) and span-check (S5) need. This is the
 * ONLY module that translates SKU identity into concrete millimeters:
 * every downstream layer goes through `lookupMaterial` rather than
 * hard-coding a size table of its own (FR-011 + spec § Assumptions).
 *
 * ## Data source (authoritative)
 *
 * Dressed (S4S, dry) sizes for softwood dimension lumber and posts
 * come from the **American Softwood Lumber Standard PS 20-20**,
 * Table 3 ("Standard Sizes of Yard Lumber"). That standard is
 * maintained by the U.S. Department of Commerce / NIST and is the
 * source WWPA (Western Wood Products Association), SPIB (Southern
 * Pine Inspection Bureau), and every other grading agency in the
 * United States uses. The same table appears verbatim in the
 * WWPA "Western Lumber Product Use Manual", Table 1.
 *
 * The MVP-relevant rows (nominal → actual, S4S, dry):
 *
 *     2×6   → 1½"  × 5½"
 *     2×8   → 1½"  × 7¼"
 *     2×10  → 1½"  × 9¼"
 *     2×12  → 1½"  × 11¼"
 *     4×4   → 3½"  × 3½"
 *     6×6   → 5½"  × 5½"
 *     5/4×6 → 1"   × 5½"    (five-quarter decking board)
 *
 * These are ROUNDED to the nearest whole millimeter using
 * `MM_PER_INCH` (see `units.ts`). The 1 mm rounding is deliberate:
 * the layout engine works in whole-millimeter footprints, and a
 * sub-millimeter dimension would break integer arithmetic downstream
 * without adding buildable-accurate precision.
 *
 * ## Composite dimensions
 *
 * Composite (Trex-style) decking is a MANUFACTURED product; every
 * brand publishes slightly different actuals. The MVP uses the same
 * dressed-size table for Composite as for softwood so the catalog
 * exposes a uniform contract to the layout engine. This is a KNOWN
 * simplification. Real-world dimensions vary — for example:
 *
 *   - Trex Enhance 5/4×6 → 0.94" × 5.5"
 *   - TimberTech AZEK Vintage 5/4×6 → 0.94" × 5.5"
 *   - Fiberon Concordia 2×6 → 1.5" × 5.5"
 *
 * Post-MVP, `Material.actual` can be broken out per-species/brand
 * with a repository-behind-a-port (Code Review Guardian finding #10).
 *
 * ## Complexity contract
 *
 * `lookupMaterial` is O(1) — the catalog builds a `Map` keyed by
 * `${nominal}|${species}|${grade}` at module-load time and reads
 * from it on every call. `listMaterials` returns the catalog as an
 * insertion-ordered array (also O(catalog size)).
 *
 * ## Stock lengths (S21 / FR-031)
 *
 * Each record also carries `stockLengthsMm` — the sorted, non-empty
 * list of standard stock-board lengths available for the SKU at
 * Home Depot Canada (verified 2026-07-04). The S21 cut-list packer
 * (`src/domain/bom/pack-cut-list.ts`) reads this field as its
 * `stockLengthsMm` input; the catalog is the single source of truth
 * so a regional catalog swap requires no packer change. See
 * `STOCK_FEET_BY_NOMINAL` below for the concrete values and rationale.
 *
 * ## Immutability & sharing
 *
 * `Material` records are frozen (`Object.freeze`) at load time so a
 * downstream mutation cannot poison another consumer's copy. The
 * catalog table itself is a module-level `const`; there is NO
 * mutation API (spec § "Materials catalog: static, checked-in
 * TypeScript module for MVP. Not user-editable.").
 */

import { MM_PER_FOOT, MM_PER_INCH } from './units';
import type { Grade, LumberNominal, Material, Species } from './model';

// ==========================================================
// Dressed-size table (authoritative — see module header for source)
// ==========================================================

/**
 * Nominal → (widthInches, heightInches) for the seven MVP SKUs.
 * Kept as a plain `Record` — the union-typed key guarantees the
 * table is EXHAUSTIVE (adding a new `LumberNominal` will fail-compile
 * here until a row is added).
 *
 * By convention `widthIn` is the SMALLER dimension (thickness, laid
 * on-edge for framing / laid flat for decking) and `heightIn` is the
 * LARGER (depth, resists bending in framing / board face-width for
 * decking). Every consumer treats the pair the same way.
 */
const DRESSED_INCHES: Record<LumberNominal, { widthIn: number; heightIn: number }> = {
  '2x6': { widthIn: 1.5, heightIn: 5.5 },
  '2x8': { widthIn: 1.5, heightIn: 7.25 },
  '2x10': { widthIn: 1.5, heightIn: 9.25 },
  '2x12': { widthIn: 1.5, heightIn: 11.25 },
  '4x4': { widthIn: 3.5, heightIn: 3.5 },
  '6x6': { widthIn: 5.5, heightIn: 5.5 },
  '5/4x6': { widthIn: 1.0, heightIn: 5.5 },
};

/**
 * Convert an inch value to whole millimeters using the ONE inch
 * constant defined in `units.ts`. We do NOT hard-code `25.4` here —
 * that literal is banned outside `units.ts` per the S2 checklist.
 */
function inToMm(inches: number): number {
  return Math.round(inches * MM_PER_INCH);
}

/**
 * Convert a foot value to whole millimeters using the ONE foot
 * constant defined in `units.ts` (which is itself derived from
 * `MM_PER_INCH`). We do NOT hard-code `304.8` here — same rationale
 * as `inToMm`. Used for the S21 `stockLengthsMm` per-SKU list, where
 * every value is expressed in feet at the catalog source.
 */
function ftToMm(feet: number): number {
  return Math.round(feet * MM_PER_FOOT);
}

// ==========================================================
// S21 issue #43 — Standard stock-board length tables (FR-031)
// ==========================================================
//
// Per-nominal list of stock-board lengths carried at the reference
// lumberyard (Home Depot Canada, verified 2026-07-04). Values are
// expressed in FEET at the source and converted to whole millimeters
// on record build via `ftToMm(feet)`.
//
// Rationale for splitting by nominal:
//
//   - 2× framing (2x6/2x8/2x10/2x12) is stocked in a common six-length
//     set: 8, 10, 12, 14, 16, 20 ft. (18 ft is a special-order size
//     for 2× framing at HD Canada and is deliberately omitted from
//     the MVP catalog.)
//   - 5/4×6 decking adds an 18 ft option — a common decking length
//     for large one-piece board runs.
//   - Posts (4×4, 6×6) are typically stocked 8, 10, 12, 14, 16 ft;
//     20 ft is not a standard retail post length.
//
// The BOM's cut-list bin-packer reads these lists per SKU (never
// hard-codes them itself), so a future regional catalog can supply a
// different list without touching the packer.

const STOCK_FEET_2X_FRAMING: readonly number[] = [8, 10, 12, 14, 16, 20];
const STOCK_FEET_5_4_DECKING: readonly number[] = [8, 10, 12, 14, 16, 18, 20];
const STOCK_FEET_POSTS: readonly number[] = [8, 10, 12, 14, 16];

/**
 * Nominal → standard stock lengths in feet. Exhaustive over
 * `LumberNominal` so adding a new SKU fails-compile here until a
 * stock list is chosen (belt-and-suspenders alongside the AC10 test).
 */
const STOCK_FEET_BY_NOMINAL: Record<LumberNominal, readonly number[]> = {
  '2x6': STOCK_FEET_2X_FRAMING,
  '2x8': STOCK_FEET_2X_FRAMING,
  '2x10': STOCK_FEET_2X_FRAMING,
  '2x12': STOCK_FEET_2X_FRAMING,
  '4x4': STOCK_FEET_POSTS,
  '6x6': STOCK_FEET_POSTS,
  '5/4x6': STOCK_FEET_5_4_DECKING,
};

// ==========================================================
// MVP SKU manifest — the (nominal, species, grade) triples the
// catalog stocks. Every triple listed here is EXPECTED to be present
// (spec FR-012 + ticket AC1). Adding a row here is a spec change.
// ==========================================================

interface CatalogSpec {
  readonly nominal: LumberNominal;
  readonly species: Species;
  readonly grade: Grade;
}

/**
 * The exact 19-SKU manifest ticket AC1 mandates. Kept as a flat list
 * (not derived by a nested loop) so the reader can grep the file for
 * a specific SKU and see immediately whether the MVP catalog stocks
 * it or not — a common on-call question.
 */
const MVP_SPECS: readonly CatalogSpec[] = [
  // 2× framing sizes — PT, Cedar, Composite (NA)
  { nominal: '2x6', species: 'PT', grade: 'No2' },
  { nominal: '2x6', species: 'Cedar', grade: 'No2' },
  { nominal: '2x6', species: 'Composite', grade: 'NA' },
  { nominal: '2x8', species: 'PT', grade: 'No2' },
  { nominal: '2x8', species: 'Cedar', grade: 'No2' },
  { nominal: '2x8', species: 'Composite', grade: 'NA' },
  { nominal: '2x10', species: 'PT', grade: 'No2' },
  { nominal: '2x10', species: 'Cedar', grade: 'No2' },
  { nominal: '2x10', species: 'Composite', grade: 'NA' },
  { nominal: '2x12', species: 'PT', grade: 'No2' },
  { nominal: '2x12', species: 'Cedar', grade: 'No2' },
  { nominal: '2x12', species: 'Composite', grade: 'NA' },
  // Post sizes — PT and Cedar only. No composite posts in MVP —
  // composite posts are a rare architectural product; a homeowner
  // deck uses softwood posts on footings and, if desired, wraps them.
  { nominal: '4x4', species: 'PT', grade: 'No2' },
  { nominal: '4x4', species: 'Cedar', grade: 'No2' },
  { nominal: '6x6', species: 'PT', grade: 'No2' },
  { nominal: '6x6', species: 'Cedar', grade: 'No2' },
  // Decking boards — PT, Cedar, Composite (NA). 5/4x6 is the most
  // common thickness for residential deck boards (~1" actual).
  { nominal: '5/4x6', species: 'PT', grade: 'No2' },
  { nominal: '5/4x6', species: 'Cedar', grade: 'No2' },
  { nominal: '5/4x6', species: 'Composite', grade: 'NA' },
];

// ==========================================================
// Build the Map + array once at module-load time.
// ==========================================================

/**
 * Canonical stringification for the composite key. Kept as a helper
 * so `lookupMaterial` and the loader agree on the key syntax with
 * ZERO chance of drift — a rename or format tweak here propagates
 * to both call sites automatically.
 */
function keyFor(nominal: LumberNominal, species: Species, grade: Grade): string {
  return `${nominal}|${species}|${grade}`;
}

function buildMaterial(spec: CatalogSpec): Material {
  const dressed = DRESSED_INCHES[spec.nominal];
  const stockFeet = STOCK_FEET_BY_NOMINAL[spec.nominal];
  // Convert once at build time, freeze the array, and share the same
  // frozen reference across every species/grade sharing the nominal.
  // The catalog is module-scope and only builds this list once per
  // record so a lightweight per-record freeze is fine (kept per-
  // record so a future per-species stock list has no migration).
  const stockLengthsMm: readonly number[] = Object.freeze(stockFeet.map(ftToMm));
  const material: Material = Object.freeze({
    nominal: spec.nominal,
    species: spec.species,
    grade: spec.grade,
    actual: Object.freeze({
      widthMm: inToMm(dressed.widthIn),
      heightMm: inToMm(dressed.heightIn),
    }),
    stockLengthsMm,
  });
  return material;
}

/**
 * Materialize the catalog exactly once. The `Map` is used for
 * O(1) `lookupMaterial`; the `readonly Material[]` mirrors it for
 * `listMaterials` and preserves MVP_SPECS insertion order (which is
 * the order used by the ticket + tests). Both are frozen so a
 * consumer cannot accidentally add or remove entries at runtime.
 */
const CATALOG: ReadonlyMap<string, Material> = (() => {
  const map = new Map<string, Material>();
  for (const spec of MVP_SPECS) {
    map.set(keyFor(spec.nominal, spec.species, spec.grade), buildMaterial(spec));
  }
  return map;
})();

const CATALOG_ARRAY: readonly Material[] = Object.freeze(Array.from(CATALOG.values()));

// ==========================================================
// Public API
// ==========================================================

/**
 * Look up the `Material` for a given `(nominal, species, grade)`
 * triple. Throws `Error` naming the offending combination when the
 * triple is not in the catalog — this is a HARD error, not a
 * fallback, because silently returning `undefined` (or a wrong-size
 * neighbor) would corrupt the layout engine's math without any
 * visible symptom.
 *
 * @throws {Error} with message `Unknown material: nominal=<N> species=<S> grade=<G>`.
 */
export function lookupMaterial(nominal: LumberNominal, species: Species, grade: Grade): Material {
  const hit = CATALOG.get(keyFor(nominal, species, grade));
  if (!hit) {
    throw new Error(
      `Unknown material: nominal=${nominal} species=${species} grade=${grade}. ` +
        `The MVP catalog does not stock this combination. ` +
        `See src/domain/materials-catalog.ts (MVP_SPECS) for the full SKU list, ` +
        `or specs/mvp-deck-designer/spec.md FR-012.`,
    );
  }
  return hit;
}

/**
 * Return every material in the catalog, in the insertion order of
 * `MVP_SPECS`. The returned array is FROZEN — mutating it (or its
 * elements) at runtime is a bug and will throw.
 */
export function listMaterials(): readonly Material[] {
  return CATALOG_ARRAY;
}
