# [S10] Scene — six layer components with visibility via `<group visible>`

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/10-scene-layers` (off `feat/mvp-deck-designer`)
**Depends on:** S3, S4, S8, S9

## 1. User Story

As **a DIY homeowner (P1 US2 "peel back the layers")**,
I want **the deck rendered as six independently-toggleable 3D layers (Environment/Ground, Decking, Joists, Beams, Posts, Footings)**,
so that **I can hide the top boards and see the framing underneath — the differentiating UX of the product**.

**Success metrics:** SC-002 (layer toggle ≤ 100 ms, no shader recompile). Every structural member from `Layout` renders as its own mesh with correct position and size. Toggling any layer changes only the Three.js `visible` flag on a group — no remount, no GPU handle churn (Code Review Guardian finding #6).

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/scene/layers/EnvironmentLayer.tsx` | Ground plane + subtle grid + optional sky | New |
| `src/scene/layers/DeckingLayer.tsx` | Decking board meshes from `Layout.members` where `kind === "board"` | New |
| `src/scene/layers/JoistsLayer.tsx` | Joist meshes | New |
| `src/scene/layers/BeamsLayer.tsx` | Beam meshes | New |
| `src/scene/layers/PostsLayer.tsx` | Post meshes | New |
| `src/scene/layers/FootingsLayer.tsx` | Footing meshes (short cylinders or cubes) | New |
| `src/scene/layers/shared/BoxMember.tsx` | Reusable `<mesh>` for a rectangular member (given a `LayoutMember`) | New |
| `src/scene/layers/shared/materials.ts` | Shared `MeshStandardMaterial` instances per material type (memoized) | New |
| `src/scene/layers/**/*.test.tsx` | Snapshot tests + visibility-toggle tests | New |

**Boundary:** Each layer component reads its slice of the `Layout` from state and renders those members. Each mounts UNCONDITIONALLY inside `<DeckScene>`; visibility is a `<group visible={...}>` prop bound to `useUiStore(s => s.layerVisibility[<layerName>])`.
**File structure:** `src/scene/layers/`.

**Interface Contract:**

```tsx
export function EnvironmentLayer(): JSX.Element;
export function DeckingLayer(): JSX.Element;
export function JoistsLayer(): JSX.Element;
export function BeamsLayer(): JSX.Element;
export function PostsLayer(): JSX.Element;
export function FootingsLayer(): JSX.Element;
```

Each layer:
1. Selects its subset of `Layout.members` (e.g., `useDesignStore(s => s.bundle.layout.members.filter(m => m.kind === "joist"))`).
2. Reads its visibility flag (`useUiStore(s => s.layerVisibility.joists)`).
3. Returns `<group visible={visible}>{ members.map(m => <BoxMember key={m.id} member={m} />) }</group>`.

Layers perform ZERO geometry math — they only translate `LayoutMember.position` and `.size` into `<mesh position={...} scale={...}>`. Code Review Guardian finding #3 is enforced.

**Dependencies:**
- Depends on: `state/*` (S8), `domain/model.ts` types (S3), r3f, three.
- Consumed by: `DeckScene` (S9), which mounts all six components in a fixed order.
- Rule: NO import from `ui/`, `application/`, `persistence/`, or `domain/layout/*` (layers consume the pre-computed `Layout` only).

**Rewritability check:**
- [x] Rewritable from `Layout` type + visibility flag hook.
- [x] Consumers survive rewrite as long as JSX identity + no-op-on-hide behavior are preserved.
- [x] No state owned.

## 3. Audience & Personas
- Primary: DIY homeowner.
- Secondary: WarningOverlay (S11) which draws its own decoration but references `Layout` in the same way.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: All six layers mount**
- Given `<DeckScene />` mounts with a valid layout,
- Then all six layer components mount and their Three.js groups exist in the scene graph.

**AC2: Members rendered from `Layout`**
- Given a layout with N joists,
- When `<JoistsLayer />` renders,
- Then exactly N `<mesh>` elements are created inside the JoistsLayer group; each mesh's position matches the joist's `position` (in mm scaled to Three.js units — see AC7) and its scale matches `size`.

**AC3: Visibility via `<group visible>` — no remount**
- Given `useUiStore.toggleLayer("joists")` twice,
- When measured with a Vitest-level spy on `React.Fragment` mount/unmount,
- Then the mesh components DO NOT remount — only the Three.js `Object3D.visible` flag flips (Code Review Guardian finding #6).

**AC4: Layer toggle latency**
- Given all layers rendered,
- When the user toggles a layer,
- Then the visible/hidden change is applied within 100 ms (SC-002; measured with `performance.now()`).

**AC5: Environment layer**
- Given `<EnvironmentLayer />`,
- Then it renders: a ground plane at `z = 0` (sized larger than any deck footprint), a subtle grid on the ground, and (optional) a solid or gradient sky-blue background.

**AC6: Materials per species**
- Given joists with material `{species: "PT"}` vs. `{species: "Cedar"}`,
- Then their rendered meshes use different base colors (PT: greenish-brown; Cedar: reddish-brown; Composite: gray). Colors are documented in `materials.ts`.

**AC7: mm → Three.js unit scale**
- The scene uses 1 Three.js unit = 1 mm. This is the simplest option and avoids off-by-scale bugs. Documented in `docs/ARCHITECTURE.md` and a code comment at the top of `DeckScene.tsx`.

**AC8: Layer order preserves picking**
- Given layers stacked (footings on bottom, decking on top),
- Then a raycaster at the top-of-deck z-plane hits decking first, then joists, etc. (Not user-facing in MVP but validates coordinate hygiene.)

### Edge Cases
- Layout with zero members (invalid state, but defensive) → each layer renders an empty group; no crash.
- Toggling a layer that is already visible/hidden → idempotent; no state change beyond the boolean flip.
- Very small member sizes (rare, but possible with unusual params) → meshes still render; not culled.

### User Flows
- User clicks the "Decking" toggle in the LayerTogglePanel (S14) → `useUiStore.toggleLayer("decking")` → DeckingLayer's group becomes invisible.

## 5. Reliability [Azure WAF]
- If `Layout` is null (loading state), each layer returns `null` gracefully; no crash.

## 6. Security [Azure WAF]
- N/A.

## 7. Cost Optimization [Azure WAF]
- Materials memoized by species → all joists share one material instance; GPU draw calls minimized where possible.
- No shadows in MVP (FPS budget).

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- Draw calls: with instancing (`<Instances>` from drei) or per-mesh, keep total mesh count below ~500 for a max-supported deck. If exceeded, batch decking boards into an `<Instances>` group.
- Frame rate: ≥ 30 FPS orbit (spec NFR-003).

## 10. Accessibility [WCAG 2.2]
- No new a11y concerns beyond S9's canvas `aria-label`.

## 11. API & Data Contracts
- Layer components take no props — they read from stores.

## 12. Data Model & Storage
- Reads `Layout` and `layerVisibility`; owns nothing.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** drei's `<Instances>` may be used for decking boards if per-board mesh count kills FPS. Decision made in implementation.
- **Risks:**
  - Layer components duplicating geometry math → CATASTROPHIC to the pure-core design. Mitigated by AC7 (Three.js unit = mm), and by a code-review checklist: no arithmetic on member coordinates in scene code.
  - Toggle jank if a well-meaning refactor moves to mount/unmount → mitigated by AC3 test (mesh does not remount).

## 16. Out of Scope
- Materials with texture maps (v2+).
- Wood-grain shaders (v2+).
- Shadow-casting from posts / joists.
- Post-processing (SSAO, bloom).

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Should decking boards be instanced from day one, or added when we measure FPS? — Decision: implement as per-mesh first (simpler); add `<Instances>` only if FPS drops below 30 on the reference hardware for a max-supported deck.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Visibility via `<group visible>` vs. mount/unmount | Instant toggle | React-idiomatic | **`visible`** | Code Review Guardian finding #6 — no shader recompile, no GC churn. |
| One material per species (shared) vs. per-mesh | Fewer draw calls | Per-mesh customization | **Shared** | Zero customization needs in MVP; performance win is free. |

## 18. Testing Strategy
- **Unit tests:** for each layer — render with a fixture layout and assert mesh count and positions match; toggle visibility flag and assert `<group>` gets `visible=false`; assert mesh identity is preserved across toggles.
- **Snapshot tests:** structural (r3f scene tree) — not pixel snapshots.
- **E2E (QA scope, later):** Playwright toggles each layer and screenshots to confirm visible changes.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify visibility strategy (finding #6) + no geometry math in scene (finding #3) | PR review |
| QA Guardian | Approve fixture layouts + snapshot approach | PR review |
