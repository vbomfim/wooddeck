# [S15] UI — read-only 2D top-down plan view

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/15-2d-plan-view` (off `feat/mvp-deck-designer`)
**Depends on:** S3, S4, S8, S12

## 1. User Story

As **a DIY homeowner (P1 US1 supporting outcome)**,
I want **a read-only 2D top-down plan view of my deck showing footprint dimensions, joist positions, beam positions, and post locations**,
so that **I can see the layout with true dimensions and use it as a reference alongside the 3D view — the way a real deck plan looks on paper**.

**Success metrics:** the 2D plan renders every member from `Layout` in scaled top-down projection. Deck footprint dimensions are labelled. Joist spacing is visible. WCAG 2.2 AA compliant (labels have text alternatives via a description block).

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/ui/PlanView2D.tsx` | SVG-based top-down plan; consumes `Layout` | New |
| `src/ui/PlanView2D.helpers.ts` | Pure functions: `computeSvgViewBox`, `mmToSvg` | New |
| `src/ui/PlanView2D.test.tsx` | Snapshot + dimension-label tests | New |

**Boundary:** Read-only. No interaction beyond hover-for-dimension. Reads `bundle.layout` from store.
**File structure:** `src/ui/`.

**Interface Contract:**

```tsx
export interface PlanView2DProps {
  maxHeightPx?: number;   // default: 400
}
export function PlanView2D(props: PlanView2DProps): JSX.Element;
```

- Uses inline SVG (no external SVG lib) to keep the dependency footprint small.
- Coordinate system: origin bottom-left of the footprint, x = width, y = length.
- Scales `Layout.bounds` to fit within the given `maxHeightPx`, preserving aspect ratio.
- Draws: footprint outline (thick border), decking board hint strokes (subtle), joist positions (medium strokes perpendicular to boards), beam positions (thick strokes), post locations (dots/circles), dimension labels for width and length.

**Dependencies:**
- Depends on: `state/*` (S8), `domain/units` (S2), `domain/model` types (S3).
- Consumed by: `AppShell` (S12) — decision on placement made at implementation time (below the 3D view, or as a toggle on top of the panels).
- Rule: standard UI-layer boundary rules.

**Rewritability check:**
- [x] Rewritable from Layout type + the dimension labeling rules.
- [x] Consumers survive rewrite; pure prop `<PlanView2D />`.
- [x] No state owned.

## 3. Audience & Personas
- Primary: DIY homeowner.
- Secondary: WCAG 2.2 AA screen-reader user (needs text description of the plan).

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Renders footprint outline**
- Given a layout with `bounds = { widthMm: 3658, lengthMm: 4877, ... }`,
- Then the SVG shows a scaled rectangle labelled with those dimensions in the current UI unit ("12′ 0″" × "16′ 0″" or "3.66 m × 4.88 m").

**AC2: Renders joists / beams / posts**
- Given a layout with N joists, 2 beams, and P posts,
- Then the SVG contains N joist strokes, 2 beam strokes, and P post circles at correct positions.

**AC3: Aspect ratio preserved**
- Given the SVG's `viewBox` and `preserveAspectRatio="xMidYMid meet"`,
- Then the plan is not distorted regardless of container width/height.

**AC4: Unit switch reflects immediately**
- Given `useUiStore.units === "metric"`,
- When switched to "imperial",
- Then dimension labels re-format instantly.

**AC5: Screen-reader description**
- The SVG includes `<title>Top-down 2D plan of deck</title>` and `<desc>Deck footprint: {width} by {length}. {N} joists at {spacing} on-center. {P} posts.</desc>` (i18n note: MVP is English-only).

**AC6: Empty layout**
- Given `layout.members = []` (defensive),
- Then the panel shows "Enter dimensions to see the plan" with no crash.

**AC7: Layout is read-only in MVP**
- No click, drag, or context-menu handlers. Hover may show a tooltip with member kind + nominal (stretch, not required).

### Edge Cases
- Very wide aspect ratio (40 ft × 8 ft) → still fits with letterboxing.
- Very small dimensions → labels don't overlap; may position outside the rectangle if the interior is too small.

### User Flows
- User glances at 2D plan while adjusting parameters → sees the plan update alongside the 3D view.

## 5. Reliability [Azure WAF]
- N/A — pure render.

## 6. Security [Azure WAF]
- N/A.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- SVG re-render is cheap; no perf concern for up to ~500 members.

## 10. Accessibility [WCAG 2.2]
- SVG has `<title>` and `<desc>` (AC5) so screen readers describe the plan.
- Colors chosen with sufficient contrast; do not encode information by color alone (line thickness distinguishes joists vs. beams).

## 11. API & Data Contracts
- Prop above.

## 12. Data Model & Storage
- Reads `bundle.layout`; owns nothing.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** none.
- **Risks:**
  - Label collisions on small viewports → mitigated by a min-height (400 px) and letterboxing.
  - Diverging visual style from 3D (colors don't match) → intentional (2D is monochrome/schematic); documented.

## 16. Out of Scope
- 2D drag-to-edit (v2+).
- Snap-to-grid / dimension entry via 2D handles (v2+).
- Print / PDF export of the plan (v2+).
- Full plan-view interactivity (hover tooltips, click-to-select).

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Panel placement: fixed slot below the 3D view, or user-togglable overlay? — MVP: fixed slot inside the right panel (below the ExportMenu), collapsible. Decision does not block story.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Inline SVG vs. Konva/D3 | Zero dep, simple | Rich interactions | **A** | MVP is read-only; SVG is enough. Konva/D3 can be considered for v2 authoring. |
| Read-only vs. minimal edit | Simple | Better authoring UX | **Read-only** | Per user's answer E15 defaults; edits happen in the parameter panel. |

## 18. Testing Strategy
- **Unit tests:** all ACs — snapshot the SVG structure; assert label text matches formatted dimensions.
- **A11y test:** axe-core on the panel; verify `<title>`/`<desc>` are present.
- **E2E:** deferred until interactive edits are added.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify no domain logic leaks into SVG helpers (`mmToSvg` is pure) | PR review |
| QA Guardian | Approve label-text expectations under both unit modes | PR review |
