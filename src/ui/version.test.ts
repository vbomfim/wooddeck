import { describe, expect, it } from 'vitest';
import { APP_VERSION_FALLBACK, getAppVersion } from './version';

describe('getAppVersion', () => {
  it('returns a non-empty string', () => {
    // The vite `define` substitutes `__WOODDECK_VERSION__` at
    // transform time for both build AND vitest (vite handles the
    // transform for both). So this call must always yield a real
    // version string.
    const v = getAppVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });

  it('does NOT return the fallback under vitest — the vite define must fire in test mode', () => {
    // Regression guard: if a future refactor breaks the vite
    // `define` substitution (e.g. moving `vite.config.ts` config to
    // a separate vitest config that forgets the define), this test
    // catches it. AppHeader would silently render "0.0.0-unknown"
    // otherwise.
    expect(getAppVersion()).not.toBe(APP_VERSION_FALLBACK);
  });

  it('matches semver-ish shape (major.minor.patch or 0.0.0)', () => {
    // Loose regex — accepts pre-release / build metadata after the
    // three dot-numbers. Guards against a define that accidentally
    // substitutes a non-version literal (e.g. the whole package.json).
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+(-.+)?$/);
  });
});
