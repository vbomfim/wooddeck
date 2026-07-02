/**
 * `src/domain/units.ts` — the canonical millimeter subsystem.
 *
 * ## Why this module exists
 *
 * Every length value in the wooddeck domain is stored as an integer
 * number of millimeters (`Mm`). This module is the SOLE place in the
 * codebase that:
 *
 *   1. Converts between mm and the human-facing systems (imperial ft/in
 *      with 1/16-inch fractions, and metric m/cm/mm).
 *   2. Parses user input strings into canonical `Mm`.
 *   3. Formats `Mm` back into a display string.
 *   4. Defines the unit-conversion magic constants (`MM_PER_INCH`,
 *      `MM_PER_FOOT`, `MM_PER_METER`) — those literals MUST NOT appear
 *      anywhere else in the codebase (see ticket §2 and the Code Review
 *      Guardian checklist).
 *
 * ## Canonical imperial display style
 *
 * Ticket #3 leaves the imperial display style as an implementer choice
 * (Open Question). We pick **`12′ 6″`** — Unicode prime marks (U+2032,
 * U+2033) separated by a single space between the feet and inches
 * parts, with an additional single space before an optional
 * lowest-terms sixteenth-of-an-inch fraction (`12′ 6 1/2″`). Rationale:
 *
 *   - AC4's example is `"12′ 0″"`, so prime marks are already the
 *     baseline the tests reference verbatim.
 *   - Unicode primes are unambiguous — unlike `'` / `"` which double
 *     as quote characters in nearly every other string context.
 *   - A single space avoids the `-` in `12'-6"` which looks like a
 *     minus sign to a naive parser.
 *
 * The parser ACCEPTS the alternative forms (`'`, `"`, `ft`, `in`, `feet`,
 * `inches`, and a *single directly-adjacent* `-` between the feet mark
 * and inches) so users are not punished for typing what they know, but
 * everything the app emits uses the canonical `12′ 6″` style.
 *
 * ## Bare-number semantics
 *
 * Bare numbers (no unit suffix) resolve against the `defaultSystem`
 * argument:
 *
 *   - `parseLength("12", "imperial")` → 3658 mm (12 feet)
 *     — feet is the natural imperial "big" unit; matches AC1 which
 *     uses `"12"` interchangeably with `"12 ft"`.
 *   - `parseLength("12", "metric")`   → 12 mm
 *     — millimeters is the canonical metric unit AND the storage unit.
 *
 * Both of these are autonomous decisions (documented above and in the
 * PR / handoff).
 *
 * ## Decimal separator
 *
 * ONLY `.` is accepted. `,` is rejected with a clear error message.
 * MVP scope decision from ticket §15 — locale-aware parsing is out of
 * scope for the MVP.
 *
 * ## Parser tolerances (case-insensitive, permissive whitespace)
 *
 * - All input is lower-cased before regex matching, so `12 FT`, `12 Ft`,
 *   `3.5 M`, `350 CM` are all accepted.
 * - The inch marker is OPTIONAL after the inches magnitude in feet+inches
 *   combos, so `12 ft 6` and `12'6` parse as `12 ft 6 in` (mirrors
 *   carpenter-shorthand). The inch marker is REQUIRED for inches-only
 *   forms so a bare `6` doesn't ambiguously become 6 inches when the
 *   `defaultSystem` is imperial (where bare = feet).
 *
 * ## Range & finiteness policy
 *
 * The public API assumes `Mm` is a **finite, non-negative `number`**.
 * Every entry point (`formatLength`, `mmToFtIn`, `mmToMeters`,
 * `ftInToMm`'s numeric args, `metersToMm`'s numeric arg) validates via
 * `assertMm` / `assertNonNegativeFinite` and throws `RangeError` on
 * `NaN` / `±Infinity` / negative input. This is a HARD requirement,
 * not defensive fluff: without it, `NaN` propagating into the
 * sixteenth-of-an-inch GCD loop hangs the process because
 * `NaN !== 0` is always true (a real DoS vector).
 *
 * The parser applies the same rejection at the input boundary
 * (`UnitParseError` instead of `RangeError`, since the failure mode is
 * "user typed a bad string" rather than "programmer passed a bad
 * number"). Concretely, a very long digit run whose `parseFloat`
 * overflows to `Infinity` is rejected with `UnitParseError`.
 *
 * ## Non-integer `Mm` policy
 *
 * Non-integer `Mm` values ARE accepted by the public API. Formatters
 * and converters round internally (`Math.round` for metric magnitudes,
 * sixteenth-of-an-inch integer rounding for imperial). Rationale: many
 * upstream computations naturally produce a `number` with sub-mm float
 * drift (e.g. `existing_mm * 0.75`); forcing every caller to
 * pre-`Math.round` adds boilerplate without new safety. The rounding
 * behaviour is locked in by tests in `units.test.ts`.
 *
 * ## Framework / DOM ban
 *
 * This file lives under `src/domain/**` and must remain framework-free
 * and DOM-free. Enforced at three layers: `.dependency-cruiser.cjs`
 * (import graph), `eslint.config.js` (no-restricted-globals /
 * no-restricted-imports override), and `scripts/boundary-selftest.mjs`
 * (self-test fixtures). No imports from `react` / `react-dom` / `three`
 * / `@react-three/*` / `@testing-library/*` / `jsdom` may appear here.
 *
 * ## Security
 *
 * Parsing is regex-based (see `parseLength`). NO `eval` / `Function`
 * / dynamic-import is used. All patterns are anchored (`^…$`) so a
 * malicious input cannot cause catastrophic backtracking against
 * unbounded contexts. Length magnitudes whose numeric value overflows
 * `Number.MAX_VALUE` (~1.8e308) are rejected — the parser cannot
 * synthesize `Infinity` and hand it to downstream math.
 */

// ==========================================================
// Types
// ==========================================================

/**
 * Canonical length in millimeters. A plain `number` type-alias by
 * design — trade-off decision per ticket §17 (option B): brand types
 * (`Length<'mm'>`) add ceremony without payoff in a mm-only domain, so
 * we centralize conversion here instead of via the type system.
 *
 * Values SHOULD be non-negative integers; `parseLength` guarantees
 * this on the input side, and application code must not deposit
 * fractional or negative mm.
 */
export type Mm = number;

/**
 * The two unit systems the app understands. Extending this list is a
 * spec change (parser + formatter must be updated in tandem).
 */
export type UnitSystem = 'imperial' | 'metric';

/**
 * Decomposition of an `Mm` value into feet + whole inches + a
 * lowest-terms sixteenth-of-an-inch fraction string (e.g. `"1/2"`,
 * `"3/8"`, `"15/16"`, or `""` when the value is a whole inch).
 */
export interface FtIn {
  readonly feet: number;
  readonly inches: number;
  readonly fraction: string;
}

/**
 * Options controlling the precision of `formatLength`.
 *
 *   - `"fine"` (default) — imperial: nearest 1/16 in; metric: mm
 *     precision on meters, tenths on cm. Guarantees round-trip
 *     stability within ±1 mm (AC7).
 *   - `"coarse"`         — imperial: nearest whole inch, no fraction;
 *     metric: tenths on meters, whole on cm/mm. Cheaper display for
 *     labels where fractions add noise; round-trip NOT stable.
 */
export interface FormatOptions {
  readonly precision?: 'coarse' | 'fine';
}

// ==========================================================
// Constants — the ONLY place these literals live.
// ==========================================================

/** Exact SI definition of an inch. */
export const MM_PER_INCH = 25.4;

/** Exact: 12 × MM_PER_INCH. Precomputed for readability, not perf. */
export const MM_PER_FOOT = 304.8;

/** Exact: metric prefix milli = 10⁻³. */
export const MM_PER_METER = 1000;

/** Number of sixteenths in one inch — display-fraction resolution. */
const SIXTEENTHS_PER_INCH = 16;

/** Inches per foot — used only inside this module for imperial carry math. */
const INCHES_PER_FOOT = 12;

/** Canonical foot mark (prime). */
const FOOT_MARK = '\u2032'; // ′

/** Canonical inch mark (double prime). */
const INCH_MARK = '\u2033'; // ″

// ==========================================================
// Errors
// ==========================================================

/**
 * Thrown by `parseLength` when the input cannot be interpreted. The
 * offending original input is preserved on `.input` so callers can
 * surface a helpful message to the user without stashing state.
 */
export class UnitParseError extends Error {
  public readonly input: string;

  public constructor(message: string, input: string) {
    super(message);
    this.name = 'UnitParseError';
    this.input = input;
    // Restore the prototype explicitly so `instanceof UnitParseError`
    // works after transpilation to older targets. See TS handbook
    // "Extending built-ins".
    Object.setPrototypeOf(this, UnitParseError.prototype);
  }
}

// ==========================================================
// Input-range guards (public-API side)
// ==========================================================

/**
 * Reject any `Mm` value that isn't a finite, non-negative number.
 * Non-integer values pass (see "Non-integer Mm policy" in the module
 * header — they're rounded internally).
 *
 * This is the LAST line of defence against `NaN` / `±Infinity`
 * reaching the sixteenth-of-an-inch GCD loop and hanging the process
 * (`NaN !== 0` is always true — a real DoS vector). It runs at the
 * top of every public API that takes an `Mm`.
 *
 * Throws `RangeError` rather than `UnitParseError` because the failure
 * mode is "programmer passed a bad number", not "user typed a bad
 * string". `RangeError` is the JS stdlib idiom for "your argument is
 * out of the allowed domain" (cf. `Number.prototype.toString(37)`).
 */
function assertMm(mm: Mm, ctx: string): void {
  if (!Number.isFinite(mm)) {
    throw new RangeError(`${ctx}: Mm must be a finite number, got ${String(mm)}`);
  }
  if (mm < 0) {
    throw new RangeError(`${ctx}: Mm must be non-negative, got ${String(mm)}`);
  }
}

/**
 * Same finiteness / non-negativity discipline as `assertMm`, but for
 * plain-number arguments to the imperial and metric converters
 * (`ftInToMm`, `metersToMm`). Kept as a separate helper so error
 * messages can identify the specific argument by name.
 */
function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name}: expected a finite number, got ${String(value)}`);
  }
  if (value < 0) {
    throw new RangeError(`${name}: expected a non-negative number, got ${String(value)}`);
  }
}

// ==========================================================
// Explicit conversion helpers.
// ==========================================================

/**
 * Convert a feet / (optional) inches pair to canonical `Mm`, rounded to
 * the nearest integer millimeter. Both arguments must be finite and
 * non-negative; throws `RangeError` otherwise.
 */
export function ftInToMm(feet: number, inches: number = 0): Mm {
  assertNonNegativeFinite(feet, 'ftInToMm.feet');
  assertNonNegativeFinite(inches, 'ftInToMm.inches');
  return Math.round(feet * MM_PER_FOOT + inches * MM_PER_INCH);
}

/**
 * Convert a metric-meter value to canonical `Mm`, rounded to the
 * nearest integer millimeter. `m` must be finite and non-negative.
 */
export function metersToMm(m: number): Mm {
  assertNonNegativeFinite(m, 'metersToMm.m');
  return Math.round(m * MM_PER_METER);
}

/**
 * Convert canonical `Mm` back to floating-point meters. Kept lossless
 * (no rounding here) so downstream code that wants alternate
 * precisions can format however it likes.
 */
export function mmToMeters(mm: Mm): number {
  assertMm(mm, 'mmToMeters');
  return mm / MM_PER_METER;
}

/**
 * Decompose `Mm` into feet / whole inches / a lowest-terms
 * sixteenth-of-an-inch fraction string.
 *
 * Carries fractional overflow properly:
 *   16/16 inch → +1 inch,   12/12 inch → +1 foot.
 */
export function mmToFtIn(mm: Mm): FtIn {
  assertMm(mm, 'mmToFtIn');
  // Work in "sixteenths of an inch" as an integer so we sidestep
  // floating-point drift on the carry boundaries.
  const totalSixteenths = Math.round((mm / MM_PER_INCH) * SIXTEENTHS_PER_INCH);
  const totalInches = Math.floor(totalSixteenths / SIXTEENTHS_PER_INCH);
  const sixteenthsRemainder = totalSixteenths - totalInches * SIXTEENTHS_PER_INCH;
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = totalInches - feet * INCHES_PER_FOOT;
  const fraction = reduceSixteenths(sixteenthsRemainder);
  return { feet, inches, fraction };
}

// ==========================================================
// Formatting — imperial
// ==========================================================

/**
 * Render `Mm` into the canonical `12′ 6 1/2″` style. See module header
 * for the style rationale.
 *
 * Precision mode:
 *   - `"fine"` (default): keeps the sixteenth-of-an-inch fraction.
 *   - `"coarse"`         : rounds to the nearest whole inch, no fraction.
 */
function formatImperial(mm: Mm, precision: 'coarse' | 'fine'): string {
  const decomposed = precision === 'coarse' ? mmToFtInCoarse(mm) : mmToFtIn(mm);
  const { feet, inches, fraction } = decomposed;

  const inchWord = fraction ? `${String(inches)} ${fraction}` : String(inches);
  if (feet > 0) {
    // When feet is present, always show the inches part so the
    // reading is unambiguous (`12′ 0″`, not just `12′`).
    return `${String(feet)}${FOOT_MARK} ${inchWord}${INCH_MARK}`;
  }
  if (inches > 0) {
    return `${inchWord}${INCH_MARK}`;
  }
  if (fraction) {
    // Sub-inch value like 1/8″ — omit the leading "0".
    return `${fraction}${INCH_MARK}`;
  }
  return `0${INCH_MARK}`;
}

/** Coarse variant of `mmToFtIn` — rounds to nearest whole inch. */
function mmToFtInCoarse(mm: Mm): FtIn {
  const totalInches = Math.round(mm / MM_PER_INCH);
  const feet = Math.floor(totalInches / INCHES_PER_FOOT);
  const inches = totalInches - feet * INCHES_PER_FOOT;
  return { feet, inches, fraction: '' };
}

/** Reduce `n/16` to lowest terms; return `""` when n === 0. */
function reduceSixteenths(n: number): string {
  if (n === 0) return '';
  const divisor = gcd(n, SIXTEENTHS_PER_INCH);
  return `${String(n / divisor)}/${String(SIXTEENTHS_PER_INCH / divisor)}`;
}

/** Euclidean GCD on non-negative integers. */
function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

// ==========================================================
// Formatting — metric
// ==========================================================

/**
 * Metric decimal budgets (`fine` mode).
 *
 * The MM-precision-on-meters choice is what guarantees AC7 round-trip
 * stability within ±1 mm: 3 decimals on meters preserves the mm
 * quantum, 1 decimal on centimeters likewise (0.1 cm = 1 mm), and
 * mm-range values are integers.
 */
const FINE_METRIC_DECIMALS = { meters: 3, centimeters: 1, millimeters: 0 } as const;

/** Coarse decimal budgets — lossy on purpose. */
const COARSE_METRIC_DECIMALS = { meters: 1, centimeters: 0, millimeters: 0 } as const;

/** Metric unit-switch thresholds (in mm). */
const CM_THRESHOLD_MM = 100; // ≥ 10 cm switches from "mm" to "cm"
const M_THRESHOLD_MM = 1000; // ≥ 1 m  switches from "cm" to "m"

function formatMetric(mm: Mm, precision: 'coarse' | 'fine'): string {
  const budget = precision === 'coarse' ? COARSE_METRIC_DECIMALS : FINE_METRIC_DECIMALS;

  if (mm >= M_THRESHOLD_MM) {
    return `${stripZeros(mmToMeters(mm), budget.meters)} m`;
  }
  if (mm >= CM_THRESHOLD_MM) {
    return `${stripZeros(mm / 10, budget.centimeters)} cm`;
  }
  return `${stripZeros(mm, budget.millimeters)} mm`;
}

/**
 * Format `value` to at most `decimals` fractional digits and strip
 * trailing zeros (and the trailing `.`). E.g.:
 *   (3.5,    3) → "3.5"
 *   (3.512,  3) → "3.512"
 *   (1.0,    3) → "1"
 *   (35,     1) → "35"
 */
function stripZeros(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  // `parseFloat` collapses "3.500" → 3.5 and "1.000" → 1. Then
  // .toString() gives the shortest round-tripping representation.
  return String(Number.parseFloat(fixed));
}

// ==========================================================
// Public formatter entry point
// ==========================================================

/**
 * Format an `Mm` value as a human-readable string in either unit
 * system. See `FormatOptions` for the precision knob.
 *
 * Throws `RangeError` if `mm` is `NaN` / `±Infinity` / negative — see
 * "Range & finiteness policy" in the module header.
 */
export function formatLength(mm: Mm, system: UnitSystem, opts?: FormatOptions): string {
  assertMm(mm, 'formatLength');
  const precision = opts?.precision ?? 'fine';
  if (system === 'imperial') {
    return formatImperial(mm, precision);
  }
  return formatMetric(mm, precision);
}

// ==========================================================
// Parsing
// ==========================================================

/**
 * A grammar of accepted input forms. Each pattern is tried in order;
 * the first match wins. All patterns are anchored (`^…$`) and only
 * accept `.` as the decimal separator. Order matters — longer,
 * more-specific patterns come first so `12'6"` isn't consumed as
 * `12'` with a stray `6"` left over.
 */
const NUMBER = String.raw`\d+(?:\.\d+)?`;
const FOOT_UNIT = String.raw`(?:ft|foot|feet|'|\u2032)`;
const INCH_UNIT = String.raw`(?:in|inches|inch|"|\u2033)`;
const METRIC_UNIT = String.raw`(?:millimeters|millimeter|centimeters|centimeter|meters|meter|mm|cm|m)`;
// Separator between the feet mark and the inches magnitude in a
// combined ft+in form. ONE of two things is allowed:
//   - any amount (including zero) of whitespace, with NO dash, OR
//   - exactly one `-` character (the carpenter-notation dash, e.g.
//     `12'-6"`), with NO whitespace on either side of it.
//
// This deliberately REJECTS whitespace-surrounded dashes (`12 ft -6 in`,
// `12' -6"`) and repeated dashes (`12'---6"`), which the previous
// `[\s-]*` pattern silently accepted by discarding the sign — a
// prior-review-blocker (both models flagged it) because the user's
// clear intent to write a negative was ignored.
const FT_IN_SEP = String.raw`(?:\s*|-)`;

const METRIC_RE = new RegExp(`^(${NUMBER})\\s*(${METRIC_UNIT})$`);
const IMP_FT_IN_FRAC_RE = new RegExp(
  `^(${NUMBER})\\s*${FOOT_UNIT}${FT_IN_SEP}(\\d+)\\s+(\\d+)/(\\d+)\\s*${INCH_UNIT}?$`,
);
const IMP_FT_FRAC_ONLY_RE = new RegExp(
  `^(${NUMBER})\\s*${FOOT_UNIT}${FT_IN_SEP}(\\d+)/(\\d+)\\s*${INCH_UNIT}?$`,
);
const IMP_FT_IN_RE = new RegExp(
  `^(${NUMBER})\\s*${FOOT_UNIT}${FT_IN_SEP}(${NUMBER})\\s*${INCH_UNIT}?$`,
);
const IMP_FT_ONLY_RE = new RegExp(`^(${NUMBER})\\s*${FOOT_UNIT}$`);
const IMP_IN_MIXED_FRAC_RE = new RegExp(`^(\\d+)\\s+(\\d+)/(\\d+)\\s*${INCH_UNIT}$`);
const IMP_IN_PURE_FRAC_RE = new RegExp(`^(\\d+)/(\\d+)\\s*${INCH_UNIT}$`);
const IMP_IN_DECIMAL_RE = new RegExp(`^(${NUMBER})\\s*${INCH_UNIT}$`);
const BARE_NUMBER_RE = new RegExp(`^(${NUMBER})$`);

/**
 * A pattern-handler pair. When the regex matches, the handler returns
 * the corresponding `Mm` value; the handler receives the exec array
 * and the original (untrimmed) input for use in error messages.
 */
type ImperialHandler = (match: RegExpExecArray, original: string) => Mm;
interface ImperialRule {
  readonly re: RegExp;
  readonly handle: ImperialHandler;
}

/**
 * Imperial pattern table — evaluated top-to-bottom. Longest / most
 * specific patterns come first so the fraction variants aren't
 * shadowed by the plain-integer variants.
 */
const IMPERIAL_RULES: readonly ImperialRule[] = [
  {
    re: IMP_FT_IN_FRAC_RE,
    handle: (m, o) =>
      ftInToMm(num(m, 1, o), num(m, 2, o) + safeFraction(str(m, 3), str(m, 4), o)),
  },
  {
    re: IMP_FT_FRAC_ONLY_RE,
    handle: (m, o) => ftInToMm(num(m, 1, o), safeFraction(str(m, 2), str(m, 3), o)),
  },
  { re: IMP_FT_IN_RE, handle: (m, o) => ftInToMm(num(m, 1, o), num(m, 2, o)) },
  { re: IMP_FT_ONLY_RE, handle: (m, o) => ftInToMm(num(m, 1, o), 0) },
  {
    re: IMP_IN_MIXED_FRAC_RE,
    handle: (m, o) => ftInToMm(0, num(m, 1, o) + safeFraction(str(m, 2), str(m, 3), o)),
  },
  {
    re: IMP_IN_PURE_FRAC_RE,
    handle: (m, o) => ftInToMm(0, safeFraction(str(m, 1), str(m, 2), o)),
  },
  { re: IMP_IN_DECIMAL_RE, handle: (m, o) => ftInToMm(0, num(m, 1, o)) },
];

/**
 * Parse a user-supplied length string into canonical `Mm`.
 *
 * Throws `UnitParseError` (with `.input` preserved) for:
 *   - empty / whitespace-only inputs
 *   - negative numbers (leading `-` or an embedded `-` before a
 *     fraction/inches magnitude — see FT_IN_SEP)
 *   - comma decimals (MVP scope decision — see module header)
 *   - numeric magnitudes that overflow `Number.MAX_VALUE`
 *     (e.g. a >~308-digit numeric prefix; `parseFloat` returns
 *     `Infinity` in that case)
 *   - anything that doesn't match one of the accepted patterns
 *
 * See tests (`units.test.ts`) for the accepted-form matrix.
 */
export function parseLength(input: string, defaultSystem: UnitSystem): Mm {
  const original = input;
  const normalized = input.trim().toLowerCase();
  rejectMalformed(normalized, original);

  const result =
    tryMetric(normalized, original) ??
    tryImperial(normalized, original) ??
    tryBare(normalized, defaultSystem, original);

  return assertParsed(result, original);
}

// ---- Parser helpers ------------------------------------------------

/**
 * Post-conditions for `parseLength`'s dispatch result. Splits the
 * "no pattern matched" and "match succeeded but produced a non-finite
 * value" failure modes into distinct, contextful errors while keeping
 * `parseLength` itself under the size budget.
 */
function assertParsed(result: Mm | null, original: string): Mm {
  if (result === null) {
    throw new UnitParseError(
      `Unrecognized length format: ${JSON.stringify(original)}`,
      original,
    );
  }
  // Belt-and-suspenders: even though `num()` rejects overflowed
  // parseFloat values, this final guard makes the "parseLength never
  // returns non-finite" contract airtight against any future dispatch
  // path that might sneak intermediate math past `num()`.
  if (!Number.isFinite(result)) {
    throw new UnitParseError(
      `Length magnitude out of representable range: ${JSON.stringify(original)}`,
      original,
    );
  }
  return result;
}

/** Reject the input categories that never reach a pattern match. */
function rejectMalformed(normalized: string, original: string): void {
  if (normalized === '') {
    throw new UnitParseError('Length input is empty', original);
  }
  if (normalized.startsWith('-')) {
    throw new UnitParseError(
      `Length must be non-negative; got ${JSON.stringify(original)}`,
      original,
    );
  }
  if (normalized.includes(',')) {
    throw new UnitParseError(
      `Comma decimals are not supported (MVP accepts '.' only); got ${JSON.stringify(original)}`,
      original,
    );
  }
}

function tryMetric(normalized: string, original: string): Mm | null {
  const match = METRIC_RE.exec(normalized);
  if (match === null) return null;
  return metricValueToMm(num(match, 1, original), str(match, 2));
}

function tryImperial(normalized: string, original: string): Mm | null {
  for (const rule of IMPERIAL_RULES) {
    const match = rule.re.exec(normalized);
    if (match !== null) return rule.handle(match, original);
  }
  return null;
}

function tryBare(normalized: string, defaultSystem: UnitSystem, original: string): Mm | null {
  const bare = BARE_NUMBER_RE.exec(normalized);
  if (bare === null) return null;
  const value = num(bare, 1, original);
  return defaultSystem === 'imperial' ? ftInToMm(value, 0) : Math.round(value);
}

function metricValueToMm(value: number, unit: string): Mm {
  if (unit === 'm' || unit === 'meter' || unit === 'meters') {
    return metersToMm(value);
  }
  if (unit === 'cm' || unit === 'centimeter' || unit === 'centimeters') {
    return Math.round(value * 10);
  }
  // millimeter[s] | mm
  return Math.round(value);
}

/**
 * Compute `numerator / denominator` for an imperial fraction, throwing
 * a helpful `UnitParseError` on the pathological `x/0` case. The
 * `original` string is threaded through so the error carries the user
 * input, not just the fragment.
 */
function safeFraction(numStr: string, denomStr: string, original: string): number {
  const numerator = Number.parseFloat(numStr);
  const denominator = Number.parseFloat(denomStr);
  if (denominator === 0) {
    throw new UnitParseError(
      `Fraction denominator is zero in ${JSON.stringify(original)}`,
      original,
    );
  }
  return numerator / denominator;
}

/**
 * Safe capture-group accessor as a string. `noUncheckedIndexedAccess`
 * makes `match[i]` return `string | undefined`; this helper collapses
 * that to `string` after asserting the invariant that a matched
 * required group cannot be absent. The assertion is defensive — if it
 * ever fires, the regex table is misconfigured.
 */
function str(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error(
      `units.ts internal invariant: regex capture group ${String(index)} missing in ${match[0]}`,
    );
  }
  return value;
}

/**
 * Same as `str` but coerces to a finite `number` via `parseFloat`.
 * Rejects overflow-to-`Infinity` and `NaN` with `UnitParseError` so
 * the parser can never hand a poisoned value to the converters (which
 * would otherwise let e.g. a >310-digit numeric prefix produce
 * `Infinity` and eventually hang the downstream GCD math).
 */
function num(match: RegExpExecArray, index: number, original: string): number {
  const value = Number.parseFloat(str(match, index));
  if (!Number.isFinite(value)) {
    throw new UnitParseError(
      `Numeric magnitude in ${JSON.stringify(original)} is not a finite number`,
      original,
    );
  }
  return value;
}
