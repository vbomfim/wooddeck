/**
 * Barrel-export smoke test for `src/persistence/index.ts`.
 *
 * Every public API listed in issue #7 §2 MUST be re-exported from the
 * barrel so downstream layers (`src/state/`, `src/ui/`) can import
 * `from '../persistence'` without reaching into private submodules.
 * A reorganization inside `persistence/` must NOT break consumers as
 * long as the barrel keeps the same surface.
 */
import { describe, expect, it } from 'vitest';
import * as pkg from './index';

describe('persistence barrel — public API contract', () => {
  it('re-exports every function documented in the ticket §2 interface', () => {
    expect(typeof pkg.serialize).toBe('function');
    expect(typeof pkg.deserialize).toBe('function');
    expect(typeof pkg.saveDesignToLocalStorage).toBe('function');
    expect(typeof pkg.loadDesignFromLocalStorage).toBe('function');
    expect(typeof pkg.clearDesignFromLocalStorage).toBe('function');
    expect(typeof pkg.downloadDeckFile).toBe('function');
    expect(typeof pkg.readDeckFile).toBe('function');
  });

  it('re-exports the STORAGE_KEY frozen constant', () => {
    expect(pkg.STORAGE_KEY).toBe('wooddeck:current-design:v1');
  });

  it('re-exports DeckFileError (class) so consumers can `instanceof` check', () => {
    expect(typeof pkg.DeckFileError).toBe('function');
    const err = new pkg.DeckFileError('invalid-json', 'boom');
    expect(err).toBeInstanceOf(pkg.DeckFileError);
    expect(err).toBeInstanceOf(Error);
  });
});
