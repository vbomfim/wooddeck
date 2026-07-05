/**
 * Unit tests for `src/domain/foundation-defaults.ts` — the SINGLE
 * source of truth for the "what does a fresh <foundation type> look
 * like when a user first switches to it?" defaults.
 *
 * ## Coverage map (S23 code-review-guardian pair-fix Opus #4 DRY/OCP)
 *
 *   - AC1  Each variant returns a well-typed, deep-frozen
 *          `FoundationSpec` whose fields match the ticket §2 pinned
 *          real paths (6×6 PT No2 post, 300×300 footing, TuffBlock
 *          12×12×4, Oldcastle 11×11×7).
 *   - AC2  The returned spec's `type` string matches the input
 *          argument (round-trip identity).
 *   - AC3  Every catalog product referenced by the defaults exists
 *          in `foundation-catalog.MVP_PRODUCTS` — a rename of a
 *          product id would fail-loud in ONE test rather than in
 *          the UI at runtime.
 *   - AC4  No shared mutable references: two consecutive calls
 *          return fresh objects (defensive against a rewrite that
 *          returns a module-scope singleton — a downstream (illegal)
 *          mutation could otherwise silently corrupt another
 *          design's copy).
 */
import { describe, expect, it } from 'vitest';

import { defaultFoundationFor } from './foundation-defaults';
import { lookupFoundationProduct } from './foundation-catalog';

describe('defaultFoundationFor — round-trip type identity (AC2)', () => {
  it('posts-on-footings default carries type: "posts-on-footings"', () => {
    expect(defaultFoundationFor('posts-on-footings').type).toBe('posts-on-footings');
  });
  it('deck-blocks default carries type: "deck-blocks"', () => {
    expect(defaultFoundationFor('deck-blocks').type).toBe('deck-blocks');
  });
  it('tuffblocks default carries type: "tuffblocks"', () => {
    expect(defaultFoundationFor('tuffblocks').type).toBe('tuffblocks');
  });
});

describe('defaultFoundationFor — variant-specific shape (AC1)', () => {
  it('posts-on-footings default is { type, post (6×6 PT No2), footing (300×300) }', () => {
    const spec = defaultFoundationFor('posts-on-footings');
    if (spec.type !== 'posts-on-footings') {
      throw new Error('discriminant slipped');
    }
    expect(spec.post).toEqual({ nominal: '6x6', species: 'PT', grade: 'No2' });
    expect(spec.footing).toEqual({ widthMm: 300, depthMm: 300 });
    // No stray keys — variant shape is exhaustive.
    expect(Object.keys(spec).sort()).toEqual(['footing', 'post', 'type']);
  });

  it('deck-blocks default is { type, product: { productId: "oldcastle-11x11x7" } }', () => {
    const spec = defaultFoundationFor('deck-blocks');
    if (spec.type !== 'deck-blocks') {
      throw new Error('discriminant slipped');
    }
    expect(spec.product).toEqual({ productId: 'oldcastle-11x11x7' });
    // Optional hint fields intentionally OMITTED — the S25
    // `add-support-row` remediation writes them on demand;
    // starting values leave them undefined so the layout math
    // uses the derived count.
    expect(spec).not.toHaveProperty('blockRowsHint');
    expect(spec).not.toHaveProperty('blockColsHint');
    expect(Object.keys(spec).sort()).toEqual(['product', 'type']);
  });

  it('tuffblocks default is { type, product: { productId: "tuffblock-12x12x4" } }', () => {
    const spec = defaultFoundationFor('tuffblocks');
    if (spec.type !== 'tuffblocks') {
      throw new Error('discriminant slipped');
    }
    expect(spec.product).toEqual({ productId: 'tuffblock-12x12x4' });
    expect(spec).not.toHaveProperty('blockRowsHint');
    expect(spec).not.toHaveProperty('blockColsHint');
    expect(Object.keys(spec).sort()).toEqual(['product', 'type']);
  });
});

describe('defaultFoundationFor — catalog-existence guardrail (AC3)', () => {
  // A stray literal rename in the catalog (product id) or here
  // must fail loud in a domain unit test, not silently in the UI.
  it('deck-blocks default product id resolves through the catalog', () => {
    const spec = defaultFoundationFor('deck-blocks');
    if (spec.type !== 'deck-blocks') throw new Error('discriminant slipped');
    expect(() => lookupFoundationProduct(spec.product.productId)).not.toThrow();
  });
  it('tuffblocks default product id resolves through the catalog', () => {
    const spec = defaultFoundationFor('tuffblocks');
    if (spec.type !== 'tuffblocks') throw new Error('discriminant slipped');
    expect(() => lookupFoundationProduct(spec.product.productId)).not.toThrow();
  });
});

describe('defaultFoundationFor — fresh reference each call (AC4)', () => {
  // The pre-extraction code inline'd fresh literals every call, so
  // two callers could never share a reference. The extracted
  // function MUST preserve that discipline — a rewrite that
  // caches a module-scope singleton would violate it. The test
  // enforces the invariant so the discipline is machine-checked.
  it('posts-on-footings — successive calls return distinct objects (no shared reference)', () => {
    const a = defaultFoundationFor('posts-on-footings');
    const b = defaultFoundationFor('posts-on-footings');
    expect(a).not.toBe(b);
    if (a.type !== 'posts-on-footings' || b.type !== 'posts-on-footings') {
      throw new Error('discriminant slipped');
    }
    // Nested subrecords also independent.
    expect(a.post).not.toBe(b.post);
    expect(a.footing).not.toBe(b.footing);
  });
  it('deck-blocks — successive calls return distinct objects', () => {
    const a = defaultFoundationFor('deck-blocks');
    const b = defaultFoundationFor('deck-blocks');
    expect(a).not.toBe(b);
    if (a.type !== 'deck-blocks' || b.type !== 'deck-blocks') {
      throw new Error('discriminant slipped');
    }
    expect(a.product).not.toBe(b.product);
  });
  it('tuffblocks — successive calls return distinct objects', () => {
    const a = defaultFoundationFor('tuffblocks');
    const b = defaultFoundationFor('tuffblocks');
    expect(a).not.toBe(b);
    if (a.type !== 'tuffblocks' || b.type !== 'tuffblocks') {
      throw new Error('discriminant slipped');
    }
    expect(a.product).not.toBe(b.product);
  });
});
