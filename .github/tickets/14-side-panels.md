# [S14] UI — `LayerTogglePanel` + `WarningsPanel` + `BomPanel` + `ExportMenu`

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/14-side-panels` (off `feat/mvp-deck-designer`)
**Depends on:** S3, S5, S7, S8, S10, S11, S12

## 1. User Story

As **a DIY homeowner**,
I want **a right-hand side panel with (a) six layer visibility toggles, (b) the list of structural warnings, (c) the bill of materials, and (d) an export menu with Save-to-storage / Download `.deck` / Open… / Export PNG buttons**,
so that **I can control what I see in 3D, understand what's wrong, plan my shopping trip, and get my work out of the app**.

**Success metrics:** every P2/P3 acceptance criterion for save/load, warnings, and BOM is met. Preset camera view buttons (Top / Front / Side / Iso / Orbit) also live here. Layer toggle response ≤ 100 ms (SC-002).

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/ui/LayerTogglePanel.tsx` | Six toggles bound to `useUiStore.layerVisibility` + camera preset buttons | New |
| `src/ui/WarningsPanel.tsx` | List of warnings from `useDesignStore(s => s.bundle.warnings)` | New |
| `src/ui/BomPanel.tsx` | Bill of materials derived from `useDesignStore(s => s.bundle.layout)` | New |
| `src/ui/ExportMenu.tsx` | Buttons: Download .deck, Open…, Export PNG, Reset | New |
| `src/ui/bom/derive-bom.ts` | Pure function `(layout) → BomLines[]` — TESTABLE | New |
| `src/ui/side-panels.test.tsx` | Integration test wiring all four panels | New |

**Boundary:** UI concerns only. Business logic (BOM derivation) is a pure function so it can be unit-tested.
**File structure:** `src/ui/`.

**Interface Contract:**

```tsx
export function LayerTogglePanel(): JSX.Element;
export function WarningsPanel(): JSX.Element;
export function BomPanel(): JSX.Element;
export function ExportMenu(): JSX.Element;

// derive-bom.ts
export interface BomLine {
  kind: "joist" | "beam" | "post" | "footing" | "board";
  nominal: string;                 // "2x8"
  species: string;                 // "PT"
  count: number;
  eachLengthMm?: number;           // for members with a length dimension
  totalLinearMm?: number;          // sum of lengths for boards
}
export function deriveBom(layout: Layout): BomLine[];
```

**Panel contents:**

- **LayerTogglePanel:** 6 checkbox toggles (Environment, Decking, Joists, Beams, Posts, Footings); a "Show all" / "Hide all" pair; 5 preset view buttons (Orbit / Top / Front / Side / Iso).
- **WarningsPanel:** heading "Warnings" with count badge; if zero warnings, a green "No warnings — spans within IRC-2018 limits" message; otherwise a `<ul>` of `Warning.message` items, each with the member kind + nominal + span vs. allowable, and the `Warning.tableReference` citation.
- **BomPanel:** heading "Bill of Materials" + a table (kind / nominal / species / count / each length / total linear ft or m — respecting the UI unit).
- **ExportMenu:** four buttons — "Download .deck," "Open .deck…" (hidden `<input type="file">`), "Export PNG," "Reset to defaults" (with confirm).

**Dependencies:**
- Depends on: `state/*` (S8), `application/*` (S7), `persistence/screenshot` (see this ticket's scope note), `domain/units` (S2).
- Consumed by: `AppShell.rightPanel` (S12).
- Rule: standard UI-layer boundary rules.

**Note on PNG screenshot:** the screenshot function `renderer.domElement.toDataURL("image/png")` requires access to the r3f `WebGLRenderer`. The implementation lives in `src/persistence/screenshot.ts` and takes a `HTMLCanvasElement` argument. The `ExportMenu` calls it with the canvas element found via `document.querySelector("canvas.wooddeck-canvas")` OR via a ref exported from `DeckScene` (S9). Implementer's choice — document in code.

**Rewritability check:**
- [x] Each panel is independently rewritable.
- [x] BOM derivation is testable in isolation.
- [x] No shared state beyond stores.

## 3. Audience & Personas
- Primary: DIY homeowner.
- Secondary: WCAG 2.2 AA screen-reader user.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Six toggles**
- Given `<LayerTogglePanel />`,
- Then six checkboxes render, each labelled with the layer name and initial state = checked (all visible).
- Clicking a checkbox toggles the corresponding `useUiStore.layerVisibility[<name>]`.

**AC2: Show all / Hide all**
- Clicking "Hide all" sets every layer visibility to false; "Show all" sets every layer to true.

**AC3: Preset view buttons**
- Clicking any of the five preset buttons calls `useUiStore.setCameraPreset(<value>)`. `CameraRig` (S9) picks up the change.

**AC4: Warnings — none**
- Given `warnings = []`,
- Then `<WarningsPanel />` shows the green "no warnings" message.

**AC5: Warnings — present**
- Given `warnings` has entries,
- Then a list renders with one item per warning; each item shows the human message + citation (`tableReference`).

**AC6: BOM derivation is correct**
- Given a golden fixture layout with 10 joists (all 2×8 SPF, each 3658 mm long) + 2 beams + 4 posts + 4 footings + 30 boards (all 5/4×6 PT, each 3658 mm long),
- When `deriveBom(layout)` is called,
- Then the returned lines exactly match a golden JSON fixture (test uses `toMatchSnapshot` or explicit equality).

**AC7: BOM units respect UI unit**
- Given `useUiStore.units === "imperial"`,
- Then the BOM panel shows "12′ 0″" per board and total linear feet.
- Given `useUiStore.units === "metric"`,
- Then the panel shows meters.
- Values in the store never change.

**AC8: Download .deck**
- Given a design,
- When the user clicks "Download .deck,"
- Then a file download is triggered via `application/save-design.downloadDeckFile()` (S7).

**AC9: Open .deck…**
- Given a hidden `<input type="file" accept=".deck.json,application/json">`,
- When the user selects a valid `.deck` file,
- Then `useDesignStore.loadFromFile(file)` (S8) is invoked; on error, an inline error message appears in the ExportMenu.

**AC10: Export PNG**
- Given the 3D canvas is rendered,
- When the user clicks "Export PNG,"
- Then a PNG file downloads named `wooddeck-{timestamp}.png`.

**AC11: Reset with confirm**
- Given the user clicks "Reset to defaults,"
- Then a confirm dialog (`window.confirm`) fires; on OK, `useDesignStore.reset()` runs; on Cancel, nothing happens.

**AC12: Latency**
- Layer toggle click → visible change ≤ 100 ms (SC-002; layered on top of S10's guarantee).

### Edge Cases
- Load an invalid `.deck` file → `DeckFileError.code` is displayed as a user-friendly message; store state remains unchanged.
- PNG export when the canvas has zero size (window minimized) → shows an error toast.
- BOM with an empty layout (invalid state) → panel shows "Empty layout — check your parameters."

### User Flows
- Save flow: click Download → OS save dialog.
- Load flow: click Open → OS file picker → design loads.
- Screenshot flow: adjust camera → click Export PNG → file downloads.

## 5. Reliability [Azure WAF]
- All file operations catch `DeckFileError` and render inline error messages.

## 6. Security [Azure WAF]
- File `<input>` accepts only `.deck.json` and `application/json` mime types (client-side hint only; real validation is by S6's `readDeckFile`).
- No `dangerouslySetInnerHTML`.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- BOM derivation is memoized on `Layout` reference (Zustand + selector).

## 10. Accessibility [WCAG 2.2]
- All checkboxes and buttons have `<label>` and `aria-label`.
- Warnings list is announced to screen readers as a `<section aria-labelledby="warnings-heading" role="region">`.
- BOM table has proper `<th scope>` on header row/column.
- ExportMenu buttons have visible focus; the hidden file input is triggered via a visible button (`<label htmlFor>` pattern).

## 11. API & Data Contracts
- Props / functions above.

## 12. Data Model & Storage
- Reads from stores; writes via store actions and use-cases.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** none new.
- **Risks:**
  - Screenshot resolution equals canvas resolution — may be lower than desired for print. MVP: canvas-resolution PNG. If insufficient, a "high-res" mode (2× or 4× render-to-texture) can ship later.
  - PNG export via `toDataURL` requires the WebGL context to have `preserveDrawingBuffer: true` OR the screenshot must be taken inside a `useFrame` callback. Implementer confirms with r3f `<Canvas gl={{ preserveDrawingBuffer: true }}>`.

## 16. Out of Scope
- CSV export of BOM (nice-to-have; separate story).
- PDF export of the deck design.
- Cost calculations in the BOM.
- Cut-list optimization.
- Multiple concurrent designs / project management.

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Preset view buttons: place in LayerTogglePanel or in a separate viewport toolbar? MVP: in LayerTogglePanel to consolidate all view-controls in one panel; can move later.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| PNG at canvas res vs. high-res | Simple | Print-quality | **A** | MVP scope; high-res is an easy follow-up. |
| Confirm on Reset | Prevents data loss | Extra click | **Confirm** | Design is autosaved but the confirm still helps user intent. |

## 18. Testing Strategy
- **Unit tests:** all ACs — mock stores where needed.
- **BOM tests:** golden fixtures for `deriveBom`.
- **A11y test:** axe-core on each panel.
- **E2E (QA scope, later):** Playwright — click download, verify a file gets downloaded (via `browser.on("download", ...)`).

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify BOM derivation is pure & testable; screenshot boundary correctness | PR review |
| QA Guardian | Approve E2E download/upload/PNG flows | before merge |
| Security Guardian | Verify file input restrictions + reliance on `readDeckFile` validation | PR review |
