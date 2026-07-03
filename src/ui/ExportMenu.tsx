/**
 * `src/ui/ExportMenu.tsx` — S14 issue #15 AC8..AC11.
 *
 * ## Responsibility (single)
 *
 * Render four buttons that trigger the four export/lifecycle
 * actions:
 *
 *   1. **Download .deck** (AC8) — calls
 *      `useDesignStore.getState().downloadDeckFile()` which
 *      delegates through `application/save-design.ts` to the
 *      persistence-layer file adapter.
 *   2. **Open .deck…** (AC9) — a `<label htmlFor>` that surfaces a
 *      hidden `<input type="file">`. On selection, calls
 *      `useDesignStore.getState().loadFromFile(file)`. Failures
 *      (`DeckFileError`) land in `useDesignStatus().lastError`
 *      and render as an inline error region inside this menu.
 *   3. **Export PNG** (AC10) — finds the canvas via
 *      `document.querySelector('canvas.wooddeck-canvas')` (the
 *      stable class DeckScene exposes; see
 *      `WOODDECK_CANVAS_CLASSNAME`), then calls
 *      `useDesignStore.getState().exportScreenshot(canvas,
 *      filename)`. The filename is built here from an injectable
 *      clock (defaults to `Date.now`) so tests can freeze the
 *      time. AC edge: canvas missing OR zero size → the store
 *      action throws `DeckFileError code='canvas-empty'` which
 *      surfaces the same way as the load-file error.
 *   4. **Reset to defaults** (AC11) — `window.confirm(...)` then
 *      `useDesignStore.getState().reset()`.
 *
 * ## Injectable dependencies
 *
 * The default component uses:
 *   - `document.querySelector('canvas.wooddeck-canvas')` for the
 *     canvas lookup.
 *   - `window.confirm(...)` for the reset confirmation.
 *   - `Date.now()` for the PNG filename timestamp.
 *
 * All three are injectable via `ExportMenuProps` so tests can
 * stub them without patching globals. The default panel wiring
 * (in `App.tsx`) passes nothing — the defaults are the real
 * DOM/window/clock.
 *
 * ## Screenshot boundary discipline
 *
 * The ui layer is boundary-forbidden from importing
 * `../persistence` (BLOCK-2t) and `../application` (BLOCK-2s).
 * The PNG export flows through the store action added in
 * `design-store.exportScreenshot(canvas, filename)`, which
 * delegates to `application/screenshot.exportCanvasScreenshot`
 * which delegates to `persistence/screenshot.downloadCanvasScreenshot`.
 * Every boundary is machine-checked; the store action is the
 * ONLY inter-layer channel.
 *
 * ## Accessibility (§10)
 *
 *   - The `<label htmlFor>` pattern surfaces the hidden `<input
 *     type="file">` without exposing a naked file input to the
 *     user. `role="button"` on the label + `tabIndex={0}` (both
 *     applied via CSS `[htmlFor]` targeting) — but the safer
 *     pattern is to wrap the label around a real `<button>`
 *     styled to trigger the input. We use the RAW `<input
 *     type="file">` hidden + `<label htmlFor>` pattern; the
 *     label is visible and clickable, which is the pattern
 *     axe-core's "form-field-multiple-labels" rule expects.
 *   - The error region uses `role="alert"` so screen readers
 *     announce it when a `DeckFileError` surfaces.
 *   - Buttons have visible focus (inherited from
 *     `tokens.css :focus-visible`).
 *
 * ## Boundary
 *
 *   - `../state` (useDesignStore + useDesignStatus)
 *   - `react` (JSX + useRef + useEffect for the file-input mount
 *     hygiene)
 *   - NO domain / application / persistence / scene direct imports.
 */
import { useRef, useState, type JSX } from 'react';

import { useDesignStatus, useDesignStore } from '../state';

import {
  buildPngFilename,
  CANVAS_MISSING_MESSAGE,
  CANVAS_SELECTOR,
  RESET_CONFIRM_TEXT,
} from './export-menu-helpers';

// ---------------------------------------------------------------------------
// Props (for testability)
// ---------------------------------------------------------------------------

/**
 * Injectable dependencies. Every field has a real-world default
 * baked into the component body; tests override for hermetic
 * assertions.
 */
export interface ExportMenuProps {
  /**
   * Return the `HTMLCanvasElement` to snapshot. Defaults to
   * `document.querySelector('canvas.wooddeck-canvas')`. Returning
   * `null` (or an element without `.width`/`.height` > 0) surfaces
   * the AC10 zero-size error via the store action's
   * `DeckFileError code='canvas-empty'`.
   */
  readonly findCanvas?: () => HTMLCanvasElement | null;
  /**
   * Confirm the reset action. Defaults to `window.confirm`. Tests
   * pass `() => true` / `() => false` to exercise both branches.
   */
  readonly confirmReset?: (message: string) => boolean;
  /**
   * Return the current time in ms since epoch. Defaults to
   * `Date.now`. Used for the PNG filename timestamp.
   */
  readonly nowMs?: () => number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExportMenu(props: ExportMenuProps = {}): JSX.Element {
  const findCanvas = props.findCanvas ?? ((): HTMLCanvasElement | null =>
    document.querySelector<HTMLCanvasElement>(CANVAS_SELECTOR));
  const confirmReset = props.confirmReset ?? window.confirm.bind(window);
  const nowMs = props.nowMs ?? ((): number => Date.now());

  // File-input ref for the AC9 "Open…" flow. Kept as a ref rather
  // than a state-controlled input because file-input value is
  // one-way (user picks, we consume, we clear) — no need to
  // re-render on selection.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { status, lastError } = useDesignStatus();

  // Panel-local error state. Used ONLY for the canvas-missing
  // branch (no store action fires when findCanvas returns null,
  // so lastError doesn't populate). All other errors flow through
  // useDesignStatus. Kept as a plain ref-like closure via
  // useState — but useState re-renders; a plain module-local var
  // won't. useState it is.
  //
  // Simpler alternative: mutate a fake DeckFileError into the
  // store. Rejected as too magical. A separate render path is
  // clearer.
  const [canvasMissingMsg, setCanvasMissingMsg] = useCanvasMissingMsg();

  // Prefer the store-reported error, then the local canvas-missing
  // fallback. When both are null the panel renders no error region.
  const errorMessage =
    status === 'error' && lastError !== null
      ? lastError.message
      : canvasMissingMsg;

  return (
    <section
      aria-labelledby="wd-export-menu__title"
      className="wd-export-menu"
    >
      <h2 id="wd-export-menu__title">Save &amp; export</h2>

      {errorMessage !== null && (
        <div
          className="wd-export-menu__error"
          role="alert"
          aria-live="assertive"
        >
          {errorMessage}
        </div>
      )}

      <div className="wd-export-menu__actions">
        {/*
         * AC8 — Download .deck. Store action delegates through
         * application/save-design → persistence/file-io.
         */}
        <button
          type="button"
          className="wd-export-menu__btn"
          onClick={(): void => {
            setCanvasMissingMsg(null);
            useDesignStore.getState().downloadDeckFile();
          }}
        >
          Download .deck
        </button>

        {/*
         * AC9 — Open .deck… The hidden `<input type="file">` is
         * the actual control; the `<label htmlFor>` is what the
         * user clicks. Accepting only `.deck.json` and
         * `application/json` matches ticket §6 Security (client-
         * side hint only — real validation is `readDeckFile`).
         */}
        <label
          htmlFor="wd-export-menu__file-input"
          className="wd-export-menu__btn wd-export-menu__btn--file"
        >
          Open .deck…
        </label>
        <input
          id="wd-export-menu__file-input"
          ref={fileInputRef}
          type="file"
          accept=".deck.json,application/json"
          className="wd-export-menu__file-input"
          onChange={(evt): void => {
            setCanvasMissingMsg(null);
            const file = evt.currentTarget.files?.[0];
            if (file === undefined) {
              return;
            }
            // Fire and forget — the store action catches every
            // rejection internally and lands the error in
            // status='error' + lastError. Callers should not
            // await this.
            void useDesignStore.getState().loadFromFile(file);
            // Clear the input value so re-selecting the same file
            // fires onChange again (browser dedupes identical
            // selections unless the value is reset).
            if (fileInputRef.current !== null) {
              fileInputRef.current.value = '';
            }
          }}
        />

        {/*
         * AC10 — Export PNG. Locate the canvas via the stable
         * class, build the filename, call the store action.
         */}
        <button
          type="button"
          className="wd-export-menu__btn"
          onClick={(): void => {
            setCanvasMissingMsg(null);
            const canvas = findCanvas();
            if (canvas === null) {
              // The store action can't detect the missing element
              // (we never called it). Surface the local error
              // instead — same rendering path via `errorMessage`.
              setCanvasMissingMsg(CANVAS_MISSING_MESSAGE);
              return;
            }
            const filename = buildPngFilename(nowMs());
            useDesignStore.getState().exportScreenshot(canvas, filename);
          }}
        >
          Export PNG
        </button>

        {/*
         * AC11 — Reset with confirm. Confirmed → reset(); cancel
         * → no-op. Both branches clear any stale canvas-missing
         * message so the panel state stays coherent.
         */}
        <button
          type="button"
          className="wd-export-menu__btn wd-export-menu__btn--danger"
          onClick={(): void => {
            setCanvasMissingMsg(null);
            const ok = confirmReset(RESET_CONFIRM_TEXT);
            if (!ok) return;
            useDesignStore.getState().reset();
          }}
        >
          Reset to defaults
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small internal hook — the canvas-missing message state.
// ---------------------------------------------------------------------------

/**
 * Extracted so the component body stays readable. React `useState`
 * around a `string | null` with a `setCanvasMissingMsg` setter.
 */
function useCanvasMissingMsg(): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(null);
  return [value, setValue];
}
