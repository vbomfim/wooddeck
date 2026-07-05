/**
 * `src/ui/PlanView2D.helpers.ts` — pure helpers backing the S15
 * (issue #16) read-only 2D top-down plan view.
 *
 * ## Why the helpers are in a separate file
 *
 * Every function here is pure (`(inputs) → output`, no React, no
 * DOM, no store). Isolating them from the `.tsx` component means:
 *
 *   - unit tests run without jsdom + React overhead
 *     (`PlanView2D.helpers.test.ts`);
 *   - the `.tsx` stays THIN — a straight-line render of the SVG
 *     tree pulling `{x, y, width, height}` numbers from `projectRect`;
 *   - the geometry math survives a UI rewrite (e.g. swapping the
 *     inline SVG for react-konva later).
 *
 * ## Coordinate contract (mirrors `src/domain/model.ts`)
 *
 * The world frame (S4 producer) is right-handed with
 *
 *     +x  →  deck WIDTH
 *     +y  →  UP
 *     +z  →  deck LENGTH
 *
 * origin at the ground-level CENTER of the footprint, so
 * `LayoutMember.position.x ∈ [-widthMm/2, +widthMm/2]` and
 * `.z ∈ [-lengthMm/2, +lengthMm/2]`.
 *
 * The SVG frame we output is:
 *
 *     viewBox = "0 0 widthMm lengthMm"     (units: mm)
 *     +svgX  →  deck WIDTH
 *     +svgY  →  DOWN (SVG convention)
 *
 * with the origin at the TOP-LEFT of the footprint (SVG default).
 * The projection therefore:
 *
 *   1. Translates world (x=0,z=0) → SVG (widthMm/2, lengthMm/2)
 *      so the deck center lands in the middle of the viewBox.
 *   2. FLIPS the z axis (svgY = lengthMm/2 − worldZ) so a joist at
 *      the FAR end of the deck (world +z) renders at the TOP of the
 *      SVG — matching what a homeowner sees when they look "away
 *      from the house toward the deck".
 *
 * Downstream `<PlanView2D>` uses `preserveAspectRatio="xMidYMid meet"`
 * so the browser handles the actual pixel scaling — this file does
 * not concern itself with px, only mm-in-svg-user-units.
 *
 * ## Boundary
 *
 *   - `../domain/model` (types only)  — Dimensions3D, Layout,
 *                                        LayoutMember.
 *   - `../domain/units` (formatLength) — imperial/metric formatter.
 *   - NO react / dom / three / etc.   — this file is a pure module.
 */
import type { Dimensions3D, Layout, LayoutMember } from '../domain/model';
import { formatLength, type Mm, type UnitSystem } from '../domain/units';

// ---------------------------------------------------------------------------
// Small typed error
// ---------------------------------------------------------------------------

/**
 * Thrown by every helper for invalid input (non-finite numbers,
 * non-positive dimensions). Kept typed so the component (or a
 * test) can `instanceof`-narrow without matching the message.
 */
export class PlanView2DHelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanView2DHelperError';
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new PlanView2DHelperError(
      `${name} must be a finite number (got ${String(value)})`,
    );
  }
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) {
    throw new PlanView2DHelperError(
      `${name} must be a positive number (got ${String(value)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// mmToSvg — magnitude passthrough
// ---------------------------------------------------------------------------

/**
 * Convert a millimeter magnitude to an SVG user-space unit.
 *
 * The `viewBox` we emit is `"0 0 widthMm lengthMm"` (see
 * `computeSvgViewBox`), so 1 mm ↔ 1 user unit — this function is
 * an identity. It exists so callers reading the ticket see the
 * conversion NAMED at every call site (rather than hoping a
 * downstream reader remembers "we picked identity here"). If a
 * future revision changes the viewBox units, this is the single
 * point to edit.
 */
export function mmToSvg(mm: Mm): number {
  assertFinite(mm, 'mmToSvg(mm)');
  return mm;
}

// ---------------------------------------------------------------------------
// worldXToSvgX / worldZToSvgY — position mapping
// ---------------------------------------------------------------------------

/**
 * Translate a world x-coordinate (origin at footprint CENTER) into
 * an SVG x (origin at TOP-LEFT of the footprint). Add half-width
 * so world x=0 lands on the SVG midline.
 */
export function worldXToSvgX(worldX: Mm, widthMm: Mm): number {
  assertFinite(worldX, 'worldXToSvgX(worldX)');
  assertPositive(widthMm, 'worldXToSvgX(widthMm)');
  return worldX + widthMm / 2;
}

/**
 * Translate a world z-coordinate into an SVG y. Two operations:
 *
 *   1. `lengthMm/2 - worldZ` — flip so world +z (far end) → SVG y=0
 *      (top edge). SVG y grows DOWN; without the flip a joist at
 *      the far end would render at the bottom, contradicting the
 *      "looking away from the house" mental model.
 *   2. The `+ lengthMm/2` half-shift is baked into the subtraction
 *      above (algebraically: `lengthMm/2 - worldZ`).
 */
export function worldZToSvgY(worldZ: Mm, lengthMm: Mm): number {
  assertFinite(worldZ, 'worldZToSvgY(worldZ)');
  assertPositive(lengthMm, 'worldZToSvgY(lengthMm)');
  return lengthMm / 2 - worldZ;
}

// ---------------------------------------------------------------------------
// computeSvgViewBox — the <svg viewBox="…"> attribute
// ---------------------------------------------------------------------------

/**
 * The viewBox descriptor for a given `bounds`. Emitting a struct
 * (not just a string) lets the component read the numeric
 * width/length too (e.g. for label positioning) without re-parsing
 * the string.
 *
 * `<PlanView2D>` pairs this with `preserveAspectRatio="xMidYMid meet"`
 * so the browser letterboxes a very-wide (40×8 ft) or very-tall
 * (8×40 ft) layout cleanly inside the container — AC3.
 */
export interface SvgViewBox {
  readonly viewBoxAttr: string;
  readonly widthMm: Mm;
  readonly lengthMm: Mm;
}

export function computeSvgViewBox(bounds: Dimensions3D): SvgViewBox {
  assertPositive(bounds.widthMm, 'computeSvgViewBox(bounds.widthMm)');
  assertPositive(bounds.lengthMm, 'computeSvgViewBox(bounds.lengthMm)');
  return {
    viewBoxAttr: `0 0 ${String(bounds.widthMm)} ${String(bounds.lengthMm)}`,
    widthMm: bounds.widthMm,
    lengthMm: bounds.lengthMm,
  };
}

// ---------------------------------------------------------------------------
// projectRect / projectCenter — member → SVG primitive
// ---------------------------------------------------------------------------

/**
 * The `<rect>` attributes for a rectangular member in SVG
 * user-space (mm). `x`, `y` are the TOP-LEFT corner; `width`,
 * `height` are the FULL extents (matches the SVG rect contract
 * `<rect x=… y=… width=… height=…>`).
 *
 * Uses `size.x` for the SVG width (world +x is deck width — same
 * axis) and `size.z` for the SVG height (world +z is deck length,
 * which maps to SVG y after the flip). `size.y` (the vertical
 * height of the member) is IGNORED — a top-down plan projects onto
 * the x-z plane by design.
 */
export interface SvgRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function projectRect(
  position: { readonly x: Mm; readonly y: Mm; readonly z: Mm },
  size: { readonly x: Mm; readonly y: Mm; readonly z: Mm },
  bounds: Dimensions3D,
): SvgRect {
  assertPositive(size.x, 'projectRect(size.x)');
  assertPositive(size.z, 'projectRect(size.z)');
  const cx = worldXToSvgX(position.x, bounds.widthMm);
  const cy = worldZToSvgY(position.z, bounds.lengthMm);
  return {
    x: cx - size.x / 2,
    y: cy - size.z / 2,
    width: size.x,
    height: size.z,
  };
}

/**
 * The `(cx, cy)` for a `<circle>` at a member's world position —
 * used for posts (and, if the caller opts in, foundation blocks or
 * footings).
 */
export function projectCenter(
  position: { readonly x: Mm; readonly y: Mm; readonly z: Mm },
  bounds: Dimensions3D,
): { readonly x: number; readonly y: number } {
  return {
    x: worldXToSvgX(position.x, bounds.widthMm),
    y: worldZToSvgY(position.z, bounds.lengthMm),
  };
}

// ---------------------------------------------------------------------------
// computeJoistSpacingMm — the number the <desc> quotes
// ---------------------------------------------------------------------------

/**
 * The nearest-neighbor delta between joist z-positions, in mm.
 *
 * ## Why compute from LAYOUT instead of reading `design.joist.spacingMm`
 *
 * The ticket §AC5 wording is `at {spacing} on-center` — the number
 * the SR reads should reflect what is RENDERED, not what the
 * design nominally REQUESTED. Layout math can round the requested
 * spacing to fit a bay-remainder strategy; reading from the
 * rendered joists guarantees the description matches the drawing.
 *
 * When the last bay is shorter than the rest (the
 * `extra-bay-at-end` strategy), consecutive deltas differ. We
 * return the MINIMUM adjacent-pair delta so the announced spacing
 * doesn't over-state the framing — a screen-reader user knows
 * "joists are AT MOST this far apart" is the safety-critical
 * number, not "joists are on average this far apart".
 *
 * @returns the min adjacent-pair delta in mm, or `null` when
 *          fewer than 2 joists exist (no spacing computable — the
 *          `<desc>` omits the clause in that case).
 */
export function computeJoistSpacingMm(
  members: readonly LayoutMember[],
): Mm | null {
  const joistZs = members
    .filter((m) => m.kind === 'joist')
    .map((m) => m.position.z)
    .sort((a, b) => a - b);
  if (joistZs.length < 2) {
    return null;
  }
  let minDelta = Number.POSITIVE_INFINITY;
  for (let i = 1; i < joistZs.length; i++) {
    const delta = joistZs[i]! - joistZs[i - 1]!;
    if (delta > 0 && delta < minDelta) {
      minDelta = delta;
    }
  }
  return Number.isFinite(minDelta) ? minDelta : null;
}

// ---------------------------------------------------------------------------
// formatFootprintLabel — AC1 label text
// ---------------------------------------------------------------------------

/**
 * The footprint dimension label, formatted with `formatLength` so
 * every AC4 unit switch propagates instantly.
 *
 * Uses the U+00D7 × (multiplication sign) between the two numbers,
 * NOT the letter `x` — same convention `formatLength` uses for
 * feet-and-inches. Screen readers pronounce it "by".
 */
export function formatFootprintLabel(
  bounds: Dimensions3D,
  units: UnitSystem,
): string {
  const w = formatLength(bounds.widthMm, units);
  const l = formatLength(bounds.lengthMm, units);
  return `${w} × ${l}`;
}

// ---------------------------------------------------------------------------
// buildPlanDescription — the a11y <desc> text (AC5)
// ---------------------------------------------------------------------------

/**
 * The SVG `<desc>` sentence quoted in AC5:
 *
 *   "Deck footprint: {W} by {L}. {N} joists at {spacing} on-center. {P} posts."
 *
 * Spacing clause is omitted when fewer than 2 joists exist (no
 * meaningful spacing to announce). Singular/plural is handled for
 * the joist/post counts so "1 joists" never happens.
 *
 * English-only in MVP (§16 out-of-scope for i18n).
 */
export function buildPlanDescription(
  layout: Layout,
  units: UnitSystem,
): string {
  const w = formatLength(layout.bounds.widthMm, units);
  const l = formatLength(layout.bounds.lengthMm, units);
  const joistCount = layout.members.filter((m) => m.kind === 'joist').length;
  const postCount = layout.members.filter((m) => m.kind === 'post').length;
  const spacingMm = computeJoistSpacingMm(layout.members);

  const joistWord = joistCount === 1 ? 'joist' : 'joists';
  const postWord = postCount === 1 ? 'post' : 'posts';

  const parts: string[] = [`Deck footprint: ${w} by ${l}.`];

  if (spacingMm !== null) {
    const spacingLabel = formatLength(spacingMm, units);
    parts.push(`${String(joistCount)} ${joistWord} at ${spacingLabel} on-center.`);
  } else {
    parts.push(`${String(joistCount)} ${joistWord}.`);
  }

  parts.push(`${String(postCount)} ${postWord}.`);

  return parts.join(' ');
}
