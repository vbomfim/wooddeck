/**
 * AC8 benchmark — `computeLayout` runs in ≤ 50 ms for a 20 ft × 30 ft
 * deck at 16" (406 mm) joist spacing; ≤ 100 ms for 40 ft × 40 ft.
 *
 * Tolerances (autonomous decision):
 *   - Measured with `performance.now()` after a small WARMUP of 3 runs
 *     to prime V8's inline caches; the reported time is the MEDIAN of
 *     `SAMPLE_COUNT` = 11 subsequent runs.
 *   - We use MEDIAN, not average, so an occasional GC pause during a
 *     single sample does not fail an otherwise-fast implementation.
 *   - The ticket's numeric budgets are the ceiling; the median must
 *     stay strictly under them.
 *
 * Timing tests are inherently machine-dependent. If this ever flakes
 * on a slow CI runner, INCREASE the sample count or add a small
 * multiplicative slack — do NOT relax the ticket-mandated ceiling.
 */
import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT } from '../units';
import type { DeckDesign } from '../model';

import { computeLayout } from './layout-engine';

const WARMUP_RUNS = 3;
const SAMPLE_COUNT = 11;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function deckDesign(widthFt: number, lengthFt: number): DeckDesign {
  return {
    id: '00000000-0000-4000-8000-0000000000bb',
    createdAt: '2026-07-02T00:00:00.000Z',
    footprint: {
      widthMm: widthFt * MM_PER_FOOT,
      lengthMm: lengthFt * MM_PER_FOOT,
      heightMm: 3 * MM_PER_FOOT,
    },
    joist: {
      material: { nominal: '2x10', species: 'PT', grade: 'No2' },
      spacingMm: 406,
    },
    beam: { material: { nominal: '2x10', species: 'PT', grade: 'No2' } },
    post: { material: { nominal: '6x6', species: 'PT', grade: 'No2' } },
    decking: {
      material: { nominal: '5/4x6', species: 'PT', grade: 'No2' },
      orientation: 'parallel-to-width',
    },
    layout: { bayRemainderStrategy: 'extra-bay-at-end' },
  };
}

function timeCompute(design: DeckDesign): number {
  const now = () => '2026-07-02T00:00:00.000Z';
  for (let i = 0; i < WARMUP_RUNS; i++) computeLayout(design, { now });
  const samples: number[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t0 = performance.now();
    computeLayout(design, { now });
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

describe('computeLayout — AC8 performance', () => {
  it('20 ft × 30 ft deck completes in ≤ 50 ms (median of 11 samples)', () => {
    const design = deckDesign(20, 30);
    const t = timeCompute(design);
     
    console.log(`[bench] 20×30 ft median: ${t.toFixed(3)} ms`);
    expect(t).toBeLessThanOrEqual(50);
  });

  it('40 ft × 40 ft deck completes in ≤ 100 ms (median of 11 samples)', () => {
    const design = deckDesign(40, 40);
    const t = timeCompute(design);
     
    console.log(`[bench] 40×40 ft median: ${t.toFixed(3)} ms`);
    expect(t).toBeLessThanOrEqual(100);
  });

  it('does not crash on a very large deck (60 ft × 60 ft)', () => {
    const design = deckDesign(60, 60);
    expect(() => computeLayout(design)).not.toThrow();
  });
});
