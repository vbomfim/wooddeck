# [S4] Domain — layout engine + `Layout` render contract + property tests

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/4-layout-engine` (off `feat/mvp-deck-designer`)
**Depends on:** S1, S2, S3

## 1. User Story

As **the state layer (S8) and every scene component (S10)**,
I want **a pure function `computeLayout(design: DeckDesign): Layout` that produces the complete list of drawable structural members with full 3D placement in mm**,
so that **scene components can render the deck by iterating `layout.members` without doing any geometry math themselves — the pure-core / hexagonal seam the whole architecture depends on**.

**Success metrics:** given any valid `DeckDesign`, `computeLayout` returns a `Layout` in which (a) every member is inside the footprint, (b) no two members of the same kind overlap, (c) member counts match documented formulas, (d) width/length swap produces a rotated layout, (e) all invariants hold under `fast-check` property tests. Time budget: ≤ 50 ms per call on reference hardware for a 20 ft × 30 ft deck.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/domain/layout/layout-engine.ts` | `computeLayout(design)` — orchestrator | New |
| `src/domain/layout/joist-layout.ts` | Joist positions given footprint + spacing | New |
| `src/domain/layout/beam-layout.ts` | Beam positions given footprint + joist span | New |
| `src/domain/layout/post-layout.ts` | Post + footing positions given beam layout | New |
| `src/domain/layout/decking-layout.ts` | Decking board positions given footprint + orientation | New |
| `src/domain/layout/*.test.ts` | Unit + property tests | New |

**Boundary:** Pure functions. No React, no Three.js, no I/O. Input `DeckDesign`; output `Layout` (defined in `model.ts` from S3).
**File structure:** `src/domain/layout/`.

**Interface Contract:**

```ts
import type { DeckDesign, Layout, LayoutMember } from "../model";

export function computeLayout(design: DeckDesign): Layout;

// Sub-functions (exported for direct testability):
export function layoutJoists(design: DeckDesign): LayoutMember[];
export function layoutBeams(design: DeckDesign): LayoutMember[];
export function layoutPostsAndFootings(design: DeckDesign, beams: LayoutMember[]): { posts: LayoutMember[]; footings: LayoutMember[] };
export function layoutDecking(design: DeckDesign): LayoutMember[];
```

**Input contract:** a valid `DeckDesign` (footprint + material references + spacing).
**Output contract:** a `Layout` whose `members` array contains every drawable primitive with `position`, `size`, `rotation`, `material`, `kind`, `id`.
**Error contract:** throws `LayoutError` if the design is invalid (e.g., width < min, unknown material). No silent partial layouts.

**Dependencies:**
- Depends on: `model.ts` (S3), `units.ts` (S2), `materials-catalog.ts` (S3).
- Consumed by: `application/compute-layout.ts` (S7), `state/design-store.ts` (S8), `span-check.ts` (S5).
- Rule: NEVER produce data that isn't renderable as-is. If a scene component would need to compute a coordinate, that computation belongs here (Code Review Guardian finding #3).

**Rewritability check:**
- [x] Can be rewritten from interface + property tests.
- [x] Consumers survive rewrite as long as `Layout` shape is preserved.
- [x] Pure — no state.

## 3. Audience & Personas
- Primary: state + scene developers.
- Secondary: N/A.

## 4. Functional Requirements

### Coordinate system convention

- **Origin:** `(0, 0, 0)` at the geometric center of the deck footprint at ground level (z = 0).
- **Axes:** `x` = width direction; `y` = length direction; `z` = up (height).
- Joists run parallel to `y` (length) by default; decking runs perpendicular (parallel to `x`) — user-selectable via `design.decking.orientation`.
- Positive `z` above ground; posts extend from `z = 0` down to the footing top (footings partially below ground; document exact convention in code comments).

### Layout rules (MVP simplification — freestanding rectangular)

- **Joists:** parallel to the length axis, spaced at `design.joist.spacingMm` on-center. Layout starts flush at one edge; remainder handled per `design.layout.bayRemainderStrategy` (default: `"extra-bay-at-end"`).
- **Beams:** two beams (one at each end perpendicular to joists, or use "drop beam" convention — implementer picks and documents). Beams sit UNDER the joists.
- **Posts:** placed along each beam at spacing determined by beam-span limits (Story 5's tables give a max span; MVP uses that to pick a count, e.g., 2, 3, 4 posts per beam). Post count formula: `ceil(deckLengthMm / maxBeamSpanMm) + 1`.
- **Footings:** one per post, centered under the post.
- **Decking:** boards laid perpendicular to joists (or parallel, per `orientation`), spaced with a 3 mm gap between boards, full width across footprint. Boards at the edges may be ripped narrower — for MVP, ignore ripping and let last-board width equal remainder.

Ambiguities intentionally handled by simple, documented defaults; more sophisticated logic is v2+.

### Acceptance Criteria

**AC1: Joist count formula**
- Given `footprint.widthMm = 3660`, `joist.spacingMm = 406` (16" o.c.),
- When `layoutJoists(design)` is called,
- Then it returns exactly `ceil(3660 / 406) + 1 = 10` joist members (implementer documents the exact formula in a code comment).

**AC2: All members inside the footprint**
- Property test (fast-check): for any valid design, every member's `(position ± size/2)` is inside `bounds` on the x/y axes.

**AC3: No overlaps within a kind**
- Property test: for any two joists (or any two beams, posts, footings, boards), their bounding boxes do not overlap.

**AC4: Width/length swap → rotated layout**
- Given a design `D`, computing `computeLayout(D)` and `computeLayout(swap(D))` produces layouts that are rotations of each other (member counts differ predictably; positions swap x/y).

**AC5: Monotonicity**
- Property test: increasing `footprint.lengthMm` never decreases the joist count.

**AC6: Layout is a complete render contract**
- Given the `Layout` output,
- Every member has `position`, `size` (nonzero on all three axes), `rotation`, `kind`, `material`, `id`.
- No fields are `undefined`.

**AC7: Deterministic**
- Given the same `DeckDesign`, `computeLayout(design)` returns byte-for-byte identical `Layout` (ignoring `computedAt`) across calls.

**AC8: Performance**
- For a 20 ft × 30 ft deck at 16" joist spacing, `computeLayout` returns in ≤ 50 ms (measured with `performance.now()` in a benchmark test).

### Edge Cases
- Minimum size (e.g., 4 ft × 4 ft) → layout produces at least 2 joists, 2 beams, 4 posts, 4 footings, decking boards spanning the footprint.
- Non-integer joist counts (spacing doesn't divide evenly) → handled per documented `bayRemainderStrategy`.
- Very large deck (e.g., 40 ft × 40 ft) → still returns in ≤ 100 ms; no crash.
- Height = 0 → posts have zero z-extent; footings still placed at `z = 0` (documented behavior).

### User Flows
- N/A (library).

## 5. Reliability [Azure WAF]
- N/A — pure function.

## 6. Security [Azure WAF]
- N/A — no external input beyond typed `DeckDesign` (already validated at persistence boundary S6).

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- ≤ 50 ms for 20 × 30 ft; ≤ 100 ms for 40 × 40 ft. Enforced by benchmark test.
- Callers (S7, S8) may memoize; this function itself is stateless.

## 10. Accessibility [WCAG 2.2]
- N/A — no UI.

## 11. API & Data Contracts
- TypeScript signatures above.

## 12. Data Model & Storage
- Produces `Layout` (defined in S3).

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A. (State layer may optionally log layout compute time via `performance.now()` in dev.)

## 15. Dependencies & Risks
- **Third-party:** `fast-check` (dev) — added by this story if not already added.
- **Risks:**
  - Coordinate-system confusion between spec and implementation → mitigated by explicit convention documented in Section 4 above AND in a code comment at the top of `layout-engine.ts`.
  - "Beam count = 2" is oversimplified for real decks with intermediate beams → MVP scope: two beams (drop-beam convention). Note in a comment; v2+ can introduce mid-span beams.
  - Property tests catch invariant violations but not visual bugs → mitigated by golden fixtures (see AC1) + manual visual verification in Story 10.

## 16. Out of Scope
- Mid-span beams (v2+).
- Cantilever calculations (v2+).
- Board ripping / non-uniform decking layout (v2+).
- Diagonal decking, herringbone patterns (v2+).

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Exact beam placement convention: "drop beam" (joist sits on beam top) vs. "flush beam" (joist attaches to beam side via hangers). MVP: drop beam; documented in code comment.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Sub-functions exposed | Public | Private | **Public** | Direct testability of joist/beam/post/decking is easier than reverse-engineering from `computeLayout` output. |
| Compute span-check inside `computeLayout` | Coupled | Separate function (S5) | **Separate (S5)** | Code Review Guardian answer A: keeps SRP; span-check depends on `Layout` + `SpanTable`; layout does not know about warnings. |

## 18. Testing Strategy
- **Unit tests:** all ACs above (Vitest).
- **Property tests (fast-check):** AC2 (in-footprint), AC3 (no-overlap), AC5 (monotonicity), plus at least one invariant per sub-function.
- **Golden fixtures:** ≥ 10 (small / medium / large decks; joist spacings that divide evenly vs. remainders; both orientations). Fixture directory: `src/domain/layout/__fixtures__/*.json`.
- **Benchmark:** AC8 timing assertion.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify `Layout` is a complete render contract (finding #3); scene stories must not need geometry math | PR review |
| QA Guardian | Approve the property-test coverage and golden-fixture set | PR review |
