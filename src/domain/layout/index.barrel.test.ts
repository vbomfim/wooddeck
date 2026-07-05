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
