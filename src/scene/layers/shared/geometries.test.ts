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
import { BoxGeometry, CylinderGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';

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

    it('bottom-radius = 0.5 (pre-normalization vertex-vertex diameter — before X-axis AABB stretch)', () => {
      // The unit-space HEXAGON's vertex-to-vertex diameter equals
      // `2 · radiusBottom` = 1.0 in the Z axis (three.js CylinderGeometry
      // puts the first cap vertex on +Z). After the module-level
      // AABB-normalization pre-scale (see geometries.ts JSDoc), the
      // flat-flat X axis is stretched by `2/√3` so BOTH X and Z spans
      // = 1.0. This test locks in the pre-normalization radius param
      // — the SCALED-AABB regression test below (GPT#1) locks in the
      // post-normalization X/Z equality that BlocksLayer's <mesh scale>
      // relies on.
      expect(TUFFBLOCK_GEOMETRY.parameters.radiusBottom).toBe(0.5);
    });

    // ---- HIGH (GPT#1) regression: SCALED AABB must be square -----
    //
    // The raw `CylinderGeometry(0.4, 0.5, 1, 6)` produces a hex
    // frustum whose X and Z extents are NOT equal:
    //
    //   - Six vertices at angles 0°, 60°, 120°, 180°, 240°, 300°
    //     (three.js CylinderGeometry's default thetaStart = 0).
    //   - Bottom-face max |x| = 0.5·cos(0°) = 0.5    →  X span 1.0
    //   - Bottom-face max |z| = 0.5·sin(60°) = ~0.433 → Z span ~0.866
    //
    // So a `<mesh scale={[305, 102, 305]}/>` would render the block
    // at ≈ 305 × 264 mm instead of the catalog 305 × 305 (a ~13%
    // undersize on the Z axis). GPT#1 caught the miss.
    //
    // The fix: normalize the hex frustum so its unit-space AABB is
    // exactly 1 × 1 in X and Z BEFORE per-instance scaling. Two
    // tests: one checks the raw unit AABB is 1×1; the other applies
    // the catalog scale and verifies the world AABB is 305×102×305.
    // ---------------------------------------------------------------

    it('unit-space bounding box X and Z spans are BOTH exactly 1.0 (hex-AABB normalized — GPT#1)', () => {
      // Compute the geometry's bounding box directly. A regular
      // hexagon has X and Z spans that differ by the cos-30° factor
      // — the pre-scale in the geometry constructor MUST cancel
      // that so both spans land on 1.0.
      TUFFBLOCK_GEOMETRY.computeBoundingBox();
      const bbox = TUFFBLOCK_GEOMETRY.boundingBox!;
      const xSpan = bbox.max.x - bbox.min.x;
      const zSpan = bbox.max.z - bbox.min.z;
      const EPSILON = 1e-6;
      expect(xSpan).toBeGreaterThan(1 - EPSILON);
      expect(xSpan).toBeLessThan(1 + EPSILON);
      expect(zSpan).toBeGreaterThan(1 - EPSILON);
      expect(zSpan).toBeLessThan(1 + EPSILON);
      // Y span is trivially 1.0 (height parameter).
      const ySpan = bbox.max.y - bbox.min.y;
      expect(ySpan).toBeGreaterThan(1 - EPSILON);
      expect(ySpan).toBeLessThan(1 + EPSILON);
    });

    it('scaled TuffBlock footprint is 305 × 102 × 305 mm (catalog full-extent — GPT#1 regression)', () => {
      // Simulate what `BlocksLayer` does: put the geometry inside a
      // mesh, scale to the catalog dims (305 × 102 × 305 mm), and
      // ask three.js for the WORLD-space bounding box. A correctly
      // normalized unit geometry will produce a bbox of exactly
      // 305 mm × 102 mm × 305 mm (within a small floating-point
      // epsilon). A non-normalized hex would produce something like
      // 305 × 102 × 264 — a ~13% Z-axis undersize.
      const mesh = new Mesh(TUFFBLOCK_GEOMETRY, new MeshBasicMaterial());
      mesh.scale.set(305, 102, 305);
      mesh.updateMatrixWorld(true);

      // Walk every position-attribute vertex through the world matrix
      // to compute the world-space AABB. `geometry.boundingBox` is
      // in local space; the mesh's scale doesn't automatically propagate.
      const positionAttr = TUFFBLOCK_GEOMETRY.getAttribute('position');
      const v = new Vector3();
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < positionAttr.count; i++) {
        v.fromBufferAttribute(positionAttr, i);
        v.applyMatrix4(mesh.matrixWorld);
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
        if (v.z > maxZ) maxZ = v.z;
      }
      const xSpan = maxX - minX;
      const ySpan = maxY - minY;
      const zSpan = maxZ - minZ;
      const EPSILON = 1e-3; // 1 μm tolerance at mm scale
      expect(xSpan).toBeGreaterThan(305 - EPSILON);
      expect(xSpan).toBeLessThan(305 + EPSILON);
      expect(ySpan).toBeGreaterThan(102 - EPSILON);
      expect(ySpan).toBeLessThan(102 + EPSILON);
      expect(zSpan).toBeGreaterThan(305 - EPSILON);
      expect(zSpan).toBeLessThan(305 + EPSILON);
    });

    it('preserves the 6-vertex hex silhouette after AABB normalization (AC4 not regressed)', () => {
      // The AABB normalization stretches the Z axis by a factor of
      // 2/√3 ≈ 1.155 so the flat-flat axis matches the vertex-vertex
      // axis. This stretches the regular hexagon into an ELONGATED
      // hexagon — still a 6-sided silhouette, still `radialSegments
      // === 6` in the constructor params. AC4 asks for a hex
      // top-down silhouette; that's preserved.
      expect(TUFFBLOCK_GEOMETRY.parameters.radialSegments).toBe(6);
    });
  });

  describe('DECK_BLOCK_GEOMETRY — scaled AABB check (parallel to TuffBlock, unit box should be 279 × 178 × 279)', () => {
    it('scaled Oldcastle footprint is 279 × 178 × 279 mm (catalog full-extent)', () => {
      // Sanity — a unit BoxGeometry with per-instance scale of the
      // Oldcastle dims MUST give the catalog AABB. This is trivial
      // for a box (unit-cube AABB is already 1×1×1), but keeping
      // the test in parallel with the TuffBlock scaled-AABB check
      // documents the discipline: the two block primitives share
      // one "scale gives catalog dims" contract.
      const mesh = new Mesh(DECK_BLOCK_GEOMETRY, new MeshBasicMaterial());
      mesh.scale.set(279, 178, 279);
      mesh.updateMatrixWorld(true);

      const positionAttr = DECK_BLOCK_GEOMETRY.getAttribute('position');
      const v = new Vector3();
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < positionAttr.count; i++) {
        v.fromBufferAttribute(positionAttr, i);
        v.applyMatrix4(mesh.matrixWorld);
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
        if (v.z > maxZ) maxZ = v.z;
      }
      const EPSILON = 1e-3;
      expect(maxX - minX).toBeGreaterThan(279 - EPSILON);
      expect(maxX - minX).toBeLessThan(279 + EPSILON);
      expect(maxY - minY).toBeGreaterThan(178 - EPSILON);
      expect(maxY - minY).toBeLessThan(178 + EPSILON);
      expect(maxZ - minZ).toBeGreaterThan(279 - EPSILON);
      expect(maxZ - minZ).toBeLessThan(279 + EPSILON);
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
