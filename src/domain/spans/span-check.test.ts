/**
 * Unit tests for `src/domain/spans/span-check.ts` — TDD RED phase.
 *
 * Covers every acceptance criterion in GitHub issue #6:
 *
 *   - AC1  In-limit design → `spanCheck` returns `[]`.
 *   - AC2  Over-span joist (2x6 PT @ 24" o.c. on a 16-ft-length deck)
 *          → one Warning per joist with the right numbers + citation.
 *   - AC3  Mock SpanTable returning 10000 mm → design spanning 8000 mm
 *          returns `[]` (checker uses the abstraction).
 *   - AC4  Missing table row (spacing 508 mm / 20" o.c.) → Warning
 *          with allowableMm: 0 and message containing "not covered".
 *   - Edge: empty layout → `[]`.
 *   - Boundary: span == allowable → NOT a warning.
 *   - Boundary: span == allowable + 1 mm → IS a warning.
 *   - Ordering: warnings returned in memberId lexicographic order.
 *   - Interface discipline: `span-check.ts` MUST NOT import from
 *     `./irc-2018-tables` (Code Review Guardian finding #4 — the
 *     checker depends only on the `SpanTable` interface). Enforced
 *     here by a plain `readFileSync` grep so a future change is
 *     caught even if dep-cruiser is misconfigured.
 *
 * ## Why we drive most tests via `computeLayout` instead of hand-built
 * ## Layout objects
 *
 * `spanCheck` derives the joist span from the DISTANCE BETWEEN the
 * two supporting beams (`beam.position.z` max − min) and the beam
 * post-to-post span from the DISTANCE BETWEEN adjacent posts on the
 * same beam (posts grouped by `.position.z`). Driving with a real
 * `computeLayout(design)` output means:
 *
 *   1. If the layout engine ever changes its coordinate frame or
 *      beam inset, the tests re-derive expected values from
 *      `FOOTING_WIDTH_MM` and stay green — they don't hard-code
 *      "4577 mm" as a magic number.
 *   2. The test fixture matches the shape the state layer (S7) will
 *      actually hand to `spanCheck` in production.
 *
 * Where a hand-built Layout is CLEARER (empty-layout edge, mock
 * table swap), we build it directly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT, ftInToMm, type Mm } from '../units';
import type { DeckDesign, Layout, LayoutMember, MaterialRef, MemberKind } from '../model';
import { computeLayout } from '../layout';
import { FOOTING_WIDTH_MM } from '../layout';

import { IrcSpanTable } from './irc-2018-tables';
import type { SpanTable } from './span-table';
import { spanCheck } from './span-check';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

interface DesignOverrides {
  readonly widthFt?: number;
  readonly lengthFt?: number;
  readonly heightMm?: number;
  readonly joistNominal?: MaterialRef['nominal'];
  readonly joistSpecies?: MaterialRef['species'];
  readonly beamNominal?: MaterialRef['nominal'];
  readonly beamSpecies?: MaterialRef['species'];
  readonly spacingMm?: Mm;
  // For tests that need a fractional length in mm (boundary tests).
  readonly lengthMm?: Mm;
  readonly widthMm?: Mm;
}

function makeDesign(overrides: DesignOverrides = {}): DeckDesign {
  const widthMm = overrides.widthMm ?? (overrides.widthFt ?? 12) * MM_PER_FOOT;
  const lengthMm = overrides.lengthMm ?? (overrides.lengthFt ?? 12) * MM_PER_FOOT;
  const joistSpecies = overrides.joistSpecies ?? 'PT';
  const beamSpecies = overrides.beamSpecies ?? 'PT';
  return {
    id: '00000000-0000-4000-8000-000000000006',
    createdAt: '2026-07-02T00:00:00.000Z',
    footprint: {
      widthMm,
      lengthMm,
      heightMm: overrides.heightMm ?? 914,
    },
    joist: {
      material: {
        nominal: overrides.joistNominal ?? '2x10',
        species: joistSpecies,
        grade: joistSpecies === 'Composite' ? 'NA' : 'No2',
      },
      spacingMm: overrides.spacingMm ?? 406,
    },
    beam: {
      material: {
        nominal: overrides.beamNominal ?? '2x10',
        species: beamSpecies,
        grade: beamSpecies === 'Composite' ? 'NA' : 'No2',
      },
    },
    post: { material: { nominal: '6x6', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

const FIXED_CLOCK = () => '2026-07-02T00:00:00.000Z';

function layoutFor(design: DeckDesign): Layout {
  return computeLayout(design, { now: FIXED_CLOCK });
}

// A hand-built Layout with no members — the empty-layout edge case.
const EMPTY_LAYOUT: Layout = {
  designId: '00000000-0000-4000-8000-000000000000',
  computedAt: FIXED_CLOCK(),
  bounds: { widthMm: 3658, lengthMm: 3658, heightMm: 914 },
  members: [],
};

// The IrcSpanTable instance most tests use.
const IRC = new IrcSpanTable();

// ---------------------------------------------------------------------------
// AC1 — In-limit design produces no warnings
// ---------------------------------------------------------------------------

describe('spanCheck — AC1 in-limit design', () => {
  it('12x12 ft, 2x10 PT joists @ 16" o.c., double-ply 2x10 PT beam → no warnings', () => {
    const design = makeDesign({
      widthFt: 12,
      lengthFt: 12,
      joistNominal: '2x10',
      joistSpecies: 'PT',
      beamNominal: '2x10',
      beamSpecies: 'PT',
      spacingMm: 406,
    });
    const layout = layoutFor(design);
    expect(spanCheck(layout, IRC)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Over-span joist produces one Warning per joist with the correct
// allowable + citation. The test computes the *actual* joist span from
// FOOTING_WIDTH_MM so a layout-engine tweak to beam inset stays in-sync.
// ---------------------------------------------------------------------------

describe('spanCheck — AC2 over-span joist', () => {
  it('12x16 ft, 2x6 PT @ 24" o.c. → one over-span-joist Warning per joist', () => {
    const lengthMm = 16 * MM_PER_FOOT;
    const design = makeDesign({
      widthFt: 12,
      lengthMm,
      joistNominal: '2x6',
      joistSpecies: 'PT',
      // Beam is 2x10 PT (in-limit at this width) so ONLY joist warnings fire.
      beamNominal: '2x10',
      beamSpecies: 'PT',
      spacingMm: 610,
    });
    const layout = layoutFor(design);
    const warnings = spanCheck(layout, IRC);

    // Expected joist span = length − 2 * (FOOTING_WIDTH_MM/2) = length − FOOTING_WIDTH_MM
    // (beams are inset by FOOTING_WIDTH_MM/2 at each end — see beam-layout.ts).
    const expectedActualMm = lengthMm - FOOTING_WIDTH_MM;
    // IRC-2018 R507.6 — Southern Pine No.2 2x6 @ 24" o.c. → 7'-7"
    const expectedAllowableMm = ftInToMm(7, 7);

    const joistCount = layout.members.filter((m) => m.kind === 'joist').length;
    expect(warnings.length).toBe(joistCount);
    for (const w of warnings) {
      expect(w.kind).toBe('over-span-joist');
      expect(w.actualMm).toBeCloseTo(expectedActualMm, 5);
      expect(w.allowableMm).toBeCloseTo(expectedAllowableMm, 5);
      expect(w.actualMm).toBeGreaterThan(w.allowableMm);
      expect(w.tableReference).toMatch(/IRC-2018/);
      expect(w.tableReference).toMatch(/R507\.6/);
      expect(w.tableReference).toMatch(/Southern Pine/i);
      expect(w.tableReference).toMatch(/2x6/);
      expect(w.message).toMatch(/exceeds allowable/i);
    }
  });

  it('AC2 warnings are keyed to the offending joist ids (memberId matches a joist in the Layout)', () => {
    const design = makeDesign({
      widthFt: 12,
      lengthMm: 16 * MM_PER_FOOT,
      joistNominal: '2x6',
      joistSpecies: 'PT',
      beamNominal: '2x10',
      beamSpecies: 'PT',
      spacingMm: 610,
    });
    const layout = layoutFor(design);
    const warnings = spanCheck(layout, IRC);

    const joistIds = new Set(
      layout.members.filter((m) => m.kind === 'joist').map((m) => m.id),
    );
    for (const w of warnings) {
      expect(joistIds.has(w.memberId)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC3 — Table swap (proof spanCheck uses the interface, not concrete data)
// ---------------------------------------------------------------------------

describe('spanCheck — AC3 SpanTable abstraction (table swap)', () => {
  it('mock SpanTable always returning 10000 mm → deck spanning 8000 mm has no warnings', () => {
    // A 8.3-m long deck yields a joist span of 8300 − 300 = 8000 mm.
    // (Requires deck height tall enough to fit the framing stack for
    // the 2x10 joist/beam + 5/4x6 decking + MIN_POST_HEIGHT_MM.)
    const design = makeDesign({
      widthMm: 8300,
      lengthMm: 8300,
      heightMm: 914,
    });
    const layout = layoutFor(design);

    const mockTable: SpanTable = {
      edition: 'MOCK',
      lookupJoistMaxSpan: () => 10000,
      lookupBeamMaxSpan: () => 10000,
      citationFor: () => 'MOCK-CITATION',
    };

    expect(spanCheck(layout, mockTable)).toEqual([]);
  });

  it('mock SpanTable returning 1000 mm on the SAME layout flags every joist and beam', () => {
    const design = makeDesign({
      widthMm: 8300,
      lengthMm: 8300,
      heightMm: 914,
    });
    const layout = layoutFor(design);

    const tinyTable: SpanTable = {
      edition: 'MOCK',
      lookupJoistMaxSpan: () => 1000,
      lookupBeamMaxSpan: () => 1000,
      citationFor: () => 'MOCK-CITATION',
    };

    const warnings = spanCheck(layout, tinyTable);
    // At least every joist (spans 8000 > 1000) and at least one warning per beam
    // (2 beams, post-to-post > 1000).
    const joistCount = layout.members.filter((m) => m.kind === 'joist').length;
    const beamCount = layout.members.filter((m) => m.kind === 'beam').length;
    expect(warnings.length).toBe(joistCount + beamCount);

    for (const w of warnings) {
      expect(w.tableReference).toBe('MOCK-CITATION');
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 — Missing table row → fail-safe Warning with allowableMm: 0
// ---------------------------------------------------------------------------

describe('spanCheck — AC4 missing table row is fail-safe', () => {
  it('joist at 508 mm (20 in o.c.) spacing → Warning with allowableMm: 0 and "not covered" message', () => {
    // 508 mm is not a standard IRC row (see irc-2018-tables). Every
    // joist in a design with this spacing must warn fail-safe.
    const design = makeDesign({
      widthFt: 12,
      lengthFt: 10,
      joistNominal: '2x10',
      joistSpecies: 'PT',
      beamNominal: '2x10',
      beamSpecies: 'PT',
      spacingMm: 508,
    });
    const layout = layoutFor(design);
    const warnings = spanCheck(layout, IRC);

    const joistWarnings = warnings.filter((w) => w.kind === 'over-span-joist');
    const joistCount = layout.members.filter((m) => m.kind === 'joist').length;
    expect(joistWarnings.length).toBe(joistCount);
    for (const w of joistWarnings) {
      expect(w.allowableMm).toBe(0);
      expect(w.message.toLowerCase()).toMatch(/not covered/);
      expect(w.message.toLowerCase()).toMatch(/consult.*professional/);
    }
  });

  it('Composite framing (joist kind, not rated by IRC) → fail-safe Warning per joist', () => {
    // Composite joists are the ticket comment's other fail-safe case.
    // Uses 2x10 Composite for joists so validateDesign passes (Composite
    // 2x10 IS in the catalog); IRC lookup returns 0 → "not rated" warn.
    const design = makeDesign({
      widthFt: 12,
      lengthFt: 10,
      joistNominal: '2x10',
      joistSpecies: 'Composite',
      beamNominal: '2x10',
      beamSpecies: 'PT',
      spacingMm: 406,
    });
    const layout = layoutFor(design);
    const warnings = spanCheck(layout, IRC);

    const joistWarnings = warnings.filter((w) => w.kind === 'over-span-joist');
    const joistCount = layout.members.filter((m) => m.kind === 'joist').length;
    expect(joistWarnings.length).toBe(joistCount);
    for (const w of joistWarnings) {
      expect(w.allowableMm).toBe(0);
      expect(w.message.toLowerCase()).toMatch(/not rated|not covered/);
    }
  });
});

// ---------------------------------------------------------------------------
// Empty-layout edge case
// ---------------------------------------------------------------------------

describe('spanCheck — empty layout', () => {
  it('returns [] for a Layout with no members', () => {
    expect(spanCheck(EMPTY_LAYOUT, IRC)).toEqual([]);
  });

  it('returns [] for a Layout with joists but no beams (defensive; not producible by MVP layout engine)', () => {
    const orphanJoist: LayoutMember = {
      id: 'joist-orphan',
      kind: 'joist',
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      position: { x: 0, y: 700, z: 0 },
      size: { x: 38, y: 235, z: 3658 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const layout: Layout = {
      ...EMPTY_LAYOUT,
      members: [orphanJoist],
    };
    // No beams → no derivable joist span → return [] (fail-safe: cannot
    // manufacture a span from thin air; the layout is malformed).
    expect(spanCheck(layout, IRC)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Boundary tests (inclusive: span == allowable is NOT a warning;
// allowable + 1 mm IS a warning). Driven by hand-built Layouts so we
// can dial the joist span to exactly the boundary — the deck-length
// UI cannot express this precision, but a `.deck` file loader can
// hand off arbitrary mm values.
// ---------------------------------------------------------------------------

describe('spanCheck — boundary (allowable ± 1 mm)', () => {
  // Precise-boundary helper: build a Layout with one joist between two
  // beams whose spacing yields joistSpan EXACTLY the requested value.
  // The rest of the members are omitted — spanCheck only cares about
  // joists + beams + posts.
  function boundaryLayout(joistSpanMm: Mm): Layout {
    const halfSpan = joistSpanMm / 2;
    const joist: LayoutMember = {
      id: 'joist-0',
      kind: 'joist',
      // 2x10 PT No.2 @ 406 mm o.c. — allowable = 14 ft = 4267.2 mm.
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      position: { x: 0, y: 700, z: 0 },
      size: { x: 38, y: 235, z: joistSpanMm + FOOTING_WIDTH_MM },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamNear: LayoutMember = {
      id: 'beam-near',
      kind: 'beam',
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      position: { x: 0, y: 500, z: -halfSpan },
      size: { x: 2000, y: 235, z: 38 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamFar: LayoutMember = {
      id: 'beam-far',
      kind: 'beam',
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      position: { x: 0, y: 500, z: +halfSpan },
      size: { x: 2000, y: 235, z: 38 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    // Two posts per beam — 500 mm apart — so beam post-to-post span
    // is a benign 500 mm (well under any 2x10 beam allowable).
    // Layout members intentionally use joist spacing derivation via
    // a single joist — spanCheck derives spacing from adjacent
    // joist centers, so with ONE joist we default to the tightest
    // tabulated row (see span-check.ts). To sidestep that (we want
    // the 16"/406 row) we add a phantom second joist at 406 mm
    // offset — this pins the derived spacing to 406.
    const joistTwin: LayoutMember = {
      ...joist,
      id: 'joist-1',
      position: { x: 406, y: 700, z: 0 },
    };
    const posts: LayoutMember[] = [];
    for (const beam of [beamNear, beamFar]) {
      posts.push(
        {
          id: `post-${beam.id}-0`,
          kind: 'post',
          material: { nominal: '6x6', species: 'PT', grade: 'No2' },
          position: { x: -250, y: 250, z: beam.position.z },
          size: { x: 140, y: 500, z: 140 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        {
          id: `post-${beam.id}-1`,
          kind: 'post',
          material: { nominal: '6x6', species: 'PT', grade: 'No2' },
          position: { x: +250, y: 250, z: beam.position.z },
          size: { x: 140, y: 500, z: 140 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      );
    }
    return {
      designId: '00000000-0000-4000-8000-000000000000',
      computedAt: FIXED_CLOCK(),
      bounds: { widthMm: 2000, lengthMm: joistSpanMm + FOOTING_WIDTH_MM, heightMm: 914 },
      members: [joist, joistTwin, beamNear, beamFar, ...posts],
    };
  }

  const ALLOWABLE_MM = ftInToMm(14, 0); // 2x10 SP @ 16" o.c.

  it('joist span == allowable → NO warning (boundary is inclusive)', () => {
    const layout = boundaryLayout(ALLOWABLE_MM);
    const warnings = spanCheck(layout, IRC).filter((w) => w.kind === 'over-span-joist');
    expect(warnings).toEqual([]);
  });

  it('joist span == allowable + 1 mm → warning (boundary + 1 flips)', () => {
    const layout = boundaryLayout(ALLOWABLE_MM + 1);
    const warnings = spanCheck(layout, IRC).filter((w) => w.kind === 'over-span-joist');
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) {
      expect(w.actualMm).toBeCloseTo(ALLOWABLE_MM + 1, 5);
      expect(w.allowableMm).toBeCloseTo(ALLOWABLE_MM, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// Ordering: warnings sorted by memberId (spec § "one Warning per member
// ordered by memberId").
// ---------------------------------------------------------------------------

describe('spanCheck — output ordering', () => {
  it('warnings are returned in lexicographic memberId order', () => {
    // Any over-span design triggers many joist warnings whose memberIds
    // are 'joist-0', 'joist-1', ... — a good test for the sort.
    const design = makeDesign({
      widthFt: 12,
      lengthMm: 16 * MM_PER_FOOT,
      joistNominal: '2x6',
      joistSpecies: 'PT',
      beamNominal: '2x10',
      beamSpecies: 'PT',
      spacingMm: 610,
    });
    const layout = layoutFor(design);
    const warnings = spanCheck(layout, IRC);

    const ids = warnings.map((w) => w.memberId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Beam post-to-post over-span (a wide deck triggers the beam warning too)
// ---------------------------------------------------------------------------

describe('spanCheck — beam post-to-post span', () => {
  it('a design that fits the joist limit but has beam post-to-post > allowable flags the beam(s)', () => {
    // Force the beam-over-span case with a mock table: allow generous
    // joists (10000 mm) so joist warnings don't dominate, but tight
    // beams (500 mm) so both beams flag on their post-to-post span.
    const design = makeDesign({ widthFt: 12, lengthFt: 10 });
    const layout = layoutFor(design);

    const beamOnlyTable: SpanTable = {
      edition: 'MOCK',
      lookupJoistMaxSpan: () => 10000,
      lookupBeamMaxSpan: () => 500,
      citationFor: (kind: MemberKind) => `MOCK-${kind}`,
    };

    const warnings = spanCheck(layout, beamOnlyTable);
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    expect(beamWarnings.length).toBe(2); // 2 beams in MVP layout
    for (const w of beamWarnings) {
      expect(w.actualMm).toBeGreaterThan(500);
      expect(w.allowableMm).toBe(500);
      expect(w.tableReference).toBe('MOCK-beam');
    }
  });
});

// ---------------------------------------------------------------------------
// Performance: ≤10 ms for ≤100 members (ticket §9). A default-size
// 12x12ft layout has ~15 members; a 40x40ft layout has closer to 100.
// ---------------------------------------------------------------------------

describe('spanCheck — performance', () => {
  it('runs in <= 10 ms for a large (~100-member) layout', () => {
    const design = makeDesign({ widthFt: 40, lengthFt: 40 });
    const layout = layoutFor(design);
    // Sanity: this should be near the 100-member ceiling.
    expect(layout.members.length).toBeGreaterThan(50);

    const start = performance.now();
    spanCheck(layout, IRC);
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// AC5 — Provenance doc exists. (README location is asserted so a
// rename doesn't silently break the ticket's AC5.)
// ---------------------------------------------------------------------------

describe('spanCheck — AC5 provenance doc', () => {
  it('docs/span-tables/README.md exists and cites IRC-2018 R507.5 + R507.6', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const readmePath = pathResolve(here, '..', '..', '..', 'docs', 'span-tables', 'README.md');
    const contents = readFileSync(readmePath, 'utf8');
    expect(contents).toMatch(/IRC-2018|2018 International Residential Code/);
    expect(contents).toMatch(/R507\.5/);
    expect(contents).toMatch(/R507\.6/);
    // Species mapping decision + fair-use posture MUST be documented.
    expect(contents.toLowerCase()).toMatch(/species/);
    expect(contents.toLowerCase()).toMatch(/southern pine/);
    expect(contents.toLowerCase()).toMatch(/redwood|western cedars/);
    expect(contents.toLowerCase()).toMatch(/fair.?use|copyright/);
  });
});

// ---------------------------------------------------------------------------
// Interface discipline: span-check.ts MUST NOT import from ./irc-2018-tables.
// Enforces the ticket's dependency-inversion rule (Code Review Guardian
// finding #4). A future refactor that adds `import './irc-2018-tables'`
// (even accidentally) fails here.
// ---------------------------------------------------------------------------

describe('spanCheck — dependency inversion (Code Review Guardian finding #4)', () => {
  it('span-check.ts does NOT import from ./irc-2018-tables — depends on SpanTable only', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(pathResolve(here, 'span-check.ts'), 'utf8');
    // Match ONLY actual import/require/re-export statements — comments
    // that discuss the rule (as this module's header does) are fine.
    // Patterns caught:
    //   import ... from './irc-2018-tables'    (static ESM)
    //   import ... from "./irc-2018-tables"    (double-quoted)
    //   import('./irc-2018-tables')            (dynamic import)
    //   require('./irc-2018-tables')           (CommonJS)
    //   export ... from './irc-2018-tables'    (re-export)
    const importPattern =
      /(?:from|import|require)\s*\(?\s*['"]\.\/irc-2018-tables['"]/;
    expect(src).not.toMatch(importPattern);
  });
});
