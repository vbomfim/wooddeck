/**
 * `src/domain/spans/remediations.ts` — S16 issue #38.
 *
 * ## Purpose
 *
 * Given a single `Warning` (from `spanCheck`), the current
 * `DeckDesign`, and any conforming `SpanTable`, derive the set of
 * ONE-CLICK REMEDIATION OPTIONS the ui layer can offer the user to
 * clear the warning. Each option carries:
 *
 *   - A discriminated-union `patch` describing WHAT to change
 *     (spacing / joist size / beam size / joist species / beam
 *     species). The state layer converts the patch into a
 *     `DeepPartial<DeckDesign>` at apply time (see
 *     `state/design-store.applyRemediation`).
 *   - A pre-computed `newAllowableMm` from a hypothetical SpanTable
 *     lookup under the patched configuration — so the ui can render
 *     "new allowable ~14 ft ← was ~11 ft" without re-running the
 *     layout engine.
 *   - `wouldClear` (a boolean) + `disabled`/`disabledReason` — the
 *     UI hides nothing: even "not viable" options surface with a
 *     reason.
 *
 * ## Fail-safe / NEVER-throws discipline (AC5)
 *
 * Mirrors `spanCheck`: the compute NEVER throws. A malformed
 * warning kind, a Composite species (fail-safe from the IRC table),
 * a zero-returning mock table — every branch returns a stable
 * (possibly all-disabled) array. Silently returning `[]` is
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
 *     1. upgrade-beam-size      (medium)
 *     2. change-beam-species    (largest)
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
 * ## Known limitation — no cross-warning coupling
 *
 * `computeRemediations` computes `newAllowableMm` from the
 * `SpanTable` ONLY. It does NOT run the full `computeLayout` in the
 * loop (that would (a) be expensive, and (b) loop back into
 * span-check). Applying a remediation MIGHT trip a DIFFERENT
 * warning (e.g., a spacing floor from the layout engine); the
 * `application/apply-remediation.ts` step runs the full recompute,
 * and if it produces a `LayoutError` the store's error branch
 * surfaces it. Document this at the module boundary; do not paper
 * over it here.
 *
 * ## Rewritability
 *
 * The compute is a pure function of `(Warning, DeckDesign,
 * SpanTable)`. Every branch is either "add an option" or "add a
 * disabled option with a reason" — no shared mutable state, no
 * clock, no I/O. An alternative implementation from the interface
 * contract + this test file is a mechanical exercise.
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
  | 'change-beam-species';

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
  | { readonly kind: 'change-beam-species'; readonly newSpecies: Species };

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
   * Hypothetical allowable under the patch — read from
   * `SpanTable.lookup*` for the patched material. `0` indicates
   * fail-safe / not-covered (matches SpanTable's contract).
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
 * actualSpanMm` cannot drift across producers.
 */
function computeWouldClear(newAllowableMm: Mm, actualSpanMm: Mm): boolean {
  return newAllowableMm > 0 && newAllowableMm >= actualSpanMm;
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

  // Ascending order: smallest DECREASE first (i.e., largest spacing
  // still less than current). We iterate DESCENDING (largest of the
  // tighter values) so 610 → 406 is tried before 610 → 305 — matches
  // "smallest change first" per AC3.
  const orderedTighter = [...tighterSpacings].sort((a, b) => b - a);
  for (const spacing of orderedTighter) {
    const newAllowableMm = table.lookupJoistMaxSpan(material, spacing);
    if (computeWouldClear(newAllowableMm, warning.actualMm)) {
      return makeOption({
        kind: 'reduce-joist-spacing',
        memberId: warning.memberId,
        patch: { kind: 'reduce-joist-spacing', newSpacingMm: spacing },
        summary:
          `Reduce joist spacing to ${spacingInchesLabel(spacing)} in o.c.`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  // No tighter spacing clears — still surface as disabled (AC4).
  // Use the tightest tabulated as the placeholder patch value; UI
  // will render the reason.
  const tightestNewAllowable = table.lookupJoistMaxSpan(
    material,
    orderedTighter[orderedTighter.length - 1]!,
  );
  return {
    kind: 'reduce-joist-spacing',
    memberId: warning.memberId,
    patch: {
      kind: 'reduce-joist-spacing',
      newSpacingMm: orderedTighter[orderedTighter.length - 1]!,
    },
    summary: `Reduce joist spacing (disabled)`,
    currentAllowableMm: warning.allowableMm,
    newAllowableMm: tightestNewAllowable,
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
): RemediationOption {
  const currentNominal = design.joist.material.nominal;
  const material = design.joist.material;
  const spacingMm = design.joist.spacingMm;

  const currentIdx = FRAMING_SIZES.indexOf(currentNominal);
  // Nominals larger than the current — SORTED ASCENDING is intrinsic
  // to `FRAMING_SIZES` (2x6 < 2x8 < 2x10 < 2x12), so we just slice.
  const largerNominals =
    currentIdx === -1
      ? // Current is a non-framing SKU (4x4 / 6x6 / 5/4x6) — offer
        // the full framing set (2x6..2x12). This is defensive; the
        // layout engine shouldn't produce a joist over-span warning
        // for a non-framing SKU today, but a future stricter layout
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

  for (const nominal of largerNominals) {
    const candidateMaterial: MaterialRef = { ...material, nominal };
    const newAllowableMm = table.lookupJoistMaxSpan(candidateMaterial, spacingMm);
    if (computeWouldClear(newAllowableMm, warning.actualMm)) {
      return makeOption({
        kind: 'upgrade-joist-size',
        memberId: warning.memberId,
        patch: { kind: 'upgrade-joist-size', newNominal: nominal },
        summary: `Upgrade joists to ${nominalLabel(nominal)}`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  // No larger size clears — surface the largest available as
  // disabled with a reason naming the limit.
  const largest = largerNominals[largerNominals.length - 1]!;
  const largestMaterial: MaterialRef = { ...material, nominal: largest };
  const largestAllowable = table.lookupJoistMaxSpan(largestMaterial, spacingMm);
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

  for (const species of strongerSpecies) {
    const candidateMaterial: MaterialRef = {
      ...material,
      species,
      // Species swap keeps grade at the CURRENT grade — the S13
      // grade discipline filters to catalog (No2 for wood).
    };
    const newAllowableMm = table.lookupJoistMaxSpan(candidateMaterial, spacingMm);
    if (computeWouldClear(newAllowableMm, warning.actualMm)) {
      return makeOption({
        kind: 'change-joist-species',
        memberId: warning.memberId,
        patch: { kind: 'change-joist-species', newSpecies: species },
        summary: `Change joist species to ${speciesLabel(species)}`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  // No stronger species clears — surface as disabled (AC4).
  const strongest = strongerSpecies[strongerSpecies.length - 1]!;
  const strongestMaterial: MaterialRef = { ...material, species: strongest };
  const strongestAllowable = table.lookupJoistMaxSpan(strongestMaterial, spacingMm);
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
): RemediationOption {
  const currentNominal = design.beam.material.nominal;
  const material = design.beam.material;

  // Beam-lookup's second argument is the tributary joist span
  // (the beam-table's "Joist Span" column). We use the design's
  // joist tributary approximation: for elevated, this is the
  // beam-to-beam z-delta, which the layout engine derives from
  // the footprint. Without running the layout engine here we
  // approximate by the beam's `actualMm` as an UPPER-BOUND proxy —
  // conservative (larger tributary → smaller allowable), matches
  // the `spanCheck`-side conservative default.
  //
  // NOTE: this is a conservative approximation, not exact. If it
  // undercounts, we FAIL SAFE (option surfaces as disabled when it
  // would in fact clear). Correcting this requires re-running
  // `computeLayout` in the loop, which is expensive and can loop
  // back into span-check. Accepted per the "known limitation"
  // section in the module header.
  const tributaryMm = warning.actualMm;
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

  for (const nominal of largerNominals) {
    const candidate: MaterialRef = { ...material, nominal };
    const newAllowableMm = table.lookupBeamMaxSpan(
      candidate,
      tributaryMm,
      DEFAULT_BEAM_PLY_COUNT,
    );
    if (computeWouldClear(newAllowableMm, warning.actualMm)) {
      return makeOption({
        kind: 'upgrade-beam-size',
        memberId: warning.memberId,
        patch: { kind: 'upgrade-beam-size', newNominal: nominal },
        summary: `Upgrade beams to ${nominalLabel(nominal)}`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  const largest = largerNominals[largerNominals.length - 1]!;
  const largestMaterial: MaterialRef = { ...material, nominal: largest };
  const largestAllowable = table.lookupBeamMaxSpan(
    largestMaterial,
    tributaryMm,
    DEFAULT_BEAM_PLY_COUNT,
  );
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
): RemediationOption {
  const currentSpecies = design.beam.material.species;
  const material = design.beam.material;
  const tributaryMm = warning.actualMm;

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

  for (const species of strongerSpecies) {
    const candidate: MaterialRef = { ...material, species };
    const newAllowableMm = table.lookupBeamMaxSpan(
      candidate,
      tributaryMm,
      DEFAULT_BEAM_PLY_COUNT,
    );
    if (computeWouldClear(newAllowableMm, warning.actualMm)) {
      return makeOption({
        kind: 'change-beam-species',
        memberId: warning.memberId,
        patch: { kind: 'change-beam-species', newSpecies: species },
        summary: `Change beam species to ${speciesLabel(species)}`,
        currentAllowableMm: warning.allowableMm,
        newAllowableMm,
        actualSpanMm: warning.actualMm,
      });
    }
  }

  const strongest = strongerSpecies[strongerSpecies.length - 1]!;
  const strongestMaterial: MaterialRef = { ...material, species: strongest };
  const strongestAllowable = table.lookupBeamMaxSpan(
    strongestMaterial,
    tributaryMm,
    DEFAULT_BEAM_PLY_COUNT,
  );
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
 */
export function computeRemediations(
  warning: Warning,
  design: DeckDesign,
  table: SpanTable,
): readonly RemediationOption[] {
  if (warning.kind === 'over-span-joist') {
    return [
      produceReduceJoistSpacing(warning, design, table),
      produceUpgradeJoistSize(warning, design, table),
      produceChangeJoistSpecies(warning, design, table),
    ];
  }
  if (warning.kind === 'over-span-beam') {
    return [
      produceUpgradeBeamSize(warning, design, table),
      produceChangeBeamSpecies(warning, design, table),
    ];
  }
  // Unknown / future warning kind — return empty (never throw).
  return [];
}
