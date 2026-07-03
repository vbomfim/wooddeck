/**
 * `src/scene/layers/__testing__/fixtures.ts` — test-only builders for
 * `Layout` / `LayoutMember` values consumed by the scene-layer tests.
 *
 * ## Why NOT reuse `src/domain/layout/__fixtures__/`
 *
 * The domain layout fixtures are golden goldens — every field is
 * pinned to a specific numeric value derived from the layout engine.
 * A scene test that iterates them would (a) drag hundreds of members
 * per fixture through r3f test-renderer for zero incremental
 * confidence, and (b) couple scene tests to the layout engine's
 * output shape (a change to spacing math would ripple into scene
 * assertions unrelated to visibility).
 *
 * These helpers construct SMALL `Layout` objects with a KNOWN
 * `kind`-count (e.g. "give me 3 joists and 2 beams") so scene tests
 * can assert exact mesh counts and identity without stampeding
 * through 150 decking boards.
 *
 * ## Boundary discipline
 *
 * This file lives under `src/scene/layers/__testing__/` — it is
 * imported ONLY by `*.test.tsx` files inside `src/scene/layers/`,
 * which are excluded from the dep-cruiser cruise (see
 * `.dependency-cruiser.cjs` `exclude.path: '\\.test\\.'`). So the
 * layer files themselves never see these helpers.
 *
 * ## Fields
 *
 * Positions and sizes are hand-picked so a test can eyeball a
 * failed assertion (e.g. "position.x = 1000" rather than "position.x
 * = 1234.5678"). All values are in millimeters per the domain frame
 * (`domain/model.ts` "LAYOUT COORDINATE FRAME").
 */

import type { Layout, LayoutMember, MaterialRef, MemberKind } from '../../../domain/model';

/**
 * Default material — used when a fixture caller does not care about
 * the species. Every scene-layer test that cares picks its own.
 */
export const FIXTURE_MATERIAL_PT: MaterialRef = Object.freeze({
  nominal: '2x8',
  species: 'PT',
  grade: 'No2',
});

export const FIXTURE_MATERIAL_CEDAR: MaterialRef = Object.freeze({
  nominal: '2x8',
  species: 'Cedar',
  grade: 'No2',
});

export const FIXTURE_MATERIAL_COMPOSITE: MaterialRef = Object.freeze({
  nominal: '5/4x6',
  species: 'Composite',
  grade: 'NA',
});

/**
 * Build one `LayoutMember` with sensible defaults; override with
 * partial fields. Every scene test uses this to construct fixtures
 * that put ONE numeric value in a spot the assertion checks.
 */
export function makeMember(overrides: Partial<LayoutMember> & Pick<LayoutMember, 'id' | 'kind'>): LayoutMember {
  return {
    material: FIXTURE_MATERIAL_PT,
    position: { x: 0, y: 100, z: 0 },
    size: { x: 100, y: 100, z: 100 },
    rotation: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

/**
 * Build a `Layout` with an arbitrary member array. Callers pass a
 * `designId` when they want to correlate a warning to a member —
 * scene-layer tests don't, so it defaults to a fixed sentinel.
 */
export function makeLayout(members: readonly LayoutMember[], designId = 'fixture-design'): Layout {
  return {
    designId,
    computedAt: '2026-07-03T00:00:00.000Z',
    bounds: { widthMm: 1000, lengthMm: 2000, heightMm: 900 },
    members,
  };
}

/**
 * Convenience: build N members of a given kind with unique ids and
 * distinct positions along +x so a test can assert per-member
 * position without collisions. Positions step by 200 mm; sizes are
 * fixed 100×100×100. Rotations are all zero.
 */
export function makeMembers(kind: MemberKind, count: number): LayoutMember[] {
  const out: LayoutMember[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      makeMember({
        id: `${kind}-${i}`,
        kind,
        position: { x: i * 200, y: 100, z: 0 },
      }),
    );
  }
  return out;
}
