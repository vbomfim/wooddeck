# [S8] State — Zustand stores (design with `zundo` + UI)

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/8-state-stores` (off `feat/mvp-deck-designer`)
**Depends on:** S3, S4, S5, S6, S7

## 1. User Story

As **every React component in the app**,
I want **two Zustand stores — one owning the canonical `DesignBundle` (design + layout + warnings) with `zundo` middleware for future undo/redo, and one owning transient UI state (camera preset, layer visibility, unit-display mode)**,
so that **saved `.deck` files never accidentally serialize UI state, and undo/redo scaffolding is in place from day one**.

**Success metrics:** design store contains ONLY design + derived data; UI store contains ONLY view state; autosave to localStorage fires on debounced design changes; `.deck` download serializes only `design` (not UI state); `zundo` middleware wraps the design store and offers `undo()`/`redo()` methods (even if a UI surface for them ships in a later story).

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/state/design-store.ts` | Zustand store owning `DesignBundle`; actions wrap application use-cases; `zundo` middleware attached | New |
| `src/state/ui-store.ts` | Zustand store owning UI-only state (camera, layer visibility, unit mode) | New |
| `src/state/hooks.ts` | Typed selector hooks (e.g., `useDesign()`, `useLayout()`, `useWarnings()`, `useUiUnits()`) | New |
| `src/state/**/*.test.ts` | Store behavior tests | New |

**Boundary:** Two Zustand stores. Actions are thin — they call `application/*` use-cases and `set(...)` (per Code Review Guardian finding #1).
**File structure:** `src/state/`.

**Interface Contract:**

```ts
import type { DesignBundle } from "../application";
import type { DeckDesign } from "../domain/model";

// -------- design-store.ts --------
export interface DesignStoreState {
  bundle: DesignBundle;               // { design, layout, warnings }
  status: "idle" | "loading" | "error";
  lastError: Error | null;
}

export interface DesignStoreActions {
  loadFromFile(file: File): Promise<void>;
  loadFromLocalStorage(): void;
  applyParameters(patch: DeepPartial<DeckDesign>): void;
  downloadDeckFile(): void;
  reset(): void;
}

export const useDesignStore: UseBoundStore<StoreApi<DesignStoreState & DesignStoreActions>>;
// zundo attached — exposes .temporal.getState().undo() / .redo() / .clear()

// -------- ui-store.ts --------
export interface UiStoreState {
  units: "imperial" | "metric";
  cameraPreset: "orbit" | "top" | "front" | "side" | "iso";
  layerVisibility: {
    environment: boolean;
    decking: boolean;
    joists: boolean;
    beams: boolean;
    posts: boolean;
    footings: boolean;
  };
  disclaimerAcknowledged: false;      // frozen — never true. Kept as a boolean for future acknowledgement UX.
  storageBanner: null | "storage-full" | "storage-blocked";
}

export interface UiStoreActions {
  setUnits(units: "imperial" | "metric"): void;
  setCameraPreset(preset: UiStoreState["cameraPreset"]): void;
  toggleLayer(name: keyof UiStoreState["layerVisibility"]): void;
  showAllLayers(): void;
  hideAllLayers(): void;
  setStorageBanner(banner: UiStoreState["storageBanner"]): void;
}

export const useUiStore: UseBoundStore<StoreApi<UiStoreState & UiStoreActions>>;
```

**Autosave wiring (implemented in `design-store.ts`):**
- On every design mutation, debounced 500 ms, call `saveDesignToLocalStorage(bundle.design)` (from S6).
- On `DeckFileError { code: "storage-full" | "storage-blocked" }`, set `useUiStore.setState({ storageBanner: <code> })`.

**Dependencies:**
- Depends on: `application/*` (S7), `persistence/local-storage` (S6), `zustand`, `zundo`.
- Consumed by: `scene/*` (S9–S11), `ui/*` (S12–S15).
- Rule: `state/` MUST NOT import from `scene/`, `ui/`, or reach into Three.js. Actions contain no domain logic (that belongs in `application/`).

**Rewritability check:**
- [x] Rewritable from selector hooks + action signatures.
- [x] Consumers survive rewrite as long as `useDesignStore` / `useUiStore` hooks + selector hooks are preserved.
- [x] Design store owns `bundle`; UI store owns view state — disjoint.

## 3. Audience & Personas
- Primary: React component developers.
- Secondary: N/A.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Two stores, disjoint state**
- Given the app,
- Then `useDesignStore.getState()` contains only design + derived data + status; `useUiStore.getState()` contains only view state.
- Neither store references the other's slice.

**AC2: `zundo` attached to design store**
- Given the design store,
- Then `useDesignStore.temporal.getState().undo` and `.redo` are functions.
- After 3 `applyParameters` calls, `useDesignStore.temporal.getState().pastStates.length >= 3`.
- Calling `undo()` reverts to the previous design.

**AC3: Autosave debounced**
- Given a spy on `saveDesignToLocalStorage`,
- When `applyParameters` is called 5 times within 100 ms,
- Then `saveDesignToLocalStorage` is called at most **once** within 500 ms after the last call (debounce).

**AC4: `.deck` download omits UI state**
- Given the current design store,
- When `downloadDeckFile()` is triggered,
- Then the serialized file's `design` field contains no camera/layer/unit fields.

**AC5: Load from file replaces store state**
- Given a valid `.deck` file,
- When `loadFromFile(file)` resolves,
- Then `useDesignStore.getState().bundle` matches the file's design and its recomputed layout/warnings.

**AC6: Storage errors surfaced**
- Given `saveDesignToLocalStorage` rejects with `code: "storage-full"`,
- When autosave triggers,
- Then `useUiStore.getState().storageBanner === "storage-full"`.

**AC7: Unit switch is UI-only**
- Given `useUiStore.setUnits("metric")`,
- When called,
- Then `useDesignStore.getState().bundle.design` is unchanged (only display formatting is affected).

**AC8: Initial state**
- Given a fresh app load with no localStorage,
- Then `bundle` is initialized from a sensible default `DeckDesign` (e.g., 12 ft × 16 ft × 3 ft, 2×8 SPF #2 joists at 16", 5/4×6 PT decking).

### Edge Cases
- LocalStorage returns invalid JSON on load → design store falls back to default; UI store surfaces `storageBanner` (see AC6).
- User rapidly toggles units while typing → each keystroke updates through `parseLength` (S2) with the current UI unit; internal mm stays consistent.
- Undo across a file-load boundary → `zundo` clears history on file load (call `.temporal.getState().clear()` inside `loadFromFile`).

### User Flows
- N/A (library).

## 5. Reliability [Azure WAF]
- Store operations are synchronous (except `loadFromFile`); no external dependency to fail.
- On persistence failure, autosave disables until next mutation (avoids spamming errors); banner alerts user.

## 6. Security [Azure WAF]
- No new attack surface. Delegates all validation to `persistence/`.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- Selectors MUST be granular (`useDesignStore(s => s.bundle.layout)` etc.) to avoid unnecessary re-renders.
- `zundo` config: cap history to ≤ 50 entries (`limit: 50`) to bound memory.

## 10. Accessibility [WCAG 2.2]
- N/A (no UI in this ticket; the storage banner is rendered by S12).

## 11. API & Data Contracts
- TypeScript signatures above.

## 12. Data Model & Storage
- Design store owns `DesignBundle`; UI store owns `UiStoreState`.
- Persistence via `persistence/local-storage.ts` for the design only.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- Dev-mode console log of layout compute time on each `applyParameters` (behind `import.meta.env.DEV`).

## 15. Dependencies & Risks
- **Third-party:** `zustand`, `zundo`.
- **Risks:**
  - `zundo` bundle cost (~2 KB gz) is negligible.
  - Two-store discipline is convention-based; a developer could stuff camera state into the design store → mitigated by AC4 test + code-review checklist.
  - Autosave feedback loop (autosave triggers a store update triggers an autosave) → mitigated by only calling autosave in response to `applyParameters` / `loadFromFile` / `reset` actions, NOT from a subscription (avoids infinite loop).

## 16. Out of Scope
- UI for undo/redo (buttons, keyboard shortcuts) — deferred to a post-MVP polish story.
- Cross-tab synchronization.
- Server-side state.

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Undo/redo keyboard shortcuts (Cmd/Ctrl-Z) — MVP: not wired. State scaffold is ready; UI ships when a UX design lands.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Two stores vs. one store with slices | Cleaner separation | Simpler | **Two** | Code Review Guardian positive observation — prevents `.deck` files serializing UI state; enforces SoC. |
| `zundo` from day one vs. later | Small setup cost now | Big refactor later | **Day one** | Code Review Guardian finding #9 — cheap now; expensive to retrofit. |
| Debounce autosave 500 ms | Balanced | Immediate / lazy | **500 ms** | Feels instant while avoiding storage thrashing on drag-slider parameter changes. |

## 18. Testing Strategy
- **Unit tests:** all ACs above using `@testing-library/react` + `renderHook`.
- **Integration:** verify `applyParameters → autosave → localStorage → loadFromLocalStorage` round-trip with a real `localStorage` mock.
- **E2E:** deferred to UI stories.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify two-store disjointness (AC1) + `zundo` (finding #9) + boundary lint | PR review |
