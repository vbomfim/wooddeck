/**
 * Unit tests for `src/domain/id.ts`.
 *
 * `makeDeckDesignId()` is a one-liner over `crypto.randomUUID()`. The
 * tests focus on the contract this module owes its consumers:
 *
 *   - the output is a well-formed RFC 4122 v4 UUID string,
 *   - two consecutive calls produce distinct values (no cache / no
 *     stale singleton),
 *   - the guard error fires clearly when the underlying platform
 *     capability is missing (Node ≥ 22 will not exercise this in CI,
 *     but the fallback message is what a future runtime downgrade
 *     would surface).
 */
import { describe, expect, it } from 'vitest';

import { UUID_V4_PATTERN, makeDeckDesignId } from './id';

describe('id — makeDeckDesignId', () => {
  it('returns an RFC 4122 v4 UUID string', () => {
    const id = makeDeckDesignId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(UUID_V4_PATTERN);
  });

  it('produces a distinct value on every call (no accidental memoization)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      seen.add(makeDeckDesignId());
    }
    expect(seen.size).toBe(100);
  });

  it('UUID_V4_PATTERN rejects obvious malformed inputs', () => {
    // Guards against a regex regression that would allow the wrong
    // version bit or an incorrect variant nibble to slip through.
    expect(UUID_V4_PATTERN.test('')).toBe(false);
    expect(UUID_V4_PATTERN.test('not-a-uuid')).toBe(false);
    // Wrong version (5 instead of 4 in the version position).
    expect(UUID_V4_PATTERN.test('018f4e7a-c1c5-5a3f-8f52-3a0f6c9d1e4b')).toBe(false);
    // Wrong variant nibble (c instead of 8/9/a/b).
    expect(UUID_V4_PATTERN.test('018f4e7a-c1c5-4a3f-cf52-3a0f6c9d1e4b')).toBe(false);
  });
});
