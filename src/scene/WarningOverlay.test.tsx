/**
 * Unit tests for `src/scene/WarningOverlay.tsx`.
 *
 * ## Coverage map (S11 issue #12)
 *
 *   AC1  N warnings → N `<OverSpanHighlight>` decorations at the
 *        corresponding members' positions. Asserted on LIVE
 *        `THREE.Mesh` instances (finding the meshes inside the
 *        overlay group and matching their positions to the source
 *        members) — NOT on props alone, matching the S9/S10
 *        live-scene-graph pattern.
 *   AC2  (CRITICAL) — visibility is INDEPENDENT of
 *        `useUiStore.layerVisibility`. Toggling
 *        `layerVisibility.joists` off does NOT hide the overlay's
 *        highlight meshes or flip the overlay group's `visible`
 *        flag. Proved at the STATE level — the overlay can't
 *        import JoistsLayer (S11 finding #7 forbids it), so the
 *        proof is: "no matter how we mutate `layerVisibility`,
 *        the overlay's rendered scene graph is unchanged".
 *   AC4  Zero warnings → the overlay renders an empty group; no
 *        meshes.
 *   AC5  Reactive — mutating `bundle.warnings` in the store
 *        updates the highlight count within one render tick.
 *   Edge Warning references a `memberId` not in the layout →
 *        skip silently (no crash) AND log a `console.warn` in
 *        dev so a developer sees the stale reference.
 *   §S12  Root group carries a `userData.wooddeck/warningOverlay`
 *        marker so the composed `<DeckScene>` in S12 can pick
 *        out the overlay group at scene-graph inspection time
 *        (mirrors the S10 layer `LAYER_USER_DATA_KEY` pattern).
 *
 * ## AC2 independence at the STATE level
 *
 * The S11 boundary rule (finding #7) forbids WarningOverlay from
 * importing any file under `src/scene/layers/**`. That means we
 * CANNOT render a JoistsLayer alongside the overlay in these
 * tests — the test file is exempt from the cruise, but rendering
 * the layer would defeat the point of the assertion (we'd be
 * proving "these two components render independently" instead of
 * "the overlay's rendering never depends on layer visibility
 * state"). Rendering the overlay alone AND toggling
 * `layerVisibility` proves the CORRECT property: the overlay's
 * output is a pure function of `bundle.warnings` +
 * `bundle.layout.members`, unrelated to any layer's visibility
 * flag. If the overlay ever grows an inline
 * `useUiStore(s => s.layerVisibility.<x>)` dependency, this
 * test flips red.
 */
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Group, Mesh } from 'three';

import { useDesignStore, useUiStore } from '../state';
import { resetDesignStoreForTests } from '../state/design-store';

import { makeLayout, makeMember, makeWarning } from './layers/__testing__/fixtures';
import { WARNING_OVERLAY_USER_DATA_KEY, WarningOverlay } from './WarningOverlay';

async function withAct(fn: () => void): Promise<void> {
  await ReactThreeTestRenderer.act(async () => {
    fn();
    await Promise.resolve();
  });
}

/**
 * Type alias for a `vi.spyOn(console, 'warn')` return value. We
 * avoid `ReturnType<typeof vi.spyOn<Console, 'warn'>>` because
 * Vitest's generic overloads want the object type to extend
 * `Console` (which the TS runtime `console` object literal
 * doesn't do cleanly under strict mode). `MockInstance` is
 * Vitest's own public export and works without extra ceremony.
 */
type ConsoleWarnSpy = MockInstance<(...args: unknown[]) => void>;

/**
 * Filter a console.warn spy to ONLY our overlay's diagnostic
 * payloads. r3f + three.js emit unrelated `console.warn`s (e.g.
 * `THREE.Clock` deprecation notices at first render) that would
 * otherwise pollute assertions on call counts and distinct
 * payload sets. Filtering to our namespaced prefix keeps the
 * assertions diagnostic.
 */
function overlayWarnCalls(spy: ConsoleWarnSpy): string[] {
  return spy.mock.calls
    .map((call: unknown[]) => call.map((a) => String(a)).join(' '))
    .filter((s: string) => s.includes('[WarningOverlay]'));
}

/**
 * Pull every quoted memberId out of a console.warn spy's captured
 * call payloads (filtered to our overlay's payloads only). The
 * dev diagnostic logs match the shape
 * `[WarningOverlay] warning references unknown memberId '<id>' — …`
 * so a single-quoted-string regex is precise + robust.
 */
function extractLoggedMemberIds(spy: ConsoleWarnSpy): Set<string> {
  const ids = new Set<string>();
  for (const line of overlayWarnCalls(spy)) {
    const m = /'([^']+)'/.exec(line);
    if (m !== null) ids.add(m[1]!);
  }
  return ids;
}

function resetLayerVisibility(): void {
  useUiStore.setState({
    layerVisibility: {
      environment: true,
      decking: true,
      joists: true,
      beams: true,
      posts: true,
      footings: true,
      blocks: true,
      blocking: true,
    },
  });
}

function seedBundle(params: {
  members: Parameters<typeof makeLayout>[0];
  warnings: ReturnType<typeof makeWarning>[];
}): void {
  const cur = useDesignStore.getState().bundle;
  useDesignStore.setState({
    bundle: {
      ...cur,
      layout: makeLayout(params.members),
      warnings: params.warnings,
    },
  });
}

function findOverlayGroup(
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
): Group {
  // The overlay stamps `userData[WARNING_OVERLAY_USER_DATA_KEY] =
  // 'warning-overlay'` onto its root <group>. Walk all Group
  // instances and pick the stamped one — robust against internal
  // r3f wrapper groups.
  const groups = renderer.scene.findAllByType('Group').map((n) => n.instance as Group);
  const overlay = groups.find(
    (g) => g.userData[WARNING_OVERLAY_USER_DATA_KEY] === 'warning-overlay',
  );
  if (overlay === undefined) {
    throw new Error(
      `overlay group not found — expected a <Group> with userData['${WARNING_OVERLAY_USER_DATA_KEY}'] === 'warning-overlay'`,
    );
  }
  return overlay;
}

describe('<WarningOverlay /> — AC1 highlight per warning', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('renders exactly N highlight meshes for N warnings referencing valid members', async () => {
    // Three over-span joists in the layout, one warning each →
    // exactly three highlight meshes in the overlay group.
    const members = [
      makeMember({ id: 'joist-0', kind: 'joist', position: { x: -1000, y: 200, z: 0 } }),
      makeMember({ id: 'joist-1', kind: 'joist', position: { x: 0, y: 200, z: 0 } }),
      makeMember({ id: 'joist-2', kind: 'joist', position: { x: 1000, y: 200, z: 0 } }),
    ];
    const warnings = [
      makeWarning({ memberId: 'joist-0' }),
      makeWarning({ memberId: 'joist-1' }),
      makeWarning({ memberId: 'joist-2' }),
    ];
    seedBundle({ members, warnings });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(3);
    await renderer.unmount();
  });

  it('each highlight mesh sits at its warned member.position exactly', async () => {
    const members = [
      makeMember({ id: 'joist-a', kind: 'joist', position: { x: -1500, y: 300, z: 500 } }),
      makeMember({ id: 'joist-b', kind: 'joist', position: { x: 1500, y: 300, z: -500 } }),
    ];
    const warnings = [
      makeWarning({ memberId: 'joist-a' }),
      makeWarning({ memberId: 'joist-b' }),
    ];
    seedBundle({ members, warnings });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(2);
    // Sort by position.x so the assertion is stable regardless of
    // scene-graph traversal order.
    const sorted = [...meshes].sort((a, b) => a.position.x - b.position.x);
    expect(sorted[0]!.position.toArray()).toEqual([-1500, 300, 500]);
    expect(sorted[1]!.position.toArray()).toEqual([1500, 300, -500]);
    await renderer.unmount();
  });

  it('only warned members get highlights — un-warned members are ignored', async () => {
    // 3 members in the layout, but only 1 warning → only 1
    // highlight mesh. Proves the overlay is warning-driven, not
    // member-driven.
    const members = [
      makeMember({ id: 'joist-x', kind: 'joist' }),
      makeMember({ id: 'joist-y', kind: 'joist' }),
      makeMember({ id: 'joist-z', kind: 'joist' }),
    ];
    const warnings = [makeWarning({ memberId: 'joist-y' })];
    seedBundle({ members, warnings });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(1);
    await renderer.unmount();
  });
});

describe('<WarningOverlay /> — AC2 INDEPENDENT of layerVisibility (CRITICAL, finding #7)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('hiding the joists layer does NOT hide the overlay group or its highlight meshes', async () => {
    // Seed a warned joist. Then toggle `layerVisibility.joists` off.
    // The overlay's group must remain `visible === true` AND still
    // contain the same highlight mesh. This is the whole point of
    // the story — if a future refactor introduces a subscription
    // to `layerVisibility.joists`, this test flips red.
    const members = [
      makeMember({ id: 'joist-hl', kind: 'joist', position: { x: 0, y: 200, z: 0 } }),
    ];
    const warnings = [makeWarning({ memberId: 'joist-hl' })];
    seedBundle({ members, warnings });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);

    // Baseline: overlay group visible, one highlight mesh.
    const groupBefore = findOverlayGroup(renderer);
    expect(groupBefore.visible).toBe(true);
    const meshesBefore = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshesBefore).toHaveLength(1);
    const uuidBefore = meshesBefore[0]!.uuid;
    const positionBefore = meshesBefore[0]!.position.toArray();

    // Toggle the joists layer off — a state mutation the overlay
    // MUST NOT observe.
    await withAct(() => {
      useUiStore.getState().toggleLayer('joists');
    });
    await renderer.update(<WarningOverlay />);

    // Assertion 1: overlay group is STILL visible.
    const groupAfter = findOverlayGroup(renderer);
    expect(groupAfter.visible).toBe(true);
    // Assertion 2: SAME group instance — no remount.
    expect(groupAfter).toBe(groupBefore);
    // Assertion 3: highlight mesh is STILL present with the same
    // uuid + position — proves no unmount, no reposition, no
    // subscription to layer visibility.
    const meshesAfter = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshesAfter).toHaveLength(1);
    expect(meshesAfter[0]!.uuid).toBe(uuidBefore);
    expect(meshesAfter[0]!.position.toArray()).toEqual(positionBefore);

    // Sanity: the ui-store's `layerVisibility.joists` really DID
    // flip — proves the toggle happened; the assertion above proves
    // the overlay ignored it.
    expect(useUiStore.getState().layerVisibility.joists).toBe(false);

    await renderer.unmount();
  });

  it('toggling EVERY layer off does not hide the overlay or its meshes', async () => {
    // The strongest form of the property: hide all eight layers
    // (six S10 + blocks + blocking from S22) and assert the overlay
    // is unchanged. If any inline `layerVisibility[<key>]`
    // subscription creeps into the overlay, this test catches it
    // regardless of which key was touched.
    const members = [
      makeMember({ id: 'beam-hl', kind: 'beam', position: { x: 100, y: 500, z: 0 } }),
    ];
    const warnings = [makeWarning({ memberId: 'beam-hl', kind: 'over-span-beam' })];
    seedBundle({ members, warnings });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    const meshesBefore = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshesBefore).toHaveLength(1);

    await withAct(() => {
      useUiStore.getState().hideAllLayers();
    });
    await renderer.update(<WarningOverlay />);

    const groupAfter = findOverlayGroup(renderer);
    expect(groupAfter.visible).toBe(true);
    const meshesAfter = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshesAfter).toHaveLength(1);

    await renderer.unmount();
  });
});

describe('<WarningOverlay /> — AC4 empty warnings → empty group', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('renders a visible group but zero meshes when the warnings array is empty', async () => {
    // Even with members in the layout, if no warnings are set
    // the overlay MUST render its group empty. AC4: "no meshes
    // created" for the empty-warnings case.
    const members = [makeMember({ id: 'joist-nowarn', kind: 'joist' })];
    seedBundle({ members, warnings: [] });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes).toHaveLength(0);
    // Group is still mounted — the composition stays stable so
    // future warnings drop in without a remount.
    const group = findOverlayGroup(renderer);
    expect(group.visible).toBe(true);
    await renderer.unmount();
  });
});

describe('<WarningOverlay /> — AC5 reactive to warning changes (subscription-driven)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  // NOTE (Code Review GPT#1, pair-fix 1): these tests deliberately
  // do NOT call `renderer.update(<WarningOverlay />)` after mutating
  // the store. The whole point of AC5 is that the overlay
  // SUBSCRIBES to the store and re-renders on its own — a manual
  // `renderer.update()` would mask a broken subscription (an
  // implementation that read the store once in `useState` and
  // never updated would still pass). Instead, we mount once, mutate
  // the store inside `act(...)`, and let the subscription trigger
  // the re-render. If the subscription regresses, these tests turn
  // red at the assertion.

  it('adding a warning increments the highlight count within one render tick (subscription proof)', async () => {
    const members = [
      makeMember({ id: 'joist-r-0', kind: 'joist' }),
      makeMember({ id: 'joist-r-1', kind: 'joist' }),
    ];
    seedBundle({ members, warnings: [] });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    expect(renderer.scene.findAllByType('Mesh')).toHaveLength(0);

    // Push one warning → the overlay grows to one mesh via its
    // OWN store subscription (no renderer.update()).
    await withAct(() => {
      const cur = useDesignStore.getState().bundle;
      useDesignStore.setState({
        bundle: { ...cur, warnings: [makeWarning({ memberId: 'joist-r-0' })] },
      });
    });
    expect(renderer.scene.findAllByType('Mesh')).toHaveLength(1);

    // Push a second warning → two meshes. Subscription re-fires.
    await withAct(() => {
      const cur = useDesignStore.getState().bundle;
      useDesignStore.setState({
        bundle: {
          ...cur,
          warnings: [
            makeWarning({ memberId: 'joist-r-0' }),
            makeWarning({ memberId: 'joist-r-1' }),
          ],
        },
      });
    });
    expect(renderer.scene.findAllByType('Mesh')).toHaveLength(2);

    await renderer.unmount();
  });

  it('clearing a warning removes its highlight within one render tick (AC5, subscription proof)', async () => {
    const members = [
      makeMember({ id: 'joist-c-0', kind: 'joist' }),
      makeMember({ id: 'joist-c-1', kind: 'joist' }),
    ];
    seedBundle({
      members,
      warnings: [
        makeWarning({ memberId: 'joist-c-0' }),
        makeWarning({ memberId: 'joist-c-1' }),
      ],
    });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    expect(renderer.scene.findAllByType('Mesh')).toHaveLength(2);

    // AC5 pinned example: a joist that WAS over-span is now within
    // limits → its warning disappears from the store → the
    // corresponding highlight vanishes. NO renderer.update() —
    // if the overlay stops subscribing to `bundle.warnings`, this
    // stays at 2 meshes and the test fails.
    await withAct(() => {
      const cur = useDesignStore.getState().bundle;
      useDesignStore.setState({
        bundle: { ...cur, warnings: [makeWarning({ memberId: 'joist-c-0' })] },
      });
    });
    expect(renderer.scene.findAllByType('Mesh')).toHaveLength(1);

    await renderer.unmount();
  });

  it('clearing all warnings collapses the highlight set to zero (subscription proof)', async () => {
    // A stronger AC5 form — from two down to zero via a single
    // store mutation. If the subscription is broken this stays
    // at 2 meshes.
    const members = [
      makeMember({ id: 'joist-e-0', kind: 'joist' }),
      makeMember({ id: 'joist-e-1', kind: 'joist' }),
    ];
    seedBundle({
      members,
      warnings: [
        makeWarning({ memberId: 'joist-e-0' }),
        makeWarning({ memberId: 'joist-e-1' }),
      ],
    });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    expect(renderer.scene.findAllByType('Mesh')).toHaveLength(2);

    await withAct(() => {
      const cur = useDesignStore.getState().bundle;
      useDesignStore.setState({ bundle: { ...cur, warnings: [] } });
    });
    expect(renderer.scene.findAllByType('Mesh')).toHaveLength(0);

    await renderer.unmount();
  });
});

describe('<WarningOverlay /> — edge: warning references an unknown memberId', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('skips the highlight (no crash, no mesh) when the referenced member is not in the layout', async () => {
    // Defensive: the store contract keeps warnings in sync with
    // the layout, but a boot-time race or a stale warning survives
    // via the AC5 rule ("update within one render tick"). The
    // overlay MUST NOT crash when it encounters a warning whose
    // memberId is unknown — skip silently and render the rest.
    const members = [makeMember({ id: 'joist-known', kind: 'joist' })];
    const warnings = [
      makeWarning({ memberId: 'joist-known' }),
      makeWarning({ memberId: 'joist-GHOST' }), // no such member
    ];
    seedBundle({ members, warnings });

    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    // Only the KNOWN warning produces a highlight; the unknown
    // one is skipped without throwing.
    const meshes = renderer.scene.findAllByType('Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(1);
    await renderer.unmount();
  });

  it('deduplicates the dev diagnostic — TWO warnings for the same missing memberId → ONE console.warn per commit', async () => {
    // Code Review GPT#2 (pair-fix 1): the pure-helper test file
    // `warning-overlay-resolve.test.ts` covers the fold-level dedup
    // directly + diagnostically. This integration test proves the
    // pipeline HOOKUP: the resolver's deduped `missingIds` reaches
    // the useEffect, and the useEffect logs one line per distinct
    // missing id — NOT one line per input warning.
    //
    // With THREE warnings for the same missing memberId, we assert
    // (a) EXACTLY ONE overlay-scoped warn call, AND
    // (b) the distinct set of extracted memberIds equals
    //     {'joist-DUP'}.
    // If the dedup regresses, we'd get 3 overlay-scoped calls (all
    // for 'joist-DUP') and the ONE-call assertion below fails.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const members = [makeMember({ id: 'joist-real', kind: 'joist' })];
      const warnings = [
        makeWarning({ memberId: 'joist-DUP' }),
        makeWarning({ memberId: 'joist-DUP' }),
        makeWarning({ memberId: 'joist-DUP' }),
      ];
      seedBundle({ members, warnings });

      const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
      expect(renderer.scene.findAllByType('Mesh')).toHaveLength(0);
      const overlayCalls = overlayWarnCalls(warnSpy);
      // EXACTLY one overlay-scoped call — if dedup regresses this
      // becomes 3.
      expect(overlayCalls).toHaveLength(1);
      // The one call payload contains the missing id.
      expect(overlayCalls[0]).toContain('joist-DUP');
      // And the distinct memberId set is exactly {'joist-DUP'}.
      expect(extractLoggedMemberIds(warnSpy)).toEqual(new Set(['joist-DUP']));
      await renderer.unmount();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('logs a console.warn so a developer notices a stale reference (dev diagnostic, useEffect)', async () => {
    // Code Review GPT#3 (pair-fix 1): the log now lives in a
    // dev-gated useEffect keyed on the joined missingIds string.
    // Vitest sets `import.meta.env.DEV = true` so the effect body
    // runs; we assert both that the warn fires AND that its
    // payload contains the stale memberId.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const members = [makeMember({ id: 'joist-real', kind: 'joist' })];
      const warnings = [makeWarning({ memberId: 'joist-nonexistent' })];
      seedBundle({ members, warnings });

      const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
      // No highlight — the reference was stale.
      expect(renderer.scene.findAllByType('Mesh')).toHaveLength(0);
      // The dev-gated useEffect fired and logged the stale id.
      expect(warnSpy).toHaveBeenCalled();
      expect(extractLoggedMemberIds(warnSpy)).toEqual(new Set(['joist-nonexistent']));
      await renderer.unmount();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does NOT re-log when the missing-ids set is unchanged across re-renders (useEffect key stability)', async () => {
    // The dev-log effect keys on `missingIds.join('|')`. When a
    // store mutation changes bundle.warnings but leaves the SET
    // of missing memberIds the same (e.g. re-emitting an identical
    // stale warning), the useEffect body must NOT re-fire. This
    // proves the sort+dedup+join key is content-addressed.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const members = [makeMember({ id: 'joist-real', kind: 'joist' })];
      seedBundle({
        members,
        warnings: [makeWarning({ memberId: 'joist-STALE' })],
      });

      const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
      const overlayCallsAfterMount = overlayWarnCalls(warnSpy).length;
      expect(overlayCallsAfterMount).toBe(1);

      // Replace the warnings array with a NEW array containing an
      // equivalent stale warning — same missingIds set, different
      // input reference. Effect key `missingIdsKey = 'joist-STALE'`
      // is unchanged → useEffect body must NOT re-fire.
      await withAct(() => {
        const cur = useDesignStore.getState().bundle;
        useDesignStore.setState({
          bundle: { ...cur, warnings: [makeWarning({ memberId: 'joist-STALE' })] },
        });
      });

      expect(overlayWarnCalls(warnSpy).length).toBe(overlayCallsAfterMount);
      await renderer.unmount();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('<WarningOverlay /> — S12 composition marker', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('root group carries WARNING_OVERLAY_USER_DATA_KEY marker for scene-graph inspection', async () => {
    // The stamp mirrors the S10 LAYER_USER_DATA_KEY pattern (kept
    // in `layers/shared/kind-layer.tsx`). WarningOverlay defines
    // its OWN marker constant because the boundary rule forbids
    // importing from layers/. S12's AppShell composition tests
    // (and QA E2E scene-graph probes) grep-find the overlay via
    // this marker.
    seedBundle({ members: [], warnings: [] });
    const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
    const group = findOverlayGroup(renderer);
    expect(group.userData[WARNING_OVERLAY_USER_DATA_KEY]).toBe('warning-overlay');
    await renderer.unmount();
  });
});

describe('<WarningOverlay /> — React key uniqueness (kind-scoped, future-proof)', () => {
  beforeEach(() => {
    resetLayerVisibility();
    resetDesignStoreForTests();
  });

  it('renders TWO highlights (no React key collision) for two warnings of DIFFERENT kinds on the SAME member', async () => {
    // Code Review Opus#1 (pair-fix 1): `key={warning.memberId}`
    // alone assumed ≤ 1 warning per member. `spanCheck` today
    // emits one over-span warning per member, but the `Warning`
    // type declares no such invariant — a future warning kind
    // (say another `over-span-*` variant on a shared synthetic
    // member) could collide. The overlay now uses
    // `${warning.kind}:${warning.memberId}` as the key.
    //
    // If a regression drops the kind prefix, React logs a
    // "encountered two children with the same key" warning AND
    // may skip rendering one of the highlights. We capture BOTH
    // signals here — a `console.error` spy for the React warning
    // AND an assertion that TWO meshes render.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const members = [
        makeMember({ id: 'shared-member', kind: 'joist' }),
      ];
      const warnings = [
        makeWarning({ memberId: 'shared-member', kind: 'over-span-joist' }),
        makeWarning({ memberId: 'shared-member', kind: 'over-span-beam' }),
      ];
      seedBundle({ members, warnings });

      const renderer = await ReactThreeTestRenderer.create(<WarningOverlay />);
      const meshes = renderer.scene.findAllByType('Mesh');
      expect(meshes).toHaveLength(2);

      // No React key-collision error surfaced. If the key ever
      // regresses to plain memberId, React logs
      // "Encountered two children with the same key" via
      // console.error and this assertion fails.
      const errorPayloads = errorSpy.mock.calls
        .flat()
        .map((a) => String(a))
        .join(' ');
      expect(errorPayloads).not.toMatch(/two children with the same key/i);

      await renderer.unmount();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
