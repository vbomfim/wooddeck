/**
 * Unit tests for `src/domain/materials-catalog.ts`.
 *
 * TDD RED phase: this file is written BEFORE any implementation exists.
 * It covers every acceptance criterion owned by the catalog module in
 * GitHub issue #4:
 *
 *   - AC1  Catalog contains the MVP SKUs enumerated below (mirrors
 *          FR-012 in the spec).
 *   - AC2  Actual mm dimensions are accurate: 2x6 → 38×140, 6x6 →
 *          140×140, 5/4x6 → 25×140, and every other SKU listed in AC1.
 *   - AC3  `lookupMaterial(nominal, species, grade)` throws with a
 *          message that NAMES the offending combination when the
 *          triple is not in the catalog. Explicitly covered:
 *          Composite paired with any grade other than "NA".
 *   - Edge cases: Composite has no 4x4 / 6x6 in MVP; 5/4x6 exact
 *          values traced to a cited source.
 *
 * The expected dimensions are derived from `MM_PER_INCH` at test time
 * (NOT hard-coded to `25.4`) so the test catches any drift in the SI
 * inch constant as well as a rounding regression.
 */
import { describe, expect, it } from 'vitest';

import { MM_PER_FOOT, MM_PER_INCH } from './units';
import type { LumberNominal, Material, Species, Grade } from './model';
import { listMaterials, lookupMaterial } from './materials-catalog';

// ---------------------------------------------------------------------------
// Expected dressed dimensions from the American Softwood Lumber Standard
// (PS 20) / WWPA base sizes. These are the actual (S4S, dry) sizes for
// each nominal size — the same source cited in the implementation.
//
// Source: WWPA "Western Lumber Product Use Manual", Table 1 (Standard
// Sizes of Yard Lumber). Also mirrored in the US Softwood Lumber
// Standard PS 20-20, Table 3.
// ---------------------------------------------------------------------------
const EXPECTED_DIMENSIONS_IN: Record<LumberNominal, { widthIn: number; heightIn: number }> = {
  '2x6': { widthIn: 1.5, heightIn: 5.5 },
  '2x8': { widthIn: 1.5, heightIn: 7.25 },
  '2x10': { widthIn: 1.5, heightIn: 9.25 },
  '2x12': { widthIn: 1.5, heightIn: 11.25 },
  '4x4': { widthIn: 3.5, heightIn: 3.5 },
  '6x6': { widthIn: 5.5, heightIn: 5.5 },
  '5/4x6': { widthIn: 1.0, heightIn: 5.5 },
};

function expectedMm(inches: number): number {
  // Rounded to the nearest millimeter — matches the catalog's stated
  // rounding policy (see materials-catalog.ts header).
  return Math.round(inches * MM_PER_INCH);
}

// ---------------------------------------------------------------------------
// AC1 — the complete SKU list required for MVP (mirrors ticket AC1 +
// FR-012). Every entry here MUST be present in listMaterials().
// ---------------------------------------------------------------------------
const REQUIRED_SKUS: readonly {
  nominal: LumberNominal;
  species: Species;
  grade: Grade;
}[] = [
  // 2x framing sizes — PT / Cedar / Composite
  { nominal: '2x6', species: 'PT', grade: 'No2' },
  { nominal: '2x6', species: 'Cedar', grade: 'No2' },
  { nominal: '2x6', species: 'Composite', grade: 'NA' },
  { nominal: '2x8', species: 'PT', grade: 'No2' },
  { nominal: '2x8', species: 'Cedar', grade: 'No2' },
  { nominal: '2x8', species: 'Composite', grade: 'NA' },
  { nominal: '2x10', species: 'PT', grade: 'No2' },
  { nominal: '2x10', species: 'Cedar', grade: 'No2' },
  { nominal: '2x10', species: 'Composite', grade: 'NA' },
  { nominal: '2x12', species: 'PT', grade: 'No2' },
  { nominal: '2x12', species: 'Cedar', grade: 'No2' },
  { nominal: '2x12', species: 'Composite', grade: 'NA' },
  // Post sizes — PT / Cedar only (no MVP composite posts)
  { nominal: '4x4', species: 'PT', grade: 'No2' },
  { nominal: '4x4', species: 'Cedar', grade: 'No2' },
  { nominal: '6x6', species: 'PT', grade: 'No2' },
  { nominal: '6x6', species: 'Cedar', grade: 'No2' },
  // Decking board — PT / Cedar / Composite
  { nominal: '5/4x6', species: 'PT', grade: 'No2' },
  { nominal: '5/4x6', species: 'Cedar', grade: 'No2' },
  { nominal: '5/4x6', species: 'Composite', grade: 'NA' },
];

function keyOf(m: Pick<Material, 'nominal' | 'species' | 'grade'>): string {
  return `${m.nominal}|${m.species}|${m.grade}`;
}

// ---------------------------------------------------------------------------
// AC1 — catalog completeness.
// ---------------------------------------------------------------------------
describe('materials-catalog — AC1 catalog completeness', () => {
  it('listMaterials() returns exactly the MVP SKU set (no missing, no extras)', () => {
    const actualKeys = new Set(listMaterials().map(keyOf));
    const expectedKeys = new Set(REQUIRED_SKUS.map(keyOf));

    // Missing entries → catalog is incomplete
    for (const key of expectedKeys) {
      expect(actualKeys.has(key)).toBe(true);
    }
    // Extra entries → someone snuck in a size that isn't yet spec'd.
    // If MVP adds a SKU, update REQUIRED_SKUS + FR-012.
    for (const key of actualKeys) {
      expect(expectedKeys.has(key)).toBe(true);
    }
  });

  it('listMaterials() returns exactly 19 entries (MVP catalog cardinality)', () => {
    // 4 × 3 (2x framing × {PT, Cedar, Composite})
    //   + 2 × 2 (posts × {PT, Cedar})
    //   + 1 × 3 (5/4x6 × {PT, Cedar, Composite})
    //   = 12 + 4 + 3 = 19
    expect(listMaterials()).toHaveLength(19);
  });

  it('every entry in the catalog is resolvable through lookupMaterial()', () => {
    for (const m of listMaterials()) {
      expect(lookupMaterial(m.nominal, m.species, m.grade)).toBe(m);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — dimension accuracy.
// ---------------------------------------------------------------------------
describe('materials-catalog — AC2 actual dimensions are accurate', () => {
  it('2x6 PT No2 → widthMm ≈ 38 (1.5″), heightMm ≈ 140 (5.5″)', () => {
    const m = lookupMaterial('2x6', 'PT', 'No2');
    expect(m.actual.widthMm).toBe(expectedMm(1.5)); // 38
    expect(m.actual.heightMm).toBe(expectedMm(5.5)); // 140
  });

  it('6x6 PT No2 → widthMm ≈ 140, heightMm ≈ 140 (5.5″×5.5″)', () => {
    const m = lookupMaterial('6x6', 'PT', 'No2');
    expect(m.actual.widthMm).toBe(expectedMm(5.5)); // 140
    expect(m.actual.heightMm).toBe(expectedMm(5.5)); // 140
  });

  it('5/4x6 PT No2 → widthMm ≈ 25 (1″), heightMm ≈ 140 (5.5″)', () => {
    const m = lookupMaterial('5/4x6', 'PT', 'No2');
    expect(m.actual.widthMm).toBe(expectedMm(1.0)); // 25
    expect(m.actual.heightMm).toBe(expectedMm(5.5)); // 140
  });

  it('4x4 PT No2 → widthMm ≈ 89 (3.5″), heightMm ≈ 89', () => {
    const m = lookupMaterial('4x4', 'PT', 'No2');
    expect(m.actual.widthMm).toBe(expectedMm(3.5)); // 89
    expect(m.actual.heightMm).toBe(expectedMm(3.5));
  });

  it('every SKU’s widthMm/heightMm match the PS-20 dressed-size table', () => {
    for (const spec of REQUIRED_SKUS) {
      const m = lookupMaterial(spec.nominal, spec.species, spec.grade);
      const expected = EXPECTED_DIMENSIONS_IN[spec.nominal];
      // `noUncheckedIndexedAccess` makes the lookup `T | undefined`;
      // the record is exhaustive over `LumberNominal` so a missing key
      // is a test-authoring bug, not a runtime possibility.
      if (!expected) {
        throw new Error(`Test bug: no expected dimensions for nominal '${spec.nominal}'.`);
      }
      expect(m.actual.widthMm).toBe(expectedMm(expected.widthIn));
      expect(m.actual.heightMm).toBe(expectedMm(expected.heightIn));
    }
  });

  it('a Material’s echoed nominal/species/grade match the lookup arguments', () => {
    // Guards against a bug where the catalog table swaps rows: the
    // material returned for ("6x6","PT","No2") is not, say, the 2x6
    // Cedar entry mis-indexed.
    for (const spec of REQUIRED_SKUS) {
      const m = lookupMaterial(spec.nominal, spec.species, spec.grade);
      expect(m.nominal).toBe(spec.nominal);
      expect(m.species).toBe(spec.species);
      expect(m.grade).toBe(spec.grade);
    }
  });

  it('every derived dimension is a finite integer millimeter (rounded)', () => {
    for (const m of listMaterials()) {
      expect(Number.isInteger(m.actual.widthMm)).toBe(true);
      expect(Number.isInteger(m.actual.heightMm)).toBe(true);
      expect(Number.isFinite(m.actual.widthMm)).toBe(true);
      expect(Number.isFinite(m.actual.heightMm)).toBe(true);
      expect(m.actual.widthMm).toBeGreaterThan(0);
      expect(m.actual.heightMm).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// AC3 — unknown material fails with a message that names the combination.
// ---------------------------------------------------------------------------
describe('materials-catalog — AC3 unknown material throws with contextful message', () => {
  it('lookupMaterial("2x6","Composite","No2") throws — Composite has no grade', () => {
    expect(() => lookupMaterial('2x6', 'Composite', 'No2')).toThrow(Error);
    try {
      lookupMaterial('2x6', 'Composite', 'No2');
      throw new Error('expected lookupMaterial to throw');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Must name every part of the offending combination — a
      // "unknown material" alone is not enough context to debug from.
      expect(message).toContain('2x6');
      expect(message).toContain('Composite');
      expect(message).toContain('No2');
    }
  });

  it('lookupMaterial("4x4","Composite","NA") throws — no composite posts in MVP', () => {
    expect(() => lookupMaterial('4x4', 'Composite', 'NA')).toThrow(/4x4.*Composite.*NA/);
  });

  it('lookupMaterial("6x6","Composite","NA") throws — no composite posts in MVP', () => {
    expect(() => lookupMaterial('6x6', 'Composite', 'NA')).toThrow(/6x6.*Composite.*NA/);
  });

  it('any Composite + non-"NA" grade combination throws', () => {
    const nonNaGrades: Grade[] = ['No1', 'No2', 'Select'];
    const nominals: LumberNominal[] = ['2x6', '2x8', '2x10', '2x12', '5/4x6'];
    for (const nominal of nominals) {
      for (const grade of nonNaGrades) {
        expect(() => lookupMaterial(nominal, 'Composite', grade)).toThrow(Error);
      }
    }
  });

  it('any softwood + "NA" grade combination throws (grade is not optional for PT/Cedar)', () => {
    const softwoods: Species[] = ['PT', 'Cedar'];
    for (const species of softwoods) {
      expect(() => lookupMaterial('2x6', species, 'NA')).toThrow(Error);
    }
  });

  it('unknown grades ("Select") throw for standard framing lumber (not in MVP)', () => {
    // "Select" is a valid grade literal in the type, but the MVP
    // catalog only stocks "No2" for softwood framing. Any "Select"
    // lookup MUST throw — silently returning a No2 entry would be a
    // correctness bug for span-check.
    expect(() => lookupMaterial('2x8', 'PT', 'Select')).toThrow(Error);
    expect(() => lookupMaterial('2x10', 'Cedar', 'Select')).toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// S21 issue #43 — AC10: catalog stock lengths per SKU.
//
// Every Material MUST expose `stockLengthsMm` — the sorted, non-empty
// list of standard stock board lengths carried for that SKU. The
// values are computed from feet-in-millimeters via `MM_PER_FOOT` (NO
// magic 304.8 anywhere).
//
// Reference (Home Depot Canada, verified 2026-07-04):
//   - 2× framing (2x6, 2x8, 2x10, 2x12) → 8, 10, 12, 14, 16, 20 ft
//     (all species: PT / Cedar / Composite)
//   - 5/4×6 decking                     → 8, 10, 12, 14, 16, 18, 20 ft
//     (all species: PT / Cedar / Composite)
//   - Posts (4x4 / 6x6)                 → 8, 10, 12, 14, 16 ft
//     (all species that carry the SKU: PT / Cedar)
//
// The cut-list bin-packer (packCutList in src/domain/bom/pack-cut-list.ts)
// reads this field as its stockLengthsMm input — the catalog is the
// single source of truth, so the pack policy is PARAMETRIC on the SKU.
// ---------------------------------------------------------------------------
describe('materials-catalog — S21 AC10 stockLengthsMm per SKU', () => {
  const ftToMm = (feet: number): number => Math.round(feet * MM_PER_FOOT);

  const EXPECTED_STOCK_FEET: Record<LumberNominal, readonly number[]> = {
    // 2× dimensional framing lumber — common HD Canada offerings.
    '2x6': [8, 10, 12, 14, 16, 20],
    '2x8': [8, 10, 12, 14, 16, 20],
    '2x10': [8, 10, 12, 14, 16, 20],
    '2x12': [8, 10, 12, 14, 16, 20],
    // Post stock. 6×6 tops out at 16 ft in retail; 4×4 same.
    '4x4': [8, 10, 12, 14, 16],
    '6x6': [8, 10, 12, 14, 16],
    // 5/4×6 decking — one extra length (18 ft) than 2× framing.
    '5/4x6': [8, 10, 12, 14, 16, 18, 20],
  };

  it('every Material record exposes a non-empty, ascending-sorted stockLengthsMm array', () => {
    for (const m of listMaterials()) {
      expect(Array.isArray(m.stockLengthsMm)).toBe(true);
      expect(m.stockLengthsMm.length).toBeGreaterThan(0);
      // Ascending sort — no ties (a duplicate stock length would be
      // a data-entry bug the packer's smallest-that-fits policy
      // would silently swallow).
      for (let i = 1; i < m.stockLengthsMm.length; i++) {
        expect(m.stockLengthsMm[i]!).toBeGreaterThan(m.stockLengthsMm[i - 1]!);
      }
      // Every value is a positive finite integer millimeter.
      for (const len of m.stockLengthsMm) {
        expect(Number.isInteger(len)).toBe(true);
        expect(Number.isFinite(len)).toBe(true);
        expect(len).toBeGreaterThan(0);
      }
    }
  });

  it('stockLengthsMm matches the standard HD Canada offering per nominal', () => {
    for (const m of listMaterials()) {
      const expectedFeet = EXPECTED_STOCK_FEET[m.nominal];
      // The lookup is exhaustive over LumberNominal, so a missing
      // key is a test-authoring bug — surface it clearly.
      if (!expectedFeet) {
        throw new Error(`Test bug: no expected stock lengths for nominal '${m.nominal}'.`);
      }
      const expectedMm = expectedFeet.map(ftToMm);
      expect(Array.from(m.stockLengthsMm)).toEqual(expectedMm);
    }
  });

  it('the smallest 2× framing stock length is 8 ft (2438 mm)', () => {
    // Anchoring the minimum locks in a known-good conversion via
    // MM_PER_FOOT (2438 mm) — the value used by the S21 user-example
    // fixture (which packs 16 ft = 4877 mm boards).
    const m = lookupMaterial('2x8', 'PT', 'No2');
    expect(m.stockLengthsMm[0]).toBe(ftToMm(8));
    // 8 ft * 304.8 mm/ft = 2438.4 → rounds to 2438 mm.
    expect(m.stockLengthsMm[0]).toBe(2438);
  });

  it('the AC7 fixture stock length (16 ft) is present in every 2×8 species SKU', () => {
    // The user's hand-drawn example packs 2×8 members into 16 ft
    // stock boards. This test guards against a future catalog edit
    // that removes 16 ft from the 2×8 stock list (which would
    // change AC7's expected total from 15 to something else).
    const sixteenFtMm = ftToMm(16);
    const speciesSet: Species[] = ['PT', 'Cedar', 'Composite'];
    for (const species of speciesSet) {
      const grade: Grade = species === 'Composite' ? 'NA' : 'No2';
      const m = lookupMaterial('2x8', species, grade);
      expect(m.stockLengthsMm).toContain(sixteenFtMm);
    }
  });

  it('the stockLengthsMm array is frozen (mutation throws in strict mode)', () => {
    // Consumers must NOT be able to poison another consumer's copy —
    // matches the discipline for `actual` and the whole Material record.
    const m = lookupMaterial('2x8', 'PT', 'No2');
    // A frozen array's push throws in strict mode (this test file
    // runs under ESM strict mode implicitly).
    expect(() => {
      (m.stockLengthsMm as number[]).push(9999);
    }).toThrow(TypeError);
  });

  it('the derived MM_PER_INCH constant is used (no hard-coded 25.4 possible via round-trip)', () => {
    // Sanity check — MM_PER_FOOT ≈ 12 × MM_PER_INCH. The catalog
    // uses MM_PER_FOOT for stock length conversion; asserting the
    // relationship guards a future edit that swaps in a different
    // constant without touching the catalog. `toBeCloseTo` accounts
    // for the IEEE-754 residual in 12 × 25.4 = 304.79999… — the
    // ACTUAL constant is the exact literal 304.8 (see units.ts).
    expect(MM_PER_FOOT).toBeCloseTo(12 * MM_PER_INCH, 10);
  });
});
