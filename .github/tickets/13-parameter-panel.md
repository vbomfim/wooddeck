# [S13] UI — `ParameterPanel` + runtime unit switcher

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/13-parameter-panel` (off `feat/mvp-deck-designer`)
**Depends on:** S2, S3, S7, S8, S12

## 1. User Story

As **a DIY homeowner (P1 US1 "see what my deck will look like")**,
I want **a side panel with fields for width, length, height, joist spacing, joist size, decking board size, and species/material, plus a toggle to switch between imperial and metric display**,
so that **I can enter my dimensions in the units I think in, and see the 3D deck update immediately as I adjust**.

**Success metrics:** every parameter in `DeckDesign` has a control. Editing any control triggers `useDesignStore.applyParameters` and the 3D view updates within 500 ms (SC-003). Unit switch changes display only, never the stored value.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/ui/ParameterPanel.tsx` | Container; renders labelled fields; wires store | New |
| `src/ui/fields/LengthField.tsx` | Numeric input + unit suffix; parses/formats via `units.ts` | New |
| `src/ui/fields/SelectField.tsx` | Generic labelled select (species, grade, board SKU) | New |
| `src/ui/UnitSwitcher.tsx` | Toggle: imperial ↔ metric | New |
| `src/ui/ParameterPanel.test.tsx` | Field wiring + unit-switch tests | New |

**Boundary:** All parameter editing happens here. Reads `bundle.design` from store; calls `applyParameters` on change.
**File structure:** `src/ui/`.

**Interface Contract:**

```tsx
export function ParameterPanel(): JSX.Element;

export interface LengthFieldProps {
  label: string;
  mmValue: number;              // canonical mm
  system: "imperial" | "metric";
  min?: number;
  max?: number;
  onChangeMm(mm: number): void; // only fires on valid parse
  hint?: string;                // e.g., "16 in o.c. is a common choice"
}
export function LengthField(props: LengthFieldProps): JSX.Element;

export function UnitSwitcher(): JSX.Element;
```

**Fields rendered:**

| Field | Store path | Notes |
|---|---|---|
| Width | `design.footprint.widthMm` | LengthField, min 1220 mm (4 ft) |
| Length | `design.footprint.lengthMm` | LengthField, min 1220 mm |
| Height (top of decking to ground) | `design.footprint.heightMm` | LengthField, min 0, max ~3050 mm (10 ft) |
| Joist spacing | `design.joist.spacingMm` | LengthField, common values as hints: 305 (12″), 406 (16″), 610 (24″) |
| Joist size | `design.joist.material.nominal` | SelectField, options: 2×6, 2×8, 2×10, 2×12 |
| Beam size | `design.beam.material.nominal` | SelectField, options: 2×8, 2×10, 2×12 |
| Post size | `design.post.material.nominal` | SelectField, options: 4×4, 6×6 |
| Decking board | `design.decking.material.nominal` | SelectField, options: 5/4×6, 2×6 |
| Species | `design.joist.material.species` (broadcast to all members) | SelectField, options: PT, Cedar, Composite |
| Grade | `design.joist.material.grade` | SelectField, options: No1, No2, Select, NA — greyed out if species is Composite |
| Decking orientation | `design.decking.orientation` | SelectField, options: parallel-to-length, parallel-to-width |

**Dependencies:**
- Depends on: `state/*` (S8), `application/apply-parameters` (S7), `domain/units` (S2), `domain/model + materials-catalog` (S3).
- Consumed by: `AppShell.leftPanel` (S12).
- Rule: MUST NOT import from `scene/`, `persistence/`, or `domain/layout/*`.

**Rewritability check:**
- [x] Rewritable from the field list + store contract.
- [x] Consumers survive rewrite as long as `<ParameterPanel />` is a self-contained JSX element.
- [x] No state owned beyond in-flight input strings (see AC3).

## 3. Audience & Personas
- Primary: DIY homeowner.
- Secondary: WCAG 2.2 AA screen-reader user.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: All fields render**
- Given `<ParameterPanel />` mounted with a default design,
- Then every field in the table above is present with the current value formatted in the current display unit.

**AC2: Editing a length field updates the store**
- Given the Width field showing "12′ 0″" (imperial),
- When the user types "16" and blurs (or hits Enter),
- Then `useDesignStore.getState().bundle.design.footprint.widthMm === 4877` (16 × 304.8, rounded).

**AC3: In-flight input while typing**
- Given a length field,
- When the user is mid-typing (e.g., "12.5" — partial),
- Then the field's display value shows the raw string; the store update fires only on blur or Enter (not on every keystroke).
- Rationale: prevents constant recomputation while typing.

**AC4: Invalid input surfaced inline**
- Given a length field,
- When the user enters "twelve feet",
- Then an inline error message appears ("Enter a number, optionally with units — e.g., 12 or 12 ft") and the store is NOT updated.

**AC5: Unit switch is display-only**
- Given the Width field showing "12′ 0″" in imperial mode with mm-value 3658,
- When the user clicks the UnitSwitcher to metric,
- Then the field shows "3.66 m" (or the appropriate format) and `useDesignStore.getState().bundle.design.footprint.widthMm` is UNCHANGED (still 3658).

**AC6: Composite grade lock**
- Given species is switched to "Composite",
- Then the Grade select disables and its value becomes "NA".

**AC7: Species propagation**
- Given the user changes species from PT to Cedar,
- Then joist, beam, and post materials all update to Cedar. (Decking species is independent.)

**AC8: Latency**
- Given a value change,
- Then the 3D view (via S9/S10) reflects the change within 500 ms p95 (SC-003 — end-to-end includes S7 compute).

### Edge Cases
- Minimum-clamp: entering 1 ft (< 4 ft min) → clamp to 4 ft with an inline hint.
- Maximum-clamp: entering 100 ft (> soft max of 40 ft) → clamp with hint.
- Unit switch while a field is mid-edit → discard the in-flight string and re-format from the canonical mm.
- Selects blocked on an invalid combination (e.g., 4×4 post + Composite) → filter options via the catalog.

### User Flows
- Happy: user tabs through fields, types values, sees the 3D update after each blur.
- Unit switch: user clicks the toggle → every field re-formats.

## 5. Reliability [Azure WAF]
- On store update failure (e.g., `applyParameters` throws), the panel shows an inline error and keeps the previous field value.

## 6. Security [Azure WAF]
- All inputs are validated by `parseLength` (S2) and the domain's `applyParameters` (S7). No `eval`. No `dangerouslySetInnerHTML`.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- Debounce field commits to on-blur/on-Enter (AC3) — avoids O(keystrokes) layout recomputes.
- Store selectors are granular; the panel does not re-render when unrelated store slices change.

## 10. Accessibility [WCAG 2.2]
- Every field has an associated `<label>`.
- Focus visible.
- Inline error linked to the field via `aria-describedby`.
- UnitSwitcher is a two-state button with `aria-pressed`.
- Contrast: 4.5:1 for all field text.
- Keyboard-only: Tab through fields; Enter commits.

## 11. API & Data Contracts
- Props above.

## 12. Data Model & Storage
- Reads `bundle.design`; writes via `applyParameters`. Owns no persistent state.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** none new.
- **Risks:**
  - Real-time vs. blur commits: users may expect drag-slider live update. MVP: blur commits (AC3). If UX feedback demands live update later, add a debounced live-update mode behind a config flag.
  - Field validation drift from domain — mitigated by delegating parse/format to `units.ts` and lookup to `materials-catalog.ts`.

## 16. Out of Scope
- Drag-slider parameter editing (v2+).
- Parameter presets / templates ("small deck", "large deck").
- 2D drag-to-resize on the plan view (defer to S15's future work).
- Multi-select of species per member type.

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Whether "Species" is one control (broadcast) or three (joist / beam / post independent). MVP: **one control** (broadcast), because most DIY decks use one species throughout. Decking species can differ (composite deck on wood frame is common).

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Commit on-blur vs. on-every-keystroke | Cheap, no jitter | Live update | **A** | Prevents O(keystrokes) recomputes; UX-tested pattern. |
| One species control (broadcast) vs. per-member | Simple | Flexible | **Broadcast** | Matches DIY reality; simpler UI. Per-member species can ship later. |

## 18. Testing Strategy
- **Unit tests:** all ACs.
- **A11y test:** run axe-core on the mounted panel.
- **Integration:** mock `applyParameters`; assert it's called with the right patch on each field change.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify unit switch never touches design store (AC5) | PR review |
| QA Guardian | Approve field-input edge cases + E2E parameter flow | PR review |
