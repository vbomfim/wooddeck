/**
 * Unit tests for `src/domain/foundation-catalog.ts` — the static
 * SKU → block-product record lookup for MVP wooddeck (Epic 2 / S17).
 *
 * TDD RED phase: this file is written BEFORE any implementation
 * exists, per Developer Guardian discipline. It exercises the
 * acceptance criteria from GitHub issue #39 that are OWNED by the
 * foundation catalog:
 *
 *   - AC3  Exactly two products, matching real Home Depot dimensions
 *          (Oldcastle 11″×11″×7″; TuffBlock 12″×12″×4″).
 *   - AC4  Unknown-id lookup throws (`Error` naming the offending id
 *          AND naming the module — fail-loud, matches the
 *          `lookupMaterial` failure pattern).
 *   - AC7  Immutability — every returned record is deeply frozen,
 *          `Object.assign` on a record fails in strict mode.
 *
 * The `FoundationProduct` shape is exercised by fixture literals (the
 * TS interface makes the shape a compile-time contract; the fixture
 * lookup here doubles as runtime evidence the interface is stable).
 *
 * NOTE on dimensions: The AC3 assertions compute the expected mm
 * value using `Math.round(inches * MM_PER_INCH)` — the SAME
 * expression `materials-catalog.ts` uses. This defends against a
 * future edit that hard-codes `25.4` here (banned outside
 * `units.ts` per the S2 checklist).
 */
import { describe, expect, it } from 'vitest';

import {
  listFoundationProducts,
  lookupFoundationProduct,
  type FoundationProduct,
  type FoundationProductId,
} from './foundation-catalog';
import { MM_PER_INCH } from './units';

function inToMm(inches: number): number {
  return Math.round(inches * MM_PER_INCH);
}

// ---------------------------------------------------------------------------
// AC3 — Exactly two products with the correct real dimensions
// ---------------------------------------------------------------------------
describe('foundation-catalog — AC3 exactly two products', () => {
  it('listFoundationProducts returns exactly two records', () => {
    const products = listFoundationProducts();
    expect(products).toHaveLength(2);
  });

  it('the two productIds are oldcastle-11x11x7 and tuffblock-12x12x4', () => {
    const ids = listFoundationProducts().map((p) => p.productId);
    expect(new Set(ids)).toEqual(
      new Set<FoundationProductId>(['oldcastle-11x11x7', 'tuffblock-12x12x4']),
    );
  });

  it('Oldcastle 11×11×7 → 279 × 279 × 178 mm (11″ × 11″ × 7″, whole-mm-rounded)', () => {
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    expect(product.actual.widthMm).toBe(inToMm(11));
    expect(product.actual.depthMm).toBe(inToMm(11));
    expect(product.actual.heightMm).toBe(inToMm(7));
    // Guard the actual computed values against a future MM_PER_INCH
    // constant edit (unlikely, but the failure would be silent
    // without the literal): 11 × 25.4 = 279.4 → 279; 7 × 25.4 = 177.8 → 178.
    expect(product.actual.widthMm).toBe(279);
    expect(product.actual.depthMm).toBe(279);
    expect(product.actual.heightMm).toBe(178);
  });

  it('TuffBlock 12×12×4 → 305 × 305 × 102 mm (12″ × 12″ × 4″, whole-mm-rounded)', () => {
    const product = lookupFoundationProduct('tuffblock-12x12x4');
    expect(product.actual.widthMm).toBe(inToMm(12));
    expect(product.actual.depthMm).toBe(inToMm(12));
    expect(product.actual.heightMm).toBe(inToMm(4));
    // Guard the actual computed values: 12 × 25.4 = 304.8 → 305;
    // 4 × 25.4 = 101.6 → 102.
    expect(product.actual.widthMm).toBe(305);
    expect(product.actual.depthMm).toBe(305);
    expect(product.actual.heightMm).toBe(102);
  });

  it('Oldcastle record — category, placement, acceptsLumber, acceptsPost, referenceUrl', () => {
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    expect(product.category).toBe('concrete-precast');
    expect(product.placement).toBe('on-grade');
    // The Oldcastle block has slots for 2× framing (2x6, 2x8, 2x10)
    // plus a center pocket for a 4x4 post.
    expect(product.acceptsLumber).toEqual(expect.arrayContaining(['2x6', '2x8', '2x10']));
    expect(product.acceptsPost).not.toBeNull();
    expect(product.acceptsPost).toEqual(expect.arrayContaining(['4x4']));
    // Reference URL is a hardcoded catalog literal (Home Depot product
    // page for provenance). Not user input — no injection surface.
    expect(product.referenceUrl).toMatch(/^https:\/\//);
    expect(product.referenceUrl).toContain('homedepot');
  });

  it('TuffBlock record — category, placement, acceptsLumber, acceptsPost:null, referenceUrl', () => {
    const product = lookupFoundationProduct('tuffblock-12x12x4');
    // TuffBlock is a polypropylene product (not concrete).
    expect(product.category).toBe('polypropylene');
    expect(product.placement).toBe('on-grade');
    // TuffBlock accepts 2× framing directly on its slotted top.
    expect(product.acceptsLumber).toEqual(expect.arrayContaining(['2x6', '2x8']));
    // TuffBlock has NO center post pocket — it's a floating-deck
    // product designed to sit BENEATH framing, not around a post.
    expect(product.acceptsPost).toBeNull();
    expect(product.referenceUrl).toMatch(/^https:\/\//);
    expect(product.referenceUrl).toContain('homedepot');
  });

  it('displayName is a human-readable string containing the product family', () => {
    const oldcastle = lookupFoundationProduct('oldcastle-11x11x7');
    const tuffblock = lookupFoundationProduct('tuffblock-12x12x4');
    expect(oldcastle.displayName.length).toBeGreaterThan(0);
    expect(oldcastle.displayName.toLowerCase()).toContain('oldcastle');
    expect(tuffblock.displayName.length).toBeGreaterThan(0);
    expect(tuffblock.displayName.toLowerCase()).toContain('tuffblock');
  });

  it('listFoundationProducts returns product records that satisfy the FoundationProduct interface', () => {
    // Compile-time contract check via a typed local — if the interface
    // shape drifts, this local assignment fails at build time.
    const products: readonly FoundationProduct[] = listFoundationProducts();
    for (const product of products) {
      expect(product.productId).toBeTypeOf('string');
      expect(product.displayName).toBeTypeOf('string');
      expect(product.category).toBeTypeOf('string');
      expect(product.actual.widthMm).toBeTypeOf('number');
      expect(product.actual.depthMm).toBeTypeOf('number');
      expect(product.actual.heightMm).toBeTypeOf('number');
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 — unknown-id lookup throws a helpful error naming the module
// ---------------------------------------------------------------------------
describe('foundation-catalog — AC4 unknown id throws', () => {
  it('throws Error naming the offending id AND the module', () => {
    // Forced cast to bypass the compile-time union check — this is
    // the only way to simulate a hand-edited .deck file or a
    // downstream story bug that passes an unknown id through.
    const badId = 'not-a-real-block' as FoundationProductId;
    expect(() => lookupFoundationProduct(badId)).toThrow(/not-a-real-block/);
    expect(() => lookupFoundationProduct(badId)).toThrow(/foundation-catalog/);
  });

  it('empty-string id throws with the same shape', () => {
    const badId = '' as FoundationProductId;
    // The empty-string case is worth pinning explicitly because
    // `!hit` would also fire for a legitimate `.get('')` miss.
    expect(() => lookupFoundationProduct(badId)).toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// AC7 — Immutability (deep freeze)
// ---------------------------------------------------------------------------
describe('foundation-catalog — AC7 immutability', () => {
  it('every returned product record is Object.isFrozen', () => {
    for (const product of listFoundationProducts()) {
      expect(Object.isFrozen(product)).toBe(true);
      // Frozen at every nested level (actual dims, acceptsLumber array).
      expect(Object.isFrozen(product.actual)).toBe(true);
      expect(Object.isFrozen(product.acceptsLumber)).toBe(true);
      // acceptsPost is either a frozen array OR null.
      if (product.acceptsPost !== null) {
        expect(Object.isFrozen(product.acceptsPost)).toBe(true);
      }
    }
  });

  it('the top-level catalog array is Object.isFrozen', () => {
    expect(Object.isFrozen(listFoundationProducts())).toBe(true);
  });

  it('mutating a returned record throws in strict mode', () => {
    // Vitest test files execute in ES modules → strict mode by default.
    // Attempting to assign a frozen field throws TypeError in strict mode
    // (would silently no-op in sloppy mode).
    const product = lookupFoundationProduct('oldcastle-11x11x7') as {
      displayName: string;
    };
    expect(() => {
      product.displayName = 'HACKED';
    }).toThrow(TypeError);
  });

  it('mutating a returned actual-dimensions record throws in strict mode', () => {
    const product = lookupFoundationProduct('oldcastle-11x11x7');
    const actual = product.actual as { widthMm: number };
    expect(() => {
      actual.widthMm = 999;
    }).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Consistency — lookup and list agree on identity
// ---------------------------------------------------------------------------
describe('foundation-catalog — list and lookup are consistent', () => {
  it('every product in listFoundationProducts is retrievable by lookup', () => {
    for (const product of listFoundationProducts()) {
      const looked = lookupFoundationProduct(product.productId);
      // Same referential identity — the catalog is single-source.
      expect(looked).toBe(product);
    }
  });
});
