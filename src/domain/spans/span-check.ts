/**
 * `src/domain/spans/span-check.ts` — the pure IRC-style span-check
 * engine.
 *
 * ## Purpose
 *
 * Given a `Layout` (from `computeLayout`, S4) and a `SpanTable`
 * (any conforming implementation — `IrcSpanTable` for the MVP,
 * mocks for tests, IRC-2024 / NBC in future stories), produce zero
 * or more `Warning` records — one per over-span member, ordered by
 * `memberId` (natural / numeric-aware — see "Ordering" below).
 *
 * ## Dependency inversion (Code Review Guardian finding #4)
 *
 * This module MUST NOT import from the concrete IRC-2018 data module
 * — it depends on the `SpanTable` **interface** only. Doing so:
 *
 *   - Lets AC3 (mock table swap) pass without a code change
 *   - Lets a future story add IRC-2024 without touching the checker
 *   - Prevents accidental circular data ownership (the table owns
 *     the citations; the checker just relays them)
 *
 * This rule is enforced by THREE independent gates (belt + suspenders
 * per PR#24 review — Opus finding #1 noted the dep-cruiser layer
 * allowlist does not by itself catch intra-`src/domain/spans/`
 * imports):
 *
 *   1. `.dependency-cruiser.cjs`'s `domain-allowlist` rule (blocks
 *      any src/** import that is not under src/domain/).
 *   2. `.dependency-cruiser.cjs`'s explicit `span-check-no-irc-tables`
 *      rule (blocks `src/domain/spans/span-check.ts` from importing
 *      `src/domain/spans/irc-2018-tables*` specifically).
 *   3. A plain `readFileSync` grep in `span-check.test.ts` that
 *      fails if `irc-2018-tables` appears in an
 *      `import` / `require` / `from` clause in this file's text.
 *      Comments discussing the rule (as this header does) are fine —
 *      the regex is import-shaped only.
 *
 * ## Derivations from the Layout
 *
 * ### Joist span
 *
 * A joist's span is the center-to-center distance between the two
 * beams that support it. In the MVP layout there are exactly two
 * beams (`beam-near` at −z, `beam-far` at +z — see
 * `beam-layout.ts`). The joist span is therefore:
 *
 *     joistSpanMm = max(beam.z) − min(beam.z)
 *
 * which, for the MVP layout, equals:
 *
 *     joistSpanMm = footprint.lengthMm − FOOTING_WIDTH_MM
 *                                       ^^^^^^^^^^^^^^^^^^^^
 *                        (each beam is inset by FOOTING_WIDTH_MM/2)
 *
 * The joist itself may extend past the beams at each end
 * (cantilever) — the SPAN is the between-supports distance, matching
 * AWC DCA-6 Figure 2 "Non-Ledger Deck". This is why the checker
 * derives span from beam positions rather than from `joist.size.z`.
 *
 * If the layout has fewer than 2 beams (defensive against future
 * layouts or a hand-built fixture), the joist check is skipped —
 * there is no defensible span value to compare against.
 *
 * ### Joist spacing
 *
 * `Layout` does not carry the design's nominal spacing directly.
 * The checker derives it from the layout: sort joists by x, take
 * the difference between the first two adjacent centers. That value
 * IS the layout's `actualSpacing`, which is <= the design's nominal
 * spacing (see `joist-layout.ts` — the even-spacing algorithm
 * always yields actualSpacing <= nominal). The `IrcSpanTable`
 * absorbs the small drift with its asymmetric, downward-only snap
 * rule (see `irc-2018-tables.ts` module header — the previous
 * symmetric snap was a safety hazard called out at the PR#24
 * review gate).
 *
 * If the layout has fewer than 2 joists, the spacing derivation
 * falls back to `0` — the `SpanTable` lookup will fail-safe (no
 * tabulated row within tolerance of 0) → "not covered" warn per
 * joist. That is the correct behavior: a one-joist deck is not a
 * layout the IRC's per-joist span tables were designed for.
 *
 * ### Beam post-to-post span
 *
 * For each beam, the checker finds all posts sharing the same
 * `position.z` (posts under a beam are always at the beam's z, per
 * `post-layout.ts`). It sorts them by x, computes adjacent
 * center-to-center gaps, and takes the MAX (the longest gap is the
 * binding one for the beam's design).
 *
 * The "same z" match uses a small tolerance (`POST_Z_TOLERANCE_MM`)
 * rather than strict `===` equality (Code Review Guardian PR#24
 * Opus finding #6). Rationale: a `.deck` file round-trip could
 * introduce ε-drift in floating-point coordinates; strict `===`
 * would then drop ALL posts under a beam, and the beam check would
 * silently no-op — the exact "quiet failure" mode our fail-safe
 * discipline is designed to prevent. 0.5 mm is well below any
 * realistic beam-inset gap (150 mm+) so it cannot conflate two
 * different beams' posts.
 *
 * ### Beam ply-count (AUTONOMOUS DECISION — reconcile in S7)
 *
 * The MVP `Layout` does not carry a per-beam ply-count field. The
 * ticket §"Edge cases" mandates:
 *
 *   > "MUST default to 2 in the layout engine so the golden tests
 *   > are realistic."
 *
 * The S4 layout engine currently draws a SINGLE-ply beam (one
 * board — see `beam-layout.ts` module header). This is a
 * documented S4 simplification. Rather than reach across the
 * boundary to modify S4, `spanCheck` assumes plyCount = 2 at
 * lookup time — the canonical residential-deck default. See the
 * `DEFAULT_BEAM_PLY_COUNT` `@todo S7` note below for the removal
 * plan when S7 threads a real plyCount through LayoutMember.
 *
 * ## Ordering
 *
 * Warnings are sorted by `memberId` using a NATURAL / NUMERIC-AWARE
 * comparator (Intl.Collator with `numeric: true`) rather than a
 * plain lexicographic sort. This produces `joist-2` before
 * `joist-10` — the human-intuitive order (Code Review Guardian
 * PR#24 Opus finding #3). The comparator falls back to lex ordering
 * for equal numeric portions, so mixed-kind ids like `beam-far`
 * and `joist-0` sort predictably.
 */

import type { Layout, LayoutMember, Warning } from '../model';
import type { Mm } from '../units';

import type { SpanTable } from './span-table';

/**
 * MVP beam ply-count assumption. See module header — this is the
 * autonomous decision documented for review.
 *
 * @todo S7: read per-beam plyCount from LayoutMember once S7 adds
 * it to the model; delete this default. NOTE: S4 currently DRAWS
 * 1-ply beams (a documented simplification) but this checker
 * evaluates them against the 2-ply IRC row — S7 must reconcile
 * these two by (a) adding a real `plyCount` field to beam
 * LayoutMembers, (b) defaulting new designs to 2-ply, and (c)
 * teaching beam-layout.ts to render 2-ply visually. Track under
 * GitHub issue for S7.
 */
const DEFAULT_BEAM_PLY_COUNT = 2;

/**
 * Tolerance for matching posts to their supporting beam by shared
 * `position.z` (Code Review Guardian PR#24 Opus finding #6).
 *
 * Strict `===` equality on float `position.z` would drop ALL posts
 * under a beam after a `.deck` file round-trip that introduces
 * ε-drift, silently no-opping the beam check. 0.5 mm is well below
 * every realistic beam-to-beam gap (a MIN_DECK_DIMENSION_MM = 4 ft
 * deck has beam-to-beam distance ≈ 919 mm) so it cannot conflate
 * two different beams' posts.
 */
const POST_Z_TOLERANCE_MM = 0.5;

/**
 * Natural-order (numeric-aware) comparator for `memberId` sort. See
 * module header "Ordering" section. `numeric: true` treats runs of
 * digits as numbers, so `joist-10` sorts AFTER `joist-2`.
 */
const MEMBER_ID_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Run the span check. Pure function; no I/O, no globals, no clock.
 *
 * Contract:
 *   - Returns `[]` when the layout is empty or no member exceeds
 *     its allowable span (AC1, empty-layout edge case).
 *   - Emits one `Warning` per over-span joist (kind
 *     `over-span-joist`) and one `Warning` per over-span beam (kind
 *     `over-span-beam`).
 *   - `Warning`s are ordered by `memberId` lexicographic ascending.
 *   - NEVER throws — a `SpanTable` lookup that returns `0` becomes
 *     a fail-safe warning with `allowableMm: 0` and a message
 *     containing "not covered" (or "not rated" for the Composite
 *     flavor) + "consult a professional". Guarantees AC4.
 *
 * Performance: O(N log N) sort + O(N) scan for N members. For the
 * MVP layout (< 100 members) this runs in well under the 10 ms
 * budget of ticket §9.
 */
export function spanCheck(layout: Layout, table: SpanTable): Warning[] {
  const warnings: Warning[] = [];

  // Partition once — spanCheck sees each member exactly once.
  const joists = layout.members.filter((m): m is LayoutMember => m.kind === 'joist');
  const beams = layout.members.filter((m): m is LayoutMember => m.kind === 'beam');
  const posts = layout.members.filter((m): m is LayoutMember => m.kind === 'post');

  // ---- Joist checks ------------------------------------------------------

  const joistSpanMm = deriveJoistSpanMm(beams);
  const joistSpacingMm = deriveJoistSpacingMm(joists);

  if (joistSpanMm !== null && joists.length > 0) {
    for (const joist of joists) {
      // Joist members are ALWAYS stamped with kind='lumber' by the
      // layout engine (see S17 MemberMaterialRef widening). This
      // guard is defensive — a `kind='block'` joist is a domain
      // impossibility, but silently trusting the union would open
      // the door to a future producer bug. Skip such a member so
      // the span check remains fail-safe rather than throwing on a
      // `lookupJoistMaxSpan` type mismatch.
      if (joist.material.kind !== 'lumber') continue;
      const allowableMm = table.lookupJoistMaxSpan(joist.material, joistSpacingMm);
      const citation = table.citationFor('joist', joist.material, joistSpacingMm);
      const warning = evaluateSpan({
        memberId: joist.id,
        kind: 'over-span-joist',
        actualMm: joistSpanMm,
        allowableMm,
        tableReference: citation,
      });
      if (warning !== null) warnings.push(warning);
    }
  }

  // ---- Beam checks -------------------------------------------------------

  if (joistSpanMm !== null) {
    for (const beam of beams) {
      const beamPostSpanMm = deriveBeamPostToPostSpanMm(beam, posts);
      if (beamPostSpanMm === null) continue; // beam with < 2 posts — skip

      // Same defensive narrowing as the joist loop above — beams
      // are always lumber, but skip a `kind='block'` beam rather
      // than pass a shape mismatch into the span table.
      if (beam.material.kind !== 'lumber') continue;
      const allowableMm = table.lookupBeamMaxSpan(
        beam.material,
        joistSpanMm,
        DEFAULT_BEAM_PLY_COUNT,
      );
      // Third parameter is the tributary joist span (mm) — the
      // IrcSpanTable citation uses this to name the R507.5 joist-span
      // COLUMN that produced the allowable (Code Review Guardian
      // PR#24 GPT#2). Mock tables that ignore the parameter still
      // work — they just get an extra number they don't use.
      const citation = table.citationFor('beam', beam.material, joistSpanMm);
      const warning = evaluateSpan({
        memberId: beam.id,
        kind: 'over-span-beam',
        actualMm: beamPostSpanMm,
        allowableMm,
        tableReference: citation,
      });
      if (warning !== null) warnings.push(warning);
    }
  }

  // ---- Order by memberId NATURALLY (numeric-aware, so "joist-2"
  // ---- precedes "joist-10"). See module header "Ordering" section.
  warnings.sort((a, b) => MEMBER_ID_COLLATOR.compare(a.memberId, b.memberId));
  return warnings;
}

// ==========================================================
// Span / spacing derivation helpers
// ==========================================================

/**
 * Beam-to-beam center distance = max(beam.z) − min(beam.z). Returns
 * `null` if there are fewer than 2 beams (no defensible span).
 */
function deriveJoistSpanMm(beams: readonly LayoutMember[]): Mm | null {
  if (beams.length < 2) return null;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const beam of beams) {
    if (beam.position.z < minZ) minZ = beam.position.z;
    if (beam.position.z > maxZ) maxZ = beam.position.z;
  }
  return maxZ - minZ;
}

/**
 * Joist on-center spacing = adjacent-joist center-to-center distance.
 * Layout produces evenly-spaced joists (`joist-layout.ts`), so any
 * adjacent pair gives the same value. Returns `0` for fewer than 2
 * joists — the `SpanTable` lookup will fail-safe (0 falls outside
 * every tabulated row's tolerance window).
 */
function deriveJoistSpacingMm(joists: readonly LayoutMember[]): Mm {
  if (joists.length < 2) return 0;
  const xs = joists.map((j) => j.position.x).sort((a, b) => a - b);
  return xs[1]! - xs[0]!;
}

/**
 * Max post-to-post distance under the given beam. Posts under a beam
 * are identified by shared `position.z` — matched with a small
 * tolerance (`POST_Z_TOLERANCE_MM`) rather than strict `===` so a
 * float ε-drift from a `.deck` round-trip cannot silently drop all
 * posts. See module header "Beam post-to-post span" section.
 *
 * Returns `null` if fewer than 2 posts are found under the beam (a
 * 1-post beam is not physically defensible; the checker abstains
 * rather than fabricates a span).
 */
function deriveBeamPostToPostSpanMm(
  beam: LayoutMember,
  posts: readonly LayoutMember[],
): Mm | null {
  const beamPosts = posts.filter(
    (p) => Math.abs(p.position.z - beam.position.z) < POST_Z_TOLERANCE_MM,
  );
  if (beamPosts.length < 2) return null;

  const xs = beamPosts.map((p) => p.position.x).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i]! - xs[i - 1]!;
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

// ==========================================================
// Warning construction — the single place where an over-span
// decision is turned into a Warning value (or `null` for compliant).
// ==========================================================

interface EvaluateSpanInput {
  readonly memberId: string;
  readonly kind: Warning['kind'];
  readonly actualMm: Mm;
  readonly allowableMm: Mm; // 0 signals fail-safe (SpanTable had no row)
  readonly tableReference: string;
}

/**
 * Decide whether the (actual, allowable) pair warrants a Warning:
 *   - `allowableMm === 0` → fail-safe warn with the "not covered /
 *     not rated" message, actualMm passed through unchanged so the
 *     panel can still show "your joist spans X mm".
 *   - `actualMm > allowableMm` → normal over-span warn.
 *   - `actualMm <= allowableMm` → return `null` (no warning; the
 *     boundary IS inclusive — span == allowable is compliant per
 *     ticket §"Edge Cases").
 */
function evaluateSpan(input: EvaluateSpanInput): Warning | null {
  if (input.allowableMm === 0) {
    return {
      memberId: input.memberId,
      kind: input.kind,
      actualMm: input.actualMm,
      allowableMm: 0,
      tableReference: input.tableReference,
      message: buildFailSafeMessage(input.tableReference),
    };
  }
  if (input.actualMm <= input.allowableMm) return null;
  return {
    memberId: input.memberId,
    kind: input.kind,
    actualMm: input.actualMm,
    allowableMm: input.allowableMm,
    tableReference: input.tableReference,
    message: buildOverSpanMessage(input),
  };
}

/**
 * "The IRC didn't cover this" message — surfaced when the
 * `SpanTable.lookup*` returns 0. Includes both the "not covered"
 * phrasing (AC4's assertion target) and a "not rated" phrasing
 * (the Composite-specific case) so a downstream test regexp can
 * match either. Ends with the mandatory "consult a professional"
 * per AC4.
 */
function buildFailSafeMessage(citation: string): string {
  // `citation` from IrcSpanTable already contains "not rated" for
  // Composite; for all other fail-safe reasons we prepend "not
  // covered by the span table" so the DIY user sees a plain-English
  // reason even if the citation itself is terse.
  const notRated = /not rated/i.test(citation);
  const reason = notRated
    ? 'this material is not rated for structural framing'
    : 'this size/spacing combination is not covered by the span table';
  return `${reason}; consult a licensed professional or your local building department. (${citation})`;
}

/** "Your span exceeds the allowable" message for the normal over-span case. */
function buildOverSpanMessage(input: EvaluateSpanInput): string {
  const label = input.kind === 'over-span-joist' ? 'Joist' : 'Beam';
  return (
    `${label} span ${Math.round(input.actualMm)} mm exceeds allowable ` +
    `${Math.round(input.allowableMm)} mm per ${input.tableReference}. ` +
    `Reduce span, add support, or upgrade the material.`
  );
}
