/**
 * `src/domain/bom/derive-bom.ts` — S21 issue #43 FR-031 pure BOM
 * derivation (MOVED from `src/ui/bom/derive-bom.ts` and widened to
 * emit a cut-list-optimized `BomResult`).
 *
 * ## Responsibility (single)
 *
 * Turn a `Layout` (the render contract from S4) into a bill-of-
 * materials with (a) per-SKU lumber sections carrying an FFD cut-
 * list pack, and (b) a separate foundation section for block
 * products (blocks are counted, not cut).
 *
 * PURE — takes only its argument + options, returns a value. No
 * store access, no I/O. `generatedAt` is derived from `Date.now()` /
 * `new Date().toISOString()` at call time — the ONLY non-determinism
 * in the function. Every consumer that needs bit-for-bit
 * reproducibility can supply a fixed clock via `options.now` (added
 * post-S24 if needed) — the S21 MVP does not; the field is treated
 * as a display-only "generated at" stamp.
 *
 * ## Structure
 *
 *   deriveBom(layout, {kerfMm?}) → BomResult
 *     │
 *     ├── partition members by material.kind {lumber, block}
 *     │
 *     ├── LUMBER path
 *     │     group by (nominal, species, grade) → per-SKU cut-list
 *     │     look up stockLengthsMm from materials-catalog
 *     │     packCutList({cuts, stockLengthsMm, kerfMm})
 *     │     → BomSection_Lumber
 *     │
 *     └── FOUNDATION path
 *           group blocks by productId → { count }
 *           look up displayName from foundation-catalog
 *           → BomSection_Foundation
 *
 * ## Member-kind length semantics
 *
 * Every `LayoutMember.size` is the full extent along each WORLD
 * axis (`x` = deck width, `y` = up, `z` = deck length). The "cut
 * length" for the BOM is the extent along the MEMBER'S OWN axis,
 * which depends on the kind:
 *
 *   - `joist`    runs along +z  → size.z
 *   - `beam`     runs along +x  → size.x
 *   - `post`     stands along +y → size.y
 *   - `board`    runs along +x OR +z → max(size.x, size.z)
 *   - `blocking` short piece +x → size.x
 *   - `footing`  cubic — NO cut length; footing lumber members do
 *                not exist in the MVP so this branch is never hit
 *                in practice (footings are concrete, not lumber).
 *                A defensive throw guards a future footing-with-
 *                lumber surprise.
 *   - `block`    counted, not cut — skipped by the lumber path;
 *                surfaced in the foundation section instead.
 *
 * The MVP uses `getMemberLengthMm` for this; adding a new
 * `MemberKind` fails-compile at the exhaustive `switch` default
 * until a branch is added.
 *
 * ## Boundary
 *
 * Pure `src/domain/bom/**` module. Imports:
 *
 *   - `../model`               (types only: Layout, LayoutMember, …)
 *   - `../units`               (Mm type + default kerf)
 *   - `../materials-catalog`   (lookupMaterial for stockLengthsMm)
 *   - `../foundation-catalog`  (lookupFoundationProduct for displayName)
 *   - `./pack-cut-list`        (the FFD packer)
 *
 * dep-cruiser's `domain-allowlist` rule permits every `^src/domain/`
 * consumer. `src/ui/**` may import THIS module through its own barrel
 * (`src/ui/bom/index.ts` re-exports); `src/domain/bom/**` must NOT
 * import from `src/ui/**` (enforced by a boundary self-test probe —
 * see scripts/boundary-selftest.mjs BLOCK-2w).
 */
import { lookupFoundationProduct } from '../foundation-catalog';
import { lookupMaterial } from '../materials-catalog';
import type {
  FoundationProductId,
  Grade,
  Layout,
  LayoutMember,
  LumberNominal,
  Species,
} from '../model';
import type { Mm } from '../units';

import { packCutList, type PackResult } from './pack-cut-list';

// ---------------------------------------------------------------------------
// Public types (frozen contract — see ticket #43 §2)
// ---------------------------------------------------------------------------

/**
 * A lumber SKU group in the BOM. `sku` is a human-readable string
 * suitable for a table header (e.g. `"2x8 PT No2"`); the raw
 * discriminant fields (nominal, species, grade) are separately
 * available for cross-linking (via `pack.stockBoards[*].cuts[*].memberId`
 * → the original `LayoutMember`).
 *
 * `stockLengthsAvailableMm` mirrors the catalog value used at pack
 * time — surfaced for the UI so a future "increase stock size to
 * clear an AC5 error" affordance (S24+) can list the alternatives
 * without a second catalog lookup.
 *
 * `pack` is the FFD pack output — see `pack-cut-list.ts`.
 */
export interface BomSection_Lumber {
  readonly sku: string;
  readonly nominal: LumberNominal;
  readonly species: Species;
  readonly grade: Grade;
  readonly stockLengthsAvailableMm: readonly Mm[];
  readonly pack: PackResult;
}

/**
 * A foundation-product group in the BOM. Blocks are COUNTED, not
 * cut, so no pack is produced. `displayName` is the catalog's
 * human-readable name (e.g. `"TuffBlock 12″ × 12″ × 4″ …"`) —
 * safe to render as-is in the UI.
 */
export interface BomSection_Foundation {
  readonly productId: FoundationProductId;
  readonly displayName: string;
  readonly count: number;
}

/**
 * The BOM result. `lumber` sections are sorted by `sku` ascending;
 * `foundation` sections are sorted by `productId` ascending — both
 * canonical so the JSON output is byte-for-byte stable given the
 * same input (aside from `generatedAt`).
 *
 * `generatedAt` is an ISO-8601 timestamp captured at derivation
 * time. Display-only — do NOT rely on it for cache-invalidation
 * logic (use the input `layout.computedAt` for that).
 */
export interface BomResult {
  readonly lumber: readonly BomSection_Lumber[];
  readonly foundation: readonly BomSection_Foundation[];
  readonly generatedAt: string;
}

/**
 * Optional configuration. `kerfMm` defaults to `DEFAULT_KERF_MM`
 * (3 mm — see below). Ticket §17 Q1: kerfMm is not configurable in
 * the S21 UI (MVP simplification); a downstream story can lift the
 * option into the UI layer if user feedback requests it.
 */
export interface DeriveBomOptions {
  readonly kerfMm?: Mm;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default blade-width in millimeters. ~⅛" — the typical circular-
 * saw blade a homeowner uses for framing lumber. Ticket §17 Q1
 * confirmed by user.
 */
export const DEFAULT_KERF_MM: Mm = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the bill of materials from a `Layout`.
 *
 * @param layout   The rendered layout to derive from. May be empty
 *                 (`layout.members === []`) — returns
 *                 `{lumber: [], foundation: [], generatedAt}`.
 * @param options  Optional `kerfMm` override. Defaults to
 *                 `DEFAULT_KERF_MM` (3 mm).
 *
 * @throws {Error} propagates from `packCutList` when a member's cut
 *   length exceeds every stock length for its SKU. The error names
 *   the offending member id + length + max stock — enough context
 *   for the UI (S24) to surface an actionable "cut too long" hint.
 */
export function deriveBom(layout: Layout, options: DeriveBomOptions = {}): BomResult {
  const kerfMm = options.kerfMm ?? DEFAULT_KERF_MM;

  // Partition members: lumber → per-SKU grouped cuts; block → per-
  // productId counts. Anything else on `member.material.kind` is a
  // widening surprise and throws.
  const lumberGroups = new Map<string, LumberGroup>();
  const blockGroups = new Map<FoundationProductId, number>();

  for (const member of layout.members) {
    // ---- Skip footing-kind members entirely ----------------------------
    // MVP quirk: the layout engine (`domain/layout/post-layout.ts`
    // ~line 175) stamps footings with `material.kind='lumber'` as a
    // placeholder because `LayoutMember.material` is required — a
    // footing is actually CONCRETE (poured or precast). The old
    // BOM (S14) tolerated this by omitting `eachLengthMm` on
    // footing rows. S21's BomResult has no "footing" section (only
    // `lumber` and `foundation`), so a footing member belongs in
    // NEITHER — skip. When the layout engine gains a proper
    // concrete-footing material variant (post-MVP), this branch
    // will be revisited (probably a third `BomSection_Concrete`).
    if (member.kind === 'footing') continue;

    switch (member.material.kind) {
      case 'lumber': {
        const mat = member.material;
        const key = lumberGroupKey(mat.nominal, mat.species, mat.grade);
        const cutLengthMm = getMemberLengthMm(member);
        const existing = lumberGroups.get(key);
        if (existing === undefined) {
          lumberGroups.set(key, {
            nominal: mat.nominal,
            species: mat.species,
            grade: mat.grade,
            cuts: [{ memberId: member.id, lengthMm: cutLengthMm }],
          });
        } else {
          existing.cuts.push({ memberId: member.id, lengthMm: cutLengthMm });
        }
        break;
      }
      case 'block': {
        const productId = member.material.productId;
        blockGroups.set(productId, (blockGroups.get(productId) ?? 0) + 1);
        break;
      }
      default: {
        // Exhaustive check — a future MemberMaterialRef variant will
        // fail-compile HERE until a case is added. The runtime
        // throw is belt-and-suspenders (matches derive-bom's prior
        // fail-loud discipline; see the S17 pair-fix on the
        // previous implementation).
        const _exhaustive: never = member.material;
        throw new Error(
          `deriveBom: unexpected material.kind on member '${member.id}': ` +
            `${String((_exhaustive as { kind: string }).kind)}. Add a ` +
            `case to the switch when adding to MemberMaterialRef.`,
        );
      }
    }
  }

  // ---- Build lumber sections (pack + freeze + sort) --------------------
  const lumber: BomSection_Lumber[] = [];
  for (const group of lumberGroups.values()) {
    const material = lookupMaterial(group.nominal, group.species, group.grade);
    const pack = packCutList({
      cuts: group.cuts,
      stockLengthsMm: material.stockLengthsMm,
      kerfMm,
    });
    lumber.push(
      Object.freeze({
        sku: formatSku(group.nominal, group.species, group.grade),
        nominal: group.nominal,
        species: group.species,
        grade: group.grade,
        stockLengthsAvailableMm: material.stockLengthsMm,
        pack,
      }),
    );
  }
  lumber.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  // ---- Build foundation sections (count + displayName + sort) ----------
  const foundation: BomSection_Foundation[] = [];
  for (const [productId, count] of blockGroups.entries()) {
    const product = lookupFoundationProduct(productId);
    foundation.push(
      Object.freeze({
        productId,
        displayName: product.displayName,
        count,
      }),
    );
  }
  foundation.sort((a, b) =>
    a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
  );

  return Object.freeze({
    lumber: Object.freeze(lumber),
    foundation: Object.freeze(foundation),
    generatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Mutable accumulator during the single pass over `layout.members`.
 * Turned into a frozen `BomSection_Lumber` at the end.
 */
interface LumberGroup {
  nominal: LumberNominal;
  species: Species;
  grade: Grade;
  cuts: { memberId: string; lengthMm: Mm }[];
}

/**
 * Canonical group key. Kept as a helper so the loader and any future
 * consumer stringify the tuple the same way.
 */
function lumberGroupKey(nominal: LumberNominal, species: Species, grade: Grade): string {
  return `${nominal}|${species}|${grade}`;
}

/**
 * The `sku` field's display format. Kept short and grepable —
 * e.g. `"2x8 PT No2"`. The UI (S24) may reformat further; this
 * function ensures every consumer of the BOM sees the SAME text
 * for a given SKU.
 */
function formatSku(nominal: LumberNominal, species: Species, grade: Grade): string {
  return `${nominal} ${species} ${grade}`;
}

/**
 * Compute the "cut length" for a lumber member — the extent along
 * the member's OWN axis in millimeters. See module header for the
 * axis-per-kind convention. Throws when called on a footing (no
 * meaningful linear extent) or on any newly-added kind — a future
 * widening of `MemberKind` fails LOUDLY, not silently.
 */
function getMemberLengthMm(member: LayoutMember): Mm {
  switch (member.kind) {
    case 'joist':
      return member.size.z;
    case 'beam':
      return member.size.x;
    case 'post':
      return member.size.y;
    case 'board':
      // A decking board's cross-section is (thickness × faceWidth)
      // and the LONGER of x/z is the run direction. `max` picks the
      // run axis without needing to know the deck's orientation.
      return Math.max(member.size.x, member.size.z);
    case 'blocking':
      // Blocking members are short lumber pieces installed between
      // joists — the "length" is the piece's x-run (parallel to beams).
      return member.size.x;
    case 'footing':
      // Unreachable at runtime — the caller skips footing-kind
      // members before dispatching here (see the `if (member.kind
      // === 'footing') continue;` guard in `deriveBom`). Kept as a
      // fail-loud throw in case a future refactor drops the guard.
      throw new Error(
        `deriveBom.getMemberLengthMm: member '${member.id}' has kind='footing'; ` +
          `the caller must skip footing members before dispatching. This is ` +
          `a bug — footings have no linear extent and belong in neither the ` +
          `lumber nor the foundation BOM section.`,
      );
    case 'block':
      // Should never be called — the caller partitions on
      // material.kind first. Defensive throw for a bug where a
      // block-kind member somehow carries lumber material.
      throw new Error(
        `deriveBom.getMemberLengthMm: member '${member.id}' has kind='block' ` +
          `— blocks are counted via the foundation section, not the ` +
          `lumber cut-list.`,
      );
    default: {
      // Exhaustive over MemberKind — a new kind fails-compile HERE
      // until a case is added.
      const _exhaustive: never = member.kind;
      throw new Error(
        `deriveBom.getMemberLengthMm: unexpected member.kind ` +
          `"${String(_exhaustive)}"; add a case to the switch when adding ` +
          `to MemberKind.`,
      );
    }
  }
}
