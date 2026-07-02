# [S12] UI — `AppShell` + non-dismissable `DisclaimerBanner`

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/12-app-shell-disclaimer` (off `feat/mvp-deck-designer`)
**Depends on:** S8, S9

## 1. User Story

As **a DIY homeowner**,
I want **a clean app layout with a persistent, non-dismissable "planning aid, not an engineering document" banner and a home for the 3D view + side panels + storage warnings**,
so that **the legal-liability surface of span-check warnings is always framed correctly, and the app has a coherent structure to hang the other UI panels on**.

**Success metrics:** SC-007 (disclaimer renders on first paint, non-dismissable, unit-tested). AppShell provides slots for `<DeckScene />` (main), parameter panel (left), warnings/BOM/toggles/export panels (right), and storage-error banner (top). WCAG 2.2 Level AA compliance for the shell chrome.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/ui/AppShell.tsx` | Layout skeleton — top bar, left panel, main viewport, right panel, bottom (empty) | New |
| `src/ui/DisclaimerBanner.tsx` | Persistent, non-dismissable disclaimer text at top of viewport | New |
| `src/ui/StorageBanner.tsx` | Conditional storage-full / storage-blocked banner | New |
| `src/ui/AppHeader.tsx` | App title + link to spec/README + version | New |
| `src/ui/styles/*.css` | Shell layout CSS (grid) + global tokens | New |
| `src/ui/**/*.test.tsx` | First-paint disclaimer test + WCAG smoke | New |

**Boundary:** Layout scaffolding + disclaimer + banners. NO domain logic. Reads from `useUiStore` for `storageBanner` state only.
**File structure:** `src/ui/`.

**Interface Contract:**

```tsx
export interface AppShellProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  main: React.ReactNode;        // the <DeckScene />
}
export function AppShell(props: AppShellProps): JSX.Element;

export function DisclaimerBanner(): JSX.Element;  // no props — content is a compile-time constant
export function StorageBanner(): JSX.Element;     // reads useUiStore.storageBanner
```

**Slot layout (CSS grid):**

```
+------------------------------------------------------+
| DisclaimerBanner (top, sticky)                       |
+------------------------------------------------------+
| AppHeader (title / version / spec link)              |
+------------+----------------------------+------------+
|            |                            |            |
|  leftPanel |         main (Canvas)       | rightPanel |
| (Params)   |                            | (Toggles + |
|            |                            |  Warnings +|
|            |                            |  BOM +     |
|            |                            |  Export)   |
+------------+----------------------------+------------+
```

- On viewports < 1024px wide, panels collapse to a top/bottom stack (tablet nice-to-have).
- Disclaimer text (frozen for MVP):

> **⚠ Planning aid, not an engineering document — consult a licensed professional or your local building department.**

**Dependencies:**
- Depends on: `state/ui-store` (S8), React, CSS.
- Consumed by: `main.tsx` / `App.tsx` root.
- Rule: NO import from `domain/`, `application/`, `persistence/`, or `scene/`. The shell is dumb; it accepts JSX children.

**Rewritability check:**
- [x] Rewritable from the slot props + disclaimer text constant.
- [x] Consumers survive rewrite as long as props (`leftPanel`, `rightPanel`, `main`) are preserved.
- [x] No state owned beyond CSS.

## 3. Audience & Personas
- Primary: DIY homeowner (every session).
- Secondary: WCAG 2.2 AA auditor.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Disclaimer on first paint**
- Given a fresh render of `<AppShell />`,
- When `render(<AppShell ... />)` completes,
- Then `screen.getByText(/planning aid, not an engineering document/i)` is in the DOM.
- Test asserts this BEFORE any state hydration (SC-007).

**AC2: Disclaimer non-dismissable**
- Given the rendered shell,
- Then there is NO close button, no dismiss action, no cookie/localStorage state that hides the disclaimer.
- Any attempt to remove the DisclaimerBanner from the component tree via inspection fails the test.

**AC3: Slot layout**
- Given `<AppShell leftPanel={<div data-testid="lp"/>} rightPanel={<div data-testid="rp"/>} main={<div data-testid="m"/>} />`,
- Then all three testids are in the DOM.

**AC4: Storage banner shows only when set**
- Given `useUiStore.setState({ storageBanner: null })`,
- Then `<StorageBanner />` renders no banner (empty fragment).
- Given `useUiStore.setState({ storageBanner: "storage-full" })`,
- Then a banner is visible with the message "Local storage is full. Your design will not be autosaved. Download the .deck file to keep it safe."

**AC5: WCAG 2.2 Level AA smoke**
- Given the rendered shell + placeholder panels,
- When run through `axe-core` (via `@axe-core/react` or `jest-axe`),
- Then zero violations of Level AA rules for the shell chrome (contrast, landmarks, focus visible, semantic headings).

**AC6: Keyboard navigation**
- Given the shell + a focusable element in each panel,
- When the user tabs through the app,
- Then focus moves in a logical order: header → left panel → main (canvas, focusable with tab) → right panel.

**AC7: Version + spec link**
- Given the header,
- Then it contains: the app name ("wooddeck"), the version (from `package.json`), and a link to the spec (`specs/mvp-deck-designer/spec.md` at the repo URL).

### Edge Cases
- Very narrow viewport (< 640px) → mobile is deferred; render "Best viewed on desktop" note and still show the disclaimer + fallback content.
- User with `prefers-reduced-motion` → any UI transition respects the CSS media query (MVP: mostly static; verify).
- User with `prefers-color-scheme: dark` → MVP supports light mode only; explicitly set `color-scheme: light` in the shell.

### User Flows
- App loads → disclaimer visible → 3D view populates → user starts editing.

## 5. Reliability [Azure WAF]
- Shell is static; no reliability concerns.

## 6. Security [Azure WAF]
- Disclaimer text is a compile-time string; no interpolation of user input.
- Storage banner messages are compile-time strings.
- No `dangerouslySetInnerHTML` anywhere.

## 7. Cost Optimization [Azure WAF]
- Shell chunk is small (< 20 KB). No perf risk.

## 8. Operational Excellence [Azure WAF]
- N/A.

## 9. Performance Efficiency [Azure WAF]
- Layout uses CSS grid — no runtime layout thrashing.
- Disclaimer is `position: sticky` at top; no scroll-jank on rerender.

## 10. Accessibility [WCAG 2.2]
- **Landmarks:** `<header>`, `<main>`, `<aside>` × 2 for the panels.
- **Headings:** `<h1>` = app name; panels have `<h2>` titles.
- **Focus visible:** default browser outline is preserved OR an equivalent custom outline meets 3:1 contrast.
- **Contrast:** disclaimer background/foreground meets 4.5:1 for normal text; storage banner also 4.5:1.
- **Screen reader:** disclaimer is inside a `<div role="note" aria-label="Product disclaimer">` — announced as important context on page load.
- **Reduced motion:** all transitions gated by `@media (prefers-reduced-motion: no-preference)`.

## 11. API & Data Contracts
- Props above.

## 12. Data Model & Storage
- Reads `useUiStore.storageBanner`; owns nothing.

## 13. Deployment & Infrastructure
- N/A.

## 14. Observability [Google SRE]
- N/A.

## 15. Dependencies & Risks
- **Third-party:** `jest-axe` (dev) OR `@axe-core/react` (dev). Choice made in implementation.
- **Risks:**
  - A future well-intentioned developer adds a dismiss button → mitigated by AC2 test (regression protection — Code Review Guardian "honorable mention").
  - Storage banner text becomes stale if error codes change → mitigated by centralizing the message map alongside the error codes.

## 16. Out of Scope
- Dark mode.
- Mobile layout.
- Onboarding tour.
- Multi-language / i18n.
- Any user-editable disclaimer content.

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Should the disclaimer appear in a modal on first launch AND remain as a banner? — MVP: banner only (non-dismissable), no modal. Modal would be a stronger legal position; banner is user-friendlier. Revisit if legal counsel says otherwise (out of scope for solo hobby project).

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Non-dismissable banner vs. once-per-session modal | Always visible | Cleaner UX after first ack | **Non-dismissable** | User answer D12 + Code Review Guardian "honorable mention" — legal-liability surface warrants persistent visibility. |
| axe-core in CI vs. manual audit | Automated, catches regressions | Zero CI cost | **CI** | Cheap; guards against a11y regressions. |

## 18. Testing Strategy
- **Unit tests:** AC1 (disclaimer text present), AC2 (no dismiss control), AC3 (slots), AC4 (storage banner conditional).
- **A11y tests:** AC5 (axe-core) as a Vitest test in `AppShell.a11y.test.tsx`.
- **Snapshot:** shell layout structure.
- **E2E (QA scope, later):** Playwright asserts disclaimer text is visible on `browser_navigate` to the deployed site.

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Code Review Guardian | Verify non-dismissable disclaimer + first-paint test | PR review |
| QA Guardian | Approve axe-core test setup + E2E disclaimer check | PR review |
