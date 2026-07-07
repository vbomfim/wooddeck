# [S11] Scene — `WarningOverlay` independent of layer visibility

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/11-warning-overlay` (off `feat/mvp-deck-designer`)
**Depends on:** S3, S5, S8, S10

## 1. User Story

As **a DIY homeowner (P2 US3 "warn me if the deck won't hold")**,
I want **over-span joists and beams highlighted in the 3D view with an obvious visual indicator that remains visible even if I toggle the affected layer off**,
so that **structural warnings are never accidentally hidden by the "peel back the layers" UX**.

**Success metrics:** FR-015 (WarningOverlay draws its own decoration; visible regardless of layer state). Every `Warning` from `spanCheck` produces a visible highlight in the correct 3D position. Toggling the Joists layer off does NOT hide highlights for over-span joists.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/scene/WarningOverlay.tsx` | Reads `warnings` + `layout` from state; draws highlight decorations | New |
| `src/scene/highlights/OverSpanHighlight.tsx` | Reusable highlight primitive — a translucent red bounding box or wireframe outline | New |
| `src/scene/WarningOverlay.test.tsx` | Independence test + fixture-based rendering | New |

**Boundary:** Reads state. Draws its own meshes (wireframe / translucent box) at member positions. Does NOT reach into any layer component.
**File structure:** `src/scene/`.

**Interface Contract:**

```tsx
export function WarningOverlay(): JSX.Element;
```

- Selects `warnings = useDesignStore(s => s.bundle.warnings)` and `layoutMembers = useDesignStore(s => s.bundle.layout.members)`.
- For each warning, look up the corresponding `LayoutMember` by `warning.memberId` and render an `<OverSpanHighlight member={member} />`.
- The overlay is a top-level group inside `<DeckScene>`, mounted after all layer groups so highlights render on top.
- The overlay's visibility is optionally togglable via its own UI switch (`useUiStore.layerVisibility.warnings` — MVP: default ON, no toggle UI required, but the flag exists for future extensibility).

**Dependencies:**
- Depends on: `state/*` (S8), `domain/model.ts` types (S3), r3f, three.
- Consumed by: `DeckScene` (S9).
- Rule: MUST NOT import from any file under `scene/layers/`. The overlay is a peer, not a consumer, of layers (Code Review Guardian finding #7).

**Rewritability check:**
- [x] Rewritable from `Warning[]` + `Layout` + the "must remain visible" rule.
- [x] Consumers survive rewrite.
- [x] No state owned.

## 3. Audience & Personas
- Primary: DIY homeowner.
- Secondary: WarningsPanel (S14) which uses the same `warnings` list textually.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Highlight per warning**
- Given `warnings` contains 3 over-span joists,
- Then `<WarningOverlay>` renders 3 `<OverSpanHighlight>` decorations at the corresponding joist positions.

**AC2: Independent of layer visibility**
- Given a warning for a joist,
- When `useUiStore.toggleLayer("joists")` hides the Joists layer,
- Then the highlight for that joist REMAINS VISIBLE in the 3D view.

**AC3: Visible highlight style**
- The highlight MUST be one of: (a) a translucent red bounding box, (b) a red wireframe outline, (c) a red glow shader. Implementer picks one. Requirements:
  - Distinctly visible against decking, joists, and ground.
  - Uses a color with WCAG-adjacent contrast against typical wood tones (red on brown → sufficient).
  - Renders on top (`depthTest={false}` or renderOrder high) so it isn't occluded by the highlighted member.

**AC4: No highlights when no warnings**
- Given `warnings` is empty,
- Then `<WarningOverlay>` returns an empty group; no meshes created.

**AC5: Reactive to warning changes**
- Given the user changes parameters such that a joist that was over-span is now within limits,
- When the store updates,
- Then that joist's highlight disappears within one render tick.

**AC6: Highlight tooltip (optional but stretch)**
- Hovering a highlight in 3D shows a tooltip with the warning `message`. STRETCH — not required for MVP; if not implemented, warnings are shown in the WarningsPanel (S14) instead.

### Edge Cases
- Warning references a `memberId` that doesn't exist in the current layout (shouldn't happen; defensive) → skip that warning silently; log to dev console.
- Very many warnings (e.g., every joist over-span) → performance target: still 30+ FPS with up to 50 highlights on reference hardware.

### User Flows
- User picks a small joist / long span → highlights appear on joists → user checks the WarningsPanel for details.
- User hides Joists to see beams → joist highlights stay visible.

## 5. Reliability [Azure WAF]
- N/A — pure render.

## 6. Security [Azure WAF]
- N/A.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- Highlight meshes are small (one per warning); no perf concern up to ~50 warnings.

## 10. Accessibility [WCAG 2.2]
- The 3D highlight is a visual indicator; users who cannot see it rely on the WarningsPanel (S14) for the same information — that panel is the accessible surface. Documented in `docs/ARCHITECTURE.md`.

## 11. API & Data Contracts
- Component takes no props.

## 12. Data Model & Storage
- Reads `Warning[]` + `Layout.members`; owns nothing.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** none beyond S9's stack.
- **Risks:**
  - Sibling-reach into layer components → forbidden by AC2 test (visibility independence) + boundary lint (finding #7).
  - Depth-test tuning: highlights that render behind members are invisible; MVP uses `depthTest={false}` + high `renderOrder` for reliability.

## 16. Out of Scope
- Distinct highlight styles per warning severity (all warnings are the same level in MVP).
- Animated highlight (pulse, blink).
- Tooltip on hover (stretch — see AC6).

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Highlight style: bounding box, wireframe, or glow. Implementer picks based on visual clarity; documents choice in `docs/ARCHITECTURE.md`.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Overlay draws its own decoration vs. inject into layer components | Independent, testable | Reuses layer's mesh | **Independent** | Code Review Guardian finding #7 — required for AC2. |
| `depthTest={false}` (always on top) vs. proper depth | Always visible | Hidden behind opaque | **`depthTest={false}`** | Warnings must never be missed; visual jank is acceptable for reliability. |

## 18. Testing Strategy
- **Unit tests:** AC1 (highlight count matches warnings), AC2 (visibility independence — critical), AC4 (empty warnings), AC5 (reactive).
- **E2E (QA scope, later):** Playwright test: create an over-span design → assert highlight is visible → toggle Joists off → assert highlight is STILL visible.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify overlay independence (finding #7) — no imports from `scene/layers/` | PR review |
