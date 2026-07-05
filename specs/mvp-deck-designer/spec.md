# Feature Specification: MVP Wood Deck Designer

**Feature Branch**: `feat/mvp-deck-designer`
**Created**: 2026-07-02
**Status**: Draft
**Input**: User description: "A browser-only, client-side app that lets a DIY homeowner visualize a freestanding rectangular wood deck in 3D. Enter width × length × height, joist spacing, board size, and species/material; the app auto-lays out framing (joists, beams, posts, footings) and decking, renders it in 3D with orbit/zoom/pan, and lets the user toggle individual layers to 'see underneath.' Includes IRC-style span-table warnings. Save/load locally, download `.deck` JSON, PNG screenshot. No backend, no auth."

**Owner**: @vbomfim
**Last updated**: 2026-07-05 (feat/block-count-per-joist — Method B support control PIVOT from DISTANCE `blockSpacingMm` to COUNT `blockRowsHint`; user now sets HOW MANY blocks sit under each joist and they spread EVENLY end-to-end; `blockSpacingMm` legacy/superseded when the count is set; span-safe default preserved; UI switched from a distance field to an integer count stepper. **Review-gate follow-up (same day)** — remediation label rewritten to be count-first ("Add support rows (X → Y)"); the field now displays the ACTUAL current row count when `blockRowsHint` is unset (not a hardcoded starter); shared `clampMethodBRows` helper prevents remediation-vs-resolver drift; absent-hint default is now derived from the joist's IRC allowable via a threaded-through `SpanTable` — span-safe across the 12×12 → 40×40 matrix; CSS parity restored with the length field it replaced; persistence round-trip pinned for legacy-only, count-only, and mixed carriers.)
**Issue tracker**: (populated when the epic issue is created — see Decomposition)
**Tickets**: Epic #1 · Stories #2–#16 (S1–S15) · #38 (S16) · **Epic 2 (Phase F): #39 (S17), #40 (S18), #41 (S19), #42 (S20), #43 (S21), #44 (S22), #45 (S23), #46 (S24), #47 (S25), #48 (S26), S27 (feat/joist-beam-connection PR #64)** — see Decomposition

> **2026-07-05 amendment (feat/block-count-per-joist review-gate follow-up — code-review + QA fixes on PR #71, same day):** The count-primary pivot above went through the full review gate (Code Review Opus + GPT + QA). No hard blockers but strong consensus on seven should-fixes; the following are applied in-PR:
>
> 1. **Count-first remediation label ("Add support rows (X → Y)").** All three reviewers flagged the enabled Method-B remediation label as misleading — it rendered "Reduce block spacing to add support (12′ → 3′)" but (a) the UI no longer has a "block spacing" control, (b) X/Y were LENGTHS while the user's knob is a COUNT (mismatch — user can't relate the arrow to the field), (c) "reduce" contradicted the count INCREASING. `remediation-labels.ts` now renders `Add support rows (${currentRows} → ${proposedRows})` for the enabled Method-B path. Spacing fields remain on the patch for back-compat but are ignored by the label formatter. See FR-032 Method B bullet — updated with the new label.
> 2. **Field displays the ACTUAL current row count when `blockRowsHint` is unset.** Real UX bug — the field showed a hardcoded `MIN_BLOCK_ROWS_HINT + 1` = 3 even when the layout drew 4 rows (12×12) / 7 rows (16×24). A user "confirming" 3 would SILENTLY reduce support. `BlockRowCountField.tsx` now reads `useLayout()`, counts unique block +z positions, and displays that number when the store hint is absent — the displayed value ALWAYS matches the rendered row count.
> 3. **CSS parity restored.** `BlockRowCountField` used `wd-block-row-count-field*` classes that had ZERO CSS rules — the field rendered with browser defaults, inconsistent with sibling fields (`LengthField` / `SelectField`). `parameter-panel.css` now includes `.wd-block-row-count-field*` in the same rule blocks as `.wd-length-field*` (same tokens, same invalid/error states) — visual parity restored.
> 4. **Span-safe default across ALL legal deck sizes via threaded-through `SpanTable`.** The absent-hint default was still 1220 mm-derived. Span-safe for realistic decks (≤40×40, all species — verified) but for very large legal decks (60–75 ft; schema allows to 100 ft) the `rowsMaxByCap = floor(400/numJoists)` clamp forced too-few rows → the DEFAULT started over-spanned. `ComputeLayoutOptions.spanTable` is now threaded through `computeLayoutAndCheck` → `computeLayout` → `computeFloatingLayout` → `computeMethodB` → `resolveMethodBGrid`. When the table is present and the joist material is in the catalog, the default = `max(legacyDefault, ceil(lengthMm / allowableSpanMm) + 1)`. Fallback (no table or catalog miss) preserves the legacy 1220 mm-derived count (byte-identical for consumers that don't pass the table). A parametrized regression matrix in `floating-block-count.test.ts` pins ZERO `over-span-joist` on FRESH Method-B designs across `{12×12, 12×20, 16×24, 20×30, 40×40}` × `{2×6, 2×8}` × `{PT, Cedar}`; a large-deck (75×75, 2×8) test pins the cap-bound boundary — warning FIRES honestly. FR-035 amended.
> 5. **Extracted shared `clampMethodBRows(rowsReq, numJoists, lengthMm)` helper.** The `rowsMaxByCap` / `rowsMaxByGap` / `Math.min(...)` math was duplicated in `resolveMethodBGrid` AND `remediations.produceAddSupportRow` — risking the remediation proposing a count the resolver silently clamps back (false `wouldClear`). The helper is exported via `state/index.ts` barrel and used at both callsites — remediation's proposed count is now BYTE-IDENTICAL to what the resolver keeps.
> 6. **Doc + schema + parameter-name cleanups.** `computeMethodB` docstring + `:602` inline comment rewritten from "spacing-primary" to "count-primary (`blockRowsHint > blockSpacingMm > default`)". `resolveMethodBGrid`'s `legacyRowsHint` param renamed to `blockRowsHint` (it's the PRIMARY control; the old name lied). `docs/deck-file-schema-v2.json` `blockRowsHint` descriptions on BOTH block variants updated to "PRIMARY user control (blockSpacingMm legacy-superseded when set); runtime clamp = min(rowsMaxByCap=floor(400/numJoists), rowsMaxByGap=floor(length/300)+1)". `blockSpacingMm` descriptions on both variants updated to "LEGACY (superseded by blockRowsHint)".
> 7. **Persistence-boundary round-trip pins.** New tests in `schema-v2.test.ts` pin the layout-level round-trip for (a) legacy `.deck` files with `blockSpacingMm` ONLY → serialize → deserialize → `computeLayout` produces the SAME layout, and (c) `.deck` files with BOTH `blockSpacingMm` + `blockRowsHint` → round-trip preserves both fields AND `blockRowsHint` WINS at layout time (proven by comparing against a count-only layout and against a legacy-only layout with a different spacing).
>
> All in-PR, no new PR. Method A + elevated remain byte-identical (regression pin in `floating-block-count.test.ts` verifies). Full gate stays SEQUENTIAL: lint → typecheck → boundary self-test (28/28) → vitest → build → build-artifacts check (budget < 175 KB gz).

---

> **2026-07-05 amendment (feat/block-count-per-joist — Method B support control PIVOT from DISTANCE to COUNT):** UAT surfaced that the previous DISTANCE control (`blockSpacingMm`) still under-supported the joists on a fresh deck — only 2 block rows at the ends → the joists over-spanned in the middle. The user asked to "ask how many [blocks along each joist] and spread on equivalent distance." This amendment implements that PIVOT: the UI now exposes the NUMBER of block rows along each joist as the user control, and the layout spreads them EVENLY end-to-end.
>
> 1. **Primary control: `foundation.blockRowsHint` (COUNT).** The Method-B block-row count along each joist is now the primary user control — an integer ≥ 2. `resolveMethodBGrid` prefers `blockRowsHint` over `blockSpacingMm` when both are set; the block layer computes `rows = clamp(blockRowsHint, 2, min(rowsMaxByCap, rowsMaxByGap))` and spreads them via `computeAxisCenters(lengthMm, rows)` (outer rows anchored at ±lengthMm/2, interior rows at equal spacing).
> 2. **Legacy `foundation.blockSpacingMm` SUPERSEDED when the count is set.** `blockSpacingMm` is retained in the schema for back-compat but IGNORED by the resolver when `blockRowsHint` is present. If `blockRowsHint` is absent, `blockSpacingMm` still drives the grid (legacy fallback → derives the row count via `blockCountForAxis(lengthMm, spacing)`). If NEITHER is set, the resolver falls back to the pre-fix default (`DEFAULT_METHOD_B_BLOCK_SPACING_MM = 1220 mm` — span-safe for the default 12×12 deck as verified by the count-primary regression pin in `floating-block-count.test.ts`).
> 3. **Dual clamps: cap AND gap.** `rowsMaxByCap = max(2, floor(MAX_METHOD_B_BLOCK_COUNT / numJoists))` — the joist-count-aware hard cap. `rowsMaxByGap = max(2, floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1)` — the minimum-pitch clamp (can't pack rows tighter than the block footprint). Final rows = `max(2, min(rowsReq, rowsMaxByCap, rowsMaxByGap))`. The perimeter-two floor always wins.
> 4. **UI switched from `BlockSpacingField` (distance) to `BlockRowCountField` (count).** `src/ui/fields/BlockRowCountField.tsx` — integer number input bound to `blockRowsHint`, min=2, max=100, visible ONLY when `structure === 'floating' && floatingFraming === 'joists-on-blocks'`. Helper text: "Number of blocks under each joist, spread evenly end-to-end." Dispatches through `applyParameters` — same validation seam as every other user input.
> 5. **`add-support-row` remediation is now count-primary.** `remediations.ts::produceAddSupportRow` computes `requiredRows = ceil(lengthMm / warning.allowableMm) + 1` (the smallest row count that brings pitch at or below allowable), proposes `max(currentRows + 1, requiredRows)`, and dispatches `blockRowsHint = proposedRows` through `applyRemediation`. The legacy `proposedSpacingMm` field on the patch is preserved for display back-compat but no longer drives dispatch. `applyPatchForVerification` writes `blockRowsHint` too — otherwise the verify path would write `blockSpacingMm` which the count-primary resolver IGNORES (silent no-op → false-negative verify).
> 6. **Method A + elevated UNCHANGED.** `blockRowsHint` is a Method-B-only control. Method A (beams-and-joists) pins block rows to the two rim-beam z-positions and IGNORES `blockRowsHint`; elevated (posts-on-footings) has no blocks. Regression pin: `floating-block-count.test.ts` "Method A byte-identity" section verifies the fixture stays unchanged.
> 7. **Persistence + schema.** `foundation.blockRowsHint` was already an OPTIONAL integer in the schema (both `FoundationSpecDeckBlocks` and `FoundationSpecTuffBlocks` variants), `minimum: 2`, `maximum: 100`. Already whitelisted in `apply-parameters.KNOWN_OPTIONAL_LEAF_PATHS`. Round-trip is byte-identical for any existing `.deck` file — the field just has a NEW MEANING at the resolver seam.
>
> FR-029 Method B bullet + FR-035 amended below; the 2026-07-05 "fix/joists-on-blocks-flying" DISTANCE-primary wording is SUPERSEDED (the column-pinning fix from that amendment is UNCHANGED — one column per joist remains invariant).

---

> **2026-07-05 amendment (fix/joists-on-blocks-flying — supersedes the S28 "regular grid on both axes" model; ⚠️ the "`blockSpacingMm` controls the row pitch" wording is FURTHER SUPERSEDED 2026-07-05 by feat/block-count-per-joist — see amendment above):** UAT surfaced a physical-plausibility regression in the S28 Method B layout: block COLUMNS were placed at the `blockSpacingMm` grid pitch — decoupled from the joist x-centers — so most joists sat OVER EMPTY SPACE between block columns and appeared to "fly" (float unsupported). On a 16 × 16 ft deck at 16″ o.c. joists + the 1220 mm default spacing, joists sat at 13 x-positions while block columns landed at 5 unrelated grid positions. A no-beam "joists on blocks" deck (Method B) is only physically sensible if there is a block DIRECTLY under EACH joist — that pre-S28 invariant is now RESTORED. The fix:
>
> 1. **Block COLUMNS pinned to joist x-centers.** `computeMethodB` in `src/domain/layout/floating/floating-layout.ts` now computes joists first and passes `explicitColXCenters = joists.map(j => j.position.x)` to `computeBlockGrid` — one block column per joist. Column x-set === joist x-set (byte-identical, no drift — the block layer reads positions off the joist members rather than re-calling `computeJoistXCenters`). Every joist has a full column of blocks beneath it; the "no flying joists" invariant is pinned by `floating-flying-joists.test.ts` (RED before fix, GREEN after).
> 2. **Block ROWS at the user's `blockSpacingMm` pitch along +z.** Rows still anchor at ±lengthMm/2 (`computeAxisCenters`). `rows = blockCountForAxis(lengthMm, effectiveSpacing)` where `effectiveSpacing = clampBlockSpacingMm(blockSpacingMm) ?? DEFAULT_METHOD_B_BLOCK_SPACING_MM`. The `blockSpacingMm` field NOW controls ONLY the along-joist support spacing (the span-relevant dimension — `span-check.ts::deriveMethodBJoistSpanFromBlockGrid` bounds `over-span-joist` against IRC allowables from the same row pitch). The `BlockSpacingField` UI hint is updated to reflect the new semantics: "Distance between block rows along each joist (bounds the joist span between supports)."
> 3. **Total blocks = numJoists × rows.** On the canonical 16 × 16 ft @ 16″ o.c. + 1220 mm default: 13 joists × 5 rows = 65 blocks, EVERY joist supported. Post-S28 (broken): 5 × 5 = 25 blocks but 8 of the 13 joists flew unsupported.
> 4. **Cap enforcement reduces ROWS only.** Columns are load-bearing (one per joist) — they cannot be dropped to fit the cap. `resolveMethodBGrid` now takes `numJoists` as a required parameter and computes `maxRows = max(2, floor(MAX_METHOD_B_BLOCK_COUNT / numJoists))`, then `rows = max(2, min(rowsReq, maxRows))`. Perimeter-two floor (rows ≥ 2) always wins over the cap. Degenerate corner (`numJoists × 2 > MAX_METHOD_B_BLOCK_COUNT` — only reachable with pathological joist spacing on a near-max footprint): rows stay at 2 and the total is emitted directly, bounded by the 100 ft footprint cap × joist-spacing physics (no OOM). The postcondition assertion allows `cols × rows > MAX` when `rows === 2` (perimeter-two supersedes).
> 5. **Legacy `blockColsHint` is a NO-OP for Method B.** Columns are pinned to the joist count — the number of load-bearing supports per joist is a physical property, not a UI knob. `blockRowsHint` remains honored as the legacy row-count seam when `blockSpacingMm` is absent (byte-identical to pre-S28 for a hint-only design).
> 6. **Span-safety preserved.** `deriveMethodBJoistSpanFromBlockGrid` derives the joist support span from the block grid's row pitch (max adjacent +z gap between unique block z-values). Rows are still along +z at the user pitch → the derivation is UNCHANGED. Over-span-joist fires when the user picks a `blockSpacingMm` too large for the joist material; default spacing does NOT spurious-warn (pinned in `span-check-floating.test.ts` HIGH #5).
> 7. **Method A + elevated + posts-on-footings UNCHANGED.** This fix touches Method B only. Every pre-fix golden fixture stays byte-identical (regression pin: `Method A (beams-and-joists) block positions are unchanged when blockSpacingMm is set`).
> 8. **Remediation caller updated.** `remediations.ts::produceAddSupportRow` now passes `numJoists` (via `layoutFloatingJoists(design).length`) to `resolveMethodBGrid`. The Method B `add-support-row` remediation (reduce `blockSpacingMm`) semantics are unchanged; the reported `currentRows` now reflects the ROW cap-by-rows path, not the pre-fix aspect-scaled path.
>
> Persistence + schema UNCHANGED: `blockSpacingMm` is still an OPTIONAL number in `.deck` schema v2 with `minimum: 300`, `maximum: 2438.4`. Round-trip is byte-identical to S28 for every existing `.deck` file; the fix touches only how the layout INTERPRETS the field. FR-029 Method B bullet + FR-035 amended below; the S28 "regular grid on both axes / joists no longer sit exactly on a block column" wording is SUPERSEDED.

---

> **2026-07-06 amendment (S28 — feat/block-spacing PR #66; ⚠️ superseded 2026-07-05 by fix/joists-on-blocks-flying — see amendment above):** User (DIY homeowner) UAT surfaced two related issues with the pre-S28 Method B ("joists on blocks") layout: (a) block count exploded (~150 blocks on a 16-ft deck) because the pre-S28 model placed a block under EVERY joist × N rows; (b) the user had NO CONTROL over "how far apart my blocks are." S28 replaces the pre-S28 Method B block placement with a user-controllable REGULAR block GRID at pitch `foundation.blockSpacingMm` (both axes), with the outer blocks anchored at the footprint edges. The S28 additions:
>
> 1. **Field.** `foundation.blockSpacingMm: Mm` — OPTIONAL on both block-carrying `FoundationSpec` variants (`deck-blocks` + `tuffblocks`). Absent → default 1220 mm (4 ft — sensible ground-level DIY pitch). Present → clamped to `[MIN_BLOCK_SPACING_MM = 300 mm, MAX_BLOCK_SPACING_MM = 2438.4 mm = 8 ft]` at the layout AND at the UI input boundary (HIGH #2 — stored value is always schema-legal so save/reload cannot trap the user).
> 2. **Method B block layout — REGULAR GRID at pitch `blockSpacingMm`.** Replaces the pre-S28 "columns pinned to joist x-centers" model. Per-axis count = `blockCountForAxis(spanMm, spacingMm) = max(2, ceil(spanMm / spacingMm) + 1)` — the perimeter-two floor + a `ceil` step that guarantees adjacent-block gap ≤ `spacingMm`. Joists still run along +z at `design.joist.spacingMm`; the "joists sit directly over a block column" invariant is NO LONGER guaranteed (planning-model acknowledgement — an illustrative drawing that a DIY user can nudge on paper). The IRC over-span safety check is UNCHANGED: `span-check.ts::deriveMethodBJoistSpanFromBlockGrid` derives the joist's between-supports span from the block GRID's row pitch (max adjacent-z gap between block rows). Every joist is span-checked (verified by `span-check-floating.test.ts` HIGH #5 pin — no joist silently skipped based on x-position). `blockRowsHint` + `blockColsHint` are LEGACY-SUPERSEDED for Method B — the resolver PREFERS `blockSpacingMm` over the hints (the ORTHOGONAL `blockSpacingMm > legacy hints` precedence is pinned by `floating-block-spacing.test.ts`).
> 3. **HARD CAP + closed-form.** Total block count is bounded by `MAX_METHOD_B_BLOCK_COUNT = 400` (a few-hundred-block ceiling that keeps rendering fast + BOM sane even on adversarial input). The cap is DETERMINISTIC — `resolveMethodBGrid` uses a closed-form O(1) enforcement (aspect-preserving count-floor scaling: derive `capRows = max(2, min(rowsReq, floor(sqrt(MAX / aspect))))` and `capCols = max(2, min(colsReq, floor(capRows × aspect)))`, then a single tail-shrink on the larger axis to consume any floor-arithmetic headroom) with a postcondition `cols × rows ≤ MAX_METHOD_B_BLOCK_COUNT` assertion. Pre-review this used an iterative decrement loop capped at 200 iterations that could BAIL BEFORE reaching the cap (HIGH #1 — proven exploitable for `120×120 ft → 529 blocks` before Ajv, and for the (pre-fix) 1-km schema-max footprint that Ajv permitted). Defense-in-depth: `docs/deck-file-schema-v2.json`'s `Dimensions3D.widthMm`/`lengthMm` now inline a `maximum: 30480 mm (100 ft)` residential cap (pre-fix the shared `Mm` `$def` allowed 1,000,000 mm = 1 km); the layout engine's `validateDesign` mirrors the cap AT BOTH the elevated (`validateDesign` in `layout-engine.ts`) AND floating (`validateFloatingDesign` in `floating-layout.ts`) trust boundaries — so an in-memory patch / test-fixture path that never round-trips through Ajv still hits the guard. Additionally, `validateExplicitCenters` in `block-grid.ts` tolerates `EPS_MM = 1e-6 mm` of IEEE-754 drift from `computeAxisCenters`' `-span/2 + i × step` accumulation so schema-legal fractional footprints (e.g. `10205.75 × 10757.77 mm`, drift ≈ 1.8e-12 mm on the last center) don't spuriously throw.
> 4. **UI.** A `<BlockSpacingField />` (LengthField idiom — imperial/metric via `formatLength` / `parseLength`) is VISIBLE only when `structure === 'floating' && floatingFraming === 'joists-on-blocks'`. Absent-field default is displayed; commits clamp `[MIN, MAX]` BEFORE dispatch (HIGH #2). `MIN_BLOCK_SPACING_MM` / `MAX_BLOCK_SPACING_MM` / `DEFAULT_METHOD_B_BLOCK_SPACING_MM` are re-exported through the `state` barrel so the UI has a sanctioned seam (dep-cruiser rule `ui-no-domain-layout` forbids direct `src/domain/layout/**` imports).
> 5. **Method B over-span-joist remediation — REDUCES `blockSpacingMm` (rescopes FR-032).** The pre-S28 `'add-support-row'` remediation wrote `blockRowsHint` — orthogonal to the S28 resolver (which prefers `blockSpacingMm`), so the option surfaced with `wouldClear:false` + a lying label ("7 → 8" when the layout had 6 rows; "maximum block density" reason when the user was at MIN density). The S28 rework computes the LARGEST `blockSpacingMm` ≤ the current effective spacing that yields row pitch ≤ `warning.allowableMm` (closed form: `min(currentEffective, allowable)`, clamped `[MIN, MAX]`), verifies via the existing `verifyPatchClears` recompute, and dispatches `{ foundation: { blockSpacingMm: proposedSpacingMm } }`. ENABLED with an accurate length-based label ("Reduce block spacing to add support (X → Y)") when it clears; DISABLED with the correct reason ("Block spacing is already at the minimum — reduce joist size or deck length") when even MIN spacing can't clear (only reachable for a synthetically-weak joist since real IRC-tabulated joists have allowable ≥ MIN = 300 mm). The LEGACY hint-bump remediation path is retained in `apply-remediation.ts` for backwards compat with any pre-S28 synthesized patch that lacks `proposedSpacingMm`.
> 6. **Regression pin.** Method A + elevated + posts-on-footings layouts are BYTE-IDENTICAL to pre-S28 (every pre-S28 golden fixture is unchanged — `blockSpacingMm` only alters Method B). The 400-block cap is deterministic for ANY schema-legal footprint (HIGH #1 huge-footprint test — 100×100 ft at MIN spacing stays ≤ 400).
>
> Persistence: `blockSpacingMm` is an OPTIONAL number in `.deck` schema v2 with `minimum: 300`, `maximum: 2438.4`, `additionalProperties: false` preserved. Missing on load → stays undefined; the layout applies the default at compute time. Existing v1 + v2 files without the field continue to load unchanged. New FR-035 codifies the S28 behavior below; FR-029's Method B bullet and FR-032's Method B bullet are re-scoped to point at FR-035.

---

> **2026-07-05 amendment (S27 — joist-to-beam connection, feat/joist-beam-connection PR #64):** MVP UAT surfaced a real DIY-homeowner request: today joists ALWAYS sit ON TOP of the beams ("drop beam"). Users need the OPTION to instead hang joists on the SIDE of the beam with joist hangers ("flush beam" — joist TOPS level with beam TOP). The S27 additions:
>
> 1. Adds a `beamConnection: 'drop' | 'flush'` field to `DeckDesign` (default `'drop'` = pre-S27 geometry). Placed immediately after `floatingFraming` in canonical property order (see FR-034).
> 2. Both `computeYStack` (elevated) and `computeYStackFloating` (floating Method A) DISPATCH on `beamConnection`:
>    - `'drop'`  (unchanged) — `joistBottomY === beamTopY`; framing stack = `decking + joist + beam` (+ posts for elevated).
>    - `'flush'` (new) — `joistTopY === beamTopY`; framing stack = `decking + max(joist, beam)` (+ posts for elevated). The stack is SHORTER than drop by `joistDepth` (given the validator enforces `beamDepth ≥ joistDepth`).
> 3. **Physical-plausibility guard (review-response HIGH #2):** `validateDesign` (elevated) and `validateFloatingDesign` (floating Method A) throw `LayoutError` when `beamConnection === 'flush' && joistDepth > beamDepth` (the joist would hang below the beam — impossible to attach via a hanger). The UI surfaces the specific remediation via the existing `useDesignStatus().lastError` inline banner (no new UI code — the pattern already exists for compat-matrix / structure-switch incompatibilities).
> 4. **Clear-span joist length (review-response HIGH #1):** for flush, joist `size.z` = clear span between the two beam INNER faces (`lengthMm − FOOTING_WIDTH_MM − beamThickness`). Under drop, joist `size.z` remains `footprint.lengthMm` (may cantilever past the beams — normal residential detail). Joists END at the beam faces because they are HUNG from those faces via joist hangers — a joist that passes THROUGH the beam is physically impossible in flush framing.
> 5. **Min-height dispatch (review-response HIGH #3):** `computeMinStructuralHeightMm` (elevated) and `computeMinFloatingHeightMm` (floating) both dispatch on `beamConnection`. Elevated derives from a new `computeFramingStackMm` helper (single source of truth for the elevated formula); floating derives directly from `computeYStackFloating().deckingTopY` (the floating y-stack anchor already encodes the drop-vs-flush dispatch). Flush min = `decking + max(joist, beam) + MIN_POST` for elevated / `decking + max(joist, beam)` for floating (= `decking + beam` in practice; no MIN_POST — floating has no posts); drop min unchanged. A low-profile flush deck that drop would reject NOW LOADS at the lower height — the headroom benefit the feature delivers.
> 6. **BOM — joist hangers for flush:** for `beamConnection === 'flush'`, the BOM emits a new `hardware` line with count `joistCount × 2` (two ends per joist, beam-count-invariant — safe under the current MVP invariant of exactly 2 rim beams; see `derive-bom.ts` for the rationale). SKU reflects the JOIST nominal (hangers are sized to the joist, not the beam). Drop emits no hangers. Flush joist cut LENGTHS in the packed cut-list automatically reflect the shortened `size.z` (the packer reads `size.z` directly).
> 7. **Method B (`joists-on-blocks`) is a NO-OP** for `beamConnection` — no beam layer means flush-vs-drop is meaningless. The UI selector HIDES the beamConnection option when `structure === 'floating' && floatingFraming === 'joists-on-blocks'`; the layout engine and BOM both ignore the field for Method B; and joist length stays `footprint.lengthMm`.
>
> Persistence: `beamConnection` is an OPTIONAL string enum in `.deck` schema v2. Missing on load → stamped to `'drop'` (backward compat) via the `finalizeBeamConnection` helper (mirrors S26's `finalizeFloatingFraming` — same load-default idiom). Invalid enum values are REJECTED by Ajv. Both v1→v2 migration and v2 native load paths go through the SAME finalize helper so the invariant cannot drift. New FR-034 codifies the behavior. The elevated + floating Method A drop layouts stay BYTE-IDENTICAL to pre-S27 (regression pin: every pre-S27 golden fixture is unchanged; two new goldens `elevated-12x12-flush` + `floating-16x14-oldcastle-flush` snapshot-guard the flush geometry end-to-end).

---

> **2026-07-05 amendment (S26 review-gate — floating-framing rework, fix/floating-framing-joists PR #63):** The S19 floating layout produced NO joists (decking rested directly on widely-spaced beams) and IGNORED `design.joist.spacingMm`. UAT surfaced this as a real structural gap. The S26 rework:
>
> 1. Adds a `floatingFraming: 'beams-and-joists' | 'joists-on-blocks'` discriminator to `DeckDesign` — **Method A** (default) is elevated-style framing (2 rim beams + joists at the user's chosen o.c. spacing) resting on a block grid sized to carry the rim beams; **Method B** is joists resting DIRECTLY on the block grid with no beam layer.
> 2. Both methods now respect `design.joist.spacingMm` — floating joist pitch is byte-identical to elevated for the same width + spacing (both use `computeJoistXCenters`).
> 3. **Removes the "blocking between beams" behavior** from FR-029 — the S22 blocking pieces (short 2× offcuts at IRC R502.7 sparse-brace spacing) are no longer produced by any layout path. `MemberKind = 'blocking'` and the `BlockingLayer` component remain in the codebase as dormant/reserved for a future "blocking between joists" feature; the "Blocking" checkbox in `LayerTogglePanel` was removed as a dead toggle.
> 4. **Method B span-check** — joist spans in Method B derive from the BLOCK positions under each joist (there are no beams to derive from). Same over-span warning shape as elevated; same IRC-table-driven remediations.
> 5. **S25 add-support-row remediation rescope** — under Method A + `over-span-beam`, the "Add a row of blocks" remediation is DISABLED with an alternative (reduce joist spacing / heavier joist / switch to Method B), because Method A's rows are pinned to the two rim beams and `blockRowsHint` is a no-op there. Under Method B + `over-span-joist` the remediation stays ENABLED and genuinely shortens the joist span between supports.
>
> Persistence: `floatingFraming` is an optional string enum in `.deck` schema v2; pre-S26 v2 files (and v1→v2 migrations) default to Method A UNLESS `heightMm` falls in the Method-A-too-short / Method-B-legal corridor `[209 mm, 393 mm)` for the design's material triple, in which case Method B is stamped to preserve loadability. See FR-033 below.

---

> **2026-07-04 amendment (Epic 2 — Foundations, Floating Model & Cut-List BOM):** MVP scope has been expanded — additively — before the umbrella `feat/mvp-deck-designer → main` PR. Three additions land under this spec:
>
> 1. **Foundation TYPE options** — the user picks one of three foundation systems: (a) the existing posts-on-poured-concrete-footings model, (b) precast concrete deck blocks (Oldcastle 11″×11″×7″), or (c) TuffBlock instant foundation blocks (12″×12″×4″ plastic pyramids). The existing model is preserved as the default; the two block products are added, each with its own dimensions, on-grade placement, and lumber-slot geometry.
> 2. **Construction MODEL** — the user picks one of two structural approaches: (a) `elevated` (the existing posts→beams→joists→decking stack) or (b) `floating` (a ground-level deck sitting on a grid of foundation blocks with a user-selectable framing method — beams+joists OR joists-on-blocks — and decking; no posts). Both models coexist; the user chooses per design. See the 2026-07-05 amendment (FR-033) for the per-method framing details; the pre-2026-07-05 "short blocking pieces between beams" behavior was removed and `MemberKind = 'blocking'` is now RESERVED for a future feature.
> 3. **Cut-list-optimized BOM** — the Bill of Materials packs member cut-lengths into stock lumber lengths (a 1-D cutting-stock / first-fit-decreasing bin-pack) and reports total stock boards. Blocks are counted separately, as fixed-dimension precast products.
>
> The additions require a **`.deck` schema v2** (additive discriminated union for `foundation`, new `structure` enum, extended `MemberMaterialRef` for lumber-vs-block on `LayoutMember`, two new `MemberKind` values `block` + `blocking`) with a **v1→v2 migration** so old `.deck` files continue to load. New FRs FR-026 through FR-032 codify the behavior; new user stories US6 and US7 codify the value; the Decomposition tree adds ten new stories (S17–S26) shipping before the umbrella PR. This amendment supersedes S16's Open Question Q1 — "add support" is now modelable through the new foundation model. See the Decomposition and System Impact sections for the full delta.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — "See what my deck will look like" (Priority: P1)

A DIY homeowner is planning a rectangular, freestanding deck in their backyard. They open the app, type the width, length, and height (in feet/inches or meters), pick a decking board size and species, and immediately see a 3D rendering of the finished deck. They orbit around it, zoom in, and switch between top / front / side / isometric preset views to understand how it will look in place.

**Why this priority**: The visual mockup is the #1 job of the product. Everything else (BOM, warnings, save/load) is supporting infrastructure. If the 3D visual doesn't land, nothing else matters. Confirmed by the user: "see what my deck will look like."

**Independent Test**: With a fresh browser session, entering plausible defaults (e.g., 12 ft × 16 ft × 3 ft) produces a rendered 3D deck within 3 seconds; orbit / zoom / pan / preset views all work; nothing else is required to demonstrate value.

**Acceptance Scenarios**:

1. **Given** the user opens the app for the first time, **When** the initial parameter defaults load, **Then** a 3D deck renders in the viewer with orbit / zoom / pan enabled and preset view buttons visible.
2. **Given** a rendered deck, **When** the user changes width from 12 ft to 16 ft in the parameter panel, **Then** the 3D deck updates to reflect the new footprint within 500 ms.
3. **Given** a rendered deck, **When** the user clicks the "Top" preset view, **Then** the camera transitions to an overhead orthographic-style view within 500 ms.
4. **Given** a rendered deck, **When** the user drag-orbits, scroll-zooms, and middle-drag-pans, **Then** the camera responds smoothly with no visible stutter on a modern desktop browser.

---

### User Story 2 — "Peel back the layers to see the framing" (Priority: P1)

The same DIY homeowner wants to understand what's under the deck surface. They click the layer-toggle for "Decking" to hide the top boards and reveal the joists, beams, posts, and footings underneath. They can toggle any combination of the six layers (Environment/Ground, Decking, Joists, Beams, Posts, Footings) to see how the structure is put together.

**Why this priority**: This is the differentiating UX — the reason a homeowner would use this over a generic sketch tool. Confirmed by the user as core: "the 'see underneath / peel back layers' feature is the whole point. The layers must reveal actual framing members, not an abstract plate."

**Independent Test**: With a rendered deck, toggling each of the six layer switches shows/hides that layer instantly (< 100 ms), with no camera reset and no re-render jank.

**Acceptance Scenarios**:

1. **Given** a rendered deck with all layers visible, **When** the user toggles "Decking" off, **Then** the deck boards disappear and the joists, beams, posts, and footings are visible in their correct 3D positions.
2. **Given** any layer combination, **When** the user toggles a layer on/off, **Then** the change is visible within 100 ms with no shader-recompile jank.
3. **Given** a warning exists on a joist that is over-span, **When** the user hides the Joists layer, **Then** the warning highlight remains visible on that joist's position (the WarningOverlay is independent of layer visibility).

---

### User Story 3 — "Warn me if the deck won't hold" (Priority: P2)

The homeowner picks a 2×6 joist at 24" spacing over a 16 ft span. The app checks this against IRC-style span tables for the selected species and highlights the joists as over-span in the 3D view, and lists the specific warning ("Joist 2×6 @ 24" o.c., SPF, span 4877 mm exceeds allowable 3200 mm") in a Warnings panel. A prominent, non-dismissable disclaimer makes clear this is a planning aid, not an engineering document.

**Why this priority**: Without this the app is a pretty toy. With it, the app gives real design feedback. The user explicitly confirmed: "IRC-style span-table lookups ... implement a real feature, not just a stub."

**Independent Test**: Given a deliberately over-span parameter set (e.g., 2×6 joists at 24" o.c., 16 ft span, SPF), the affected joists are highlighted in 3D and a warning line appears in the Warnings panel citing the allowable span.

**Acceptance Scenarios**:

1. **Given** an over-span parameter set, **When** the deck renders, **Then** the over-span joists are visually highlighted in the 3D view AND listed in the Warnings panel with the allowable value and reference to the IRC table row.
2. **Given** the user opens the app, **When** the app renders, **Then** the disclaimer banner "Planning aid, not an engineering document — consult a licensed professional or your local building department" is visible and cannot be dismissed for the duration of the session.
3. **Given** the user changes parameters to bring spans within limits, **When** the deck re-renders, **Then** the warnings disappear.

---

### User Story 4 — "Save and come back later" (Priority: P2)

The homeowner refines their design across multiple sessions. Their work autosaves to the browser's local storage. They can also click "Download" to save a `.deck` JSON file to disk (to email to a friend, back up, or reload later) and "Open…" to load an existing `.deck` file.

**Why this priority**: A design tool that loses your work every session is unusable. Confirmed by the user: "local browser storage + downloadable .deck JSON file."

**Independent Test**: Enter parameters → close the tab → reopen the app → the deck loads with the last-used parameters. Download a `.deck` file → clear local storage → upload the file → the deck loads identically.

**Acceptance Scenarios**:

1. **Given** an unsaved design, **When** the user reloads the tab, **Then** the last design is restored from local storage.
2. **Given** a design in the app, **When** the user clicks "Download .deck," **Then** a JSON file named `wooddeck-{timestamp}.deck.json` is downloaded to disk.
3. **Given** a `.deck` file on disk, **When** the user selects "Open…" and picks the file, **Then** the design loads into the app and the 3D view updates to match.
4. **Given** a `.deck` file with an unsupported `schema` version, **When** the user tries to open it, **Then** the app shows a clear error message and refuses to load it (never partially-loads unknown schema).

---

### User Story 5 — "Take a picture and get a shopping list" (Priority: P3)

The homeowner wants a screenshot of their finished 3D view to send to a friend, and a bill of materials (counts of joists, beams, posts, footings, decking board count and total linear feet) to take to the lumber yard.

**Why this priority**: The user gets real utility from a shareable image and a shopping list, but neither is required for the core "see what my deck will look like" outcome.

**Independent Test**: Click "Export PNG" → a PNG of the current 3D view downloads. The BOM panel shows counts and total linear feet for each material type; the numbers match a manual tally of the on-screen model.

**Acceptance Scenarios**:

1. **Given** a rendered deck, **When** the user clicks "Export PNG," **Then** a PNG file of the current 3D view (at the current camera position, at the current canvas resolution) is downloaded.
2. **Given** a rendered deck, **When** the user opens the BOM panel, **Then** it lists: joist count (by nominal SKU and length), beam count (SKU and length), post count (SKU and height), footing count, decking board count and total linear feet.

---

### User Story 6 — "Pick the foundation that suits my yard" (Priority: P1 — added 2026-07-04)

The DIY homeowner's yard reality dictates the foundation. Some users have flat, well-drained ground and want an on-grade deck they can install in an afternoon (TuffBlocks under a floating frame). Some users want a low but stable installation without digging (precast concrete deck blocks under posts). Some users need a raised deck over uneven ground (posts on poured concrete footings — the existing model). The app must let the user pick the foundation TYPE and see the design change accordingly.

**Why this priority**: The current model bakes in one foundation choice (posts on footings), which is only one of three common DIY residential-deck patterns. Without the choice, the app cannot represent the two most-common ground-level installations (deck blocks, TuffBlocks) — and the "add support" remediation from S16 has no design surface to target.

**Independent Test**: With a rendered deck, switching the foundation TYPE selector in the ParameterPanel from "Posts on poured footings" to "TuffBlock instant foundation" replaces the footings with pyramidal blocks in the 3D view within 500 ms; the BOM updates to count blocks (product SKU) instead of footings (concrete volume). Switching back returns to the original design without data loss.

**Acceptance Scenarios**:

1. **Given** the default design (posts on footings), **When** the user selects "Precast concrete deck blocks (Oldcastle 11×11×7)" from the foundation-type selector, **Then** the footings disappear and 11×11×7 concrete deck blocks appear under each post at grade (block top at y=0), the 3D scene updates within 500 ms, and the BOM lists the block count with the product SKU.
2. **Given** a design using deck blocks, **When** the user selects "Posts on poured concrete footings" from the foundation-type selector, **Then** the design returns to the original posts-and-footings layout with no other parameter loss (footprint, joist SKU, spacing, etc. all preserved).
3. **Given** a `.deck` v1 file on disk (produced by the previous MVP build with posts-on-footings only), **When** the user opens it in a build that supports schema v2, **Then** the loader migrates the design to `foundation.type = 'posts-on-footings'` transparently and the deck renders identically to how it rendered in the previous build.

---

### User Story 7 — "Build a floating deck on TuffBlocks" (Priority: P1 — added 2026-07-04, updated 2026-07-05)

The homeowner wants a low, ground-level "floating" deck built on a grid of TuffBlocks — no posts, no digging. The user picks the "Floating" construction model in the ParameterPanel and then picks the **framing method**: **Method A — Beams + joists (on blocks)** (default) or **Method B — Joists on blocks (no beams)**. Method A gives an elevated-style frame — 2 rim beams (2×8/2×10 stock) resting on the blocks along the width axis, joists (2×8 stock) running along the length axis at the user's chosen o.c. spacing, and decking on top. Method B gives the lowest-profile build — joists rest DIRECTLY on the blocks (no beam layer), and decking is on top. Both methods honor `design.joist.spacingMm`, so 12″/16″/24″ o.c. all work. The BOM correctly counts the block grid (by product SKU), the joists (packed into stock lengths), and — for Method A — the rim beams.

**Why this priority**: This is a distinct construction pattern with wide DIY appeal (a Home Depot / TuffBlock reference build). Without it, the tool cannot represent the deck the user drew in the design brief (see the hand-drawn floating-deck example in this spec's amendment context) and misses the audience of homeowners who explicitly do NOT want to dig footings or set posts. The 2026-07-05 framing split lets the user pick either the tutorial-canonical Method A (rim beams distribute load laterally across the block grid) or the low-profile Method B (joists on blocks — every joist bears on a column of blocks).

**Independent Test**: Switching the construction MODEL from "Elevated" to "Floating" replaces the posts + drop-beams layout with a block-grid-based layout within 500 ms; the framing method selector then swaps between Method A (2 rim beams + N joists on top) and Method B (N joists directly on blocks). Changing `joist.spacingMm` from 406 mm (16″ o.c.) to 305 mm (12″ o.c.) MUST change the joist count — pre-S26 this changed nothing (the joist layer did not exist in the floating model).

**Acceptance Scenarios**:

1. **Given** the default (elevated + posts + footings) design, **When** the user selects "Floating" as the construction MODEL AND "TuffBlock" as the foundation TYPE AND leaves the framing method at Method A (default), **Then** the 3D scene renders a grid of TuffBlocks at grade, EXACTLY 2 rim beams (near/far) running along the width axis at each end, N joists running along the length axis at `design.joist.spacingMm` resting on the beams, and decking on top; no posts and no footings appear; no `blocking` members appear.
2. **Given** a Method-A floating design, **When** the user switches the framing method to Method B, **Then** the 2 rim beams disappear and the joists move down to rest DIRECTLY on the blocks; the block grid rearranges so every joist bears on a column of blocks (block columns aligned to joist x-centers); the min above-grade height drops by the beam depth; no other design parameter is lost.
3. **Given** a floating-deck design, **When** the user opens the BOM panel, **Then** the panel lists: (a) block count with the product SKU (e.g. "27 × TuffBlock 12×12×4"), (b) joists grouped by stock length (packed by FR-031 first-fit-decreasing), (c) for Method A only, the 2 rim beams grouped by stock length, and (d) a total stock-board line summing (b) + (c).
4. **Given** a floating-deck design, **When** the user toggles the Blocks layer OFF and the Beams layer ON (Method A) or the Joists layer ON (Method B), **Then** the frame is visible without the block grid; toggling any layer never causes a re-layout or a shader recompile (existing NFR-002 preserved).
5. **Given** a floating-deck design, **When** the user selects "Posts on poured concrete footings" as the foundation TYPE, **Then** the app surfaces a validation error explaining that footings are only compatible with the `elevated` MODEL, per FR-030. The design MUST NOT enter an incoherent state.
6. **Given** a Method-B floating design with joists longer than the joist material's IRC-allowable span, **When** the user re-lays out the design, **Then** the Warnings panel emits an `over-span-joist` warning derived from the BLOCK positions under each joist (max adjacent-block-z gap along the joist length) and offers the "Add a row of blocks (N→N+1)" remediation (FR-032), which — when applied — bumps `blockRowsHint` by one and re-runs span-check against the new geometry.
7. **Given** a Method-A floating design with joists longer than the joist material's IRC-allowable span, **When** the user re-lays out the design, **Then** the Warnings panel emits an `over-span-beam` warning and offers the "Add a row of blocks" remediation in a DISABLED state with the alternative surfaced per FR-032: "Rim beams span the deck width in this framing — reduce joist spacing, use a heavier joist, or switch to 'Joists on blocks' framing."

---

### Edge Cases

- **Zero-sized or negative dimensions:** the parameter panel must clamp inputs to a sensible minimum (e.g., width ≥ 4 ft / 1220 mm) and refuse to render at 0.
- **Extreme dimensions:** the user could type "500 ft × 500 ft"; the app must not crash but should render or warn. A soft upper limit (e.g., 40 ft / 12 m per side) with an explanatory tooltip is acceptable.
- **Joist spacing that doesn't divide evenly:** the layout engine must handle remainders (either an extra shortened bay at one end, or a centered layout with two shortened bays). Documented behavior required.
- **Unit switch mid-design:** switching from imperial to metric must NOT alter the stored design (all values are canonical mm internally); only display formatting changes.
- **Local storage full or blocked:** the app must degrade gracefully — a warning banner appears, autosave is disabled for the session, but downloads still work.
- **`.deck` file with unknown schema version:** must refuse to load; must NOT partial-load and drop fields silently.
- **`.deck` file with corrupt JSON:** must show a clear parse-error message with no partial state change.
- **WebGL unsupported:** must show a "Your browser does not support WebGL 2" message with a link to browser-upgrade guidance; the 2D plan view and parameter panel remain usable.
- **Very large deck (e.g., 40 ft × 40 ft with 12" joist spacing):** must render within 3 s and maintain interactive frame rate (≥ 30 FPS) on a mid-range 2023 laptop.

---

## Requirements *(mandatory)*

### Functional Requirements

**Core rendering & interaction**

- **FR-001**: System MUST render a 3D visualization of a rectangular, freestanding deck built from the user-supplied parameters (width, length, height, joist size, joist spacing, decking board size, material species).
- **FR-002**: System MUST auto-lay out the structural members (joists, beams, posts, footings) and the decking boards from the user's parameters — the user does NOT place individual members.
- **FR-003**: System MUST provide 3D camera controls: free orbit (any angle), zoom in/out, and pan.
- **FR-004**: System MUST provide preset camera views: Top, Front, Side, Isometric.
- **FR-005**: System MUST render individual structural members (each joist, beam, post, footing) as distinct 3D geometry — not an abstract plate. This is required for FR-006.
- **FR-006**: System MUST support per-layer visibility toggling for at least these six layers: Environment/Ground, Decking, Joists, Beams, Posts, Footings.
- **FR-007**: Layer visibility MUST be implemented via Three.js `visible` flag (or equivalent `<group visible={…}>`) — NOT via React mount/unmount — to avoid shader-recompile jank on toggle. *(Ref: Code Review Guardian finding #6.)*

**Units**

- **FR-008**: System MUST store all lengths in canonical millimeters internally. Conversion between imperial and metric happens at the UI boundary only.
- **FR-009**: System MUST allow the user to switch the display unit system (imperial ft/in ↔ metric m/cm/mm) at runtime. Switching MUST NOT modify stored design values.
- **FR-010**: Display formatting MUST round to human-legible precision (e.g., 1 mm for metric, 1/8" for imperial).
- **FR-011**: Lumber pieces MUST be stored by nominal SKU + species + grade (e.g., `{nominal: "2x6", species: "SPF", grade: "No2"}`), NOT by raw mm dimensions. Actual mm dimensions are DERIVED via the materials catalog. *(Ref: Code Review Guardian finding #5.)*

**Materials & structure**

- **FR-012**: System MUST provide a static materials catalog containing at least: joist/beam sizes 2×6, 2×8, 2×10, 2×12; post sizes 4×4, 6×6; decking boards 5/4×6 and 2×6; species/type PT (pressure-treated), Cedar, Composite (as a material type without grading).
- **FR-013**: System MUST perform IRC-style span checks: for each joist and beam in the layout, compute whether its span is within the allowable span for its size, spacing, species, and grade. Members that exceed allowable span MUST be flagged.
- **FR-014**: System MUST highlight over-span members in the 3D view AND list them in a Warnings panel with the allowable value and a reference to the source table row.
- **FR-015**: The WarningOverlay MUST draw its own highlight geometry from the Layout data and MUST remain visible when the layer containing the flagged member is toggled off. *(Ref: Code Review Guardian finding #7.)*
- **FR-025**: For every over-span warning the Warnings panel MUST surface at least one selectable REMEDIATION OPTION — a concrete design change that, if applied, would clear or reduce the warning. Each option MUST show (a) a plain-English label naming the change (e.g. "Upgrade joists to 2×10"), (b) the resulting allowable span in the user's active unit system, and (c) whether the option would fully clear the warning. Applying an option MUST route through the existing `applyParameters` use-case so the change participates in undo/redo, autosave, and full re-layout + re-check. Remediation OPTIONS are computed by a pure domain function (unit-testable in isolation); the "apply" action is a store method. When no MVP-modelable option can clear the warning, the panel MUST tell the user why (e.g. "already at the largest stocked joist size") and MUST NOT silently offer no remediation. *(Origin: user report — "when I change length to 16' it gives me warnings ... but doesn't upgrade the project"; user preference — "reduce spacing, add support, or another option, and a button to fix based on the selected option.")*
- **FR-016**: System MUST display a non-dismissable disclaimer banner reading substantially "Planning aid, not an engineering document — consult a licensed professional or your local building department." The disclaimer MUST render on first paint. *(Ref: Code Review Guardian "Honorable mention"; user answer D12.)*

**Foundation types & construction model (added 2026-07-04 — Epic 2)**

- **FR-026** *(Foundation TYPE — additive discriminated union)*: The persisted `DeckDesign` MUST carry a `foundation` field that is a discriminated union of at least three variants: `{ type: 'posts-on-footings', post: MaterialRef, footing: FootingSpec }` (the pre-amendment default), `{ type: 'deck-blocks', product: BlockRef }` (precast concrete deck blocks, on-grade), and `{ type: 'tuffblocks', product: BlockRef }` (TuffBlock instant foundation blocks, on-grade). Adding a fourth variant post-MVP MUST NOT require a `.deck` schema bump provided the loader treats unknown `foundation.type` as an unknown-schema failure per FR-019 and provided any new variant is added under a schema-version bump.
- **FR-027** *(Construction MODEL — additive enum)*: The persisted `DeckDesign` MUST carry a `structure` field with the enum values `'elevated'` (the pre-amendment default: posts→beams→joists→decking) and `'floating'` (a ground-level frame resting on a block grid). Both models MUST coexist in the codebase — the layout engine dispatches on `structure` and runs one of two independently-testable layout paths. `structure = 'floating'` MUST NOT be combinable with `foundation.type = 'posts-on-footings'` — the compatibility matrix is enforced at the domain-model / apply-parameters boundary and surfaced as a `LayoutError` (or an equivalent typed error) when the combination is invalid. The default MUST remain `structure = 'elevated'` + `foundation.type = 'posts-on-footings'` for backward compatibility with every pre-amendment fixture and every migrated v1 `.deck` file. **2026-07-05 amendment (S26 review-gate):** the floating stack (`block → beam → joist → decking` for Method A; `block → joist → decking` for Method B) is defined by the new `floatingFraming` discriminator — see FR-033.
- **FR-028** *(Foundation-block catalog — new product category)*: The materials domain MUST include a new **foundation-block catalog** — distinct from the lumber catalog — that stocks at least the two initial block products: (a) `oldcastle-11x11x7` — the Home Depot Oldcastle 11″×11″×7″ grey concrete deck block, with a lumber cross-slot accepting 2× stock and a center pocket accepting a 4×4 post; (b) `tuffblock-12x12x4` — the 12″×12″×4″ plastic pyramidal TuffBlock with joist / beam slots. Each block record MUST carry: a stable SKU, actual mm dimensions (width, depth, height), material class (concrete-precast, polypropylene), placement mode (on-grade), and the lumber cross-section(s) the block's slot accepts. The `LayoutMember.material` field MUST be extended to a discriminated union `MemberMaterialRef = LumberRef | BlockRef` (tag: `kind: 'lumber' | 'block'`) so consumers can pattern-match on member material type without SKU string parsing.
- **FR-029** *(Floating-deck layout engine — parallel to the elevated engine; rescoped 2026-07-05 S26 review-gate)*: When `structure = 'floating'`, the layout engine MUST produce a `Layout` that dispatches on `design.floatingFraming` (see FR-033) and MUST honor `design.joist.spacingMm` (the pre-S26 layout ignored it — that is a fixed bug). The floating layout adds ONE new `MemberKind` (`block`) beyond the pre-amendment five (`joist`, `beam`, `post`, `footing`, `board`). The additional `blocking` `MemberKind` is RESERVED — no floating (or elevated) layout path emits `blocking` members in the current MVP; the kind is preserved for a future "blocking between joists" feature and the `BlockingLayer` component remains in the tree as a dormant `() => null`. The two active floating paths are:
  - **Method A — `'beams-and-joists'` (DEFAULT).** Elevated-style framing resting on a block grid. The layout MUST produce: (a) EXACTLY 2 rim beams (near/far) running along the WIDTH axis, inset from the deck z-ends by `FOOTING_WIDTH_MM / 2` (mirrors the elevated `layoutBeams`); (b) N joists running along the LENGTH axis at `design.joist.spacingMm`, spaced across the width axis via the shared `computeJoistXCenters` helper — joist pitch is byte-identical to the elevated pipeline for a given width + spacing; (c) a block grid sized to CARRY THE 2 RIM BEAMS — rows PINNED to the rim-beam z-positions (`explicitRowZCenters`), columns derived from `ceil(widthMm / BLOCK_COL_MAX_SPACING_MM) + 1` (subject to `blockColsHint`) to bound the +x block-to-block gap under each rim beam; (d) decking on top of the joists. y-stack (bottom-up): block → beam → joist → decking. `blockRowsHint` is a NO-OP under Method A (rows are pinned to the beams).
  - **Method B — `'joists-on-blocks'`.** Beam-less framing. The layout MUST produce: (a) N joists running along the LENGTH axis at `design.joist.spacingMm` (same helper as Method A); (b) NO beam members; (c) a block grid whose COLUMNS are pinned to the joist x-centers (one block column per joist — every joist has a support column beneath it) and whose ROWS are placed along +z spread EVENLY end-to-end at a user-selectable COUNT `foundation.blockRowsHint` (integer ≥ 2), with the outer rows anchored at the length axis ends (`computeAxisCenters(lengthMm, rows)`); total blocks = `numJoists × rows`; (d) decking directly on the joists. y-stack (bottom-up): block → joist → decking. `blockRowsHint` is the PRIMARY user control; the legacy `blockSpacingMm` (a distance) is SUPERSEDED when `blockRowsHint` is set — the resolver prefers count over spacing. **[amended 2026-07-05 — feat/block-count-per-joist]** The 2026-07-05 "fix/joists-on-blocks-flying" DISTANCE-primary wording is SUPERSEDED: UAT surfaced that a fresh Method B deck at the default 1220 mm spacing produced only 2 block rows at the ends → over-spanned in the middle. Under the new count-primary model the user sets HOW MANY blocks sit under each joist and they spread evenly; the default row count is span-safe (see FR-035). The column-pinning invariant from the previous amendment is UNCHANGED (one block column per joist — the "no flying joists" invariant remains). See FR-035 for the full corrected model.

  Existing FR-002 (auto-layout) and FR-005 (individual-member geometry) apply uniformly to both methods. Span-check runs for both methods per FR-013; Method B derives joist spans from the block positions under each joist (max adjacent-block-z gap along the joist length) since there are no beams to derive from.
- **FR-030** *(Foundation-type × construction-model compatibility matrix)*: The valid combinations are (a) `structure = 'elevated'` × `foundation.type ∈ { 'posts-on-footings', 'deck-blocks' }` — an elevated deck may rest posts on either poured footings or on-grade deck blocks (blocks-under-posts is a common short-height installation); (b) `structure = 'floating'` × `foundation.type ∈ { 'deck-blocks', 'tuffblocks' }` — a floating deck rests DIRECTLY on the block grid (no posts). `structure = 'floating'` × `foundation.type = 'posts-on-footings'` is INVALID and MUST be rejected at the apply-parameters boundary with a message naming the invalid combination. `structure = 'elevated'` × `foundation.type = 'tuffblocks'` is INVALID for MVP (TuffBlock is designed for ground-level decks; the standard product does NOT rate for post-supported construction) and MUST be rejected with a message naming the reason. UI selectors MUST show invalid options in a disabled state with the reason surfaced as text (FR-025 pattern), NOT silently omit them.
  - **Amendment 2026-07-04 (S20 review-gate FIX 1 + FIX 2)** — Post material for `structure = 'elevated'` × `foundation.type = 'deck-blocks'` is **derived**, not user-selected: the nominal is taken from `foundation.product.acceptsPost[0]` (the block's center pocket dictates the cross-section — e.g. Oldcastle → `'4x4'`); the species/grade is borrowed from `design.beam.material` IF that triple is stocked for the derived post nominal, otherwise it falls back to `{ species: 'PT', grade: 'No2' }` (guaranteed stocked for every post nominal in the MVP catalog). The fallback exists because the MVP materials catalog explicitly excludes composite posts, so a valid FR-030 combination with a Composite beam would otherwise fail to lay out. A user-selectable post material for the `deck-blocks` foundation variant is **post-MVP** (requires a new `FoundationSpec['deck-blocks'].post` field + `.deck` schema migration).
- **FR-031** *(Cut-list-optimized BOM — 1-D bin-pack)*: The BomPanel MUST, for every lumber SKU + species + grade group in the layout, pack the member cut-lengths into standard stock lumber lengths (the stock lengths per SKU MUST come from the materials catalog; typical values: 8, 10, 12, 14, 16, 20 ft for 2× framing; 8, 10, 12, 14, 16, 18, 20 ft for 5/4 decking). The packing algorithm MUST use First-Fit-Decreasing (FFD) as an approximation of the 1-D cutting-stock problem — this is an NP-hard problem in general but FFD is well within acceptable waste for MVP-scale decks (< 500 members). The BOM MUST report, per SKU group: (a) total stock-board count, (b) breakdown by stock length (e.g. "13 × 2×8×16 ft"), and (c) an optional expandable per-board detail showing the offcuts each stock board is cut into (e.g. "Board 14: 16″ + 14″ + 6″ + 6″ + …, waste 8″"). Blocks (from FR-028) MUST be counted separately by product SKU — they are precast products, not lumber, and MUST NOT enter the cut-list pack. The pack MUST assume a fixed kerf (blade width, MVP: 3 mm) taken off each cut; kerf is deducted from the stock board's remaining usable length after each cut.
- **FR-032** *(Actionable "add support" remediation — supersedes S16 #38 Q1; rescoped 2026-07-05 S26 review-gate)*: The remediation-options set from FR-025 MUST include, when applicable, an `'add-support-row'` option that resolves an over-span warning by adding an intermediate row of foundation blocks (for `structure = 'floating'` under **Method B** — `floatingFraming = 'joists-on-blocks'`) or an intermediate beam (post-MVP, tracked separately for `structure = 'elevated'`). When applied, the option MUST update the design so `spanCheck` re-runs against the new support geometry; if the new geometry still over-spans, a new warning is emitted (the remediation may only REDUCE, not necessarily clear — matching FR-025's `wouldClear` discipline). The option is DISABLED with a reason when the current design cannot accept an intermediate support:
  - **Elevated (MVP)** — intermediate beams are not yet modelled; the DISABLED reason MUST surface the alternative "Switch to Floating construction to enable intermediate support rows."
  - **Floating + Method A (`'beams-and-joists'`)** — block rows are PINNED to the two rim beams (`blockRowsHint` is a no-op in Method A per FR-029); the DISABLED reason MUST surface the real alternative: "Rim beams span the deck width in this framing — reduce joist spacing, use a heavier joist, or switch to 'Joists on blocks' framing." This satisfies FR-032's "surface the alternative" clause; a fabricated N→N+1 count MUST NOT be offered under Method A.
  - **Floating + Method B (`'joists-on-blocks'`)** — **[amended 2026-07-05 — feat/block-count-per-joist; label wording corrected in review-gate follow-up]** the option is ENABLED and shortens the joist support span by INCREASING `foundation.blockRowsHint` (more rows spread evenly → smaller adjacent-row pitch along +z → shorter between-supports joist span). The proposed row count is `max(currentRows + 1, ceil(lengthMm / warning.allowableMm) + 1)` — the smallest count that brings row pitch at or below the joist allowable, clamped by the shared `clampMethodBRows(rowsReq, numJoists, lengthMm)` helper to `[2, min(rowsMaxByCap, rowsMaxByGap)]` where `rowsMaxByCap = max(2, floor(MAX_METHOD_B_BLOCK_COUNT / numJoists))` and `rowsMaxByGap = max(2, floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1)`. The remediation and the resolver MUST call the SAME `clampMethodBRows` helper so the remediation's proposed count is byte-identical to what the resolver would keep (a duplicated clamp would risk the remediation proposing a count the resolver silently clamps back — false `wouldClear`). The patch dispatches `{ foundation: { blockRowsHint: proposedRows } }` and is verified by the standard `verifyPatchClears` recompute. **The remediation label is now COUNT-first — "Add support rows (X → Y)" where X = `currentRows` and Y = `proposedRows` (integers).** The prior length-based label ("Reduce block spacing to add support (12′ → 3′)") is REMOVED — under the count-primary pivot the UI has no "block spacing" control, and displaying LENGTHS while the user's knob is a COUNT was misleading (mismatch between arrow units and control units); saying "reduce" while the count INCREASES was also confusing. The spacing fields (`currentSpacingMm` / `proposedSpacingMm`) remain on the patch shape for back-compat with legacy consumers that read them, but are IGNORED by the label formatter. When the current effective row pitch is already at `MIN_BLOCK_SPACING_MM` AND the warning still fires (only physically reachable for synthetically-weak joists), the option MUST be DISABLED with the reason "Block spacing is already at the minimum — reduce joist size or deck length." When the joist-count cap prevents adding rows (`proposedRows ≤ currentRows` via `rowsMaxByCap`), the option MUST be DISABLED with the reason "Block-count cap prevents adding more support rows — reduce deck size / joist count or use a stronger joist." Pre-feat/block-count-per-joist this remediation wrote `blockSpacingMm` (distance-primary); the count-primary resolver IGNORES `blockSpacingMm` when a `blockRowsHint` is present, so writing distance would be a silent no-op — the dispatch path is now always count-primary. The patch shape retains `proposedSpacingMm` (derived from the proposed row count via `lengthMm / (proposedRows - 1)`) for display back-compat with any consumer that reads the spacing field, but the dispatch and verify paths both write `blockRowsHint`.
- **FR-033** *(Floating framing method — user-selectable; added 2026-07-05 S26 review-gate; amended 2026-07-05 issue #25 fix)*: The persisted `DeckDesign` MUST carry a `floatingFraming` field with the enum values `'beams-and-joists'` (Method A — default) and `'joists-on-blocks'` (Method B). The field is REQUIRED in the type and stamped in every design factory / migration / default; it is IGNORED when `structure === 'elevated'` (documented on the field). The ParameterPanel MUST expose a "Floating framing" selector VISIBLE ONLY when `structure === 'floating'`, with the two options labelled "Beams + joists (on blocks)" and "Joists on blocks (no beams)" — a11y-labelled and keyboard-operable, following the existing StructureSelector / FoundationTypeSelector idioms. The `.deck` schema v2 declares the field as an OPTIONAL string enum with `additionalProperties: false` preserved. On load (both v1→v2 migration and v2 native load), a missing `floatingFraming` MUST default to Method A UNLESS the design is floating AND `heightMm` falls in the corridor `[methodBMin, methodAMin)` for the design's material triple — in which case Method B is stamped so the pre-S26 low-profile design continues to load. An INVALID enum value in a `.deck` file MUST be rejected by Ajv (schema-level enum guard). The layout engine MUST validate `design.joist.spacingMm` at the floating trust boundary (also enforced on the elevated path — the check lives in the shared `validateJoistSpacing` helper in `src/domain/layout/layout-shared.ts`) BEFORE calling any joist-layout helper. The validator rejects: (a) non-finite / ≤ 0 spacings (prevent DoS via divide-by-zero in `computeJoistXCenters`); (b) `spacingMm < joist actual thickness` (impossible on-center geometry — joists would overlap by construction); (c) **[amended 2026-07-05 — closes issue #25]** any spacing whose ACHIEVABLE even-spaced result `actualSpacing = (widthMm − joistThicknessMm) / ceil((widthMm − joistThicknessMm) / spacingMm)` would fall below `joistThicknessMm` (within `EPS = 1e-6`). Case (c) closes issue #25 — a real ~1 mm adjacent-joist overlap that arose when the REQUESTED spacing equalled the joist thickness on a narrow deck (e.g. `widthMm=1220, spacingMm=38, thickness=38 → actualSpacing=36.94 mm`), which the AC3 property test caught intermittently (fast-check seed `-1901521422`). Touching face-to-face (`actualSpacing == thickness` exactly) remains ALLOWED.

- **FR-034** *(Joist-to-beam connection — user-selectable; added 2026-07-05 S27 review-gate — feat/joist-beam-connection PR #64)*: The persisted `DeckDesign` MUST carry a `beamConnection` field with the enum values `'drop'` (the pre-S27 default — joists REST ON TOP of the beams; joist bottom = beam top) and `'flush'` (joists are HUNG on the SIDE of the beams via joist hangers; joist TOP = beam top, joist TOPS flush with beam TOPS). The field is REQUIRED in the type and stamped in every design factory / migration / default; canonical property order places it immediately AFTER `floatingFraming` (before `foundation`). It is MEANINGFUL only for designs that have BOTH beams and joists — i.e. `structure === 'elevated'` (all foundations) AND `structure === 'floating' && floatingFraming === 'beams-and-joists'` (Method A). It is IGNORED for `structure === 'floating' && floatingFraming === 'joists-on-blocks'` (Method B — no beam layer to hang from).
  - **Geometry (single source of truth — the y-stack).** Both `computeYStack` (elevated) and `computeYStackFloating` (floating Method A) MUST dispatch on `beamConnection` via exhaustive `switch` (with `assertNever` on the `never` branch — fail-loud on any future enum addition). The joist / beam / decking layout modules read Y from the stack; no layer code branches on `beamConnection` directly. For `'drop'` (unchanged): `joistBottomY === beamTopY`; framing-below-walking-surface = `decking + joist + beam` (+ MIN_POST for elevated). For `'flush'` (new): `joistTopY === beamTopY` (i.e. `joistCenterY === beamTopY − joistDepth/2`); framing-below-walking-surface = `decking + max(joistDepth, beamDepth)` (+ MIN_POST for elevated). Under the FR-034 validator (below) `beamDepth ≥ joistDepth` always holds for flush, so in practice the flush stack = `decking + beamDepth` (+ MIN_POST) — SHORTER than drop by `joistDepth`, which is the lower-profile / more-headroom benefit the feature delivers.
  - **Physical-plausibility validator.** `validateDesign` (elevated) AND `validateFloatingDesign` (floating, gated on `floatingFraming === 'beams-and-joists'`) MUST throw a `LayoutError` when `beamConnection === 'flush' && joistDepth > beamDepth`. The error message MUST name both depths and prescribe BOTH remediations: choose a beam at least as deep as the joist, OR switch to `'drop'`. The UI MUST surface this via the existing `useDesignStatus().lastError` inline banner pattern (`wd-parameter-panel__error` — no new UI code; the pattern already exists for compat-matrix and structure-switch incompatibilities). The invariant "no framing member's bottom is below grade (y = 0)" MUST hold for every floating design that survives validation (blocks are excepted — they are the foundation and are intentionally buried).
  - **Clear-span joist length.** For `beamConnection === 'flush'`, joist `size.z` MUST equal the CLEAR SPAN between the two beam INNER faces (`footprint.lengthMm − FOOTING_WIDTH_MM − beamThickness` — both `layoutBeams` and `computeFloatingRimBeams` inset each beam center by `FOOTING_WIDTH_MM / 2` from the corresponding z-end). Joist end faces MUST touch the beam inner faces (touch-only — no AABB overlap between any joist and either beam under flush). Joists are HUNG from the beam faces via joist hangers; a joist that passes THROUGH the beam is physically impossible in flush framing. For `beamConnection === 'drop'`, joist `size.z` remains `footprint.lengthMm` (joists may cantilever past the beams — normal residential detail). Method B keeps `size.z = footprint.lengthMm` (no beams to shorten to). The BOM cut-list (packed via first-fit-decreasing bin-pack) reads `size.z` directly, so flush joist cut LENGTHS in the packed output automatically reflect the shortening.
  - **Min-structural-height dispatch.** `computeMinStructuralHeightMm` (elevated) AND `computeMinFloatingHeightMm` (floating Method A) MUST dispatch on `beamConnection`. Elevated derives from the new pure helper `computeFramingStackMm` (single source of truth — no duplicated drifting math with `computeYStack`). Floating derives DIRECTLY from `computeYStackFloating(design).deckingTopY` — the floating y-stack anchor already encodes the drop-vs-flush dispatch (`deckTop = beam + joist + decking` for drop, `deckTop = max(beam, joist) + decking` for flush; Method B collapses `beamDepth` to zero), so no separate framing-stack helper is needed on the floating path. Flush min < drop min by `joistDepth`. A low-profile flush deck that drop would reject at `heightMm < dropMin` NOW LOADS at `heightMm >= flushMin` — this is the headroom feature. Drop min-height is BYTE-IDENTICAL to pre-S27.
  - **BOM — joist hangers for flush.** For `beamConnection === 'flush'`, the BOM MUST emit a `hardware` section with one line per joist nominal: `count = joistCount × 2` (two ends per joist — a beam-count-invariant formulation that stays correct if a future story adds intermediate beams; safe under the current MVP invariant of exactly 2 rim beams enforced by `post-layout.ts` and the floating beam layout). SKU labels use the JOIST nominal (`"Joist hangers (2×N)"` — hangers are sized to the joist, not the beam). For `beamConnection === 'drop'`, NO hangers are emitted. The BOM structure keeps its existing shape (`hardware` is an OPTIONAL section on the BOM); drop BOMs are byte-identical to pre-S27.
  - **UI selector.** The ParameterPanel MUST expose a "Beam connection" selector (radio group, mirror the FloatingFramingSelector idiom — a11y-labelled, keyboard-operable, `aria-describedby` on the caption) with two options: `'drop'` labelled "Drop beam (joists rest on top)" and `'flush'` labelled "Flush beam (joists hung level / tops flush)". Visibility gate: VISIBLE when `structure === 'elevated'` OR (`structure === 'floating' && floatingFraming === 'beams-and-joists'`); HIDDEN when `structure === 'floating' && floatingFraming === 'joists-on-blocks'` (Method B). Dispatched via the existing `applyParameters` path.
  - **Persistence.** `beamConnection` is an OPTIONAL string enum in `.deck` schema v2 with `additionalProperties: false` preserved. Missing on load → stamped to `'drop'` via the `finalizeBeamConnection` helper (mirrors S26's `finalizeFloatingFraming`). Both v1→v2 migration and v2 native load paths route through the SAME finalize helper so the invariant cannot drift. An INVALID enum value in a `.deck` file MUST be rejected by Ajv.
  - **Regression pin.** Every pre-S27 golden layout fixture and every pre-S27 BOM golden MUST be BYTE-IDENTICAL under `beamConnection = 'drop'` (the S27 change to the design payload adds the new field but the layout output is unchanged). Two NEW end-to-end goldens snapshot-guard flush: `elevated-12x12-flush` and `floating-16x14-oldcastle-flush` (both 2×8 joist + 2×10 beam — the canonical VALID unequal-flush combo).

- **FR-035** *(Method B block layout — columns pinned to joists, rows at user-selectable COUNT; added 2026-07-06 S28 review-gate — feat/block-spacing PR #66; **corrected 2026-07-05 — fix/joists-on-blocks-flying**; **amended 2026-07-05 — feat/block-count-per-joist**)*: For `structure === 'floating' && floatingFraming === 'joists-on-blocks'` (Method B), the block layout MUST place block COLUMNS at the joist x-centers (one block column per joist — `explicitColXCenters = joists.map(j => j.position.x)`; the block layer reads positions off the joist members so column x's are byte-identical to joist x's, no re-derivation drift) AND block ROWS along +z spread EVENLY end-to-end at a user-selectable COUNT `foundation.blockRowsHint: number` (integer ≥ 2), with the outer rows anchored at the length axis ends (`computeAxisCenters(lengthMm, rows)`). Total blocks = `numJoists × rows`. Every joist MUST have a block column beneath it (the "no flying joists" invariant — pinned by `floating-flying-joists.test.ts`). **Precedence: `blockRowsHint` > `blockSpacingMm`.** When `foundation.blockRowsHint` is present, the resolver uses it verbatim (after clamping — see below) and IGNORES `foundation.blockSpacingMm` (the legacy distance-primary control from the previous amendment). When `blockRowsHint` is absent, `blockSpacingMm` (if present) drives the row count via `blockCountForAxis(lengthMm, effectiveSpacingMm) = max(2, ceil(lengthMm / effectiveSpacingMm) + 1)` — the legacy back-compat path for any `.deck` file saved before this amendment. When NEITHER is set, the layout MUST default to a SPAN-SAFE row count (Code Review Fix #4 follow-up). When the layout pipeline threads a `SpanTable` through `ComputeLayoutOptions.spanTable` (the state store does — see `application/compute-layout.ts::computeLayoutAndCheck`), the default = `max(legacyDefault, ceil(lengthMm / spanTable.lookupJoistMaxSpan(joist.material, joist.spacingMm)) + 1)` where `legacyDefault = blockCountForAxis(lengthMm, DEFAULT_METHOD_B_BLOCK_SPACING_MM)` = the pre-fix 1220 mm-derived count. This ensures a fresh Method-B deck at any typical size (12×12 through 40×40, all joist SKUs × species — verified by the parametrized regression matrix in `floating-block-count.test.ts`) does NOT start with over-spanned joists. When the SpanTable is NOT threaded through OR the joist material is not in the catalog (`lookupJoistMaxSpan` returns 0), the layout falls back to the `DEFAULT_METHOD_B_BLOCK_SPACING_MM = 1220 mm (4 ft)` derived count (byte-identical to pre-fix consumers that do not pass the table). For decks so large that the block-count cap prevents reaching the span-safe count (e.g. 75×75 ft), the default remains the largest cap-allowed count and `spanCheck` fires the `over-span-joist` warning honestly — the correct guidance is beams / smaller deck / heavier joist, not a silently-under-supported layout. **Clamps.** `blockRowsHint` MUST be clamped to `[MIN_BLOCK_ROWS_HINT = 2, MAX_BLOCK_ROWS_HINT = 100]` at the schema level AND further clamped at the resolver seam to `[2, min(rowsMaxByCap, rowsMaxByGap)]` where `rowsMaxByCap = max(2, floor(MAX_METHOD_B_BLOCK_COUNT / numJoists))` (the joist-count-aware hard cap — total blocks stay bounded by `MAX_METHOD_B_BLOCK_COUNT = 400`) and `rowsMaxByGap = max(2, floor(lengthMm / MIN_BLOCK_SPACING_MM) + 1)` (the minimum-pitch clamp — can't pack rows tighter than the block footprint at `MIN_BLOCK_SPACING_MM = 300 mm`). Non-integer inputs are floored; the perimeter-two floor (`rows ≥ 2`) always wins. The postcondition assertion (`throw LayoutError` if `cols × rows > MAX && rows > 2`) MUST guard the return so any future arithmetic bug surfaces immediately rather than hiding behind a silently-too-dense grid; `rows === 2` is exempt (perimeter-two supersedes). No iteration cap — the enforcement is O(1). Defense-in-depth: `.deck` schema v2 `Dimensions3D.widthMm` / `lengthMm` MUST carry `maximum: 30480 mm (100 ft)` (a residential cap; the shared `Mm` `$def` allows 1,000,000 mm which is oversized for this app), AND `MAX_DECK_DIMENSION_MM` MUST be mirrored at BOTH the elevated `validateDesign` and the floating `validateFloatingDesign` trust boundaries so an in-memory patch / test-fixture path (no Ajv round-trip) hits the same guard. **Span-safety.** `span-check.ts::deriveMethodBJoistSpanFromBlockGrid` derives the joist support span from the block GRID row pitch (max adjacent-z gap between block rows), so an `over-span-joist` warning fires when the user picks a `blockRowsHint` too small for the joist material and clears when they pick one large enough. The default row count is span-safe for the default 12×12 deck (`floating-block-count.test.ts` pins "no over-span at default"); a fresh joists-on-blocks deck at typical dimensions does NOT under-support the joists. **Remediation.** The Method B `'add-support-row'` remediation from FR-032 MUST dispatch `blockRowsHint = proposedRows` (count-primary — see FR-032 Method B bullet); the remediation caller passes `numJoists` (from `layoutFloatingJoists(design).length`) to `resolveMethodBGrid` and to the `rowsMaxByCap` clamp so the reported `currentRows` reflects the actual cap-aware resolved grid. The `applyPatchForVerification` path also writes `blockRowsHint` (otherwise the verify path would write `blockSpacingMm` which the count-primary resolver IGNORES → silent no-op → false-negative verify). **Persistence.** `blockRowsHint` is an OPTIONAL integer in `.deck` schema v2 with `minimum: 2`, `maximum: 100` on both block-carrying `FoundationSpec` variants (`FoundationSpecDeckBlocks` + `FoundationSpecTuffBlocks`), `additionalProperties: false` preserved. Missing on load → stays undefined; the layout falls back to `blockSpacingMm` (legacy) or the default. Existing pre-amendment `.deck` files continue to load unchanged. `blockSpacingMm` is retained in the schema (`minimum: 300`, `maximum: 2438.4`) for legacy back-compat. **UI.** The ParameterPanel MUST expose a `BlockRowCountField` (integer number input, min=2, max=100) bound to `foundation.blockRowsHint` VISIBLE only when `structure === 'floating' && floatingFraming === 'joists-on-blocks'`; commits MUST clamp to `[2, 100]` BEFORE dispatch (schema-legal). The field's helper text MUST clarify the semantics: "Number of blocks under each joist, spread evenly end-to-end." The prior `BlockSpacingField` (distance input) is REMOVED. `MIN_BLOCK_ROWS_HINT` / `MAX_BLOCK_ROWS_HINT` / `MAX_METHOD_B_BLOCK_COUNT` MUST be re-exported through the `state` barrel (the dep-cruiser `ui-no-domain-layout` rule forbids the UI from importing `src/domain/layout/**` directly). **Float-drift tolerance (retained from previous amendment).** `computeAxisCenters` accumulates `-span/2 + i × step` (`step = span / (count − 1)`); IEEE-754 mul-add rounding can drive the LAST center a few femtometres OUTSIDE `±span/2` for fractional (schema-legal) footprints (e.g. `span=10205.753894382558, count=19 → last=5102.876947191281` vs bound `5102.876947191279`, Δ ≈ 1.8e-12 mm). `validateExplicitCenters` MUST accept centers within `±span/2 ± EPS_MM` where `EPS_MM = 1e-6 mm` (matching `validateJoistSpacing`'s tolerance in `layout-shared.ts`) so schema-legal fractional footprints do not crash on drift. The tolerance is a nanometre — a real callsite bug (millimetres out of range or worse) is still rejected. **Regression pin.** Method A + elevated + posts-on-footings layouts MUST be BYTE-IDENTICAL to pre-amendment (`blockRowsHint` alters ONLY Method B); every pre-existing golden fixture stays unchanged. The `blockColsHint` legacy field is a NO-OP for Method B (columns are pinned to the joist count — the number of load-bearing supports per joist is a physical property, not a UI knob).

**Persistence & export**

- **FR-017**: System MUST autosave the current design to browser local storage after any parameter change (debounced ≤ 500 ms).
- **FR-018**: System MUST let the user download the current design as a `.deck` JSON file. The file MUST include, at minimum: `schema` (integer), `generator` (string, `"wooddeck"`), `generatorVersion` (semver string), `createdAt` (ISO-8601 timestamp), `design` (the DeckDesign entity). *(Ref: Code Review Guardian finding #8.)*
- **FR-019**: System MUST let the user upload a `.deck` file. The loader MUST validate against a JSON Schema for the file's declared `schema` version and reject unknown or invalid files with a clear error message.
- **FR-020**: System MUST let the user export the current 3D view as a PNG at the current canvas resolution.
- **FR-021**: System MUST provide an on-screen Bill of Materials (BOM) listing counts by SKU for joists, beams, posts, footings, and decking boards (with total linear feet/meters).

**Editing**

- **FR-022**: System MUST provide a parameter side panel for editing width, length, height, joist spacing, joist size (SKU), decking board size (SKU), species/material.
- **FR-023**: System MUST provide a read-only 2D top-down plan view alongside the 3D view. (Full 2D authoring/dragging is out of scope for MVP — see Section: Out of Scope.)
- **FR-024**: The design state store MUST support undo/redo scaffolding from day one, even if a UI undo button is not shipped in MVP. *(Ref: Code Review Guardian finding #9.)*

### Non-Functional Requirements

- **NFR-001** *(Performance)*: Parameter change → 3D re-render latency MUST be ≤ 500 ms p95 for decks up to 20 ft × 30 ft on a mid-range 2023 laptop (e.g., M1/M2 MacBook Air, i5 desktop).
- **NFR-002** *(Performance)*: Layer toggle → visible change MUST be ≤ 100 ms and MUST NOT cause shader recompile or geometry rebuild.
- **NFR-003** *(Performance)*: Interactive frame rate ≥ 30 FPS during orbit/zoom/pan on the same reference hardware, up to the max supported deck size.
- **NFR-004** *(Compatibility)*: MUST support the latest two versions of Chrome, Edge, Firefox, and Safari on desktop.
- **NFR-005** *(Compatibility)*: MUST work on desktop (primary). Tablet is a nice-to-have. Mobile is deferred.
- **NFR-006** *(Availability)*: N/A — static client-only app; hosted on a static host (GitHub Pages). No SLI/SLO. Availability = hosting provider's SLA.
- **NFR-007** *(Security)*: NONE of the following apply: authentication, authorization, user data collection, PII, third-party APIs, secrets management. See Section 6 in each ticket.
- **NFR-008** *(Privacy)*: No personal data collected, stored, or transmitted. Local storage keys contain only design geometry and preferences.
- **NFR-009** *(Accessibility)*: UI outside the 3D canvas MUST meet WCAG 2.2 Level AA (keyboard navigation, contrast, focus visible, semantic HTML). The 3D canvas itself is exempt from WCAG 2.2 rendering conformance but MUST have a text/2D equivalent (the BOM panel and 2D plan view) for keyboard/screen-reader users.
- **NFR-010** *(Testability)*: The `domain/` layer MUST be fully unit-testable with no React, Three.js, or DOM. Property-based tests with `fast-check` are REQUIRED for the layout engine invariants. *(Ref: Code Review Guardian answer D.)*
- **NFR-011** *(Maintainability)*: A boundary-enforcement lint (e.g., `eslint-plugin-boundaries` or `dependency-cruiser`) MUST run in CI to enforce: `domain/` imports nothing from `state/`, `scene/`, `ui/`, or `persistence/`; `scene/` imports nothing from `ui/`; `persistence/` imports only `domain/`. *(Ref: Code Review Guardian findings #1, #2, #3.)*

### Key Entities

- **DeckDesign**: The root persisted entity — deck footprint (width, length, height in mm), joist parameters (SKU, spacing_mm), decking board SKU, species/material, layout preferences. This is what a `.deck` file contains.
- **Layout**: The output of the layout engine — a *complete render contract*. Contains every drawable primitive with full 3D placement in mm: `Joist[]`, `Beam[]`, `Post[]`, `Footing[]`, `Board[]` (decking). Scene components consume Layout and perform zero geometry math. *(Ref: Code Review Guardian finding #3.)*
- **Joist / Beam / Post / Footing / Board**: Structural/surface members with a nominal SKU reference, position `{x, y, z}` (mm), size `{x, y, z}` (mm derived from SKU), rotation, and an id.
- **Material**: A catalog entry — nominal SKU + species/type + actual mm dimensions + optional physical properties (weight, cost placeholder).
- **SpanTable**: A lookup service abstraction — `lookup(species, size, spacing_mm) → maxSpanMm`. The MVP ships one implementation (`IrcSpanTable`) sourced from public IRC-2018 tables. *(Ref: Code Review Guardian finding #4.)*
- **Warning**: A structured record — `{memberId, kind: "over-span", actualMm, allowableMm, tableRowReference}`.
- **DeckFile (v1)**: The `.deck` on-disk envelope — `{schema: 1, generator: "wooddeck", generatorVersion, createdAt, design}`.
- **DeckFile (v2)** *(added 2026-07-04)*: The `.deck` on-disk envelope for the amended `DeckDesign` shape — `{schema: 2, generator: "wooddeck", generatorVersion, createdAt, design}` where the `design` payload carries the FR-026 `foundation` union, the FR-027 `structure` enum, and — inside `layout.members[*].material` — the FR-028 extended `MemberMaterialRef` discriminator. v1 files continue to load: the loader runs a v1→v2 migration transparently on parse, defaulting `structure = 'elevated'` and `foundation = { type: 'posts-on-footings', post: <v1.post.material>, footing: <FootingSpec derived from FOOTING_WIDTH_MM / FOOTING_DEPTH_MM constants> }`. v2 is the write default from the release that lands this amendment forward.
- **FoundationBlock** *(added 2026-07-04)*: A catalog record for a precast / manufactured on-grade foundation product — `{ productId: string, kind: 'block', category: 'concrete-precast' | 'polypropylene', actual: {widthMm, depthMm, heightMm}, placement: 'on-grade', acceptsLumber: readonly LumberNominal[] }`. Two initial products: `oldcastle-11x11x7` and `tuffblock-12x12x4`. Lives in a new `src/domain/foundation-catalog.ts` distinct from the lumber materials catalog because the two product classes have different dimensioning, purchase units (each block vs board-feet), and stock-length semantics (blocks have no stock-length concept).
- **CutListPack** *(added 2026-07-04, revised 2026-07-05)*: The output of the FR-031 bin-pack — surfaced as `BomSection_Lumber { sku: string, nominal: LumberNominal, species: Species, grade: Grade, stockLengthsAvailableMm: readonly Mm[], pack: PackResult }` where `PackResult = { stockBoards: readonly PackedBoard[], totalStockBoards: number, totalOffcutMm: Mm }` and `PackedBoard = { stockLengthMm: Mm, cuts: readonly {memberId: string, lengthMm: Mm}[], offcutMm: Mm }`. Produced by a pure domain function `packCutList({cuts, stockLengthsMm, kerfMm})` under `src/domain/bom/pack-cut-list.ts`; assembled per-SKU by `deriveBom(layout, {kerfMm?})` in `src/domain/bom/derive-bom.ts`. Consumed by `BomPanel` to render the per-SKU shopping list + optional per-board offcut breakdown. `cuts[*].memberId` cross-links each cut back to its originating `LayoutMember.id` (better than an opaque label); `offcutMm` is clearer than "wasteMm" (nothing is truly wasted — the offcut is the leftover length after all cuts + kerfs).
- **BomSection_Foundation** *(added 2026-07-05)*: A catalog-block-product group in the BOM — `{ productId: FoundationProductId, displayName: string, count: number }`. Foundation blocks are COUNTED, not cut, so no pack is produced. `displayName` reads from the foundation-catalog for i18n-friendly reformatting downstream.
- **BomSection_Footing** *(added 2026-07-05)*: A concrete-footing group in the BOM (FIX 2 review-gate) — `{ widthMm: Mm, depthMm: Mm, count: number, displayName: string }`. Footings are POURED CONCRETE (not lumber, not a catalog SKU), grouped by `(widthMm, depthMm)` from the `FoundationSpec.footing` dimensions so a future per-post override would emit multiple rows. `displayName` is dimension-derived (e.g. `"Concrete footing 400 × 400 mm footprint × 300 mm deep"`) — safe to render as-is; no catalog lookup. Emitted on `BomResult.footings` in parallel with `lumber` and `foundation` (widening `FoundationProductId` was rejected because that enum is shared with `BlockMemberMaterial` and would leak semantics into `LayoutMember.material`).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can render a rectangular deck matching their target dimensions within **3 minutes** of opening the app for the first time (measured by manual usability run against three test personas — the user + two friends).
- **SC-002**: Toggling any of the six layers produces a visible change in **≤ 100 ms** and does not trigger a shader recompile (measured with the Three.js `WebGLProgram.getExtension('WEBGL_debug_shaders')` count and Chrome DevTools Performance panel).
- **SC-003**: For decks up to 20 ft × 30 ft, parameter-change → 3D re-render latency is **≤ 500 ms p95** on the reference hardware (measured with a scripted benchmark that changes each parameter 50 times and records timing).
- **SC-004**: The layout engine passes **≥ 10 golden-fixture tests** and **≥ 5 property tests** (fast-check) covering: joist count formula, all joists inside the footprint, no overlaps, width/length swap → rotated layout, monotonic joist count with increasing length. *(Ref: Code Review Guardian answer D.)*
- **SC-005**: The span-check engine passes **≥ 8 golden tests** citing the IRC-2018 table row in the test name (regulatory traceability), including boundary tests at max span ± 1 mm.
- **SC-006**: `.deck` file round-trip: given any generated design, `save → download → clear localStorage → load` produces an identical `DeckDesign` (byte-for-byte identical JSON after canonicalization).
- **SC-007**: The disclaimer banner renders on **first paint** in every UI end-to-end test and is not dismissable within a session (enforced by unit test).
- **SC-008**: CI blocks any PR that violates the layer-boundary import rules (`domain → state`, `scene → ui`, `persistence → domain-only`).
- **SC-009**: The app loads (Time to Interactive) in **≤ 3 s** on a fresh browser session on a 10 Mbps connection with the reference hardware.
- **SC-010** *(added 2026-07-04)*: A v1 `.deck` file round-trips through the amended loader — v1-load → migrate → v2-serialize → v2-load → recompute-layout — with the resulting rendered scene visually identical to the original v1 render. Verified by a golden fixture regression test.
- **SC-011** *(added 2026-07-04, revised 2026-07-05)*: For every design with ≤ 500 total lumber members, the FR-031 cut-list bin-pack completes in **≤ 50 ms on reference hardware (M-series MacBook Pro, cold JS engine); CI asserts a ≤ 100 ms headroom threshold** to absorb noise from shared-runner variance, and the pack's total stock-board count is provably within 11/9 + 6/9 boards of the optimal solution (the FFD asymptotic worst-case bound; measured against a reference optimal-pack solver in a golden fixture set).

---

## Assumptions

- **Target audience:** DIY homeowners. Structural terms (joist, beam, post, footing, span) are acceptable; deep engineering terms (moment, deflection ratio) are avoided in UI copy. *(User answer A1.)*
- **Ambient environment:** the deck sits on flat ground. No terrain modeling. No house-attachment / ledger board. No stairs, railings, or multi-level for MVP. *(User answer B3/B4/B5, I24.)*
- **Structural fidelity:** the app models individual framing members with buildable-accurate positions — the "peel back" UX depends on this. *(User answer B6.)*
- **Units:** both imperial and metric are switchable at runtime. Canonical internal unit is **millimeters** (integer where possible, rounded to 1 mm on input). Branded types are NOT used — a single `units.ts` module centralizes all conversion. *(User answer C7; Code Review Guardian answer B.)*
- **Lumber identity:** boards are stored by nominal SKU (`"2x6"`, `"SPF"`, `"No2"`), not by raw mm dimensions. Actual dimensions are derived via the materials catalog. *(Code Review Guardian finding #5.)*
- **Materials catalog:** static, checked-in TypeScript module for MVP. Not user-editable. Future migration to a repository-behind-a-port pattern is noted but out of scope. *(User answer C9; Code Review Guardian finding #10.)*
- **Cost / pricing:** NOT included in MVP. BOM counts only. Pricing may return as an optional feature later. *(User answer C10.)*
- **Span tables:** static, checked-in dataset sourced from public **IRC-2018** joist and beam span tables. Source documents, edition, and attribution live in `docs/span-tables/`. The `SpanTable` interface allows swap-in of other editions or NBC (Canadian) later. *(User answer D11; Code Review Guardian finding #4.)*
- **Disclaimer:** non-dismissable, on-first-paint. Prominent placement in the UI. *(User answer D12.)*
- **Authentication:** none. Fully client-side. *(User answer G22.)*
- **Persistence:** browser local storage + downloadable `.deck` JSON files. No cloud, no server. *(User answer F16.)*
- **Export:** PNG screenshot of the current 3D view + `.deck` JSON download for MVP. PDF / OBJ / GLB / CSV cut-list are later. *(User answer F17.)*
- **Sharing:** offline/local only. No share links for MVP. *(User answer F18.)*
- **Deployment target:** static hosting (GitHub Pages), online-only for MVP. The app is client-only so it will largely work offline anyway; PWA/offline is a later nice-to-have. *(User answer G21.)*
- **Browsers:** modern evergreen only — latest two of Chrome/Edge/Firefox/Safari on desktop. Tablet nice-to-have; mobile deferred. *(User answers G19, G20.)*
- **Rendering stack:** react-three-fiber + Three.js + @react-three/drei + Zustand + TypeScript (strict) + Vite. Testing: Vitest + fast-check for domain; Playwright deferred. *(User answer H23; Code Review Guardian answer C.)*
- **Undo/redo:** the design store uses `zundo` from day one, even if a UI undo button is not shipped in MVP. *(Code Review Guardian finding #9.)*
- **State partition:** two Zustand stores — one for the canonical `DeckDesign` (source of truth, serialized to `.deck` files), one for transient UI state (camera preset, layer visibility, unit-display mode). Saved designs never include UI state. *(Code Review Guardian positive observation.)*
- **File format versioning:** `.deck` files carry a `schema` integer, a `generator`, `generatorVersion`, and `createdAt` from v1. The loader is a `switch(schema)` even with only case 1. A JSON Schema for v1 lives in `docs/deck-file-schema-v1.json`. *(Code Review Guardian finding #8.)*
- **Timeline:** hobby/personal pace, no hard deadline. *(User answer J25.)*
- **License:** MIT. *(User answer J26.)*
- **Repository:** `vbomfim/wooddeck`, public. GitHub remote created before decomposition. *(User answer J27.)*

<!-- END OF SPEC KIT-COMPATIBLE CONTENT -->

---

## Decomposition

### Ticketing convention

The user works in a Feature/Story branching model:

- The **Feature branch** (`feat/mvp-deck-designer`) is an integration branch that eventually opens a PR into `main`.
- Each **Story branch** (`story/N-slug`) branches off the Feature branch and opens a PR back into the Feature branch (NOT into `main`).
- Every unit of work owns its own branch **and** its own git worktree so the push target is unambiguous.
- The Epic issue (this decomposition) is the Feature. Each child issue is a Story.

### Module map

| Module | Purpose | Stories |
|---|---|---|
| Foundation | Repository scaffold, tooling, CI, boundary lint | #1 |
| Domain — Types & Units | Canonical mm units + core entities + materials catalog | #2, #3 |
| Domain — Engine | Layout engine + span-check | #4, #5 |
| Persistence | `.deck` file format v1 + local storage + file I/O | #6 |
| Application | Use-case layer orchestrating domain + persistence + state | #7 |
| State | Zustand stores (design with `zundo` + UI) | #8 |
| Scene (3D) | r3f scene shell + camera + layers + warning overlay | #9, #10, #11 |
| UI Shell | App shell + non-dismissable disclaimer | #12 |
| UI Panels | Parameter panel, layer toggles, warnings, BOM, export menu | #13, #14 |
| UI Plan View | Read-only 2D top-down plan view | #15 |
| Remediation (S16) | Actionable remediation options per span warning | #38 |
| **Foundations & Floating (Epic 2)** *(added 2026-07-04)* | **Foundation TYPE options + floating construction MODEL + cut-list BOM — all additive, ship before umbrella PR** | **S17 #39, S18 #40, S19 #41, S20 #42, S21 #43, S22 #44, S23 #45, S24 #46, S25 #47, S26 #48** |

### Story tree

```
Feature (Epic): feat/mvp-deck-designer — MVP Wood Deck Designer
│
├── Phase A — Foundation (blocks all others)
│   └── S1  story/1-project-scaffold        Project scaffold, tooling, CI, boundary lint
│
├── Phase B — Domain (depends on S1)
│   ├── S2  story/2-units-subsystem         Canonical mm + conversion + formatting
│   ├── S3  story/3-domain-model-catalog    Core entities + SKU-based Board + materials catalog
│   ├── S4  story/4-layout-engine           Layout engine + Layout render-contract + property tests
│   └── S5  story/5-span-tables-check       SpanTable interface + IRC-2018 impl + span-check
│
├── Phase C — Adapters (depends on Phase B)
│   ├── S6  story/6-file-format-persistence .deck v1 envelope + JSON Schema + localStorage + file I/O
│   ├── S7  story/7-application-usecases    Use-case layer (load, save, apply-parameters, compute-layout)
│   └── S8  story/8-state-stores            Zustand design store (with zundo) + UI store
│
├── Phase D — Rendering (depends on S8; S9 blocks S10 blocks S11)
│   ├── S9  story/9-3d-scene-shell          DeckScene <Canvas> + CameraRig + preset views
│   ├── S10 story/10-scene-layers           Six layer components + visibility via <group visible>
│   └── S11 story/11-warning-overlay        WarningOverlay independent of layer visibility
│
└── Phase E — UI (depends on Phase D; S12 hosts S13–S15)
    ├── S12 story/12-app-shell-disclaimer   AppShell + non-dismissable DisclaimerBanner + first-paint test
    ├── S13 story/13-parameter-panel        ParameterPanel + runtime unit switcher
    ├── S14 story/14-side-panels            Layer toggles + Warnings + BOM + Export menu (save/load/PNG/JSON)
    ├── S15 story/15-2d-plan-view           Read-only 2D top-down plan view
    └── S16 story/16-remediation-actions    Actionable remediation OPTIONS per warning (compute + apply)  (added post-S14 from user field-test; issue #38)

Epic 2 (added 2026-07-04) — Foundations, Floating Model & Cut-List BOM
├── Phase F — Foundations & Floating (ships BEFORE the umbrella PR)
│   │
│   │  Sub-phase F.1 — domain + persistence (unblock everything else)
│   ├── S17 story/17-foundation-model             Domain: foundation-catalog + foundation/structure model (schema v2 types + compat matrix)
│   ├── S18 story/18-deck-file-schema-v2          Persistence: .deck schema v2 + v1→v2 migration
│   │
│   │  Sub-phase F.2 — layout paths (parallel; both depend on S17)
│   ├── S19 story/19-floating-layout-engine       Domain: floating-deck layout engine (block grid + rim beams + joists at spacing [Method A] / joists on blocks [Method B]; S26 review-gate rescope — blocking-between-beams removed)
│   ├── S20 story/20-elevated-with-blocks         Domain: elevated-with-blocks adaptation (posts rest on deck-blocks)
│   │
│   │  Sub-phase F.3 — BOM (parallel with F.2; depends on S17)
│   ├── S21 story/21-cutlist-bom                  Domain: cut-list BOM (bin-pack) + stock-lengths in lumber catalog
│   │
│   │  Sub-phase F.4 — scene + UI (depend on F.2 + F.3)
│   ├── S22 story/22-blocks-blocking-scene        Scene: BlocksLayer + BlockingLayer + block geometries (S26 review-gate: BlockingLayer is now dormant `() => null` — no path emits `blocking` members)
│   ├── S23 story/23-foundation-ui                UI: StructureSelector + FoundationTypeSelector in ParameterPanel
│   ├── S24 story/24-bom-cutlist-ui               UI: BomPanel cut-list rendering (stock-boards + expandable offcuts)
│   ├── S25 story/25-add-support-remediation      Domain + UI: extend remediations with add-support-row (supersedes #38 Q1)
│   └── S26 story/26-layer-toggle-blocks          UI: LayerTogglePanel adds Blocks toggle (S26 review-gate: initially added a Blocking toggle too; that toggle was REMOVED before merge because no layout emits `blocking` members — the `blocking` MemberKind + `BlockingLayer` remain dormant)
```

### Sequencing and dependencies

- **Phase A** (S1) must complete first — everything else depends on the project scaffold and boundary lint being enforced from the first commit.
- **Phase B** stories can be developed in parallel once S1 lands:
  - S2 (units) is independent.
  - S3 (model + catalog) depends on S2 (uses mm types).
  - S4 (layout engine) depends on S3.
  - S5 (span-check) depends on S3 and S4 (it consumes `Layout`).
- **Phase C**:
  - S6 (persistence) depends on S3.
  - S7 (use-cases) depends on S4, S5, S6.
  - S8 (state stores) depends on S7 (stores wrap use-case calls).
- **Phase D** rendering:
  - S9 (scene shell) depends on S8.
  - S10 (layers) depends on S4 (Layout type) and S9 (scene shell).
  - S11 (WarningOverlay) depends on S5 (Warning type) and S10.
- **Phase E** UI:
  - S12 (shell + disclaimer) depends on S9.
  - S13 (parameter panel) depends on S2, S3, S8, S12.
  - S14 (side panels) depends on S8, S10, S11, S12.
  - S15 (2D plan view) depends on S4, S8, S12.
  - **S16 (remediation actions)** depends on S5, S7, S8, S14. Added post-S14 in response to a user field-test observation (see FR-025). Ships BEFORE the umbrella `feat/mvp-deck-designer → main` PR so the MVP behavior for warnings is actionable, not advisory-only.

**Epic 2 (added 2026-07-04) — Phase F sequencing:**
- **F.1 — domain & persistence backbone (blocks everything else in F):**
  - **S17 (foundation model + catalog + compat matrix)** is the type-level linchpin. It touches `src/domain/model.ts` (adds `foundation` union + `structure` enum + extended `MemberMaterialRef`), adds `src/domain/foundation-catalog.ts`, and touches every module that reads/writes `DeckDesign`. Depends on: (nothing new — extends S3). Blocks S18, S19, S20, S21, S22, S23, S25.
  - **S18 (schema v2 + v1→v2 migration)** depends on S17 (needs the new types). Adds `docs/deck-file-schema-v2.json`, `src/persistence/deck-file/schema-v2.ts`, `src/persistence/deck-file/migrate-v1-to-v2.ts`, extends `deserialize` with the v1→migrate→v2 path AND a `case 2` branch, sets serialize's default write to v2. Blocks S23, S25.
- **F.2 — layout paths (parallel; both depend on S17):**
  - **S19 (floating-deck layout engine)** adds `src/domain/layout/floating-layout.ts`, extends `computeLayout` to branch on `design.structure`, adds `MemberKind = 'block' | 'blocking'` handling in the render contract, and updates `y-stack.ts` to a floating-model variant (no post extent; block extent below y=0). Adds a per-block span-check helper for block grid sizing. Blocks S22, S25.
  - **S20 (elevated-with-blocks)** extends the existing `layoutPostsAndFootings` to swap `footing` members for `block` members when `foundation.type === 'deck-blocks'` under `structure = 'elevated'`. `foundation.type = 'tuffblocks'` remains INVALID under elevated per FR-030 (TuffBlock is designed for ground-level decks; the standard product does NOT rate for post-supported construction) and is rejected before dispatch. Blocks S22, S25.
- **F.3 — cut-list BOM (parallel with F.2; depends on S17):**
  - **S21 (cut-list bin-pack + stock lengths)** adds `src/domain/bom/pack-cut-list.ts` with a pure `packCutList` (first-fit-decreasing), extends `materials-catalog.ts` with `stockLengthsMm` per SKU, and MOVES `src/ui/bom/derive-bom.ts` → `src/domain/bom/derive-bom.ts` (the derivation is pure domain logic; the pragmatic S14 placement is now corrected under the epic's architectural cleanup). Blocks S24.
- **F.4 — scene + UI (depends on F.2 + F.3):**
  - **S22 (scene BlocksLayer + BlockingLayer)** adds two new scene-layer components + two new module-level geometries (`DECK_BLOCK_GEOMETRY`, `TUFFBLOCK_GEOMETRY` — the latter a hexagonal frustum). Depends on S19 + S20. Blocks S23, S26.
  - **S23 (foundation UI)** adds a StructureSelector + FoundationTypeSelector to the ParameterPanel, wires them to `applyParameters`, and surfaces the FR-030 compat-matrix errors inline. Depends on S17, S18, S22.
  - **S24 (BomPanel cut-list rendering)** extends `BomPanel` to render per-SKU stock-board totals + an expandable per-board offcut breakdown. Depends on S21.
  - **S25 (add-support-row remediation)** extends `computeRemediations` + `applyRemediation` with the FR-032 `add-support-row` option. Also PATCHES issue #38 to note that Q1 is resolved. Depends on S17, S19, S20 (needs the new layout paths so the applied remediation produces a valid re-layout). Ships alongside or after S23 so the UI surface exists.
  - **S26 (LayerTogglePanel + ui-store)** adds a `blocks` visibility key to `useUiStore.layerVisibility` and one new toggle in the LayerTogglePanel. Depends on S22. **S26 review-gate rescope (2026-07-05):** the initial S26 scope also added a `blocking` visibility key + toggle; both were REMOVED before merge because no layout path emits `blocking` members after the floating-framing rework (FR-033). The `blocking` `MemberKind` and the `BlockingLayer` component remain in the codebase DORMANT for a cheap future re-attachment. `LayerVisibility` is now a 7-key type.
- **S15 (2D plan view — pre-existing, issue #16)** is NOT blocked by Epic 2 and MAY ship in parallel; however, when Epic 2 lands S15 SHOULD be extended to render the new `block` member kind in the 2D plan (a small follow-up either inside S15 or as a small addendum). This spec does not add a new story for that — the S15 ticket incorporates the extension when the developer picks it up post-Epic-2. The `blocking` `MemberKind` is RESERVED post-review-gate (no layout emits it); the plan-view branch for it is kept dormant.
- **Umbrella PR (`feat/mvp-deck-designer → main`)** opens only after S15 + S16 + S17..S26 all land. The umbrella is the MVP release.

### Decomposition rationale

The decomposition follows Hexagonal / Clean Architecture layering: pure `domain` → `application` use-cases → `state` (Zustand adapter) → `scene` and `ui` (interface adapters). Each Phase B story is a pure, unit-testable module with no framework dependencies — this is the biggest testability win and is designed in from the start. Phase B stories can be developed in parallel by different contributors (or in parallel worktrees by a solo developer), maximizing throughput on the highest-value work. Phase D and E must be sequential because the scene and UI are visually integrated. Alternative rejected: a single "render everything" story covering S9–S11 was considered but rejected because layer-visibility toggling (US2) is the differentiating UX and warrants its own story with acceptance criteria and boundary rules (Code Review Guardian findings #6, #7). Split accepted.

---

## Guardian Consultation Results

### Security Guardian
- *(Not consulted for MVP — Step 5b judgement.)* Rationale: fully client-side app, no auth, no server, no PII, no secrets, no third-party APIs. If any of these change (e.g., adding a share-link feature or cloud save), Security Guardian consultation becomes required. The **only** security-adjacent surface is the `.deck` file loader parsing untrusted user input; that is captured under FR-019 (JSON Schema validation, reject unknown schema) and should be part of Story 6's review scope.

### Privacy Guardian
- *(Not consulted for MVP — Step 5b judgement.)* Rationale: no personal data collected, no PHI, no analytics, no telemetry, no third-party SDKs. Local storage contains only geometric parameters. If telemetry or share links are added, Privacy Guardian consultation becomes required.

### Platform Guardian
- *(Not consulted — no infrastructure, no Kubernetes, no networking, no cloud resources.)* Deployment target is GitHub Pages (static hosting). If a backend or CI-hosted preview environment is added, Platform Guardian consultation becomes required.

### Delivery Guardian
- **Deploy target = static hosting (GitHub Pages).** Deployment strategy = git-push-to-`main` → GitHub Actions builds → publishes to `gh-pages` branch. No blue-green, canary, or feature-flag machinery needed for MVP.
- **CI pipeline (required in Story 1):** typecheck, lint, boundary lint, unit tests (Vitest), build. E2E deferred until UI stories land.
- **Rollback:** revert the commit that triggered a bad deploy; static site is stateless.
- **Observability:** N/A for MVP — no server, no telemetry, no error reporting. The user can inspect their own DevTools console. Sentry or similar remains a future consideration.
- **SLIs/SLOs:** N/A — availability = hosting-provider SLA; no user counts to measure.

### Code Review Guardian (architectural impact)

The Code Review Guardian was consulted for architectural-impact assessment (Step 5b-arch) and returned **10 findings** (0 critical, 3 high, 5 medium, 2 low) plus 6 positive observations. Full verbatim report is preserved in the ticket handoff. Findings folded into this spec:

| # | Sev | Finding | Where folded into spec |
|---|---|---|---|
| 1 | HIGH | Missing `application/` layer — orchestrations would leak into stores or UI | System Impact → Affected components; Story tree S7 |
| 2 | HIGH | `serialization.ts` belongs in `persistence/`, not `domain/` | System Impact → Affected components; Story S6 |
| 3 | HIGH | `Layout` type must be a complete render contract; no math in scene | FR-005, FR-007; NFR-011; Story S4, S10 boundary rules |
| 4 | MED | `span-check` must depend on `SpanTable` interface, not concrete data | Key entity `SpanTable`; Story S5 |
| 5 | MED | Lumber must be stored by SKU, not raw mm dimensions | FR-011; Assumptions; Story S3 |
| 6 | MED | Layer visibility via `<group visible={…}>`, not mount/unmount | FR-007; NFR-002; Story S10 |
| 7 | MED | WarningOverlay must draw its own decoration independent of layers | FR-015; Story S11 |
| 8 | MED | `.deck` envelope needs generator/version/createdAt + JSON Schema | FR-018, FR-019; Assumptions; Story S6 |
| 9 | MED | Mount `zundo` on design store from day one | FR-024; Assumptions; Story S8 |
| 10 | LOW | Materials catalog fine for MVP; note repository-port path for future | Assumptions (noted); Story S3 (implementation note) |

Boundary-enforcement lint (`eslint-plugin-boundaries` or `dependency-cruiser`) added to Story 1's scope per findings #1/#2/#3.

---

## System Impact

### Affected components

| Component | Change type | Description |
|---|---|---|
| Repository `vbomfim/wooddeck` | New | Created public. First commit lands with Story 1 (scaffold). |
| `src/domain/` | New | Pure TS core: types, units, materials catalog, layout engine, span-check. No React, no Three.js. |
| `src/application/` | New | Use-case layer (Code Review Guardian finding #1). Thin orchestrations wired by state actions and UI handlers. |
| `src/persistence/` | New | `.deck` file schema + serialization + JSON Schema validation + local storage + file download/upload + PNG screenshot. `serialization.ts` moved here per finding #2. |
| `src/state/` | New | Two Zustand stores: `design-store.ts` (with `zundo` middleware) and `ui-store.ts`. |
| `src/scene/` | New | react-three-fiber scene: `DeckScene`, `CameraRig`, six `layers/*.tsx`, `WarningOverlay`. Consumes `Layout`; performs no geometry math (finding #3). |
| `src/ui/` | New | React shell: `AppShell`, `DisclaimerBanner`, `ParameterPanel`, `LayerTogglePanel`, `WarningsPanel`, `BomPanel`, `PlanView2D`, `ExportMenu`. |
| `.github/workflows/ci.yml` | New | Typecheck, lint, boundary lint, unit tests, build. Deploy job to `gh-pages` may be a later story. |
| `docs/ARCHITECTURE.md` | New | Records the layer boundaries and imports rule. |
| `docs/span-tables/` | New | Source PDFs / attribution / license notes for the IRC-2018 span data. |
| `docs/deck-file-schema-v1.json` | New | JSON Schema for the `.deck` v1 envelope. |
| `LICENSE` | New | MIT. |
| `README.md` | New | Project overview + disclaimer + build/run instructions. |

**Epic 2 (added 2026-07-04) — additions:**

| Component | Change type | Description |
|---|---|---|
| `src/domain/model.ts` | Modified | Adds `foundation` discriminated union + `structure` enum on `DeckDesign`. Adds `MemberMaterialRef = LumberRef \| BlockRef` (tagged union) on `LayoutMember`. Adds `MemberKind = ... \| 'block' \| 'blocking'`. |
| `src/domain/foundation-catalog.ts` | New | Fixed-dimension precast/manufactured on-grade product catalog. Two initial SKUs: `oldcastle-11x11x7`, `tuffblock-12x12x4`. |
| `src/domain/materials-catalog.ts` | Modified | Adds `stockLengthsMm: readonly Mm[]` per SKU (e.g. `2x8: [8, 10, 12, 14, 16, 20] ft`). |
| `src/domain/layout/floating-layout.ts` | New | The floating-model layout path — two-method dispatch on `design.floatingFraming`: Method A (`beams-and-joists`) emits block grid + 2 rim beams + joists at `design.joist.spacingMm`; Method B (`joists-on-blocks`) emits block grid + joists directly (no beams). The `blocking` `MemberKind` is reserved/dormant — no path emits `blocking` members post-S26 review-gate. |
| `src/domain/layout/layout-engine.ts` | Modified | `computeLayout` dispatches on `design.structure` to the elevated (existing) or floating (S19) path. Compat-matrix validation added to `validateDesign`. |
| `src/domain/layout/post-layout.ts` | Modified | When `foundation.type === 'deck-blocks'` under elevated, footings are replaced by blocks (posts still present). `foundation.type = 'tuffblocks'` under elevated stays rejected by the FR-030 compat matrix. |
| `src/domain/bom/pack-cut-list.ts` | New | Pure `packCutList({cuts, stockLengthsMm, kerfMm})` — first-fit-decreasing bin-pack. |
| `src/domain/bom/derive-bom.ts` | Moved + Modified | Moved from `src/ui/bom/derive-bom.ts` (S14 pragmatic location) into the domain layer. Extended to emit per-SKU cut-list packs. Also emits a separate `foundation` section for `block`-kind members (product SKU + count). |
| `src/domain/spans/remediations.ts` | Modified | Adds `'add-support-row'` `RemediationKind` + `RemediationPatch` variant, consuming the new `structure` / `foundation` fields. |
| `src/persistence/deck-file/schema-v2.ts` | New | `.deck` v2 envelope + `serialize` (v2 write default) + `deserialize` case-2 branch. |
| `src/persistence/deck-file/migrate-v1-to-v2.ts` | New | Pure `migrateV1ToV2(v1Design)` — defaults `structure='elevated'` + `foundation.type='posts-on-footings'` + derives `FootingSpec` from the existing `FOOTING_WIDTH_MM`/`FOOTING_DEPTH_MM` constants. |
| `src/persistence/deck-file/errors.ts` | Modified | Adds `DeckFileErrorCode = ... \| 'migration-failed'`. |
| `docs/deck-file-schema-v2.json` | New | JSON Schema for the v2 envelope. |
| `src/scene/layers/BlocksLayer.tsx` | New | Renders `block`-kind members with product-specific geometry (`DECK_BLOCK_GEOMETRY` box or `TUFFBLOCK_GEOMETRY` hexagonal frustum). |
| `src/scene/layers/BlockingLayer.tsx` | New (S22) → **dormant (S26 review-gate)** | Pre-S26: rendered `blocking`-kind members. S26 review-gate: no floating (or elevated) path emits `blocking` members, so the component is now `() => null` — kept in the tree for a cheap future "blocking between joists" re-attachment; the "Blocking" checkbox in `LayerTogglePanel` was removed. |
| `src/scene/layers/shared/geometries.ts` | Modified | Adds two new module-level geometries + disposal. |
| `src/scene/layers/DeckLayers.tsx` | Modified | Adds the two new layer components in the correct z-stack order (blocks before footings; blocking between joists and beams). **S26 review-gate:** `BlockingLayer` removed from the JSX composition (dormant); `DECK_LAYER_ORDER` reduced from 8 to 7 entries. |
| `src/ui/ParameterPanel.tsx` (and `src/ui/fields/`) | Modified | Adds StructureSelector + FoundationTypeSelector + block-product picker. **S26 review-gate:** adds `FloatingFramingSelector` — VISIBLE ONLY when `structure === 'floating'`, with the two options per FR-033. |
| `src/ui/BomPanel.tsx` | Modified | Renders per-SKU stock-board totals + an expandable per-board offcut breakdown. Renders block foundation counts as a distinct section. |
| `src/ui/LayerTogglePanel.tsx` | Modified | Adds Blocks + Blocking toggles. **S26 review-gate:** the "Blocking" toggle was REMOVED (dead toggle — no layout emits `blocking` members); the panel now surfaces 7 toggles. |
| `src/ui/WarningsPanel.tsx` (via S25) | Modified | Renders the new `add-support-row` remediation option when computed. **S26 review-gate:** the option renders DISABLED under Method A + `over-span-beam` with the alternative-surfacing message per FR-032; renders ENABLED under Method B + `over-span-joist`. |
| `src/state/ui-store.ts` | Modified | `LayerVisibility` extended with `blocks: boolean, blocking: boolean`. **S26 review-gate:** `blocking` was REMOVED from `LayerVisibility` (dead toggle); `LayerVisibility` is now a 7-key type. |
| `src/state/default-design.ts` | Modified | Default seeds `structure='elevated'` + `foundation={type:'posts-on-footings', ...}` — preserving SC-004 golden-fixture behavior. **S26 review-gate:** stamps `floatingFraming: 'beams-and-joists'` (Method A default; ignored for elevated). |
| `src/domain/model.ts` | Modified | Adds `readonly floatingFraming: 'beams-and-joists' \| 'joists-on-blocks'` on `DeckDesign` (S26 review-gate). Field is placed immediately after `structure` for consistency across all fixtures. |
| `src/domain/layout/layout-shared.ts` | Modified | Extracts `validateJoistSpacing(design)` helper (S26 review-gate: safety-critical DoS guard) — rejects `spacingMm ≤ 0`, non-finite, and `< joistThickness`. Both the elevated and floating layout paths call it BEFORE any joist-layout dispatch. |
| `src/domain/spans/span-check.ts` | Modified | Adds `deriveJoistSpanFromBlocks(joist, blocks)` (S26 review-gate: safety-critical Method B span-check) — derives each joist's span from the max adjacent-block-z gap along its length when no beams are present. Boundary-clean: reads `LayoutMember.position`/`.size` directly; does NOT import `domain/layout`. |
| `src/domain/assert-never.ts` | New (S26 review-gate) | Exhaustive-switch guard (`assertNever(x: never)`) — fails at both compile time and runtime for a widened union. Used by the `floatingFraming` dispatches in `floating-layout.ts` + `y-stack-floating.ts`. |
| `.dependency-cruiser.cjs` | Modified | Extends `ui-allowlist` to admit `^src/domain/bom/` (BOM derivation moves into domain). |
| `scripts/boundary-selftest.mjs` | Modified | New probes for the block/blocking layer boundaries + the moved `derive-bom` location. |

**S27 (added 2026-07-05, feat/joist-beam-connection PR #64) — additions:**

| Component | Change type | Description |
|---|---|---|
| `src/domain/model.ts` | Modified | Adds `readonly beamConnection: 'drop' \| 'flush'` on `DeckDesign` (FR-034). Placed immediately after `floatingFraming` in canonical property order. Documents drop-vs-flush and Method-B no-op semantics on the field. |
| `src/state/default-design.ts` | Modified | Default seeds `beamConnection: 'drop'` (pre-S27 geometry preserved). |
| `src/domain/layout/y-stack.ts` | Modified | `computeYStack` (elevated) dispatches on `beamConnection` via exhaustive `switch`. New pure helper `computeFramingStackMm(input)` returns `decking + joist + beam + MIN_POST` for drop and `decking + max(joist, beam) + MIN_POST` for flush — the single source of truth consumed by `computeMinStructuralHeightMm`. |
| `src/domain/layout/floating/y-stack-floating.ts` | Modified | Method-A `beamConnection` dispatch is an exhaustive `switch` (mirrors elevated; Method B handled up-front before the switch and stays a no-op). |
| `src/domain/layout/joist-layout.ts` | Modified | New pure helper `computeJoistLengthMm(design)` returns the clear span between beam inner faces under flush (`lengthMm − FOOTING_WIDTH_MM − beamThickness`) and `footprint.lengthMm` under drop / Method B. `layoutJoists` uses it for `size.z` so flush joists END at the beam faces — no AABB overlap. |
| `src/domain/layout/floating/floating-joist-layout.ts` | Modified | Uses `computeJoistLengthMm` (floating Method A) for `size.z`. Same shortening rule as elevated. |
| `src/domain/layout/layout-shared.ts` | Modified | New pure validator `validateFlushBeamDepth(design)` — throws `LayoutError` when `beamConnection === 'flush' && joistDepth > beamDepth` (physical impossibility — the joist would hang below the beam). Message names both depths + prescribes both remediations. |
| `src/domain/layout/layout-engine.ts` | Modified | `validateDesign` calls `validateFlushBeamDepth` after `validateJoistSpacing`. `computeMinStructuralHeightMm` derives its result from `computeFramingStackMm` (no inline duplication) so flush min = `decking + max(joist, beam) + MIN_POST`, shorter than drop by `joistDepth`. |
| `src/domain/layout/floating/floating-layout.ts` | Modified | `validateFloatingDesign` calls `validateFlushBeamDepth` (gated on `floatingFraming === 'beams-and-joists'` — Method B ignores). |
| `src/domain/bom/derive-bom.ts` | Modified | For `beamConnection === 'flush'`, emits a `hardware` section: joist hangers with `count = joistCount × HANGER_ENDS_PER_JOIST` (constant = 2) — two ends per joist, beam-count-invariant with a rationale comment cross-referencing the `post-layout.ts` "exactly 2 rim beams" MVP invariant. SKU labels the JOIST nominal ("Joist hangers (2×N)"). Drop emits no hardware. Flush joist cut LENGTHS in the packed cut-list reflect the shortened `size.z` automatically. |
| `src/persistence/deck-file/schema-v2.ts` | Modified | Adds `finalizeBeamConnection` helper mirroring S26's `finalizeFloatingFraming`. Both v1→v2 migration and v2 native load paths route through it — missing field defaults to `'drop'`; invalid enum values rejected by Ajv. |
| `docs/deck-file-schema-v2.json` | Modified | Adds `beamConnection` as an OPTIONAL string enum (`'drop' \| 'flush'`) with `additionalProperties: false` preserved. |
| `src/persistence/deck-file/migrate-v1-to-v2.ts` | Modified | v1 designs stamp `beamConnection: 'drop'` (pre-S27 default) via `finalizeBeamConnection`. |
| `src/persistence/deck-file/validator.ts` | Modified | `beamConnection` added to the schema-v2 field allowlist. |
| `src/application/apply-parameters.ts` | Modified (schema-only) | The deep-merge already carries own-key scalars through; `beamConnection` is exercised by the S27 test suite to lock in the behavior (persists across structure switches — G4). |
| `src/ui/fields/BeamConnectionSelector.tsx` | New | Radio group ("Drop beam (joists rest on top)" / "Flush beam (joists hung level / tops flush)") mirroring `FloatingFramingSelector` — a11y-labelled, keyboard-operable, `aria-describedby` caption. |
| `src/ui/ParameterPanel.tsx` | Modified | Renders `<BeamConnectionSelector />` VISIBLE when `structure === 'elevated'` OR (`structure === 'floating' && floatingFraming === 'beams-and-joists'`); HIDDEN under Method B. LayoutError from `validateFlushBeamDepth` surfaces via the existing `useDesignStatus().lastError` inline banner — no new UI code needed for the error path. |
| `src/domain/layout/__fixtures__/fixtures-data.ts` | Modified | Adds two S27 flush golden fixtures: `elevated-12x12-flush` and `floating-16x14-oldcastle-flush` (both 2×8 joist + 2×10 beam — canonical VALID unequal-flush combo). |
| `src/domain/layout/__fixtures__/elevated-12x12-flush.json` | New | End-to-end flush layout snapshot (elevated). |
| `src/domain/layout/__fixtures__/floating-16x14-oldcastle-flush.json` | New | End-to-end flush layout snapshot (floating Method A). |

### Affected contracts

| Contract | Change | Backward compatible? |
|---|---|---|
| `.deck` file (schema v1) | New | Frozen after first release. Any breaking change requires schema v2 + migration function. |
| `DeckDesign` in-memory type | New | Freely evolvable within v1 as long as `.deck` v1 serialization is preserved. |
| `Layout` render contract | New | Adapters (`scene/`) depend on this shape. Additive changes safe; renames or removals require coordinated updates across scene components. |
| `SpanTable` interface | New | Additive changes safe; the MVP ships one impl (`IrcSpanTable`). |
| localStorage key `wooddeck:current-design:v1` | New | Same versioning discipline as file format. |
| `.deck` file (schema v2) *(added 2026-07-04)* | New | Additive to v1. v1 files load through a v1→v2 migration. Serialize writes v2 from the release forward. Loader gate remains `switch (schema)` — any unknown version fails-loud. |
| `DeckDesign.foundation` (union) *(added)* | New | New required field. v1 loads default it to `{type: 'posts-on-footings', ...}`. |
| `DeckDesign.structure` (enum) *(added)* | New | New required field. v1 loads default it to `'elevated'`. |
| `DeckDesign.beamConnection` (enum) *(added 2026-07-05 S27)* | New | New required field on `DeckDesign` — `'drop' \| 'flush'`. v1 loads (via v1→v2 migration) AND v2 native loads missing the field default it to `'drop'` via `finalizeBeamConnection` — backward-compatible for every pre-S27 `.deck` file. Invalid enum values rejected by Ajv. |
| `LayoutMember.material` widening *(added)* | Modified | `MaterialRef` → `MemberMaterialRef = LumberRef \| BlockRef`. Every scene / BOM / span-check consumer must pattern-match on the discriminator. Backward-compatible at value level: existing lumber members carry `{kind:'lumber', ...}`. |

### Architectural deltas

- **New:** A pure hexagonal core (`domain/`) with an enforced import discipline. This assumption did not previously exist (greenfield); it becomes a load-bearing architectural invariant for the life of the project.
- **New:** UI is a *view* of application state; state is a *cache* of domain output. The 3D scene must be a pure consumer of `Layout` — no geometry decisions in `scene/`.
- **New:** Undo/redo is a first-class concern of the design store (via `zundo`) from day one, even before a UI surface exists.

### Backward compatibility and migration

- **Breaking changes:** None (greenfield).
- **Migration path:** N/A — no existing users or data.
- **Deprecation timeline:** N/A.

### Risk surface

**Risks introduced:**
- **`.deck` format calcification risk.** First breaking change to a shipped format is painful. Mitigated by shipping the version envelope + JSON Schema + `switch(schema)` loader on day one (FR-018, FR-019, Assumptions).
- **Scene ↔ domain drift risk.** The pure-core hexagonal design rots if scene components add geometry math. Mitigated by (a) `Layout` type as a complete render contract (FR-005), (b) boundary-enforcement lint (NFR-011), (c) explicit review checklist item in Story 10.
- **Legal-liability surface.** IRC span checks create an impression of engineering validation. Mitigated by FR-016 (non-dismissable disclaimer, on-first-paint) and SC-007 (unit-tested).

**Risks introduced by Epic 2 (added 2026-07-04):**
- **Schema drift risk (v1 vs v2).** A v1 file loaded by a v2 build must migrate cleanly; a v2 file loaded by a v1 build must fail-loud with `unknown-schema`. Mitigated by: (a) SC-010 v1-round-trip golden test, (b) the existing `KNOWN_SCHEMA_VERSIONS` `switch` gate, (c) a new `'migration-failed'` `DeckFileErrorCode` so any migration issue surfaces distinctly from a corrupt-file issue.
- **Compat-matrix drift risk.** The FR-030 compatibility rules (`structure` × `foundation.type`) are cross-cutting; a future story that adds a new foundation product must update the matrix or the app enters an incoherent state. Mitigated by: (a) an exhaustive-switch validator in the domain layer, (b) a golden fixture set covering every valid combination, (c) a boundary-lint self-test probe that fires when the matrix is bypassed.
- **BOM correctness risk.** FFD is a heuristic — it may over-count stock boards vs an optimal pack. Mitigated by: SC-011 (asymptotic-bound assertion vs a reference optimal solver in a golden set), and by the transparent per-board offcut breakdown in the UI so a user can spot-check the pack.
- **Scene complexity risk.** Two new geometries + two new layer components + a doubled `MemberKind` set expand the surface the "no geometry math in scene" test scans. Mitigated by: extending `no-geometry-math.test.ts` to cover the two new components; keeping `TUFFBLOCK_GEOMETRY` as a stable `CylinderGeometry(topR, botR, height, 6)` singleton (no per-instance math).
- **Three.js bundle size.** r3f + Three.js is ~500 KB gzipped. Mitigated by Vite's code-splitting; scene chunk lazy-loaded on first render.
- **WebGL requirement.** Users on very old browsers cannot use the 3D view. Mitigated by graceful "unsupported browser" fallback (Edge Case list) + read-only 2D plan view remains usable.

**Risks reduced:**
- Zero backend eliminates entire categories of risk: no auth, no secrets, no PII handling, no server ops, no third-party API failures, no CVE surface beyond frontend libraries.
- Static hosting eliminates infrastructure security posture from the review scope.

---

## Product Impact

### Positioning shift

Creates a new product where none existed — a **DIY-homeowner deck visualizer** with real structural feedback but explicitly not an engineering tool. Positioning: "Between a napkin sketch and a professional CAD package." Sets expectation that the app is a planning aid, not a permit-worthy engineering document — this framing is codified in the disclaimer (FR-016).

### Scope boundary changes

MVP scope is deliberately narrow (rectangular, freestanding, no attachments, no stairs, no railings, no multi-level) to preserve the "see what my deck will look like" outcome as the primary value. The 2026-07-04 amendment (Epic 2) BROADENS scope to include foundation-type choice + a floating construction model + a cut-list-optimized BOM — all still under the "rectangular / freestanding" umbrella. Explicitly declining scope for MVP:

- No stairs
- No railings / balusters
- No ledger board / house attachment
- No multi-level decks
- No terrain modeling
- No cost / pricing
- **~~No cut list / cut-optimization export~~** — **REVERSED 2026-07-04** by FR-031 (cut-list-optimized BOM in-panel; PDF/CSV export deferred)
- No 3D drag-editing (edits happen in the parameter panel; 2D plan is read-only in MVP)
- No cloud save / share links / accounts
- No PDF / OBJ / GLB export
- No mobile support
- **~~No intermediate beams (only two end beams)~~** — **PARTIALLY REVERSED 2026-07-04**: the floating model's beam grid supports intermediate beams; the elevated model retains the two-end-beam MVP simplification until a post-MVP story adds intermediate-beam support for `structure='elevated'` (tracked under FR-032's disabled-option reason).
- No terrain / slope compensation on the block grid (blocks are assumed to sit level on level ground; leveling is the user's real-world job — the model does not raise/lower individual blocks).

Every one of these is a plausible v2+ feature. The MVP contract is "prove the core visualization + peel-back-layers UX works, with real structural warnings."

### Roadmap dependencies

- **Unlocks:**
  - Stairs, railings, ledger board attachment → all become straightforward additions once the layout engine, layer scene-graph, and BOM are in place.
  - Alternative code editions (NBC / IRC-2024) → possible because `SpanTable` is an interface.
  - PWA / offline → straightforward because the app is already 100 % client-side.
  - Cost / BOM export → additive to the existing BOM panel.
- **Blocks or delays:** None — greenfield project blocks nothing.
- **Depends on:** Nothing external. Fully self-contained.

### User-facing communication

- **Internal stakeholders to inform:** N/A (solo hobby project).
- **External communication needed:** README + LICENSE + disclaimer are the entirety of external comms for MVP. Public repo visibility (`vbomfim/wooddeck` public) is the only public-facing surface.

---

## Appendix — References

- Code Review Guardian architectural-impact report (Step 5b-arch, 2026-07-02) — 10 findings, 6 positive observations. Verbatim report preserved in the ticket handoff to the orchestrator.
- User answers to PO clarifying questions (2026-07-02), sections A1–J27.
- IRC 2018 — International Residential Code, joist and beam span tables (to be attributed in `docs/span-tables/` before Story 5 ships).
- react-three-fiber documentation — https://docs.pmnd.rs/react-three-fiber
- Zustand documentation — https://github.com/pmndrs/zustand
- `zundo` (Zustand undo/redo middleware) — https://github.com/charkour/zundo
- fast-check (property-based testing) — https://github.com/dubzzz/fast-check
- dependency-cruiser (module-boundary linter) — https://github.com/sverweij/dependency-cruiser
- INVEST criteria — https://www.agilealliance.org/glossary/invest/
- Clean Architecture / Hexagonal Architecture — Robert C. Martin; Alistair Cockburn.
