# wooddeck

> A browser-only, client-side app that lets a DIY homeowner visualize a freestanding rectangular wood deck in 3D. Enter width × length × height, joist spacing, board size, and species/material; the app auto-lays out framing (joists, beams, posts, footings) and decking, renders it in 3D with orbit / zoom / pan, and lets the user toggle individual layers to "see underneath." Includes IRC-style span-table warnings. Save/load locally, download `.deck` JSON, PNG screenshot. **No backend, no auth.**

> ⚠️ **Planning aid, not an engineering document — consult a licensed professional or your local building department.**
> The 3D layout and span-table warnings are approximations for early-stage visualization. They are **not** a substitute for a stamped engineering drawing or permit-ready plan set.

## Status

Pre-alpha. Story S1 — project scaffold, tooling & CI — is the current work item. The 3D scene, layout engine, and UI panels arrive in subsequent stories (S2–S15). See `.github/tickets/` and the [Formal Spec](./specs/mvp-deck-designer/spec.md) for the full roadmap.

## Requirements

- **Node.js ≥ 22.12** (LTS). See [`.nvmrc`](./.nvmrc).
- **npm** (ships with Node). Package-manager choice is npm; see the trade-off table in the spec.

## Getting started

```bash
git clone https://github.com/vbomfim/wooddeck.git
cd wooddeck
npm install
npm run dev
```

Then open <http://localhost:5173> — you should see "Hello wooddeck."

## NPM scripts

| Script                   | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `npm run dev`            | Start Vite dev server with HMR                                   |
| `npm run build`          | Type-check with `tsc -b`, then produce a production bundle       |
| `npm run preview`        | Serve the built bundle locally to sanity-check production output |
| `npm run typecheck`      | Run the TypeScript project references without emitting           |
| `npm run lint`           | Run ESLint (flat config, `@typescript-eslint`, react-hooks)      |
| `npm run lint:boundaries`| Run `dependency-cruiser` layer-boundary rules (spec § NFR-011)   |
| `npm run test`           | Run Vitest once and exit (used by CI)                            |
| `npm run test:watch`     | Vitest in watch mode for TDD                                     |

## Architecture

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the layer diagram, boundary rules, and the pinned r3f / three / drei version matrix. Short version:

```
domain  ← application  ← state  ← ui
        ↖ persistence           ↘ scene
```

- **`src/domain/`** is pure. No React, Three.js, or DOM. Fully unit-testable with `fast-check` property tests.
- **`src/application/`** wires use-cases (load, save, compute-layout) against domain + persistence.
- **`src/persistence/`** is an adapter for browser storage and `.deck` file I/O.
- **`src/state/`** is Zustand stores that expose application use-cases to React.
- **`src/scene/`** is the react-three-fiber scene, layers, and warning overlay.
- **`src/ui/`** is React panels (parameters, layer toggles, warnings, BOM, export).

The layer boundaries are enforced by `dependency-cruiser` in CI — see [`.dependency-cruiser.cjs`](./.dependency-cruiser.cjs).

## Formal specification

The single source of truth for scope, functional requirements, and non-functional requirements is [**specs/mvp-deck-designer/spec.md**](./specs/mvp-deck-designer/spec.md). Story tickets live in [`.github/tickets/`](./.github/tickets/) and mirror the GitHub issues.

## License

[MIT](./LICENSE) © 2026 Vinicius Bomfim ([@vbomfim](https://github.com/vbomfim))
