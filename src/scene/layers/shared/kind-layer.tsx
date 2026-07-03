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

import type { MemberKind } from '../../../domain/model';
import { useDesignStore, useUiStore, type LayerVisibility } from '../../../state';

import { BoxMember } from './BoxMember';

/**
 * Props for {@link KindLayer}. Both fields are required — a caller
 * that supplies only one is very likely mismatched (`kind="joist"
 * visibilityKey="beams"` would silently render joist meshes under
 * the beams-visibility flag), and the union type stays exhaustive
 * so a compile error catches typos in the wire-up.
 */
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
  const members = useDesignStore((s) => s.bundle.layout.members);
  // The visibility flag is one boolean — a scoped selector so a
  // change to another layer's flag does not re-render this one.
  const visible = useUiStore((s) => s.layerVisibility[visibilityKey]);

  const own = members.filter((m) => m.kind === kind);

  return (
    <group visible={visible}>
      {own.map((member) => (
        <BoxMember key={member.id} member={member} />
      ))}
    </group>
  );
}
