/// <reference types="vite/client" />
/**
 * Golden-fixture tests — TDD phase.
 *
 * Uses Vitest's `import.meta.glob` to eagerly load every
 * `./__fixtures__/*.json`, calls `computeLayout` against the matching
 * `DeckDesign` in `fixtures-data.ts`, and expects deep-equal output.
 * `now` is injected so `computedAt` is byte-stable (see AC7).
 *
 * If a fixture file is MISSING (fresh checkout after a design was added
 * to `fixtures-data.ts` but before the JSON was regenerated), the test
 * fails with a clear message pointing at the regeneration script.
 *
 * Ticket §18 SC-004: ≥ 10 golden fixtures. The `FIXTURE_DESIGNS` array
 * has 12 entries.
 */
import { describe, expect, it } from 'vitest';

import type { Layout } from '../model';

import { FIXTURE_DESIGNS } from './__fixtures__/fixtures-data';
import { computeLayout } from './layout-engine';

// Vite/Vitest native glob import — eagerly load all JSON fixtures at
// test load time. `{ eager: true, import: 'default' }` yields a
// `Record<path, moduleDefault>` synchronously so the test bodies can
// look up their fixture by name without any file I/O.
const FIXTURE_MODULES = import.meta.glob<{ design: unknown; expected: Layout }>(
  './__fixtures__/*.json',
  { eager: true, import: 'default' },
);

function loadFixture(name: string): { design: unknown; expected: Layout } | null {
  const key = `./__fixtures__/${name}.json`;
  return FIXTURE_MODULES[key] ?? null;
}

describe('golden fixtures — SC-004 (≥ 10 fixtures)', () => {
  it('exposes at least 10 fixture designs', () => {
    expect(FIXTURE_DESIGNS.length).toBeGreaterThanOrEqual(10);
  });

  for (const { name, design } of FIXTURE_DESIGNS) {
    it(`fixture "${name}" matches golden JSON byte-for-byte (computedAt from design.createdAt)`, () => {
      const golden = loadFixture(name);
      if (golden === null) {
        throw new Error(
          `Missing golden fixture: ./__fixtures__/${name}.json\n` +
            `Regenerate with \`REGENERATE_FIXTURES=1 npx vitest run ` +
            `src/domain/layout/__fixtures__/_regenerate.test.ts\`, ` +
            `inspect the diff for correctness, and commit.`,
        );
      }
      const actual = computeLayout(design, { now: () => design.createdAt });
      expect(actual).toEqual(golden.expected);
    });
  }
});
