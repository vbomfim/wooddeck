/**
 * Unit tests for `src/domain/units.ts` — the canonical millimeter subsystem.
 *
 * TDD RED phase: this file is written BEFORE any implementation exists,
 * per Developer Guardian discipline. It exercises every acceptance
 * criterion (AC1–AC7) from GitHub issue #3, every edge case listed in
 * the ticket, the (autonomous-decision) canonical imperial format
 * `12′ 6″`, and — for AC7 — a `fast-check` property test that asserts
 * `parseLength(formatLength(mm, system), system)` is within ±1 mm of the
 * original `mm` across the full `[0, 100_000]` mm range for both
 * unit systems.
 *
 * All assertions cite the AC / edge case they cover so a future reader
 * can trace a red test back to the requirement it defends.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MM_PER_FOOT,
  MM_PER_INCH,
  MM_PER_METER,
  UnitParseError,
  formatLength,
  ftInToMm,
  metersToMm,
  mmToFtIn,
  mmToMeters,
  parseLength,
} from './units';

// -------------------------------------------------------------
// Exported constants — the ONLY place in the codebase where the
// magic 25.4 / 304.8 / 1000 literals may appear (ticket §2).
// -------------------------------------------------------------
describe('units — exported constants', () => {
  it('MM_PER_INCH is exactly 25.4 (SI inch definition)', () => {
    expect(MM_PER_INCH).toBe(25.4);
  });

  it('MM_PER_FOOT is exactly 304.8 (12 × MM_PER_INCH, precomputed)', () => {
    expect(MM_PER_FOOT).toBe(304.8);
    // NOTE: we do NOT assert `MM_PER_FOOT === 12 * MM_PER_INCH` because
    // IEEE 754 gives `12 * 25.4 = 304.79999999999995`. The literal 304.8
    // is the correct precomputed value; that's exactly why we bake it in.
  });

  it('MM_PER_METER is exactly 1000', () => {
    expect(MM_PER_METER).toBe(1000);
  });
});

// -------------------------------------------------------------
// Explicit conversion helpers (ticket §2 interface contract).
// -------------------------------------------------------------
describe('units — ftInToMm', () => {
  it('rounds 1 ft to nearest integer mm (304.8 → 305)', () => {
    expect(ftInToMm(1)).toBe(305);
  });

  it('12 ft = 3658 mm (12 × 304.8 = 3657.6 → round)', () => {
    expect(ftInToMm(12)).toBe(3658);
  });

  it('12 ft 6 in = 3810 mm (exact)', () => {
    expect(ftInToMm(12, 6)).toBe(3810);
  });

  it('0 ft 6.5 in = 165 mm (6.5 × 25.4 = 165.1 → round)', () => {
    expect(ftInToMm(0, 6.5)).toBe(165);
  });

  it('inches defaults to 0 when omitted', () => {
    expect(ftInToMm(2)).toBe(ftInToMm(2, 0));
  });
});

describe('units — mmToFtIn', () => {
  it('returns feet/inches/empty-fraction for exact conversions', () => {
    expect(mmToFtIn(3810)).toEqual({ feet: 12, inches: 6, fraction: '' });
  });

  it('returns 1/2 fraction for the 3823 mm case (ticket edge case)', () => {
    // 12*304.8 + 6.5*25.4 = 3822.7 → round → 3823 mm; formatted back to feet/in.
    expect(mmToFtIn(3823)).toEqual({ feet: 12, inches: 6, fraction: '1/2' });
  });

  it('reduces the sixteenths fraction to lowest terms', () => {
    //   8/16 → 1/2, 4/16 → 1/4, 2/16 → 1/8, 12/16 → 3/4
    expect(mmToFtIn(ftInToMm(0, 0.5))).toEqual({ feet: 0, inches: 0, fraction: '1/2' });
    expect(mmToFtIn(ftInToMm(0, 0.25))).toEqual({ feet: 0, inches: 0, fraction: '1/4' });
    expect(mmToFtIn(ftInToMm(0, 0.75))).toEqual({ feet: 0, inches: 0, fraction: '3/4' });
    expect(mmToFtIn(ftInToMm(0, 0.125))).toEqual({ feet: 0, inches: 0, fraction: '1/8' });
  });

  it('mmToFtIn(0) → {0, 0, ""} (edge case)', () => {
    expect(mmToFtIn(0)).toEqual({ feet: 0, inches: 0, fraction: '' });
  });

  it('carries fractional-inch overflow into whole inches (rounding to 16/16)', () => {
    // 305 mm ≈ 12.0079 in — 16ths of an inch = 192.13 → 192 → carries to 1 ft 0 in.
    expect(mmToFtIn(305)).toEqual({ feet: 1, inches: 0, fraction: '' });
  });
});

describe('units — metersToMm / mmToMeters', () => {
  it('metersToMm rounds to nearest integer mm', () => {
    expect(metersToMm(3.5)).toBe(3500);
    expect(metersToMm(0.0005)).toBe(1); // 0.5 mm rounds up
  });

  it('mmToMeters returns the exact ratio (float)', () => {
    expect(mmToMeters(3500)).toBe(3.5);
    expect(mmToMeters(0)).toBe(0);
  });
});

// -------------------------------------------------------------
// AC1: parse imperial.
// -------------------------------------------------------------
describe('units — parseLength AC1 (imperial forms → 3658 mm)', () => {
  const cases: readonly string[] = ['12 ft', "12'", '12 ft 0 in', `12'0"`, '12′', '12′ 0″'];
  for (const input of cases) {
    it(`parseLength(${JSON.stringify(input)}, "imperial") === 3658`, () => {
      expect(parseLength(input, 'imperial')).toBe(3658);
    });
  }

  it('parseLength("12\'6\\"", "imperial") === 3810', () => {
    expect(parseLength(`12'6"`, 'imperial')).toBe(3810);
  });

  it('parseLength("12 ft 6 in", "imperial") === 3810', () => {
    expect(parseLength('12 ft 6 in', 'imperial')).toBe(3810);
  });

  it('accepts word forms "feet"/"inches"', () => {
    // AC6 users type "twelve feet"; accepting the *word* form (with a
    // numeric magnitude) is a courtesy: rejecting "12 feet" as
    // "unrecognized" would be a worse UX than parsing it.
    expect(parseLength('12 feet', 'imperial')).toBe(3658);
    expect(parseLength('12 feet 6 inches', 'imperial')).toBe(3810);
  });
});

// -------------------------------------------------------------
// AC2: parse metric.
// -------------------------------------------------------------
describe('units — parseLength AC2 (metric forms → 3500 mm)', () => {
  it('parseLength("3.5 m", "metric") === 3500', () => {
    expect(parseLength('3.5 m', 'metric')).toBe(3500);
  });

  it('parseLength("350 cm", "metric") === 3500', () => {
    expect(parseLength('350 cm', 'metric')).toBe(3500);
  });

  it('parseLength("3500 mm", "metric") === 3500', () => {
    expect(parseLength('3500 mm', 'metric')).toBe(3500);
  });

  it('accepts long-form units millimeters/centimeters/meters', () => {
    expect(parseLength('3500 millimeters', 'metric')).toBe(3500);
    expect(parseLength('350 centimeters', 'metric')).toBe(3500);
    expect(parseLength('3.5 meters', 'metric')).toBe(3500);
  });

  it('accepts no space between number and unit ("3.5m")', () => {
    expect(parseLength('3.5m', 'metric')).toBe(3500);
    expect(parseLength('350cm', 'metric')).toBe(3500);
  });
});

// -------------------------------------------------------------
// AC3: bare number → uses defaultSystem.
// -------------------------------------------------------------
describe('units — parseLength AC3 (bare number uses defaultSystem)', () => {
  it('bare "12" + imperial default → 3658 mm (12 ft)', () => {
    // Autonomous decision: bare number in imperial is FEET (matches AC1
    // "12" example in the ticket). Documented in units.ts header.
    expect(parseLength('12', 'imperial')).toBe(3658);
  });

  it('bare "12" + metric default → 12 mm', () => {
    // Autonomous decision: bare number in metric is MILLIMETERS (the
    // canonical unit). Documented in units.ts header.
    expect(parseLength('12', 'metric')).toBe(12);
  });

  it('bare decimal "3.5" + metric default → 4 mm (rounds)', () => {
    expect(parseLength('3.5', 'metric')).toBe(4);
  });
});

// -------------------------------------------------------------
// Fractional imperial input — ticket edge case.
// -------------------------------------------------------------
describe('units — parseLength fractional imperial', () => {
  it('"12\' 6 1/2\\"" → 3823 mm (ticket edge case)', () => {
    expect(parseLength(`12' 6 1/2"`, 'imperial')).toBe(3823);
  });

  it('"6 1/2\\"" → 165 mm (inches-only with fraction)', () => {
    expect(parseLength(`6 1/2"`, 'imperial')).toBe(165);
  });

  it('"1/2\\"" → 13 mm (pure fraction, 25.4/2 = 12.7 → 13)', () => {
    expect(parseLength(`1/2"`, 'imperial')).toBe(13);
  });

  it('"12\'-6\\"" (dashed separator) → 3810 mm', () => {
    // Common carpenter notation. Accepting the dashed form is friendlier
    // than rejecting it as "unrecognized".
    expect(parseLength(`12'-6"`, 'imperial')).toBe(3810);
  });
});

// -------------------------------------------------------------
// AC4: format imperial — canonical style is `12′ 6″`
// (prime marks + single space between the feet and inches parts,
// no dash). Autonomous decision — resolves the ticket's Open Question.
// -------------------------------------------------------------
describe('units — formatLength AC4 (imperial canonical `12′ 6″`)', () => {
  it('formatLength(3658, "imperial") === "12′ 0″"', () => {
    expect(formatLength(3658, 'imperial')).toBe('12′ 0″');
  });

  it('formatLength(3810, "imperial") === "12′ 6″"', () => {
    expect(formatLength(3810, 'imperial')).toBe('12′ 6″');
  });

  it('formatLength(3823, "imperial") === "12′ 6 1/2″" (fraction shown)', () => {
    expect(formatLength(3823, 'imperial')).toBe('12′ 6 1/2″');
  });

  it('formatLength(0, "imperial") === "0″" (zero edge case)', () => {
    expect(formatLength(0, 'imperial')).toBe('0″');
  });

  it('omits the feet part when feet === 0 (e.g. 165 mm → "6 1/2″")', () => {
    expect(formatLength(165, 'imperial')).toBe('6 1/2″');
  });

  it('formats bare fraction "1/16″" when feet===0 && inches===0', () => {
    // 2 mm → 2/25.4 = 0.0787 in → 0.0787 * 16 = 1.26 → 1/16.
    expect(formatLength(2, 'imperial')).toBe('1/16″');
  });

  it('coarse precision drops the fraction (round to nearest whole inch)', () => {
    // 3823 mm = 12 ft 6.51 in — rounds UP to 12′ 7″ at whole-inch precision.
    expect(formatLength(3823, 'imperial', { precision: 'coarse' })).toBe('12′ 7″');
    // 3810 mm = 12 ft 6 in exactly — stays at 12′ 6″.
    expect(formatLength(3810, 'imperial', { precision: 'coarse' })).toBe('12′ 6″');
  });
});

// -------------------------------------------------------------
// AC5: format metric.
// -------------------------------------------------------------
describe('units — formatLength AC5 (metric)', () => {
  it('formatLength(3500, "metric") === "3.5 m"', () => {
    expect(formatLength(3500, 'metric')).toBe('3.5 m');
  });

  it('formatLength(350, "metric") === "35 cm"', () => {
    expect(formatLength(350, 'metric')).toBe('35 cm');
  });

  it('formatLength(35, "metric") === "35 mm"', () => {
    expect(formatLength(35, 'metric')).toBe('35 mm');
  });

  it('formatLength(0, "metric") === "0 mm" (zero edge case)', () => {
    expect(formatLength(0, 'metric')).toBe('0 mm');
  });

  it('formatLength(3660, "metric") === "3.66 m" (2-decimal example from ticket)', () => {
    expect(formatLength(3660, 'metric')).toBe('3.66 m');
  });

  it('formatLength(366, "metric") === "36.6 cm"', () => {
    expect(formatLength(366, 'metric')).toBe('36.6 cm');
  });

  it('formatLength(3512, "metric") === "3.512 m" (mm-precision → round-trip stable)', () => {
    // If we used only 2 decimals, 3512 → "3.51 m" → parse → 3510 (2 mm drift),
    // breaking AC7. Meters therefore carry 3 decimals with trailing zeros stripped.
    expect(formatLength(3512, 'metric')).toBe('3.512 m');
  });

  it('formatLength(1000, "metric") === "1 m" (trailing zeros stripped)', () => {
    expect(formatLength(1000, 'metric')).toBe('1 m');
  });

  it('formatLength(100, "metric") === "10 cm" (trailing zeros stripped)', () => {
    expect(formatLength(100, 'metric')).toBe('10 cm');
  });

  it('coarse metric drops precision (3512 → "3.5 m")', () => {
    expect(formatLength(3512, 'metric', { precision: 'coarse' })).toBe('3.5 m');
  });
});

// -------------------------------------------------------------
// AC6: parse errors.
// -------------------------------------------------------------
describe('units — parseLength AC6 (errors)', () => {
  it('throws UnitParseError on "twelve feet" with .input preserved', () => {
    expect(() => parseLength('twelve feet', 'imperial')).toThrow(UnitParseError);
    try {
      parseLength('twelve feet', 'imperial');
      expect.fail('expected parseLength to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnitParseError);
      if (err instanceof UnitParseError) {
        expect(err.input).toBe('twelve feet');
        expect(err.name).toBe('UnitParseError');
      }
    }
  });

  it('throws on empty string', () => {
    expect(() => parseLength('', 'metric')).toThrow(UnitParseError);
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseLength('   \t\n', 'metric')).toThrow(UnitParseError);
  });

  it('throws on negative input "-12"', () => {
    expect(() => parseLength('-12', 'imperial')).toThrow(UnitParseError);
  });

  it('throws on negative metric "-3.5 m"', () => {
    expect(() => parseLength('-3.5 m', 'metric')).toThrow(UnitParseError);
  });

  it('throws on comma decimal "3,5 m" with a helpful message', () => {
    expect(() => parseLength('3,5 m', 'metric')).toThrow(UnitParseError);
    try {
      parseLength('3,5 m', 'metric');
      expect.fail('expected parseLength to throw');
    } catch (err) {
      // The message should mention comma / decimal so users can fix it.
      expect(err).toBeInstanceOf(UnitParseError);
      if (err instanceof UnitParseError) {
        expect(err.message.toLowerCase()).toMatch(/comma|decimal/);
        expect(err.input).toBe('3,5 m');
      }
    }
  });

  it('throws on unknown unit "12 fathoms"', () => {
    expect(() => parseLength('12 fathoms', 'metric')).toThrow(UnitParseError);
  });

  it('UnitParseError is an Error subclass with .input and correct name', () => {
    const err = new UnitParseError('boom', 'bad-input');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnitParseError);
    expect(err.name).toBe('UnitParseError');
    expect(err.message).toBe('boom');
    expect(err.input).toBe('bad-input');
  });
});

// -------------------------------------------------------------
// Zero edge cases (ticket).
// -------------------------------------------------------------
describe('units — zero edge cases', () => {
  it('parseLength("0", "metric") === 0', () => {
    expect(parseLength('0', 'metric')).toBe(0);
  });

  it('parseLength("0", "imperial") === 0', () => {
    expect(parseLength('0', 'imperial')).toBe(0);
  });

  it('parseLength("0 mm", "metric") === 0', () => {
    expect(parseLength('0 mm', 'metric')).toBe(0);
  });
});

// -------------------------------------------------------------
// AC7: round-trip stability property test (fast-check).
// -------------------------------------------------------------
describe('units — AC7 round-trip property (parse(format(mm)) ≈ mm within ±1 mm)', () => {
  it('imperial round-trip stability over mm ∈ [0, 100_000]', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (mm) => {
        const formatted = formatLength(mm, 'imperial');
        const parsed = parseLength(formatted, 'imperial');
        expect(Math.abs(parsed - mm)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });

  it('metric round-trip stability over mm ∈ [0, 100_000]', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (mm) => {
        const formatted = formatLength(mm, 'metric');
        const parsed = parseLength(formatted, 'metric');
        expect(Math.abs(parsed - mm)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});
