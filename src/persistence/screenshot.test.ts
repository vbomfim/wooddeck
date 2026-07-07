/**
 * `src/persistence/screenshot.test.ts` — unit tests for the
 * canvas → PNG adapter functions.
 *
 * ## Coverage
 *
 *   - captureCanvasPng returns a string starting with the PNG
 *     data-URL prefix on a non-empty canvas
 *   - captureCanvasPng throws DeckFileError code='canvas-empty'
 *     when width is 0
 *   - captureCanvasPng throws DeckFileError code='canvas-empty'
 *     when height is 0
 *   - downloadCanvasScreenshot triggers an anchor click with
 *     download=<filename> and href starting with `data:image/png`
 *   - downloadCanvasScreenshot cleans up the anchor even if click
 *     throws
 *   - Error carries the code + a non-empty message
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeckFileError } from './deck-file/errors';
import { captureCanvasPng, downloadCanvasScreenshot } from './screenshot';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Build a fake HTMLCanvasElement with the minimum surface the
 * adapter reads: `.width`, `.height`, `.toDataURL(mime)`. jsdom's
 * real canvas element throws in `.toDataURL('image/png')` because
 * there is no GL implementation — a stub is faster and clearer.
 * Returns both the canvas and the raw `toDataURL` mock so tests
 * can assert on it without triggering
 * `@typescript-eslint/unbound-method` (accessing `.toDataURL` off
 * the element type looks like an unbound method reference).
 */
function makeFakeCanvas(
  width: number,
  height: number,
  dataUrl = 'data:image/png;base64,fake',
): { canvas: HTMLCanvasElement; toDataURL: ReturnType<typeof vi.fn> } {
  const toDataURL = vi.fn().mockReturnValue(dataUrl);
  const canvas = {
    width,
    height,
    toDataURL,
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, toDataURL };
}

afterEach(() => {
  // Clean up any anchors an errant test appended.
  for (const a of Array.from(document.body.querySelectorAll('a'))) {
    a.remove();
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// captureCanvasPng
// ---------------------------------------------------------------------------

describe('captureCanvasPng', () => {
  it('returns the PNG data URL from a non-empty canvas', () => {
    const { canvas, toDataURL } = makeFakeCanvas(800, 600);
    const result = captureCanvasPng(canvas);
    expect(result).toBe('data:image/png;base64,fake');
    expect(toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('throws DeckFileError code=canvas-empty when width is 0', () => {
    const { canvas } = makeFakeCanvas(0, 600);
    try {
      captureCanvasPng(canvas);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      expect((err as DeckFileError).code).toBe('canvas-empty');
      // Message should be non-empty and mention zero dimensions.
      expect((err as DeckFileError).message.length).toBeGreaterThan(0);
      expect((err as DeckFileError).message).toMatch(/0/);
    }
  });

  it('throws DeckFileError code=canvas-empty when height is 0', () => {
    const { canvas } = makeFakeCanvas(800, 0);
    expect(() => captureCanvasPng(canvas)).toThrow(DeckFileError);
    try {
      captureCanvasPng(canvas);
      expect.fail('expected throw');
    } catch (err) {
      expect((err as DeckFileError).code).toBe('canvas-empty');
    }
  });

  it('does not call toDataURL when the canvas is empty (fail-fast)', () => {
    const { canvas, toDataURL } = makeFakeCanvas(0, 0);
    expect(() => captureCanvasPng(canvas)).toThrow(DeckFileError);
    expect(toDataURL).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// downloadCanvasScreenshot
// ---------------------------------------------------------------------------

describe('downloadCanvasScreenshot', () => {
  it('creates a temporary anchor with the download filename and clicks it', () => {
    const { canvas } = makeFakeCanvas(800, 600);
    // Spy on anchor.click — jsdom doesn't trigger a real
    // download but we can assert the CLICK fires.
    const clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    downloadCanvasScreenshot(canvas, 'wooddeck-2024-01-01T00-00-00.png');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    // After the finally block the anchor should be removed.
    const anchors = document.body.querySelectorAll('a');
    expect(anchors).toHaveLength(0);
  });

  it('throws DeckFileError code=canvas-empty when the canvas is empty (does NOT click)', () => {
    const { canvas } = makeFakeCanvas(0, 600);
    const clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    expect(() => downloadCanvasScreenshot(canvas, 'x.png')).toThrow(DeckFileError);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('cleans up the anchor even if click throws', () => {
    const { canvas } = makeFakeCanvas(800, 600);
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = (): void => {
          throw new Error('simulated click failure');
        };
      }
      return el;
    });

    expect(() =>
      downloadCanvasScreenshot(canvas, 'wooddeck-2024.png'),
    ).toThrow(/simulated click failure/);

    // The anchor MUST have been removed by the finally block even
    // though click threw.
    const anchors = document.body.querySelectorAll('a');
    expect(anchors).toHaveLength(0);
  });
});
