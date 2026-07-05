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
 * In the ELEVATED and Method-A floating layouts, a joist's span is
 * the center-to-center distance between the two beams that support
 * it. In the MVP layout there are exactly two beams (`beam-near`
 * at −z, `beam-far` at +z — see `beam-layout.ts` for elevated,
 * `floating-beam-layout.ts` for the S26 rim beams). The joist
 * span is therefore:
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
 * In Method-B floating layouts (`floatingFraming =
 * 'joists-on-blocks'`) there are NO beams — the joists rest
 * directly on blocks. Each joist's span is derived from the block
 * grid UNDER THAT JOIST: blocks with `position.x` matching the
 * joist's `position.x`, sorted by z, max adjacent-z gap. See
 * `deriveJoistSpanFromBlocks` — S26 FIX #1. Pre-fix, Method-B
 * joists silently escaped the span check.
 *
 * If the layout has fewer than 2 beams AND fewer than 2 blocks
 * match the joist, the joist check is skipped for that joist —
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
  // S19 AC8: block-supported floating beams. The block LayoutMember
  // kind was widened by S17 (`MemberKind` includes 'block'); the
  // beam-support derivation below tries POST supports first (the
  // elevated layout) and falls back to BLOCK supports (the floating
  // layout). NO IRC table logic touches this file — the added path
  // reuses `table.lookupBeamMaxSpan(...)` unchanged.
  const blocks = layout.members.filter((m): m is LayoutMember => m.kind === 'block');

  // ---- Joist checks ------------------------------------------------------

  const joistSpanMm = deriveJoistSpanMm(beams);
  const joistSpacingMm = deriveJoistSpacingMm(joists);

  for (const joist of joists) {
    // Joist members are ALWAYS stamped with kind='lumber' by the
    // layout engine (see S17 MemberMaterialRef widening). Review-gate
    // FIX 4 replaced the pre-fix silent `continue` with a fail-safe
    // warning (`allowableMm: 0`, "not rated" message) so a future
    // producer bug that stamps a block material on a joist surfaces
    // in the UI instead of hiding a real span violation.
    if (joist.material.kind !== 'lumber') {
      warnings.push(buildUnexpectedMaterialWarning(joist, 'over-span-joist'));
      continue;
    }
    // Derive THIS joist's span:
    //   - Elevated / Method A (beams present): the beam-to-beam +z
    //     span, shared across every joist. `joistSpanMm` is the
    //     max-z − min-z of the beams; skip the joist check when
    //     there are < 2 beams (`joistSpanMm === null`) UNLESS we
    //     can fall back to block-derived per-joist spans.
    //   - Method B (no beams; joists rest directly on blocks): the
    //     block-to-block +z gap under THIS joist, matched by shared
    //     +x with a small tolerance. Guarantees joist span-checks
    //     work for beam-less framing — FIX #1 (safety-critical).
    const perJoistSpanMm =
      joistSpanMm !== null
        ? joistSpanMm
        : deriveJoistSpanFromBlocks(joist, blocks);
    if (perJoistSpanMm === null) continue; // no defensible span

    const allowableMm = table.lookupJoistMaxSpan(joist.material, joistSpacingMm);
    const citation = table.citationFor('joist', joist.material, joistSpacingMm);
    const warning = evaluateSpan({
      memberId: joist.id,
      kind: 'over-span-joist',
      actualMm: perJoistSpanMm,
      allowableMm,
      tableReference: citation,
    });
    if (warning !== null) warnings.push(warning);
  }

  // ---- Beam checks -------------------------------------------------------

  // Review-gate FIX 1: for the FLOATING layout the beam-table
  // "tributary joist span" input is the beam-to-beam x-delta (each
  // beam carries a strip of decking equal to its adjacent-beam
  // spacing), NOT the elevated `joistSpanMm` (which is 0 for every
  // floating beam — all share z=0). Using 0 would snap to the
  // most-permissive IRC column and hide every real over-span. The
  // per-beam branch below picks the right source from
  // `deriveBeamSupportInfo(...).source`.
  const floatingBeamTributaryMm = deriveFloatingBeamTributaryMm(beams);

  if (joistSpanMm !== null || floatingBeamTributaryMm !== null) {
    for (const beam of beams) {
      const supportInfo = deriveBeamSupportInfo(beam, posts, blocks);
      if (supportInfo === null) continue; // beam with < 2 supports — skip

      // Same defensive narrowing as the joist loop above — beams
      // are always lumber, but a `kind='block'` beam surfaces as a
      // fail-safe warning (review-gate FIX 4) instead of silently
      // skipping the span check for that beam.
      if (beam.material.kind !== 'lumber') {
        warnings.push(buildUnexpectedMaterialWarning(beam, 'over-span-beam'));
        continue;
      }

      // Pick the tributary source based on which supports we found.
      // Elevated (post-supported) → joist-to-joist span across the
      // beam (max-z − min-z of beams). Floating (block-supported)
      // → beam-to-beam +x spacing (max adjacent-x gap of beams).
      const tributaryMm: Mm =
        supportInfo.source === 'block'
          ? floatingBeamTributaryMm ?? 0
          : joistSpanMm ?? 0;

      const allowableMm = table.lookupBeamMaxSpan(
        beam.material,
        tributaryMm,
        DEFAULT_BEAM_PLY_COUNT,
      );
      // Third parameter is the tributary joist span (mm) — the
      // IrcSpanTable citation uses this to name the R507.5 joist-span
      // COLUMN that produced the allowable (Code Review Guardian
      // PR#24 GPT#2). Mock tables that ignore the parameter still
      // work — they just get an extra number they don't use.
      const citation = table.citationFor('beam', beam.material, tributaryMm);
      const warning = evaluateSpan({
        memberId: beam.id,
        kind: 'over-span-beam',
        actualMm: supportInfo.spanMm,
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
 * S26 FIX #1 (safety-critical) — derive a Method-B joist's span from
 * the BLOCK grid. In Method B (`floatingFraming =
 * 'joists-on-blocks'`) the joists rest directly on blocks — there
 * are NO beams — and each joist's between-supports span is the max
 * adjacent-z gap of the blocks in the grid.
 *
 * ## Derivation (feat/block-spacing rework)
 *
 * Method B's block grid is now REGULAR in both axes (grid pitch
 * `blockSpacingMm` — see `floating-layout.ts` `computeMethodB`),
 * so every column shares the same set of z-positions. The joist
 * span is therefore the max adjacent-z gap of the UNIQUE
 * z-values across ALL blocks. Every joist gets the same span
 * (they all cross the same block grid).
 *
 * Pre-feat/block-spacing this function matched blocks by
 * x-tolerance to the joist's x (blocks were placed one-per-joist
 * at exact joist x-centers). After feat/block-spacing blocks form
 * a regular grid whose x-positions no longer coincide with joist
 * x-centers — the x-tolerance filter would return 0 matches per
 * joist and SILENTLY SKIP every joist span check, which is the
 * safety-critical failure the FIX #1 rework was designed to
 * prevent in the first place. Deriving the span from the grid's
 * unique z-values keeps the check honest under the new model.
 *
 * Returns `null` when fewer than 2 blocks match (a single-block
 * grid has no defensible span; the check falls back to the
 * existing "abstain rather than fabricate" pattern). A well-formed
 * Method B design has a perimeter-two minimum → always ≥ 2 unique
 * z-values, so this fallback is defense-in-depth.
 *
 * ## Why this fix is safety-critical
 *
 * Pre-fix (S26), `spanCheck` derived every joist's span from the
 * beam positions — Method B emits ZERO beams → `joistSpanMm ===
 * null` → the entire joist-check block was skipped. A QA probe
 * on a 12 × 40 ft Method-B deck with `blockRowsHint = 2` produced
 * ZERO warnings even though the 40-ft joist span was ~3.3× the
 * IRC allowable. The IRC span check is the app's core safety
 * value; silently skipping it is the worst possible failure mode.
 *
 * feat/block-spacing preserves this safety-critical seam: the
 * joist span still surfaces from the block grid, just from the
 * grid's row pitch rather than a per-joist column match. The
 * per-joist result is identical for every joist (regular grid)
 * so calling this once per joist yields the same warning-per-
 * joist behavior as pre-fix — the UI + warning-list stays stable.
 */
function deriveJoistSpanFromBlocks(
  _joist: LayoutMember,
  blocks: readonly LayoutMember[],
): Mm | null {
  if (blocks.length < 2) return null;
  // Regular grid → unique z-values are shared across columns.
  // Snap to a mm-resolution key to defend against float drift
  // from `.deck` round-trips (matches the intent of the pre-fix
  // POST_Z_TOLERANCE_MM tolerance, applied on collapse rather
  // than match).
  const uniqueZs = Array.from(
    new Set(blocks.map((b) => Math.round(b.position.z * 1e3) / 1e3)),
  ).sort((a, b) => a - b);
  if (uniqueZs.length < 2) return null;

  let maxGap = 0;
  for (let i = 1; i < uniqueZs.length; i++) {
    const gap = uniqueZs[i]! - uniqueZs[i - 1]!;
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

/**
 * Support-derivation info for a beam. The `.source` field discriminates
 * elevated ('post') from floating ('block') support layouts so the
 * beam check can pick the right tributary-span source (Review-gate
 * FIX 1):
 *   - elevated: tributary = joist span (beam-to-beam z-delta)
 *   - floating: tributary = beam-to-beam x-delta (adjacent-beam
 *     spacing along +x); each beam carries a strip of decking
 *     equal to the worst-case adjacent-beam gap.
 *
 * This is the ONLY behavioral seam between "elevated" and "floating"
 * in the beam check; the IRC beam-span table sees the same
 * `lookupBeamMaxSpan(material, tributaryMm, plyCount)` call for
 * both structures (`irc-2018-tables.ts` unchanged). See
 * `span-check-floating.test.ts` for the real-IrcSpanTable e2e proof.
 *
 * `deriveBeamSupportInfo` tries POST supports first (the elevated
 * layout: posts share the beam's z, spaced along +x) and falls back
 * to BLOCK supports (the floating layout: blocks share the beam's
 * x, spaced along +z). The two paths are mutually exclusive by
 * structure — an elevated layout has zero blocks and a floating
 * layout has zero posts. Match uses a small tolerance
 * (`POST_Z_TOLERANCE_MM`, reused for block-along-x matching under
 * the same rationale) rather than strict `===`. Returns `null` if
 * fewer than 2 supports are found under the beam.
 */
interface BeamSupportInfo {
  readonly spanMm: Mm;
  readonly source: 'post' | 'block';
}

function deriveBeamSupportInfo(
  beam: LayoutMember,
  posts: readonly LayoutMember[],
  blocks: readonly LayoutMember[],
): BeamSupportInfo | null {
  const postSpan = deriveBeamPostToPostSpanMm(beam, posts);
  if (postSpan !== null) return { spanMm: postSpan, source: 'post' };
  const blockSpan = deriveBeamBlockToBlockSpanMm(beam, blocks);
  if (blockSpan !== null) return { spanMm: blockSpan, source: 'block' };
  return null;
}

/**
 * Beam-to-beam cross-width spacing for a FLOATING layout — every
 * floating beam shares `.position.z = 0` and is spaced along +x;
 * this returns the MAX adjacent-x gap (the worst-case tributary for
 * any beam in the row, so the beam-span lookup is conservative for
 * every beam in the array).
 *
 * Review-gate FIX 1: an earlier revision passed the elevated
 * `joistSpanMm` (max-z minus min-z, which is `0` for floating) to
 * `lookupBeamMaxSpan`, which snaps to the MOST-permissive IRC
 * beam-span column and hid every real over-span. The tributary
 * derived here restores IRC-2018 R507.5's intended semantics
 * (the "joist span" column is really the load-strip width per beam,
 * which for floating IS the beam-to-beam x-delta).
 *
 * Returns `null` for < 2 beams — a single-beam layout has no
 * defensible tributary.
 */
function deriveFloatingBeamTributaryMm(
  beams: readonly LayoutMember[],
): Mm | null {
  if (beams.length < 2) return null;
  // Detect beam orientation. Pre-S26: beams ran along +z, spaced
  // along +x — tributary = max +x gap. S26 Method-A: rim beams run
  // along +x, spaced along +z — tributary = max +z gap. Detect
  // via the FIRST beam's long-axis. All floating beams in a given
  // layout share the same orientation by construction.
  const first = beams[0]!;
  const runsAlongX = first.size.x >= first.size.z;
  const coords = beams
    .map((b) => (runsAlongX ? b.position.z : b.position.x))
    .sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < coords.length; i++) {
    const gap = coords[i]! - coords[i - 1]!;
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
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

/**
 * Max block-to-block distance under the given FLOATING beam. Blocks
 * under a beam are identified by shared `position.x` — the mirror
 * of the elevated "posts share beam.z" match. Same 0.5 mm tolerance
 * for the same reason (`.deck` round-trip ε-drift must not silently
 * drop all blocks and turn the beam check into a no-op).
 *
 * Returns `null` if fewer than 2 blocks are found under the beam.
 * S19 AC8: "For each beam, the max distance between adjacent
 * supporting blocks is looked up against the same beam-span table
 * used for elevated designs."
 */
function deriveBeamBlockToBlockSpanMm(
  beam: LayoutMember,
  blocks: readonly LayoutMember[],
): Mm | null {
  // Beam orientation — S26 rework:
  //   - pre-S26 floating beams ran along +z (long axis = z), and
  //     their supporting blocks shared beam.position.x.
  //   - S26 Method-A rim beams run along +x (long axis = x), and
  //     their supporting blocks share beam.position.z.
  //
  // Detect the long-axis from `beam.size` (the model's canonical
  // orientation carrier — see model.ts LAYOUT COORDINATE FRAME).
  // The block-gap axis is the beam's LONG axis (the direction the
  // beam spans, i.e. the direction adjacent supports are spaced).
  const beamRunsAlongX = beam.size.x >= beam.size.z;

  const beamBlocks = blocks.filter((b) => {
    const matchCoord = beamRunsAlongX
      ? b.position.z - beam.position.z
      : b.position.x - beam.position.x;
    return Math.abs(matchCoord) < POST_Z_TOLERANCE_MM;
  });
  if (beamBlocks.length < 2) return null;

  const coords = beamBlocks
    .map((b) => (beamRunsAlongX ? b.position.x : b.position.z))
    .sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < coords.length; i++) {
    const gap = coords[i]! - coords[i - 1]!;
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

/**
 * Review-gate FIX 4 — fail-safe warning for a structural member
 * (joist / beam) whose material is NOT lumber (e.g. a block-kind
 * material accidentally stamped on a joist). The layout engine
 * currently guarantees this never happens (only lumber producers
 * emit joist + beam LayoutMembers), but silently `continue`-ing
 * would mask a future producer bug AND suppress span warnings for
 * that member. Instead, emit a fail-safe warning with
 * `allowableMm: 0` (matching the "not covered" fail-safe pattern)
 * and a message naming the unexpected material kind.
 */
function buildUnexpectedMaterialWarning(
  member: LayoutMember,
  kind: 'over-span-joist' | 'over-span-beam',
): Warning {
  const label = kind === 'over-span-joist' ? 'Joist' : 'Beam';
  return {
    memberId: member.id,
    kind,
    actualMm: 0,
    allowableMm: 0,
    tableReference: 'span-check.ts — unexpected material kind',
    message:
      `${label} member '${member.id}' has unexpected material kind ` +
      `'${member.material.kind}' (span-check only rates lumber); ` +
      `this size/material combination is not covered by the span table; ` +
      `consult a licensed professional or your local building department.`,
  };
}
