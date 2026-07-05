/**
 * Unit tests for `src/domain/model.ts` — the canonical domain entities.
 *
 * TDD RED phase: this file is written BEFORE any implementation exists,
 * per Developer Guardian discipline. It exercises the acceptance criteria
 * from GitHub issue #4 that are OWNED by `model.ts` (as opposed to the
 * catalog):
 *
 *   - AC4  DeckDesign JSON round-trip byte-for-byte identical.
 *          One golden fixture PLUS a `fast-check` property test over a
 *          small `DeckDesign` generator.
 *   - AC5  Strict-mode compile discipline is enforced by tsconfig +
 *          eslint, so it is not exercised by a runtime test here. What
 *          IS exercisable at runtime is the anemic-data invariant:
 *          fixtures contain zero function-valued properties.
 *
 * The MaterialRef / MemberKind / LayoutMember / Layout / Warning types
 * are defined in `model.ts` on purpose (per ticket §2) so downstream
 * scene / span-check code can import the type without depending on the
 * S4 engine. Every one of them is exercised by at least one fixture in
 * this file so a rename or shape change would fail the test.
 *
 * All assertions cite the AC / edge case they cover so a future reader
 * can trace a red test back to the requirement it defends.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { UUID_V4_PATTERN } from './id';
import type {
  DeckDesign,
  FoundationSpec,
  Layout,
  LayoutMember,
  LumberMemberMaterial,
  MemberKind,
  MemberMaterialRef,
  StructureMode,
  Warning,
} from './model';
import { deckDesignArb } from './__testing__/deck-design-arb';

// ---------------------------------------------------------------------------
// Golden fixture — hand-crafted DeckDesign used by the AC4 byte-for-byte
// round-trip check and reused by many shape-level assertions below. Kept
// as a `const` so any accidental mutation in a test would fail-fast.
// ---------------------------------------------------------------------------

const GOLDEN_DECK_DESIGN: DeckDesign = {
  id: '018f4e7a-c1c5-4a3f-8f52-3a0f6c9d1e4b',
  createdAt: '2026-07-02T21:00:00.000Z',
  footprint: { widthMm: 3658, lengthMm: 4877, heightMm: 914 },
  // S17 addition — the elevated + posts-on-footings default.
  structure: 'elevated',
  floatingFraming: 'beams-and-joists',
  foundation: {
    type: 'posts-on-footings',
    post: { nominal: '6x6', species: 'PT', grade: 'No2' },
    footing: { widthMm: 300, depthMm: 300 },
  },
  joist: {
    material: { nominal: '2x8', species: 'PT', grade: 'No2' },
    spacingMm: 406,
  },
  beam: {
    material: { nominal: '2x10', species: 'PT', grade: 'No2' },
  },
  decking: {
    material: { nominal: '5/4x6', species: 'Composite', grade: 'NA' },
    orientation: 'parallel-to-width',
  },
  layout: { bayRemainderStrategy: 'extra-bay-at-end' },
};

// ---------------------------------------------------------------------------
// AC4 — JSON round-trip must be byte-for-byte identical.
//
// SCOPE OF THIS TEST — read before extending:
//
//   The `stringify → parse → stringify` idempotence check below is
//   NOT a proof of universal canonical serialization. `JSON.stringify`
//   emits properties in INSERTION ORDER, and V8 / JSC preserve
//   insertion order across `JSON.parse` — so the second round-trip
//   is guaranteed to match the first for any object with the same
//   construction order. What this test really pins is:
//
//     (a) `DeckDesign` construction order is CANONICAL (matches the
//         order declared in `model.ts`),
//     (b) no field carries a non-serializable value (function,
//         `undefined`, `symbol`) or a `toJSON` shim that would drop
//         it on the way through JSON,
//     (c) the parsed value is DEEP-EQUAL to the source (defends
//         against silent field drops that would still round-trip to
//         "{}" idempotently on both sides).
//
//   TRUE byte-for-byte canonical serialization — sorting keys,
//   normalizing number formats, unicode-NFC-normalizing strings — is
//   the responsibility of S6's `.deck` serializer. This test only
//   guarantees stable round-trip for canonically-constructed designs;
//   S6 must layer a canonicalizer on top for arbitrary sources.
// ---------------------------------------------------------------------------
describe('model — AC4 DeckDesign JSON round-trip (golden fixture)', () => {
  it('golden fixture id is a valid RFC 4122 v4 UUID', () => {
    // Guards against a fixture drift where the id gets edited to a
    // v7-shaped or otherwise-non-v4 value and the test file silently
    // starts documenting the wrong contract for `DeckDesign.id`.
    expect(GOLDEN_DECK_DESIGN.id).toMatch(UUID_V4_PATTERN);
  });

  it('stringify → parse → stringify is byte-for-byte identical', () => {
    const first = JSON.stringify(GOLDEN_DECK_DESIGN);
    const parsed = JSON.parse(first) as unknown;
    // Deep-equal check: catches silent field drops (e.g. a `toJSON`
    // shim that strips one branch of the tree). Without this, the
    // second-round-trip idempotence below is a language invariant,
    // not a data-preservation guarantee.
    expect(parsed).toEqual(GOLDEN_DECK_DESIGN);
    const second = JSON.stringify(parsed);
    expect(second).toBe(first);
  });

  it('parsed value re-serializes to the same string as the source object', () => {
    // Guards against a subtle bug where insertion-order preservation
    // during JSON.parse is broken — the second round should match the
    // first exactly. We assert against the actual expected byte string
    // so a property rename or reordered field is caught IMMEDIATELY.
    //
    // S17 update: the expected string now includes the `structure`
    // and `foundation` fields (inserted after `footprint`). Field
    // insertion order matches `DeckDesign` in `model.ts`.
    // Review-gate FIX 2: the top-level `post` field was REMOVED —
    // `foundation.post` is now the single source of truth for the
    // elevated deck's post material.
    const expected =
      '{"id":"018f4e7a-c1c5-4a3f-8f52-3a0f6c9d1e4b",' +
      '"createdAt":"2026-07-02T21:00:00.000Z",' +
      '"footprint":{"widthMm":3658,"lengthMm":4877,"heightMm":914},' +
      '"structure":"elevated",' +
      '"floatingFraming":"beams-and-joists",' +
      '"foundation":{"type":"posts-on-footings",' +
      '"post":{"nominal":"6x6","species":"PT","grade":"No2"},' +
      '"footing":{"widthMm":300,"depthMm":300}},' +
      '"joist":{"material":{"nominal":"2x8","species":"PT","grade":"No2"},' +
      '"spacingMm":406},' +
      '"beam":{"material":{"nominal":"2x10","species":"PT","grade":"No2"}},' +
      '"decking":{"material":{"nominal":"5/4x6","species":"Composite","grade":"NA"},' +
      '"orientation":"parallel-to-width"},' +
      '"layout":{"bayRemainderStrategy":"extra-bay-at-end"}}';
    expect(JSON.stringify(GOLDEN_DECK_DESIGN)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// AC4 — property test: any generated DeckDesign is round-trip stable.
// ---------------------------------------------------------------------------
//
// The `deckDesignArb` generator lives in `./__testing__/deck-design-arb.ts`
// (shared with the S6 persistence round-trip tests) so both suites
// exercise the SAME value space. See that module's header for the
// catalog subset it draws from.

describe('model — AC4 DeckDesign JSON round-trip (property test)', () => {
  it('stringify → parse → stringify is byte-for-byte identical for any generated DeckDesign', () => {
    fc.assert(
      fc.property(deckDesignArb, (design) => {
        const first = JSON.stringify(design);
        const parsed = JSON.parse(first) as unknown;
        // Deep-equal check — same rationale as the golden fixture:
        // catches silent field drops that would still round-trip
        // idempotently on both sides.
        expect(parsed).toEqual(design);
        const second = JSON.stringify(parsed);
        expect(second).toBe(first);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Anemic-data invariant — none of these entities may carry methods.
// The interface types make it a compile error, but a fixture check is
// cheap and catches a runtime accident where someone attaches a helper
// (e.g. via `Object.assign(design, { canonicalName() { … } })`).
// ---------------------------------------------------------------------------
function assertNoFunctionProperties(
  value: unknown,
  ctx: string,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (value === null || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) return; // guard against cycles even though none are expected
  seen.add(obj);
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === 'function') {
      throw new Error(`${ctx}: property '${key}' is a function — entities are anemic data.`);
    }
    if (typeof v === 'object') assertNoFunctionProperties(v, `${ctx}.${key}`, seen);
  }
}

describe('model — anemic-data invariant', () => {
  it('DeckDesign fixture has zero function-valued properties (any depth)', () => {
    expect(() => {
      assertNoFunctionProperties(GOLDEN_DECK_DESIGN, 'DeckDesign');
    }).not.toThrow();
  });

  it('Layout fixture has zero function-valued properties (any depth)', () => {
    const layout: Layout = {
      designId: GOLDEN_DECK_DESIGN.id,
      computedAt: '2026-07-02T21:00:01.000Z',
      bounds: GOLDEN_DECK_DESIGN.footprint,
      members: [
        {
          id: 'joist-0',
          kind: 'joist',
          // S17: LayoutMember.material is now the widened
          // MemberMaterialRef discriminated union — stamp the lumber
          // variant.
          material: { kind: 'lumber', ...GOLDEN_DECK_DESIGN.joist.material },
          position: { x: 0, y: 0, z: 0 },
          size: { x: 3658, y: 38, z: 184 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      ],
    };
    expect(() => {
      assertNoFunctionProperties(layout, 'Layout');
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Shape smoke tests — every exported type is exercised at least once.
// A runtime assertion here doubles as a *type-level* assertion because
// the fixture object literal must satisfy the interface to compile.
// ---------------------------------------------------------------------------
describe('model — every type is exercised by a fixture', () => {
  it('MemberKind covers joist/beam/post/footing/board/block/blocking', () => {
    const kinds: MemberKind[] = ['joist', 'beam', 'post', 'footing', 'board', 'block', 'blocking'];
    expect(new Set(kinds).size).toBe(7);
  });

  it('LayoutMember carries id, kind, material, position, size, rotation', () => {
    const member: LayoutMember = {
      id: 'beam-0',
      kind: 'beam',
      material: { kind: 'lumber', nominal: '2x10', species: 'PT', grade: 'No2' },
      position: { x: 1829, y: 0, z: 500 },
      size: { x: 3658, y: 38, z: 235 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    expect(member.kind).toBe('beam');
    expect(member.position).toEqual({ x: 1829, y: 0, z: 500 });
    expect(member.size).toEqual({ x: 3658, y: 38, z: 235 });
    expect(member.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('Warning carries memberId, kind, actualMm, allowableMm, tableReference, message', () => {
    const warning: Warning = {
      memberId: 'joist-3',
      kind: 'over-span-joist',
      actualMm: 4877,
      allowableMm: 3200,
      tableReference: 'IRC-2018 Table R502.3.1(1) — SPF No2 2x6 @ 406 mm o.c.',
      message: 'Joist 2x6 @ 406 mm o.c. span 4877 mm exceeds allowable 3200 mm.',
    };
    expect(warning.kind).toBe('over-span-joist');
    expect(warning.actualMm).toBeGreaterThan(warning.allowableMm);
    expect(warning.tableReference).toContain('IRC-2018');
  });

  it('Warning.kind is one of the two allowed literals', () => {
    const kinds: Warning['kind'][] = ['over-span-joist', 'over-span-beam'];
    expect(new Set(kinds).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC1 (issue #39) — FoundationSpec discriminated-union exhaustiveness
//
// The type-level assertion IS the test: if a new variant is added to
// `FoundationSpec` without adding a `case` here, the `never` guard in
// the `default` branch fails to compile.
//
// The runtime `describe` block also spot-checks each variant's shape.
// ---------------------------------------------------------------------------
describe('model — S17/AC1 FoundationSpec is a discriminated union', () => {
  function labelFoundation(f: FoundationSpec): string {
    switch (f.type) {
      case 'posts-on-footings':
        return `posts+footings ${f.post.nominal} ${f.footing.widthMm}×${f.footing.depthMm}`;
      case 'deck-blocks':
        return `deck-blocks ${f.product.productId}`;
      case 'tuffblocks':
        return `tuffblocks ${f.product.productId}`;
      default: {
        // Compile-time exhaustive check — a new variant fails here.
        const _exhaustive: never = f;
        return _exhaustive;
      }
    }
  }

  it('posts-on-footings variant carries post + footing', () => {
    const f: FoundationSpec = {
      type: 'posts-on-footings',
      post: { nominal: '6x6', species: 'PT', grade: 'No2' },
      footing: { widthMm: 300, depthMm: 300 },
    };
    expect(labelFoundation(f)).toBe('posts+footings 6x6 300×300');
  });

  it('deck-blocks variant carries a product ref', () => {
    const f: FoundationSpec = {
      type: 'deck-blocks',
      product: { productId: 'oldcastle-11x11x7' },
    };
    expect(labelFoundation(f)).toBe('deck-blocks oldcastle-11x11x7');
  });

  it('tuffblocks variant carries a product ref', () => {
    const f: FoundationSpec = {
      type: 'tuffblocks',
      product: { productId: 'tuffblock-12x12x4' },
    };
    expect(labelFoundation(f)).toBe('tuffblocks tuffblock-12x12x4');
  });
});

// ---------------------------------------------------------------------------
// AC1 (issue #39) — StructureMode is a two-value enum
// ---------------------------------------------------------------------------
describe('model — S17/AC1 StructureMode enum', () => {
  it('the union covers exactly two values: elevated + floating', () => {
    const modes: StructureMode[] = ['elevated', 'floating'];
    expect(new Set(modes).size).toBe(2);
  });

  it('exhaustive switch works with a never guard', () => {
    function structureLabel(s: StructureMode): string {
      switch (s) {
        case 'elevated':
          return 'E';
        case 'floating':
          return 'F';
        default: {
          const _exhaustive: never = s;
          return _exhaustive;
        }
      }
    }
    expect(structureLabel('elevated')).toBe('E');
    expect(structureLabel('floating')).toBe('F');
  });
});

// ---------------------------------------------------------------------------
// AC1 (issue #39) — MemberMaterialRef is a discriminated union tagged on
// `kind` (lumber / block). The AC6 grep audit relies on this being a real
// runtime tag consumers can switch on.
// ---------------------------------------------------------------------------
describe('model — S17/AC1 MemberMaterialRef discriminated union', () => {
  function labelMaterial(m: MemberMaterialRef): string {
    switch (m.kind) {
      case 'lumber':
        return `lumber ${m.nominal}`;
      case 'block':
        return `block ${m.productId}`;
      default: {
        // Compile-time exhaustive check.
        const _exhaustive: never = m;
        return _exhaustive;
      }
    }
  }

  it('lumber variant carries nominal/species/grade', () => {
    const m: LumberMemberMaterial = {
      kind: 'lumber',
      nominal: '2x8',
      species: 'PT',
      grade: 'No2',
    };
    expect(labelMaterial(m)).toBe('lumber 2x8');
  });

  it('block variant carries productId', () => {
    const m: MemberMaterialRef = {
      kind: 'block',
      productId: 'oldcastle-11x11x7',
    };
    expect(labelMaterial(m)).toBe('block oldcastle-11x11x7');
  });
});

// ---------------------------------------------------------------------------
// AC8 (issue #39) — model.ts contains no runtime code. The interface types
// vanish at compile time; every entity is a plain object literal at
// runtime. Verify by asserting the compiled module has no properties
// besides Symbol.toStringTag and the like.
// ---------------------------------------------------------------------------
describe('model — S17/AC8 model.ts emits no runtime code', () => {
  it('module has no named exports at runtime (types-only file)', async () => {
    // Dynamic import so this test does not add a compile-time
    // dependency on the module's runtime surface (there is none).
    const mod = await import('./model');
    // Only the default `Symbol.toStringTag` etc are present — no
    // enumerable named exports. `Object.keys` returns an empty array
    // for a pure `.ts` types-only module.
    expect(Object.keys(mod)).toEqual([]);
  });
});
