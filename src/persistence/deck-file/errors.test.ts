/**
 * Unit tests for `DeckFileError` — the single error type surfaced by the
 * persistence layer's public API (issue #7 §2 interface contract).
 *
 * These tests define the observable behaviour of the class BEFORE any
 * implementation exists (TDD red). They pin two invariants downstream
 * consumers (S7 use-cases, S8 state store, S14 UI) rely on:
 *
 *   1. `instanceof DeckFileError` and `instanceof Error` both hold —
 *      catch-blocks branching on either work uniformly.
 *   2. `.code` is a stable string literal, safe to switch on in a UI
 *      layer that maps codes to i18n messages without leaking impl
 *      detail (ticket §6 Security — error responses must not leak
 *      stack traces / internal paths).
 */
import { describe, expect, it } from 'vitest';

import { DeckFileError } from './errors';
import type { DeckFileErrorCode } from './errors';

describe('DeckFileError', () => {
  it('is an instance of Error and DeckFileError', () => {
    const err = new DeckFileError('invalid-json', 'boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DeckFileError);
  });

  it('exposes .code as a discriminated union tag', () => {
    const err = new DeckFileError('schema-validation-failed', 'missing field: design.footprint');
    // The type assertion below is the runtime shape assertion — the
    // compile-time discipline is enforced by tests further down that
    // exhaustively enumerate every code literal.
    const code: DeckFileErrorCode = err.code;
    expect(code).toBe('schema-validation-failed');
  });

  it('sets .name to "DeckFileError" so stack traces attribute correctly', () => {
    // Node's default `Error.name` is "Error" — a subclass that forgets
    // to set `.name` in its constructor renders as "Error: message" in
    // stack traces, which defeats the purpose of the subclass. This
    // pins the fix.
    const err = new DeckFileError('storage-full', 'quota exceeded');
    expect(err.name).toBe('DeckFileError');
  });

  it('propagates .message unchanged', () => {
    const err = new DeckFileError(
      'unknown-schema',
      'unsupported .deck schema version: 999',
    );
    expect(err.message).toBe('unsupported .deck schema version: 999');
  });

  it('carries an optional `cause` for exception chaining', () => {
    const original = new SyntaxError('Unexpected token o in JSON at position 1');
    const err = new DeckFileError('invalid-json', 'failed to parse .deck file', original);
    expect(err.cause).toBe(original);
  });

  it('leaves .cause undefined when not supplied', () => {
    const err = new DeckFileError('storage-blocked', 'localStorage unavailable');
    expect(err.cause).toBeUndefined();
  });

  it('accepts every documented `code` literal — union stays exhaustive', () => {
    // The seven allowlisted codes from ticket §2 — a rename or removal
    // is caught by TS at compile time AND by this runtime enumeration.
    // `file-too-large` and `file-read-failed` were added in the S6
    // review gate (PR #26); before then they were mis-mapped to
    // `schema-validation-failed` / `invalid-json` respectively. The
    // enumeration test is the frozen source of truth for the union
    // shape — anyone adding an 8th code MUST update this array (which
    // forces a ticket edit, matching the "code widening is an API
    // change" policy).
    const codes: readonly DeckFileErrorCode[] = [
      'unknown-schema',
      'invalid-json',
      'schema-validation-failed',
      'file-too-large',
      'file-read-failed',
      'storage-full',
      'storage-blocked',
    ];
    for (const code of codes) {
      const err = new DeckFileError(code, `test: ${code}`);
      expect(err.code).toBe(code);
    }
    // Belt-and-suspenders: the length pin catches an accidental
    // deletion from the array above that TS could not flag (removing
    // an element still type-checks — but the count would drift).
    expect(codes).toHaveLength(7);
  });

  it('rejects a value NOT in the union at compile time (documentation)', () => {
    // This block is a compile-time assertion, not a runtime one: if
    // the union widens to accept `'bogus-code'` a future contributor
    // would strip the @ts-expect-error and silently pass a bad code
    // through. Keeping the expect-error means the test file itself
    // fails to compile if the union changes shape unexpectedly.
    //
    // @ts-expect-error — 'bogus-code' is not a DeckFileErrorCode
    const err = new DeckFileError('bogus-code', 'should not compile');
    // The runtime object is still constructed; only the type-check fails.
    expect(err).toBeInstanceOf(DeckFileError);
  });
});
