/**
 * Unit tests for `src/domain/spans/span-table.ts` — TDD RED phase.
 *
 * The module under test defines the `SpanTable` **interface** — a
 * seam that lets `spanCheck` be tested against a mock (AC3) and lets
 * future stories swap in IRC-2024 / NBC datasets without touching
 * the checker. Because an interface has no runtime footprint on its
 * own, these tests exercise the SHAPE of the interface by
 * constructing an in-line mock that implements every member and
 * asserting each method is callable with the expected argument types
 * and return type.
 *
 * If any of the following changes, this file is the FIRST place a
 * regression will fire:
 *   - `edition` type-widens from `string` to something else
 *   - `lookupJoistMaxSpan` / `lookupBeamMaxSpan` change signature
 *   - `citationFor(kind, material, spacingMm)` swaps parameter order
 *
 * These tests DO NOT exercise the IRC values themselves — that's the
 * job of `irc-2018-tables.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { MaterialRef, MemberKind } from '../model';
import type { Mm } from '../units';

import type { SpanTable } from './span-table';

// A trivial fake implementation used purely to prove the interface
// contract compiles + is callable. Every method returns a sentinel
// value the caller can uniquely identify.
const FAKE: SpanTable = {
  edition: 'TEST-EDITION',
  lookupJoistMaxSpan: (material: MaterialRef, spacingMm: Mm): Mm =>
    // sentinel: 1234 for "any joist lookup at all"
    1234 + material.nominal.length + spacingMm * 0,
  lookupBeamMaxSpan: (material: MaterialRef, joistSpanMm: Mm, plyCount: number): Mm =>
    5678 + material.nominal.length + joistSpanMm * 0 + plyCount * 0,
  citationFor: (kind: MemberKind, material: MaterialRef, spacingMm: Mm): string =>
    `${kind}|${material.nominal}|${spacingMm}`,
};

describe('SpanTable interface — contract shape', () => {
  it('exposes an `edition` field of type string', () => {
    expect(typeof FAKE.edition).toBe('string');
    expect(FAKE.edition).toBe('TEST-EDITION');
  });

  it('lookupJoistMaxSpan takes (MaterialRef, Mm) and returns Mm', () => {
    const material: MaterialRef = { nominal: '2x8', species: 'PT', grade: 'No2' };
    const result = FAKE.lookupJoistMaxSpan(material, 406);
    expect(typeof result).toBe('number');
    // 1234 + '2x8'.length (3) = 1237 for the sentinel — proves both
    // parameters landed in the function without a swap.
    expect(result).toBe(1237);
  });

  it('lookupBeamMaxSpan takes (MaterialRef, Mm, number) and returns Mm', () => {
    const material: MaterialRef = { nominal: '2x10', species: 'PT', grade: 'No2' };
    const result = FAKE.lookupBeamMaxSpan(material, 3658, 2);
    expect(typeof result).toBe('number');
    // 5678 + '2x10'.length (4) = 5682
    expect(result).toBe(5682);
  });

  it('citationFor takes (MemberKind, MaterialRef, Mm) and returns string', () => {
    const material: MaterialRef = { nominal: '2x6', species: 'Cedar', grade: 'No2' };
    expect(FAKE.citationFor('joist', material, 305)).toBe('joist|2x6|305');
    expect(FAKE.citationFor('beam', material, 0)).toBe('beam|2x6|0');
  });
});
