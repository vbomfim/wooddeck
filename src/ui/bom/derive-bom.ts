/**
 * `src/ui/bom/derive-bom.ts` — S14 issue #15 §2 pure function.
 *
 * ## Responsibility (single)
 *
 * Turn a `Layout` (the render contract produced by S4) into a
 * grouped bill-of-materials list. The function is PURE — it takes
 * only its argument and returns a value; no I/O, no clock, no
 * store access. That is the whole point: the BOM derivation is
 * fully unit-testable in isolation with a golden fixture (AC6).
 *
 * ## Grouping key
 *
 * Members are grouped by the tuple
 *
 *     (kind, nominal, species, grade, eachLengthMm?)
 *
 * — every member that agrees on all five fields collapses into ONE
 * `BomLine`. Grade is INCLUDED in the key even though the ticket
 * §2 `BomLine` shape doesn't surface it (the MVP catalog only
 * stocks `No2` for wood and `NA` for composite, so a real deck
 * only has one grade per (nominal, species) combo). Keeping it in
 * the key means a future catalog expansion that mixes grades
 * (e.g. some SelectStructural joists) won't silently collapse two
 * different SKUs into one BOM line.
 *
 * ## Length semantics per kind
 *
 * The `size` field of a `LayoutMember` is the full extent along
 * each WORLD axis (`x` = width, `y` = up, `z` = length — see
 * `src/domain/model.ts` "LAYOUT COORDINATE FRAME"). The
 * "each length" of a member is the extent along its OWN axis,
 * which depends on the kind:
 *
 *   - `joist`   runs along +z            → `eachLengthMm = size.z`
 *   - `beam`    runs along +x            → `eachLengthMm = size.x`
 *   - `post`    stands along +y          → `eachLengthMm = size.y`
 *   - `board`   runs along +x OR +z      → `eachLengthMm = max(size.x, size.z)`
 *                                           (the row's face-width is
 *                                            the SMALLER dimension)
 *   - `footing` is a cube-ish block      → `eachLengthMm` is OMITTED.
 *                                           Footings are counted (a
 *                                           homeowner needs concrete
 *                                           volume, not linear
 *                                           feet) but no length is
 *                                           meaningful here.
 *
 * `totalLinearMm` is populated only for `board` — the ticket §2
 * example ("total linear feet of decking") is the canonical use.
 * For posts, joists, beams, footings the value is OMITTED (the
 * homeowner cares about count × each-length for framing members;
 * a running-total linear footage isn't the shopping unit).
 *
 * ## Sort order
 *
 * BomLines are sorted by kind in the order the ticket §2 lists:
 *
 *   1. joist  (framing)
 *   2. beam
 *   3. post
 *   4. footing
 *   5. board  (decking — top surface, the user-visible primary)
 *
 * Within a kind, entries are sorted by (nominal, species,
 * eachLengthMm) so the output is DETERMINISTIC — the golden fixture
 * test relies on this.
 *
 * ## Purity guarantees
 *
 *   - No `Date.now()`, no `Math.random()`, no store access.
 *   - Same input → same output (byte-for-byte via `JSON.stringify`).
 *   - No mutation of the input `Layout` — only reads.
 *
 * ## Boundary
 *
 * Imports ONLY from `../../domain/model` + `../../domain/units`
 * (both type-only). The dep-cruiser `ui-allowlist` permits
 * `^src/domain/` (loosened per S13 issue #14). Not a component —
 * it's a pure helper that lives under `ui/` because its OUTPUT
 * shape is UI-shaped (grouped, sorted, labelled for a table row).
 */
import type { Layout, LayoutMember, MemberKind, Species } from '../../domain/model';
import type { Mm } from '../../domain/units';

/**
 * A single row in the bill-of-materials table. Frozen contract —
 * see the module header for the field-by-field semantics.
 */
export interface BomLine {
  readonly kind: MemberKind;
  /** SKU nominal (e.g. `"2x8"`, `"5/4x6"`). */
  readonly nominal: string;
  /** Species code (`"PT"` / `"Cedar"` / `"Composite"`). */
  readonly species: Species;
  /** How many members of this exact SKU + length combination. */
  readonly count: number;
  /**
   * Per-member length in mm. OMITTED for `footing` (a footing is a
   * cube, not a linear member).
   */
  readonly eachLengthMm?: Mm;
  /**
   * Sum of per-member linear extents in mm. Populated ONLY for
   * `board` (the shopping unit for decking is "linear feet of 5/4×6"
   * — see spec § FR-011). For every other kind this is OMITTED so
   * the BOM table doesn't render a misleading total column value.
   */
  readonly totalLinearMm?: Mm;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * The canonical sort ordinal for each `MemberKind`. Framing members
 * (joist → beam → post → footing) come first, decking last — matches
 * the ticket §2 field listing and mirrors how a homeowner reads a
 * bill-of-materials (framing to finish).
 *
 * Kept as a `const` record so a new `MemberKind` fails-compile here
 * until it's assigned an ordinal (via TS `Record<MemberKind, number>`).
 *
 * S17 additions: `block` and `blocking`. Both are S19+ producer
 * outputs — the block layer emits `block`; the between-joist
 * bracing layer emits `blocking` (short lumber pieces). Ordinals
 * chosen so blocks slot at the "footing" tier (both are support-
 * layer members) and blocking sits with beams (both are secondary
 * framing). The ordering does not affect any current test; S24 will
 * finalise the BOM row order once floating designs actually flow
 * through `deriveBom`.
 */
const KIND_ORDER: Record<MemberKind, number> = {
  joist: 0,
  beam: 1,
  blocking: 2,
  post: 3,
  footing: 4,
  block: 5,
  board: 6,
};

/**
 * Compute the "each length" for a member — the extent along the
 * member's OWN axis in millimeters. Returns `null` for footings
 * (no meaningful linear extent — see module header).
 *
 * Board length is `max(size.x, size.z)` because a decking-layout
 * board's cross-section is (thickness × faceWidth) and the LONGER
 * of x/z is the run direction. The engine sets one axis to the
 * span and the other to the face-width, so `max` picks the run
 * axis without needing to know the deck's orientation.
 */
function eachLengthOf(member: LayoutMember): Mm | null {
  switch (member.kind) {
    case 'joist':
      // Joist runs +z; size.z is the length.
      return member.size.z;
    case 'beam':
      // Beam runs +x; size.x is the length.
      return member.size.x;
    case 'post':
      // Post stands +y; size.y is the height (== length).
      return member.size.y;
    case 'board':
      // Board runs along whichever of x/z is longer.
      return Math.max(member.size.x, member.size.z);
    case 'footing':
      // Footings are ~cubic; no meaningful "length".
      return null;
    case 'block':
      // Foundation blocks are ~cubic; no meaningful "length"
      // (S17 addition — S24 will finalise the BOM shape once
      // floating layouts flow through).
      return null;
    case 'blocking':
      // Blocking members are short lumber pieces installed between
      // joists — the "length" is the piece's x-run (parallel to beams).
      // S17 addition; S24 confirms once floating layouts land.
      return member.size.x;
    default: {
      // Review-gate FIX 5a — throw naming the unexpected kind so a
      // widening slip surfaces LOUDLY instead of silently returning
      // `never` (which TS erases at runtime). Matches the pattern
      // in `materialForMember` (scene/layers/shared/materials.ts).
      throw new Error(
        `derive-bom.eachLengthOf: unexpected member.kind="${(member as { kind: string }).kind}"; ` +
          `add a case above when adding to MemberKind.`,
      );
    }
  }
}

/**
 * Round to the nearest whole millimeter for grouping purposes.
 * The layout engine produces integer mm today (see
 * `materials-catalog.ts` `inToMm` — rounds at load time), but
 * `size.z = footprint.lengthMm` in some paths and `footprint.*Mm`
 * is `Mm` (an integer alias) — either way, `Math.round` is the
 * safe canonical form for a group key. See units.ts `Mm` typedef.
 */
function roundMm(value: number): Mm {
  return Math.round(value);
}

/**
 * Build the grouping key. `null` length → the length component is
 * omitted (used for footings). Keys are stringified for `Map` use.
 */
function groupKey(
  kind: MemberKind,
  nominal: string,
  species: Species,
  grade: string,
  eachLengthMm: Mm | null,
): string {
  const lengthPart = eachLengthMm === null ? '-' : String(eachLengthMm);
  return `${kind}|${nominal}|${species}|${grade}|${lengthPart}`;
}

/**
 * Mutable accumulator during the single pass over
 * `layout.members`. Turned into a frozen `BomLine` at the end so
 * consumers can't mutate the returned array's members.
 */
interface Accumulator {
  kind: MemberKind;
  nominal: string;
  species: Species;
  grade: string;
  count: number;
  eachLengthMm: Mm | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the grouped bill-of-materials from a `Layout`. Pure.
 *
 * @param layout The rendered layout to derive from. Can be empty
 *   (`layout.members === []`); returns `[]` in that case — the UI
 *   surfaces the "empty layout" copy separately.
 * @returns A stable, sorted list of {@link BomLine}s. See module
 *   header for kind ordering + intra-kind tie-breaks.
 *
 * ## S17 note — MemberMaterialRef widening
 *
 * `LayoutMember.material` is now a discriminated union
 * (`{kind:'lumber',...}` | `{kind:'block',...}`). The MVP layout
 * engine (elevated + posts-on-footings) only emits `lumber`
 * variants, so the current pass unconditionally reads the lumber
 * fields after a `kind === 'lumber'` guard. A future block-emitting
 * producer (S19 floating decks + S20 block layout) will add a
 * separate BOM row shape — S24's ticket owns that. For now, if a
 * non-lumber member is encountered it is SKIPPED with a defensive
 * inline comment — never silently miscounted.
 */
export function deriveBom(layout: Layout): readonly BomLine[] {
  // Single-pass grouping. Map key is the stringified 5-tuple.
  const groups = new Map<string, Accumulator>();

  for (const member of layout.members) {
    // S17: guard against the widened MemberMaterialRef union. The
    // S17 layout engine only stamps `kind:'lumber'` (verified by the
    // `no-unguarded-material-nominal` audit test), so any `block`
    // member here means an S19+ producer emitted BOM-uncounted
    // members ahead of the S24 BOM update. Skipping is safe (the
    // block will be re-rendered by S22's scene layer) and loud (see
    // the switch's `never` guard).
    switch (member.material.kind) {
      case 'lumber':
        break;
      case 'block':
        continue;
      default: {
        // Review-gate FIX 5a — throw naming the unexpected material
        // variant so a widening slip surfaces LOUDLY instead of
        // silently rendering an empty BOM. Matches the pattern in
        // `materialForMember` (scene/layers/shared/materials.ts).
        throw new Error(
          `derive-bom: unexpected material.kind="${(member.material as { kind: string }).kind}" ` +
            `on member '${member.id}'; add a case to the switch when adding to MemberMaterialRef.`,
        );
      }
    }
    const lumber = member.material;
    const rawLength = eachLengthOf(member);
    const eachLengthMm = rawLength === null ? null : roundMm(rawLength);
    const key = groupKey(
      member.kind,
      lumber.nominal,
      lumber.species,
      lumber.grade,
      eachLengthMm,
    );
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        kind: member.kind,
        nominal: lumber.nominal,
        species: lumber.species,
        grade: lumber.grade,
        count: 1,
        eachLengthMm,
      });
    } else {
      existing.count += 1;
    }
  }

  // Materialize + sort. The sort order is:
  //   1. kind (via KIND_ORDER — matches ticket §2 field listing)
  //   2. nominal (alphabetical — deterministic tiebreak)
  //   3. species (alphabetical)
  //   4. eachLengthMm ascending (null last)
  const rows: BomLine[] = [];
  for (const acc of groups.values()) {
    const line: BomLine = {
      kind: acc.kind,
      nominal: acc.nominal,
      species: acc.species,
      count: acc.count,
      // Populate eachLengthMm only when known.
      ...(acc.eachLengthMm !== null ? { eachLengthMm: acc.eachLengthMm } : {}),
      // totalLinearMm is populated for boards only — the shopping
      // unit for decking is "linear feet of X" (spec § FR-011).
      ...(acc.kind === 'board' && acc.eachLengthMm !== null
        ? { totalLinearMm: roundMm(acc.eachLengthMm * acc.count) }
        : {}),
    };
    rows.push(line);
  }
  rows.sort((a, b) => {
    const kindCmp = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kindCmp !== 0) return kindCmp;
    if (a.nominal !== b.nominal) return a.nominal < b.nominal ? -1 : 1;
    if (a.species !== b.species) return a.species < b.species ? -1 : 1;
    const aLen = a.eachLengthMm ?? Number.POSITIVE_INFINITY;
    const bLen = b.eachLengthMm ?? Number.POSITIVE_INFINITY;
    return aLen - bLen;
  });

  return rows;
}
