/**
 * Unit tests for the PURE helper
 * `src/scene/warning-overlay-resolve.ts` — the missing-memberId
 * dedup + resolution logic extracted from `<WarningOverlay>`.
 *
 * ## Why a separate test file (Code Review GPT#2 hardening)
 *
 * The previous integration test asserted "warnSpy is called
 * ≤4 times" against the r3f test-renderer double-render behavior.
 * That soft ceiling would still PASS if the dedup were removed
 * (a regression would produce 2× or 4× more calls but still
 * fit under the ceiling — non-diagnostic). Extracting the fold
 * to a pure helper lets us assert:
 *
 *   - EXACT resolved-pair count + shape
 *   - EXACT missing-ids set (deduped, sorted)
 *   - order-independence w.r.t. the input warnings order
 *
 * ...without touching React, r3f, jsdom, or the Zustand store.
 * A test that removes the dedup flips this file RED immediately.
 */
import { describe, expect, it } from 'vitest';

import { makeMember, makeWarning } from './layers/__testing__/fixtures';
import { resolveWarningsToMembers } from './warning-overlay-resolve';

describe('resolveWarningsToMembers — happy path (all warnings map to a member)', () => {
  it('returns one (warning, member) pair per warning + zero missing ids', () => {
    const members = [
      makeMember({ id: 'joist-a', kind: 'joist' }),
      makeMember({ id: 'joist-b', kind: 'joist' }),
    ];
    const warnings = [
      makeWarning({ memberId: 'joist-a' }),
      makeWarning({ memberId: 'joist-b' }),
    ];

    const { pairs, missingIds } = resolveWarningsToMembers(warnings, members);

    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.warning).toBe(warnings[0]);
    expect(pairs[0]!.member).toBe(members[0]);
    expect(pairs[1]!.warning).toBe(warnings[1]);
    expect(pairs[1]!.member).toBe(members[1]);
    expect(missingIds).toEqual([]);
  });

  it('ignores members that no warning references (member-set can be a superset)', () => {
    // 3 members in the layout, one warning → one pair; no missing.
    const members = [
      makeMember({ id: 'joist-x', kind: 'joist' }),
      makeMember({ id: 'joist-y', kind: 'joist' }),
      makeMember({ id: 'joist-z', kind: 'joist' }),
    ];
    const warnings = [makeWarning({ memberId: 'joist-y' })];

    const { pairs, missingIds } = resolveWarningsToMembers(warnings, members);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.member.id).toBe('joist-y');
    expect(missingIds).toEqual([]);
  });

  it('preserves the input warnings order in the returned pairs (deterministic scene graph)', () => {
    // The overlay renders one <OverSpanHighlight> per pair; scene-
    // graph traversal order matches pairs order. Preserving input
    // order keeps the mesh order stable across resolves, which
    // matters for any downstream test that iterates by index.
    const members = [
      makeMember({ id: 'm-2', kind: 'joist' }),
      makeMember({ id: 'm-0', kind: 'joist' }),
      makeMember({ id: 'm-1', kind: 'joist' }),
    ];
    const warnings = [
      makeWarning({ memberId: 'm-2' }),
      makeWarning({ memberId: 'm-0' }),
      makeWarning({ memberId: 'm-1' }),
    ];

    const { pairs } = resolveWarningsToMembers(warnings, members);

    expect(pairs.map((p) => p.member.id)).toEqual(['m-2', 'm-0', 'm-1']);
  });
});

describe('resolveWarningsToMembers — missing memberIds (DEDUP diagnostic)', () => {
  it('drops warnings whose memberId is unknown; missing memberIds surface in `missingIds`', () => {
    const members = [makeMember({ id: 'joist-known', kind: 'joist' })];
    const warnings = [
      makeWarning({ memberId: 'joist-known' }),
      makeWarning({ memberId: 'joist-GHOST' }),
    ];

    const { pairs, missingIds } = resolveWarningsToMembers(warnings, members);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.member.id).toBe('joist-known');
    expect(missingIds).toEqual(['joist-GHOST']);
  });

  it('DEDUPES: two warnings for the SAME missing memberId → ONE entry in `missingIds`', () => {
    // The diagnostic assertion (Code Review GPT#2). If the dedup
    // is removed, `missingIds` would be `['joist-DUP', 'joist-DUP']`
    // and this test flips RED. Absent this test, the useEffect
    // diagnostic would spam the console with N identical warnings
    // per render.
    const members = [makeMember({ id: 'joist-real', kind: 'joist' })];
    const warnings = [
      makeWarning({ memberId: 'joist-DUP' }),
      makeWarning({ memberId: 'joist-DUP' }),
      makeWarning({ memberId: 'joist-DUP' }),
    ];

    const { pairs, missingIds } = resolveWarningsToMembers(warnings, members);

    expect(pairs).toEqual([]);
    // EXACTLY one entry — dedup diagnostic.
    expect(missingIds).toEqual(['joist-DUP']);
    expect(missingIds.length).toBe(1);
  });

  it('sorts `missingIds` alphabetically so the useEffect key is stable', () => {
    // The overlay's dev-log useEffect keys on `missingIds.join('|')`.
    // If the resolve helper returned ids in first-occurrence order
    // instead of sorted, two inputs that differ only in the order
    // of missing warnings would produce different effect keys and
    // fire duplicate logs across a re-render. Sorting alphabetically
    // makes the key content-addressed → dedup across renders too.
    const members = [makeMember({ id: 'joist-real', kind: 'joist' })];
    const warnings = [
      makeWarning({ memberId: 'joist-ZZZ' }),
      makeWarning({ memberId: 'joist-AAA' }),
      makeWarning({ memberId: 'joist-MMM' }),
    ];

    const { missingIds } = resolveWarningsToMembers(warnings, members);

    expect(missingIds).toEqual(['joist-AAA', 'joist-MMM', 'joist-ZZZ']);
  });

  it('collapses duplicates AND sorts — combined property', () => {
    const members: never[] = [];
    const warnings = [
      makeWarning({ memberId: 'joist-B' }),
      makeWarning({ memberId: 'joist-A' }),
      makeWarning({ memberId: 'joist-B' }),
      makeWarning({ memberId: 'joist-A' }),
      makeWarning({ memberId: 'joist-C' }),
    ];

    const { pairs, missingIds } = resolveWarningsToMembers(warnings, members);

    expect(pairs).toEqual([]);
    expect(missingIds).toEqual(['joist-A', 'joist-B', 'joist-C']);
  });
});

describe('resolveWarningsToMembers — degenerate inputs', () => {
  it('empty warnings → empty pairs + empty missingIds (AC4 fast path)', () => {
    const members = [makeMember({ id: 'joist-x', kind: 'joist' })];

    const { pairs, missingIds } = resolveWarningsToMembers([], members);

    expect(pairs).toEqual([]);
    expect(missingIds).toEqual([]);
  });

  it('empty members + any warnings → every warning is missing (deduped/sorted)', () => {
    const warnings = [
      makeWarning({ memberId: 'joist-2' }),
      makeWarning({ memberId: 'joist-1' }),
      makeWarning({ memberId: 'joist-2' }),
    ];

    const { pairs, missingIds } = resolveWarningsToMembers(warnings, []);

    expect(pairs).toEqual([]);
    expect(missingIds).toEqual(['joist-1', 'joist-2']);
  });
});
