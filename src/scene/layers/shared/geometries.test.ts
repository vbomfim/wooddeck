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
 */
import { describe, expect, it } from 'vitest';
import { BoxGeometry } from 'three';

import { UNIT_BOX_GEOMETRY, disposeSharedGeometry } from './geometries';

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
