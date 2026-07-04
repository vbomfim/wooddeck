/**
 * Unit tests for `src/scene/layers/shared/geometries.ts` — the
 * shared unit-box geometry singleton.
 *
 * ## Coverage map
 *
 *   Fix D  `UNIT_BOX_GEOMETRY` is a valid `BoxGeometry` with
 *          full-extent (1, 1, 1) dimensions.
 *   HMR    `disposeSharedGeometry` releases the GPU handle
 *          (test-only helper, never called in production — see
 *          `BoxMember.tsx` module header on disposal).
 *   S22    `DECK_BLOCK_GEOMETRY` + `TUFFBLOCK_GEOMETRY` +
 *          `disposeSharedGeometries` — the block-layer additions
 *          (Epic 2 / S22). AC4 (hex silhouette) is asserted here
 *          via the radial-segments count.
 */
import { describe, expect, it } from 'vitest';
import { BoxGeometry, CylinderGeometry } from 'three';

import {
  DECK_BLOCK_GEOMETRY,
  TUFFBLOCK_GEOMETRY,
  UNIT_BOX_GEOMETRY,
  disposeSharedGeometries,
  disposeSharedGeometry,
} from './geometries';

describe('shared geometries', () => {
  it('UNIT_BOX_GEOMETRY is a THREE.BoxGeometry', () => {
    expect(UNIT_BOX_GEOMETRY).toBeInstanceOf(BoxGeometry);
    expect(UNIT_BOX_GEOMETRY.type).toBe('BoxGeometry');
  });

  it('UNIT_BOX_GEOMETRY has unit-cube parameters (1, 1, 1) — full extent', () => {
    // `BoxGeometry.parameters` echoes the constructor args.
    // Asserting them protects against a future refactor that
    // silently switches to half-extent (0.5, 0.5, 0.5) or
    // otherwise breaks the `<mesh scale={size}/>` contract.
    expect(UNIT_BOX_GEOMETRY.parameters.width).toBe(1);
    expect(UNIT_BOX_GEOMETRY.parameters.height).toBe(1);
    expect(UNIT_BOX_GEOMETRY.parameters.depth).toBe(1);
  });

  it('UNIT_BOX_GEOMETRY has the expected 24-vertex indexed buffer', () => {
    // A cube: 6 faces × 4 vertices = 24 vertices; 6 faces × 2
    // triangles × 3 indices = 36 indices. If a future switch to
    // a different primitive changes the buffer sizes, this test
    // flags the change.
    const positionAttr = UNIT_BOX_GEOMETRY.getAttribute('position');
    expect(positionAttr.count).toBe(24);
    const index = UNIT_BOX_GEOMETRY.getIndex();
    expect(index?.count).toBe(36);
  });

  it('disposeSharedGeometry calls .dispose() on the module singleton (HMR helper)', () => {
    // Wrap `dispose` with a spy — the test-only helper's contract
    // is that it calls through. We restore the original method
    // after the test so subsequent tests using the shared geometry
    // are unaffected.
    let disposeCallCount = 0;
    const originalDispose = UNIT_BOX_GEOMETRY.dispose.bind(UNIT_BOX_GEOMETRY);
    UNIT_BOX_GEOMETRY.dispose = () => {
      disposeCallCount++;
    };
    try {
      disposeSharedGeometry();
      expect(disposeCallCount).toBe(1);
    } finally {
      UNIT_BOX_GEOMETRY.dispose = originalDispose;
    }
  });
});

// ---------------------------------------------------------------------------
// S22 — block-layer shared geometries (Epic 2 / FR-029)
// ---------------------------------------------------------------------------
//
// The two block products the MVP stocks each have their own shared
// geometry primitive:
//
//   - Oldcastle 11×11×7 precast concrete block → BoxGeometry(1,1,1)
//     (cube — indistinguishable by shape from `UNIT_BOX_GEOMETRY`,
//     but kept as a separate export so a future refactor can
//     independently swap the concrete-block representation without
//     dragging the framing-member geometry along).
//   - TuffBlock 12×12×4 polypropylene puck → CylinderGeometry with
//     `radialSegments = 6` = HEXAGONAL top-down silhouette
//     (matches the user's drawing — AC4). Top-radius < bottom-radius
//     = truncated pyramid form when viewed from the side.
//
// Every block mesh in the scene binds one of these two shared
// buffers; per-instance size is applied via `<mesh scale>`.
// ---------------------------------------------------------------------------

describe('shared geometries — S22 block-layer primitives', () => {
  describe('DECK_BLOCK_GEOMETRY (Oldcastle precast block — box)', () => {
    it('is a THREE.BoxGeometry', () => {
      expect(DECK_BLOCK_GEOMETRY).toBeInstanceOf(BoxGeometry);
      expect(DECK_BLOCK_GEOMETRY.type).toBe('BoxGeometry');
    });

    it('has unit-cube parameters (1, 1, 1) so <mesh scale={size}> gives full-extent', () => {
      // Ticket §2 — DECK_BLOCK_GEOMETRY = new BoxGeometry(1,1,1),
      // per-instance scaled to Oldcastle dims. If a refactor
      // silently swaps to half-extents, every deck block would
      // render at half its catalog size — the visual mismatch
      // would be subtle. This test locks in the full-extent
      // convention (matches UNIT_BOX_GEOMETRY).
      expect(DECK_BLOCK_GEOMETRY.parameters.width).toBe(1);
      expect(DECK_BLOCK_GEOMETRY.parameters.height).toBe(1);
      expect(DECK_BLOCK_GEOMETRY.parameters.depth).toBe(1);
    });

    it('is a distinct instance from UNIT_BOX_GEOMETRY (independent lifecycle)', () => {
      // Shape-identical, IDENTITY-distinct — the two geometries
      // can be swapped / disposed independently without collateral.
      expect(DECK_BLOCK_GEOMETRY).not.toBe(UNIT_BOX_GEOMETRY);
    });
  });

  describe('TUFFBLOCK_GEOMETRY (polypropylene puck — hex frustum)', () => {
    it('is a THREE.CylinderGeometry', () => {
      expect(TUFFBLOCK_GEOMETRY).toBeInstanceOf(CylinderGeometry);
      expect(TUFFBLOCK_GEOMETRY.type).toBe('CylinderGeometry');
    });

    it('has EXACTLY 6 radial segments — hex silhouette (AC4)', () => {
      // The ticket's AC4 pins the hexagon: a top-down orthographic
      // view of a TuffBlock is a hexagon (6 straight edges). This
      // is the numerical property that guarantees it — three.js's
      // CylinderGeometry with `radialSegments = 6` produces a
      // 6-sided prism / frustum. A refactor that widens to 16 or
      // 32 segments would break the drawing match.
      expect(TUFFBLOCK_GEOMETRY.parameters.radialSegments).toBe(6);
    });

    it('has height = 1 (unit-scaled by <mesh scale.y>)', () => {
      // Same discipline as DECK_BLOCK_GEOMETRY / UNIT_BOX_GEOMETRY:
      // one unit tall, per-instance stretched to the block's
      // catalog height by the mesh scale prop. No arithmetic in
      // the layer.
      expect(TUFFBLOCK_GEOMETRY.parameters.height).toBe(1);
    });

    it('top-radius < bottom-radius — truncated-pyramid taper (AC4 side view)', () => {
      // TuffBlock's cast form tapers slightly from a wider bottom
      // to a narrower top — visible in the side view. If a
      // refactor sets both radii equal (regular hex prism), the
      // taper disappears and the side view looks like a hex tube
      // instead of a puck.
      expect(TUFFBLOCK_GEOMETRY.parameters.radiusTop).toBeLessThan(
        TUFFBLOCK_GEOMETRY.parameters.radiusBottom,
      );
    });

    it('bottom-radius = 0.5 so <mesh scale={[widthMm, heightMm, depthMm]}> gives full-extent diameter', () => {
      // three.js CylinderGeometry radii define the geometry's
      // extent along X and Z (Y is the cylinder axis). A radius
      // of 0.5 makes the bottom face a unit-diameter hex — scaling
      // by `widthMm` in the mesh scale prop then produces the
      // full-extent block width. This is the same "unit primitive
      // scaled per instance" contract as UNIT_BOX_GEOMETRY.
      expect(TUFFBLOCK_GEOMETRY.parameters.radiusBottom).toBe(0.5);
    });
  });

  describe('disposeSharedGeometries (S22 cleanup helper — plural)', () => {
    it('calls .dispose() on all three shared geometries', () => {
      // The ticket §2 asks for a plural `disposeSharedGeometries()`
      // helper that tears down every shared geometry the scene
      // owns — the pre-existing UNIT_BOX_GEOMETRY plus the two
      // block additions. Test-only helper (HMR / test rebuild
      // scenarios) — production tabs reclaim GPU handles on
      // teardown.
      let unitCount = 0;
      let deckBlockCount = 0;
      let tuffCount = 0;
      const originalUnit = UNIT_BOX_GEOMETRY.dispose.bind(UNIT_BOX_GEOMETRY);
      const originalDeckBlock = DECK_BLOCK_GEOMETRY.dispose.bind(DECK_BLOCK_GEOMETRY);
      const originalTuff = TUFFBLOCK_GEOMETRY.dispose.bind(TUFFBLOCK_GEOMETRY);
      UNIT_BOX_GEOMETRY.dispose = () => {
        unitCount++;
      };
      DECK_BLOCK_GEOMETRY.dispose = () => {
        deckBlockCount++;
      };
      TUFFBLOCK_GEOMETRY.dispose = () => {
        tuffCount++;
      };
      try {
        disposeSharedGeometries();
        expect(unitCount).toBe(1);
        expect(deckBlockCount).toBe(1);
        expect(tuffCount).toBe(1);
      } finally {
        UNIT_BOX_GEOMETRY.dispose = originalUnit;
        DECK_BLOCK_GEOMETRY.dispose = originalDeckBlock;
        TUFFBLOCK_GEOMETRY.dispose = originalTuff;
      }
    });
  });
});
