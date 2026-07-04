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
 * ## Boundary discipline (SHARED scene test fixtures)
 *
 * Despite living under `src/scene/layers/__testing__/`, this file
 * is imported by `*.test.tsx` files across the whole scene tree:
 *
 *   - `src/scene/layers/**` — the original consumers (S10)
 *   - `src/scene/WarningOverlay.test.tsx` (S11) — pulls
 *     `makeWarning` + `makeMember` + `makeLayout`
 *   - future scene tests that need small Layout / Warning fixtures
 *
 * Test files are excluded from the dep-cruiser cruise (see
 * `.dependency-cruiser.cjs` `exclude.path: '\\.test\\.'`), so a
 * highlight/overlay test file importing
 * `../layers/__testing__/fixtures` is legal EVEN THOUGH the S11
 * `warning-overlay-no-layers` production rule forbids the same
 * import from a non-test file. The layer files themselves still
 * never see these helpers — they're test-only.
 *
 * We keep the fixtures in one place rather than duplicating a
 * `highlights/__testing__/` folder — one canonical `makeMember`
 * / `makeLayout` / `makeWarning` avoids drift.
 *
 * ## Fields
 *
 * Positions and sizes are hand-picked so a test can eyeball a
 * failed assertion (e.g. "position.x = 1000" rather than "position.x
 * = 1234.5678"). All values are in millimeters per the domain frame
 * (`domain/model.ts` "LAYOUT COORDINATE FRAME").
 */

import type { Layout, LayoutMember, LumberMemberMaterial, MemberKind, Warning } from '../../../domain/model';

/**
 * Default material — used when a fixture caller does not care about
 * the species. Every scene-layer test that cares picks its own.
 *
 * ## S17 — MemberMaterialRef widening
 *
 * Scene-layer fixtures MUST return `LumberMemberMaterial` (`kind:'lumber'`)
 * — the scene layers under test render lumber members. Block-typed
 * members belong to a separate layer (see Epic 2 / S22).
 */
export const FIXTURE_MATERIAL_PT: LumberMemberMaterial = Object.freeze({
  kind: 'lumber',
  nominal: '2x8',
  species: 'PT',
  grade: 'No2',
});

export const FIXTURE_MATERIAL_CEDAR: LumberMemberMaterial = Object.freeze({
  kind: 'lumber',
  nominal: '2x8',
  species: 'Cedar',
  grade: 'No2',
});

export const FIXTURE_MATERIAL_COMPOSITE: LumberMemberMaterial = Object.freeze({
  kind: 'lumber',
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

/**
 * Build one `Warning` with sensible defaults. `memberId` is the
 * required field — every warning references the LayoutMember it
 * decorates. Callers override any field via the partial argument.
 *
 * ## Why this helper lives with the layout fixtures
 *
 * S11's `<WarningOverlay>` tests need `Warning[]` fixtures paired
 * with the members they reference. Rather than replicate the
 * `makeMember` / `makeLayout` builders in a separate `highlights/
 * __testing__/` folder, we keep the whole "small scene fixture"
 * kit in ONE file — every scene test (layer OR overlay) imports
 * from this one path. Test files are excluded from dep-cruiser
 * (see `.dependency-cruiser.cjs` `exclude.path: '\\.test\\.'`),
 * so a highlight test file importing from
 * `../layers/__testing__/fixtures` is legal even though the S11
 * `warning-overlay-no-layers` production rule forbids the same
 * import from a non-test file.
 */
export function makeWarning(overrides: Partial<Warning> & Pick<Warning, 'memberId'>): Warning {
  return {
    kind: 'over-span-joist',
    actualMm: 3200,
    allowableMm: 3000,
    tableReference: 'IRC-2018 Table R502.3.1(1) — SPF No2 2x8 @ 406 mm o.c.',
    message: 'Joist span 3200 mm exceeds allowable 3000 mm',
    ...overrides,
  };
}
