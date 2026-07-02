# [S2] Domain — canonical mm units + conversion + formatting

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/2-units-subsystem` (off `feat/mvp-deck-designer`)
**Depends on:** S1

## 1. User Story

As **any consumer of the domain layer**,
I want **a single `units.ts` module that owns all length representations, conversions, and human-readable formatting**,
so that **every other module operates on canonical millimeters and no accidental unit-mixing bugs land in production**.

**Success metrics:** every length in the codebase is either an mm number produced by this module, or a formatted string produced by this module. Round-trip `parse("12 ft")` → mm → `format(mm, "imperial")` returns "12′ 0″" (or equivalent) with 1 mm tolerance.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/domain/units.ts` | Canonical mm type + conversion + parse + format for imperial & metric | New |
| `src/domain/units.test.ts` | Unit tests + property tests for parse/format round-trip | New |

**Boundary:** Numbers are the canonical mm value (integer where practical, ≥ 1 mm precision). All other domain code MUST use these functions for any conversion or formatting.
**File structure:** `src/domain/units.ts` + tests.

**Interface Contract (define BEFORE implementation):**

```ts
// Canonical unit is millimeters. `Mm` is a type alias for clarity; no branded type per spec.
export type Mm = number;

export type UnitSystem = "imperial" | "metric";

// Parsing user input.
// Accepts: "12", "12 ft", "12'", "12'6\"", "12 ft 6 in", "3.5 m", "350 cm", "3500 mm".
// Returns Mm rounded to nearest integer; throws `UnitParseError` on unrecognized input.
export function parseLength(input: string, defaultSystem: UnitSystem): Mm;

// Formatting for display.
// system="imperial" → "12′ 6″" or "12'-6\"" (single canonical style, TBD implementation)
// system="metric"    → "3.66 m" for ≥ 1 m, otherwise "36.6 cm" for ≥ 10 cm, otherwise "366 mm"
export function formatLength(mm: Mm, system: UnitSystem, opts?: { precision?: "coarse" | "fine" }): string;

// Explicit conversion helpers (used internally by parse/format; exported for tests).
export function ftInToMm(feet: number, inches?: number): Mm;
export function mmToFtIn(mm: Mm): { feet: number; inches: number; fraction: string /* e.g., "1/8" */ };
export function metersToMm(m: number): Mm;
export function mmToMeters(mm: Mm): number;

// Fixed constants — the ONLY place these live in the codebase.
export const MM_PER_INCH = 25.4;      // exact
export const MM_PER_FOOT = 304.8;     // exact (12 × 25.4)
export const MM_PER_METER = 1000;
```

**Input contract:** strings from UI, numbers from domain code.
**Output contract:** `Mm` (number) or formatted strings; `UnitParseError` on bad input.
**Error contract:** `UnitParseError extends Error` with the offending input in `err.input`.

**Dependencies:**
- Depends on: nothing.
- Consumed by: every other domain module + UI parameter panel (S13).
- Rule: numeric literals with unit semantics MUST NOT appear anywhere in the codebase except `units.ts` and its tests. An ESLint `no-restricted-syntax` rule OR a code-review checklist item enforces this.

**Rewritability check:**
- [x] Can be rewritten from the interface signatures + tests alone.
- [x] Consumers survive rewrite as long as the exported names + `Mm` type are preserved.
- [x] No shared state.

## 3. Audience & Personas
- Primary: every developer working on `domain/`, `application/`, `state/`, or `ui/`.
- Secondary: N/A.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Parse imperial**
- Given the input `"12 ft"`, `"12'"`, `"12 ft 0 in"`, `"12'0\""`, all with `defaultSystem="imperial"`,
- When `parseLength` is called,
- Then all return `3658` (12 × 304.8 = 3657.6 → rounded to 3658 mm).

**AC2: Parse metric**
- Given `"3.5 m"`, `"350 cm"`, `"3500 mm"`,
- When `parseLength` is called with `defaultSystem="metric"`,
- Then all return `3500`.

**AC3: Parse bare number uses default system**
- Given `"12"` with `defaultSystem="imperial"`, `parseLength` returns 3658 mm.
- Given `"12"` with `defaultSystem="metric"`, `parseLength` returns 12 mm.

**AC4: Format imperial**
- Given `mm = 3658`, `formatLength(mm, "imperial")` returns `"12′ 0″"` (or the canonical style chosen — must be consistent across the app).

**AC5: Format metric**
- Given `mm = 3500`, `formatLength(mm, "metric")` returns `"3.5 m"`.
- Given `mm = 350`, returns `"35 cm"`.
- Given `mm = 35`, returns `"35 mm"`.

**AC6: Parse errors**
- Given `"twelve feet"`, `parseLength` throws `UnitParseError` whose `.input` is `"twelve feet"`.

**AC7: Round-trip stability (property test)**
- For all valid `Mm` values in `[0, 100_000]`, `parseLength(formatLength(mm, system), system)` returns a value within ±1 mm of `mm`.

### Edge Cases
- Negative input → throw `UnitParseError`.
- Empty string → throw `UnitParseError`.
- Zero → `parseLength("0")` → 0; `formatLength(0, ...)` → `"0 mm"` / `"0″"`.
- Fractional imperial input `"12' 6 1/2\""` → convert to 3823 mm (12×304.8 + 6.5×25.4).

### User Flows
- N/A (library code).

## 5. Reliability [Azure WAF]
- N/A — pure function library. No runtime dependencies.

## 6. Security [Azure WAF]
- **Input validation:** `parseLength` is the primary parser — must reject any input that isn't a number-and-optional-unit-suffix. Must NOT use `eval` or dynamic code. Regex-based.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A — pure module.

## 9. Performance Efficiency [Azure WAF]
- Parse/format latency < 1 µs per call on reference hardware (unit test assertion optional; not a critical path).

## 10. Accessibility [WCAG 2.2]
- N/A — no UI. Formatted strings will be consumed by UI components (S13) that own accessibility.

## 11. API & Data Contracts
- The TypeScript signatures above are the contract.

## 12. Data Model & Storage
- N/A.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** none. Pure TS.
- **Risks:**
  - Float drift on imperial round-trip → mitigated by rounding to 1 mm on parse; AC7 property test enforces round-trip stability.
  - Locale-specific decimal separator (e.g., `"3,5 m"` vs. `"3.5 m"`) → MVP scope decision: accept `.` only; document in code comment. Reject `,` with clear error.

## 16. Out of Scope
- Any UI representation.
- Any conversion for angles, weights, or areas — only lengths for MVP.
- Locale-aware parsing (comma-decimal, unit abbreviations in other languages).
- Fractional imperial output finer than 1/16 inch.

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Canonical imperial display style: `"12′ 6″"` (prime marks) vs. `"12'-6\""` (dashed quotes) vs. `"12 ft 6 in"` — implementer picks and documents in code comment; must be consistent app-wide. Decision does not block the story.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Brand types (`Length<'mm'>`) vs. plain `number` alias | Compile-time safety | Simplicity | **B** | Code Review Guardian answer B: brand types are not worth the ceremony in a mm-only domain; centralize conversion instead. |
| Round-to-1mm vs. store as rational | Simplicity | Lossless | **1 mm** | Human measurement precision. Lossless adds cost for zero UX benefit. |

## 18. Testing Strategy
- **Unit tests:** all ACs above, one Vitest file `units.test.ts`.
- **Property tests:** AC7 round-trip with `fast-check` — arbitrary `Mm` in `[0, 100_000]`, both systems, tolerance ±1 mm.
- **Integration / E2E:** N/A.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify the "no magic numbers outside units.ts" discipline is enforced | PR review |
