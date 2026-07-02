/**
 * Unit tests for `src/domain/spans/irc-2018-tables.ts` — TDD RED phase.
 *
 * ## What is covered here
 *
 * These are the **golden tests** required by SC-005 and ticket AC6:
 * ≥ 8 tests, EACH NAMED with the IRC-2018 table row being validated
 * so a reviewer can trace any warning back to a specific regulatory
 * citation. Every value asserted below is transcribed from AWC DCA
 * 6-2015 Table 2 / Table 3A (the free re-publication of the 2018 IRC
 * R507.6 / R507.5 tables — see `docs/span-tables/README.md`).
 *
 * ### Golden rows in this file
 *
 * Joist (R507.6):
 *   1. Southern Pine No.2 2×6  @ 16″ o.c. → 9'-0"
 *   2. Southern Pine No.2 2×6  @ 24″ o.c. → 7'-7"        (used by AC2)
 *   3. Southern Pine No.2 2×8  @ 16″ o.c. → 11'-10"
 *   4. Southern Pine No.2 2×10 @ 16″ o.c. → 14'-0"        (used by AC1)
 *   5. Southern Pine No.2 2×12 @ 24″ o.c. → 13'-6"
 *   6. Redwood/Western Cedars No.2 2×6  @ 16″ o.c. → 8'-0"
 *   7. Redwood/Western Cedars No.2 2×10 @ 16″ o.c. → 13'-0"
 *
 * Beam (R507.5):
 *   8. 2-ply Southern Pine 2×10 @ 8-ft joist span → 8'-9"
 *   9. 2-ply Southern Pine 2×10 @ 12-ft joist span → 7'-1"
 *   10. 2-ply Redwood/W.Cedar 2×10 @ 10-ft joist span → 6'-3"
 *
 * Additional coverage: species → group mapping (PT → Southern Pine,
 * Cedar → Redwood/W.Cedars, Composite → fail-safe 0), spacing snap
 * tolerance (actualSpacing 402 → treated as 406), missing-row
 * fail-safe (spacingMm 508 or 900 → 0), citationFor formatting.
 *
 * ## Why the assertions compute allowable from ftInToMm
 *
 * `units.ts` already owns the imperial→metric constant. Test files
 * MUST NOT hard-code 304.8 / 25.4 — a drift in the constant would
 * silently pass a hard-coded assertion while breaking production
 * code. Reuse `ftInToMm(...)` and the tests catch a units regression
 * too (mirrors the pattern used in `materials-catalog.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { ftInToMm, type Mm } from '../units';
import type { MaterialRef } from '../model';

import { IrcSpanTable } from './irc-2018-tables';

// Shorthand: build a No.2 MaterialRef of the given nominal + species.
function ref(nominal: MaterialRef['nominal'], species: MaterialRef['species']): MaterialRef {
  return { nominal, species, grade: species === 'Composite' ? 'NA' : 'No2' };
}

// Convert an "X ft Y in" IRC row-cell value to canonical Mm. Values in
// the joist/beam tables are always feet-inches; this helper mirrors
// the citation string format for reviewer readability.
function ftInMm(feet: number, inches: number): Mm {
  return ftInToMm(feet, inches);
}

const IRC = new IrcSpanTable();

// ---------------------------------------------------------------------------
// Sanity checks: edition constant + Composite fail-safe (fast to run,
// isolates any table-wide misconfiguration before the golden rows fire).
// ---------------------------------------------------------------------------

describe('IrcSpanTable — edition + basic contract', () => {
  it('exposes edition = "IRC-2018"', () => {
    expect(IRC.edition).toBe('IRC-2018');
  });
});

describe('IrcSpanTable — Composite framing is not IRC-rated (fail-safe)', () => {
  it('lookupJoistMaxSpan returns 0 for Composite (any size / spacing)', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x8', 'Composite'), 406)).toBe(0);
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'Composite'), 305)).toBe(0);
  });

  it('lookupBeamMaxSpan returns 0 for Composite (any joist span / ply)', () => {
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'Composite'), 3658, 2)).toBe(0);
    expect(IRC.lookupBeamMaxSpan(ref('2x12', 'Composite'), 4877, 3)).toBe(0);
  });

  it('citationFor names the Composite fail-safe reason', () => {
    const c = IRC.citationFor('joist', ref('2x10', 'Composite'), 406);
    expect(c).toMatch(/IRC-2018/);
    expect(c.toLowerCase()).toMatch(/composite/);
    expect(c.toLowerCase()).toMatch(/not rated/);
  });
});

// ---------------------------------------------------------------------------
// Golden joist rows (AC6 — each test name cites the IRC row).
// Values transcribed from AWC DCA 6-2015 Table 2 (mirror of IRC R507.6).
// ---------------------------------------------------------------------------

describe('IrcSpanTable — Table R507.6 golden joist spans', () => {
  it('IRC-2018 R507.6 — Southern Pine No.2 2x6 @ 16 in o.c. → max 9 ft 0 in', () => {
    // PT maps to Southern Pine per the S5 species mapping decision
    // (see docs/span-tables/README.md §3).
    expect(IRC.lookupJoistMaxSpan(ref('2x6', 'PT'), 406)).toBe(ftInMm(9, 0));
  });

  it('IRC-2018 R507.6 — Southern Pine No.2 2x6 @ 24 in o.c. → max 7 ft 7 in', () => {
    // The row used by AC2 (over-span joist) — see span-check.test.ts.
    expect(IRC.lookupJoistMaxSpan(ref('2x6', 'PT'), 610)).toBe(ftInMm(7, 7));
  });

  it('IRC-2018 R507.6 — Southern Pine No.2 2x8 @ 16 in o.c. → max 11 ft 10 in', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x8', 'PT'), 406)).toBe(ftInMm(11, 10));
  });

  it('IRC-2018 R507.6 — Southern Pine No.2 2x10 @ 16 in o.c. → max 14 ft 0 in', () => {
    // The row used by AC1 (in-limit design) — see span-check.test.ts.
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 406)).toBe(ftInMm(14, 0));
  });

  it('IRC-2018 R507.6 — Southern Pine No.2 2x12 @ 24 in o.c. → max 13 ft 6 in', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x12', 'PT'), 610)).toBe(ftInMm(13, 6));
  });

  it('IRC-2018 R507.6 — Redwood/Western Cedars No.2 2x6 @ 16 in o.c. → max 8 ft 0 in', () => {
    // Cedar maps to the Redwood/Western Cedars/Ponderosa Pine/Red Pine group.
    expect(IRC.lookupJoistMaxSpan(ref('2x6', 'Cedar'), 406)).toBe(ftInMm(8, 0));
  });

  it('IRC-2018 R507.6 — Redwood/Western Cedars No.2 2x10 @ 16 in o.c. → max 13 ft 0 in', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'Cedar'), 406)).toBe(ftInMm(13, 0));
  });
});

// ---------------------------------------------------------------------------
// Golden beam rows (AC6 — each test name cites the IRC row).
// Values transcribed from AWC DCA 6-2015 Table 3A (mirror of IRC R507.5).
// ---------------------------------------------------------------------------

describe('IrcSpanTable — Table R507.5 golden beam spans', () => {
  it('IRC-2018 R507.5 — 2-ply Southern Pine 2x10 supporting 8 ft joist span → max 8 ft 9 in', () => {
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'PT'), ftInMm(8, 0), 2)).toBe(ftInMm(8, 9));
  });

  it('IRC-2018 R507.5 — 2-ply Southern Pine 2x10 supporting 12 ft joist span → max 7 ft 1 in', () => {
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'PT'), ftInMm(12, 0), 2)).toBe(ftInMm(7, 1));
  });

  it('IRC-2018 R507.5 — 2-ply Redwood/Western Cedars 2x10 supporting 10 ft joist span → max 6 ft 3 in', () => {
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'Cedar'), ftInMm(10, 0), 2)).toBe(ftInMm(6, 3));
  });
});

// ---------------------------------------------------------------------------
// Spacing snap tolerance — Layout produces actualSpacing < nominal
// because joists are even-spaced (see src/domain/layout/joist-layout.ts).
// Without a snap tolerance, every compliant design would trip the
// "not covered" fail-safe.
//
// The rule is ASYMMETRIC / DOWNWARD-ONLY (see irc-2018-tables.ts
// module header, "Snap tolerance" section) — actual spacings ABOVE
// a tabulated row NEVER snap DOWN to it, because doing so would
// give a LONGER allowable than the actual spacing warrants (an
// over-permitted false pass, called out at the PR#24 review gate).
// ---------------------------------------------------------------------------

describe('IrcSpanTable — spacing snap tolerance (Layout round-trip)', () => {
  it('accepts 402 mm as the 406-mm (16 in o.c.) row (layout derives ~402 for 16" o.c.)', () => {
    // 12-ft-wide deck with 2x10 PT joists at nominal 406 mm o.c. yields
    // actualSpacing of ~402 mm — see joist-layout.ts. The table lookup
    // must recognize this as "close enough to the 16-inch row".
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 402)).toBe(ftInMm(14, 0));
  });

  it('accepts 300 mm as the 305-mm (12 in o.c.) row', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 300)).toBe(ftInMm(16, 2));
  });

  it('accepts 605 mm as the 610-mm (24 in o.c.) row', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 605)).toBe(ftInMm(11, 5));
  });

  it('returns 0 for a spacing outside every tolerance window (e.g., 508 mm / 20 in o.c.)', () => {
    // AC4: 508 mm (20 in) is not a standard IRC row and is far enough
    // from both 406 and 610 to fall outside the snap window → 0.
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 508)).toBe(0);
  });

  it('returns 0 for a spacing beyond the largest tabulated row (e.g., 900 mm)', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 900)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Snap-policy safety regression (PR#24 blocking finding #1 — GPT-HIGH +
// Opus-LOW #5, reconciled toward safety by the user).
//
// The PREVIOUS symmetric ±20 mm snap window was OPTIMISTIC when the
// actual spacing sat ABOVE a tabulated row: an actual of 419 mm would
// snap DOWN to 406 and return the 16-inch allowable (LONGER than
// warranted → false pass). The new asymmetric downward-only rule
// (module header §"Snap tolerance") must:
//   1. NEVER map an above-row actual to that row's allowable.
//   2. Continue to accept legitimate layout drift BELOW a row.
//   3. Fail-safe (return 0) for any actual that sits strictly between
//      rows (per AC4).
//
// These tests are the "before/after" regression for that fix.
// ---------------------------------------------------------------------------

describe('IrcSpanTable — snap-policy safety regression (never optimistic)', () => {
  // The five actual-spacing values 407..426 mm all sit ABOVE the 406-mm
  // row and would have snapped DOWN to it under the OLD symmetric rule.
  // Every one MUST fail-safe under the new rule — this is the exact
  // false-pass class the reviewer flagged as safety-blocking.
  for (const above406 of [407, 410, 415, 419, 426]) {
    it(`does NOT snap ${above406} mm (above the 406-mm row) DOWN to 406 → fail-safe`, () => {
      expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), above406)).toBe(0);
    });
  }

  it('exact-boundary: 406 mm (row) snaps to 406', () => {
    // Row edge — inclusive.
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 406)).toBe(ftInMm(14, 0));
  });

  it('exact-boundary: 405 mm (1 mm below row) snaps to 406 (drift case)', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 405)).toBe(ftInMm(14, 0));
  });

  it('exact-boundary: 407 mm (1 mm above row) → fail-safe 0 (never optimistic)', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 407)).toBe(0);
  });

  it('exact-boundary: 381 mm (25 mm below 406) snaps to 406 (edge of drift window)', () => {
    // SPACING_DOWNWARD_TOLERANCE_MM = 25 → 381 is the LAST value that
    // still snaps up to 406. 380 must fail-safe.
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 381)).toBe(ftInMm(14, 0));
  });

  it('exact-boundary: 380 mm (26 mm below 406) → fail-safe 0 (past drift window)', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 380)).toBe(0);
  });

  it('between-rows: 450 mm → fail-safe (not snapped DOWN to 406, not close enough UP to 610)', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 450)).toBe(0);
  });

  it('between-rows: 500 mm (approx a 508-mm-nominal design after layout drift) → fail-safe', () => {
    expect(IRC.lookupJoistMaxSpan(ref('2x10', 'PT'), 500)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// IRC data-integrity invariants (PR#24 blocking finding #2 — QA-G1).
//
// Only ~8% of the 136 transcribed table cells are spot-checked by the
// golden tests above. A wrong digit ANYWHERE in the rest would be
// currently undetectable. These invariants exercise the ENTIRE dataset
// as pure inequalities (no hand numbers) — a single flipped digit
// breaks monotonicity and this suite fails.
//
// Physical laws being asserted:
//   G1c  Deeper joists span farther (fixed species + spacing, 2x6<2x8<2x10<2x12).
//   G1d  Tighter joist spacing spans farther (fixed size, @305 > @406 > @610).
//   G1e  Shorter tributary joist span → beam spans farther (@6ft > @8ft > … > @18ft).
//   G1f  More plies span farther (fixed size + joistSpan, 3-ply > 2-ply).
//   Positivity/no-gap: every catalog SKU × standard spacing is either
//     strictly > 0 (real tabulated row) OR exactly 0 (documented
//     fail-safe) — never NaN/undefined/negative.
// ---------------------------------------------------------------------------

describe('IrcSpanTable — data-integrity invariants (QA-G1, full-table coverage)', () => {
  const JOIST_SPECIES: MaterialRef['species'][] = ['PT', 'Cedar'];
  const JOIST_SIZES: MaterialRef['nominal'][] = ['2x6', '2x8', '2x10', '2x12'];
  const JOIST_SPACINGS: Mm[] = [305, 406, 610];
  const BEAM_PLIES = [2, 3] as const;
  // Whole-foot joist-span columns of R507.5 (avoids MM_PER_FOOT
  // constant leak — sizes are exact integers, ftInToMm handles conversion).
  const BEAM_JOIST_SPAN_FT: number[] = [6, 8, 10, 12, 14, 16, 18];

  describe('G1c — size monotonicity (2x6 < 2x8 < 2x10 < 2x12) for every species+spacing', () => {
    for (const species of JOIST_SPECIES) {
      for (const spacing of JOIST_SPACINGS) {
        it(`${species} @ ${spacing} mm: 2x6 < 2x8 < 2x10 < 2x12`, () => {
          const spans = JOIST_SIZES.map((n) =>
            IRC.lookupJoistMaxSpan(ref(n, species), spacing),
          );
          // Every value must be > 0 (this is a fully-tabulated slice).
          for (const s of spans) {
            expect(s).toBeGreaterThan(0);
            expect(Number.isFinite(s)).toBe(true);
          }
          // Strictly increasing.
          for (let i = 1; i < spans.length; i++) {
            expect(spans[i]).toBeGreaterThan(spans[i - 1]!);
          }
        });
      }
    }
  });

  describe('G1d — spacing monotonicity (@305 > @406 > @610) for every species+size', () => {
    for (const species of JOIST_SPECIES) {
      for (const size of JOIST_SIZES) {
        it(`${species} ${size}: @305 > @406 > @610`, () => {
          const spans = JOIST_SPACINGS.map((s) =>
            IRC.lookupJoistMaxSpan(ref(size, species), s),
          );
          for (const s of spans) {
            expect(s).toBeGreaterThan(0);
            expect(Number.isFinite(s)).toBe(true);
          }
          // Strictly DECREASING (tighter spacing → shorter tributary
          // per joist → longer allowable → larger index = wider spacing = smaller value).
          for (let i = 1; i < spans.length; i++) {
            expect(spans[i]).toBeLessThan(spans[i - 1]!);
          }
        });
      }
    }
  });

  describe('G1e — beam joist-span monotonicity (@6ft > @8ft > … > @18ft) for every species+size+ply', () => {
    for (const species of JOIST_SPECIES) {
      for (const ply of BEAM_PLIES) {
        for (const size of JOIST_SIZES) {
          it(`${ply}-ply ${species} ${size}: @6ft > @8ft > @10ft > @12ft > @14ft > @16ft > @18ft`, () => {
            const spans = BEAM_JOIST_SPAN_FT.map((ft) =>
              IRC.lookupBeamMaxSpan(ref(size, species), ftInMm(ft, 0), ply),
            );
            for (const s of spans) {
              expect(s).toBeGreaterThan(0);
              expect(Number.isFinite(s)).toBe(true);
            }
            for (let i = 1; i < spans.length; i++) {
              expect(spans[i]).toBeLessThan(spans[i - 1]!);
            }
          });
        }
      }
    }
  });

  describe('G1f — beam ply monotonicity (3-ply > 2-ply) for every species+size+joistSpan', () => {
    for (const species of JOIST_SPECIES) {
      for (const size of JOIST_SIZES) {
        for (const jsFt of BEAM_JOIST_SPAN_FT) {
          it(`${species} ${size} @ ${jsFt}-ft joist span: 3-ply > 2-ply`, () => {
            const twoPly = IRC.lookupBeamMaxSpan(ref(size, species), ftInMm(jsFt, 0), 2);
            const threePly = IRC.lookupBeamMaxSpan(ref(size, species), ftInMm(jsFt, 0), 3);
            expect(twoPly).toBeGreaterThan(0);
            expect(threePly).toBeGreaterThan(0);
            expect(threePly).toBeGreaterThan(twoPly);
          });
        }
      }
    }
  });

  describe('positivity / no-gap — every catalog SKU × standard spacing is > 0 OR documented fail-safe 0', () => {
    it('joist lookups: every (rated species) × (tabulated size) × (tabulated spacing) is > 0', () => {
      // Composite is documented fail-safe; every other combination
      // MUST be a real tabulated cell (no unmapped gaps).
      for (const species of JOIST_SPECIES) {
        for (const size of JOIST_SIZES) {
          for (const spacing of JOIST_SPACINGS) {
            const v = IRC.lookupJoistMaxSpan(ref(size, species), spacing);
            expect(v).toBeGreaterThan(0);
            expect(Number.isFinite(v)).toBe(true);
          }
        }
      }
    });

    it('beam lookups: every (rated species) × (tabulated size) × (tabulated ply) × (whole-ft joistSpan) is > 0', () => {
      for (const species of JOIST_SPECIES) {
        for (const size of JOIST_SIZES) {
          for (const ply of BEAM_PLIES) {
            for (const jsFt of BEAM_JOIST_SPAN_FT) {
              const v = IRC.lookupBeamMaxSpan(ref(size, species), ftInMm(jsFt, 0), ply);
              expect(v).toBeGreaterThan(0);
              expect(Number.isFinite(v)).toBe(true);
            }
          }
        }
      }
    });

    it('Composite lookups: every (size) × (spacing OR joistSpan OR ply) returns exactly 0 (documented fail-safe)', () => {
      for (const size of JOIST_SIZES) {
        for (const spacing of JOIST_SPACINGS) {
          expect(IRC.lookupJoistMaxSpan(ref(size, 'Composite'), spacing)).toBe(0);
        }
        for (const ply of BEAM_PLIES) {
          for (const jsFt of BEAM_JOIST_SPAN_FT) {
            expect(IRC.lookupBeamMaxSpan(ref(size, 'Composite'), ftInMm(jsFt, 0), ply)).toBe(0);
          }
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Untabulated grades / sizes — the MVP tabulates ONLY the 'No2' grade
// (see IrcSpanTable._isTabulatedGrade) and 2x6/2x8/2x10/2x12 sizes. Every
// other combination MUST fail-safe rather than silently fall back to a
// default (QA-G6, QA-G10).
// ---------------------------------------------------------------------------

describe('IrcSpanTable — untabulated grade / size fail-safe (QA-G6, QA-G10)', () => {
  it('untabulated grade "Select" (Southern Pine) → fail-safe 0', () => {
    const m: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'Select' };
    expect(IRC.lookupJoistMaxSpan(m, 406)).toBe(0);
    expect(IRC.lookupBeamMaxSpan(m, ftInMm(8, 0), 2)).toBe(0);
  });

  it('untabulated grade "No1" (Cedar) → fail-safe 0', () => {
    const m: MaterialRef = { nominal: '2x8', species: 'Cedar', grade: 'No1' };
    expect(IRC.lookupJoistMaxSpan(m, 406)).toBe(0);
    expect(IRC.lookupBeamMaxSpan(m, ftInMm(8, 0), 2)).toBe(0);
  });

  it('untabulated size "6x6" (a post SKU, not a joist) → fail-safe 0', () => {
    const m: MaterialRef = { nominal: '6x6', species: 'PT', grade: 'No2' };
    expect(IRC.lookupJoistMaxSpan(m, 406)).toBe(0);
    expect(IRC.lookupBeamMaxSpan(m, ftInMm(8, 0), 2)).toBe(0);
  });

  it('untabulated size "5/4x6" (a decking board, not a joist) → fail-safe 0', () => {
    const m: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };
    expect(IRC.lookupJoistMaxSpan(m, 406)).toBe(0);
  });
});

describe('IrcSpanTable — beam joist-span snap-up (Layout beam-to-beam is not always a whole ft)', () => {
  it('4577 mm (a 16-ft-length deck\'s beam-to-beam distance) maps to the 16-ft (4877 mm) beam row', () => {
    // The beam-span table rows are keyed on the JOIST SPAN in whole
    // feet (6/8/10/12/14/16/18). A 16-ft-length deck produces a
    // joist span of ~4577 mm (< 16 ft = 4877 mm). Snap-up finds the
    // smallest tabulated joist-span row >= 4577 → the 16-ft row.
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'PT'), 4577, 2)).toBe(ftInMm(6, 1));
  });

  it('a joist span exceeding 18 ft (max tabulated) → fail-safe 0', () => {
    // Beyond the largest tabulated joist-span row (18 ft = 5486 mm) →
    // "not covered", conservative-warn per AC4.
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'PT'), 6000, 2)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ply-count coverage: the IRC table has BOTH 2-ply and 3-ply columns.
// MVP defaults beams to 2-ply (see spanCheck), but the interface must
// let a future story pass 3.
// ---------------------------------------------------------------------------

describe('IrcSpanTable — ply-count coverage', () => {
  it('IRC-2018 R507.5 — 3-ply Southern Pine 2x10 supporting 8 ft joist span → max 11 ft 0 in', () => {
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'PT'), ftInMm(8, 0), 3)).toBe(ftInMm(11, 0));
  });

  it('rejects unsupported ply-counts (1, 4+) as fail-safe 0', () => {
    // MVP only tabulates 2-ply and 3-ply beams (IRC R507.5 only
    // covers those). A 1-ply or 4-ply beam is not a prescriptive
    // assembly — fail-safe warn.
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'PT'), ftInMm(8, 0), 1)).toBe(0);
    expect(IRC.lookupBeamMaxSpan(ref('2x10', 'PT'), ftInMm(8, 0), 4)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// citationFor — the string a Warning carries as `tableReference`. Two
// requirements:
//   1. Names the edition + section number (regulatory traceability)
//   2. Names the size + species-group + parameter (spacing for joists,
//      irrelevant for beams — passed as 0 by spanCheck).
// ---------------------------------------------------------------------------

describe('IrcSpanTable — citationFor', () => {
  it('joist citation names R507.6 + Southern Pine + size + spacing', () => {
    const c = IRC.citationFor('joist', ref('2x8', 'PT'), 406);
    expect(c).toMatch(/IRC-2018/);
    expect(c).toMatch(/R507\.6/);
    expect(c).toMatch(/Southern Pine/i);
    expect(c).toMatch(/2x8/);
    // 406 mm ≈ 16" — either the mm or the inch form is acceptable so
    // long as one is present so a user can find the row.
    expect(c).toMatch(/(406|16)/);
  });

  it('joist citation names Redwood/Western Cedars for Cedar', () => {
    const c = IRC.citationFor('joist', ref('2x10', 'Cedar'), 406);
    expect(c).toMatch(/Redwood.*(Western )?Cedars/i);
  });

  it('beam citation names R507.5 + species + size (joist span omitted when 0)', () => {
    // Passing 0 for the joist-span parameter is the "unknown" convention.
    // The citation must degrade gracefully and NOT emit a spurious
    // "supporting 0 ft" clause.
    const c = IRC.citationFor('beam', ref('2x10', 'PT'), 0);
    expect(c).toMatch(/IRC-2018/);
    expect(c).toMatch(/R507\.5/);
    expect(c).toMatch(/2x10/);
    expect(c).toMatch(/Southern Pine/i);
    expect(c).not.toMatch(/supporting 0/);
  });

  it('beam citation includes the joist-span COLUMN it was looked up from (Code Review PR#24 GPT#2)', () => {
    // A tributary joist span of 14 ft (4267 mm) must produce a
    // citation naming the "14 ft joist span" column. This gives the
    // homeowner an unambiguous R507.5 row to look up.
    const c = IRC.citationFor('beam', ref('2x10', 'PT'), ftInMm(14, 0));
    expect(c).toMatch(/R507\.5/);
    expect(c).toMatch(/supporting 14 ft joist span/);
  });

  it('beam citation snaps the joist-span to the tabulated whole-ft column', () => {
    // A tributary joist span of 4577 mm (~15.02 ft) is not a whole
    // foot but snaps UP to the 16-ft R507.5 column. The citation
    // must name the SNAPPED column so it agrees with the allowable
    // that `lookupBeamMaxSpan` returned for the same input.
    const c = IRC.citationFor('beam', ref('2x10', 'PT'), 4577);
    expect(c).toMatch(/supporting 16 ft joist span/);
  });

  it('beam citation for a joist-span beyond 18 ft drops the "supporting" clause (uncovered column)', () => {
    // 20 ft joist span is outside every tabulated column — the
    // citation should be honest and NOT claim a bogus column.
    const c = IRC.citationFor('beam', ref('2x10', 'PT'), ftInMm(20, 0));
    expect(c).toMatch(/R507\.5/);
    expect(c).not.toMatch(/supporting \d+ ft/);
  });
});
