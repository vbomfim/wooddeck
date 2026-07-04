/**
 * `src/ui/export-menu-helpers.test.ts` — unit tests for the pure
 * helpers backing `<ExportMenu>`.
 *
 * Added S14 UAT pair-fix — FIX J.3 / FIX G. Pins the exact
 * `buildPngFilename` contract:
 *
 *   - the `wooddeck-` prefix and `.png` suffix,
 *   - ISO-8601 date-time-fraction sliced to 23 chars (drops the
 *     trailing `Z`, keeps the SSS millisecond fraction),
 *   - every `:` and `.` replaced with `-` (Windows-safe),
 *   - purity: same input → same output; different-ms inputs in
 *     the same second → distinct outputs (regression test for
 *     the same-second-collision bug FIX G addressed).
 */

import { describe, expect, it } from 'vitest';

import { buildPngFilename, CANVAS_SELECTOR, RESET_CONFIRM_TEXT } from './export-menu-helpers';

describe('buildPngFilename', () => {
  it('produces the wooddeck-<stamp>.png shape', () => {
    // 2024-05-01T14:23:07.129Z → wooddeck-2024-05-01T14-23-07-129.png
    const filename = buildPngFilename(Date.UTC(2024, 4, 1, 14, 23, 7, 129));

    expect(filename).toBe('wooddeck-2024-05-01T14-23-07-129.png');
  });

  it('always includes exactly the ISO date-time-fraction (23 chars from ISO)', () => {
    // The 23-char slice covers YYYY-MM-DDTHH:MM:SS.sss which after
    // colon+dot replacement becomes 23 chars of stamp too.
    const filename = buildPngFilename(Date.UTC(2024, 0, 1, 0, 0, 0, 0));

    const prefix = 'wooddeck-';
    const suffix = '.png';
    expect(filename.startsWith(prefix)).toBe(true);
    expect(filename.endsWith(suffix)).toBe(true);
    const stamp = filename.slice(prefix.length, filename.length - suffix.length);
    // YYYY-MM-DDTHH-MM-SS-SSS = 4+1+2+1+2 + 1 + 2+1+2+1+2 + 1 + 3 = 23
    expect(stamp).toHaveLength(23);
  });

  it('replaces every ":" with "-" (Windows filename safety)', () => {
    // Windows disallows `:` in filenames. ISO-8601 has two of
    // them (HH:MM:SS); neither may leak into the output.
    const filename = buildPngFilename(Date.UTC(2024, 4, 1, 14, 23, 7, 42));

    expect(filename).not.toContain(':');
  });

  it('replaces the millisecond "." separator too so the SSS fraction merges cleanly', () => {
    // The `.` before SSS is not filename-illegal (it's what makes
    // the `.png` extension work) but if we left the dot the
    // filename would end up as `…07.042.png` — two extensions,
    // ambiguous to some tools. The regex `/[:.]/g` collapses
    // both the timestamp colons and the millisecond dot into
    // hyphens so there's exactly one dot in the filename (the
    // extension).
    const filename = buildPngFilename(Date.UTC(2024, 4, 1, 14, 23, 7, 42));

    // Exactly one dot: the .png extension.
    const dotCount = (filename.match(/\./g) ?? []).length;
    expect(dotCount).toBe(1);
    expect(filename.endsWith('.png')).toBe(true);
  });

  it('is a pure function (same input → same output)', () => {
    const ms = Date.UTC(2024, 5, 15, 9, 30, 0, 500);

    expect(buildPngFilename(ms)).toBe(buildPngFilename(ms));
  });

  it('produces distinct filenames for two clicks in the same second (FIX G regression)', () => {
    // Prior implementation sliced the ISO string at index 19,
    // dropping the SSS fraction entirely. Two clicks 100ms
    // apart would collide → the second download would silently
    // overwrite (or coalesce) the first in the browser's Save
    // As dialog. The ms fraction fixes it.
    const a = buildPngFilename(Date.UTC(2024, 4, 1, 14, 23, 7, 100));
    const b = buildPngFilename(Date.UTC(2024, 4, 1, 14, 23, 7, 900));

    expect(a).not.toBe(b);
  });

  it('zero-pads the millisecond fraction to three digits', () => {
    // A single-digit ms (e.g. 5) must render as `005`, not `5`,
    // otherwise lexical sort order breaks.
    const filename = buildPngFilename(Date.UTC(2024, 4, 1, 14, 23, 7, 5));

    expect(filename).toBe('wooddeck-2024-05-01T14-23-07-005.png');
  });
});

describe('CANVAS_SELECTOR (contract with scene layer)', () => {
  it('is the exact CSS selector that targets DeckScene\'s canvas class', () => {
    // The class literal is duplicated between src/scene/DeckScene.tsx
    // (WOODDECK_CANVAS_CLASSNAME) and here (CANVAS_SELECTOR) —
    // dep-cruiser forbids ui → scene imports at runtime.
    // FIX H — the pinning test lives in
    // src/ui/canvas-selector-contract.test.ts (test files are
    // dep-cruiser-exempt so they can import from both layers).
    // This test just documents the shape at the ui-helpers boundary.
    expect(CANVAS_SELECTOR).toBe('canvas.wooddeck-canvas');
  });
});

describe('RESET_CONFIRM_TEXT', () => {
  it('is the exact prompt shown by window.confirm on Reset', () => {
    // Frozen so tests can spy on window.confirm's argument
    // without duplicating the copy — a change here (e.g. a UX
    // rewording) must consciously update both the constant AND
    // any user-facing i18n catalogue.
    expect(RESET_CONFIRM_TEXT).toBe(
      'Reset to default deck? Your current design will be replaced.',
    );
  });
});
