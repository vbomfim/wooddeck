/**
 * `src/persistence/method-a-beams-roundtrip.test.ts` — QA Guardian
 * coverage for issue #75 (FR-G): a saved + reloaded Method A design
 * recomputes IDENTICAL intermediate beams, and a "legacy" `.deck`
 * (pre-#75 — no schema change) loads byte-identically as a DESIGN yet
 * its recomputed LAYOUT now GAINS the span-safe interior beams.
 *
 * ## Why the persistence layer (not domain)
 *
 * Persistence stores the DESIGN, never the computed layout — the layout
 * (and therefore the beams) is RECOMPUTED on load. #75 adds NO `.deck`
 * schema field, so "pre-#75" and "post-#75" designs are byte-identical
 * on disk; only the recomputed layout differs. This mirrors the PR #73
 * `blocking-roundtrip.test.ts` precedent exactly, but MUST thread the
 * `SpanTable` through `computeLayout` — without it, `resolveMethodABeamRows`
 * falls back to `totalRows = 2` and no interior beams appear (the app's
 * real pipeline threads the table via `computeLayoutAndCheck`, see
 * `src/application/compute-layout.ts`).
 *
 * Tag: [AC-9] [REGRESSION]
 */
import { describe, expect, it } from 'vitest';

import { computeLayout } from '../domain/layout/layout-engine';
import type { DeckDesign, LayoutMember } from '../domain/model';
import { MM_PER_FOOT } from '../domain/units';
import { IrcSpanTable } from '../domain/spans/irc-2018-tables';

import { deserialize, serialize } from './deck-file/schema-v2';

const IRC = new IrcSpanTable();

/** Beams recomputed with a fixed clock + the IRC table threaded. */
function beamsOf(design: DeckDesign): readonly LayoutMember[] {
  const layout = computeLayout(design, {
    spanTable: IRC,
    now: () => design.createdAt,
  });
  return layout.members.filter((m) => m.kind === 'beam');
}

/**
 * A 16×16 ft floating Method A DROP design — the verbatim UAT footprint.
 * With the IRC table threaded it gains exactly one interior beam row, so
 * the recomputed layout has 3 beams (near, mid-0, far).
 */
const METHOD_A_DROP: DeckDesign = {
  id: '33333333-3333-4333-8333-000000000075',
  createdAt: '2026-07-05T00:00:00.000Z',
  footprint: { widthMm: 16 * MM_PER_FOOT, lengthMm: 16 * MM_PER_FOOT, heightMm: 3 * MM_PER_FOOT },
  structure: 'floating',
  floatingFraming: 'beams-and-joists',
  beamConnection: 'drop',
  foundation: { type: 'tuffblocks', product: { productId: 'tuffblock-12x12x4' } },
  joist: { material: { nominal: '2x8', species: 'PT', grade: 'No2' }, spacingMm: 406 },
  beam: { material: { nominal: '2x8', species: 'PT', grade: 'No2' } },
  decking: { material: { nominal: '5/4x6', species: 'PT', grade: 'No2' }, orientation: 'parallel-to-width' },
  layout: { bayRemainderStrategy: 'extra-bay-at-end' },
};

describe('issue #75 — Method A intermediate beams survive a persistence round-trip [AC-9][REGRESSION]', () => {
  it('serialize → deserialize → recompute yields DEEP-EQUAL beams (deterministic round-trip)', () => {
    const before = beamsOf(METHOD_A_DROP);
    // Precondition: the design actually gained interior beams (else the
    // round-trip would trivially match on the 2-rim fallback).
    expect(before.length).toBeGreaterThanOrEqual(3);
    expect(before.some((b) => b.id.startsWith('beam-mid-'))).toBe(true);

    const reloaded = deserialize(serialize(METHOD_A_DROP)).design;
    const after = beamsOf(reloaded);

    expect(after).toEqual(before);
  });

  it('the persisted DESIGN is byte-identical through the .deck envelope (FR-G — no schema field added)', () => {
    // Proves the "legacy pre-#75 .deck" claim: because #75 added no
    // schema field, a design saved by the current serializer is exactly
    // what a pre-#75 build would have written — no beam-row hint, no new
    // foundation field. The reloaded DESIGN is deep-equal to the original.
    const reloaded = deserialize(serialize(METHOD_A_DROP)).design;
    expect(reloaded).toEqual(METHOD_A_DROP);
    // And no interior-beam / beam-row field leaked into the envelope.
    const envelope = serialize(METHOD_A_DROP);
    expect(envelope).not.toMatch(/beamRows|interiorRows|beamRowsHint/i);
  });

  it('a "legacy" design (persisted with no beam-row field) GAINS interior beams on reload (FR-G layout delta)', () => {
    // Round-trip the design, then confirm the RELOADED design recomputes
    // a layout WITH interior beams — the documented FR-G behavior:
    // unchanged design in, richer (span-safe) layout out.
    const reloaded = deserialize(serialize(METHOD_A_DROP)).design;
    const beams = beamsOf(reloaded);
    expect(beams.map((b) => b.id)).toContain('beam-mid-0');
    expect(beams.length).toBeGreaterThan(2);
  });
});
