/**
 * Unit tests for `src/domain/assert-never.ts`.
 *
 * Introduced in S26 FIX #7 (review-gate hardening). Runtime
 * behavior is small enough to sanity-check here; the *value* of
 * this helper is at the compile-site (exhaustive-switch guards
 * for `floatingFraming` in `floating-layout.ts` and
 * `y-stack-floating.ts`), which the TypeScript compiler
 * verifies on every build.
 */
import { describe, expect, it } from 'vitest';

import { assertNever } from './assert-never';

describe('assertNever — runtime fail-loud', () => {
  it('throws with the stringified value when called', () => {
    // A runtime-only union widening (e.g. bad `as` cast, corrupt
    // persisted enum value) reaches assertNever with a real value.
    // The message must include the offending value for debugging.
    expect(() =>
      assertNever('unexpected-framing' as unknown as never),
    ).toThrow(/unexpected-framing/);
  });

  it('includes the context label when provided', () => {
    expect(() =>
      assertNever(
        'garbage' as unknown as never,
        'floatingFraming dispatch',
      ),
    ).toThrow(/floatingFraming dispatch.*garbage/);
  });

  it('formats undefined/null runtime widenings without crashing', () => {
    // `String(undefined)` → 'undefined'; `String(null)` → 'null'.
    // Both must round-trip through the error message.
    expect(() => assertNever(undefined as unknown as never)).toThrow(
      /undefined/,
    );
    expect(() => assertNever(null as unknown as never)).toThrow(/null/);
  });
});
