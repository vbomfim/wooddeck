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
 * ## Missing-member defensive path (AC edge case)
 *
 * If a warning references a `memberId` not present in the current
 * layout (shouldn't happen — the store contract keeps them in
 * sync — but a stale warning may survive a mid-render
 * inconsistency), we SKIP that warning silently AND log a
 * `console.warn` in dev so a developer notices the drift.
 * Idempotent: the warning is deduplicated within a single render
 * by a Set so we don't spam the console with the same memberId
 * across sibling warnings.
 *
 * ## Boundary discipline (production imports only)
 *
 * This file imports ONLY from:
 *   - `react` (JSX type)
 *   - `../domain/model` (LayoutMember + Warning types)
 *   - `../state` (barrel — the ONLY state coupling channel)
 *   - `./highlights/OverSpanHighlight` (own leaf decorator)
 *
 * NOT from `./layers/**` (forbidden by dep-cruiser), NOT from
 * `../ui/**` / `../application/**` / `../persistence/**` (scene
 * allowlist).
 */
import { useMemo, type JSX } from 'react';

import type { LayoutMember, Warning } from '../domain/model';
import { useDesignStore } from '../state';

import { OverSpanHighlight } from './highlights/OverSpanHighlight';

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

  // Resolve warnings to (warning, member) pairs OUTSIDE the
  // selector so we don't create fresh arrays inside Zustand's
  // equality check. `useMemo` keys on the underlying array
  // references — a store write that leaves both references
  // untouched reuses the previous resolved list, minimizing
  // reconciler work.
  const resolved = useMemo(() => {
    if (warnings.length === 0) {
      return [] as ReadonlyArray<{ warning: Warning; member: LayoutMember }>;
    }
    // Build a memberId → LayoutMember lookup once per resolve so
    // the loop below runs in O(W + M) not O(W × M) — matters as
    // warnings scale up (§9 targets 50+ highlights).
    const byId = new Map<string, LayoutMember>();
    for (const m of members) {
      byId.set(m.id, m);
    }
    const pairs: Array<{ warning: Warning; member: LayoutMember }> = [];
    // Track memberIds we've already warned about so we don't spam
    // the console with duplicate messages for the same missing
    // reference across sibling warnings.
    const warnedMissing = new Set<string>();
    for (const w of warnings) {
      const m = byId.get(w.memberId);
      if (m === undefined) {
        if (!warnedMissing.has(w.memberId)) {
          warnedMissing.add(w.memberId);
          // Dev-visible console.warn; no user-facing effect.
          // See module header — a stale warning is a symptom of
          // the store contract drifting.
          console.warn(
            `[WarningOverlay] warning references unknown memberId '${w.memberId}' — skipping highlight`,
          );
        }
        continue;
      }
      pairs.push({ warning: w, member: m });
    }
    return pairs;
  }, [warnings, members]);

  return (
    <group userData={OVERLAY_USER_DATA}>
      {resolved.map(({ warning, member }) => (
        <OverSpanHighlight key={warning.memberId} member={member} />
      ))}
    </group>
  );
}
