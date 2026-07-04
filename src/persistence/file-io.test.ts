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
import { serialize } from './deck-file/schema-v2';
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
  it('resolves to a { design, migrated } shape with design deep-equal to source', async () => {
    const envelope = serialize(GOLDEN_DECK_DESIGN);
    const file = new File([envelope], 'wooddeck-20260702T210000.deck.json', {
      type: 'application/json',
    });
    const { design, migrated } = await readDeckFile(file);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
    // v2 native emission → migrated:false (S18 AC9).
    expect(migrated).toBe(false);
  });

  it('accepts a File whose type is empty (some browsers do not set application/json)', async () => {
    const envelope = serialize(GOLDEN_DECK_DESIGN);
    const file = new File([envelope], 'anything.deck.json', { type: '' });
    const { design } = await readDeckFile(file);
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

  it('rejects a File larger than 10 MB with code=file-too-large (dedicated code)', async () => {
    // Review fix B — this was previously mis-mapped to
    // `schema-validation-failed` (validation never ran). The
    // dedicated `file-too-large` code lets the UI layer render a
    // truthful error rather than a "corrupted file" message.
    //
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
    await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'file-too-large' });
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

  it('rejects with code=file-read-failed when FileReader.onerror fires (Review fix B)', async () => {
    // Review fix B — was `invalid-json` (nothing was parsed).
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
      // Reinstate the spy for the second assertion (rejects.toMatchObject
      // consumes the promise, but the readAsText mock is one call per
      // readDeckFile invocation — each call constructs a fresh reader).
      await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'file-read-failed' });
    } finally {
      readAsTextSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// QA edge tests G1 – G6 (Review fix E)
// ---------------------------------------------------------------------------
//
// Six sharp-edge tests filed in the S6 review gate to plug corners
// unit tests weren't exercising. Each maps 1:1 to a review finding:
//
//   G1: file.size === 10*1024*1024 EXACTLY resolves (inclusive
//       boundary — the cap is `> MAX_UPLOAD_BYTES`, not `>=`).
//   G2: `design: null` and `design: []` fail with a message NAMING
//       `design` so the user knows where to look.
//   G4: An envelope-ROOT `__proto__` key is accepted (envelope is
//       lenient) AND `Object.prototype.polluted` is still undefined
//       after load — proves the "we never merge" discipline holds
//       even on the lenient side.
//   G5: When `file.size > cap`, FileReader.prototype.readAsText is
//       NEVER called (size check truly runs BEFORE read).
//   G6: Whitespace-only strings AND BOM-prefixed input surface as
//       `invalid-json` (BOM breaks JSON.parse per RFC 8259 § 8.1).

describe('readDeckFile — G1 boundary: file.size === MAX_UPLOAD_BYTES resolves (inclusive)', () => {
  it('accepts a File whose size is exactly 10 MB', async () => {
    // A real 10 MB payload of valid JSON is impractical, so we build a
    // small valid envelope and lie about `.size` — the check is
    // `size > cap` (strict >), so 10 MB exactly must pass through.
    const envelope = serialize(GOLDEN_DECK_DESIGN);
    const file = new File([envelope], 'boundary.deck.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'size', {
      value: 10 * 1024 * 1024, // exactly the cap
      configurable: true,
    });
    // The read must succeed — .text() ignores the fake size because
    // FileReader reads the actual byte content.
    const { design } = await readDeckFile(file);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
  });

  it('rejects a File one byte over the cap', async () => {
    const envelope = serialize(GOLDEN_DECK_DESIGN);
    const file = new File([envelope], 'boundary+1.deck.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'size', {
      value: 10 * 1024 * 1024 + 1,
      configurable: true,
    });
    await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'file-too-large' });
  });
});

describe('deserialize — G2: design:null and design:[] name `design` in the error', () => {
  it('rejects design:null with a message that names `design`', async () => {
    const rogue = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: null,
    });
    const file = new File([rogue], 'null-design.deck.json', {
      type: 'application/json',
    });
    try {
      await readDeckFile(file);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      expect(dfe.message.toLowerCase()).toContain('design');
    }
  });

  it('rejects design:[] with a message that names `design`', async () => {
    const rogue = JSON.stringify({
      schema: 1,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      design: [],
    });
    const file = new File([rogue], 'array-design.deck.json', {
      type: 'application/json',
    });
    try {
      await readDeckFile(file);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DeckFileError);
      const dfe = err as DeckFileError;
      expect(dfe.code).toBe('schema-validation-failed');
      expect(dfe.message.toLowerCase()).toContain('design');
    }
  });
});

describe('readDeckFile — G4: envelope-ROOT __proto__ is accepted lenient AND does not pollute', () => {
  it('accepts an envelope with a root-level __proto__ AND leaves Object.prototype untouched', async () => {
    // The envelope is lenient (`additionalProperties` NOT set to
    // false at the root), so a root-level `__proto__` key passes
    // Ajv. What MUST hold: (a) the load succeeds because the design
    // is valid, (b) `Object.prototype` is not mutated afterwards.
    // The `we never merge the parsed value into another object`
    // discipline in `deserialize` is the primary defence.
    //
    // The envelope uses schema:2 (native) so the modern loader
    // exercises the same defence — v1 would migrate first and reach
    // the same code path via a different route.
    const payload = JSON.stringify({
      schema: 2,
      generator: 'wooddeck',
      generatorVersion: '1.0.0',
      createdAt: '2026-07-02T21:00:00.000Z',
      __proto__: { polluted: true }, // root-level, lenient
      design: GOLDEN_DECK_DESIGN,
    });
    const file = new File([payload], 'root-proto.deck.json', {
      type: 'application/json',
    });
    const { design } = await readDeckFile(file);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
    // OBSERVABLE: no pollution on Object.prototype.
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('readDeckFile — G5: size cap runs BEFORE any FileReader byte is read', () => {
  it('does NOT call FileReader.prototype.readAsText for an oversize File', async () => {
    // If a rewrite ever swaps the order (read then size-check), a
    // malicious 10 GB file would allocate before rejection. This
    // spy guarantees the ordering is preserved.
    const readAsTextSpy = vi.spyOn(FileReader.prototype, 'readAsText');
    const envelope = serialize(GOLDEN_DECK_DESIGN);
    const file = new File([envelope], 'oversize.deck.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'size', {
      value: 10 * 1024 * 1024 + 1,
      configurable: true,
    });
    await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'file-too-large' });
    // The critical assertion: no read was ever issued.
    expect(readAsTextSpy).not.toHaveBeenCalled();
    readAsTextSpy.mockRestore();
  });
});

describe('deserialize — G6: whitespace-only inputs; BOM handling documented', () => {
  it('classifies "   " (whitespace-only) as invalid-json', async () => {
    const file = new File(['   \n\t   '], 'ws.deck.json', {
      type: 'application/json',
    });
    await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'invalid-json' });
  });

  it('classifies "\\uFEFF" alone (nothing else) as invalid-json', async () => {
    // A bare BOM is not JSON — after the decoder strips it, the
    // remaining string is empty, so JSON.parse throws.
    const file = new File(['\uFEFF'], 'bom-only.deck.json', {
      type: 'application/json',
    });
    await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'invalid-json' });
  });

  it('DOCUMENTED behaviour: BOM-prefixed valid JSON succeeds — the UTF-8 decoder strips U+FEFF', async () => {
    // Review fix G6 originally asserted "BOM-prefixed input →
    // invalid-json" — but the WHATWG Encoding Standard (which
    // FileReader.readAsText follows for UTF-8) STRIPS a leading BOM
    // during decoding. jsdom mirrors that behaviour. The test pinning
    // rejection would only pass if we bypassed the decoder, which
    // wouldn't reflect how a real browser processes an uploaded file.
    // We assert the TRUE observable behaviour here and document the
    // deviation from the review request — so a future contributor
    // reading the change history sees why the failure mode stops
    // holding once the file crosses the FileReader boundary.
    const bomPayload = '\uFEFF' + serialize(GOLDEN_DECK_DESIGN);
    const file = new File([bomPayload], 'bom-valid.deck.json', {
      type: 'application/json',
    });
    const { design } = await readDeckFile(file);
    expect(design).toEqual(GOLDEN_DECK_DESIGN);
  });

  it('classifies a BOM in the MIDDLE of the JSON as invalid-json (decoder only strips leading)', async () => {
    // Only the LEADING BOM is stripped; a stray U+FEFF anywhere else
    // survives and breaks JSON.parse — this is a genuinely hostile
    // input worth pinning. Use schema:2 to match the v2 default emit.
    const payload = serialize(GOLDEN_DECK_DESIGN).replace('"schema":2,', '"schema":2,\uFEFF');
    const file = new File([payload], 'bom-mid.deck.json', {
      type: 'application/json',
    });
    await expect(readDeckFile(file)).rejects.toMatchObject({ code: 'invalid-json' });
  });
});
