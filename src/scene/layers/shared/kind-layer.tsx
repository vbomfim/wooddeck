/**
 * `src/scene/layers/shared/kind-layer.tsx` — private helper
 * component that renders one kind-scoped layer group.
 *
 * ## Why this helper exists
 *
 * The five kind-scoped layer components (`JoistsLayer`,
 * `BeamsLayer`, `PostsLayer`, `FootingsLayer`, `DeckingLayer`)
 * ALL share the same three-step body:
 *
 *   1. Select the members of a given `kind` from
 *      `useDesignStore(s => s.bundle.layout.members)`.
 *   2. Read a single boolean from
 *      `useUiStore(s => s.layerVisibility.<name>)`.
 *   3. Return `<group visible={visible}>{members.map(BoxMember)}</group>`.
 *
 * Rather than copy-paste the body five times, each layer file
 * renders `<KindLayer kind={...} visibilityKey={...} />` — one
 * source of truth for the "select + visibility + group" pipeline.
 *
 * ## Why NOT export this as the layer itself
 *
 * The issue #11 §2 interface contract nails the SIX component
 * names (`EnvironmentLayer`, `DeckingLayer`, ...) as the public
 * export. Downstream consumers (S12 AppShell, S14 layer toggle
 * panel) grep by component name. A named-per-kind wrapper keeps
 * the public API immediately obvious and lets DevTools stack
 * frames read as `<JoistsLayer>` — not a generic
 * `<KindLayer kind="joist">`.
 *
 * ## Selector granularity
 *
 * We read `bundle.layout.members` as a WHOLE (not a filtered
 * slice) — the filter runs on the client, not inside the Zustand
 * selector. Rationale:
 *
 *   - `bundle.layout.members` is a stable reference between
 *     re-layouts (a new bundle → new members array; unchanged
 *     otherwise). Filtering inside a selector would create a
 *     NEW filtered array on every store read, breaking Zustand's
 *     default referential equality and forcing spurious re-renders.
 *   - Filtering client-side runs once per layer render — cheap.
 *   - The scene layer holds five instances of this component (one per
 *     kind). Each reads the same members array reference; only
 *     one filter per instance per render.
 */
import type { JSX } from 'react';

import type { LayoutMember, MemberKind } from '../../../domain/model';
import { useDesignStore, useUiStore, type LayerVisibility } from '../../../state';

import { BoxMember } from './BoxMember';

/**
 * Stable empty-array reference for the defensive `?? EMPTY_MEMBERS`
 * fallback below. If we returned a fresh `[]` from the selector
 * on every render, Zustand's default referential-equality check
 * would flip to "changed" on every read and trigger an infinite
 * re-render loop. A module singleton keeps the reference stable.
 */
const EMPTY_MEMBERS: readonly LayoutMember[] = Object.freeze([]);

/**
 * Props for {@link KindLayer}. Both fields are required — a caller
 * that supplies only one is very likely mismatched (`kind="joist"
 * visibilityKey="beams"` would silently render joist meshes under
 * the beams-visibility flag), and the union type stays exhaustive
 * so a compile error catches typos in the wire-up.
 */
/**
 * Well-known key stamped onto every layer group's `userData` map
 * so downstream test / debugging code (and the AC8 scene-graph
 * order test) can identify a group by its logical layer without
 * scraping React tree state. `userData` is `Record<string, any>`
 * on `THREE.Object3D`, and three.js has NO conventional prefix —
 * so we namespace with `wooddeck/` to make the intent obvious in
 * any DevTools inspector.
 */
export const LAYER_USER_DATA_KEY = 'wooddeck/layerId';

export interface KindLayerProps {
  readonly kind: MemberKind;
  readonly visibilityKey: keyof LayerVisibility;
}

/**
 * Kind-scoped layer component — the shared body of every non-
 * environment layer. See module header for the rationale and the
 * per-hook selector-granularity notes.
 */
export function KindLayer({ kind, visibilityKey }: KindLayerProps): JSX.Element {
  // Reading `members` as a whole keeps the selector reference-stable
  // across unrelated store writes. See module header for the
  // rationale.
  //
  // ## Null-layout defensive access (§5 promise, pair-fix iter 1 Fix E)
  //
  // The store contract as of S8 always constructs a valid `Layout`
  // in `bundle.layout` — but issue #11 §5 promises "if Layout is
  // null → each layer returns null gracefully, no crash". The
  // `?.members ?? EMPTY_MEMBERS` guard honors that promise WITHOUT
  // requiring a store contract change. `EMPTY_MEMBERS` is a
  // module singleton (see top of file) so the selector's return
  // value stays reference-stable — a fresh `[]` on every read
  // would trigger a Zustand re-render loop. Tested by
  // `kind-layer.null-layout.test.tsx`.
  const members = useDesignStore((s) => s.bundle.layout?.members ?? EMPTY_MEMBERS);
  // The visibility flag is one boolean — a scoped selector so a
  // change to another layer's flag does not re-render this one.
  const visible = useUiStore((s) => s.layerVisibility[visibilityKey]);

  const own = members.filter((m) => m.kind === kind);

  return (
    /*
     * `userData[LAYER_USER_DATA_KEY] = visibilityKey` stamps the
     * layer's logical id onto the group instance, so the AC8
     * scene-graph-order test can walk the top-level scene children
     * in traversal order and read the layer sequence directly from
     * three.js — no reliance on React tree state, no fragile
     * traversal-by-count. The visibilityKey doubles as the layer's
     * public identifier (matches `DECK_LAYER_ORDER` entries).
     */
    <group visible={visible} userData={{ [LAYER_USER_DATA_KEY]: visibilityKey }}>
      {own.map((member) => (
        <BoxMember key={member.id} member={member} />
      ))}
    </group>
  );
}
