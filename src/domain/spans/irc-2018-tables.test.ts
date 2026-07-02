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
// Spacing / joist-span snap-up tolerance — Layout produces
// actualSpacing < nominal because joists are even-spaced (see
// src/domain/layout/joist-layout.ts). Without snap-up, every compliant
// design would trip the "not covered" fail-safe. Snap semantics:
// smallest TABULATED row >= input, within a small tolerance window
// so a 405-mm derived spacing is treated as the design's 406-mm intent.
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

  it('beam citation names R507.5 + species + size', () => {
    const c = IRC.citationFor('beam', ref('2x10', 'PT'), 0);
    expect(c).toMatch(/IRC-2018/);
    expect(c).toMatch(/R507\.5/);
    expect(c).toMatch(/2x10/);
    expect(c).toMatch(/Southern Pine/i);
  });
});
