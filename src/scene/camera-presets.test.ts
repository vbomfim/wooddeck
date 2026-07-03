/**
 * Unit tests for `src/scene/camera-presets.ts`.
 *
 * ## Why these tests are pure Node
 *
 * The camera-preset math intentionally lives in a framework-free
 * module — no `three`, no `react`, no `@react-three/*`. That means
 * every assertion below runs in raw jsdom/Node with plain numbers,
 * making the coordinate-frame contract testable without the
 * expensive r3f test-renderer harness (which we reserve for the
 * scene-graph structural tests in `CameraRig.test.tsx` and
 * `lighting.test.tsx`).
 *
 * ## Coordinate frame under test (spec § domain/model.ts)
 *
 *   +x = width (deck-width axis)
 *   +y = up   (height axis, world "up")
 *   +z = length (deck-length axis)
 *   origin (0,0,0) = ground-level CENTER of the footprint
 *   y = 0          = ground plane
 *   Euler XYZ, right-handed (three.js-native)
 *
 * Every camera pose we return is expected to obey this frame — the
 * target for auto-fit is the DECK CENTROID at (0, heightMm/2, 0),
 * and preset camera positions are chosen so the visible axes match
 * the user's mental model:
 *
 *   top   → looking straight down (-y); +z (length) points to screen "north"
 *   front → looking along -z toward +z; width horizontal, height vertical
 *   side  → looking along -x toward +x; length horizontal, height vertical
 *   iso   → 45° corner view from (+x,+y,+z) octant
 *   orbit → free orbit; initial pose is the iso corner (fit distance)
 *
 * ## AC coverage
 *
 *   AC2 preset views          → every describe('computePresetCamera',
 *                               '<preset>') block
 *   AC3 zoom limits           → describe('computeZoomLimits')
 *   AC4 auto-fit ~15% margin  → describe('computeAutoFitDistance')
 *   Edge cases (very small
 *   / very large deck)        → interspersed in each describe
 */
import { describe, expect, it } from 'vitest';

import {
  AUTOFIT_MARGIN,
  DEFAULT_FOV_DEG,
  PRESET_TRANSITION_MS,
  TOP_DOWN_FOV_DEG,
  computeAutoFitDistance,
  computePresetCamera,
  computeZoomLimits,
  type BoundsMm,
} from './camera-presets';

// ---------------------------------------------------------------------------
// Fixture bounds — three sizes exercise the "very small", "reference", and
// "very large" edge cases called out in the ticket.
// ---------------------------------------------------------------------------

// 4 ft × 4 ft × ~3 ft (mm-approximate) — the minimum sensible deck.
const TINY_BOUNDS: BoundsMm = { widthMm: 1219, lengthMm: 1219, heightMm: 900 };
// 20 ft × 30 ft × ~3 ft — the ticket's reference "typical" deck.
const REFERENCE_BOUNDS: BoundsMm = { widthMm: 6096, lengthMm: 9144, heightMm: 900 };
// 40 ft × 40 ft × 4 ft — the ticket's "very large" edge.
const LARGE_BOUNDS: BoundsMm = { widthMm: 12192, lengthMm: 12192, heightMm: 1219 };

// Numerical tolerance for float compares (mm-scale).
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Constants surface — every consumer (CameraRig + tests) reads these
// ---------------------------------------------------------------------------

describe('camera-presets constants', () => {
  it('AC4: AUTOFIT_MARGIN is the 15% ticket margin (0.15)', () => {
    // The ticket AC4 pins the margin at 15%; downstream callers rely on
    // this exact value so a preset transition and an auto-fit produce
    // the same fit distance for the same bounds.
    expect(AUTOFIT_MARGIN).toBeCloseTo(0.15, 10);
  });

  it('DEFAULT_FOV_DEG is a standard perspective FOV (30–75°)', () => {
    // Chosen to feel natural — three.js PerspectiveCamera default is 50°;
    // the exact number is a design decision, but it must sit in the
    // "natural human FOV" band, not a wide-angle or telephoto extreme.
    expect(DEFAULT_FOV_DEG).toBeGreaterThanOrEqual(30);
    expect(DEFAULT_FOV_DEG).toBeLessThanOrEqual(75);
  });

  it('TOP_DOWN_FOV_DEG is a NARROW FOV that approximates orthographic', () => {
    // Ticket §17 open-question resolution: top preset uses a
    // narrow-FOV perspective (orthographic-style) rather than swapping
    // to an OrthographicCamera. A narrow FOV (< 20°) telephoto-style
    // gives a near-parallel projection while keeping the single
    // camera instance the rest of the rig uses.
    expect(TOP_DOWN_FOV_DEG).toBeGreaterThan(0);
    expect(TOP_DOWN_FOV_DEG).toBeLessThan(20);
  });

  it('AC2 PRESET_TRANSITION_MS respects the ≤500 ms budget', () => {
    // The lerp must complete within 500 ms so a preset click feels
    // instant. Consumers use this constant to bound their `useFrame`
    // interpolation timer.
    expect(PRESET_TRANSITION_MS).toBeGreaterThan(0);
    expect(PRESET_TRANSITION_MS).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// computeAutoFitDistance — AC4 15% margin around the bounding sphere
// ---------------------------------------------------------------------------

describe('computeAutoFitDistance', () => {
  it('AC4: fits the bounding sphere with a 15% margin at the default FOV', () => {
    // Distance from target such that the bounding-sphere half-angle
    // subtends (1 + margin) × the vertical FOV half-angle:
    //     d = R × (1 + m) / tan(vFov / 2)
    // where R = ½ × diagonal(width, length, height).
    const { widthMm, lengthMm, heightMm } = REFERENCE_BOUNDS;
    const radius = Math.sqrt(widthMm ** 2 + lengthMm ** 2 + heightMm ** 2) / 2;
    const halfFovRad = (DEFAULT_FOV_DEG / 2) * (Math.PI / 180);
    const expected = (radius * (1 + AUTOFIT_MARGIN)) / Math.tan(halfFovRad);

    expect(computeAutoFitDistance(REFERENCE_BOUNDS)).toBeCloseTo(expected, 3);
  });

  it('accepts an explicit fov and margin override (used by top preset)', () => {
    // The top-down preset passes its narrower FOV so the auto-fit
    // distance grows appropriately (narrower FOV → farther camera to
    // frame the same footprint).
    const dDefault = computeAutoFitDistance(REFERENCE_BOUNDS);
    const dNarrow = computeAutoFitDistance(REFERENCE_BOUNDS, TOP_DOWN_FOV_DEG);
    // Narrower FOV → same object requires MORE distance to fit.
    expect(dNarrow).toBeGreaterThan(dDefault);
  });

  it('scales linearly with bounds size — 2× bounds → 2× distance', () => {
    // Purely geometric — doubling every dimension doubles the radius,
    // hence doubles the fit distance for a fixed FOV & margin.
    const d1 = computeAutoFitDistance(REFERENCE_BOUNDS);
    const d2 = computeAutoFitDistance({
      widthMm: REFERENCE_BOUNDS.widthMm * 2,
      lengthMm: REFERENCE_BOUNDS.lengthMm * 2,
      heightMm: REFERENCE_BOUNDS.heightMm * 2,
    });
    expect(d2 / d1).toBeCloseTo(2, 6);
  });

  it('Edge: works for a tiny 4×4 ft deck (still 15% margin)', () => {
    const d = computeAutoFitDistance(TINY_BOUNDS);
    // Sanity: greater than the biggest half-dimension (camera can never
    // sit inside the box) and finite.
    expect(d).toBeGreaterThan(TINY_BOUNDS.lengthMm / 2);
    expect(Number.isFinite(d)).toBe(true);
  });

  it('Edge: works for a very large 40×40 ft deck', () => {
    const d = computeAutoFitDistance(LARGE_BOUNDS);
    expect(d).toBeGreaterThan(LARGE_BOUNDS.lengthMm / 2);
    expect(Number.isFinite(d)).toBe(true);
  });

  it('rejects a zero-volume bounds (would divide by zero on radius) — returns > 0', () => {
    // Degenerate case: a "deck" with all dimensions zero has radius 0,
    // which would collapse the camera onto the target. Guard: return
    // a positive minimum distance so the OrbitControls minDistance
    // doesn't clip on a fresh-boot bug.
    const d = computeAutoFitDistance({ widthMm: 0, lengthMm: 0, heightMm: 0 });
    expect(d).toBeGreaterThan(0);
    expect(Number.isFinite(d)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeZoomLimits — AC3 orbit / zoom / pan
// ---------------------------------------------------------------------------

describe('computeZoomLimits', () => {
  it('AC3: minDistance = ½ × smallest deck dimension', () => {
    const { minDistance } = computeZoomLimits(REFERENCE_BOUNDS);
    const smallest = Math.min(
      REFERENCE_BOUNDS.widthMm,
      REFERENCE_BOUNDS.lengthMm,
      REFERENCE_BOUNDS.heightMm,
    );
    expect(minDistance).toBeCloseTo(smallest / 2, EPS);
  });

  it('AC3: maxDistance = 5 × largest deck dimension', () => {
    const { maxDistance } = computeZoomLimits(REFERENCE_BOUNDS);
    const largest = Math.max(
      REFERENCE_BOUNDS.widthMm,
      REFERENCE_BOUNDS.lengthMm,
      REFERENCE_BOUNDS.heightMm,
    );
    expect(maxDistance).toBeCloseTo(largest * 5, EPS);
  });

  it('always returns minDistance < maxDistance (invariant for OrbitControls)', () => {
    for (const b of [TINY_BOUNDS, REFERENCE_BOUNDS, LARGE_BOUNDS]) {
      const { minDistance, maxDistance } = computeZoomLimits(b);
      expect(minDistance).toBeLessThan(maxDistance);
    }
  });

  it('Edge: zero-volume bounds → still yields a positive, valid range', () => {
    // Defensive: a boot-time bug that sets bounds to zero must not
    // hand OrbitControls a min = max = 0 (which would freeze zoom).
    const { minDistance, maxDistance } = computeZoomLimits({
      widthMm: 0,
      lengthMm: 0,
      heightMm: 0,
    });
    expect(minDistance).toBeGreaterThan(0);
    expect(maxDistance).toBeGreaterThan(minDistance);
  });
});

// ---------------------------------------------------------------------------
// computePresetCamera — AC2 preset views (coordinate-frame contract)
// ---------------------------------------------------------------------------

describe('computePresetCamera', () => {
  // Every preset targets the deck centroid: (0, height/2, 0). Assert
  // this once, at the top, so per-preset blocks stay focused on
  // camera-position semantics.
  it.each(['orbit', 'top', 'front', 'side', 'iso'] as const)(
    '%s: target is the deck centroid (0, height/2, 0)',
    (preset) => {
      const pose = computePresetCamera(preset, REFERENCE_BOUNDS);
      expect(pose.target[0]).toBeCloseTo(0, EPS);
      expect(pose.target[1]).toBeCloseTo(REFERENCE_BOUNDS.heightMm / 2, EPS);
      expect(pose.target[2]).toBeCloseTo(0, EPS);
    },
  );

  it.each(['orbit', 'top', 'front', 'side', 'iso'] as const)(
    '%s: camera up vector is world +y for non-top, world +z for top',
    (preset) => {
      const pose = computePresetCamera(preset, REFERENCE_BOUNDS);
      if (preset === 'top') {
        // Top-down looks along -y, so up cannot be ±y — use +z so
        // deck LENGTH renders as screen-vertical ("north" on the plan).
        expect(pose.up).toEqual([0, 0, 1]);
      } else {
        expect(pose.up).toEqual([0, 1, 0]);
      }
    },
  );

  describe('top preset', () => {
    it('AC2: camera sits ABOVE the target on the +y axis (looks down -y)', () => {
      const pose = computePresetCamera('top', REFERENCE_BOUNDS);
      // Directly above target: x=0, z=0, y > target.y
      expect(pose.position[0]).toBeCloseTo(0, EPS);
      expect(pose.position[2]).toBeCloseTo(0, EPS);
      expect(pose.position[1]).toBeGreaterThan(pose.target[1]);
    });

    it('uses the narrow (orthographic-style) FOV', () => {
      const pose = computePresetCamera('top', REFERENCE_BOUNDS);
      expect(pose.fovDeg).toBe(TOP_DOWN_FOV_DEG);
    });

    it('AC4: camera height respects the 15% auto-fit margin at the top FOV', () => {
      const pose = computePresetCamera('top', REFERENCE_BOUNDS);
      const expectedDist = computeAutoFitDistance(REFERENCE_BOUNDS, TOP_DOWN_FOV_DEG);
      // Camera y = target.y + fit distance
      expect(pose.position[1]).toBeCloseTo(pose.target[1] + expectedDist, 3);
    });
  });

  describe('front preset', () => {
    it('AC2: camera sits on the +z axis of the target (looks along -z)', () => {
      const pose = computePresetCamera('front', REFERENCE_BOUNDS);
      // Front = looking along -z at the deck; camera at (0, cy, +distance)
      expect(pose.position[0]).toBeCloseTo(0, EPS);
      expect(pose.position[1]).toBeCloseTo(pose.target[1], EPS);
      expect(pose.position[2]).toBeGreaterThan(0);
    });

    it('uses the DEFAULT FOV', () => {
      const pose = computePresetCamera('front', REFERENCE_BOUNDS);
      expect(pose.fovDeg).toBe(DEFAULT_FOV_DEG);
    });

    it('AC4: camera distance from target matches the auto-fit distance', () => {
      const pose = computePresetCamera('front', REFERENCE_BOUNDS);
      const expected = computeAutoFitDistance(REFERENCE_BOUNDS);
      expect(pose.position[2]).toBeCloseTo(expected, 3);
    });
  });

  describe('side preset', () => {
    it('AC2: camera sits on the +x axis of the target (looks along -x)', () => {
      const pose = computePresetCamera('side', REFERENCE_BOUNDS);
      // Side = looking along -x at the deck; camera at (+distance, cy, 0)
      expect(pose.position[1]).toBeCloseTo(pose.target[1], EPS);
      expect(pose.position[2]).toBeCloseTo(0, EPS);
      expect(pose.position[0]).toBeGreaterThan(0);
    });

    it('AC4: camera x-distance from target matches the auto-fit distance', () => {
      const pose = computePresetCamera('side', REFERENCE_BOUNDS);
      const expected = computeAutoFitDistance(REFERENCE_BOUNDS);
      expect(pose.position[0]).toBeCloseTo(expected, 3);
    });
  });

  describe('iso preset (and orbit default pose)', () => {
    it('AC2: iso camera sits in the (+x, +y, +z) octant, all components equal', () => {
      const pose = computePresetCamera('iso', REFERENCE_BOUNDS);
      // A 45° corner has equal x/y/z offsets from target — the offset
      // vector normalised is (1,1,1)/√3.
      const dx = pose.position[0] - pose.target[0];
      const dy = pose.position[1] - pose.target[1];
      const dz = pose.position[2] - pose.target[2];
      expect(dx).toBeGreaterThan(0);
      expect(dy).toBeGreaterThan(0);
      expect(dz).toBeGreaterThan(0);
      // The three offsets are numerically equal (45° isometric).
      expect(dx).toBeCloseTo(dy, 3);
      expect(dy).toBeCloseTo(dz, 3);
    });

    it('AC4: iso camera distance from target matches the auto-fit distance', () => {
      const pose = computePresetCamera('iso', REFERENCE_BOUNDS);
      const dx = pose.position[0] - pose.target[0];
      const dy = pose.position[1] - pose.target[1];
      const dz = pose.position[2] - pose.target[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      expect(dist).toBeCloseTo(computeAutoFitDistance(REFERENCE_BOUNDS), 3);
    });

    it("orbit's initial pose is IDENTICAL to iso (auto-fit corner view)", () => {
      // 'orbit' is the free-orbit mode; on first mount / bounds change
      // the camera snaps to a sensible starting pose — we reuse iso so
      // the user sees the whole deck the moment the scene appears.
      const iso = computePresetCamera('iso', REFERENCE_BOUNDS);
      const orbit = computePresetCamera('orbit', REFERENCE_BOUNDS);
      expect(orbit).toEqual(iso);
    });
  });

  it('re-uses the same POSE SHAPE for every preset (no missing fields)', () => {
    // Structural guard: consumers rely on { position, target, up,
    // fovDeg } being present on every preset return.
    for (const preset of ['orbit', 'top', 'front', 'side', 'iso'] as const) {
      const pose = computePresetCamera(preset, REFERENCE_BOUNDS);
      expect(pose).toHaveProperty('position');
      expect(pose).toHaveProperty('target');
      expect(pose).toHaveProperty('up');
      expect(pose).toHaveProperty('fovDeg');
      expect(pose.position).toHaveLength(3);
      expect(pose.target).toHaveLength(3);
      expect(pose.up).toHaveLength(3);
      expect(Number.isFinite(pose.fovDeg)).toBe(true);
    }
  });

  it('Edge: tiny deck yields a valid, finite pose for every preset', () => {
    for (const preset of ['orbit', 'top', 'front', 'side', 'iso'] as const) {
      const pose = computePresetCamera(preset, TINY_BOUNDS);
      expect(pose.position.every(Number.isFinite)).toBe(true);
      expect(pose.target.every(Number.isFinite)).toBe(true);
    }
  });

  it('Edge: large deck yields a valid, finite pose for every preset', () => {
    for (const preset of ['orbit', 'top', 'front', 'side', 'iso'] as const) {
      const pose = computePresetCamera(preset, LARGE_BOUNDS);
      expect(pose.position.every(Number.isFinite)).toBe(true);
      expect(pose.target.every(Number.isFinite)).toBe(true);
    }
  });
});
