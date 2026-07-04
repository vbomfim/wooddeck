/**
 * `src/ui/canvas-selector-contract.test.ts` — pins the string
 * identity between the SCENE-side canvas class
 * (`WOODDECK_CANVAS_CLASSNAME`) and the UI-side query selector
 * (`CANVAS_SELECTOR`).
 *
 * ## Why
 *
 * dep-cruiser forbids `ui/` → `scene/` imports at runtime
 * (BLOCK-2d in `scripts/boundary-selftest.mjs`). That means the
 * literal `'wooddeck-canvas'` is DUPLICATED in two places:
 *
 *   - `src/scene/DeckScene.tsx` — `WOODDECK_CANVAS_CLASSNAME`
 *     applied to the r3f `<Canvas>` element.
 *   - `src/ui/export-menu-helpers.ts` — `CANVAS_SELECTOR`
 *     (`canvas.wooddeck-canvas`) used by `<ExportMenu>` to find
 *     the canvas via `document.querySelector`.
 *
 * If someone renames the class on one side without the other,
 * `Export PNG` silently breaks: the canvas mounts fine, but
 * `document.querySelector('canvas.wooddeck-canvas')` returns
 * null and the user gets the "Could not find the 3D view
 * canvas." error instead of a PNG.
 *
 * Test files are DEP-CRUISER-EXEMPT (they can import from both
 * layers). This file cross-imports both symbols and asserts the
 * exact identity `CANVAS_SELECTOR === \`canvas.${WOODDECK_CANVAS_CLASSNAME}\``.
 * Any rename triggers a test failure at CI time before the bug
 * ships.
 *
 * Added S14 UAT pair-fix — FIX H (both Code Review Opus + GPT
 * flagged the missing contract test).
 */

import { describe, expect, it } from 'vitest';

import { WOODDECK_CANVAS_CLASSNAME } from '../scene/DeckScene';
import { CANVAS_SELECTOR } from './export-menu-helpers';

describe('canvas class ↔ selector contract', () => {
  it('CANVAS_SELECTOR selects the exact class DeckScene applies', () => {
    // If this fails, ExportMenu's document.querySelector will
    // not find the canvas rendered by DeckScene — Export PNG
    // will error out with "Could not find the 3D view canvas."
    // even though the 3D viewer is on-screen.
    expect(CANVAS_SELECTOR).toBe(`canvas.${WOODDECK_CANVAS_CLASSNAME}`);
  });
});
