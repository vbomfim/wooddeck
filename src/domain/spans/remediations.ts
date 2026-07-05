/**
 * `src/domain/spans/remediations.ts` — S16 issue #38.
 *
 * ## Purpose
 *
 * Given a single `Warning` (from `spanCheck`), the current
 * `DeckDesign`, any conforming `SpanTable`, and an injected
 * `recompute` function, derive the set of ONE-CLICK REMEDIATION
 * OPTIONS the ui layer can offer the user to clear the warning.
 * Each option carries:
 *
 *   - A discriminated-union `patch` describing WHAT to change
 *     (spacing / joist size / beam size / joist species / beam
 *     species). The state layer converts the patch into a
 *     `DeepPartial<DeckDesign>` at apply time (see
 *     `state/design-store.applyRemediation`).
 *   - A `newAllowableMm` derived from the RECOMPUTED design (or
 *     the SpanTable when the recompute clears the warning entirely
 *     — the "new allowable" is then a display estimate).
 *   - `wouldClear` (a boolean) + `disabled`/`disabledReason` — the
 *     UI hides nothing: even "not viable" options surface with a
 *     reason.
 *
 * ## Correct-by-construction `wouldClear` (S16 pair-fix)
 *
 * Every candidate patch is verified against a REAL recompute of
 * the patched design (`recompute(patchedDesign)`) — NOT against
 * SpanTable proxies. The proxy approach was flawed:
 *   - beam options used `warning.actualMm` (post-to-post span) as
 *     the beam-table tributary, but `spanCheck` uses the JOIST
 *     span → 12'×18' 2×8 PT beam "upgrade to 2×10" previewed
 *     wouldClear=true but the real recompute kept the warning.
 *   - joist options used the NOMINAL `design.joist.spacingMm`,
 *     but `spanCheck` reads ACTUAL spacing from the layout with
 *     snap tolerance → 10'×8' Cedar 2×6 @ 24″ "reduce to 406mm"
 *     previewed wouldClear=true but the layout's actual spacing
 *     tripped span-check's fail-safe (allowable=0) → warning
 *     REMAINED.
 * A tool that says "this fixes your over-spanned deck" when it
 * doesn't is dangerous. The recompute-injection gives us
 * ground-truth verification per candidate.
 *
 * ### Why an INJECTED recompute (not a direct import)
 *
 * S19 added `domain/layout/floating → domain/spans`. If
 * `remediations.ts` (in `domain/spans`) imported `computeLayout`
 * from `domain/layout`, we would have a `spans → layout → spans`
 * cycle → dep-cruiser `no-circular` fails, and the boundary
 * discipline that keeps each layer independently rewritable would
 * be broken. Instead we invert: `computeRemediations` takes
 * `recompute` as a parameter. The state-layer hook
 * (`useRemediationsForWarning`) wires `recompute =
 * (d) => computeLayoutAndCheck(d, spanTable).warnings`. Domain
 * remains pure, no import edges added.
 *
 * ## Fail-safe / NEVER-throws discipline (AC5)
 *
 * Mirrors `spanCheck`: the compute NEVER throws. A malformed
 * warning kind, a Composite species (fail-safe from the IRC table),
 * a zero-returning mock table, a `recompute` that throws
 * `LayoutError` on an invalid patched design — every branch
 * returns a stable (possibly all-disabled) array. When
 * `recompute` throws for a candidate, that candidate is surfaced
 * as `disabled` with a reason ("would produce an invalid design")
 * rather than propagating the throw. Silently returning `[]` is
 * acceptable ONLY when the warning kind is not one we model
 * (e.g., a future `over-span-post`); when we DO model a warning,
 * we must surface every option — enabled or disabled — so the user
 * always sees why we can't help.
 *
 * ## Cheapest-change-first ordering (AC3, ticket §17 Trade-offs)
 *
 * The ordering per warning KIND is:
 *
 *   over-span-joist:
 *     1. reduce-joist-spacing   (cheapest — spend more time nailing joists)
 *     2. upgrade-joist-size     (medium — bigger joist SKU)
 *     3. change-joist-species   (largest — supply-chain shift)
 *
 *   over-span-beam:
 *     1. add-support-row        (S25 / FR-032 — floating decks only;
 *                                elevated decks surface a DISABLED
 *                                option with a "switch to floating"
 *                                alternative reason. Cheapest — no
 *                                material change.)
 *     2. upgrade-beam-size      (medium)
 *     3. change-beam-species    (largest)
 *
 * (No `reduce-beam-spacing` — beams have no user-facing spacing
 * knob in MVP; the beam count is derived by the layout engine.)
 *
 * ## Species-swap direction — CLEARING-ONLY (Q2 discipline)
 *
 * The `change-*-species` option is offered ONLY when the target
 * species produces a strictly-larger allowable than the current one
 * (i.e. Cedar → PT for framing; NEVER PT → Cedar, which would
 * WORSEN the situation). When no clearing target exists we still
 * surface the option, but as `disabled: true` with a reason —
 * per AC4 (never silently omit).
 *
 * ## Composite exclusion (AC6)
 *
 * `Composite` is fail-safe in `IrcSpanTable` (returns 0). We NEVER
 * offer a species swap that TARGETS Composite framing.
 *
 * ## Composite → wood grade override (S16 pair-fix)
 *
 * A design with Composite framing has `grade: 'NA'`. When we swap
 * to a wood species (Cedar / PT), we MUST also set `grade: 'No2'`
 * on the candidate material — otherwise the SpanTable lookup (and
 * the recompute) would keep the inherited `'NA'` grade, return 0,
 * and every wood swap would surface as disabled with a misleading
 * reason. `candidateSpeciesMaterial` centralizes this rule.
 *
 * ## Partial-fix tier NOT in MVP (§17 Q3)
 *
 * If no clearing option exists for any KIND, every option surfaces
 * as `disabled: true`. The UI renders the AC16 explanation ("No
 * one-click fix — try reducing deck length or consult a licensed
 * professional.") in place of the fieldset.
 *
 * ## Grade filtering (S13 discipline)
 *
 * Every produced option matches the CURRENT design's grade
 * (typically `No2` for wood, `NA` for composite). We do not offer
 * a grade-upgrade remediation — grade is not on the ParameterPanel
 * surface and would produce a design the user can't inspect.
 *
 * ## Known limitation — recompute cost bound
 *
 * `computeRemediations` calls the injected `recompute` up to
 * ~4 times per remediation KIND (framing-size ladder, spacing
 * ladder, species swap) → ~15 recomputes per warning. Layout
 * benchmarks show ~0.03ms per recompute at 20×30 → total < 1ms
 * per call. The state-layer hook memoizes on `(memberId, design)`
 * so this cost only occurs on genuine design changes.
 *
 * ## Rewritability
 *
 * The compute is a pure function of `(Warning, DeckDesign,
 * SpanTable, recompute)`. Every branch is either "add an option"
 * or "add a disabled option with a reason" — no shared mutable
 * state, no clock, no I/O beyond the injected recompute. An
 * alternative implementation from the interface contract + this
 * test file is a mechanical exercise.
 */

import type {
  DeckDesign,
  LumberNominal,
  MaterialRef,
  Species,
  Warning,
} from '../model';
import type { Mm } from '../units';

import type { SpanTable } from './span-table';
// S25 (ticket #47) — import the block-grid clamp floor + resolver
// DIRECTLY from the layout file (NOT the `../layout` barrel).
// Rationale: the barrel re-exports `floating-layout.ts`, which
// imports from `../spans/irc-2018-tables` — pulling the barrel
// here would create a spans↔layout file cycle (dep-cruiser
// `no-circular` blocks it). `block-grid.ts` imports zero span
// modules, so the direct file edge is cycle-free. Same rationale
// for the direct file edge to `floating-layout.ts` (feat/block-
// spacing HIGH #3 — `resolveMethodBGrid` reflects the
// spacing-primary Method B resolver so the remediation's
// `currentRows` mirrors what the layout actually produces).
import {
  MIN_BLOCK_SPACING_MM,
} from '../layout/floating/block-grid';
import { resolveMethodBGrid, MAX_METHOD_B_BLOCK_COUNT } from '../layout/floating/floating-layout';
import { layoutFloatingJoists } from '../layout/floating/floating-joist-layout';

// ==========================================================
// Public shape (frozen — ticket §2 Interface Contract)
// ==========================================================

/**
 * The set of remediation kinds the MVP models. Adding a new kind
 * (e.g. `add-support-row` in S25) requires adding a new `patch`
 * variant to `RemediationPatch`, a producer branch to
 * `computeRemediations`, and an adapter branch to
 * `state/design-store.applyRemediation` — the compile-time
 * exhaustiveness check catches every missed site.
 */
export type RemediationKind =
  | 'reduce-joist-spacing'
  | 'upgrade-joist-size'
  | 'upgrade-beam-size'
  | 'change-joist-species'
  | 'change-beam-species'
  | 'add-support-row';

/**
 * Discriminated-union describing WHAT to change. The state layer
 * converts this into a `DeepPartial<DeckDesign>` before calling
 * `applyParameters` (see `application/apply-remediation.ts`). Kept
 * as a union (not a raw `DeepPartial`) so the domain module has
 * ZERO coupling to `application/types.ts` — cross-layer types stay
 * one-way (state depends on domain, never the reverse).
 */
export type RemediationPatch =
  | { readonly kind: 'reduce-joist-spacing'; readonly newSpacingMm: Mm }
  | { readonly kind: 'upgrade-joist-size'; readonly newNominal: LumberNominal }
  | { readonly kind: 'upgrade-beam-size'; readonly newNominal: LumberNominal }
  | { readonly kind: 'change-joist-species'; readonly newSpecies: Species }
  | { readonly kind: 'change-beam-species'; readonly newSpecies: Species }
  | {
      /**
       * S25 (ticket #47) — "add a row of support" for a FLOATING
       * deck. Under Method B (the active source of truth
       * post-feat/block-spacing HIGH #3), the patch REDUCES
       * `foundation.blockSpacingMm` so a tighter grid pitch
       * shortens the joist support span (the joist rests on
       * block ROWS; row pitch = block pitch along +z).
       *
       * ## Applicability
       *
       * - `design.structure === 'floating'`
       * - `design.floatingFraming === 'joists-on-blocks'` (Method B)
       * - `design.foundation.type ∈ {'deck-blocks','tuffblocks'}`
       *
       * ## Payload
       *
       * `targetBeamId` names the warning's member (the joist)
       * that motivated the remediation — the UI can use it to
       * highlight the affected member in the 3D scene.
       *
       * `proposedSpacingMm` / `currentSpacingMm` (feat/block-spacing
       * HIGH #3) are the ACTIVE source of truth. When these are
       * set, `application/apply-remediation.ts` dispatches
       * `{ foundation: { blockSpacingMm: proposedSpacingMm } }` —
       * `blockRowsHint` is untouched. Both fields are OPTIONAL for
       * backwards compatibility with the LEGACY path (see below)
       * and with tests / consumers built before HIGH #3.
       *
       * `currentRows` / `proposedRows` are the corresponding row
       * counts that the ACTIVE grid resolver would produce. They
       * are kept for label fallback (the pre-HIGH#3 `(N → M)`
       * arrow) and for the LEGACY path. Under the spacing-primary
       * path they are DERIVED from `proposedSpacingMm` +
       * footprint (not the source of truth).
       *
       * ## Legacy path
       *
       * When `proposedSpacingMm` is UNSET, the patch falls back to
       * the pre-feat/block-spacing shape: dispatch
       * `{ foundation: { blockRowsHint: proposedRows } }`. Kept
       * alive strictly for backwards compat with older synthesized
       * patches; new producers should always set
       * `proposedSpacingMm` for Method B (HIGH #3 rule).
       */
      readonly kind: 'add-support-row';
      readonly targetBeamId: string;
      readonly currentRows: number;
      readonly proposedRows: number;
      readonly currentSpacingMm?: Mm;
      readonly proposedSpacingMm?: Mm;
    };

export interface RemediationOption {
  /** The remediation kind (matches `patch.kind`). */
  readonly kind: RemediationKind;
  /** The `Warning.memberId` this option was derived from. */
  readonly memberId: string;
  /** Discriminated-union describing WHAT to change. */
  readonly patch: RemediationPatch;
  /**
   * Short human-legible label ("Upgrade joists to 2×10"). The UI
   * layer builds richer unit-aware strings via
   * `ui/warnings/remediation-labels.ts`; `summary` is a fallback +
   * accessibility label source.
   */
  readonly summary: string;
  /** `Warning.allowableMm` at compute time. Pass-through. */
  readonly currentAllowableMm: Mm;
  /**
   * Hypothetical allowable under the patch. When `wouldClear` is
   * `false` this is the recomputed allowable from `spanCheck` on
   * the patched design — an honest "you would improve from X to Y
   * but still be over-span". When `wouldClear` is `true` this is
   * the SpanTable lookup for the patched material (a display
   * estimate; the true allowable is at least `actualSpanMm`).
   * `0` indicates fail-safe / not-covered.
   */
  readonly newAllowableMm: Mm;
  /** `Warning.actualMm` at compute time. Pass-through. */
  readonly actualSpanMm: Mm;
  /**
   * `true` iff the patch would take the design from over-span to
   * within allowable (`newAllowableMm >= actualSpanMm &&
   * newAllowableMm > 0`).
   */
  readonly wouldClear: boolean;
  /**
   * `true` iff this "type" of remediation has no viable value at
   * the current design (e.g. already at 2×12, already at 12″ o.c.,
   * PT already the strongest species). The UI surfaces disabled
   * options with the reason — never silently omitted (AC4).
   */
  readonly disabled: boolean;
  /**
   * Plain-English reason the option is disabled. `null` iff
   * `disabled === false`.
   */
  readonly disabledReason: string | null;
}

// ==========================================================
// Module-scope catalogs
// ==========================================================

/**
 * Tabulated joist spacings in the IRC data, ordered SMALLEST →
 * LARGEST. `reduce-joist-spacing` walks this list ascending and
 * picks the FIRST spacing that (a) is smaller than the current
 * spacing AND (b) produces `newAllowableMm >= actualSpanMm`. The
 * smallest clearing spacing is the "cheapest" reduction — a user
 * would rather nail joists at 16″ than at 12″.
 *
 * Duplicated here (rather than imported from `irc-2018-tables.ts`)
 * because the interface boundary forbids `remediations.ts` from
 * depending on the concrete IRC data module. This mirrors the same
 * dependency-inversion rule `span-check.ts` follows.
 */
const TABULATED_SPACINGS_MM: readonly Mm[] = [305, 406, 610] as const;

/**
 * MVP joist / beam framing sizes, ordered SMALLEST → LARGEST. Only
 * `2x6..2x12` are span-rateable; `4x4`/`6x6`/`5/4x6` are for
 * posts + decking and would fail-safe at the SpanTable. Duplicated
 * (rather than imported from `irc-2018-tables.ts`) for the same
 * dependency-inversion reason as `TABULATED_SPACINGS_MM`.
 */
const FRAMING_SIZES: readonly LumberNominal[] = ['2x6', '2x8', '2x10', '2x12'] as const;

/**
 * MVP framing species, ordered WEAKEST → STRONGEST in the IRC
 * structural species groups Wooddeck maps `Species` to
 * (`Cedar → redwood-western-cedars`, `PT → southern-pine`;
 * `Composite → null / fail-safe`). Ordering matters: we look for
 * the SMALLEST-index species (weakest still IRC-rated) that yields
 * a strictly-larger allowable — that's the CLEARING species.
 *
 * Ordering rationale (documented for review): every entry in
 * `AWC DCA-6-2015` (§Southern Pine vs §Redwood/Western Cedars)
 * lists a strictly-larger max span for the same size + spacing
 * under Southern Pine than under Redwood/Western Cedars. `PT` →
 * "southern-pine" therefore always meets-or-exceeds Cedar's
 * allowable for the same size + spacing.
 */
const CLEARING_SPECIES_ORDER: readonly Species[] = ['Cedar', 'PT'] as const;

/**
 * MVP default beam ply-count assumption — same as `spanCheck`.
 * See `span-check.ts` module header (`DEFAULT_BEAM_PLY_COUNT`)
 * for the S7-reconciliation note. Duplicated here rather than
 * imported so `remediations.ts` maintains the same intra-domain
 * separation `span-check.ts` does.
 */
const DEFAULT_BEAM_PLY_COUNT = 2;

// ==========================================================
// Helpers
// ==========================================================

/**
 * Human-readable inches label for a tabulated spacing (305 → "12",
 * 406 → "16", 610 → "24"). Used to compose disabled-reason strings
 * and summary labels; the UI's unit-aware formatter
 * (`remediation-labels.ts`) is the primary consumer.
 */
function spacingInchesLabel(mm: Mm): string {
  // MM_PER_INCH = 25.4; rounded (defensive against float drift).
  return String(Math.round(mm / 25.4));
}

/**
 * Human-readable nominal label ("2x10" as-is). Kept as a helper so
 * a future revision (e.g., "2×10" with a real times character)
 * lands in one place.
 */
function nominalLabel(nominal: LumberNominal): string {
  return nominal;
}

/**
 * Species → strongest-adjective label used in summary strings.
 */
function speciesLabel(species: Species): string {
  return species;
}

/**
 * Compute `wouldClear` from `(newAllowableMm, actualSpanMm)`. Pulls
 * the boolean-derivation into ONE place so the invariant
 * `wouldClear implies newAllowableMm > 0 && newAllowableMm >=
 * actualSpanMm` cannot drift across producers. Retained as a
 * DISPLAY-only guard for the `newAllowableMm` estimate — the
 * ground-truth `wouldClear` decision comes from `verifyPatchClears`
 * (S16 pair-fix).
 */
function computeWouldClear(newAllowableMm: Mm, actualSpanMm: Mm): boolean {
  return newAllowableMm > 0 && newAllowableMm >= actualSpanMm;
}

/**
 * Build a candidate `MaterialRef` for a species swap. When the
 * CURRENT species is `Composite` (grade `NA`) and we swap to a
 * wood species (Cedar / PT), the grade MUST become `No2` — the
 * S13 catalog rule for wood framing. Without this, the swap would
 * inherit `grade: 'NA'`, the wood-species SpanTable lookup would
 * return 0, and the swap would surface as disabled with a
 * misleading reason (S16 pair-fix, Opus review #6).
 *
 * For a WOOD → wood swap (Cedar → PT), the grade is retained
 * as-is (typically `No2`).
 */
function candidateSpeciesMaterial(
  current: MaterialRef,
  target: Species,
): MaterialRef {
  const isCompositeToWood =
    current.species === 'Composite' && target !== 'Composite';
  return {
    ...current,
    species: target,
    grade: isCompositeToWood ? 'No2' : current.grade,
  };
}

/**
 * Build a candidate `DeckDesign` from the current design + a
 * `RemediationPatch`. Mirrors the `patchFromRemediation` mapping
 * in `application/apply-remediation.ts` but is INLINED here so the
 * domain module stays independent of the application layer. The
 * shallow-merge is safe because every `RemediationPatch` variant
 * targets a specific leaf path.
 *
 * @param design The current `DeckDesign`.
 * @param patch  The `RemediationPatch` describing the change.
 * @returns The patched `DeckDesign` (a fresh object; the caller's
 *          original is not mutated).
 */
function applyPatchForVerification(
  design: DeckDesign,
  patch: RemediationPatch,
): DeckDesign {
  switch (patch.kind) {
    case 'reduce-joist-spacing':
      return {
        ...design,
        joist: { ...design.joist, spacingMm: patch.newSpacingMm },
      };
    case 'upgrade-joist-size':
      return {
        ...design,
        joist: {
          ...design.joist,
          material: { ...design.joist.material, nominal: patch.newNominal },
        },
      };
    case 'upgrade-beam-size':
      return {
        ...design,
        beam: {
          ...design.beam,
          material: { ...design.beam.material, nominal: patch.newNominal },
        },
      };
    case 'change-joist-species':
      return {
        ...design,
        joist: {
          ...design.joist,
          material: candidateSpeciesMaterial(
            design.joist.material,
            patch.newSpecies,
          ),
        },
      };
    case 'change-beam-species':
      return {
        ...design,
        beam: {
          ...design.beam,
          material: candidateSpeciesMaterial(
            design.beam.material,
            patch.newSpecies,
          ),
        },
      };
    case 'add-support-row': {
      // feat/block-count-per-joist — Method B's primary control
      // is `blockRowsHint` (a COUNT). Always dispatch
      // `blockRowsHint = proposedRows` so the actual layout
      // resolver honors the patch. Under count-primary,
      // `blockSpacingMm` is IGNORED when `blockRowsHint` is set,
      // so a spacing-only dispatch would leave the grid
      // unchanged — a silent no-op the verify path would then
      // (correctly) report as still-warning.
      //
      // Guard: block foundations only. `posts-on-footings` is
      // never proposed by `produceAddSupportRow`; the branch is
      // defensive against a synthetic patch on a
      // `posts-on-footings` design.
      if (design.foundation.type === 'posts-on-footings') {
        return design;
      }
      return {
        ...design,
        foundation: {
          ...design.foundation,
          blockRowsHint: patch.proposedRows,
        },
      };
    }
    /* c8 ignore next 5 */
    default: {
      const _exhaustive: never = patch;
      void _exhaustive;
      return design;
    }
  }
}

/**
 * Verify a candidate patch against a REAL recompute of the patched
 * design (S16 pair-fix). Returns the ground-truth `wouldClear`
 * decision plus the recomputed `newAllowableMm` (from the persisted
 * warning if the patch reduced but did not clear, else `null` —
 * caller falls back to a display estimate).
 *
 * ### Error handling
 *
 * If `recompute` throws (LayoutError — e.g. the patched design has
 * a below-minimum dimension), we return
 * `{ wouldClear: false, invalidPatch: true, newAllowableMm: null }`
 * so the caller can surface the candidate as disabled with a
 * clear reason. `computeRemediations` NEVER throws — that
 * discipline is preserved end-to-end.
 */
function verifyPatchClears(
  warning: Warning,
  design: DeckDesign,
  patch: RemediationPatch,
  recompute: (design: DeckDesign) => readonly Warning[],
): {
  readonly wouldClear: boolean;
  readonly newAllowableMm: Mm | null;
  readonly invalidPatch: boolean;
} {
  const patched = applyPatchForVerification(design, patch);
  let warnings: readonly Warning[];
  try {
    warnings = recompute(patched);
  } catch {
    // The patched design is invalid (e.g. LayoutError). The
    // candidate can't be evaluated → mark as invalid so caller
    // disables with a reason.
    return { wouldClear: false, newAllowableMm: null, invalidPatch: true };
  }
  // A warning at the SAME (memberId, kind) is the "still
  // over-spanned" signal. If we find one, the patch reduced (or
  // didn't change) the situation — report the recomputed allowable.
  // If we find NONE, the patch cleared the warning.
  const persistent = warnings.find(
    (w) => w.memberId === warning.memberId && w.kind === warning.kind,
  );
  if (persistent) {
    return {
      wouldClear: false,
      newAllowableMm: persistent.allowableMm,
      invalidPatch: false,
    };
  }
  return {
    wouldClear: true,
    newAllowableMm: null,
    invalidPatch: false,
  };
}

/**
 * Build an enabled RemediationOption (helper — keeps producers
 * uniform + reduces object-literal duplication).
 */
function makeOption(input: {
  readonly kind: RemediationKind;
  readonly memberId: string;
  readonly patch: RemediationPatch;
  readonly summary: string;
  readonly currentAllowableMm: Mm;
  readonly newAllowableMm: Mm;
  readonly actualSpanMm: Mm;
}): RemediationOption {
  const wouldClear = computeWouldClear(input.newAllowableMm, input.actualSpanMm);
  return {
    kind: input.kind,
    memberId: input.memberId,
    patch: input.patch,
    summary: input.summary,
    currentAllowableMm: input.currentAllowableMm,
    newAllowableMm: input.newAllowableMm,
    actualSpanMm: input.actualSpanMm,
    wouldClear,
    disabled: !wouldClear,
    disabledReason: wouldClear ? null : disabledReasonForNoClear(input.kind),
  };
}

/**
 * Build a DISABLED RemediationOption with a specific reason. Used
 * when the KIND itself has no viable value (already at max size,
 * already at min spacing, no clearing species). The `patch` is a
 * placeholder — the UI's "Apply fix" button is inert for disabled
 * options (a defence-in-depth check in `RemediationControls`
 * additionally prevents applying a disabled option).
 */
function makeDisabledOption(input: {
  readonly kind: RemediationKind;
  readonly memberId: string;
  readonly patch: RemediationPatch;
  readonly summary: string;
  readonly currentAllowableMm: Mm;
  readonly actualSpanMm: Mm;
  readonly disabledReason: string;
}): RemediationOption {
  return {
    kind: input.kind,
    memberId: input.memberId,
    patch: input.patch,
    summary: input.summary,
    currentAllowableMm: input.currentAllowableMm,
    newAllowableMm: 0,
    actualSpanMm: input.actualSpanMm,
    wouldClear: false,
    disabled: true,
    disabledReason: input.disabledReason,
  };
}

/**
 * Generic disabled-reason string for the "clearing option was
 * enabled but the span still doesn't clear" branch. Rare — most
 * disabled options carry a KIND-SPECIFIC reason (max size, min
 * spacing) provided directly by the producer.
 */
function disabledReasonForNoClear(kind: RemediationKind): string {
  switch (kind) {
    case 'reduce-joist-spacing':
      return 'The tightest tabulated spacing still does not clear the over-span.';
    case 'upgrade-joist-size':
      return 'Even the largest stocked joist size does not clear the over-span.';
    case 'upgrade-beam-size':
      return 'Even the largest stocked beam size does not clear the over-span.';
    case 'change-joist-species':
      return 'No structurally-rated species swap clears the over-span.';
    case 'change-beam-species':
      return 'No structurally-rated species swap clears the over-span.';
    case 'add-support-row':
      // HIGH #3 (review — feat/block-spacing): rare fallback for
      // the recompute-still-warns branch. Most Method-B disabled
      // options carry a KIND-SPECIFIC reason from
      // `produceAddSupportRow` (either "already at minimum" or
      // the elevated / Method-A alternative-surfacing message).
      return (
        'Reducing block spacing does not clear the over-span — the ' +
        'grid is already at the minimum pitch.'
      );
    /* c8 ignore next 5 */
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return 'No viable value for this remediation.';
    }
  }
}

// ==========================================================
// Joist remediation producers
// ==========================================================

/**
 * Reduce joist spacing to the SMALLEST tabulated value that clears
 * the over-span (`clearingSpacing`). If the current spacing is
 * already at the tightest tabulated value (305 mm / 12″), the
 * option surfaces as disabled with a reason naming the limit.
 */
function produceReduceJoistSpacing(
  warning: Warning,
  design: DeckDesign,
  table: SpanTable,
  recompute: (design: DeckDesign) => readonly Warning[],
): RemediationOption {
  const currentSpacingMm = design.joist.spacingMm;
  const material = design.joist.material;

  // Tighter tabulated spacings than the current, ASCENDING order.
  // We want the SMALLEST clearing spacing — a user prefers 16" o.c.
  // over 12" if either would clear.
  const tighterSpacings = TABULATED_SPACINGS_MM.filter(
    (s) => s < currentSpacingMm,
  );

  if (tighterSpacings.length === 0) {
    // Already at the tightest tabulated spacing (or below it).
    return makeDisabledOption({
      kind: 'reduce-joist-spacing',
      memberId: warning.memberId,
      patch: { kind: 'reduce-joist-spacing', newSpacingMm: 305 },
      summary: `Reduce joist spacing (disabled)`,
      currentAllowableMm: warning.allowableMm,
      actualSpanMm: warning.actualMm,
      disabledReason:
        `Joist spacing is already at the tightest tabulated value ` +
        `(${spacingInchesLabel(currentSpacingMm)} in / ${currentSpacingMm} mm o.c.).`,
    });
  }

  // DESCENDING iteration (largest tighter first) → "smallest change
  // first" per AC3: try 610→406 before 610→305.
  const orderedTighter = [...tighterSpacings].sort((a, b) => b - a);
  let lastVerified: {
    readonly spacing: Mm;
    readonly newAllowableMm: Mm | null;
    readonly invalidPatch: boolean;
  } | null = null;
  for (const spacing of orderedTighter) {
    const patch: RemediationPatch = {
      kind: 'reduce-joist-spacing',
      newSpacingMm: spacing,
    };
    const verify = verifyPatchClears(warning, design, patch, recompute);
    lastVerified = {
      spacing,
      newAllowableMm: verify.newAllowableMm,
      invalidPatch: verify.invalidPatch,
    };
    if (verify.wouldClear) {
      // Display estimate — table lookup on the patched material at
      // the new spacing. Only used for the "was X, now Y" label.
      const displayAllowable = table.lookupJoistMaxSpan(material, spacing);
      return makeOption({
        kind: 'reduce-joist-spacing',
        memberId: warning.memberId,
        patch,
        summary:
          `Reduce joist spacing to ${spacingInchesLabel(spacing)} in o.c.`,
        currentAllowableMm: warning.allowableMm,
        // Display value: if the SpanTable lookup returned 0
        // (fail-safe / not-covered) but recompute says the warning
        // cleared, use `actualMm` as a lower-bound estimate so
        // the label reads sensibly.
        newAllowableMm:
          displayAllowable > 0 ? displayAllowable : warning.actualMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  // No tighter spacing clears — surface as disabled (AC4).
  const attempted = lastVerified?.spacing ?? orderedTighter[orderedTighter.length - 1]!;
  const attemptedAllowable = lastVerified?.newAllowableMm ?? 0;
  return {
    kind: 'reduce-joist-spacing',
    memberId: warning.memberId,
    patch: { kind: 'reduce-joist-spacing', newSpacingMm: attempted },
    summary: `Reduce joist spacing (disabled)`,
    currentAllowableMm: warning.allowableMm,
    newAllowableMm: attemptedAllowable,
    actualSpanMm: warning.actualMm,
    wouldClear: false,
    disabled: true,
    disabledReason: disabledReasonForNoClear('reduce-joist-spacing'),
  };
}

/**
 * Upgrade joist nominal to the SMALLEST framing size that clears.
 * If the current nominal is already 2×12 (max stocked), the option
 * surfaces as disabled with a reason naming the size limit.
 */
function produceUpgradeJoistSize(
  warning: Warning,
  design: DeckDesign,
  table: SpanTable,
  recompute: (design: DeckDesign) => readonly Warning[],
): RemediationOption {
  const currentNominal = design.joist.material.nominal;
  const material = design.joist.material;
  const spacingMm = design.joist.spacingMm;

  const currentIdx = FRAMING_SIZES.indexOf(currentNominal);
  const largerNominals =
    currentIdx === -1
      ? // Current is a non-framing SKU (4x4 / 6x6 / 5/4x6) — offer
        // the full framing set (2x6..2x12). Defensive; the layout
        // engine shouldn't produce a joist over-span warning for a
        // non-framing SKU today, but a future stricter layout
        // enforcement could.
        FRAMING_SIZES
      : FRAMING_SIZES.slice(currentIdx + 1);

  if (largerNominals.length === 0) {
    // Already at 2×12.
    return makeDisabledOption({
      kind: 'upgrade-joist-size',
      memberId: warning.memberId,
      patch: { kind: 'upgrade-joist-size', newNominal: '2x12' },
      summary: 'Upgrade joist size (disabled)',
      currentAllowableMm: warning.allowableMm,
      actualSpanMm: warning.actualMm,
      disabledReason:
        `Joists are already at the largest stocked framing size ` +
        `(${nominalLabel(currentNominal)}). Consider adding a mid-span support ` +
        `(future story) or reducing deck dimensions.`,
    });
  }

  let lastVerified: {
    readonly nominal: LumberNominal;
    readonly newAllowableMm: Mm | null;
  } | null = null;
  for (const nominal of largerNominals) {
    const patch: RemediationPatch = {
      kind: 'upgrade-joist-size',
      newNominal: nominal,
    };
    const verify = verifyPatchClears(warning, design, patch, recompute);
    lastVerified = { nominal, newAllowableMm: verify.newAllowableMm };
    if (verify.wouldClear) {
      const candidateMaterial: MaterialRef = { ...material, nominal };
      const displayAllowable = table.lookupJoistMaxSpan(
        candidateMaterial,
        spacingMm,
      );
      return makeOption({
        kind: 'upgrade-joist-size',
        memberId: warning.memberId,
        patch,
        summary: `Upgrade joists to ${nominalLabel(nominal)}`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm:
          displayAllowable > 0 ? displayAllowable : warning.actualMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  // No larger size clears — surface the largest available as
  // disabled with a reason naming the limit.
  const largest = lastVerified?.nominal ?? largerNominals[largerNominals.length - 1]!;
  const largestAllowable = lastVerified?.newAllowableMm ?? 0;
  return {
    kind: 'upgrade-joist-size',
    memberId: warning.memberId,
    patch: { kind: 'upgrade-joist-size', newNominal: largest },
    summary: `Upgrade joists (disabled)`,
    currentAllowableMm: warning.allowableMm,
    newAllowableMm: largestAllowable,
    actualSpanMm: warning.actualMm,
    wouldClear: false,
    disabled: true,
    disabledReason: disabledReasonForNoClear('upgrade-joist-size'),
  };
}

/**
 * Change joist species to the CLEARING alternative (CLEARING-ONLY:
 * only offer a swap that produces a strictly-larger allowable —
 * i.e. Cedar → PT for framing; NEVER PT → Cedar which would
 * WORSEN the situation).
 *
 * If no clearing target exists (current species is already the
 * strongest structural group, or the actual span exceeds even the
 * strongest species' allowable), surface as disabled with a reason.
 */
function produceChangeJoistSpecies(
  warning: Warning,
  design: DeckDesign,
  table: SpanTable,
  recompute: (design: DeckDesign) => readonly Warning[],
): RemediationOption {
  const currentSpecies = design.joist.material.species;
  const material = design.joist.material;
  const spacingMm = design.joist.spacingMm;

  // Only species STRICTLY STRONGER than current (Q2 discipline).
  // Composite is never a target (AC6).
  const currentIdx = CLEARING_SPECIES_ORDER.indexOf(currentSpecies);
  const strongerSpecies =
    currentIdx === -1
      ? // Current is Composite — offer the full clearing order.
        CLEARING_SPECIES_ORDER
      : CLEARING_SPECIES_ORDER.slice(currentIdx + 1);

  if (strongerSpecies.length === 0) {
    return makeDisabledOption({
      kind: 'change-joist-species',
      memberId: warning.memberId,
      // Placeholder patch — the option is disabled so no
      // downstream apply happens.
      patch: {
        kind: 'change-joist-species',
        newSpecies: currentSpecies,
      },
      summary: 'Change joist species (disabled)',
      currentAllowableMm: warning.allowableMm,
      actualSpanMm: warning.actualMm,
      disabledReason:
        `Joists are already the strongest structurally-rated species ` +
        `(${speciesLabel(currentSpecies)}). No stronger swap available.`,
    });
  }

  let lastVerified: {
    readonly species: Species;
    readonly newAllowableMm: Mm | null;
  } | null = null;
  for (const species of strongerSpecies) {
    const patch: RemediationPatch = {
      kind: 'change-joist-species',
      newSpecies: species,
    };
    const verify = verifyPatchClears(warning, design, patch, recompute);
    lastVerified = { species, newAllowableMm: verify.newAllowableMm };
    if (verify.wouldClear) {
      const candidateMaterial = candidateSpeciesMaterial(material, species);
      const displayAllowable = table.lookupJoistMaxSpan(
        candidateMaterial,
        spacingMm,
      );
      return makeOption({
        kind: 'change-joist-species',
        memberId: warning.memberId,
        patch,
        summary: `Change joist species to ${speciesLabel(species)}`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm:
          displayAllowable > 0 ? displayAllowable : warning.actualMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  // No stronger species clears — surface as disabled (AC4).
  const strongest = lastVerified?.species ?? strongerSpecies[strongerSpecies.length - 1]!;
  const strongestAllowable = lastVerified?.newAllowableMm ?? 0;
  return {
    kind: 'change-joist-species',
    memberId: warning.memberId,
    patch: { kind: 'change-joist-species', newSpecies: strongest },
    summary: `Change joist species (disabled)`,
    currentAllowableMm: warning.allowableMm,
    newAllowableMm: strongestAllowable,
    actualSpanMm: warning.actualMm,
    wouldClear: false,
    disabled: true,
    disabledReason: disabledReasonForNoClear('change-joist-species'),
  };
}

// ==========================================================
// Beam remediation producers
// ==========================================================

/**
 * Upgrade beam nominal to the smallest framing size that clears.
 * Beam-span table lookup uses the CURRENT joist spacing as the
 * tributary-span proxy — same defaulting `spanCheck` does. See
 * `span-check.ts` module header "Beam ply-count" section.
 *
 * The beam remediation uses `warning.actualMm` as the beam
 * post-to-post span; the ply-count is fixed at
 * `DEFAULT_BEAM_PLY_COUNT` (matches `spanCheck` unchanged).
 */
function produceUpgradeBeamSize(
  warning: Warning,
  design: DeckDesign,
  table: SpanTable,
  recompute: (design: DeckDesign) => readonly Warning[],
): RemediationOption {
  const currentNominal = design.beam.material.nominal;
  const material = design.beam.material;

  const currentIdx = FRAMING_SIZES.indexOf(currentNominal);
  const largerNominals =
    currentIdx === -1 ? FRAMING_SIZES : FRAMING_SIZES.slice(currentIdx + 1);

  if (largerNominals.length === 0) {
    return makeDisabledOption({
      kind: 'upgrade-beam-size',
      memberId: warning.memberId,
      patch: { kind: 'upgrade-beam-size', newNominal: '2x12' },
      summary: 'Upgrade beam size (disabled)',
      currentAllowableMm: warning.allowableMm,
      actualSpanMm: warning.actualMm,
      disabledReason:
        `Beams are already at the largest stocked framing size ` +
        `(${nominalLabel(currentNominal)}).`,
    });
  }

  let lastVerified: {
    readonly nominal: LumberNominal;
    readonly newAllowableMm: Mm | null;
  } | null = null;
  for (const nominal of largerNominals) {
    const patch: RemediationPatch = {
      kind: 'upgrade-beam-size',
      newNominal: nominal,
    };
    const verify = verifyPatchClears(warning, design, patch, recompute);
    lastVerified = { nominal, newAllowableMm: verify.newAllowableMm };
    if (verify.wouldClear) {
      // Display estimate — use the beam-table lookup at the
      // warning's `actualMm` as a conservative tributary. If the
      // recompute confirmed clearing but the SpanTable lookup
      // returns 0, fall back to `actualMm` so the label reads
      // sensibly (the true allowable is at least `actualMm`).
      const candidate: MaterialRef = { ...material, nominal };
      const displayAllowable = table.lookupBeamMaxSpan(
        candidate,
        warning.actualMm,
        DEFAULT_BEAM_PLY_COUNT,
      );
      return makeOption({
        kind: 'upgrade-beam-size',
        memberId: warning.memberId,
        patch,
        summary: `Upgrade beams to ${nominalLabel(nominal)}`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm:
          displayAllowable > 0 ? displayAllowable : warning.actualMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  const largest = lastVerified?.nominal ?? largerNominals[largerNominals.length - 1]!;
  const largestAllowable = lastVerified?.newAllowableMm ?? 0;
  return {
    kind: 'upgrade-beam-size',
    memberId: warning.memberId,
    patch: { kind: 'upgrade-beam-size', newNominal: largest },
    summary: `Upgrade beams (disabled)`,
    currentAllowableMm: warning.allowableMm,
    newAllowableMm: largestAllowable,
    actualSpanMm: warning.actualMm,
    wouldClear: false,
    disabled: true,
    disabledReason: disabledReasonForNoClear('upgrade-beam-size'),
  };
}

/**
 * Change beam species — the beam-side mirror of
 * `produceChangeJoistSpecies`. Same CLEARING-ONLY discipline, same
 * Composite exclusion.
 */
function produceChangeBeamSpecies(
  warning: Warning,
  design: DeckDesign,
  table: SpanTable,
  recompute: (design: DeckDesign) => readonly Warning[],
): RemediationOption {
  const currentSpecies = design.beam.material.species;
  const material = design.beam.material;

  const currentIdx = CLEARING_SPECIES_ORDER.indexOf(currentSpecies);
  const strongerSpecies =
    currentIdx === -1
      ? CLEARING_SPECIES_ORDER
      : CLEARING_SPECIES_ORDER.slice(currentIdx + 1);

  if (strongerSpecies.length === 0) {
    return makeDisabledOption({
      kind: 'change-beam-species',
      memberId: warning.memberId,
      patch: {
        kind: 'change-beam-species',
        newSpecies: currentSpecies,
      },
      summary: 'Change beam species (disabled)',
      currentAllowableMm: warning.allowableMm,
      actualSpanMm: warning.actualMm,
      disabledReason:
        `Beams are already the strongest structurally-rated species ` +
        `(${speciesLabel(currentSpecies)}). No stronger swap available.`,
    });
  }

  let lastVerified: {
    readonly species: Species;
    readonly newAllowableMm: Mm | null;
  } | null = null;
  for (const species of strongerSpecies) {
    const patch: RemediationPatch = {
      kind: 'change-beam-species',
      newSpecies: species,
    };
    const verify = verifyPatchClears(warning, design, patch, recompute);
    lastVerified = { species, newAllowableMm: verify.newAllowableMm };
    if (verify.wouldClear) {
      const candidate = candidateSpeciesMaterial(material, species);
      const displayAllowable = table.lookupBeamMaxSpan(
        candidate,
        warning.actualMm,
        DEFAULT_BEAM_PLY_COUNT,
      );
      return makeOption({
        kind: 'change-beam-species',
        memberId: warning.memberId,
        patch,
        summary: `Change beam species to ${speciesLabel(species)}`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm:
          displayAllowable > 0 ? displayAllowable : warning.actualMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  const strongest = lastVerified?.species ?? strongerSpecies[strongerSpecies.length - 1]!;
  const strongestAllowable = lastVerified?.newAllowableMm ?? 0;
  return {
    kind: 'change-beam-species',
    memberId: warning.memberId,
    patch: { kind: 'change-beam-species', newSpecies: strongest },
    summary: `Change beam species (disabled)`,
    currentAllowableMm: warning.allowableMm,
    newAllowableMm: strongestAllowable,
    actualSpanMm: warning.actualMm,
    wouldClear: false,
    disabled: true,
    disabledReason: disabledReasonForNoClear('change-beam-species'),
  };
}

// ==========================================================
// Add-support-row remediation producer (S25 — ticket #47)
// ==========================================================

/**
 * Sentinel placeholder patch counts for disabled add-support-row
 * options where the current/proposed row count is not meaningful
 * (elevated designs — no block grid at all; SpanTable fail-safe
 * — cannot derive the base). Uses the perimeter-minimum (2) as a
 * schema-safe filler so the discriminated-union `patch` remains
 * structurally valid; consumers rendering the option MUST route
 * through `option.summary` (not the `patch.currentRows` /
 * `patch.proposedRows` numbers) — see `ui/warnings/
 * remediation-labels.ts` `headlineFor` add-support-row branch.
 */
const ADD_SUPPORT_ROW_PLACEHOLDER_ROWS = 2 as const;

/**
 * Build a disabled `add-support-row` option whose row-count
 * numbers are meaningless (elevated / cannot-determine cases).
 * The `summary` is the disabled-safe label the UI renders as the
 * headline; the disabled `reason` carries the specific
 * explanation. Extracted so the elevated + fail-safe branches
 * share ONE presentation shape.
 */
function makeDisabledAddSupportRowNoRowCount(input: {
  readonly warning: Warning;
  readonly disabledReason: string;
}): RemediationOption {
  return {
    kind: 'add-support-row',
    memberId: input.warning.memberId,
    patch: {
      kind: 'add-support-row',
      targetBeamId: input.warning.memberId,
      currentRows: ADD_SUPPORT_ROW_PLACEHOLDER_ROWS,
      proposedRows: ADD_SUPPORT_ROW_PLACEHOLDER_ROWS,
    },
    // The summary is rendered as the headline by
    // `remediation-labels.ts` for disabled add-support-row options
    // (whose currentRows/proposedRows placeholders would otherwise
    // build a contradictory "N → M" arrow). Read it as if it were
    // the button label.
    summary: 'Add a support row',
    currentAllowableMm: input.warning.allowableMm,
    newAllowableMm: 0,
    actualSpanMm: input.warning.actualMm,
    wouldClear: false,
    disabled: true,
    disabledReason: input.disabledReason,
  };
}

/**
 * FLOATING-only foundation-level remediation. Densifies the
 * block grid under the joist/beam by ONE row (rows +z) — cheapest
 * possible fix because it changes NO framing SKU.
 *
 * ## S26 FIX #4 method-aware branching (review-gate)
 *
 *   - **Elevated + over-span-beam**: DISABLED with FR-032
 *     "switch to floating" reason. Elevated has no block grid to
 *     densify; the elevated intermediate-beam variant is deferred
 *     post-MVP (ticket #47 §16 Q7). Every elevated design
 *     (posts-on-footings AND deck-blocks per FR-030) receives the
 *     same actionable hint — the user must learn about the
 *     alternative regardless of which valid elevated variant they
 *     chose.
 *
 *   - **Floating Method A (`beams-and-joists`) + over-span-beam**:
 *     DISABLED with the Method-A alternative reason. Method A's
 *     block rows are PINNED to the two rim beams (see
 *     `computeMethodA` in `floating-layout.ts`); adding a row does
 *     NOT shorten the rim beam's +x span (beams run across the
 *     deck WIDTH, not length). The user must pursue a real fix:
 *     reduce joist spacing / upgrade joist / switch to Method B.
 *
 *   - **Floating Method B (`joists-on-blocks`) + over-span-joist**:
 *     ENABLED — adding a block row genuinely shortens the joist
 *     support span (blocks sit directly under joists in +z rows;
 *     more rows → smaller block-to-block gap). This is where the
 *     add-support-row math actually pays off post-S26.
 *
 *   - **All other combinations**: `null` — the remediation KIND
 *     is structurally not modelable (joist warning on elevated /
 *     Method A, beam warning on Method B, posts-on-footings, etc.).
 *
 * When the grid CANNOT densify any further (adjacent-block gap at
 * the proposed row count would drop below `MIN_BLOCK_SPACING_MM`),
 * a disabled option surfaces with an explicit reason — AC4 in the
 * module header: never silently omit a KIND we model.
 *
 * ## `currentRows` derivation
 *
 * See `deriveCurrentRows` — mirrors `computeBlockGrid`'s
 * `resolveGridCount` clamp so the reported base count matches
 * what the actual layout produces (S25 pair-fix: previously the
 * derivation returned the raw hint, mislabeling `blockRowsHint:0`
 * as "currentRows=0 → proposed=1" when the real layout produced
 * 2 rows).
 *
 * If the SpanTable returns 0 (fail-safe from an unknown SKU),
 * we surface a disabled option with a reason — we cannot recommend
 * densifying a grid whose base row count we can't establish.
 *
 * @returns `RemediationOption` if applicable (enabled OR disabled
 *   with reason), `null` if the remediation KIND doesn't apply.
 */
function produceAddSupportRow(
  warning: Warning,
  design: DeckDesign,
  table: SpanTable,
  recompute: (design: DeckDesign) => readonly Warning[],
): RemediationOption | null {
  // `table` retained for signature symmetry with the other
  // produce-* helpers (used only by SpanTable-dependent ones).
  void table;
  // FR-032 elevated clause (S25 pair-fix / Opus HIGH#1): every
  // elevated design gets a DISABLED option with a reason that
  // surfaces the alternative construction MODEL. Elevated designs
  // don't have a block grid to densify (elevated intermediate-beam
  // variant is deferred post-MVP, ticket #47 §16 Q7). Only
  // over-span-beam warnings receive the disabled option — a joist
  // warning on elevated has no add-support-row modelling at all.
  if (design.structure !== 'floating') {
    if (warning.kind !== 'over-span-beam') return null;
    return makeDisabledAddSupportRowNoRowCount({
      warning,
      disabledReason:
        'Switch to Floating construction to enable intermediate support rows.',
    });
  }

  // S26 FIX #4 (review-gate, Opus-HIGH + QA-GAP-3) — Method A's
  // block grid rows are PINNED to the two rim beams (see
  // `computeMethodA` in `floating-layout.ts`); `blockRowsHint` is
  // a no-op for +z in Method A. Adding a row of blocks does NOT
  // shorten the rim beam's +x span (beams run across the deck
  // WIDTH, not length). Return a DISABLED option that surfaces
  // the REAL alternative — the DIY user must learn what will
  // actually work (per FR-032's "MUST surface the alternative"
  // clause). Only over-span-beam warnings emit this in Method A
  // — a joist warning under Method A is not modeled by
  // add-support-row (framing swap or joist-spacing reduction is
  // the correct path).
  if (design.floatingFraming === 'beams-and-joists') {
    if (warning.kind !== 'over-span-beam') return null;
    return makeDisabledAddSupportRowNoRowCount({
      warning,
      disabledReason:
        'Rim beams span the deck width in this framing — reduce joist ' +
        'spacing, use a heavier joist, or switch to "Joists on blocks" ' +
        'framing.',
    });
  }

  // Method B — block rows GENUINELY shorten joist span (blocks
  // sit directly under joists; more rows means smaller
  // block-to-block gap along +z, which is the joist support
  // span). The KIND that this remediation targets is
  // `over-span-joist` in Method B. Method B has no beams — an
  // over-span-beam warning here would indicate a defect, so
  // return null (the KIND isn't modelable).
  if (warning.kind !== 'over-span-joist') return null;

  // Floating + a non-block foundation is INVALID per FR-030 and
  // should have been rejected at the apply-parameters boundary
  // (compat-matrix). If we somehow reach here, return null — this
  // KIND is not modelable on an incoherent design and we cannot
  // synthesize a meaningful hint.
  if (
    design.foundation.type !== 'deck-blocks' &&
    design.foundation.type !== 'tuffblocks'
  ) {
    return null;
  }

  const { widthMm, lengthMm } = design.footprint;

  // fix/joists-on-blocks-flying: `resolveMethodBGrid` now requires
  // the joist count (block columns are pinned to joist x-centers —
  // one column per joist). Read from the joist layer so this
  // callsite consumes the SAME numJoists the layout does. Cheap +
  // pure (mirror-import of the same helper `computeMethodB` calls).
  const numJoists = layoutFloatingJoists(design).length;

  // feat/block-count-per-joist — Method B's primary control is
  // now `blockRowsHint` (a COUNT). Use the ACTIVE resolver so
  // currentRows reflects what the layout renders (whether the
  // design carries the count hint, a legacy blockSpacingMm, or
  // neither).
  const currentGrid = resolveMethodBGrid(
    widthMm,
    lengthMm,
    design.foundation.blockSpacingMm,
    design.foundation.blockRowsHint,
    design.foundation.blockColsHint,
    numJoists,
  );
  const currentRows = currentGrid.rows;

  // Effective row pitch = lengthMm / (rows - 1). This is the
  // block-to-block +z gap under each joist — the span the
  // over-span-joist warning is measured against.
  const currentEffectiveSpacingMm = lengthMm / (currentRows - 1);

  // Compute the count-based target directly under count-primary:
  //   - We want a row pitch ≤ warning.allowableMm.
  //   - Pitch = lengthMm / (rows - 1), so
  //     rows ≥ lengthMm / allowableMm + 1.
  //   - Use `blockCountForAxis(lengthMm, allowableMm)` which
  //     returns `max(2, ceil(lengthMm/allowableMm) + 1)`.
  //   - Defensive: `allowableMm ≤ 0` (unrated material) → we
  //     cannot compute a target from the table; fall back to
  //     `currentRows + 1` (a single-step add-support-row).
  const requiredRows =
    warning.allowableMm > 0
      ? Math.max(2, Math.ceil(lengthMm / warning.allowableMm) + 1)
      : currentRows + 1;
  // The proposal strictly adds rows (never decreases): the user's
  // intent is "give me MORE support", not "give me the theoretical
  // minimum". Take the larger of currentRows+1 and requiredRows.
  const desiredProposedRows = Math.max(currentRows + 1, requiredRows);

  // Effective ceilings under count-primary:
  //   - rowsMaxByCap: `numJoists × rows ≤ MAX_METHOD_B_BLOCK_COUNT`.
  //   - rowsMaxByGap: adjacent-row gap ≥ MIN_BLOCK_SPACING_MM.
  // Both floor at 2 so the perimeter-two invariant holds.
  const rowsMaxByCap = Math.max(
    2,
    Math.floor(MAX_METHOD_B_BLOCK_COUNT / Math.max(1, numJoists)),
  );
  const rowsMaxByGap = Math.max(
    2,
    Math.floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1,
  );
  const effectiveMaxRows = Math.min(rowsMaxByCap, rowsMaxByGap);
  const proposedRows = Math.min(desiredProposedRows, effectiveMaxRows);

  // Derived spacing (kept in the patch shape for backwards
  // compatibility with legacy consumers of `proposedSpacingMm`;
  // the ACTIVE dispatch path writes `blockRowsHint`).
  const proposedSpacingMm = lengthMm / (proposedRows - 1);

  // Special case — the design is ALREADY at the effective max
  // row count for its footprint (rowsMaxByGap floor from
  // MIN_BLOCK_SPACING_MM). Adding a row would require sub-MIN
  // block spacing — refuse and surface the real alternative
  // (heavier joist / shorter deck).
  //
  // We detect this by checking `currentRows >= rowsMaxByGap` OR
  // `currentEffectiveSpacingMm ≤ MIN_BLOCK_SPACING_MM + ε`. The
  // second form catches the "carrier design pinned blockSpacingMm
  // at MIN" case that pre-dates count-primary.
  if (
    currentRows >= rowsMaxByGap ||
    currentEffectiveSpacingMm <= MIN_BLOCK_SPACING_MM + 1e-6
  ) {
    return {
      kind: 'add-support-row',
      memberId: warning.memberId,
      patch: {
        kind: 'add-support-row',
        targetBeamId: warning.memberId,
        currentRows,
        proposedRows: currentRows,
        currentSpacingMm: currentEffectiveSpacingMm,
        proposedSpacingMm: currentEffectiveSpacingMm,
      },
      summary: 'Reduce block spacing to add support (disabled)',
      currentAllowableMm: warning.allowableMm,
      newAllowableMm: 0,
      actualSpanMm: warning.actualMm,
      wouldClear: false,
      disabled: true,
      disabledReason:
        'Block spacing is already at the minimum — reduce joist size or ' +
        'deck length.',
    };
  }

  // If the numJoists-cap prevents adding rows (proposed ≤ current
  // via rowsMaxByCap), surface the cap-specific reason instead
  // of a misleading "N → N" arrow.
  if (proposedRows <= currentRows) {
    return {
      kind: 'add-support-row',
      memberId: warning.memberId,
      patch: {
        kind: 'add-support-row',
        targetBeamId: warning.memberId,
        currentRows,
        proposedRows: currentRows,
        currentSpacingMm: currentEffectiveSpacingMm,
        proposedSpacingMm: currentEffectiveSpacingMm,
      },
      summary: 'Reduce block spacing to add support (disabled)',
      currentAllowableMm: warning.allowableMm,
      newAllowableMm: 0,
      actualSpanMm: warning.actualMm,
      wouldClear: false,
      disabled: true,
      disabledReason:
        'Block-count cap prevents adding more support rows — reduce ' +
        'deck size / joist count or use a stronger joist.',
    };
  }

  const patch: RemediationPatch = {
    kind: 'add-support-row',
    targetBeamId: warning.memberId,
    currentRows,
    proposedRows,
    currentSpacingMm: currentEffectiveSpacingMm,
    proposedSpacingMm,
  };
  const verify = verifyPatchClears(warning, design, patch, recompute);

  if (verify.invalidPatch) {
    return {
      kind: 'add-support-row',
      memberId: warning.memberId,
      patch,
      summary: 'Reduce block spacing to add support (disabled)',
      currentAllowableMm: warning.allowableMm,
      newAllowableMm: 0,
      actualSpanMm: warning.actualMm,
      wouldClear: false,
      disabled: true,
      disabledReason:
        'Reducing block spacing would produce an invalid design.',
    };
  }

  if (verify.wouldClear) {
    // The new adjacent-block gap along +z under the proposal.
    // Under count-primary this equals `lengthMm / (proposedRows - 1)`.
    const newActualSpanMm = lengthMm / (proposedRows - 1);
    return makeOption({
      kind: 'add-support-row',
      memberId: warning.memberId,
      patch,
      summary: `Reduce block spacing to add support (${currentRows} → ${proposedRows})`,
      currentAllowableMm: warning.allowableMm,
      newAllowableMm: warning.allowableMm,
      actualSpanMm: newActualSpanMm,
    });
  }

  // Verify said still-warning. The invariant
  // "pitch ≤ allowable ⇒ no over-span" makes this unreachable
  // when we scale rows to hit the exact target — but if it
  // fires, surface as disabled rather than an ENABLED-but-
  // nonclearing option.
  return {
    kind: 'add-support-row',
    memberId: warning.memberId,
    patch,
    summary: `Reduce block spacing to add support (${currentRows} → ${proposedRows})`,
    currentAllowableMm: warning.allowableMm,
    newAllowableMm: verify.newAllowableMm ?? 0,
    actualSpanMm: warning.actualMm,
    wouldClear: false,
    disabled: true,
    disabledReason: disabledReasonForNoClear('add-support-row'),
  };
}

// ---------------------------------------------------------------------------
// HIGH #3 (review — feat/block-spacing)
//
// The pre-HIGH#3 `deriveCurrentRows(design, table)` helper called
// `resolveGridCount(blockRowsHint, lengthMm, joistSpanMaxMm)` — a
// helper ORTHOGONAL to the active Method-B resolver
// `resolveMethodBGrid`. Because the active resolver PREFERS
// `blockSpacingMm` over the legacy `blockRowsHint`, the old helper
// misreported row counts under the spacing-primary path (LYING
// labels flagged by all 3 reviewers). It has been REMOVED — the
// only consumer, `produceAddSupportRow`, now computes rows inline
// via `resolveMethodBGrid` so the reported count always matches
// what the layout actually produces (spacing-aware, cap-aware).
// The `SpanTable` is no longer needed for row derivation; the
// warning already carries `allowableMm`.
// ---------------------------------------------------------------------------

// ==========================================================
// Public entry point
// ==========================================================

/**
 * Compute the (possibly empty, always non-null, always finite)
 * array of `RemediationOption` for a single `Warning`.
 *
 * Ordering: cheapest-first — see module header AC3 discussion.
 * NEVER throws; every failure branch yields either an empty array
 * (when the warning KIND isn't one we model) or a
 * disabled-with-reason option (never silent).
 *
 * @param warning   The warning to remediate.
 * @param design    The current `DeckDesign` — used to derive
 *                  candidate patches (framing-size ladder, spacing
 *                  ladder, species swap direction).
 * @param table     A conforming `SpanTable`. Used ONLY for display
 *                  estimates of `newAllowableMm`; the `wouldClear`
 *                  decision comes from `recompute`.
 * @param recompute A function that runs `computeLayout + spanCheck`
 *                  on a `DeckDesign` and returns the warnings. May
 *                  throw `LayoutError` for invalid designs — the
 *                  compute catches and surfaces the offending
 *                  candidate as disabled. Wired at the state layer
 *                  via `computeLayoutAndCheck` (see
 *                  `state/hooks.useRemediationsForWarning`).
 */
export function computeRemediations(
  warning: Warning,
  design: DeckDesign,
  table: SpanTable,
  recompute: (design: DeckDesign) => readonly Warning[],
): readonly RemediationOption[] {
  if (warning.kind === 'over-span-joist') {
    // S26 FIX #4 (review-gate) — under Method B, adding a block
    // row DOES shorten joist span (blocks are the joist support
    // in Method B). `produceAddSupportRow` handles the Method-B
    // gate internally and returns `null` for elevated / Method A
    // / non-block foundations. Cheapest-first ordering: block-row
    // densification (no material change) comes before framing
    // swaps.
    const addSupport = produceAddSupportRow(warning, design, table, recompute);
    return [
      ...(addSupport ? [addSupport] : []),
      produceReduceJoistSpacing(warning, design, table, recompute),
      produceUpgradeJoistSize(warning, design, table, recompute),
      produceChangeJoistSpecies(warning, design, table, recompute),
    ];
  }
  if (warning.kind === 'over-span-beam') {
    // S25 (ticket #47 + pair-fix) — `produceAddSupportRow` returns
    // `null` only when the remediation KIND is structurally not
    // modelable on THIS design (joist warning routed by mistake,
    // OR floating + posts-on-footings — an FR-030-invalid combo
    // that should have been rejected at load / apply-parameters).
    // For every other case (including `structure = 'elevated'`,
    // which returns a DISABLED option with the FR-032 alternative
    // reason), the option is surfaced. Drop the null slot rather
    // than reserve an empty position — the option list is
    // presented as an ordered sequence in the UI, so a `null`
    // there would render an odd gap.
    const addSupport = produceAddSupportRow(warning, design, table, recompute);
    return [
      // Order per ticket AC8: add-support-row first (cheapest,
      // no material change — even when disabled, the user learns
      // about the alternative before scanning framing-swap
      // options), then framing size, then species.
      ...(addSupport ? [addSupport] : []),
      produceUpgradeBeamSize(warning, design, table, recompute),
      produceChangeBeamSpecies(warning, design, table, recompute),
    ];
  }
  // Unknown / future warning kind — return empty (never throw).
  return [];
}
