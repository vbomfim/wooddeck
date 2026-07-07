# [S5] Domain — `SpanTable` interface + IRC-2018 impl + `span-check`

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/5-span-tables-check` (off `feat/mvp-deck-designer`)
**Depends on:** S1, S2, S3, S4

## 1. User Story

As **the state + UI layers**,
I want **`span-check(layout, table) → Warning[]` backed by a swappable `SpanTable` interface with an IRC-2018 static implementation**,
so that **over-span joists and beams are flagged in the 3D view and Warnings panel, giving DIY homeowners real feedback while keeping the code open to future span-table sources (IRC-2024, Canadian NBC)**.

**Success metrics:** given a deliberately over-span design, `span-check` returns a `Warning` per over-span member with the correct allowable value and IRC table reference; ≥ 8 golden tests pass, each citing the IRC-2018 table row in its test name.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/domain/spans/span-table.ts` | `SpanTable` interface | New |
| `src/domain/spans/irc-2018-tables.ts` | Static IRC-2018 data + `IrcSpanTable` impl | New |
| `src/domain/spans/span-check.ts` | `spanCheck(layout, table) → Warning[]` | New |
| `src/domain/spans/*.test.ts` | Golden tests + boundary tests | New |
| `docs/span-tables/` | Source documents + attribution + license notes | New |

**Boundary:** Pure functions + a static data module. Consumes `Layout` (S3, S4); produces `Warning[]` (S3).
**File structure:** `src/domain/spans/` + `docs/span-tables/`.

**Interface Contract:**

```ts
import type { Layout, Warning, MaterialRef, MemberKind } from "../model";
import type { Mm } from "../units";

// The abstraction — swappable per code edition.
export interface SpanTable {
  readonly edition: string;                         // e.g., "IRC-2018"
  lookupJoistMaxSpan(material: MaterialRef, spacingMm: Mm): Mm; // returns max allowable joist span for size/species/grade/spacing
  lookupBeamMaxSpan(material: MaterialRef, joistSpanMm: Mm, plyCount: number): Mm; // returns max allowable beam span
  citationFor(kind: MemberKind, material: MaterialRef, spacingMm: Mm): string;      // e.g., "IRC-2018 Table R507.6"
}

export class IrcSpanTable implements SpanTable {
  readonly edition = "IRC-2018";
  // ...
}

// The checker.
export function spanCheck(layout: Layout, table: SpanTable): Warning[];
```

**Input contract:** a `Layout` from `computeLayout` + a `SpanTable` instance.
**Output contract:** zero or more `Warning` records — one per over-span member, ordered by `memberId`.
**Error contract:** `spanCheck` never throws for missing table rows — if a combination is not in the table (e.g., unusual spacing), it emits a `Warning` of `kind: "over-span-joist"` with an `allowableMm: 0` and a message "not covered by IRC-2018 tables; verify with a professional." (Documented behavior — fail-safe conservative.)

**Dependencies:**
- Depends on: `model.ts` (S3), `units.ts` (S2), `layout-engine.ts` (S4 — via `Layout` type).
- Consumed by: `application/compute-layout.ts` (S7) which produces `{ layout, warnings }`.
- Rule: `span-check` MUST depend on the `SpanTable` interface only — never on `irc-2018-tables.ts` directly (Code Review Guardian finding #4).

**Rewritability check:**
- [x] Alternative implementations of `SpanTable` can be added without changing `span-check`.
- [x] `span-check` rewrite requires only the interface + tests.
- [x] Data is owned by the IRC impl module; no shared mutable state.

## 3. Audience & Personas
- Primary: state + UI + scene developers.
- Secondary: any future contributor who wants to swap in IRC-2024 or NBC tables.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: In-limit design produces no warnings**
- Given a `DeckDesign` = 12 ft × 12 ft, 2×10 SPF #2 joists at 16" o.c., 2×10 double-ply beam,
- When `spanCheck(computeLayout(design), new IrcSpanTable())` is called,
- Then it returns `[]`.

**AC2: Over-span joist produces a warning**
- Given a `DeckDesign` = 12 ft × 16 ft, 2×6 SPF #2 joists at 24" o.c. (span 16 ft = 4877 mm; IRC allows ≈ 8 ft 6 in ≈ 2590 mm),
- When `spanCheck` is called,
- Then it returns one `Warning` per joist with `kind: "over-span-joist"`, `actualMm ≈ 4877`, `allowableMm ≈ 2590`, and `tableReference` citing "IRC-2018 Table R507.6" (or the correct row).

**AC3: Table swap doesn't require checker changes**
- Given a mock `SpanTable` that always returns `10000 mm`,
- When `spanCheck` is called against a deck with joists spanning 8000 mm,
- Then it returns `[]` (checker uses the abstraction, not concrete data).

**AC4: Missing table row → fail-safe warning**
- Given a joist with a spacing that isn't tabulated (e.g., 500 mm),
- When `spanCheck` is called,
- Then it returns a `Warning` with `allowableMm: 0` and `message` containing "not covered".

**AC5: IRC-2018 data provenance**
- Given `docs/span-tables/`,
- Then it contains:
  - `README.md` citing the IRC-2018 source (with the specific ICC publication + freely-available table URLs).
  - A note on the license status of the reproduced tables (fair-use factual data, not the copyrighted narrative text).

**AC6: ≥ 8 golden tests**
- Given `src/domain/spans/span-check.test.ts`,
- Then it contains at least 8 tests, each named with the IRC-2018 table row being validated (e.g., `it("IRC-2018 R502.3.1(1) — SPF No2 2x8 @ 16 in o.c. → max 10 ft 6 in", ...)`).

### Edge Cases
- Beam ply count: MVP supports single (`plyCount=1`) and double (`plyCount=2`) beams; MUST default to 2 in the layout engine so the golden tests are realistic.
- Joist span = allowable span exactly → NOT a warning (boundary is inclusive of allowable).
- Joist span = allowable + 1 mm → warning (boundary test).
- Empty layout (no joists) → `spanCheck` returns `[]`.

### User Flows
- N/A.

## 5. Reliability [Azure WAF]
- Pure function; no reliability concerns.

## 6. Security [Azure WAF]
- N/A — no external I/O. Table data is a checked-in TS module.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- `spanCheck(layout)` runs in ≤ 10 ms for a layout with ≤ 100 members (well under the interactive budget).

## 10. Accessibility [WCAG 2.2]
- The `Warning.message` field MUST be plain human-readable text (used by the Warnings panel S14, which is a screen-reader-friendly list).

## 11. API & Data Contracts
- TypeScript signatures above.

## 12. Data Model & Storage
- Produces `Warning[]` (defined in S3). Not persisted.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** none.
- **Risks:**
  - **Legal-liability surface.** The disclaimer (FR-016) is the primary mitigation. Story 12's disclaimer test is a hard dependency; do NOT ship span warnings without a rendered disclaimer.
  - **Table transcription errors.** Mitigated by (a) golden tests naming the source row, (b) `docs/span-tables/` citing source URLs so any reviewer can verify.
  - **Fair-use scope of reproducing IRC tables.** MVP reproduces only the factual span values (not commentary), which are widely reproduced in secondary sources. Document the position in `docs/span-tables/README.md`; if a legal concern arises, the `SpanTable` interface allows a swap to a fully-open dataset.

## 16. Out of Scope
- Deflection ratio calculations.
- Snow-load or dead-load adjustments beyond IRC defaults.
- Cantilever span limits (v2+).
- Ledger board / joist-hanger connection checks (v2+; requires ledger which is out of MVP scope).
- Post height + lateral load checks.

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Exact IRC edition to reproduce: 2018 (widely adopted) vs. 2021 (newer). MVP: **2018**; document a note that codes are jurisdiction-specific and the user must verify locally.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| `SpanTable` interface vs. direct concrete data | Extensible | Simpler | **Interface** | Code Review Guardian finding #4: SOLID/OCP; even one impl benefits from the seam. |
| Fail-safe on missing row (warn) vs. throw | UX-friendly | Strict | **Warn** | Better DIY UX to say "not covered — consult a pro" than to crash. |

## 18. Testing Strategy
- **Unit tests:** all ACs.
- **Golden tests:** ≥ 8 named per AC6.
- **Boundary tests:** allowable ± 1 mm.
- **Integration:** N/A at this layer (state layer will integrate via S7).

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify `SpanTable` interface separation (finding #4) | PR review |
| QA Guardian | Verify golden-test naming discipline + coverage of common size/spacing combos | PR review |
