/**
 * `src/domain/layout/floating/floating-method-a-intermediate-beams.qa-gaps.test.ts`
 * — QA Guardian coverage-gap suite for issue #75 (Method A span-safe
 * intermediate beam rows). These tests are ADDITIVE to the developer's
 * TDD file (`floating-method-a-intermediate-beams.test.ts`); they close
 * gaps that the dev suite does not exercise:
 *
 *   [EDGE]      GAP A — cap-binding honesty: when the 20-row cap binds,
 *               the layout stays VALID and `spanCheck` fires
 *               `over-span-joist` HONESTLY (no silent under-support).
 *   [EDGE]      GAP B — schema-max footprint: the block-count cap
 *               (`MAX_METHOD_A_BLOCK_COUNT`) CLAMPS on a SCHEMA-LEGAL
 *               100×100 ft deck with a real IRC 2×6 joist (PR #76
 *               HIGH #1 fix — was a throw; now graceful clamp+warn).
 *   [BOUNDARY]  GAP C — geometric validity of the REAL pipeline beams
 *               (not just counts): beam plane (y), full width (+x), a
 *               block row directly under each beam, joist continuity.
 *   [COVERAGE]  GAP D — beam over-span (+x) fires for INTERIOR beams,
 *               not just the two rims (the beam-span axis works with N
 *               beams; no interior beam is skipped by the span check).
 *   [COVERAGE]  GAP E — blocking (FR-036) interop: blocking rows are
 *               still emitted with interior beams present AND sit in a
 *               different y-plane (no AABB collision).
 *   [COVERAGE]  GAP G — flush→drop transition on a deck that NEEDS
 *               interior beams (the verbatim UAT scenario the dev's
 *               apply-parameters test deliberately shrank to avoid).
 *
 * Pre-comply: pure domain module — no react/three/DOM imports.
 */
import { describe, expect, it } from 'vitest';

import type { DeckDesign, FoundationSpec, MaterialRef } from '../../model';
import { MM_PER_FOOT, type Mm } from '../../units';
import { spanCheck } from '../../spans/span-check';
import { IrcSpanTable } from '../../spans/irc-2018-tables';
import type { SpanTable } from '../../spans/span-table';
import { LayoutError } from '../layout-shared';
import { FOOTING_WIDTH_MM } from '../y-stack';

import {
  MAX_METHOD_A_BEAM_ROWS,
  MAX_METHOD_A_BLOCK_COUNT,
  BLOCK_COL_MAX_SPACING_MM,
  computeFloatingLayout,
  resolveMethodABeamRows,
} from './floating-layout';
import { computeYStackFloating } from './y-stack-floating';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PT_2X6: MaterialRef = { nominal: '2x6', species: 'PT', grade: 'No2' };
const PT_2X8: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
const CEDAR_2X6: MaterialRef = { nominal: '2x6', species: 'Cedar', grade: 'No2' };
const PT_54: MaterialRef = { nominal: '5/4x6', species: 'PT', grade: 'No2' };

const TUFFBLOCK: FoundationSpec = {
  type: 'tuffblocks',
  product: { productId: 'tuffblock-12x12x4' },
};
const OLDCASTLE: FoundationSpec = {
  type: 'deck-blocks',
  product: { productId: 'oldcastle-11x11x7' },
};

interface Overrides {
  widthFt?: number;
  lengthFt?: number;
  joist?: MaterialRef;
  spacingMm?: Mm;
  beamConnection?: DeckDesign['beamConnection'];
  foundation?: FoundationSpec;
}

function makeMethodA(o: Overrides = {}): DeckDesign {
  const joist = o.joist ?? PT_2X8;
  return {
    id: '00000000-0000-4000-8000-000000000a75',
    createdAt: '2026-07-05T00:00:00.000Z',
    footprint: {
      widthMm: (o.widthFt ?? 16) * MM_PER_FOOT,
      lengthMm: (o.lengthFt ?? 16) * MM_PER_FOOT,
      heightMm: 3 * MM_PER_FOOT,
    },
    structure: 'floating',
    floatingFraming: 'beams-and-joists',
    beamConnection: o.beamConnection ?? 'drop',
    foundation: o.foundation ?? TUFFBLOCK,
    joist: { material: joist, spacingMm: o.spacingMm ?? 406 },
    beam: { material: joist }, // symmetric depth → flush guard passes trivially
    decking: { material: PT_54, orientation: 'parallel-to-width' },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

/**
 * Synthetic span table with a joist allowable so short (1000 mm) that
 * even the maximum-length deck would request more rows than
 * `MAX_METHOD_A_BEAM_ROWS`. Used to DRIVE the 20-row cap to bind — a
 * regime NO real IRC joist reaches (see the companion assertion in
 * GAP A). `lookupBeamMaxSpan` is enormous so beam over-span never
 * fires and the test isolates the JOIST honesty invariant.
 */
const WEAK_JOIST_TABLE: SpanTable = {
  edition: 'test-weak-joist',
  lookupJoistMaxSpan: () => 1000,
  lookupBeamMaxSpan: () => 1_000_000,
  citationFor: () => 'test-weak-joist: no citation',
};

const IRC = new IrcSpanTable();

// ===========================================================================
// GAP A — cap-binding honesty (safety-critical). [EDGE]
// ===========================================================================
//
// The dev suite proves `clampMethodABeamRows` caps at 20 (a UNIT test)
// and that the resolver stays in range (AC15 property). NEITHER proves
// the END-TO-END invariant the user asked about: when the cap PREVENTS
// a span-safe row count, does the pipeline still render a valid layout
// AND does `spanCheck` fire `over-span-joist` HONESTLY — i.e. it does
// NOT silently ship an under-supported deck as if it were safe?
// ---------------------------------------------------------------------------

describe('[EDGE] GAP A — 20-row cap binds → valid layout AND honest over-span-joist (no silent under-support)', () => {
  it('narrow 100 ft deck + weak joist table → exactly MAX_METHOD_A_BEAM_ROWS beams and over-span-joist reported honestly', () => {
    // 8 ft wide keeps cols small (2) so the block-count postcondition
    // does NOT trip first — this isolates the ROW cap.
    const design = makeMethodA({
      widthFt: 8,
      lengthFt: 100,
      joist: PT_2X6,
      spacingMm: 610,
      foundation: OLDCASTLE,
    });

    const layout = computeFloatingLayout(design, {
      spanTable: WEAK_JOIST_TABLE,
    });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');

    // 1. Valid layout: the cap bound at exactly MAX rows, blocks under
    //    every row (rows × cols), nothing dropped.
    expect(beams.length).toBe(MAX_METHOD_A_BEAM_ROWS);
    const uniqueBlockXs = new Set(
      blocks.map((b) => Math.round(b.position.x * 1e3) / 1e3),
    );
    expect(blocks.length).toBe(beams.length * uniqueBlockXs.size);

    // 2. HONESTY: the cap could NOT reach the (impossible) 1000 mm
    //    pitch, so the joist is genuinely over-span — the check MUST
    //    fire rather than silently under-support.
    const overSpan = spanCheck(layout, WEAK_JOIST_TABLE).filter(
      (w) => w.kind === 'over-span-joist',
    );
    expect(overSpan.length).toBeGreaterThan(0);

    // 3. The reported span is the HONEST capped adjacent-beam gap
    //    ((lengthMm − FOOTING_WIDTH_MM) / (rows − 1)), and it exceeds
    //    the allowable — this is what makes the UI go (correctly) red.
    const expectedPitch =
      (design.footprint.lengthMm - FOOTING_WIDTH_MM) /
      (MAX_METHOD_A_BEAM_ROWS - 1);
    for (const w of overSpan) {
      expect(w.actualMm).toBeCloseTo(expectedPitch, 0);
      expect(w.actualMm).toBeGreaterThan(w.allowableMm);
    }
  });

  it('the 20-row cap is pure defense-in-depth: the WEAKEST real IRC joist at the schema-max length still needs < MAX rows', () => {
    // Cedar 2×6 @ 610 mm o.c. is the shortest-allowable catalog joist.
    // Even at 100 ft (schema max) it needs well under 20 rows — so with
    // REAL joists the cap NEVER binds. This documents that GAP A's
    // regime is only reachable via a synthetic table (as constructed
    // above), and that production Method A is always span-safe.
    const { totalRows } = resolveMethodABeamRows(
      100 * MM_PER_FOOT,
      IRC,
      CEDAR_2X6,
      610,
    );
    expect(totalRows).toBeLessThan(MAX_METHOD_A_BEAM_ROWS);
  });
});

// ===========================================================================
// GAP B — schema-max footprint block-count cap. [EDGE]
// ===========================================================================
//
// Originally pinned the "fail-loud" throw path when `cols × rows` would
// exceed `MAX_METHOD_A_BLOCK_COUNT`. The PR #76 review-gate (Opus HIGH
// #1 + GPT HIGH + this suite's GAP-B finding) rejected that: throwing
// a developer-facing "Internal invariant violated" LayoutError on a
// SCHEMA-LEGAL 100×100 ft deck made FR-F's remediation unreachable and
// showed the user a stack trace where the spec promised an actionable
// warning. `clampMethodABeamRows` now derives `cols` from `widthMm` and
// computes `rowsMaxByCap = max(2, min(MAX_METHOD_A_BEAM_ROWS,
// floor(MAX_METHOD_A_BLOCK_COUNT / cols)))` — mirrors Method B's
// `clampMethodBRows`. The 100×100 case now CLAMPS gracefully; the
// resulting adjacent-beam gap exceeds the joist allowable, so
// `deriveJoistSpanMm` reports the honest `over-span-joist` warning and
// FR-F's disabled `add-support-row` remediation surfaces the alternative.
// This test is REPURPOSED to pin the new clamp+warn contract.
// ---------------------------------------------------------------------------

describe('[EDGE] GAP B — schema-max 100×100 ft Method A CLAMPS the block-count cap and surfaces honest over-span-joist (PR #76 HIGH #1)', () => {
  it('100×100 ft, 2×6 PT @ 610 mm → NO throw; layout renders with clamped rows and honest over-span-joist', () => {
    const design = makeMethodA({
      widthFt: 100,
      lengthFt: 100,
      joist: PT_2X6,
      spacingMm: 610,
      foundation: OLDCASTLE,
    });
    // MUST NOT throw — a schema-legal user input MUST NOT produce
    // an "Internal invariant violated" LayoutError.
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    // Row cap for a 100 ft wide deck: cols = ceil(30480 / 2438.4) + 1
    //                                       = 14; rowsMaxByCap = floor(200 / 14) = 14.
    const cols =
      Math.ceil(design.footprint.widthMm / BLOCK_COL_MAX_SPACING_MM) + 1;
    const rowsMaxByCap = Math.max(
      2,
      Math.min(
        MAX_METHOD_A_BEAM_ROWS,
        Math.floor(MAX_METHOD_A_BLOCK_COUNT / cols),
      ),
    );
    expect(beams.length).toBeLessThanOrEqual(rowsMaxByCap);
    // The clamped rows × cols MUST fit within the cap (defense-in-
    // depth check: the postcondition is now unreachable, but this
    // pins the contract at the pipeline layer).
    expect(beams.length * cols).toBeLessThanOrEqual(MAX_METHOD_A_BLOCK_COUNT);
    // Block-count parity: one block row under every beam row.
    expect(blocks.length).toBe(beams.length * cols);

    // HONESTY: the clamp bound BELOW the span-safe row count for
    // 2×6 PT @ 610 mm on a 100 ft deck, so the resulting
    // adjacent-beam gap exceeds the joist allowable — the check
    // MUST fire rather than silently under-support.
    const overSpan = spanCheck(layout, IRC).filter(
      (w) => w.kind === 'over-span-joist',
    );
    expect(overSpan.length).toBeGreaterThan(0);
    for (const w of overSpan) {
      expect(w.actualMm).toBeGreaterThan(w.allowableMm);
    }
  });

  it('control: a large-but-narrow 90×100 ft deck (13 cols × 15 rows = 195 ≤ cap) still renders', () => {
    // Just under the cap on the same length — proves the clamp is
    // the block-COUNT product, not merely "big deck".
    const design = makeMethodA({
      widthFt: 90,
      lengthFt: 100,
      joist: PT_2X6,
      spacingMm: 610,
      foundation: OLDCASTLE,
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const cols = Math.ceil(design.footprint.widthMm / BLOCK_COL_MAX_SPACING_MM) + 1;
    expect(beams.length).toBeGreaterThan(2);
    expect(beams.length * cols).toBeLessThanOrEqual(MAX_METHOD_A_BLOCK_COUNT);
    expect(blocks.length).toBe(beams.length * cols);
  });
});

// ===========================================================================
// GAP C — geometric validity of the REAL pipeline beams. [BOUNDARY]
// ===========================================================================
//
// The dev suite checks beam IDs, count, block-z coincidence and size.x
// in ISOLATED cases. This test asserts the full geometric contract on a
// single real layout: EVERY beam (rim + interior) sits in the beam
// plane (y), spans the full width (+x), is centered on x, has zero
// rotation, has a block row directly beneath it, is evenly spaced along
// +z, and the joists run CONTINUOUSLY over all beam rows (drop).
// ---------------------------------------------------------------------------

describe('[BOUNDARY] GAP C — interior beams are geometrically valid against the real pipeline (not just counts)', () => {
  it('16×16 ft (1 interior beam): beam plane, full width, block under each row, continuous joists', () => {
    const design = makeMethodA({ widthFt: 16, lengthFt: 16, joist: PT_2X8 });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const y = computeYStackFloating(design);

    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocks = layout.members.filter((m) => m.kind === 'block');
    const joists = layout.members.filter((m) => m.kind === 'joist');

    expect(beams.length).toBeGreaterThanOrEqual(3); // 2 rims + ≥1 interior

    const blockZs = Array.from(
      new Set(blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3)),
    );

    for (const beam of beams) {
      // Beam plane: every beam (incl. interior) shares beamCenterY —
      // a joist depth BELOW the joist plane (that is what makes DROP
      // support work and what separates beams from blocking, GAP E).
      expect(beam.position.y).toBeCloseTo(y.beamCenterY, 6);
      // Full width along +x, centered, unrotated.
      expect(beam.size.x).toBeCloseTo(design.footprint.widthMm, 6);
      expect(beam.position.x).toBeCloseTo(0, 6);
      expect(beam.rotation).toEqual({ x: 0, y: 0, z: 0 });
      // A block row sits directly under this beam (within 1 μm).
      const hasBlockUnder = blockZs.some(
        (z) => Math.abs(z - beam.position.z) < 1e-3,
      );
      expect(hasBlockUnder).toBe(true);
    }

    // Beams evenly spaced along +z (all adjacent gaps equal).
    const beamZs = beams.map((b) => b.position.z).sort((a, b) => a - b);
    const gaps = beamZs.slice(1).map((z, i) => z - beamZs[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 3);

    // DROP: joists run the full deck length continuously over every
    // beam row (they are NOT segmented at interior beams).
    expect(joists.length).toBeGreaterThan(0);
    for (const j of joists) {
      expect(j.size.z).toBeCloseTo(design.footprint.lengthMm, 6);
      expect(j.position.z).toBeCloseTo(0, 6);
      expect(j.position.y).toBeCloseTo(y.joistCenterY, 6);
    }
  });
});

// ===========================================================================
// GAP D — beam over-span (+x) fires for INTERIOR beams too. [COVERAGE]
// ===========================================================================
//
// Interior beams share the rims' block-column spacing, so they carry
// the SAME +x span and MUST participate in `over-span-beam` detection.
// If `deriveBeamSupportInfo` failed to match blocks to an interior beam
// (e.g. by z), that beam would be silently skipped — an under-reported
// over-span. This test proves every interior beam is checked.
// ---------------------------------------------------------------------------

describe('[COVERAGE] GAP D — over-span-beam fires for every interior beam, not just the two rims', () => {
  it('40×40 ft deck with wide block columns → all beams (rims + interior) report over-span-beam', () => {
    const design = makeMethodA({
      widthFt: 40,
      lengthFt: 40,
      joist: PT_2X6,
      spacingMm: 610,
      foundation: OLDCASTLE,
    });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    const interiorIds = beams
      .map((b) => b.id)
      .filter((id) => id.startsWith('beam-mid-'));
    expect(interiorIds.length).toBeGreaterThan(0); // precondition: interior beams exist

    const beamWarnIds = new Set(
      spanCheck(layout, IRC)
        .filter((w) => w.kind === 'over-span-beam')
        .map((w) => w.memberId),
    );

    // Every interior beam is span-checked and (on this wide grid)
    // over-spans exactly like the rims — none is skipped.
    for (const id of interiorIds) expect(beamWarnIds.has(id)).toBe(true);
    // The rims are checked too (sanity: interior isn't the ONLY thing).
    expect(beamWarnIds.has('beam-near')).toBe(true);
    expect(beamWarnIds.has('beam-far')).toBe(true);
  });
});

// ===========================================================================
// GAP E — blocking (FR-036) interop with interior beams. [COVERAGE]
// ===========================================================================
//
// §17 Q5 claims blocking (joist plane) and interior beams (beam plane)
// never collide because they sit on different y-planes. The dev suite
// never asserts this. This test proves (a) blocking is still emitted
// when interior beams are present, and (b) the y-plane separation is
// real and non-zero (so AABBs never overlap regardless of z).
// ---------------------------------------------------------------------------

describe('[COVERAGE] GAP E — blocking still emitted with interior beams present, on a distinct y-plane', () => {
  it('16×16 ft: blocking rows exist, sit at joistCenterY, and are a full joist+beam half-depth off the beam plane', () => {
    const design = makeMethodA({ widthFt: 16, lengthFt: 16, joist: PT_2X8 });
    const layout = computeFloatingLayout(design, { spanTable: IRC });
    const y = computeYStackFloating(design);

    const beams = layout.members.filter((m) => m.kind === 'beam');
    const blocking = layout.members.filter((m) => m.kind === 'blocking');

    expect(beams.length).toBeGreaterThanOrEqual(3); // interior beam present
    expect(blocking.length).toBeGreaterThan(0); // FR-036 still active

    // Blocking sits in the JOIST plane; beams in the BEAM plane.
    for (const b of blocking) {
      expect(b.position.y).toBeCloseTo(y.joistCenterY, 6);
    }
    for (const b of beams) {
      expect(b.position.y).toBeCloseTo(y.beamCenterY, 6);
    }

    // Vertical separation between the two planes must be strictly
    // positive → the two members never share an AABB even when a
    // blocking z coincides with an interior-beam z.
    const planeGap = Math.abs(y.joistCenterY - y.beamCenterY);
    expect(planeGap).toBeGreaterThan(0);
    // The gap equals half the joist depth + half the beam depth (the
    // members are stacked, not interpenetrating).
    expect(planeGap).toBeCloseTo(y.joistDepthMm / 2 + y.beamDepthMm / 2, 6);
  });
});

// ===========================================================================
// GAP G — flush→drop transition on a deck that NEEDS interior beams. [COVERAGE]
// ===========================================================================
//
// The dev's apply-parameters test was deliberately SHRUNK to 8 ft so
// `interiorRows === 0` and FR-E never fires — which means the actual
// UAT scenario (16×16 flush needs interior beams → rejected → switch to
// drop → beams render) is NOT covered anywhere. This test pins that
// exact transition on ONE design where only `beamConnection` differs.
// ---------------------------------------------------------------------------

describe('[COVERAGE] GAP G — the UAT flush→drop transition on a deck that needs interior beams', () => {
  const base = makeMethodA({ widthFt: 16, lengthFt: 16, joist: PT_2X8 });

  it('FLUSH on a deck needing interior beams → rejected (FR-E)', () => {
    const flush: DeckDesign = { ...base, beamConnection: 'flush' };
    expect(() => computeFloatingLayout(flush, { spanTable: IRC })).toThrowError(
      LayoutError,
    );
  });

  it('DROP on the same deck → renders ≥3 beams (the one-click fix)', () => {
    const drop: DeckDesign = { ...base, beamConnection: 'drop' };
    const layout = computeFloatingLayout(drop, { spanTable: IRC });
    const beams = layout.members.filter((m) => m.kind === 'beam');
    expect(beams.length).toBeGreaterThanOrEqual(3);
    // And it is span-safe (the whole point of the fix).
    const overSpan = spanCheck(layout, IRC).filter(
      (w) => w.kind === 'over-span-joist',
    );
    expect(overSpan).toEqual([]);
  });
});
