/**
 * `src/domain/spans/irc-2018-tables.ts` — the static 2018 IRC deck
 * span dataset + the `SpanTable` implementation that reads it.
 *
 * ## Source of truth
 *
 * Every numeric value in this module comes from **AWC DCA 6-2015**
 * (the free re-publication of the 2018 IRC R507.5 / R507.6 tables):
 *
 *   - AWC-DCA62015-DeckGuide-1804.pdf, Page 4, Table 2
 *     "Maximum Joist Spans and Overhangs" — mirrors IRC Table R507.6
 *   - AWC-DCA62015-DeckGuide-1804.pdf, Page 6, Table 3A
 *     "Dimension Lumber Deck Beam Spans (LB) Supporting a Single
 *     Span of Joists with or without Overhangs" — mirrors IRC Table
 *     R507.5
 *
 * Load / grade / service assumptions (unchanged for every row here):
 *   Grade No.2, 40 psf live + 10 psf dead, wet-service conditions,
 *   L/360 deflection. See `docs/span-tables/README.md` for the full
 *   provenance discussion + fair-use posture.
 *
 * ## Species-group mapping (resolves the S3-deferred concern)
 *
 * The `DeckDesign.joist.material.species` union is
 * `'PT' | 'Cedar' | 'Composite'` — a MATERIAL-TREATMENT category, not
 * a structural species group. IRC R507.6 keys on structural species
 * groups (Southern Pine, DF-L/Hem-Fir/SPF, Redwood/Western Cedars).
 * This module owns the translation:
 *
 *   - `PT` → `"southern-pine"`
 *
 *     Rationale (documented in docs/span-tables/README.md §3):
 *     pressure-treated dimension lumber sold in the US is
 *     overwhelmingly Southern Yellow Pine — the treatment industry
 *     is concentrated in the Southeast where SYP grows. Choosing
 *     SYP gives the DIY user span values consistent with the
 *     lumber they will actually buy in the Southeast, Midwest, and
 *     Northeast (probably >= 70% of US installs). West-coast /
 *     Canadian PT (SPF, DF-L, Hem-Fir) yields shorter allowable
 *     spans; a homeowner in those regions gets slightly more span
 *     than IRC would strictly allow — acknowledged trade-off. A
 *     future story can add a regional / user-selectable table.
 *
 *   - `Cedar` → `"redwood-western-cedars"`
 *
 *     The IRC's "Redwood, Western Cedars, Ponderosa Pine, Red Pine"
 *     group — the ONLY R507.6 group that includes Western Cedars.
 *     Wooddeck's Cedar catalog SKU is Western Red Cedar (see
 *     model.ts) so this is a direct match.
 *
 *   - `Composite` → NOT structurally rated. Every `lookup*` call
 *     with `species === 'Composite'` returns `0` (fail-safe). See
 *     the ticket AC4 discussion + docs/span-tables/README.md §3.
 *
 * ## Snap-up tolerance (defends the Layout round-trip)
 *
 * The layout engine's even-spacing algorithm (joist-layout.ts)
 * produces `actualSpacing = (widthMm - thickness) / bayCount`, which
 * is USUALLY strictly less than the design's nominal spacing
 * (e.g., design 406 → actual ~402). Without a tolerance the table
 * lookup would always return "not covered" for compliant designs.
 *
 * Solution: for the JOIST lookup, snap the input `spacingMm` UP to
 * the nearest tabulated row within a `SPACING_TOLERANCE_MM` window
 * around each row's center. Any value FAR from a tabulated row
 * (e.g., 508 mm = 20", 700 mm) misses every window and correctly
 * fail-safes to 0 (AC4).
 *
 * `SPACING_TOLERANCE_MM = 20 mm` was chosen so:
 *
 *   - `[285, 325]` → 305 mm (12" o.c.) row
 *   - `[386, 426]` → 406 mm (16" o.c.) row
 *   - `[590, 630]` → 610 mm (24" o.c.) row
 *   - `508 mm` (20"), `700 mm`, etc. → miss every window → 0
 *
 * For the BEAM lookup, joist-span input is snapped UP to the nearest
 * whole-foot tabulated row (6/8/10/12/14/16/18 ft) because the
 * beam-span table always tabulates only integer feet of joist span.
 * Beyond 18 ft, return 0.
 *
 * ## Complexity / immutability
 *
 * Data lives in a module-level `const` (frozen). Lookups are O(1)
 * `Map.get` operations. No mutation API; consumers cannot poison
 * the table.
 */

import { MM_PER_INCH, ftInToMm, type Mm } from '../units';
import type { Grade, LumberNominal, MaterialRef, MemberKind, Species } from '../model';

import type { SpanTable } from './span-table';

// ==========================================================
// Species-group mapping — see module header for rationale
// ==========================================================

type SpeciesGroup = 'southern-pine' | 'redwood-western-cedars';

/**
 * The human-readable label for each structural species group, used
 * in `citationFor` and in fail-safe warning messages so a homeowner
 * can identify the IRC row.
 */
const SPECIES_GROUP_LABEL: Record<SpeciesGroup, string> = {
  'southern-pine': 'Southern Pine',
  'redwood-western-cedars': 'Redwood/Western Cedars',
};

/**
 * Map wooddeck's `Species` (material-treatment category) to the IRC
 * structural species group used by R507.5 / R507.6. Returns `null`
 * for `Composite` — composite framing is not IRC-rated and MUST
 * fail-safe at the lookup call sites.
 */
function speciesGroupFor(species: Species): SpeciesGroup | null {
  switch (species) {
    case 'PT':
      return 'southern-pine';
    case 'Cedar':
      return 'redwood-western-cedars';
    case 'Composite':
      return null;
    /* c8 ignore next 3 */
    default: {
      const exhaustive: never = species;
      throw new Error(`Unhandled species: ${String(exhaustive)}`);
    }
  }
}

// ==========================================================
// Joist data (Table R507.6 — via AWC DCA 6-2015 Table 2)
// ==========================================================

/**
 * Tabulated joist spacings in mm — the columns of IRC R507.6.
 * `12″ / 16″ / 24″` on-center → `305 / 406 / 610` mm.
 */
const JOIST_SPACING_ROWS_MM = [305, 406, 610] as const;
type JoistSpacingRow = (typeof JOIST_SPACING_ROWS_MM)[number];

/**
 * Snap-up tolerance around each tabulated joist spacing. See module
 * header for rationale.
 */
const SPACING_TOLERANCE_MM = 20;

/**
 * Joist size subset relevant to span lookup — MVP only tabulates 2x
 * framing sizes (2x6..2x12); posts (4x4/6x6) and decking (5/4x6) are
 * not IRC-tabulated for span. Any other `LumberNominal` returns 0.
 */
type JoistSize = '2x6' | '2x8' | '2x10' | '2x12';

/**
 * Feet-inches encoding used for source-of-truth transcription. Each
 * pair is `[ft, in]`. Converted to Mm at table-build time via
 * `ftInToMm`.
 */
type FtIn = readonly [number, number];

/**
 * Joist rows — `[size][spacingIndex] → [ft, in]`. Values transcribed
 * verbatim from AWC DCA 6-2015 Table 2:
 *
 *   - Southern Pine, No.2, wet, L/360
 *   - Redwood / Western Cedars / Ponderosa Pine / Red Pine, No.2,
 *     wet, L/360
 *
 * Column order matches `JOIST_SPACING_ROWS_MM` (12″ / 16″ / 24″).
 */
const JOIST_MAX_SPANS: Record<SpeciesGroup, Record<JoistSize, readonly [FtIn, FtIn, FtIn]>> = {
  'southern-pine': {
    '2x6': [
      [9, 11],
      [9, 0],
      [7, 7],
    ],
    '2x8': [
      [13, 1],
      [11, 10],
      [9, 8],
    ],
    '2x10': [
      [16, 2],
      [14, 0],
      [11, 5],
    ],
    '2x12': [
      [18, 0],
      [16, 6],
      [13, 6],
    ],
  },
  'redwood-western-cedars': {
    '2x6': [
      [8, 10],
      [8, 0],
      [6, 10],
    ],
    '2x8': [
      [11, 8],
      [10, 7],
      [8, 8],
    ],
    '2x10': [
      [14, 11],
      [13, 0],
      [10, 7],
    ],
    '2x12': [
      [17, 5],
      [15, 1],
      [12, 4],
    ],
  },
};

// ==========================================================
// Beam data (Table R507.5 — via AWC DCA 6-2015 Table 3A)
// ==========================================================

/**
 * Tabulated joist-span columns in the beam table, in whole FEET.
 * R507.5 covers 6, 8, 10, 12, 14, 16, 18 ft — beyond 18 ft is
 * outside the prescriptive design (footing capacity governs).
 */
const BEAM_JOIST_SPAN_ROWS_FT = [6, 8, 10, 12, 14, 16, 18] as const;
type BeamJoistSpanRow = (typeof BEAM_JOIST_SPAN_ROWS_FT)[number];
type BeamRowValues = readonly [FtIn, FtIn, FtIn, FtIn, FtIn, FtIn, FtIn];

/**
 * Same size subset as joists (2x6..2x12). The beam is built up from
 * 2x lumber (2-ply or 3-ply); MVP does not support solid 3x / 4x
 * timbers.
 */
type BeamPly = 2 | 3;

/**
 * Beam rows — `[speciesGroup][plyCount][size][joistSpanIndex] → [ft, in]`.
 * Column order matches `BEAM_JOIST_SPAN_ROWS_FT` (6/8/10/12/14/16/18 ft).
 * Values transcribed verbatim from AWC DCA 6-2015 Table 3A.
 */
const BEAM_MAX_SPANS: Record<SpeciesGroup, Record<BeamPly, Record<JoistSize, BeamRowValues>>> = {
  'southern-pine': {
    2: {
      '2x6': [
        [6, 8],
        [5, 8],
        [5, 1],
        [4, 7],
        [4, 3],
        [4, 0],
        [3, 9],
      ],
      '2x8': [
        [8, 6],
        [7, 4],
        [6, 6],
        [5, 11],
        [5, 6],
        [5, 1],
        [4, 9],
      ],
      '2x10': [
        [10, 1],
        [8, 9],
        [7, 9],
        [7, 1],
        [6, 6],
        [6, 1],
        [5, 9],
      ],
      '2x12': [
        [11, 11],
        [10, 4],
        [9, 2],
        [8, 4],
        [7, 9],
        [7, 3],
        [6, 9],
      ],
    },
    3: {
      '2x6': [
        [7, 11],
        [7, 2],
        [6, 5],
        [5, 10],
        [5, 5],
        [5, 0],
        [4, 9],
      ],
      '2x8': [
        [10, 7],
        [9, 3],
        [8, 3],
        [7, 6],
        [6, 11],
        [6, 5],
        [6, 1],
      ],
      '2x10': [
        [12, 9],
        [11, 0],
        [9, 9],
        [8, 9],
        [8, 3],
        [7, 8],
        [7, 3],
      ],
      '2x12': [
        [15, 0],
        [13, 0],
        [11, 7],
        [10, 6],
        [9, 9],
        [9, 1],
        [8, 7],
      ],
    },
  },
  'redwood-western-cedars': {
    // "3x_ or 2-2x_" column in DCA 6-2015 Table 3A — for the
    // Redwood/Western Cedars/Ponderosa Pine/Red Pine group.
    2: {
      '2x6': [
        [5, 2],
        [4, 5],
        [3, 11],
        [3, 7],
        [3, 3],
        [2, 10],
        [2, 6],
      ],
      '2x8': [
        [6, 7],
        [5, 8],
        [5, 1],
        [4, 7],
        [4, 3],
        [3, 10],
        [3, 5],
      ],
      '2x10': [
        [8, 1],
        [7, 0],
        [6, 3],
        [5, 8],
        [5, 3],
        [4, 10],
        [4, 5],
      ],
      '2x12': [
        [9, 5],
        [8, 2],
        [7, 3],
        [6, 7],
        [6, 1],
        [5, 8],
        [5, 4],
      ],
    },
    3: {
      '2x6': [
        [7, 1],
        [6, 5],
        [5, 9],
        [5, 3],
        [4, 10],
        [4, 6],
        [4, 3],
      ],
      '2x8': [
        [9, 5],
        [8, 3],
        [7, 4],
        [6, 8],
        [6, 2],
        [5, 9],
        [5, 5],
      ],
      '2x10': [
        [11, 9],
        [10, 2],
        [9, 1],
        [8, 3],
        [7, 7],
        [7, 1],
        [6, 8],
      ],
      '2x12': [
        [13, 8],
        [11, 10],
        [10, 6],
        [9, 7],
        [8, 10],
        [8, 3],
        [7, 10],
      ],
    },
  },
};

// ==========================================================
// Helpers
// ==========================================================

/**
 * Snap a raw spacingMm to the nearest tabulated joist row within
 * `SPACING_TOLERANCE_MM`. Returns `null` if the input falls outside
 * every window (i.e. no tabulated row applies — fail-safe warn).
 */
function snapJoistSpacing(spacingMm: Mm): JoistSpacingRow | null {
  for (const row of JOIST_SPACING_ROWS_MM) {
    if (Math.abs(spacingMm - row) <= SPACING_TOLERANCE_MM) return row;
  }
  return null;
}

/**
 * Snap a raw joistSpanMm to the smallest tabulated beam-row joist
 * span >= input, expressed in whole feet. Returns `null` if the
 * input exceeds the largest tabulated row (18 ft → 5486 mm) — the
 * beam is outside the prescriptive design envelope, fail-safe warn.
 *
 * The comparison uses `ftInToMm(ft, 0)` rather than `ft * MM_PER_FOOT`
 * because `ftInToMm` rounds to the nearest whole mm — a caller that
 * ALSO passes an `ftInToMm(ft, 0)` value would otherwise trip the
 * ±0.4 mm float-vs-round boundary (e.g., ftInToMm(12,0) = 3658
 * whereas 12 * MM_PER_FOOT = 3657.6). Using the same rounded value
 * on both sides keeps the "12 ft" caller in the 12-ft row.
 */
function snapBeamJoistSpan(joistSpanMm: Mm): BeamJoistSpanRow | null {
  for (const ft of BEAM_JOIST_SPAN_ROWS_FT) {
    if (joistSpanMm <= ftInToMm(ft, 0)) return ft;
  }
  return null;
}

/** Type-narrow: is the nominal one of the size rows the tables cover? */
function isJoistSize(nominal: LumberNominal): nominal is JoistSize {
  return nominal === '2x6' || nominal === '2x8' || nominal === '2x10' || nominal === '2x12';
}

/** Type-narrow: is the ply-count one the beam tables cover (2 or 3)? */
function isBeamPly(plyCount: number): plyCount is BeamPly {
  return plyCount === 2 || plyCount === 3;
}

/**
 * Convert an integer millimeter spacing to the human-friendly inches
 * label used in citation strings (e.g., 406 → `"16"`).
 * Rounded to the nearest whole inch — the ONLY tabulated spacings
 * are 12/16/24 which are exact multiples of an inch anyway; the
 * `Math.round` is defensive against the ±20 mm snap tolerance.
 */
function spacingInchesLabel(spacingMm: Mm): string {
  return String(Math.round(spacingMm / MM_PER_INCH));
}

// ==========================================================
// The IrcSpanTable class — the SpanTable implementation
// ==========================================================

/**
 * Static 2018 IRC deck-span lookup. See module header for the full
 * data provenance + species-group mapping decision.
 *
 * Rewritability check (per Developer Guardian Rules): an alternative
 * implementation (IRC-2024, NBC, mock) satisfies the same
 * `SpanTable` interface with no changes to callers. `span-check.ts`
 * imports the interface only — verified by both `dependency-cruiser`
 * (`.dependency-cruiser.cjs` layer allowlist) AND a plain
 * `readFileSync` grep in `span-check.test.ts`.
 */
export class IrcSpanTable implements SpanTable {
  readonly edition = 'IRC-2018';

  /**
   * Look up the max allowable joist span. Returns `0` for:
   *   - Composite material (not IRC-rated framing)
   *   - Non-tabulated sizes (posts / decking boards)
   *   - Non-tabulated grades (only No.2 in MVP)
   *   - Spacings outside the ±20 mm windows around 305/406/610 mm
   */
  lookupJoistMaxSpan(material: MaterialRef, spacingMm: Mm): Mm {
    if (!this._isTabulatedGrade(material.grade)) return 0;
    const group = speciesGroupFor(material.species);
    if (group === null) return 0;
    if (!isJoistSize(material.nominal)) return 0;

    const spacingRow = snapJoistSpacing(spacingMm);
    if (spacingRow === null) return 0;

    const rowValues = JOIST_MAX_SPANS[group][material.nominal];
    const idx = JOIST_SPACING_ROWS_MM.indexOf(spacingRow);
    const cell = rowValues[idx]!;
    return ftInToMm(cell[0], cell[1]);
  }

  /**
   * Look up the max allowable post-to-post beam span. Returns `0` for:
   *   - Composite material (not IRC-rated framing)
   *   - Non-tabulated sizes
   *   - Non-tabulated grades (only No.2 in MVP)
   *   - Ply-count outside {2, 3}
   *   - Joist spans exceeding 18 ft (5486 mm) — outside prescriptive
   *     design envelope
   */
  lookupBeamMaxSpan(material: MaterialRef, joistSpanMm: Mm, plyCount: number): Mm {
    if (!this._isTabulatedGrade(material.grade)) return 0;
    const group = speciesGroupFor(material.species);
    if (group === null) return 0;
    if (!isJoistSize(material.nominal)) return 0;
    if (!isBeamPly(plyCount)) return 0;

    const joistFt = snapBeamJoistSpan(joistSpanMm);
    if (joistFt === null) return 0;

    const rowValues = BEAM_MAX_SPANS[group][plyCount][material.nominal];
    const idx = BEAM_JOIST_SPAN_ROWS_FT.indexOf(joistFt);
    const cell = rowValues[idx]!;
    return ftInToMm(cell[0], cell[1]);
  }

  /**
   * Build the `Warning.tableReference` string for a member. See the
   * `SpanTable` interface doc for the semantics of the `spacingMm`
   * parameter (joist spacing when `kind === 'joist'`; ignored when
   * `kind === 'beam'`).
   *
   * Composite hits a distinct citation flavor so the S13 Warnings
   * panel can distinguish "IRC row not covered" from "material not
   * rated at all".
   */
  citationFor(kind: MemberKind, material: MaterialRef, spacingMm: Mm): string {
    if (material.species === 'Composite') {
      return (
        `${this.edition} — Composite ${material.nominal} framing is not rated by ` +
        `IRC R507; consult the manufacturer's ICC-ES listing or a licensed professional.`
      );
    }
    const group = speciesGroupFor(material.species);
    // `null` species groups were already handled above; the fall-through
    // is impossible today but future-proofs against a new Species value.
    const groupLabel = group === null ? 'unknown species' : SPECIES_GROUP_LABEL[group];
    const gradeLabel = material.grade === 'NA' ? '' : ` ${material.grade}`;

    if (kind === 'joist') {
      return (
        `${this.edition} Table R507.6 — ${groupLabel}${gradeLabel} ${material.nominal} @ ` +
        `${spacingInchesLabel(spacingMm)} in o.c.`
      );
    }
    if (kind === 'beam') {
      return `${this.edition} Table R507.5 — ${groupLabel}${gradeLabel} 2-ply ${material.nominal}`;
    }
    // post/footing/board — no IRC deck-span row applies. The MVP
    // spanCheck never emits warnings for these kinds; the branch is
    // defensive against a future kind being added upstream without
    // updating the checker.
    return `${this.edition} — ${kind} member (no span-check row).`;
  }

  /**
   * MVP tabulates ONLY No.2 grade — the "Grade No.1 or better"
   * refinement (which yields longer spans) is a v2+ enrichment. The
   * catalog `Grade` union also includes `NA` for Composite (already
   * routed to fail-safe by the species check above) and `Select`
   * (not tabulated in this MVP row set → fail-safe warn).
   */
  private _isTabulatedGrade(grade: Grade): boolean {
    return grade === 'No2';
  }
}
