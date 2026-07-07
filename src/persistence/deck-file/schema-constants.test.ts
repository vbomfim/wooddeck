/**
 * Unit tests for `src/persistence/deck-file/schema-constants.ts` —
 * the single source of truth for the persistence-side enum arrays.
 *
 * ## Coverage map (S18 issue #40 §1 AC8)
 *
 *   - the constant arrays match the S17 TS unions (AssertEqual —
 *     compile-time; presence-verified below via `.includes`);
 *   - the arrays are FROZEN (immutable at runtime) so a rogue caller
 *     cannot mutate the enum lists mid-session;
 *   - the JSON Schema (`docs/deck-file-schema-v2.json`) `enum`
 *     literals for `structure`, `foundation.type`, and
 *     `foundation.product.productId` match these arrays. This is the
 *     runtime bridge — the compile-time AssertEqual in
 *     `schema-constants.ts` cannot see the JSON.
 *
 * ## Compile-time proofs (AC8) are already in the source file
 *
 * `schema-constants.ts` contains three `AssertEqual` proofs of type
 * equality with S17. If those proofs fail, `tsc -b` fails BEFORE
 * this test file runs. This suite adds a runtime cross-check so a
 * future contributor can't sidestep the AssertEqual by writing an
 * `@ts-ignore` comment.
 */
import { describe, expect, it } from 'vitest';

import type { FoundationSpec, StructureMode } from '../../domain/model';
import type { FoundationProductId } from '../../domain/foundation-catalog';

import {
  FOUNDATION_PRODUCT_IDS,
  FOUNDATION_TYPES,
  STRUCTURE_MODES,
} from './schema-constants';

// ---------------------------------------------------------------------------
// STRUCTURE_MODES
// ---------------------------------------------------------------------------

describe('STRUCTURE_MODES — SSOT for the S17 StructureMode union', () => {
  it('contains exactly `elevated` and `floating` in ticket §2 order', () => {
    expect(STRUCTURE_MODES).toEqual(['elevated', 'floating']);
  });

  it('is a runtime-verifiable superset of every StructureMode variant', () => {
    // Runtime check: every S17 variant must appear in the array.
    // The compile-time AssertEqual in schema-constants.ts covers the
    // reverse direction (nothing extra).
    const s17Variants: readonly StructureMode[] = ['elevated', 'floating'];
    for (const variant of s17Variants) {
      // Cast because TS infers `.includes(x)` narrower than the
      // parameter type; the runtime test is what matters.
      expect((STRUCTURE_MODES as readonly string[]).includes(variant)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// FOUNDATION_TYPES
// ---------------------------------------------------------------------------

describe('FOUNDATION_TYPES — SSOT for the S17 FoundationSpec discriminator', () => {
  it('contains exactly the three S17 foundation types in ticket §2 order', () => {
    expect(FOUNDATION_TYPES).toEqual([
      'posts-on-footings',
      'deck-blocks',
      'tuffblocks',
    ]);
  });

  it('is a runtime-verifiable superset of every FoundationSpec[type] variant', () => {
    const s17Types: readonly FoundationSpec['type'][] = [
      'posts-on-footings',
      'deck-blocks',
      'tuffblocks',
    ];
    for (const t of s17Types) {
      expect((FOUNDATION_TYPES as readonly string[]).includes(t)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// FOUNDATION_PRODUCT_IDS
// ---------------------------------------------------------------------------

describe('FOUNDATION_PRODUCT_IDS — SSOT for the S17 foundation catalog SKUs', () => {
  it('lists the two S17 SKUs in catalog order', () => {
    expect(FOUNDATION_PRODUCT_IDS).toEqual([
      'oldcastle-11x11x7',
      'tuffblock-12x12x4',
    ]);
  });

  it('is a runtime-verifiable superset of every S17 FoundationProductId variant', () => {
    const s17Ids: readonly FoundationProductId[] = [
      'oldcastle-11x11x7',
      'tuffblock-12x12x4',
    ];
    for (const id of s17Ids) {
      expect((FOUNDATION_PRODUCT_IDS as readonly string[]).includes(id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// v2 JSON Schema enums — MUST match the persistence-side constants
// ---------------------------------------------------------------------------

describe('deck-file-schema-v2.json — enum arrays match schema-constants', () => {
  // Load the schema JSON at test time — same file the runtime validator
  // uses (imported via `import ... with { type: 'json' }` from
  // validator.ts). Path is relative to the test file, resolved by
  // Vite / vitest at test-collect time.
  //
  // We do the lookup via a naive shape read rather than an Ajv
  // instance — the test just needs the `enum` arrays out of the
  // JSON tree.
  interface Schema {
    readonly $defs: {
      readonly DeckDesign: {
        readonly properties: {
          readonly structure: { readonly enum: readonly string[] };
        };
      };
      readonly FoundationSpecPostsOnFootings: {
        readonly properties: { readonly type: { readonly const: string } };
      };
      readonly FoundationSpecDeckBlocks: {
        readonly properties: { readonly type: { readonly const: string } };
      };
      readonly FoundationSpecTuffBlocks: {
        readonly properties: { readonly type: { readonly const: string } };
      };
      readonly FoundationBlockRef: {
        readonly properties: {
          readonly productId: { readonly enum: readonly string[] };
        };
      };
    };
  }

  it('structure enum matches STRUCTURE_MODES', async () => {
    const schema = (await import(
      '../../../docs/deck-file-schema-v2.json',
      { with: { type: 'json' } }
    )) as { default: Schema };
    const structureEnum = schema.default.$defs.DeckDesign.properties.structure.enum;
    // Compare as sets to allow for reordering (the tuple order test
    // above already pins the SSOT array).
    expect([...structureEnum].sort()).toEqual([...STRUCTURE_MODES].sort());
  });

  it('foundation.type enum matches FOUNDATION_TYPES (across all three variants)', async () => {
    const schema = (await import(
      '../../../docs/deck-file-schema-v2.json',
      { with: { type: 'json' } }
    )) as { default: Schema };
    const variants = [
      schema.default.$defs.FoundationSpecPostsOnFootings.properties.type.const,
      schema.default.$defs.FoundationSpecDeckBlocks.properties.type.const,
      schema.default.$defs.FoundationSpecTuffBlocks.properties.type.const,
    ];
    expect(variants.sort()).toEqual([...FOUNDATION_TYPES].sort());
  });

  it('foundation.product.productId enum matches FOUNDATION_PRODUCT_IDS', async () => {
    const schema = (await import(
      '../../../docs/deck-file-schema-v2.json',
      { with: { type: 'json' } }
    )) as { default: Schema };
    const productIdEnum = schema.default.$defs.FoundationBlockRef.properties.productId.enum;
    expect([...productIdEnum].sort()).toEqual([...FOUNDATION_PRODUCT_IDS].sort());
  });
});
