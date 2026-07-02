# [S9] Scene — `DeckScene` root `<Canvas>` + `CameraRig`

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/9-3d-scene-shell` (off `feat/mvp-deck-designer`)
**Depends on:** S1, S8

## 1. User Story

As **a DIY homeowner (P1 US1 "see what my deck will look like")**,
I want **a 3D viewer with free orbit / zoom / pan and preset views (Top, Front, Side, Iso)**,
so that **I can look at my planned deck from any angle**.

**Success metrics:** SC-003 (parameter change → re-render ≤ 500 ms p95); SC-009 (TTI ≤ 3 s). Preset view button transitions camera in ≤ 500 ms. Interactive frame rate ≥ 30 FPS during orbit on reference hardware.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/scene/DeckScene.tsx` | Root `<Canvas>` + lighting + `<CameraRig>` + layer group placeholders | New |
| `src/scene/CameraRig.tsx` | `OrbitControls` from `@react-three/drei` + preset-view transitions | New |
| `src/scene/lighting.tsx` | Ambient + directional + optional environment (from drei) | New |
| `src/scene/DeckScene.test.tsx` | Mount + snapshot the scene tree (r3f snapshots are structural, not visual) | New |

**Boundary:** Wraps the r3f `<Canvas>` and camera. Does NOT render deck members — layer components (S10) mount inside `DeckScene`.
**File structure:** `src/scene/`.

**Interface Contract:**

```tsx
// DeckScene.tsx
export interface DeckSceneProps {
  className?: string;
}
export function DeckScene(props: DeckSceneProps): JSX.Element;

// CameraRig.tsx
export interface CameraRigProps {
  preset: "orbit" | "top" | "front" | "side" | "iso";
  bounds: { widthMm: number; lengthMm: number; heightMm: number };  // used to fit camera
}
export function CameraRig(props: CameraRigProps): JSX.Element;
```

- The scene reads `bounds` from `useDesignStore(s => s.bundle.layout.bounds)` and passes them to `<CameraRig>`.
- The scene reads `preset` from `useUiStore(s => s.cameraPreset)`.
- Preset changes trigger a smooth camera lerp (≤ 500 ms) via drei's `CameraControls` or a `useFrame` interpolation.

**Dependencies:**
- Depends on: `state/*` (S8), `react-three-fiber`, `@react-three/drei`, `three`.
- Consumed by: `AppShell` (S12), which mounts `<DeckScene />` in the main content area.
- Rule: `scene/` MUST NOT import from `ui/`. State is read via the two Zustand hooks only.

**Rewritability check:**
- [x] Rewritable from the props + the "preset view fitting" behavior spec.
- [x] Consumers survive rewrite as long as `<DeckScene />` is a drop-in JSX element.
- [x] No state owned.

## 3. Audience & Personas
- Primary: DIY homeowner (indirectly, via the AppShell).
- Secondary: layer developers (S10, S11) who need the scene shell.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Canvas mounts**
- Given the app,
- When `<DeckScene />` is rendered,
- Then a `<Canvas>` mounts and the WebGL context is created without errors.

**AC2: Preset views**
- Given `useUiStore.setCameraPreset("top")`,
- When the store update propagates,
- Then the camera transitions to a top-down orthographic-style view over the current deck bounds within 500 ms.
- Same for `"front"`, `"side"`, `"iso"`. `"orbit"` returns to free orbit mode.

**AC3: Orbit / zoom / pan**
- Given the default `"orbit"` preset,
- When the user drags with LMB,
- Then the camera orbits.
- When the user scrolls,
- Then the camera zooms with reasonable min/max limits (min: half of the smallest deck dimension; max: 5× the largest).
- When the user drags with MMB / right-drag with modifier,
- Then the camera pans.

**AC4: Auto-fit on load**
- Given a design loads,
- When the layout `bounds` become known,
- Then the camera auto-fits so the entire deck is in view with ~15% margin.

**AC5: WebGL unsupported fallback**
- Given a browser without WebGL 2 (mocked),
- When `<DeckScene />` mounts,
- Then a fallback message displays: "Your browser does not support WebGL 2. Please upgrade to the latest Chrome, Edge, Firefox, or Safari."

**AC6: Interactive frame rate**
- Given a deck up to 20 × 30 ft (with all layers from S10 mounted as invisible groups),
- When the user orbits,
- Then frame rate ≥ 30 FPS on reference hardware (measured with a Vitest+jsdom smoke; real perf validated in QA E2E later).

### Edge Cases
- Very small deck (4 × 4 ft) → auto-fit still works with the 15% margin.
- Very large deck (40 × 40 ft) → camera zoom-out limits large enough to accommodate.
- Preset change during ongoing orbit → cancel the orbit gesture; complete the preset transition.

### User Flows
- Happy: user drags on canvas → orbits; clicks "Top" → snaps to top-down.

## 5. Reliability [Azure WAF]
- WebGL context loss (e.g., driver crash) → r3f emits `onContextLost`; log a console error; UI banner (S12) shows "3D view crashed — please reload."

## 6. Security [Azure WAF]
- N/A — no external I/O.

## 7. Cost Optimization [Azure WAF]
- Scene chunk MUST be code-split (`React.lazy` + `Suspense`) so the app shell loads without the ~500 KB r3f + three bundle blocking first paint.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- Target: 30+ FPS on M1 MacBook Air with a 20 × 30 ft deck at all layers visible (spec NFR-003).
- Lighting: 1 ambient + 1 directional (with soft shadows optional and off by default). Adding an env map from drei is nice-to-have but must not exceed the FPS budget.

## 10. Accessibility [WCAG 2.2]
- The `<canvas>` is inherently non-accessible to screen readers.
- The canvas element MUST have an accessible name (`aria-label="3D view of deck design; use arrow keys or WASD to orbit, +/- to zoom, or the preset view buttons in the toolbar"`).
- Keyboard-only orbit is a stretch goal (drei's `KeyboardControls` may cover this); MVP requirement: preset view buttons (S14) provide keyboard access to all view angles.

## 11. API & Data Contracts
- Props above.

## 12. Data Model & Storage
- Reads from Zustand stores; owns no data.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- Dev-mode: log camera preset changes to console.

## 15. Dependencies & Risks
- **Third-party:** `@react-three/fiber`, `@react-three/drei`, `three` (all pinned in S1).
- **Risks:**
  - r3f/drei API drift between minor versions → pin exact versions.
  - Shader-compile jank on first mount → mitigated by preloading a minimal cube in the scene shell (drei's `<Preload />`).
  - Canvas resize causes camera aspect drift → r3f handles this by default; verify in E2E.

## 16. Out of Scope
- Layer components (S10).
- Warning highlighting (S11).
- Interactive keyboard orbit (stretch — not required for MVP).
- Shadows / advanced lighting / post-processing.

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Orthographic vs. perspective for "Top" preset. MVP: orthographic-style perspective (very narrow FOV) for top view; documented in code.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Code-split scene chunk | Extra Suspense boundary | Simpler | **Split** | SC-009 TTI budget requires it; r3f + three is ~500 KB gz. |
| drei `OrbitControls` vs. `CameraControls` | Simpler, well-known | Smoother animations, cinematic | **OrbitControls + manual lerp for presets** | Battle-tested; preset transitions are simple enough to hand-code. |

## 18. Testing Strategy
- **Unit tests:** mount snapshot; verify props flow to `<CameraRig>`; mock r3f `<Canvas>` in jsdom (r3f exports a test-friendly stub).
- **E2E (QA scope, later):** Playwright test that clicks preset buttons and verifies the canvas pixels change (via `browser_take_screenshot` comparison, tolerance-based).

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify `scene/` → `state/` boundary; no `ui/` imports | PR review |
| QA Guardian | Approve E2E camera-preset test plan | before merge |
