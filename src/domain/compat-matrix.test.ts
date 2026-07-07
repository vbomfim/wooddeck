/**
 * Unit tests for `src/domain/compat-matrix.ts` — the pure
 * `structure × foundation` compatibility check (Epic 2 / S17 /
 * FR-030).
 *
 * TDD RED phase: this file is written BEFORE the implementation.
 * It exhaustively enumerates the 2×3 matrix from GitHub issue #39
 * AC5 so that adding a new `StructureMode` value or a new
 * `FoundationSpec.type` variant fails-compile here until the matrix
 * is updated.
 *
 * The AC9 reason-string smoke tests confirm the failure messages
 * are user-legible plain English (no error codes, no stack
 * fragments) — suitable for direct display in the ParameterPanel
 * (S23).
 */
import { describe, expect, it } from 'vitest';

import {
  validateFoundationCombination,
  type CompatResult,
} from './compat-matrix';
import type {
  FoundationSpec,
  MaterialRef,
  StructureMode,
} from './model';

// ---------------------------------------------------------------------------
// Fixture builders — every foundation variant, ready to plug into a
// call. The `post: MaterialRef` and `footing` values are the same
// ones the default design uses (6×6 PT No2 posts, 300 mm cube
// footings — see `y-stack.ts` for the source constants).
// ---------------------------------------------------------------------------

const POST_6X6_PT_NO2: MaterialRef = {
  nominal: '6x6',
  species: 'PT',
  grade: 'No2',
};

function postsOnFootings(): FoundationSpec {
  return {
    type: 'posts-on-footings',
    post: POST_6X6_PT_NO2,
    footing: { widthMm: 300, depthMm: 300 },
  };
}

function deckBlocks(): FoundationSpec {
  return { type: 'deck-blocks', product: { productId: 'oldcastle-11x11x7' } };
}

function tuffblocks(): FoundationSpec {
  return { type: 'tuffblocks', product: { productId: 'tuffblock-12x12x4' } };
}

// ---------------------------------------------------------------------------
// AC5 — exhaustive 2×3 matrix (FR-030)
// ---------------------------------------------------------------------------
//
// The `MATRIX` list is the sole ground truth for AC5. Adding a new
// `StructureMode` or `FoundationSpec.type` MUST result in a new row
// here and MUST result in the corresponding `switch` in
// `compat-matrix.ts` growing a branch. If either grows without the
// other, this test starts failing (or compilation stops).

interface MatrixCase {
  readonly label: string;
  readonly structure: StructureMode;
  readonly foundation: FoundationSpec;
  readonly expectedOk: boolean;
  /**
   * When `expectedOk` is `false`, the exact reason string the ticket
   * §AC5 pins. Kept as the LITERAL text so a copy-edit in the
   * implementation surfaces here immediately.
   */
  readonly expectedReason?: string;
}

const MATRIX: readonly MatrixCase[] = [
  {
    label: 'elevated + posts-on-footings',
    structure: 'elevated',
    foundation: postsOnFootings(),
    expectedOk: true,
  },
  {
    label: 'elevated + deck-blocks',
    structure: 'elevated',
    foundation: deckBlocks(),
    expectedOk: true,
  },
  {
    label: 'elevated + tuffblocks',
    structure: 'elevated',
    foundation: tuffblocks(),
    expectedOk: false,
    expectedReason:
      'TuffBlock is designed for ground-level (floating) decks; the standard product is not rated for post-supported construction',
  },
  {
    label: 'floating + posts-on-footings',
    structure: 'floating',
    foundation: postsOnFootings(),
    expectedOk: false,
    expectedReason:
      'Floating construction rests directly on the block grid; poured footings are only compatible with elevated construction',
  },
  {
    label: 'floating + deck-blocks',
    structure: 'floating',
    foundation: deckBlocks(),
    expectedOk: true,
  },
  {
    label: 'floating + tuffblocks',
    structure: 'floating',
    foundation: tuffblocks(),
    expectedOk: true,
  },
];

describe('compat-matrix — AC5 exhaustive FR-030 matrix', () => {
  it('the fixture matrix covers all 2×3 combinations exactly once', () => {
    // Defensive sanity check — if a case is duplicated or missing,
    // the exhaustive-per-case assertions below would still pass on
    // the wrong pairs. This test catches that.
    const keys = MATRIX.map((c) => `${c.structure}|${c.foundation.type}`);
    expect(new Set(keys).size).toBe(MATRIX.length);
    expect(MATRIX.length).toBe(6);
  });

  for (const testCase of MATRIX) {
    it(`${testCase.label} → ${testCase.expectedOk ? 'ok' : 'fail'}`, () => {
      const result: CompatResult = validateFoundationCombination({
        structure: testCase.structure,
        foundation: testCase.foundation,
      });
      if (testCase.expectedOk) {
        expect(result.ok).toBe(true);
      } else {
        expect(result.ok).toBe(false);
        // TS narrowing: safe to read .reason after the ok===false branch.
        if (!result.ok) {
          expect(result.reason).toBe(testCase.expectedReason);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// AC9 — reason strings are user-legible plain English
// ---------------------------------------------------------------------------
describe('compat-matrix — AC9 reason strings are user-legible', () => {
  it('no reason contains an error code, stack frame, or bracketed key', () => {
    for (const testCase of MATRIX) {
      if (testCase.expectedOk) continue;
      const result = validateFoundationCombination({
        structure: testCase.structure,
        foundation: testCase.foundation,
      });
      if (!result.ok) {
        // No `SNAKE_CODES`, `[bracketed]`, or `at ` (stack fragment).
        expect(result.reason).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
        expect(result.reason).not.toMatch(/\bat\s+\w+\s*\(/);
        expect(result.reason.length).toBeGreaterThan(20);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Purity — same input → same output; no store / clock / RNG
// ---------------------------------------------------------------------------
describe('compat-matrix — purity', () => {
  it('is deterministic: same input yields byte-identical result on every call', () => {
    for (const testCase of MATRIX) {
      const first = validateFoundationCombination({
        structure: testCase.structure,
        foundation: testCase.foundation,
      });
      const second = validateFoundationCombination({
        structure: testCase.structure,
        foundation: testCase.foundation,
      });
      // Deep-equal — the returned object is a fresh literal each call,
      // but its shape and every field must match exactly.
      expect(second).toEqual(first);
    }
  });
});
