/**
 * `src/scene/warning-overlay-resolve.ts` — the PURE resolve step
 * for the S11 warning overlay.
 *
 * ## Why a separate module (Code Review GPT#2 + GPT#3 hardening)
 *
 * S11's original `<WarningOverlay>` inlined two concerns inside
 * one `useMemo`:
 *
 *   1. Fold warnings → `{ warning, member }` pairs by looking up
 *      each warning's `memberId` in the layout.
 *   2. Log `console.warn` for every warning whose memberId was
 *      not present (deduped within the fold).
 *
 * That was structurally wrong twice over:
 *
 *   - **`useMemo` is not a side-effect boundary** — React may
 *     invoke the body more than once for the same deps (e.g. on
 *     concurrent renders, strict-mode double-invocation). Logging
 *     from inside a memo can double- or triple-fire without a
 *     dev-visible signal. Side effects belong in `useEffect`.
 *   - **The log fired unconditionally in production** — the
 *     comment claimed "dev-visible" but there was no
 *     `import.meta.env.DEV` gate. A stale-memberId race in prod
 *     would spam the browser console for every affected user.
 *
 * The fix separates the two: `resolveWarningsToMembers` is a PURE
 * function that returns BOTH the resolved pairs AND the (sorted,
 * deduped) list of missing memberIds. The overlay component then
 * (a) renders from `pairs` inside `useMemo`, and (b) logs from
 * `missingIds` inside a DEV-GATED `useEffect` keyed on a stable
 * joined string of missingIds. Testing the fold in isolation gives
 * us direct-diagnostic dedup coverage (see the sibling
 * `warning-overlay-resolve.test.ts`) that CANNOT be defeated by
 * React re-invocation quirks.
 *
 * ## Determinism & scene-graph stability
 *
 *   - `pairs` preserve INPUT WARNINGS ORDER — that keeps the
 *     `<mesh>` order in the scene graph stable across resolves
 *     so downstream tests can assert by index.
 *   - `missingIds` are **deduped AND alphabetically sorted** —
 *     this makes the `join('|')` string used as the useEffect
 *     dep content-addressed. Two renders with the SAME set of
 *     missing ids (in any input order) share the same effect
 *     key → the effect body only fires when the SET changes,
 *     not on every render.
 *
 * ## No React, no state store, no three — pure TS
 *
 * The module deliberately only imports domain types. That keeps
 * the pure helper testable at the unit level without spinning up
 * the r3f test renderer or jsdom.
 */
import type { LayoutMember, Warning } from '../domain/model';

/**
 * One resolved (warning, member) pair — the shape the overlay
 * feeds one-per-highlight to `<OverSpanHighlight member={...} />`.
 */
export interface ResolvedPair {
  readonly warning: Warning;
  readonly member: LayoutMember;
}

/**
 * The result of a resolve pass — pairs to render AND the missing
 * memberIds that were skipped. Both fields are frozen shallow
 * arrays so downstream code cannot mutate the resolved list in
 * place (which would corrupt cached useMemo values across renders).
 */
export interface ResolveResult {
  readonly pairs: readonly ResolvedPair[];
  /**
   * memberIds that appeared in the input warnings but were NOT
   * present in the input member list. Deduplicated (each id
   * appears at most once) AND alphabetically sorted so a caller
   * can safely `.join('|')` the array as a stable effect key.
   */
  readonly missingIds: readonly string[];
}

/**
 * Fold an array of warnings against a layout member list, producing
 * one resolved pair per warning whose memberId is present in the
 * layout AND the sorted deduped list of memberIds that were not
 * present.
 *
 * Runs in O(W + M) — one pass over the members to build a
 * memberId→member Map, then one pass over the warnings to look up
 * each. Called once per useMemo re-run (i.e. when warnings OR
 * members change reference), so scales cleanly to §9's 50+
 * warnings/500+ members targets.
 *
 * The function is PURE — no globals, no side effects, no React
 * hooks. Same inputs always produce the same output; safe to
 * invoke in `useMemo` OR in tests without a renderer.
 */
export function resolveWarningsToMembers(
  warnings: readonly Warning[],
  members: readonly LayoutMember[],
): ResolveResult {
  // Fast path: an empty warnings list needs no member map at all
  // (avoids allocating a Map for the common "no warnings" case).
  if (warnings.length === 0) {
    return EMPTY_RESULT;
  }

  // memberId → LayoutMember index. Building it once and reusing
  // it for every warning lookup below turns the fold from O(W×M)
  // (naive linear search per warning) into O(W + M).
  const byId = new Map<string, LayoutMember>();
  for (const m of members) {
    byId.set(m.id, m);
  }

  const pairs: ResolvedPair[] = [];
  // A Set — not an array — so lookup ("have I already recorded
  // this missing id?") is O(1) per warning. Sorted array is
  // produced ONCE at the end via `Array.from(set).sort()`.
  const missingSet = new Set<string>();

  for (const w of warnings) {
    const m = byId.get(w.memberId);
    if (m === undefined) {
      // Record the missing id (dedup is Set-provided). We do NOT
      // log here — see module header rationale. The overlay
      // component logs from a dev-gated useEffect.
      missingSet.add(w.memberId);
      continue;
    }
    pairs.push({ warning: w, member: m });
  }

  // Sort alphabetically so `missingIds.join('|')` is stable across
  // two renders with the same SET of missing ids in different
  // input orders — see module header on the useEffect key.
  const missingIds = Array.from(missingSet).sort();

  return {
    pairs: Object.freeze(pairs),
    missingIds: Object.freeze(missingIds),
  };
}

/**
 * Frozen empty result for the fast path. Reusing this singleton
 * across every "no warnings" render lets the overlay's useMemo
 * return a reference-stable value, minimizing reconciler churn.
 */
const EMPTY_RESULT: ResolveResult = Object.freeze({
  pairs: Object.freeze([] as ResolvedPair[]),
  missingIds: Object.freeze([] as string[]),
});
