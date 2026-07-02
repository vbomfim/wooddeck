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

  it('Composite framing (BEAM kind, not rated by IRC) → fail-safe Warning per beam (QA-G3)', () => {
    // Parity with the joist-Composite case above — this exercises the
    // BEAM fail-safe path end-to-end through spanCheck (the isolated
    // IrcSpanTable.lookupBeamMaxSpan Composite unit only proves the
    // table returns 0; this asserts spanCheck WRAPS that 0 into a
    // proper "not rated" beam Warning with the right tableReference).
    const design = makeDesign({
      widthFt: 12,
      lengthFt: 10,
      joistNominal: '2x10',
      joistSpecies: 'PT',
      beamNominal: '2x10',
      beamSpecies: 'Composite',
      spacingMm: 406,
    });
    const layout = layoutFor(design);
    const warnings = spanCheck(layout, IRC);

    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    const beamCount = layout.members.filter((m) => m.kind === 'beam').length;
    expect(beamWarnings.length).toBe(beamCount);
    for (const w of beamWarnings) {
      expect(w.allowableMm).toBe(0);
      expect(w.message.toLowerCase()).toMatch(/not rated/);
      expect(w.message.toLowerCase()).toMatch(/consult.*professional/);
      // The citation must name Composite for a downstream Warnings-panel
      // to route it to the "material choice" recovery flow, not the
      // "resize/add-support" flow.
      expect(w.tableReference.toLowerCase()).toMatch(/composite/);
    }
  });

  it('a design at an ABOVE-row actual spacing DOES NOT false-pass — snap-policy fix regression (PR#24 blocking #1)', () => {
    // Sanity end-to-end proof at the spanCheck level. Any layout whose
    // derived actual spacing sits ABOVE a tabulated row must fail-safe
    // rather than snap DOWN. We drive this via a hand-built layout
    // with two joists 419 mm apart (a "20-inch nominal after layout
    // drift" scenario) — under the OLD symmetric snap this would have
    // returned the 16-inch (406) allowable and possibly passed;
    // under the new asymmetric rule this must fail-safe on every joist.
    const spacingMm = 419; // ABOVE the 406 row; between rows
    const joistSpanMm = 3000; // Way under any allowable — proves the
                              // fail-safe is FROM the spacing lookup,
                              // not because we exceeded a real row.
    const halfSpan = joistSpanMm / 2;
    const material = { nominal: '2x10', species: 'PT', grade: 'No2' } as const;
    const beamNear: LayoutMember = {
      id: 'beam-near',
      kind: 'beam',
      material,
      position: { x: 0, y: 500, z: -halfSpan },
      size: { x: 2000, y: 235, z: 38 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamFar: LayoutMember = {
      ...beamNear,
      id: 'beam-far',
      position: { x: 0, y: 500, z: +halfSpan },
    };
    const joist0: LayoutMember = {
      id: 'joist-0',
      kind: 'joist',
      material,
      position: { x: 0, y: 700, z: 0 },
      size: { x: 38, y: 235, z: joistSpanMm + FOOTING_WIDTH_MM },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const joist1: LayoutMember = { ...joist0, id: 'joist-1', position: { x: spacingMm, y: 700, z: 0 } };
    // A benign single post per beam so the beam post-to-post derivation
    // sees < 2 posts and skips (isolates the joist snap-policy proof).
    const posts: LayoutMember[] = [beamNear, beamFar].map((b, i) => ({
      id: `post-${i}`,
      kind: 'post',
      material: { nominal: '6x6', species: 'PT', grade: 'No2' },
      position: { x: 0, y: 250, z: b.position.z },
      size: { x: 140, y: 500, z: 140 },
      rotation: { x: 0, y: 0, z: 0 },
    }));
    const layout: Layout = {
      designId: '00000000-0000-4000-8000-000000000000',
      computedAt: FIXED_CLOCK(),
      bounds: { widthMm: 2000, lengthMm: joistSpanMm + FOOTING_WIDTH_MM, heightMm: 914 },
      members: [beamNear, beamFar, joist0, joist1, ...posts],
    };
    const warnings = spanCheck(layout, IRC);
    const joistWarnings = warnings.filter((w) => w.kind === 'over-span-joist');
    expect(joistWarnings.length).toBe(2);
    for (const w of joistWarnings) {
      expect(w.allowableMm).toBe(0); // fail-safe, NOT a snapped 406-row value
      expect(w.message.toLowerCase()).toMatch(/not covered/);
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

  it('joist span == allowable - 1 mm → NO warning (parity with beam -1 test below)', () => {
    const layout = boundaryLayout(ALLOWABLE_MM - 1);
    const warnings = spanCheck(layout, IRC).filter((w) => w.kind === 'over-span-joist');
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Beam boundary tests (QA-G2) — parity with the joist boundary tests
// above. Uses a hand-built layout that pins the beam post-to-post span
// to exactly the required value and drives the check through the real
// IrcSpanTable (so the boundary constant comes from the table).
// ---------------------------------------------------------------------------

describe('spanCheck — beam boundary (allowable ± 1 mm) (QA-G2)', () => {
  /**
   * Build a Layout whose ONLY beam warning driver is the beam
   * post-to-post span (joists intentionally under-allowable).
   * The joist span is fixed at 8 ft = 2438 mm so the beam-table
   * column is deterministic (`snapBeamJoistSpan(2438) = 8 ft`).
   * The beam is 2x10 PT No.2 at 2-ply — allowable per R507.5 is
   * 8 ft 9 in = 2667 mm.
   */
  function beamBoundaryLayout(beamPostSpanMm: Mm): Layout {
    const JOIST_SPAN_MM = ftInToMm(8, 0);
    const halfSpan = JOIST_SPAN_MM / 2;
    const halfPost = beamPostSpanMm / 2;
    const material = { nominal: '2x10', species: 'PT', grade: 'No2' } as const;
    const joist: LayoutMember = {
      id: 'joist-0',
      kind: 'joist',
      material,
      position: { x: 0, y: 700, z: 0 },
      size: { x: 38, y: 235, z: JOIST_SPAN_MM + FOOTING_WIDTH_MM },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const joistTwin: LayoutMember = { ...joist, id: 'joist-1', position: { x: 406, y: 700, z: 0 } };
    const beamNear: LayoutMember = {
      id: 'beam-near',
      kind: 'beam',
      material,
      position: { x: 0, y: 500, z: -halfSpan },
      size: { x: beamPostSpanMm + 400, y: 235, z: 38 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamFar: LayoutMember = { ...beamNear, id: 'beam-far', position: { x: 0, y: 500, z: +halfSpan } };
    const posts: LayoutMember[] = [];
    for (const beam of [beamNear, beamFar]) {
      posts.push(
        {
          id: `post-${beam.id}-0`, kind: 'post',
          material: { nominal: '6x6', species: 'PT', grade: 'No2' },
          position: { x: -halfPost, y: 250, z: beam.position.z },
          size: { x: 140, y: 500, z: 140 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        {
          id: `post-${beam.id}-1`, kind: 'post',
          material: { nominal: '6x6', species: 'PT', grade: 'No2' },
          position: { x: +halfPost, y: 250, z: beam.position.z },
          size: { x: 140, y: 500, z: 140 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      );
    }
    return {
      designId: '00000000-0000-4000-8000-000000000000',
      computedAt: FIXED_CLOCK(),
      bounds: {
        widthMm: beamPostSpanMm + 400,
        lengthMm: JOIST_SPAN_MM + FOOTING_WIDTH_MM,
        heightMm: 914,
      },
      members: [joist, joistTwin, beamNear, beamFar, ...posts],
    };
  }

  // 2-ply Southern Pine 2x10 @ 8 ft joist span → 8'-9" = 2667 mm.
  const BEAM_ALLOWABLE_MM = ftInToMm(8, 9);

  it('beam post-to-post == allowable - 1 mm → NO warning', () => {
    const layout = beamBoundaryLayout(BEAM_ALLOWABLE_MM - 1);
    const warnings = spanCheck(layout, IRC).filter((w) => w.kind === 'over-span-beam');
    expect(warnings).toEqual([]);
  });

  it('beam post-to-post == allowable → NO warning (boundary is inclusive)', () => {
    const layout = beamBoundaryLayout(BEAM_ALLOWABLE_MM);
    const warnings = spanCheck(layout, IRC).filter((w) => w.kind === 'over-span-beam');
    expect(warnings).toEqual([]);
  });

  it('beam post-to-post == allowable + 1 mm → over-span-beam warning per beam', () => {
    const layout = beamBoundaryLayout(BEAM_ALLOWABLE_MM + 1);
    const warnings = spanCheck(layout, IRC).filter((w) => w.kind === 'over-span-beam');
    expect(warnings.length).toBe(2); // 2 beams in the fixture
    for (const w of warnings) {
      expect(w.actualMm).toBeCloseTo(BEAM_ALLOWABLE_MM + 1, 5);
      expect(w.allowableMm).toBeCloseTo(BEAM_ALLOWABLE_MM, 5);
      // Beam citation must include the joist-span column (S9).
      expect(w.tableReference).toMatch(/supporting 8 ft joist span/);
    }
  });
});

// ---------------------------------------------------------------------------
// Hand-computed beam post-to-post over-span, driven by REAL IrcSpanTable
// (QA-G4 + Code Review PR#24 Opus finding #10). Exercises the real beam
// path — the previous S5 tests only exercised the beam path with a
// MOCK table returning 500 mm. Without this test, a bug in
// `deriveBeamPostToPostSpanMm` + `lookupBeamMaxSpan` could pass silently.
// ---------------------------------------------------------------------------

describe('spanCheck — real IRC beam over-span (QA-G4)', () => {
  it('a beam whose post-to-post span exceeds the real 2-ply IRC allowable (>0) flags an over-span-beam warning', () => {
    // 2-ply PT (Southern Pine) 2x10 supporting an 8-ft joist span:
    // R507.5 says max post-to-post span = 8'-9" = 2667 mm.
    // We construct a beam whose posts sit 3200 mm apart — clearly over.
    const JOIST_SPAN_MM = ftInToMm(8, 0); // pins the R507.5 column at 8 ft
    const BEAM_POST_SPAN_MM = 3200;
    const halfJoist = JOIST_SPAN_MM / 2;
    const halfPost = BEAM_POST_SPAN_MM / 2;
    const material = { nominal: '2x10', species: 'PT', grade: 'No2' } as const;
    const joist: LayoutMember = {
      id: 'joist-0', kind: 'joist', material,
      position: { x: 0, y: 700, z: 0 },
      size: { x: 38, y: 235, z: JOIST_SPAN_MM + FOOTING_WIDTH_MM },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const joistTwin: LayoutMember = { ...joist, id: 'joist-1', position: { x: 406, y: 700, z: 0 } };
    const beamNear: LayoutMember = {
      id: 'beam-near', kind: 'beam', material,
      position: { x: 0, y: 500, z: -halfJoist },
      size: { x: BEAM_POST_SPAN_MM + 400, y: 235, z: 38 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamFar: LayoutMember = { ...beamNear, id: 'beam-far', position: { x: 0, y: 500, z: +halfJoist } };
    const posts: LayoutMember[] = [];
    for (const beam of [beamNear, beamFar]) {
      posts.push(
        {
          id: `post-${beam.id}-0`, kind: 'post',
          material: { nominal: '6x6', species: 'PT', grade: 'No2' },
          position: { x: -halfPost, y: 250, z: beam.position.z },
          size: { x: 140, y: 500, z: 140 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        {
          id: `post-${beam.id}-1`, kind: 'post',
          material: { nominal: '6x6', species: 'PT', grade: 'No2' },
          position: { x: +halfPost, y: 250, z: beam.position.z },
          size: { x: 140, y: 500, z: 140 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      );
    }
    const layout: Layout = {
      designId: '00000000-0000-4000-8000-000000000000',
      computedAt: FIXED_CLOCK(),
      bounds: {
        widthMm: BEAM_POST_SPAN_MM + 400,
        lengthMm: JOIST_SPAN_MM + FOOTING_WIDTH_MM,
        heightMm: 914,
      },
      members: [joist, joistTwin, beamNear, beamFar, ...posts],
    };
    const warnings = spanCheck(layout, IRC);
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    expect(beamWarnings.length).toBe(2);
    for (const w of beamWarnings) {
      // Actual = the hand-computed post-to-post span (3200 mm exactly).
      expect(w.actualMm).toBeCloseTo(BEAM_POST_SPAN_MM, 5);
      // Allowable = REAL IRC value (2'-9" = 2667 mm), NOT a mock number.
      expect(w.allowableMm).toBeGreaterThan(0);
      expect(w.allowableMm).toBeCloseTo(ftInToMm(8, 9), 5);
      // Citation must be the real R507.5 row.
      expect(w.tableReference).toMatch(/IRC-2018 Table R507\.5/);
      expect(w.tableReference).toMatch(/2x10/);
      expect(w.tableReference).toMatch(/supporting 8 ft joist span/);
      expect(w.message).toMatch(/exceeds allowable/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge tests (QA-G8/G9/G10, Code Review Opus finding #6 — float tolerance).
// ---------------------------------------------------------------------------

describe('spanCheck — beam with fewer than 2 posts is skipped without crashing (QA-G8)', () => {
  it('a beam with 1 post is skipped (no crash / no NaN warning)', () => {
    const material = { nominal: '2x10', species: 'PT', grade: 'No2' } as const;
    const joist: LayoutMember = {
      id: 'joist-0', kind: 'joist', material,
      position: { x: 0, y: 700, z: 0 },
      size: { x: 38, y: 235, z: 4000 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const joistTwin: LayoutMember = { ...joist, id: 'joist-1', position: { x: 406, y: 700, z: 0 } };
    const beamNear: LayoutMember = {
      id: 'beam-near', kind: 'beam', material,
      position: { x: 0, y: 500, z: -1850 },
      size: { x: 2000, y: 235, z: 38 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamFar: LayoutMember = { ...beamNear, id: 'beam-far', position: { x: 0, y: 500, z: +1850 } };
    // ONLY ONE post per beam — the checker must skip these beams
    // rather than fabricate a span.
    const lonePost: LayoutMember = {
      id: 'post-only', kind: 'post',
      material: { nominal: '6x6', species: 'PT', grade: 'No2' },
      position: { x: 0, y: 250, z: -1850 },
      size: { x: 140, y: 500, z: 140 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const layout: Layout = {
      designId: '00000000-0000-4000-8000-000000000000',
      computedAt: FIXED_CLOCK(),
      bounds: { widthMm: 2000, lengthMm: 3700 + FOOTING_WIDTH_MM, heightMm: 914 },
      members: [joist, joistTwin, beamNear, beamFar, lonePost],
    };
    // Must NOT throw / must NOT return beam warnings with NaN.
    const warnings = spanCheck(layout, IRC);
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    expect(beamWarnings).toEqual([]);
    // Sanity: joist checks still fire.
    for (const w of warnings) {
      expect(Number.isFinite(w.actualMm)).toBe(true);
      expect(Number.isFinite(w.allowableMm)).toBe(true);
    }
  });
});

describe('spanCheck — passes plyCount = 2 to the SpanTable (QA-G9)', () => {
  it('the third argument spanCheck passes to lookupBeamMaxSpan is exactly 2 (DEFAULT_BEAM_PLY_COUNT)', () => {
    // Spy table records the plyCount it was called with. spanCheck
    // MUST pass 2 (the documented DEFAULT_BEAM_PLY_COUNT) — a bug
    // that passed undefined / 1 / 3 would silently degrade the check.
    const design = makeDesign({ widthFt: 12, lengthFt: 10 });
    const layout = layoutFor(design);
    const plyCountsSeen: number[] = [];
    const spyTable: SpanTable = {
      edition: 'SPY',
      lookupJoistMaxSpan: () => 100000,
      lookupBeamMaxSpan: (_m, _js, ply) => {
        plyCountsSeen.push(ply);
        return 100000;
      },
      citationFor: () => 'SPY',
    };
    spanCheck(layout, spyTable);
    expect(plyCountsSeen.length).toBeGreaterThan(0);
    for (const p of plyCountsSeen) {
      expect(p).toBe(2);
    }
  });
});

describe('spanCheck — beam-post z match uses TOLERANCE, not strict equality (Code Review PR#24 Opus #6)', () => {
  it('ε-perturbed post z (mimicking .deck file round-trip drift) still matches its beam', () => {
    // The post's `z` differs from the beam's by less than
    // POST_Z_TOLERANCE_MM (0.5 mm). Strict `===` would drop the post
    // and silently no-op the beam check. The tolerance-based match
    // must still recognize the post-beam association.
    const material = { nominal: '2x10', species: 'PT', grade: 'No2' } as const;
    const joist: LayoutMember = {
      id: 'joist-0', kind: 'joist', material,
      position: { x: 0, y: 700, z: 0 },
      size: { x: 38, y: 235, z: 4000 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const joistTwin: LayoutMember = { ...joist, id: 'joist-1', position: { x: 406, y: 700, z: 0 } };
    const beamZ = -1850;
    const beamNear: LayoutMember = {
      id: 'beam-near', kind: 'beam', material,
      position: { x: 0, y: 500, z: beamZ },
      size: { x: 5000, y: 235, z: 38 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const beamFar: LayoutMember = { ...beamNear, id: 'beam-far', position: { x: 0, y: 500, z: -beamZ } };
    // Two posts under beamNear with z ε-drifted by 0.0001 mm — the
    // exact class of drift a JSON round-trip could introduce.
    const eps = 0.0001;
    const mkPost = (id: string, x: number, zBase: number): LayoutMember => ({
      id, kind: 'post',
      material: { nominal: '6x6', species: 'PT', grade: 'No2' },
      position: { x, y: 250, z: zBase + eps },
      size: { x: 140, y: 500, z: 140 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    const layout: Layout = {
      designId: '00000000-0000-4000-8000-000000000000',
      computedAt: FIXED_CLOCK(),
      bounds: { widthMm: 5000, lengthMm: 3700 + FOOTING_WIDTH_MM, heightMm: 914 },
      members: [
        joist, joistTwin, beamNear, beamFar,
        mkPost('post-near-0', -2000, beamZ),
        mkPost('post-near-1', +2000, beamZ),
        mkPost('post-far-0', -2000, -beamZ),
        mkPost('post-far-1', +2000, -beamZ),
      ],
    };
    // With strict `===`, the near beam would see 0 posts and be skipped
    // → no beam warning; with the 0.5 mm tolerance, it sees 2 posts
    // 4000 mm apart → over-span warning (well over the ~2.6 m 2x10
    // 2-ply allowable).
    const warnings = spanCheck(layout, IRC);
    const beamWarnings = warnings.filter((w) => w.kind === 'over-span-beam');
    expect(beamWarnings.length).toBe(2);
    for (const w of beamWarnings) {
      expect(w.actualMm).toBeCloseTo(4000, 3);
    }
  });
});

// ---------------------------------------------------------------------------
// Ordering: warnings sorted by memberId (spec § "one Warning per member
// ordered by memberId").
// ---------------------------------------------------------------------------

describe('spanCheck — output ordering (natural / numeric-aware, PR#24 Opus #3 + QA-G7)', () => {
  it('warnings on a small deck (<10 joists) match plain lex order', () => {
    // For memberIds with a single-digit trailing number, natural and
    // lex orders coincide — this test is the compatibility check.
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

  it('warnings on a LARGE deck (>10 joists) are in NATURAL order — joist-2 precedes joist-10, not the reverse', () => {
    // A 20-ft-wide deck at 305 mm o.c. yields ~21 joists, so memberIds
    // 'joist-2' and 'joist-10' both exist. Under a plain lex sort,
    // 'joist-10' would incorrectly precede 'joist-2' (because '1' < '2'
    // lexicographically). Natural order (Intl.Collator numeric: true)
    // fixes this.
    const design = makeDesign({
      widthMm: 6100, // ~20 ft
      lengthMm: 16 * MM_PER_FOOT,
      joistNominal: '2x6',
      joistSpecies: 'PT',
      beamNominal: '2x10',
      beamSpecies: 'PT',
      spacingMm: 305, // 12" o.c. => most joists
    });
    const layout = layoutFor(design);
    const warnings = spanCheck(layout, IRC);
    const ids = warnings.map((w) => w.memberId);

    // Sanity: this test only means something with >10 joist warnings.
    expect(warnings.length).toBeGreaterThan(10);

    // The joist warnings must be in natural order (joist-0, joist-1,
    // joist-2, …, joist-9, joist-10, joist-11, …).
    const joistIds = ids.filter((id) => id.startsWith('joist-'));
    const joistNums = joistIds.map((id) => Number(id.slice('joist-'.length)));
    for (let i = 1; i < joistNums.length; i++) {
      expect(joistNums[i]).toBeGreaterThan(joistNums[i - 1]!);
    }

    // Plain lex sort would swap joist-10 vs joist-2 — assert the
    // natural order DIFFERS from lex when the trailing index crosses
    // the 10 boundary. (Regression proof of the fix.)
    const lexSorted = [...ids].sort();
    expect(ids).not.toEqual(lexSorted);
  });

  it('mixed joist + beam warning ids are naturally ordered (beam-far, beam-near, joist-0, joist-1, ...)', () => {
    // A single mock table failing every joist AND every beam. IDs
    // include beam-near / beam-far as well as joist-0..N. Natural
    // order groups by the alphabetic prefix — b* before j* — then
    // by the numeric portion (or lex portion for equal prefixes).
    const design = makeDesign({ widthFt: 12, lengthFt: 10 });
    const layout = layoutFor(design);
    const failTable: SpanTable = {
      edition: 'MOCK',
      lookupJoistMaxSpan: () => 1,
      lookupBeamMaxSpan: () => 1,
      citationFor: () => 'MOCK',
    };
    const warnings = spanCheck(layout, failTable);
    const ids = warnings.map((w) => w.memberId);

    // beams must come before joists (b < j).
    const firstJoistIdx = ids.findIndex((id) => id.startsWith('joist-'));
    const lastBeamIdx = ids.map((id) => id.startsWith('beam-')).lastIndexOf(true);
    if (firstJoistIdx !== -1 && lastBeamIdx !== -1) {
      expect(lastBeamIdx).toBeLessThan(firstJoistIdx);
    }

    // Within the joist group, ids must be numerically ordered.
    const joistIds = ids.filter((id) => id.startsWith('joist-'));
    const joistNums = joistIds.map((id) => Number(id.slice('joist-'.length)));
    for (let i = 1; i < joistNums.length; i++) {
      expect(joistNums[i]).toBeGreaterThan(joistNums[i - 1]!);
    }
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
