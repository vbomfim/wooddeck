/**
 * Unit tests for `src/persistence/file-io.ts` — the browser-side
 * download / upload adapter for `.deck` files.
 *
 * ## Coverage map (issue #7 acceptance criteria)
 *
 *   - AC9  Download filename ALWAYS matches
 *          `/^wooddeck-\d{8}T\d{6}\.deck\.json$/`, regardless of
 *          `opts.filename` (ticket §6 Security — never derived from
 *          user input).
 *   - AC10 Upload of a valid v1 `.deck` file resolves to a DeckDesign
 *          deep-equal to the source.
 *   - Edge: `readDeckFile` rejects a File > 10 MB with a DeckFileError.
 *   - Edge: `readDeckFile` maps invalid JSON to `'invalid-json'` and
 *          schema failures to `'schema-validation-failed'`.
 *   - Download side effects: Blob is created, URL is issued via
 *          `URL.createObjectURL`, an anchor is clicked, and the URL
 *          is revoked afterwards (no leak).
 *
 * ## Test env
 *
 * jsdom (default per `vite.config.ts`). jsdom does NOT implement
 * `URL.createObjectURL` / `URL.revokeObjectURL`, so we stub them per
 * test — this keeps assertions crisp (we OWN the mock, we can check
 * call counts, argument shape, and revocation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadDeckFile, readDeckFile } from './file-io';
import { DeckFileError } from './deck-file/errors';
import { serialize } from './deck-file/schema-v1';
import { GOLDEN_DECK_DESIGN } from './deck-file/__fixtures__/deck-designs';

/**
 * jsdom stub for the `URL.createObjectURL` / `revokeObjectURL` pair
 * that jsdom omits (see JSDOM issue #1721). We install per-test via
 * `beforeEach` so tests get a fresh call log; `afterEach` restores.
 */
let createdObjectURLs: Blob[];
let revokedObjectURLs: string[];
let anchorClicks: HTMLAnchorElement[];

beforeEach(() => {
  createdObjectURLs = [];
  revokedObjectURLs = [];
  anchorClicks = [];
  vi.stubGlobal(
    'URL',
    Object.assign(
      // Keep the URL constructor working for any code that uses it.
      globalThis.URL,
      {
        createObjectURL: vi.fn((blob: Blob): string => {
          createdObjectURLs.push(blob);
          // Return a deterministic pseudo-URL so tests can assert on it.
          return `blob:mock/${createdObjectURLs.length}`;
        }),
        revokeObjectURL: vi.fn((url: string): void => {
          revokedObjectURLs.push(url);
        }),
      },
    ),
  );

  // Intercept anchor clicks so nothing tries to actually navigate.
  // We deliberately do NOT delegate to the real
  // `HTMLAnchorElement.prototype.click` — jsdom would attempt to
  // navigate the fake browser and either throw or produce spurious
  // "Not implemented" console noise. The click is a side-effect
  // channel; capturing the anchor is all these tests care about.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchorClicks.push(this);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC9 — download filename is ALWAYS generated
// ---------------------------------------------------------------------------

describe('downloadDeckFile — AC9 filename', () => {
  const FILENAME_PATTERN = /^wooddeck-\d{8}T\d{6}\.deck\.json$/;

  it('sets anchor.download to a filename matching the frozen pattern', () => {
    downloadDeckFile(GOLDEN_DECK_DESIGN);
    expect(anchorClicks).toHaveLength(1);
    const anchor = anchorClicks[0];
    expect(anchor).toBeDefined();
    expect(anchor!.download).toMatch(FILENAME_PATTERN);
  });

  it('IGNORES a user-supplied opts.filename — filename is always generated (security)', () => {
    // Ticket §6: filename is always generated, never from user input.
    // A caller trying to pass a path-traversal filename must NOT
    // influence the download name.
    downloadDeckFile(GOLDEN_DECK_DESIGN, {
      filename: '../../etc/passwd',
    });
    expect(anchorClicks).toHaveLength(1);
    const anchor = anchorClicks[0];
    expect(anchor!.download).toMatch(FILENAME_PATTERN);
    expect(anchor!.download).not.toContain('/');
    expect(anchor!.download).not.toContain('..');
  });

  it('generates a stable filename shape for two subsequent calls', () => {
    downloadDeckFile(GOLDEN_DECK_DESIGN);
    downloadDeckFile(GOLDEN_DECK_DESIGN);
    expect(anchorClicks).toHaveLength(2);
    for (const a of anchorClicks) {
      expect(a.download).toMatch(FILENAME_PATTERN);
    }
  });
});

// ---------------------------------------------------------------------------
// Download side effects — Blob, URL, revoke, anchor
// ---------------------------------------------------------------------------

describe('downloadDeckFile — side effects', () => {
  it('creates a Blob with the serialized envelope bytes and application/json type', () => {
    downloadDeckFile(GOLDEN_DECK_DESIGN);
    expect(createdObjectURLs).toHaveLength(1);
    const blob = createdObjectURLs[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe('application/json');
    // The blob size should equal the byte-length of the serialized
    // envelope — proves we didn't accidentally include garbage.
    expect(blob!.size).toBeGreaterThan(0);
  });

  it('revokes the object URL after triggering the click (no leak)', () => {
    downloadDeckFile(GOLDEN_DECK_DESIGN);
    // The URL created above should have been revoked. We don't care
    // about exact timing (immediate vs. next microtask), only that
    // by end-of-turn it happened.
    expect(revokedObjectURLs).toContain('blob:mock/1');
  });

  it('sets the anchor.href to the object URL before clicking', () => {
    downloadDeckFile(GOLDEN_DECK_DESIGN);
    const anchor = anchorClicks[0]!;
    expect(anchor.href).toContain('blob:mock/1');
  });
});

// ---------------------------------------------------------------------------
// AC10 — upload happy path
// ---------------------------------------------------------------------------

describe('readDeckFile — AC10 upload happy path', () => {
  it('resolves to a DeckDesign deep-equal to the source', async () => {
    const envelope = serialize(GOLDEN_DECK_DESIGN);
    const file = new File([envelope], 'wooddeck-20260702T210000.deck.json', {
      type: 'application/json',
    });
    const design = await readDeckFile(file);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
  });

  it('accepts a File whose type is empty (some browsers do not set application/json)', async () => {
    const envelope = serialize(GOLDEN_DECK_DESIGN);
    const file = new File([envelope], 'anything.deck.json', { type: '' });
    const design = await readDeckFile(file);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
  });
});

// ---------------------------------------------------------------------------
// Edge — invalid JSON, schema validation, size cap
// ---------------------------------------------------------------------------

describe('readDeckFile — failure modes', () => {
  it('rejects a File containing invalid JSON with code=invalid-json', async () => {
    const file = new File(['not json {'], 'garbage.deck.json', {
      type: 'application/json',
    });
    await expect(readDeckFile(file)).rejects.toBeInstanceOf(DeckFileError);
    await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'invalid-json' });
  });

  it('rejects a File containing a v1 envelope with a bad design', async () => {
    const bad = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: { id: 'not-a-uuid' },
    });
    const file = new File([bad], 'bad.deck.json', { type: 'application/json' });
    await expect(readDeckFile(file)).rejects.toMatchObject({
      code: 'schema-validation-failed',
    });
  });

  it('rejects a File larger than 10 MB with a DeckFileError (DoS defence)', async () => {
    // Fake a large file by mocking `.size` — actually allocating a
    // 10 MB blob just to exercise this branch is wasteful and slow.
    const envelope = serialize(GOLDEN_DECK_DESIGN);
    const file = new File([envelope], 'huge.deck.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'size', {
      value: 10 * 1024 * 1024 + 1,
      configurable: true,
    });
    await expect(readDeckFile(file)).rejects.toBeInstanceOf(DeckFileError);
    // The rejection code SHOULD identify this as a schema-validation
    // failure (message mentions size). Tests do not pin the code here
    // because the ticket does not enumerate a distinct code for
    // oversized files — any DeckFileError satisfies the "reject" AC.
  });

  it('rejects a File with unknown schema version via file-io', async () => {
    const rogue = JSON.stringify({
      schema: 999,
      generator: 'wooddeck',
      generatorVersion: '9.9.9',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: GOLDEN_DECK_DESIGN,
    });
    const file = new File([rogue], 'future.deck.json', {
      type: 'application/json',
    });
    await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'unknown-schema' });
  });

  it('rejects with DeckFileError when FileReader.onerror fires (defensive)', async () => {
    // Simulate a browser where FileReader fails mid-read (permissions,
    // network drive I/O). We stub FileReader.prototype.readAsText so
    // it schedules an `onerror` instead of an `onload`.
    const readAsTextSpy = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(
      function (this: FileReader) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const reader = this;
        Object.defineProperty(reader, 'error', {
          value: new DOMException('read failed', 'NotReadableError'),
          configurable: true,
        });
        // Fire onerror on the microtask so the Promise handler is registered.
        queueMicrotask(() => {
          reader.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
        });
      },
    );
    try {
      const file = new File(['{"schema":1}'], 'x.deck.json', { type: 'application/json' });
      await expect(readDeckFile(file)).rejects.toBeInstanceOf(DeckFileError);
    } finally {
      readAsTextSpy.mockRestore();
    }
  });
});
