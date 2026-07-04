/**
 * `src/ui/ExportMenu.tsx` — S14 issue #15 AC8..AC11.
 *
 * ## Responsibility (single)
 *
 * Render four action controls that trigger the four
 * export/lifecycle actions:
 *
 *   1. **Download .deck** (AC8) — calls
 *      `useDesignStore.getState().downloadDeckFile()` which
 *      delegates through `application/save-design.ts` to the
 *      persistence-layer file adapter.
 *   2. **Open .deck…** (AC9) — a real `<button type="button">`
 *      that programmatically clicks a hidden `<input type="file">`.
 *      On selection, calls
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
 * ## Context-loss guard (S14 UAT pair-fix — FIX A)
 *
 * If the ui-store's `webglContextLost` flag is `true`, the canvas
 * may still exist with non-zero dimensions but the drawing buffer
 * is either blank or stale. `toDataURL()` would silently return a
 * broken PNG. The Export PNG button reads
 * `useWebglContextLost()` and:
 *
 *   - is `disabled` when lost,
 *   - carries an `aria-describedby` pointing at an inline
 *     "3D view is unavailable — reload before exporting" note,
 *   - short-circuits its onClick early (defense-in-depth in
 *     case a client zeros out `disabled` via CSS).
 *
 * ## Accessibility (§10)
 *
 *   - **Open .deck…** is a real `<button type="button">` (S14
 *     UAT pair-fix — FIX B). Previously it was a `<label
 *     htmlFor>` decorated as a button, but the visible label had
 *     no `tabIndex` and the real `<input type=file>` was clipped
 *     to 1px — the control was unreachable by keyboard. The
 *     button's `onClick` calls `fileInputRef.current?.click()`
 *     to open the file dialog; the hidden input keeps
 *     `tabIndex={-1}` so it's out of tab-order.
 *   - The error region uses `role="alert"` so screen readers
 *     announce it when a `DeckFileError` surfaces.
 *   - Buttons have visible focus (inherited from
 *     `tokens.css :focus-visible`).
 *
 * ## Boundary
 *
 *   - `../state` (useDesignStore + useDesignStatus + useWebglContextLost)
 *   - `react` (JSX + useRef + useState)
 *   - NO domain / application / persistence / scene direct imports.
 */
import { useRef, useState, type JSX } from 'react';

import { useDesignStatus, useDesignStore, useWebglContextLost } from '../state';

import {
  buildPngFilename,
  CANVAS_MISSING_MESSAGE,
  CANVAS_SELECTOR,
  RESET_CONFIRM_TEXT,
} from './export-menu-helpers';

// ---------------------------------------------------------------------------
// Copy constants
// ---------------------------------------------------------------------------

/**
 * Inline help text explaining why Export PNG is disabled. Exposed
 * as a named export so tests can grep-import the exact string.
 *
 * See FIX A in the module header — the ui-store `webglContextLost`
 * flag flips this on and off.
 */
export const PNG_UNAVAILABLE_MESSAGE =
  '3D view is unavailable — reload the page before exporting a PNG.';

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
  // FIX A — subscribe to the context-loss flag so a change (e.g.
  // a real GPU loss surfaces mid-session, or the driver hands
  // context back) re-renders the Export PNG button's disabled
  // state and inline note without a full-page reload.
  const webglContextLost = useWebglContextLost();

  // S14 UAT pair-fix — FIX J.2: inlined the previously-extracted
  // `useCanvasMissingMsg` wrapper hook (unnecessary indirection).
  //
  // Panel-local error state. Used ONLY for the canvas-missing
  // branch (no store action fires when findCanvas returns null,
  // so lastError doesn't populate). All other errors flow through
  // useDesignStatus. Kept in local state because a module-scope
  // variable wouldn't trigger a re-render.
  const [canvasMissingMsg, setCanvasMissingMsg] = useState<string | null>(null);

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
         * AC9 — Open .deck… S14 UAT pair-fix (FIX B): a real
         * <button> is the keyboard-reachable control. It
         * programmatically opens the hidden <input type="file">
         * via ref.click(). The prior <label htmlFor> pattern had
         * no tabIndex on the visible label and the real input
         * was clipped to 1px → the control was unreachable by
         * keyboard.
         */}
        <button
          type="button"
          className="wd-export-menu__btn"
          onClick={(): void => {
            setCanvasMissingMsg(null);
            fileInputRef.current?.click();
          }}
        >
          Open .deck…
        </button>
        <input
          id="wd-export-menu__file-input"
          ref={fileInputRef}
          type="file"
          accept=".deck.json,application/json"
          className="wd-export-menu__file-input"
          // Keep the input out of tab-order — the visible <button>
          // above is the keyboard-reachable control. `tabIndex=-1`
          // + the CSS clip make this input purely a programmatic
          // trigger surface.
          tabIndex={-1}
          // The input is invisible-except-to-code (visually
          // clipped + tab-order removed). Screen readers should
          // NOT announce it; the visible <button> above is the
          // accessible surface. Also gets aria-label to satisfy
          // axe's "label" rule (input without a wrapping/htmlFor
          // <label> would otherwise fire critical) — aria-hidden
          // means SRs skip it, but aria-label is still required
          // by axe as a fallback.
          aria-hidden="true"
          aria-label="Deck file input (hidden — use the Open .deck… button)"
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
         *
         * S14 UAT pair-fix — FIX A: when webglContextLost is
         * true, the drawing buffer is stale/blank; disable the
         * button, show an inline note via aria-describedby, and
         * short-circuit the onClick (defense-in-depth).
         */}
        <button
          type="button"
          className="wd-export-menu__btn"
          disabled={webglContextLost}
          aria-describedby={webglContextLost ? 'wd-export-menu__png-note' : undefined}
          onClick={(): void => {
            setCanvasMissingMsg(null);
            // Defensive short-circuit: even if a stylesheet or
            // extension unsets `disabled`, we still refuse to
            // snapshot a lost context.
            if (webglContextLost) return;
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
        {webglContextLost && (
          <p
            id="wd-export-menu__png-note"
            className="wd-export-menu__png-note"
          >
            {PNG_UNAVAILABLE_MESSAGE}
          </p>
        )}

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
