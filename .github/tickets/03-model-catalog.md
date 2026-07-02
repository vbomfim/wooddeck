# [S3] Domain — core entities + SKU-based materials catalog

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/3-domain-model-catalog` (off `feat/mvp-deck-designer`)
**Depends on:** S1, S2

## 1. User Story

As **any consumer of the domain layer**,
I want **the canonical `DeckDesign` entity, its parts (`Joist`, `Beam`, `Post`, `Footing`, `Board`) stored by nominal lumber SKU, and a static materials catalog that maps SKU → actual mm dimensions and species**,
so that **the design carries shopping-list identity (a "2×6 SPF #2" not an anonymous rectangle) and the layout engine has all the data it needs to produce a complete `Layout`**.

**Success metrics:** `DeckDesign` and `Layout` types compile; static materials catalog exports at least the SKUs listed in FR-012; a golden `DeckDesign` fixture round-trips through `JSON.stringify → JSON.parse` byte-for-byte identically.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/domain/model.ts` | `DeckDesign`, `Joist`, `Beam`, `Post`, `Footing`, `Board`, `Warning`, `Layout` type definitions | New |
| `src/domain/materials-catalog.ts` | Static catalog of lumber SKUs + species + derived mm dimensions | New |
| `src/domain/model.test.ts` | Type/shape invariants + JSON round-trip smoke test | New |
| `src/domain/materials-catalog.test.ts` | Catalog completeness + derived-dimension accuracy | New |

**Boundary:** Type definitions and a static data module. No behavior beyond `lookupMaterial(sku)`.
**File structure:** `src/domain/`.

**Interface Contract:**

```ts
import type { Mm } from "./units";

// -------- SKU-based lumber identity --------
export type LumberNominal =
  | "2x6" | "2x8" | "2x10" | "2x12"
  | "4x4" | "6x6"
  | "5/4x6";
export type Species = "PT" | "Cedar" | "Composite";
export type Grade = "No1" | "No2" | "Select" | "NA"; // Composite has no grade → "NA"

export interface Material {
  nominal: LumberNominal;
  species: Species;
  grade: Grade;
  actual: { widthMm: Mm; heightMm: Mm }; // derived; provided by catalog
}

// Static lookup — throws if unknown combination.
export function lookupMaterial(nominal: LumberNominal, species: Species, grade: Grade): Material;
export function listMaterials(): Material[];

// -------- Canonical design entity — the SOURCE OF TRUTH --------
export interface DeckDesign {
  id: string;                       // uuid
  createdAt: string;                // ISO-8601
  footprint: { widthMm: Mm; lengthMm: Mm; heightMm: Mm };
  joist: { material: MaterialRef; spacingMm: Mm };  // e.g., 406 mm ≈ 16" o.c.
  beam:  { material: MaterialRef };                 // beam size
  post:  { material: MaterialRef };                 // post size
  decking: { material: MaterialRef; orientation: "parallel-to-length" | "parallel-to-width" };
  // Layout preferences (not editable in MVP but reserved so .deck v1 doesn't break):
  layout: { bayRemainderStrategy: "extra-bay-at-end" | "centered" };
}

export interface MaterialRef {
  nominal: LumberNominal;
  species: Species;
  grade: Grade;
}

// -------- Layout — the render contract (produced by S4) --------
// Defined here so scene components can import the type without depending on the engine.
export type MemberKind = "joist" | "beam" | "post" | "footing" | "board";

export interface LayoutMember {
  id: string;                                          // stable; used to key warnings & React lists
  kind: MemberKind;
  material: MaterialRef;
  position: { x: Mm; y: Mm; z: Mm };                   // center of member
  size: { x: Mm; y: Mm; z: Mm };                       // full extent along each axis
  rotation: { x: number; y: number; z: number };       // radians; MVP: usually all zero
}

export interface Layout {
  designId: string;                                    // matches DeckDesign.id
  computedAt: string;                                  // ISO-8601
  bounds: { widthMm: Mm; lengthMm: Mm; heightMm: Mm };
  members: LayoutMember[];
}

// -------- Warning — produced by S5 --------
export interface Warning {
  memberId: string;
  kind: "over-span-joist" | "over-span-beam";
  actualMm: Mm;
  allowableMm: Mm;
  tableReference: string;   // e.g., "IRC-2018 Table R502.3.1(1) — SPF No2 2x6 @ 406 mm o.c."
  message: string;          // human-readable
}
```

**Input contract:** consumers construct `DeckDesign` values directly.
**Output contract:** typed entities usable by every downstream layer.
**Error contract:** `lookupMaterial` throws `Error("Unknown material: nominal=%s species=%s grade=%s")` when combination is not in catalog.

**Dependencies:**
- Depends on: `units.ts` (S2).
- Consumed by: `layout-engine` (S4), `span-check` (S5), `persistence` (S6), `state` (S8), `scene/*` (S10), `ui/*` (S13–S15).
- Rule: NEVER add methods to these interfaces — they are anemic data. Behavior lives in `layout-engine`, `span-check`, and use-cases.

**Rewritability check:**
- [x] Can be rewritten from the type signatures + catalog list.
- [x] Consumers survive rewrite as long as public types + `lookupMaterial` shape are preserved.
- [x] `DeckDesign` and `Layout` are owned entirely by this module.

## 3. Audience & Personas
- Primary: every downstream developer.
- Secondary: N/A.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Catalog contains MVP SKUs**
- Given the catalog module,
- Then `listMaterials()` includes at minimum:
  - 2×6, 2×8, 2×10, 2×12 in PT (No2), Cedar (No2), Composite (NA)
  - 4×4, 6×6 in PT (No2), Cedar (No2)
  - 5/4×6 in PT (No2), Cedar (No2), Composite (NA)
- (Matches spec FR-012.)

**AC2: Actual dimensions are accurate**
- Given `lookupMaterial("2x6", "PT", "No2")`,
- Then `actual.widthMm ≈ 38` and `actual.heightMm ≈ 140` (nominal 2×6 is actually 1.5″ × 5.5″ = 38.1 × 139.7 mm; rounded to 1 mm).
- Given `lookupMaterial("6x6", "PT", "No2")`,
- Then `actual.widthMm ≈ 140` and `actual.heightMm ≈ 140` (5.5″ × 5.5″).

**AC3: Unknown material fails clearly**
- Given `lookupMaterial("2x6", "Composite", "No2")`,
- When called (Composite has no grade),
- Then throws `Error` whose message names the offending combination.

**AC4: `DeckDesign` JSON round-trip**
- Given a fixture `DeckDesign` value,
- When serialized via `JSON.stringify` then parsed via `JSON.parse` and re-serialized,
- Then the two JSON strings are byte-for-byte identical (property test with `fast-check` for a small generator, plus one golden fixture).

**AC5: Types compile in strict mode**
- Given `tsconfig.json` `strict: true`,
- Then all files typecheck with no `any` and no `@ts-ignore`.

### Edge Cases
- Composite lumber has no grade → the catalog uses `grade: "NA"`; `lookupMaterial(..., "Composite", "No2")` MUST throw.
- 5/4 × 6 is a common decking board with actual `1" × 5.5"` → catalog exact values from a cited source (add reference comment).

## 5. Reliability [Azure WAF]
- N/A — pure module.

## 6. Security [Azure WAF]
- N/A — static data + type definitions only. No I/O.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- Catalog lookup: O(1) (Map keyed by `${nominal}|${species}|${grade}`). No performance test required.

## 10. Accessibility [WCAG 2.2]
- N/A — no UI.

## 11. API & Data Contracts
- TypeScript signatures above.

## 12. Data Model & Storage
- `DeckDesign` is the canonical persisted entity (S6 serializes it).

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** `uuid` (for `DeckDesign.id` generation — helper lives in this module or its own tiny file).
- **Risks:**
  - Catalog inaccuracies → cite an authoritative source (US lumber-grading standard, or the WWPA base sizes) in a code comment above the catalog data.
  - Composite dimensions vary by manufacturer → use the most common Trex-style dimensions and document in a comment; note that real-world composites may differ.

## 16. Out of Scope
- User-editable catalog (Code Review Guardian finding #10: future migration to repository-behind-a-port; NOT MVP).
- Weight, cost, or environmental properties on `Material`.
- Custom lumber (non-standard sizes).

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Should `MaterialRef` be reduced to just `nominal + species` when grade is implied by species/type (e.g., all Composite is `NA`)? — Answer: keep grade explicit; simpler validation.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| SKU-based `Board` vs. raw mm dims | Preserves shopping identity | Simpler layout math | **A** | Code Review Guardian finding #5: raw mm loses SKU identity and creates imperial round-trip drift. |
| Anemic data types vs. class methods | Serialization-safe, framework-agnostic | Convenience methods | **A** | Behavior belongs in domain functions (`layout-engine`, `span-check`), keeping data trivially JSON-serializable. |

## 18. Testing Strategy
- **Unit tests:** all ACs above.
- **Property tests:** AC4 round-trip.
- **Integration / E2E:** N/A.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify SKU-based `Board` design (finding #5) and complete `Layout` render contract (finding #3) | PR review |
