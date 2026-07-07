# [S7] Application — use-case layer

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/7-application-usecases` (off `feat/mvp-deck-designer`)
**Depends on:** S3, S4, S5, S6

## 1. User Story

As **the state layer (S8) and any UI event handler that needs to compose domain + persistence**,
I want **a thin `application/` layer of use-case functions (`loadDesign`, `saveDesign`, `applyParameters`, `computeLayoutAndCheck`)**,
so that **multi-step orchestrations don't leak into Zustand actions ("god store") or UI handlers ("business logic in views")**.

**Success metrics:** every multi-step flow in the app (load → validate → compute layout → check spans → hand to state) is a single use-case call. Zustand action bodies (S8) are ≤ 3 lines each and only marshal use-case output into state.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/application/load-design.ts` | Parse + validate `.deck` file → `{ design, layout, warnings }` | New |
| `src/application/save-design.ts` | Serialize + trigger download OR autosave | New |
| `src/application/apply-parameters.ts` | Merge parameter change into `DeckDesign`; recompute layout + warnings | New |
| `src/application/compute-layout.ts` | Wrap `computeLayout` + `spanCheck` into one call returning `{ layout, warnings }` | New |
| `src/application/index.ts` | Barrel of use-case exports | New |
| `src/application/**/*.test.ts` | Unit tests with mocked persistence + real domain | New |

**Boundary:** Orchestration only. No domain logic. No React. No direct Three.js/DOM.
**File structure:** `src/application/`.

**Interface Contract:**

```ts
import type { DeckDesign, Layout, Warning } from "../domain/model";
import type { SpanTable } from "../domain/spans/span-table";

export interface DesignBundle {
  design: DeckDesign;
  layout: Layout;
  warnings: Warning[];
}

// -------- Load / Save --------
export async function loadDesignFromFile(file: File, table: SpanTable): Promise<DesignBundle>;
export function loadDesignFromLocalStorage(table: SpanTable): DesignBundle | null;
export function saveDesignToLocalStorage(design: DeckDesign): void;
export function downloadDesign(design: DeckDesign): void;

// -------- Parameter application --------
// Path-based partial patch. Recomputes layout + warnings.
// Example: applyParameters(current, { footprint: { widthMm: 3660 } }, table)
export function applyParameters(
  current: DeckDesign,
  patch: DeepPartial<DeckDesign>,
  table: SpanTable
): DesignBundle;

// -------- Compute --------
export function computeLayoutAndCheck(design: DeckDesign, table: SpanTable): { layout: Layout; warnings: Warning[] };
```

**Input contract:** `DeckDesign`, `File`, or a partial patch.
**Output contract:** `DesignBundle` (`{ design, layout, warnings }`) or a specific error type.
**Error contract:** propagates `DeckFileError` (S6) and `LayoutError` (S4) unchanged; adds `ApplyParametersError` for invalid patches.

**Dependencies:**
- Depends on: `domain/*` (S3–S5), `persistence/*` (S6).
- Consumed by: `state/*` (S8), a handful of UI event handlers where a direct call is simpler than a store action (e.g., PNG download in S14).
- Rule: `application/` MUST NOT import from `state/`, `scene/`, or `ui/`.

**Rewritability check:**
- [x] Rewritable from the interfaces + integration tests.
- [x] Consumers survive rewrite as long as `DesignBundle` shape + function names are preserved.
- [x] No state owned.

## 3. Audience & Personas
- Primary: state + UI developers.
- Secondary: N/A.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Compute pipeline**
- Given a valid `DeckDesign`,
- When `computeLayoutAndCheck(design, table)` is called,
- Then it returns `{ layout, warnings }` where `layout = computeLayout(design)` and `warnings = spanCheck(layout, table)`.

**AC2: Load from file happy path**
- Given a valid `.deck` v1 file,
- When `loadDesignFromFile(file, table)` resolves,
- Then it returns `{ design, layout, warnings }` where all three are consistent.

**AC3: Load from file rejects invalid**
- Given a `.deck` file with unknown schema,
- When `loadDesignFromFile` is called,
- Then it rejects with the `DeckFileError` from S6 unchanged.

**AC4: Apply parameters partial patch**
- Given a `DeckDesign` `D` and a patch `{ footprint: { widthMm: 4000 } }`,
- When `applyParameters(D, patch, table)` is called,
- Then it returns a `DesignBundle` where `bundle.design.footprint.widthMm === 4000`, other fields unchanged, and `layout`/`warnings` are recomputed.

**AC5: Apply parameters — unknown field rejected**
- Given a patch with an unknown key (e.g., `{ notARealKey: 42 }`),
- When `applyParameters` is called,
- Then it throws `ApplyParametersError` with the offending path in the message.

**AC6: Autosave**
- Given a design and a spy on `saveDesignToLocalStorage`,
- When invoked repeatedly with the same design,
- Then it succeeds without throwing on quota-OK cases; on quota-exceeded, it propagates `DeckFileError`.

**AC7: Zustand actions become one-liners**
- Given the state store from S8 (out of scope for this ticket to implement, but shape agreed here),
- Then each action in the design store body is ≤ 3 lines: call use-case, `set(...)`, return.

### Edge Cases
- Load from a file that has a valid schema but a `DeckDesign` whose `material` refs are absent from the catalog → propagate the `lookupMaterial` error from S3 (Layout can't be computed).
- Applying parameters that make the design invalid (e.g., width = 0) → propagate `LayoutError` from S4.

### User Flows
- N/A (library).

## 5. Reliability [Azure WAF]
- All failure modes surfaced as typed errors; caller (state store) decides UX.

## 6. Security [Azure WAF]
- Delegates to `persistence/` for input validation. Adds no new attack surface.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- `applyParameters` completes in ≤ 100 ms for standard decks (dominated by `computeLayout`).

## 10. Accessibility [WCAG 2.2]
- N/A.

## 11. API & Data Contracts
- TypeScript signatures above.

## 12. Data Model & Storage
- Consumes `DeckDesign`, produces `DesignBundle`. Persists through the persistence layer only.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** none.
- **Risks:**
  - Use-cases could grow into "God functions" if care isn't taken → each file has one exported top-level use-case; ≤ 40 lines each.
  - Circular dep between `application/` and `state/` (temptation to have use-cases read from a store) → forbidden by boundary lint (S1); use-cases take arguments, not read state.

## 16. Out of Scope
- Undo/redo orchestration (lives in the store via `zundo` — S8).
- Any UI concern (button handlers, toasts, prompts).

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Where does the singleton `SpanTable` instance live? — Options: (a) module-scope singleton in `application/`, (b) pass at every call site. Decision: (b) — explicit, testable, mockable per test. State store (S8) will hold the reference for the app lifetime.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Add an `application/` layer at all | Ceremony | Simpler | **A** | Code Review Guardian finding #1 (HIGH) — prevents god-store and biz-logic-in-views. |
| Return `DesignBundle` from use-cases | Wrapper type | Individual returns | **DesignBundle** | Every consumer needs all three (design + layout + warnings) together; single object simplifies calls. |

## 18. Testing Strategy
- **Unit tests:** all ACs above.
- **Integration tests:** compose real domain + mocked persistence to verify the load/save/apply flows end-to-end at this layer.
- **E2E:** deferred to UI stories.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify `application/` layer discipline (finding #1); use-cases are ≤ 40 lines; boundary lint passes | PR review |
