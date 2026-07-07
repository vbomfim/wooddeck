/**
 * `src/scene/WarningOverlay.tsx` — top-level scene decorator that
 * draws one highlight per over-span warning.
 *
 * ## Responsibility (single)
 *
 * For every `Warning` in `bundle.warnings`, find the corresponding
 * `LayoutMember` in `bundle.layout.members` and render an
 * {@link OverSpanHighlight} at the member's position/size/rotation.
 * Zero geometry math — the highlight decorator inherits the
 * member's fields unchanged.
 *
 * ## S11 boundary rule — PEER of layers, not consumer (finding #7)
 *
 * The dep-cruiser `warning-overlay-no-layers` rule forbids this
 * file (and everything under `src/scene/highlights/**`) from
 * importing anything under `src/scene/layers/**`. That includes
 * the shared primitives — `BoxMember`, `geometries.ts`,
 * `materials.ts`. The consequence: WarningOverlay cannot break
 * (or be broken by) any layer's visibility flag or scene-graph
 * position. The overlay's rendered output is a pure function of
 * `bundle.warnings` + `bundle.layout.members` — nothing else.
 *
 * Structurally enforced by:
 *   - `.dependency-cruiser.cjs` `warning-overlay-no-layers`
 *   - `scripts/boundary-selftest.mjs` BLOCK-2q probe
 *   - `src/scene/highlights/no-geometry-math.test.ts` grep guard
 *
 * The S10 `<BoxMember material={...}>` optional override prop
 * exists but is INTENTIONALLY UNUSED by this file. Reusing it
 * would violate the boundary rule; the OverSpanHighlight
 * primitive is a self-contained copy of the same pattern.
 *
 * ## Composition inside DeckScene (S12 contract)
 *
 * S12's `AppShell` composes the scene as:
 *
 *     <DeckScene>
 *       <DeckLayers />
 *       <WarningOverlay />
 *     </DeckScene>
 *
 * The overlay MUST mount AFTER `<DeckLayers />` so its highlights
 * sort last in the scene-graph traversal AND draw last in the
 * transparent-material pass (combined with the highlight's
 * `depthTest=false` + high `renderOrder`, this guarantees the
 * decoration renders on top per AC3).
 *
 * ## Independence from `layerVisibility` (AC2, CRITICAL)
 *
 * This file DOES NOT read `useUiStore(s => s.layerVisibility.*)`
 * anywhere. The overlay group's `visible` prop is unbound (defaults
 * to `true`). Toggling any layer's visibility can NEVER hide a
 * highlight — this is the whole point of the story. If a future
 * refactor introduces a layer-visibility subscription, the AC2
 * test in `WarningOverlay.test.tsx` flips red immediately.
 *
 * ## Warnings-visible flag decision (S11 §17 open question)
 *
 * The ticket mentioned `useUiStore.layerVisibility.warnings` for
 * future extensibility, but adding a seventh key to the
 * `LayerVisibility` record would disrupt `DECK_LAYER_ORDER` and
 * the S8/S10 tests that assert the exact SIX-key layer set. For
 * MVP the overlay renders ALWAYS-ON (ticket §2: "no toggle UI
 * required"); no separate `warningsVisible` flag is introduced
 * either — YAGNI until a user story demands it. A future story
 * that wants a toggle should add a DISTINCT `warningsVisible:
 * boolean` (default true) to the ui store OUTSIDE the
 * `layerVisibility` record and bind the overlay group's `visible`
 * to it. Documented in `docs/ARCHITECTURE.md`.
 *
 * ## Selector granularity (S10 layer footgun lesson)
 *
 * We select the STABLE reference-equal slices from Zustand:
 *
 *   - `bundle.warnings` — plain array reference (changes only
 *     when the bundle rewrites).
 *   - `bundle.layout.members` — same story.
 *
 * The `.filter` / `.map` / `.find` happen OUTSIDE the selector
 * closure — running them inside would create a fresh array on
 * every subscription check and break Zustand's default
 * referential-equality comparison, forcing infinite re-renders.
 * Same discipline as `KindLayer` in the layers/ package.
 *
 * ## Missing-member defensive path — pure fold + dev-gated log
 *
 * Code Review GPT#3 (pair-fix 1): the earlier version logged
 * `console.warn` INSIDE the `useMemo` body. That was wrong twice
 * over:
 *
 *   1. `useMemo` is not a side-effect boundary — React may
 *      re-invoke the body across concurrent renders / strict-mode
 *      double invocation, producing duplicate logs.
 *   2. There was no `import.meta.env.DEV` gate — the log would
 *      fire in PRODUCTION on any stale-warning race.
 *
 * Fix: the fold moved to a pure helper (`warning-overlay-resolve`)
 * that returns BOTH the resolved pairs AND the sorted deduped
 * list of missing memberIds. The `useMemo` returns just the
 * `pairs`; a separate `useEffect` gated on `import.meta.env.DEV`
 * logs each missing id when the SET changes (keyed on the joined
 * missingIds string so the effect body doesn't re-fire on renders
 * that leave the missing set unchanged).
 *
 * ## Highlight key — kind-scoped to avoid future collisions
 *
 * Code Review Opus#1 (pair-fix 1): `key={warning.memberId}` alone
 * assumes ≤ 1 warning per member. `spanCheck` currently emits
 * exactly one over-span warning per member so today the invariant
 * holds — but the `Warning` type declares no such constraint. A
 * future warning-kind alongside `over-span-joist` (e.g. an
 * `over-span-post` on a shared synthetic member) would collide.
 * `${warning.kind}:${warning.memberId}` is future-proof at zero
 * runtime cost.
 *
 * ## Boundary discipline (production imports only)
 *
 * This file imports ONLY from:
 *   - `react` (JSX type + hooks)
 *   - `../domain/model` (LayoutMember + Warning types)
 *   - `../state` (barrel — the ONLY state coupling channel)
 *   - `./highlights/OverSpanHighlight` (own leaf decorator)
 *   - `./warning-overlay-resolve` (own pure fold helper)
 *
 * NOT from `./layers/**` (forbidden by dep-cruiser), NOT from
 * `../ui/**` / `../application/**` / `../persistence/**` (scene
 * allowlist).
 */
import { useEffect, useMemo, type JSX } from 'react';

import type { LayoutMember, Warning } from '../domain/model';
import { useDesignStore } from '../state';

import { OverSpanHighlight } from './highlights/OverSpanHighlight';
import { resolveWarningsToMembers } from './warning-overlay-resolve';

/**
 * Well-known key stamped onto the overlay's root `<group>` so
 * downstream tests + S12 scene-graph inspection can identify the
 * overlay by its logical id (mirrors the S10 `LAYER_USER_DATA_KEY`
 * from `layers/shared/kind-layer.tsx`). We define our OWN
 * constant here because the S11 boundary rule forbids importing
 * from `layers/`. The namespace prefix `wooddeck/` matches the
 * project-wide userData convention.
 */
export const WARNING_OVERLAY_USER_DATA_KEY = 'wooddeck/warningOverlay';

/** The value stamped under {@link WARNING_OVERLAY_USER_DATA_KEY}. */
export const WARNING_OVERLAY_USER_DATA_VALUE = 'warning-overlay';

/**
 * Stable empty-array reference for the defensive `?? EMPTY_WARNINGS`
 * / `?? EMPTY_MEMBERS` fallback (matches the KindLayer pattern).
 * A fresh `[]` from the selector on every render would break
 * Zustand's referential-equality check and force a re-render loop.
 */
const EMPTY_WARNINGS: readonly Warning[] = Object.freeze([]);
const EMPTY_MEMBERS: readonly LayoutMember[] = Object.freeze([]);

/**
 * Pre-computed userData object for the overlay group. Kept as a
 * module-level frozen literal so `<group userData={...}>` gets a
 * stable reference across renders — r3f wouldn't rebuild the
 * group either way, but a stable literal keeps the intent
 * obvious and avoids per-render allocation.
 */
const OVERLAY_USER_DATA: Readonly<Record<string, unknown>> = Object.freeze({
  [WARNING_OVERLAY_USER_DATA_KEY]: WARNING_OVERLAY_USER_DATA_VALUE,
});

/**
 * The S11 warning overlay. Reads warnings + members from the
 * design store, resolves each warning to its member, and renders
 * one {@link OverSpanHighlight} per resolved pair.
 *
 * Takes no props — composition is via being mounted inside
 * `<DeckScene>` (usually alongside `<DeckLayers />`; the AppShell
 * in S12 owns the composition).
 */
export function WarningOverlay(): JSX.Element {
  // Read the STABLE array references from the store; the store's
  // bundle write pipeline keeps these reference-equal across
  // unrelated mutations. Defensive fallback to the module-scope
  // EMPTY_* singletons in case of an intermediate null-bundle
  // state (mirrors the KindLayer null-layout defensive path).
  const warnings = useDesignStore((s) => s.bundle.warnings ?? EMPTY_WARNINGS);
  const members = useDesignStore((s) => s.bundle.layout?.members ?? EMPTY_MEMBERS);

  // PURE fold — see `warning-overlay-resolve.ts`. Returns:
  //   { pairs, missingIds }
  // where `pairs` drive the rendered scene graph and `missingIds`
  // drives the dev-only diagnostic effect below. `useMemo` keys
  // on the stable array references — a store write that leaves
  // both untouched reuses the previous resolve result and skips
  // the fold entirely.
  const { pairs: resolved, missingIds } = useMemo(
    () => resolveWarningsToMembers(warnings, members),
    [warnings, members],
  );

  // Serialize `missingIds` to a stable primitive so the dev-log
  // useEffect re-runs ONLY when the SET of missing ids changes,
  // not when the resolve helper returns a new array with the same
  // content. The helper sorts alphabetically so the joined string
  // is content-addressed (see `warning-overlay-resolve.ts`).
  const missingIdsKey = missingIds.join('|');
  useEffect(() => {
    // Two gates keep production silent:
    //   - import.meta.env.DEV compiles to a boolean literal under
    //     Vite's build; the whole branch is dead-code-eliminated
    //     in a production bundle.
    //   - empty check short-circuits the common "no missing ids"
    //     path so a well-behaved store never triggers a re-render
    //     dependency change (the joined key is '' both before and
    //     after).
    if (!import.meta.env.DEV) return;
    if (missingIdsKey === '') return;
    // Log each distinct missing id on its own line so a developer
    // can grep the exact memberId in the console. The set is
    // already deduped + sorted by the pure helper.
    for (const id of missingIdsKey.split('|')) {
      console.warn(
        `[WarningOverlay] warning references unknown memberId '${id}' — skipping highlight`,
      );
    }
  }, [missingIdsKey]);

  return (
    <group userData={OVERLAY_USER_DATA}>
      {resolved.map(({ warning, member }) => (
        <OverSpanHighlight
          // Kind-scoped key — future-proof against two warnings
          // of different kinds for the same synthetic member.
          // See module header (Highlight key section).
          key={`${warning.kind}:${warning.memberId}`}
          member={member}
        />
      ))}
    </group>
  );
}
