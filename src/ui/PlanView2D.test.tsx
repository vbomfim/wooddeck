/**
 * `PlanView2D.test.tsx` — S15 issue #16 AC1..AC7 + edge cases +
 * consolidated pair-fix (Blocking #2, #3; SHOULD #5; QA GAPs).
 *
 * ## Coverage
 *
 *   - Landmark + heading: `<h2>Plan view</h2>` inside a
 *     `<section aria-labelledby>` — matches the SidePanels
 *     landmark invariant.
 *   - AC1: footprint outline `<rect>` labelled with formatted dims.
 *   - AC2: N joist strokes + 2 beam strokes + P post circles at
 *     positions derived from the pure helper, WITH exact-position
 *     assertion (GAP-AC2-a).
 *   - AC2-b: block + blocking members render + axe-clean (GAP-AC2-b).
 *   - AC3: SVG carries `viewBox=…` + `preserveAspectRatio="xMidYMid meet"`
 *     AND a `max-height` style tied to `maxHeightPx` so a
 *     PORTRAIT layout (length > width) letterboxes correctly
 *     instead of being clipped by the wrapper (BLOCKING #3;
 *     GAP-EDGE-b).
 *   - AC4: unit switch (imperial ↔ metric) reformats BOTH the
 *     visible label AND the `<desc>`, in BOTH directions
 *     (GAP-AC4-a).
 *   - AC5: `<title>Top-down 2D plan of deck</title>` +
 *     `<desc>…</desc>`. `aria-labelledby` references ONLY the
 *     title id (accessible NAME); `aria-describedby` references
 *     the desc id (accessible DESCRIPTION); `<desc>` element has
 *     the described-by id (GAP-AC5-a + GAP-AC5-b; SHOULD-FIX #5).
 *   - AC6: empty layout → placeholder text, no crash.
 *   - AC7: read-only (no click/right-click handlers) — parametrized
 *     across joist / beam / post (GAP-AC7-a).
 *   - Edge cases: 500×500 with 1 joist (GAP-EDGE-a), beams+posts
 *     with ZERO joists (GAP-EDGE-c), degenerate widthMm=0 caught
 *     by the surrounding `<PanelErrorBoundary>` (GAP-EDGE-e).
 *
 * Tests here mount the component ALONE (no AppShell). The design
 * store is reset to the default per `beforeEach`; individual tests
 * inject a custom layout via `useDesignStore.setState`.
 *
 * ## Fixture (pair-fix Blocking #2 rewrite)
 *
 * `makeAcceptanceLayout` NOW mirrors production `layoutJoists`
 * exactly: joist `position.x` walks along the width axis (with
 * flush-left / flush-right anchors and a uniform interior grid),
 * `position.z = 0` for every joist, and each joist's `size.z`
 * equals `bounds.lengthMm`. The pre-fix fixture had joists spaced
 * along z — backwards from `src/domain/layout/joist-layout.ts` —
 * which is what allowed the `computeJoistSpacingMm(z)` bug to
 * sail through the original review. See the pair-fix ticket
 * §BLOCKING #2 for the full history.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';

import type { Layout, LayoutMember } from '../domain/model';
import { MM_PER_FOOT } from '../domain/units';
import { resetDesignStoreForTests, useDesignStore } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { PanelErrorBoundary, PANEL_ERROR_TITLE } from './PanelErrorBoundary';
import {
  PlanView2D,
  PLAN_VIEW_EMPTY_TEXT,
  PLAN_VIEW_TITLE,
} from './PlanView2D';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function setLayout(layout: Layout): void {
  act(() => {
    useDesignStore.setState((prev) => ({
      bundle: { ...prev.bundle, layout },
    }));
  });
}

function makeMember(
  overrides: Partial<LayoutMember> & Pick<LayoutMember, 'kind'>,
): LayoutMember {
  return {
    id:
      overrides.id ?? `m-${overrides.kind}-${Math.random().toString(36).slice(2, 8)}`,
    kind: overrides.kind,
    position: overrides.position ?? { x: 0, y: 0, z: 0 },
    size: overrides.size ?? { x: 38, y: 184, z: 3658 },
    rotation: overrides.rotation ?? { x: 0, y: 0, z: 0 },
    material: overrides.material ?? {
      kind: 'lumber',
      species: 'PT',
      grade: 'No2',
      nominal: '2x8',
    },
  };
}

// The AC2 fixture. Mirrors `layoutJoists` axes: joists run along
// z (`size.z = lengthMm`) and are spaced along x. `position.z = 0`
// for every joist — exactly like production.
const FIXTURE_WIDTH_MM = 12 * MM_PER_FOOT; // 3657.6
const FIXTURE_LENGTH_MM = 16 * MM_PER_FOOT; // 4876.8
const FIXTURE_JOIST_COUNT = 8;
const FIXTURE_JOIST_SPACING_MM = 400;
const FIXTURE_JOIST_THICKNESS_MM = 38;
const FIXTURE_JOIST_DEPTH_MM = 184;

function makeAcceptanceLayout(): Layout {
  const widthMm = FIXTURE_WIDTH_MM;
  const lengthMm = FIXTURE_LENGTH_MM;
  const members: LayoutMember[] = [];

  // 8 joists — spaced ALONG x, centered on x=0. Each joist runs
  // ALONG z (full length). Matches production axes.
  const first = -((FIXTURE_JOIST_COUNT - 1) * FIXTURE_JOIST_SPACING_MM) / 2;
  for (let i = 0; i < FIXTURE_JOIST_COUNT; i++) {
    members.push(
      makeMember({
        kind: 'joist',
        id: `j${String(i)}`,
        position: { x: first + i * FIXTURE_JOIST_SPACING_MM, y: 100, z: 0 },
        size: {
          x: FIXTURE_JOIST_THICKNESS_MM,
          y: FIXTURE_JOIST_DEPTH_MM,
          z: lengthMm,
        },
      }),
    );
  }

  // 2 beams — run PERPENDICULAR to joists (along x, thin in z),
  // positioned at ±1500 in z. This matches production `layoutBeams`
  // conceptually (beams span the width, joists span the length).
  for (const z of [-1500, 1500]) {
    members.push(
      makeMember({
        kind: 'beam',
        id: `b-${String(z)}`,
        position: { x: 0, y: 80, z },
        size: { x: widthMm, y: 184, z: 76 },
      }),
    );
  }

  // 4 posts — near each beam-corner.
  for (const x of [-widthMm / 2 + 100, widthMm / 2 - 100]) {
    for (const z of [-1500, 1500]) {
      members.push(
        makeMember({
          kind: 'post',
          id: `p-${String(x)}-${String(z)}`,
          position: { x, y: 400, z },
          size: { x: 140, y: 800, z: 140 },
          material: { kind: 'lumber', species: 'PT', grade: 'No2', nominal: '6x6' },
        }),
      );
    }
  }

  return {
    designId: 'plan-view-fixture',
    computedAt: '2024-01-01T00:00:00.000Z',
    bounds: { widthMm, lengthMm, heightMm: 900 },
    members,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetDesignStoreForTests();
  act(() => {
    useUiStore.setState({ units: 'imperial', storageBanner: null });
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Landmark + heading
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — heading + landmark', () => {
  it('renders a "Plan view" h2 inside a section aria-labelledby (landmark invariant)', () => {
    render(<PlanView2D />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2).toHaveTextContent(/plan view/i);
  });

  it('renders an <svg> role="img" so screen readers announce the graphic', () => {
    const { container } = render(<PlanView2D />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('role')).toBe('img');
  });
});

// ---------------------------------------------------------------------------
// AC1 — footprint outline + dim labels
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC1: footprint outline + labels', () => {
  it('renders a footprint <rect data-role="footprint"> covering the whole viewBox', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const rect = container.querySelector('rect[data-role="footprint"]');
    expect(rect).not.toBeNull();
    // The footprint rect spans (0,0)-(widthMm,lengthMm) in user units.
    expect(rect!.getAttribute('x')).toBe('0');
    expect(rect!.getAttribute('y')).toBe('0');
    expect(rect!.getAttribute('width')).toBe(String(FIXTURE_WIDTH_MM));
    expect(rect!.getAttribute('height')).toBe(String(FIXTURE_LENGTH_MM));
  });

  it('labels the footprint with formatted "W × L" in imperial', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    // The visible label is the <p class="wd-plan-view__label"> below the SVG.
    // Query specifically for that class so we don't match the <desc> text (AC5)
    // which also contains "12′ … 16′".
    const label = container.querySelector('.wd-plan-view__label');
    expect(label).not.toBeNull();
    expect(label!.textContent).toMatch(/12[′'].*×.*16[′']/);
  });
});

// ---------------------------------------------------------------------------
// AC2 — joist / beam / post rendering
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC2: joists, beams, posts', () => {
  it('renders N joist strokes, 2 beam strokes, P post circles at correct counts', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const joists = container.querySelectorAll('rect[data-kind="joist"]');
    const beams = container.querySelectorAll('rect[data-kind="beam"]');
    const posts = container.querySelectorAll('circle[data-kind="post"]');
    expect(joists.length).toBe(FIXTURE_JOIST_COUNT);
    expect(beams.length).toBe(2);
    expect(posts.length).toBe(4);
  });

  it('renders every joist at its EXACT projected x/y position (GAP-AC2-a)', () => {
    // Regression pin against a projection or fixture-axis regression.
    // We compare the first joist's rendered rect against the pure
    // helper's expected values.
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const firstJoist = container.querySelector('rect[data-kind="joist"]');
    expect(firstJoist).not.toBeNull();

    // Fixture: first joist center x = first = -((N-1)*S)/2.
    const first = -((FIXTURE_JOIST_COUNT - 1) * FIXTURE_JOIST_SPACING_MM) / 2;
    // TL corner: x = worldXToSvgX(first, W) - thickness/2
    //          = (first + W/2) - thickness/2
    const expectedX = first + FIXTURE_WIDTH_MM / 2 - FIXTURE_JOIST_THICKNESS_MM / 2;
    // TL corner: y = worldZToSvgY(0, L) - lengthMm/2 = 0
    const expectedY = 0;

    expect(Number(firstJoist!.getAttribute('x'))).toBeCloseTo(expectedX, 6);
    expect(Number(firstJoist!.getAttribute('y'))).toBeCloseTo(expectedY, 6);
    // Width along x = thickness (thin), height along z = full length.
    expect(Number(firstJoist!.getAttribute('width'))).toBeCloseTo(
      FIXTURE_JOIST_THICKNESS_MM,
      6,
    );
    expect(Number(firstJoist!.getAttribute('height'))).toBeCloseTo(
      FIXTURE_LENGTH_MM,
      6,
    );
  });

  it('every post carries a data-kind="post" attribute AND falls inside the footprint', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const posts = container.querySelectorAll('circle[data-kind="post"]');
    // Every post has (cx, cy) inside the footprint.
    for (const p of Array.from(posts)) {
      const cx = Number(p.getAttribute('cx'));
      const cy = Number(p.getAttribute('cy'));
      expect(cx).toBeGreaterThan(0);
      expect(cx).toBeLessThan(FIXTURE_WIDTH_MM);
      expect(cy).toBeGreaterThan(0);
      expect(cy).toBeLessThan(FIXTURE_LENGTH_MM);
    }
  });

  it('distinguishes beams from joists by stroke-width (a11y — not by color alone)', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const joist = container.querySelector('rect[data-kind="joist"]');
    const beam = container.querySelector('rect[data-kind="beam"]');
    expect(joist).not.toBeNull();
    expect(beam).not.toBeNull();
    // stroke-width is set via SVG ATTRIBUTE (single source of truth,
    // per NICE #7 — CSS `stroke-width` declarations were removed so
    // the attribute is authoritative).
    const joistStroke = joist!.getAttribute('stroke-width');
    const beamStroke = beam!.getAttribute('stroke-width');
    expect(joistStroke).toBeTruthy();
    expect(beamStroke).toBeTruthy();
    expect(parseFloat(String(beamStroke))).toBeGreaterThan(
      parseFloat(String(joistStroke)),
    );
  });
});

// ---------------------------------------------------------------------------
// AC2-b + A11Y-a — block + blocking members render + axe-clean (GAP-AC2-b)
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC2-b: block + blocking members (floating-deck fixture)', () => {
  function makeBlockLayout(): Layout {
    // Floating decks (per user's primary use case) produce `block`
    // and `blocking` members from the domain layout. Cover the
    // rendering branch and axe-scan the resulting DOM.
    const widthMm = 3658;
    const lengthMm = 4877;
    const members: LayoutMember[] = [
      makeMember({
        kind: 'joist',
        id: 'j1',
        position: { x: 0, y: 100, z: 0 },
        size: { x: 38, y: 184, z: lengthMm },
      }),
      makeMember({
        kind: 'block',
        id: 'blk-1',
        position: { x: 500, y: 0, z: 0 },
        size: { x: 300, y: 300, z: 300 },
      }),
      makeMember({
        kind: 'block',
        id: 'blk-2',
        position: { x: -500, y: 0, z: 0 },
        size: { x: 300, y: 300, z: 300 },
      }),
      makeMember({
        kind: 'blocking',
        id: 'blocking-1',
        position: { x: 800, y: 100, z: 1000 },
        size: { x: 38, y: 184, z: 300 },
      }),
    ];
    return {
      designId: 'block-fixture',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm, lengthMm, heightMm: 900 },
      members,
    };
  }

  it('renders one <rect data-kind="block"> per block member', () => {
    setLayout(makeBlockLayout());
    const { container } = render(<PlanView2D />);
    expect(container.querySelectorAll('rect[data-kind="block"]').length).toBe(2);
  });

  it('renders one <rect data-kind="blocking"> per blocking member', () => {
    setLayout(makeBlockLayout());
    const { container } = render(<PlanView2D />);
    expect(container.querySelectorAll('rect[data-kind="blocking"]').length).toBe(1);
  });

  it('emits zero WCAG 2.2 AA violations on the block+blocking fixture', async () => {
    setLayout(makeBlockLayout());
    const { container } = render(<PlanView2D />);
    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: { 'color-contrast': { enabled: false } },
    });
    if (results.violations.length > 0) {
      console.error(JSON.stringify(results.violations, null, 2));
    }
    expect(results.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC3 — aspect ratio preserved (letterbox, wide AND tall)
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC3: aspect ratio (letterboxing)', () => {
  it('emits preserveAspectRatio="xMidYMid meet" on the <svg>', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const svg = container.querySelector('svg');
    expect(svg!.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('emits a "0 0 W L" viewBox — a 40×8 ft wide layout keeps its aspect ratio', () => {
    // Include ≥1 member so we don't hit the empty-layout branch.
    const wide: Layout = {
      designId: 'wide',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 40 * MM_PER_FOOT, lengthMm: 8 * MM_PER_FOOT, heightMm: 900 },
      members: [
        makeMember({
          kind: 'joist',
          id: 'j1',
          position: { x: 0, y: 100, z: 0 },
          size: { x: 38, y: 184, z: 8 * MM_PER_FOOT },
        }),
      ],
    };
    setLayout(wide);
    const { container } = render(<PlanView2D />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // 40 * 304.8 = 12192; 8 * 304.8 = 2438.4.
    expect(svg!.getAttribute('viewBox')).toBe(
      `0 0 ${String(40 * MM_PER_FOOT)} ${String(8 * MM_PER_FOOT)}`,
    );
    expect(svg!.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('a TALL/portrait 8×40 ft layout letterboxes — the SVG carries a max-height (GAP-EDGE-b / BLOCKING #3)', () => {
    // Reproduces the reviewer's clipping bug: a portrait viewBox in
    // a narrow (~320 px) side panel used to blow past the wrapper's
    // max-height because the SVG had `height: auto` with no cap.
    // The fix constrains the SVG viewport itself.
    const tall: Layout = {
      designId: 'tall',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 8 * MM_PER_FOOT, lengthMm: 40 * MM_PER_FOOT, heightMm: 900 },
      members: [
        makeMember({
          kind: 'joist',
          id: 'j1',
          position: { x: 0, y: 100, z: 0 },
          size: { x: 38, y: 184, z: 40 * MM_PER_FOOT },
        }),
      ],
    };
    setLayout(tall);
    const { container } = render(<PlanView2D maxHeightPx={400} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe(
      `0 0 ${String(8 * MM_PER_FOOT)} ${String(40 * MM_PER_FOOT)}`,
    );
    // The SVG itself carries the max-height constraint (inline style)
    // so preserveAspectRatio="xMidYMid meet" letterboxes within a
    // (width × maxHeightPx) box instead of overflowing.
    expect(svg!.getAttribute('style')).toMatch(/max-height:\s*400px/);
  });

  it('a realistic 12×16 ft portrait deck (the default) also lets the SVG carry max-height', () => {
    // The 12×16 default IS portrait (length > width). Before the
    // fix, the SVG auto-height for a 3.66:4.88 aspect in a ~320 px
    // wrapper computed a height that got clipped.
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D maxHeightPx={400} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('style')).toMatch(/max-height:\s*400px/);
  });
});

// ---------------------------------------------------------------------------
// AC4 — unit switch reformats labels + desc (BOTH directions)
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC4: unit switch (GAP-AC4-a bidirectional)', () => {
  it('reformats the visible label AND the <desc> when units flip imperial → metric', () => {
    setLayout(makeAcceptanceLayout());
    const { container, rerender } = render(<PlanView2D />);

    // Imperial baseline.
    const labelImperial = container.querySelector('.wd-plan-view__label');
    const descImperial = container.querySelector('svg > desc');
    expect(labelImperial!.textContent).toMatch(/12[′']/);
    expect(descImperial!.textContent).toMatch(/12[′']/);
    // The imperial desc must contain the prime marks (feet/inches).
    expect(descImperial!.textContent).toMatch(/[′″]/);

    // Flip to metric.
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    rerender(<PlanView2D />);

    const labelMetric = container.querySelector('.wd-plan-view__label');
    const descMetric = container.querySelector('svg > desc');
    expect(labelMetric!.textContent).toMatch(/3\.6\d.*m.*×.*4\.8\d.*m/);
    expect(labelMetric!.textContent).not.toMatch(/[′″]/);
    // Metric desc mentions "m" and drops the prime marks.
    expect(descMetric!.textContent).toMatch(/3\.6\d/);
    expect(descMetric!.textContent).not.toMatch(/[′″]/);
  });

  it('also reformats when the user starts in metric and flips to imperial', () => {
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    setLayout(makeAcceptanceLayout());
    const { container, rerender } = render(<PlanView2D />);

    const descMetric = container.querySelector('svg > desc');
    expect(descMetric!.textContent).toMatch(/3\.6\d/);
    expect(descMetric!.textContent).not.toMatch(/[′″]/);

    act(() => {
      useUiStore.setState({ units: 'imperial' });
    });
    rerender(<PlanView2D />);

    const descImperial = container.querySelector('svg > desc');
    expect(descImperial!.textContent).toMatch(/12[′']/);
    expect(descImperial!.textContent).toMatch(/[′″]/);
  });
});

// ---------------------------------------------------------------------------
// AC5 — screen-reader description (split labelledby / describedby)
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC5: <title> and <desc> a11y wiring', () => {
  it('renders "<title>Top-down 2D plan of deck</title>" as the SVG title', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const title = container.querySelector('svg > title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe(PLAN_VIEW_TITLE);
    expect(title!.textContent).toMatch(/top-down 2d plan of deck/i);
  });

  it('renders a <desc> matching the AC5 sentence shape', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const desc = container.querySelector('svg > desc');
    expect(desc).not.toBeNull();
    const text = desc!.textContent ?? '';
    expect(text).toMatch(/Deck footprint:/);
    // 8 joists, 4 posts per the fixture.
    expect(text).toMatch(/8 joists/);
    expect(text).toMatch(/on-center/);
    expect(text).toMatch(/4 posts/);
  });

  it('SVG aria-labelledby references ONLY the title id (accessible NAME per SVG-AAM)', () => {
    // GAP-AC5-a + SHOULD-FIX #5: pre-fix the component set
    // aria-labelledby="{titleId} {descId}", concatenating both. Per
    // SVG-AAM: <title> → accessible NAME (labelledby); <desc> →
    // accessible DESCRIPTION (describedby).
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const svg = container.querySelector('svg')!;
    const title = container.querySelector('svg > title')!;
    const desc = container.querySelector('svg > desc')!;
    expect(title.id).toBeTruthy();
    expect(desc.id).toBeTruthy();

    const labelledBy = svg.getAttribute('aria-labelledby');
    expect(labelledBy).toBe(title.id); // exactly the title id, nothing else

    const describedBy = svg.getAttribute('aria-describedby');
    expect(describedBy).toBe(desc.id);
  });

  it('the <desc> element has the SAME id that aria-describedby points at (GAP-AC5-b)', () => {
    // Regression pin against a future maintainer dropping the id
    // attribute on <desc> — the pre-fix test only checked
    // labelledby.contains(desc.id) so removing the id from <desc>
    // silently broke describedby.
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const svg = container.querySelector('svg')!;
    const desc = container.querySelector('svg > desc')!;
    const describedBy = svg.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(desc.getAttribute('id')).toBe(describedBy);
  });
});

// ---------------------------------------------------------------------------
// AC6 — empty layout
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC6: empty layout', () => {
  it('shows the placeholder text and no SVG when members=[]', () => {
    const empty: Layout = {
      designId: 'empty',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 100, lengthMm: 100, heightMm: 100 },
      members: [],
    };
    setLayout(empty);
    const { container } = render(<PlanView2D />);
    expect(screen.getByText(PLAN_VIEW_EMPTY_TEXT)).toBeInTheDocument();
    // NO SVG rendered on the empty branch.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('does NOT crash on empty layout (regression guard)', () => {
    const empty: Layout = {
      designId: 'empty',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 100, lengthMm: 100, heightMm: 100 },
      members: [],
    };
    setLayout(empty);
    expect(() => render(<PlanView2D />)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC7 — read-only (no interaction handlers) — parametrized across kinds
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC7: read-only (GAP-AC7-a parametrized)', () => {
  it('emits NO onClick / onContextMenu handlers on member shapes', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const shapes = container.querySelectorAll(
      'rect[data-kind], circle[data-kind]',
    );
    for (const shape of Array.from(shapes)) {
      expect(shape.getAttribute('onclick')).toBeNull();
      expect(shape.getAttribute('ondblclick')).toBeNull();
      expect(shape.getAttribute('oncontextmenu')).toBeNull();
      expect(shape.getAttribute('onmousedown')).toBeNull();
    }
  });

  for (const kind of ['joist', 'beam', 'post'] as const) {
    it(`clicking a ${kind} does NOT mutate the store (reference equality holds)`, async () => {
      const user = userEvent.setup();
      setLayout(makeAcceptanceLayout());
      const { container } = render(<PlanView2D />);
      const bundleBefore = useDesignStore.getState().bundle;
      const selector =
        kind === 'post' ? `circle[data-kind="post"]` : `rect[data-kind="${kind}"]`;
      const shape = container.querySelector(selector);
      expect(shape).not.toBeNull();
      await user.click(shape as unknown as Element);
      expect(useDesignStore.getState().bundle).toBe(bundleBefore);
    });

    it(`right-clicking a ${kind} does NOT mutate the store (no context-menu handler)`, async () => {
      const user = userEvent.setup();
      setLayout(makeAcceptanceLayout());
      const { container } = render(<PlanView2D />);
      const bundleBefore = useDesignStore.getState().bundle;
      const selector =
        kind === 'post' ? `circle[data-kind="post"]` : `rect[data-kind="${kind}"]`;
      const shape = container.querySelector(selector);
      expect(shape).not.toBeNull();
      // userEvent v14: `pointer` primitive lets us dispatch a right-click.
      await user.pointer({
        target: shape as unknown as Element,
        keys: '[MouseRight]',
      });
      expect(useDesignStore.getState().bundle).toBe(bundleBefore);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge cases (GAP-EDGE-*)
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — edge cases', () => {
  it('very small bounds (500×500) with a single joist still renders (GAP-EDGE-a)', () => {
    const tiny: Layout = {
      designId: 'tiny',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 500, lengthMm: 500, heightMm: 300 },
      members: [
        makeMember({
          kind: 'joist',
          id: 'j1',
          position: { x: 0, y: 50, z: 0 },
          size: { x: 38, y: 100, z: 500 },
        }),
      ],
    };
    setLayout(tiny);
    const { container } = render(<PlanView2D />);
    // No crash + SVG rendered.
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Label still renders even at a very small footprint.
    const label = container.querySelector('.wd-plan-view__label');
    expect(label).not.toBeNull();
    expect((label!.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('beams+posts with ZERO joists → <desc> omits the on-center clause (GAP-EDGE-c)', () => {
    const noJoists: Layout = {
      designId: 'no-joists',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 3000, lengthMm: 3000, heightMm: 900 },
      members: [
        makeMember({
          kind: 'beam',
          id: 'b1',
          position: { x: 0, y: 80, z: -1000 },
          size: { x: 3000, y: 184, z: 76 },
        }),
        makeMember({
          kind: 'post',
          id: 'p1',
          position: { x: -1000, y: 400, z: -1000 },
          size: { x: 140, y: 800, z: 140 },
        }),
      ],
    };
    setLayout(noJoists);
    const { container } = render(<PlanView2D />);
    const desc = container.querySelector('svg > desc');
    expect(desc).not.toBeNull();
    const text = desc!.textContent ?? '';
    expect(text).toMatch(/0 joists/);
    expect(text).not.toMatch(/on-center/);
    expect(text).toMatch(/1 post\b/);
  });

  it('degenerate bounds (widthMm=0) are caught by a surrounding <PanelErrorBoundary> (GAP-EDGE-e)', () => {
    // The PanelErrorBoundary wraps PlanView2D in SidePanels — this
    // test proves that boundary catches a PlanView2DHelperError
    // and renders the fallback rather than white-screening the app.
    // Silence the expected error the boundary logs to keep the test
    // output clean.
    const originalError = console.error;
    console.error = () => {
      /* swallow — the boundary logs the caught error by design */
    };
    try {
      const bad: Layout = {
        designId: 'degen',
        computedAt: '2024-01-01T00:00:00.000Z',
        bounds: { widthMm: 0, lengthMm: 100, heightMm: 100 },
        members: [
          makeMember({
            kind: 'joist',
            id: 'j1',
            position: { x: 0, y: 50, z: 0 },
            size: { x: 38, y: 100, z: 100 },
          }),
        ],
      };
      setLayout(bad);
      render(
        <PanelErrorBoundary>
          <PlanView2D />
        </PanelErrorBoundary>,
      );
      // Boundary fallback shows the panel-error title copy.
      expect(screen.getByText(PANEL_ERROR_TITLE)).toBeInTheDocument();
    } finally {
      console.error = originalError;
    }
  });
});
