# Epic — MVP Wood Deck Designer

**Feature branch:** `feat/mvp-deck-designer`
**Parent Spec:** [`specs/mvp-deck-designer/spec.md`](../blob/main/specs/mvp-deck-designer/spec.md)

## Summary

MVP of a browser-only, client-side app that lets a DIY homeowner visualize a **freestanding rectangular** wood deck in 3D. The user enters `width × length × height`, joist spacing, board size, and species/material; the app auto-lays out the framing (joists, beams, posts, footings) and decking, renders it in 3D with orbit/zoom/pan, and lets the user toggle individual layers to "see underneath." Includes IRC-style span-table warnings, local save/load, `.deck` JSON download, and PNG screenshot export.

## MVP outcomes (P1)

1. **See what my deck will look like** — 3D visualization with orbit/zoom/pan and preset views.
2. **Peel back the layers** — toggle visibility of Decking / Joists / Beams / Posts / Footings / Ground independently to see the framing.

## P2

3. **Warn me if the deck won't hold** — IRC-style span checks that highlight over-span members + non-dismissable "planning aid, not an engineering document" disclaimer.
4. **Save and come back later** — autosave to local storage + `.deck` JSON download/upload.

## P3

5. **Take a picture and get a shopping list** — PNG screenshot of the 3D view + on-screen BOM.

## Explicit non-goals (MVP)

- No stairs, railings, ledger board / house attachment, multi-level decks
- No terrain modeling
- No cost / pricing / cut-list export
- No 3D drag-editing (edits happen in the parameter panel)
- No cloud save, share links, or user accounts
- No PDF / OBJ / GLB export
- No mobile support

## Stack

react-three-fiber + Three.js + @react-three/drei + Zustand (with `zundo`) + TypeScript (strict) + Vite. Vitest + fast-check for domain unit tests. ESLint + Prettier + `dependency-cruiser` for boundary lint. GitHub Actions for CI. Deploy target: GitHub Pages (static).

## Architecture (from Code Review Guardian consultation)

Six layers with strict import discipline (enforced by boundary lint in CI):

```
domain/         # pure TS: units, model, materials catalog, layout engine, span-check
application/    # use-case orchestrations (load-design, save-design, apply-parameters, compute-layout)
persistence/    # .deck v1 file format, JSON Schema, localStorage, file I/O, PNG screenshot
state/          # Zustand: design store (with zundo) + UI store
scene/          # r3f: DeckScene, CameraRig, six layer components, WarningOverlay
ui/             # React: AppShell, DisclaimerBanner, panels, ExportMenu, PlanView2D
```

Import direction: `ui → state → application → domain`; `scene → state → domain`; `persistence → domain`. Nothing else.

The `Layout` type produced by the layout engine is a **complete render contract** — scene components consume it and perform zero geometry math. This is the pure/hexagonal-core wedge.

## Decomposition — 15 stories in 5 phases

| # | Branch | Title |
|---|---|---|
| S1 | `story/1-project-scaffold` | Project scaffold, tooling & CI (Vite + React + TS + r3f + Zustand + Vitest + boundary lint + GH Actions + MIT LICENSE + README + ARCHITECTURE.md stub) |
| S2 | `story/2-units-subsystem` | Domain: canonical mm units + conversion + formatting API |
| S3 | `story/3-domain-model-catalog` | Domain: core entities (`DeckDesign`, `Joist`, `Beam`, `Post`, `Footing`, `Board`) + SKU-based materials catalog |
| S4 | `story/4-layout-engine` | Domain: layout engine + `Layout` render-contract type + property tests (fast-check) |
| S5 | `story/5-span-tables-check` | Domain: `SpanTable` interface + `IrcSpanTable` (IRC-2018) impl + `span-check(layout, table) → Warning[]` |
| S6 | `story/6-file-format-persistence` | Persistence: `.deck` v1 envelope + JSON Schema + validation + localStorage adapter + file download/upload |
| S7 | `story/7-application-usecases` | Application: use-cases (`load-design`, `save-design`, `apply-parameters`, `compute-layout`) |
| S8 | `story/8-state-stores` | State: Zustand `design-store` (with `zundo`) + `ui-store`; wire to use-cases |
| S9 | `story/9-3d-scene-shell` | Scene: `DeckScene` root `<Canvas>` + `CameraRig` (orbit/zoom/pan + Top/Front/Side/Iso presets) |
| S10 | `story/10-scene-layers` | Scene: six layer components with visibility via `<group visible={…}>` (NOT mount/unmount) |
| S11 | `story/11-warning-overlay` | Scene: `WarningOverlay` draws its own decoration; independent of layer visibility |
| S12 | `story/12-app-shell-disclaimer` | UI: `AppShell` + non-dismissable `DisclaimerBanner` (with first-paint test) |
| S13 | `story/13-parameter-panel` | UI: `ParameterPanel` (width/length/height/spacing/material) + runtime unit switcher |
| S14 | `story/14-side-panels` | UI: `LayerTogglePanel` + `WarningsPanel` + `BomPanel` + `ExportMenu` (save/load/PNG/JSON) |
| S15 | `story/15-2d-plan-view` | UI: read-only 2D top-down plan view (SVG or Canvas) |

Full sequencing, dependencies, and rationale in `specs/mvp-deck-designer/spec.md § Decomposition`.

## Branching model

- This epic issue = the **Feature**. Feature branch: `feat/mvp-deck-designer`.
- Each story issue = a **Story**. Story branches (`story/N-slug`) branch OFF `feat/mvp-deck-designer` and PR back INTO `feat/mvp-deck-designer` (NOT into `main`).
- Every story gets its own git worktree.
- When all stories are merged, the Feature branch is PR'd into `main` as the final integration.

## Success criteria (from spec)

- **SC-001:** first-time user renders a target deck within 3 min
- **SC-002:** layer toggle ≤ 100 ms with no shader recompile
- **SC-003:** parameter-change → 3D re-render ≤ 500 ms p95 up to 20 ft × 30 ft
- **SC-004:** layout engine has ≥ 10 golden fixtures + ≥ 5 fast-check property tests
- **SC-005:** span-check has ≥ 8 golden tests citing IRC-2018 table rows
- **SC-006:** `.deck` file round-trip is byte-for-byte identical
- **SC-007:** disclaimer renders on first paint, non-dismissable
- **SC-008:** CI blocks any boundary-lint violation
- **SC-009:** Time to Interactive ≤ 3 s on 10 Mbps + reference hardware

## Disclaimer (must ship on first release)

> **Planning aid, not an engineering document — consult a licensed professional or your local building department.**

Non-dismissable. Renders on first paint. Enforced by unit test.

## References

- Spec: `specs/mvp-deck-designer/spec.md`
- Code Review Guardian architectural-impact report — filed in the epic thread as a comment
- User answers to PO clarifying questions: sections A1–J27 (see spec § Assumptions)
