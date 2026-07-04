/**
 * `tokens.contrast.test.ts` — S12 pair-fix iter 1 Fix I
 * (Opus + GPT#5 + QA).
 *
 * ## Why (accountability moves from a comment to a CI gate)
 *
 * Before Fix I, the contrast ratios for every fg/bg pair were
 * documented in the `tokens.css` header comment ("hand-picked to
 * exceed 4.5:1"). The comment is worth having, but it is NOT a
 * regression gate — a maintainer editing `--wd-color-…-text` a
 * shade lighter would ship a WCAG failure with a passing CI.
 *
 * This test computes the WCAG 2.2 §1.4.3 contrast ratio from the
 * actual token values in `tokens.css` and asserts each pair
 * meets ≥ 4.5:1 for normal text (5.85+ headroom in most cases).
 *
 * ## Why static parsing (not jsdom + getComputedStyle)
 *
 * jsdom does NOT implement `getComputedStyle` for CSS custom
 * properties reliably, and axe-core's color-contrast rule is
 * disabled in the jsdom environment (needs a real layout engine).
 * The static approach is deterministic, fast (< 5 ms), and
 * catches the exact regression we care about: someone changing a
 * `--wd-color-…-text` hex without checking the ratio.
 *
 * Real end-to-end color contrast is exercised in the (post-S14)
 * Playwright E2E via axe-playwright — this static test is the
 * defence-in-depth layer at unit-test speed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const TOKENS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'tokens.css',
);
const TOKENS_CSS = readFileSync(TOKENS_PATH, 'utf8');

/**
 * Parse a `--wd-color-…: #rrggbb;` declaration out of the CSS
 * source. Returns the 6-digit hex string (no leading `#`) or
 * throws with a diagnostic if the token is missing.
 */
function readTokenHex(name: string): string {
  const match = new RegExp(`--${name}\\s*:\\s*#([0-9a-fA-F]{6})\\s*;`).exec(TOKENS_CSS);
  if (match === null) {
    throw new Error(
      `[tokens.contrast.test] token "--${name}" not found in tokens.css — either the token was renamed or the declaration lost its explicit #rrggbb value.`,
    );
  }
  return match[1]!.toLowerCase();
}

/**
 * Convert an sRGB channel value (0-255) to its linearized form
 * per WCAG 2.2 §1.4.3 (the relative-luminance formula).
 */
function channelToLinear(channel8: number): number {
  const c = channel8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance for an #rrggbb color. */
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

/**
 * WCAG contrast ratio between two colors (1.0 minimum, 21.0
 * maximum). Rounded to two decimals for stable snapshot behavior.
 */
function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const raw = (lighter + 0.05) / (darker + 0.05);
  return Math.round(raw * 100) / 100;
}

// The pairs we must verify. Each entry is (label, fg-token,
// bg-token, min-ratio). Normal text needs ≥ 4.5:1; large text
// (≥ 18pt or ≥ 14pt bold) could use 3:1, but we hold all UI text
// to the stricter bar so a copy-paste from one region to another
// can't accidentally drop below the threshold.
const NORMAL_TEXT_MIN = 4.5;
const PAIRS: readonly {
  label: string;
  fg: string;
  bg: string;
  min: number;
}[] = [
  { label: 'body text on background', fg: 'wd-color-text', bg: 'wd-color-bg', min: NORMAL_TEXT_MIN },
  { label: 'body text on alt surface', fg: 'wd-color-text', bg: 'wd-color-surface-alt', min: NORMAL_TEXT_MIN },
  {
    label: 'disclaimer text on disclaimer bg',
    fg: 'wd-color-disclaimer-text',
    bg: 'wd-color-disclaimer-bg',
    min: NORMAL_TEXT_MIN,
  },
  {
    label: 'storage-full banner',
    fg: 'wd-color-banner-full-text',
    bg: 'wd-color-banner-full-bg',
    min: NORMAL_TEXT_MIN,
  },
  {
    label: 'storage-blocked banner',
    fg: 'wd-color-banner-blocked-text',
    bg: 'wd-color-banner-blocked-bg',
    min: NORMAL_TEXT_MIN,
  },
  {
    label: 'load-recompute-failed banner',
    fg: 'wd-color-banner-recompute-text',
    bg: 'wd-color-banner-recompute-bg',
    min: NORMAL_TEXT_MIN,
  },
  {
    label: 'context-lost banner (Fix C)',
    fg: 'wd-color-context-lost-text',
    bg: 'wd-color-context-lost-bg',
    min: NORMAL_TEXT_MIN,
  },
  {
    label: 'scene error boundary (Fix B)',
    fg: 'wd-color-scene-error-text',
    bg: 'wd-color-scene-error-bg',
    min: NORMAL_TEXT_MIN,
  },
  {
    label: 'disabled-reason text on bg (S16 pair-fix)',
    fg: 'wd-color-disabled-reason',
    bg: 'wd-color-bg',
    min: NORMAL_TEXT_MIN,
  },
];

describe('tokens.css — WCAG 2.2 §1.4.3 contrast (Fix I static gate)', () => {
  for (const pair of PAIRS) {
    it(`${pair.label} meets ${pair.min}:1 contrast (WCAG AA normal text)`, () => {
      const fgHex = readTokenHex(pair.fg);
      const bgHex = readTokenHex(pair.bg);
      const ratio = contrastRatio(fgHex, bgHex);
      expect(
        ratio,
        `--${pair.fg} (#${fgHex}) on --${pair.bg} (#${bgHex}) = ${ratio}:1; needs ≥ ${pair.min}:1`,
      ).toBeGreaterThanOrEqual(pair.min);
    });
  }

  it('exports a self-consistency check: the contrast formula matches WCAG examples', () => {
    // Sanity: WCAG's canonical example — pure black on pure white
    // is 21:1 (the maximum). If this ever drifts, the formula is
    // wrong and every other assertion above is untrustworthy.
    expect(contrastRatio('000000', 'ffffff')).toBe(21);
    // Another canonical: #777777 on #ffffff ≈ 4.48:1 (fails AA by
    // a hair — WebAIM). Our rounding gives 4.48.
    expect(contrastRatio('777777', 'ffffff')).toBeCloseTo(4.48, 2);
  });
});
