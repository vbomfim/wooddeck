/**
 * `src/domain/layout/index.barrel.test.ts` — the SMOKE / regression
 * pin for the layout package's public facade (`./index.ts`).
 *
 * Why this exists (PR #73 review, GPT-5.5 MEDIUM #4):
 *   Two modules previously defined a constant with the SAME name
 *   (`MAX_BLOCKING_SPACING_MM`) but DIFFERENT values:
 *     - `blocking-layout.ts` — the ACTIVE, real IRC R502.7.1 value
 *       of `2438` (8 ft) used by `layoutBlockingBetweenJoists`.
 *     - `floating/floating-layout.ts` — a DEAD legacy value of
 *       `1220` (4 ft) with no runtime consumer left, kept only as
 *       a source-compat re-export.
 *   The `index.ts` barrel accidentally re-exported the DEAD 1220
 *   version, so any consumer importing `MAX_BLOCKING_SPACING_MM`
 *   from `src/domain/layout` (the public facade) got the wrong
 *   value — a silent, hard-to-catch bug that would surface as
 *   ~half the row count in downstream row-count arithmetic.
 *
 * This test pins the barrel to the ACTIVE 2438 mm value so any
 * future edit that reshuffles the barrel imports FAILS FAST here
 * instead of miles downstream.
 *
 * Pure `src/domain/**` module test — imports the barrel + vitest;
 * no react, no three, no state store.
 */
import { describe, expect, it } from 'vitest';

import { MAX_BLOCKING_SPACING_MM as BARREL_MAX } from './index';
import { MAX_BLOCKING_SPACING_MM as CANONICAL_MAX } from './blocking-layout';

describe('layout barrel — MAX_BLOCKING_SPACING_MM re-export', () => {
  it('re-exports the ACTIVE constant from ./blocking-layout (= 2438), not the DEAD 1220 legacy', () => {
    expect(CANONICAL_MAX).toBe(2438);
    expect(BARREL_MAX).toBe(2438);
    // Sanity: the barrel-exported reference is the SAME
    // constant as the module-exported one (single source of
    // truth).
    expect(BARREL_MAX).toBe(CANONICAL_MAX);
  });
});

// ---------------------------------------------------------------
// PR #73 review-gate follow-up — MIN_JOIST_SPACING_MM barrel export
// ---------------------------------------------------------------
//
// PR #73 review GPT-5.5 HIGH #2 follow-up: the user chose the ROOT
// FIX for the theoretical member-count blowup — a practical MIN
// joist spacing at validation. Value = 305 mm (12" o.c.) — mirrors
// `TABULATED_SPACINGS_MM[0]` in `remediations.ts` (the codebase's
// canonical tightest sensible spacing and the floor of the
// `reduce-joist-spacing` remediation). Bounds joist count AND its
// blocking multiplier — a 100 ft deck at MIN caps at ~100 joists
// → ~1200 blocking, proportionate.
//
// The constant lives in `./layout-shared` (co-located with
// `validateJoistSpacing`) and MUST be re-exported by the barrel so
// UI / persistence / test consumers reference the single source
// of truth.

import { MIN_JOIST_SPACING_MM as BARREL_MIN_JOIST } from './index';
import { MIN_JOIST_SPACING_MM as CANONICAL_MIN_JOIST } from './layout-shared';

describe('layout barrel — MIN_JOIST_SPACING_MM re-export', () => {
  it('re-exports the canonical value 305 mm (12″ o.c.) from ./layout-shared', () => {
    expect(CANONICAL_MIN_JOIST).toBe(305);
    expect(BARREL_MIN_JOIST).toBe(305);
    expect(BARREL_MIN_JOIST).toBe(CANONICAL_MIN_JOIST);
  });
});
