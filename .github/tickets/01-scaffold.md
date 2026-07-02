# [S1] Project scaffold, tooling & CI

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/1-project-scaffold` (off `feat/mvp-deck-designer`)
**Depends on:** none — this story unblocks everything else.

## 1. User Story

As **the sole developer of wooddeck**,
I want **a working Vite + React + TypeScript + r3f + Zustand + Vitest scaffold with lint, format, boundary lint, and CI wired up from commit #1**,
so that **every subsequent story ships on a stable base where the layer discipline is enforced by tooling, not by memory**.

**Success metrics:** `npm run dev` boots a "Hello wooddeck" page; `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all pass; GitHub Actions runs the same on every push and blocks merge on failure; a deliberate cross-layer import (e.g., `domain → state`) fails `npm run lint:boundaries`.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `package.json` + `vite.config.ts` + `tsconfig.json` | Build config + strict TS + code-split entry | New |
| `eslint.config.js` + `.prettierrc` | Style + correctness lint | New |
| `.dependency-cruiser.cjs` | Layer-boundary import rule | New |
| `.github/workflows/ci.yml` | Typecheck + lint + boundary + test + build on push/PR | New |
| `LICENSE` (MIT) | License | New |
| `README.md` | What/why/build/run + disclaimer | New |
| `docs/ARCHITECTURE.md` | Layer boundaries + import rule + link to spec | New |
| `src/main.tsx` + `src/App.tsx` | Minimal "Hello wooddeck" React entry point | New |

**Boundary:** Only tooling + a trivial placeholder React app. No domain code, no scene, no persistence.
**File structure:** repo root + `src/` + `.github/workflows/` + `docs/`.

**Interface Contract:**
- Consumers: every subsequent story.
- Public NPM scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `lint:boundaries`, `test`, `test:watch`.
- Boundary rule (declarative in `.dependency-cruiser.cjs`): `domain → nothing`; `application → domain`; `persistence → domain`; `state → application + domain`; `scene → state + domain`; `ui → state + application + domain`.

**Dependencies:**
- Depends on: nothing internal.
- Consumed by: every other story.
- Rule: no source files under `src/` beyond `main.tsx` and `App.tsx` at the close of this story — those come from subsequent stories.

**Rewritability check:**
- [x] Can be rewritten from just the tsconfig strictness targets + boundary rule.
- [x] Consumers survive rewrite as long as scripts + boundary rule are preserved.
- [x] No data model owned.

## 3. Audience & Personas
- **Primary:** the developer (solo project). Every other Guardian and AI agent working the repo.
- **Secondary:** future contributors (public repo — MIT license).
- **Scale:** one repo, one developer, hobby pace.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Scaffold boots**
- Given a fresh clone,
- When the developer runs `npm install && npm run dev`,
- Then Vite starts and the browser shows "Hello wooddeck" at `http://localhost:5173`.

**AC2: All scripts pass**
- Given the scaffold,
- When the developer runs `npm run typecheck && npm run lint && npm run lint:boundaries && npm run test && npm run build`,
- Then all five commands exit 0.

**AC3: Boundary lint fires on deliberate violations (broadened after S1 review)**
- Given TWO test files under `src/domain/`:
  1. one importing from a forbidden sibling layer (e.g., `../state/anything`), AND
  2. one importing a framework package (`react` OR `three` OR `@react-three/drei`),
- When the developer runs `npm run lint:boundaries` for each,
- Then EACH invocation exits non-zero and names the violating file AND the specific rule (`*-allowlist` for the sibling case, `domain-no-react-three-dom` for the framework case).
- (Remove the test files after verifying; do NOT ship them.)
- Additionally, `npm run test:boundaries` (the permanent self-test harness at `scripts/boundary-selftest.mjs`) MUST exit 0 — it exercises every boundary rule on every push.

**AC4: CI blocks a bad PR**
- Given the CI workflow committed to `.github/workflows/ci.yml`,
- When a PR is opened with any of the above scripts failing,
- Then the CI check turns red and blocks merge.

**AC5: Repo hygiene**
- Given the scaffold,
- Then the repo contains: `LICENSE` (MIT with the correct year + owner @vbomfim), `README.md` (name, disclaimer, install/dev/build/test instructions, link to `specs/mvp-deck-designer/spec.md`), `docs/ARCHITECTURE.md` (layer diagram + import rules), `.gitignore` (`node_modules`, `dist`, `.DS_Store`, `*.local`), `.editorconfig`.

### Edge Cases
- Node version pinning: `.nvmrc` = `22.23` (a concrete 22.13+ minor); `package.json` `"engines": { "node": ">=22.13.0" }`. Updated during S1 review — dep-cruiser 18 and ESLint 10 sub-packages require Node ≥ 22.13.
- Vite HMR should work with r3f (will be validated in Story 9 — no scene in this story).

### User Flows
- Happy path: `git clone && npm install && npm run dev` → see "Hello wooddeck" in browser.
- Verifying CI: push a branch, observe the Actions run turn green.

## 5. Reliability [Azure WAF]
- N/A — this story ships tooling and a trivial page. No runtime reliability concerns. (The static site's availability = GitHub Pages SLA; not yet deployed.)

## 6. Security [Azure WAF]
- **Authentication / Authorization / Data / Secrets:** N/A — no runtime security surface; static tooling only.
- **Dependencies:** `package.json` lockfile committed (`package-lock.json`). Dependabot may be enabled in a later story.
- **Supply chain:** pin exact versions of `three`, `@react-three/fiber`, `@react-three/drei` (Code Review Guardian answer C).

## 7. Cost Optimization [Azure WAF]
- N/A — no cloud resources.

## 8. Operational Excellence [Azure WAF]
- **CI/CD:** GitHub Actions workflow `.github/workflows/ci.yml` runs on `push` (limited to `main` + `feat/**` — story branches run only on `pull_request` to avoid duplicate push+PR runs) and `pull_request`; steps: `typecheck`, `lint`, `lint:boundaries`, `test:boundaries` (self-test harness), `test`, `build`. Uses `actions/setup-node@v6` + `actions/checkout@v7` (both `node24` runtime) with the built-in npm cache (`cache: 'npm'`). `timeout-minutes: 10` on the verify job.
- **Deploy strategy:** N/A for this story — deploy job (to `gh-pages`) is a follow-up post-MVP.
- **Rollback:** git revert.

## 9. Performance Efficiency [Azure WAF]
- Vite config MUST enable code-splitting; the eventual 3D scene chunk will be lazy-loaded (validated in Story 9).
- No performance target for this story beyond `npm run build` completing in ≤ 30 s on the developer's laptop.

## 10. Accessibility [WCAG 2.2]
- The "Hello wooddeck" placeholder page is trivial HTML + a heading. Full WCAG conformance comes with the UI stories (S12–S15).

## 11. API & Data Contracts
- N/A — no APIs, no data contracts.

## 12. Data Model & Storage
- N/A — no data.

## 13. Deployment & Infrastructure
- **Target:** GitHub Pages (post-MVP).
- **Infra as code:** N/A — GH Pages is configured via GitHub UI + a workflow when the deploy story lands.

## 14. Observability [Google SRE]
- N/A — no runtime observability.

## 15. Dependencies & Risks
- **Upstream:** Node.js 22.13+ (LTS), npm registry availability.
- **Third-party:** `react`, `react-dom`, `three`, `@react-three/fiber`, `@react-three/drei`, `zustand`, `zundo`, `vite`, `typescript`, `vitest`, `@vitest/coverage-v8`, `eslint`, `typescript-eslint`, `prettier`, `dependency-cruiser`, `fast-check` (staged for domain stories).
- **Risks:**
  - r3f + three + drei version-matrix incompatibilities → pin exact versions in `package.json`; document the working matrix in `docs/ARCHITECTURE.md`. Mitigation: pin.
  - `dependency-cruiser` false negatives on ESM-only paths → validate AC3 (deliberate violation) as part of the story acceptance, PLUS a permanent self-test harness (`scripts/boundary-selftest.mjs`, `npm run test:boundaries`) wired into CI that fires all boundary rules on every push. (Added after S1 review found `includeOnly: ^src/` had silently disabled the framework-ban rule.)
  - React accidentally upgrading to 19.3 and breaking r3f's `>=19 <19.3` peer → `react`/`react-dom` pinned with tilde (`~19.2.7`) rather than caret.

## 16. Out of Scope
- Any domain, state, scene, persistence, or UI source code (comes in later stories).
- Deploy-to-gh-pages workflow.
- Dependabot / renovate.
- Any actual r3f `<Canvas>` — Story 9.

## 17. Open Questions & Trade-offs

### Open Questions
- None. Stack is committed by user answer H23.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Boundary lint tool | `eslint-plugin-boundaries` | `dependency-cruiser` | **B** | Standalone tool with its own script + CI job — easier to see in logs and enforce independently of ESLint config. Both are acceptable per Code Review Guardian answer A. |
| Package manager | npm | pnpm | **npm** | Ships with Node; no extra setup; solo project — no monorepo benefit from pnpm workspaces yet. |
| Node version | 20 LTS | 22 current | **22 LTS** | Bumped from 20 during S1 review. Node 20 was deprecated on GitHub Actions runners mid-story; `dependency-cruiser@18` also requires Node 22+. `22.13.0` is the concrete floor (ESLint 10 sub-packages need it too). |

## 18. Testing Strategy
- **Unit tests:** one smoke test — Vitest picks up `src/App.test.tsx` and asserts the "Hello wooddeck" text renders. Confirms Vitest + jsdom + React Testing Library are wired.
- **Integration / E2E:** N/A — no UI to test yet.
- **Boundary test:** AC3 (deliberate violation) PLUS the permanent self-test harness (`npm run test:boundaries` / `scripts/boundary-selftest.mjs`) run in CI on every push. Fixtures cover: sibling-layer imports, composition-root leaks, `react`/`three`/`@react-three/*` imports from `domain/`, and DOM globals (`document`, `window`) in `domain/`.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify boundary lint rule matches spec § NFR-011 | After scaffold PR is up |
| Delivery Guardian | Verify CI workflow is correct and complete | After scaffold PR is up |
