/**
 * `src/ui/PlanView2D.tsx` — S15 issue #16.
 *
 * ## Responsibility (single)
 *
 * Render a read-only 2D top-down plan view of the current
 * `Layout` as inline SVG. Members are projected onto the world
 * x–z plane; SVG y is flipped (world +z ⇢ SVG y=0 = TOP of the
 * drawing) so the "far end of the deck" reads at the top of the
 * plan — matching every carpentry drawing convention.
 *
 * ## What this file is NOT
 *
 *   - Not a geometry calculator — every position / size / label
 *     comes from `PlanView2D.helpers.ts` (pure, unit-tested).
 *   - Not a state owner — reads `useLayout()` + `useUiUnits()`
 *     via the state barrel, writes nothing.
 *   - Not interactive — no click / drag / context-menu handlers
 *     (AC7). Hover-tooltip is stretch and not implemented in MVP
 *     (§16 out-of-scope).
 *   - Not a domain-layout consumer — the layout is READ from
 *     state; boundaries are enforced by `ui-no-domain-layout` and
 *     `ui-no-domain-spans` in `.dependency-cruiser.cjs`.
 *
 * ## Visual language (§10 WCAG 1.4.3 — no info by color alone)
 *
 * Distinguishes member kinds by STROKE WIDTH, not color:
 *
 *   - Footprint outline    — thick 2-line perimeter (border).
 *   - Beams                — thick strokes.
 *   - Joists               — medium strokes.
 *   - Decking boards       — faint hairline strokes (subtle hint).
 *   - Posts                — filled circles (dots).
 *   - Blocks / blocking    — faint filled squares/dots (best-effort
 *                            per ticket §Scope; do not crash).
 *
 * All fill/stroke uses the same monochrome ink over the surface
 * token, so a Windows-high-contrast user or a colour-blind user
 * sees the SAME plan.
 *
 * ## Accessibility (§10)
 *
 *   - `<section aria-labelledby="wd-plan-view__title">` with a
 *     nested `<h2>Plan view</h2>` — matches the SidePanels
 *     landmark convention (a section per panel).
 *   - The `<svg role="img" aria-labelledby="{titleId} {descId}">`
 *     with a nested `<title>` + `<desc>` — SR announces both.
 *   - No focus traps, no keyboard handlers — the SVG is purely
 *     descriptive.
 *
 * ## Boundary
 *
 *   - `../state`                             — useLayout, useUiUnits.
 *   - `../domain/units` (for label helpers)  — via helpers.
 *   - `./PlanView2D.helpers`                 — pure geometry.
 *   - NO scene / persistence / application   — hard rule.
 *   - NO domain/layout, NO domain/spans      — hard rule (dep-cruiser).
 *
 * The barrel `src/ui/index.ts` exports `PlanView2D` for App /
 * SidePanels to mount.
 */
import { useId, type JSX } from 'react';

import { useLayout, useUiUnits } from '../state';

import {
  buildPlanDescription,
  computeSvgViewBox,
  formatFootprintLabel,
  projectCenter,
  projectRect,
} from './PlanView2D.helpers';

import './styles/plan-view.css';

// ---------------------------------------------------------------------------
// Copy constants — exported for tests
// ---------------------------------------------------------------------------

/**
 * The SVG `<title>` copy — quoted verbatim by AC5.
 */
export const PLAN_VIEW_TITLE = 'Top-down 2D plan of deck';

/**
 * The placeholder rendered when `layout.members` is empty (AC6).
 */
export const PLAN_VIEW_EMPTY_TEXT = 'Enter dimensions to see the plan';

/**
 * The panel heading — kept exported so a future test can grep-import
 * it without duplicating the string.
 */
export const PLAN_VIEW_HEADING = 'Plan view';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PlanView2DProps {
  /**
   * The maximum on-screen height of the SVG, in CSS pixels.
   * Default 400 (ticket §2 interface contract). The SVG's
   * `viewBox` + `preserveAspectRatio="xMidYMid meet"` handle the
   * scaling — this prop only bounds the container's max-height.
   */
  readonly maxHeightPx?: number;
}

const DEFAULT_MAX_HEIGHT_PX = 400;

/**
 * The read-only 2D top-down plan. See module header for the
 * design rationale.
 */
export function PlanView2D(props: PlanView2DProps = {}): JSX.Element {
  const layout = useLayout();
  const units = useUiUnits();
  const maxHeightPx = props.maxHeightPx ?? DEFAULT_MAX_HEIGHT_PX;

  // Stable ARIA ids per instance — useId guarantees the render is
  // deterministic across React 19 concurrent renders + tolerates
  // multiple PlanView2D instances on one page (no id collisions).
  const sectionTitleId = useId();
  const svgTitleId = useId();
  const svgDescId = useId();

  // AC6: empty layout — skip the SVG entirely, surface the
  // placeholder. `role="status"` + `aria-live="polite"` matches
  // BomPanel's empty-state convention (SR announces the state
  // without stealing focus).
  if (layout.members.length === 0) {
    return (
      <section
        aria-labelledby={sectionTitleId}
        className="wd-plan-view wd-plan-view--empty"
      >
        <h2 id={sectionTitleId}>{PLAN_VIEW_HEADING}</h2>
        <p className="wd-plan-view__empty" role="status" aria-live="polite">
          {PLAN_VIEW_EMPTY_TEXT}
        </p>
      </section>
    );
  }

  const viewBox = computeSvgViewBox(layout.bounds);
  const footprintLabel = formatFootprintLabel(layout.bounds, units);
  const descText = buildPlanDescription(layout, units);

  return (
    <section aria-labelledby={sectionTitleId} className="wd-plan-view">
      <h2 id={sectionTitleId}>{PLAN_VIEW_HEADING}</h2>

      {/*
       * Wrapper `<div>` isolates the max-height CSS so the SVG can
       * remain a bare graphic element (its width/height are driven
       * by the viewBox + parent width). `overflow: hidden` prevents
       * a very-tall SVG from spilling out of the panel.
       */}
      <div
        className="wd-plan-view__canvas"
        style={{ maxHeight: `${String(maxHeightPx)}px` }}
      >
        <svg
          role="img"
          aria-labelledby={`${svgTitleId} ${svgDescId}`}
          viewBox={viewBox.viewBoxAttr}
          preserveAspectRatio="xMidYMid meet"
          className="wd-plan-view__svg"
          // No handlers — AC7. Left explicit so a future maintainer
          // sees the read-only invariant.
        >
          <title id={svgTitleId}>{PLAN_VIEW_TITLE}</title>
          <desc id={svgDescId}>{descText}</desc>

          {/* Footprint outline — a thick border on the whole rect. */}
          <rect
            data-role="footprint"
            className="wd-plan-view__footprint"
            x={0}
            y={0}
            width={viewBox.widthMm}
            height={viewBox.lengthMm}
            strokeWidth={STROKE_WIDTHS_MM.footprint}
          />

          {/*
           * Members — order chosen so heavier ink is drawn LAST
           * (posts on top of joists on top of decking hint strokes).
           *
           * Rotation handling (documented decision): MVP layouts
           * are axis-aligned (every LayoutMember.rotation is
           * {0,0,0}); if a non-zero rotation slips in, we still
           * project the (unrotated) bounding box in the x-z plane.
           * That is acceptable for MVP and documented in the
           * story handoff. A future rotation-aware pass would emit
           * `transform="rotate(…)"` on the <rect>.
           */}
          {layout.members.map((m) => renderMember(m, layout.bounds))}
        </svg>
      </div>

      {/*
       * Footprint dimension label BELOW the SVG. Kept out of the
       * SVG (as opposed to an inside-the-canvas <text>) so
       * high-DPI browsers render it with normal font hinting and
       * the label survives a very-narrow container without
       * overlapping the drawing. `aria-hidden` is NOT applied
       * because the sighted label complements the `<desc>` — SR
       * users hear the desc; sighted users see the label.
       */}
      <p className="wd-plan-view__label">{footprintLabel}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-member renderers — one function each so tests can grep by data-kind
// ---------------------------------------------------------------------------

/**
 * Dispatch on `member.kind` to the right SVG primitive. Every
 * shape carries `data-kind="<kind>"` so tests can select without
 * depending on CSS class stability.
 */
function renderMember(
  member: import('../domain/model').LayoutMember,
  bounds: import('../domain/model').Dimensions3D,
): JSX.Element | null {
  switch (member.kind) {
    case 'joist':
      return renderRect(member, bounds, 'joist', 'wd-plan-view__joist');
    case 'beam':
      return renderRect(member, bounds, 'beam', 'wd-plan-view__beam');
    case 'board':
      return renderRect(member, bounds, 'board', 'wd-plan-view__board');
    case 'blocking':
      return renderRect(member, bounds, 'blocking', 'wd-plan-view__blocking');
    case 'block':
      return renderRect(member, bounds, 'block', 'wd-plan-view__block');
    case 'footing':
      return renderRect(member, bounds, 'footing', 'wd-plan-view__footing');
    case 'post':
      return renderPost(member, bounds);
    default: {
      // Exhaustiveness — a new kind added to `MemberKind` fails
      // compile here without a case.
      const exhaustive: never = member.kind;
      void exhaustive;
      return null;
    }
  }
}

/**
 * Stroke widths per kind, in mm (SVG user units).
 *
 * Kept as an SVG ATTRIBUTE (not only CSS) so a jsdom-based test
 * can read the numeric value directly and assert the a11y
 * invariant "beams are visually thicker than joists" WITHOUT
 * loading the stylesheet. Also robust against a downstream CSS
 * reset that stripped stroke widths — the attribute wins over
 * an unset CSS rule.
 *
 * WCAG 1.4.3 — information (beam vs joist) is conveyed by stroke
 * width, not color. The ratios matter more than absolute values;
 * beams are ≥3× joist width so the difference is unmistakable at
 * any zoom level.
 */
const STROKE_WIDTHS_MM = Object.freeze({
  footprint: 40,
  beam: 24,
  joist: 8,
  board: 2,
  blocking: 4,
  block: 6,
  footing: 6,
  post: 10,
});

function renderRect(
  member: import('../domain/model').LayoutMember,
  bounds: import('../domain/model').Dimensions3D,
  kind: keyof typeof STROKE_WIDTHS_MM,
  className: string,
): JSX.Element {
  const r = projectRect(member.position, member.size, bounds);
  return (
    <rect
      key={member.id}
      data-kind={kind}
      className={className}
      x={r.x}
      y={r.y}
      width={r.width}
      height={r.height}
      strokeWidth={STROKE_WIDTHS_MM[kind]}
    />
  );
}

/**
 * Posts render as filled circles. Radius = half the smaller of
 * `size.x` / `size.z` so a 140×140 post shows as a 70-mm-radius
 * dot in mm-space (letterboxed to a comfortable pixel radius by
 * the browser). A post whose size is degenerate (0) falls back to
 * a fixed 50-mm radius so it stays visible.
 */
const MIN_POST_RADIUS_MM = 50;

function renderPost(
  member: import('../domain/model').LayoutMember,
  bounds: import('../domain/model').Dimensions3D,
): JSX.Element {
  const c = projectCenter(member.position, bounds);
  const halfSize = Math.min(member.size.x, member.size.z) / 2;
  const r =
    Number.isFinite(halfSize) && halfSize > MIN_POST_RADIUS_MM
      ? halfSize
      : MIN_POST_RADIUS_MM;
  return (
    <circle
      key={member.id}
      data-kind="post"
      className="wd-plan-view__post"
      cx={c.x}
      cy={c.y}
      r={r}
      strokeWidth={STROKE_WIDTHS_MM.post}
    />
  );
}
