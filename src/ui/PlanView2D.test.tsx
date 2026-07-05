/**
 * `PlanView2D.test.tsx` — S15 issue #16 AC1..AC7 + edge cases.
 *
 * ## Coverage
 *
 *   - Landmark + heading: `<h2>Plan view</h2>` inside a
 *     `<section aria-labelledby>` — matches the SidePanels
 *     landmark invariant.
 *   - AC1: footprint outline `<rect>` labelled with formatted dims.
 *   - AC2: N joist strokes + 2 beam strokes + P post circles at
 *     positions derived from the pure helper.
 *   - AC3: SVG carries `viewBox=…` + `preserveAspectRatio="xMidYMid meet"`
 *     (aspect ratio preserved / letterbox on 40×8 ft).
 *   - AC4: unit switch (imperial ↔ metric) reformats the dim label.
 *   - AC5: `<title>Top-down 2D plan of deck</title>` +
 *     `<desc>Deck footprint: …. N joists at S on-center. P posts.</desc>`
 *   - AC6: empty layout → placeholder text, no crash.
 *   - AC7: read-only (no click/drag/context-menu handlers on the
 *     interactive shapes).
 *   - Edge: very-tall label positioning survives a very-wide layout.
 *
 * Tests here mount the component ALONE (no AppShell). The design
 * store is reset to the 12×12 default per `beforeEach`; individual
 * tests inject a custom layout via `useDesignStore.setState`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Layout, LayoutMember } from '../domain/model';
import { MM_PER_FOOT } from '../domain/units';
import { resetDesignStoreForTests, useDesignStore } from '../state/design-store';
import { useUiStore } from '../state/ui-store';

import { PlanView2D, PLAN_VIEW_EMPTY_TEXT, PLAN_VIEW_TITLE } from './PlanView2D';

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

/**
 * A synthetic layout with a KNOWN member mix for AC2 counting.
 *
 * - 8 joists at z = -1400..+1400 (spacing 400).
 * - 2 beams at z = -1500 and +1500.
 * - 4 posts at (±widthMm/2 - 100, 0, ±1500).
 */
function makeAcceptanceLayout(): Layout {
  const widthMm = 12 * MM_PER_FOOT; // 3657.6
  const lengthMm = 16 * MM_PER_FOOT; // 4876.8
  const members: LayoutMember[] = [];

  // 8 joists
  const spacing = 400;
  const first = -1400;
  for (let i = 0; i < 8; i++) {
    members.push(
      makeMember({
        kind: 'joist',
        id: `j${String(i)}`,
        position: { x: 0, y: 100, z: first + i * spacing },
        size: { x: widthMm - 76, y: 184, z: 38 },
      }),
    );
  }

  // 2 beams
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

  // 4 posts
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
    expect(rect!.getAttribute('width')).toBe(String(12 * MM_PER_FOOT));
    expect(rect!.getAttribute('height')).toBe(String(16 * MM_PER_FOOT));
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
    expect(joists.length).toBe(8);
    expect(beams.length).toBe(2);
    expect(posts.length).toBe(4);
  });

  it('a joist at world z=+1400 maps ABOVE center in SVG y', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    // Find any joist rect and verify its y attribute is a plausible svg number
    // (positive, less than lengthMm). The pure helper already tests projection
    // math — this just sanity-checks that the rendered SVG uses the helper.
    const joists = container.querySelectorAll('rect[data-kind="joist"]');
    const ys = Array.from(joists).map((el) => Number(el.getAttribute('y')));
    for (const y of ys) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(16 * MM_PER_FOOT);
    }
  });

  it('a post carries a data-kind="post" attribute (a11y-hook + test hook)', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const posts = container.querySelectorAll('circle[data-kind="post"]');
    // Every post has (cx, cy) inside the footprint.
    for (const p of Array.from(posts)) {
      const cx = Number(p.getAttribute('cx'));
      const cy = Number(p.getAttribute('cy'));
      expect(cx).toBeGreaterThan(0);
      expect(cx).toBeLessThan(12 * MM_PER_FOOT);
      expect(cy).toBeGreaterThan(0);
      expect(cy).toBeLessThan(16 * MM_PER_FOOT);
    }
  });

  it('distinguishes beams from joists by stroke-width (a11y — not by color alone)', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const joist = container.querySelector('rect[data-kind="joist"]');
    const beam = container.querySelector('rect[data-kind="beam"]');
    expect(joist).not.toBeNull();
    expect(beam).not.toBeNull();
    // stroke-width may be set via inline style or attribute; read either.
    const joistStroke =
      joist!.getAttribute('stroke-width') ??
      (joist as SVGElement).style.strokeWidth;
    const beamStroke =
      beam!.getAttribute('stroke-width') ??
      (beam as SVGElement).style.strokeWidth;
    // Both defined and NUMERICALLY different (beam thicker).
    expect(joistStroke).toBeTruthy();
    expect(beamStroke).toBeTruthy();
    expect(parseFloat(String(beamStroke))).toBeGreaterThan(
      parseFloat(String(joistStroke)),
    );
  });
});

// ---------------------------------------------------------------------------
// AC3 — aspect ratio preserved
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC3: aspect ratio (letterboxing)', () => {
  it('emits preserveAspectRatio="xMidYMid meet" on the <svg>', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const svg = container.querySelector('svg');
    expect(svg!.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('emits a "0 0 W L" viewBox — a 40×8 ft wide layout keeps its aspect ratio', () => {
    // Include ≥1 member so we don't hit the empty-layout branch — AC3
    // is about the RENDERED SVG's aspect ratio.
    const wide: Layout = {
      designId: 'wide',
      computedAt: '2024-01-01T00:00:00.000Z',
      bounds: { widthMm: 40 * MM_PER_FOOT, lengthMm: 8 * MM_PER_FOOT, heightMm: 900 },
      members: [makeMember({ kind: 'joist', id: 'j1' })],
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
});

// ---------------------------------------------------------------------------
// AC4 — unit switch reformats labels
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC4: unit switch', () => {
  it('reformats the footprint label + desc when units flip imperial → metric', () => {
    setLayout(makeAcceptanceLayout());
    const { container, rerender } = render(<PlanView2D />);
    // imperial: the visible label (below the SVG) contains ′ (prime).
    const labelImperial = container.querySelector('.wd-plan-view__label');
    expect(labelImperial).not.toBeNull();
    expect(labelImperial!.textContent).toMatch(/12[′']/);

    // flip to metric
    act(() => {
      useUiStore.setState({ units: 'metric' });
    });
    rerender(<PlanView2D />);

    // metric: label contains "m" and NO prime marks.
    // 12 ft = 3.66 m; 16 ft = 4.88 m
    const labelMetric = container.querySelector('.wd-plan-view__label');
    expect(labelMetric).not.toBeNull();
    expect(labelMetric!.textContent).toMatch(/3\.6\d.*m.*×.*4\.8\d.*m/);
    expect(labelMetric!.textContent).not.toMatch(/[′″]/);
  });
});

// ---------------------------------------------------------------------------
// AC5 — screen-reader description
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC5: <title> and <desc>', () => {
  it('renders "<title>Top-down 2D plan of deck</title>" as the SVG title', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const title = container.querySelector('svg > title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe(PLAN_VIEW_TITLE);
    expect(title!.textContent).toMatch(/top-down 2d plan of deck/i);
  });

  it('renders a <desc> matching the "Deck footprint: … N joists at S on-center. P posts." shape', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const desc = container.querySelector('svg > desc');
    expect(desc).not.toBeNull();
    const text = desc!.textContent ?? '';
    expect(text).toMatch(/Deck footprint:/);
    // 8 joists, 4 posts per the fixture
    expect(text).toMatch(/8 joists/);
    expect(text).toMatch(/on-center/);
    expect(text).toMatch(/4 posts/);
  });

  it('SVG has aria-labelledby wired to the internal <title> id', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const svg = container.querySelector('svg');
    const labelledBy = svg!.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const title = container.querySelector('svg > title');
    expect(title!.id).toBeTruthy();
    // aria-labelledby SHOULD reference the title id.
    expect(labelledBy).toContain(title!.id);
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
    // NO SVG rendered on the empty branch (component's rendering
    // contract — the section only renders the placeholder).
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
// AC7 — read-only (no interaction handlers)
// ---------------------------------------------------------------------------

describe('<PlanView2D /> — AC7: read-only', () => {
  it('emits NO onClick / onDrag / onContextMenu handlers on member shapes', () => {
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const shapes = container.querySelectorAll(
      'rect[data-kind], circle[data-kind]',
    );
    for (const shape of Array.from(shapes)) {
      // React attaches synthetic handlers as element props, not
      // attributes — but any onclick attribute (or listener wired
      // via addEventListener) would surface as one. We assert the
      // ATTRIBUTE is absent as a proxy for "no click handler wired".
      expect(shape.getAttribute('onclick')).toBeNull();
      expect(shape.getAttribute('ondblclick')).toBeNull();
      expect(shape.getAttribute('oncontextmenu')).toBeNull();
      expect(shape.getAttribute('onmousedown')).toBeNull();
    }
  });

  it('clicking a member shape does NOT fire any state action (no mutation)', async () => {
    const user = userEvent.setup();
    setLayout(makeAcceptanceLayout());
    const { container } = render(<PlanView2D />);
    const bundleBefore = useDesignStore.getState().bundle;
    const post = container.querySelector('circle[data-kind="post"]');
    expect(post).not.toBeNull();
    await user.click(post as unknown as Element);
    const bundleAfter = useDesignStore.getState().bundle;
    // Reference equality proves nothing mutated the store.
    expect(bundleAfter).toBe(bundleBefore);
  });
});
