/**
 * Barrel test for `src/application/index.ts`.
 *
 * ## Coverage
 *
 *   - Every export listed in issue #8 §2 is present at the barrel.
 *   - AC7 line-budget rule from issue #8 §15: each exported use-case
 *     FUNCTION is ≤ 40 lines. Enforced by reading each use-case file
 *     from disk and counting the lines of every exported top-level
 *     function via a lightweight AST-free heuristic. This is the
 *     grep-style guard that prevents a future rewrite from bloating
 *     a use-case into a "God function".
 *   - AC7 (design-level) — the "action becomes a one-liner"
 *     ergonomic. Documented via a synthetic call showing every
 *     use-case can be composed into a `set(bundle)`-shape action
 *     with zero glue.
 *
 * ## Why a file-based line counter instead of a TypeScript AST parse
 *
 * A TypeScript parser (`typescript`, `ts-morph`) would give us
 * perfect fidelity but add ~50 MB of runtime dependency + measurable
 * test-suite startup time. A simple `readFileSync` + regex is
 * deterministic, ships zero dep, and has been sufficient for AC7 —
 * the alternative "keep it under 40 lines" convention is enforced
 * by review anyway.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as applicationBarrel from './index';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Barrel surface — every symbol from issue #8 §2 must be exported
// ---------------------------------------------------------------------------

describe('application/index.ts — barrel surface (issue #8 §2)', () => {
  it.each([
    'computeLayoutAndCheck',
    'loadDesignFromFile',
    'loadDesignFromLocalStorage',
    'saveDesignToLocalStorage',
    'downloadDesign',
    'applyParameters',
    'ApplyParametersError',
  ])('exports %s', (name) => {
    expect((applicationBarrel as Record<string, unknown>)[name]).toBeDefined();
  });

  it('exports ApplyParametersError as a class extending Error', () => {
    // Sanity check — the error is meant for `err instanceof
    // ApplyParametersError` at the call site. A rewrite that exposed
    // a factory function instead would break every caller.
    const { ApplyParametersError } = applicationBarrel;
    expect(new ApplyParametersError('x', 'y')).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// AC7 line-budget guard — every exported use-case fn is ≤ 40 lines
// ---------------------------------------------------------------------------

/**
 * The four use-case files. For each one we assert that every exported
 * top-level function's body (definition line + body lines up to the
 * matching brace at column 0) is ≤ 40 lines.
 *
 * The heuristic:
 *   - Find lines starting with `export function <name>(` OR
 *     `export async function <name>(`.
 *   - Count from that line down to the FIRST closing brace at column
 *     0 (`^}$`). That is the body length INCLUSIVE of the signature
 *     and closing brace.
 *
 * This mirrors the way a human counts "how big is this function"
 * during review — signature line to matching brace.
 */
interface UseCaseFile {
  readonly relPath: string;
  readonly expectedFunctionNames: readonly string[];
}

const USE_CASE_FILES: readonly UseCaseFile[] = [
  {
    relPath: 'compute-layout.ts',
    expectedFunctionNames: ['computeLayoutAndCheck'],
  },
  {
    relPath: 'load-design.ts',
    expectedFunctionNames: ['loadDesignFromFile', 'loadDesignFromLocalStorage'],
  },
  {
    relPath: 'save-design.ts',
    expectedFunctionNames: ['saveDesignToLocalStorage', 'downloadDesign'],
  },
  {
    relPath: 'apply-parameters.ts',
    expectedFunctionNames: ['applyParameters'],
  },
];

/**
 * Measure the line-length of every exported function in a source
 * file. Returns a map of function-name → line-count.
 */
function measureExportedFunctions(source: string): Map<string, number> {
  const lines = source.split('\n');
  const measured = new Map<string, number>();
  const startPattern = /^export (?:async )?function (\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const match = startPattern.exec(lines[i]!);
    if (match === null) continue;
    const name = match[1]!;

    // Walk forward to the first column-0 `}` — the matching close of
    // the function body. This works because our use-case files use
    // 2-space indentation for the body and NO left-flush braces
    // inside a function (a convention verified in the current tree).
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === '}') {
        end = j;
        break;
      }
    }
    // +1 for inclusive count (both signature line AND closing brace).
    measured.set(name, end - i + 1);
  }
  return measured;
}

describe('application/**/*.ts — every use-case function is ≤ 40 lines (issue #8 §15)', () => {
  for (const file of USE_CASE_FILES) {
    describe(file.relPath, () => {
      const abs = resolve(HERE, file.relPath);
      const source = readFileSync(abs, 'utf8');
      const measured = measureExportedFunctions(source);

      it.each(file.expectedFunctionNames)(
        '`%s` fits in ≤ 40 lines (signature-to-close, inclusive)',
        (name) => {
          const lineCount = measured.get(name);
          expect(lineCount).toBeDefined();
          // A missing function is a barrel-surface failure — the
          // above `.toBeDefined()` catches that; the actual line-
          // count check runs when the function IS present.
          expect(lineCount!).toBeLessThanOrEqual(40);
        },
      );

      it('exports exactly the expected use-case function set (no accidental extras)', () => {
        // Prevents a rewrite from smuggling a new exported use-case
        // in without updating this test — and thereby the ticket.
        expect(Array.from(measured.keys()).sort()).toEqual(
          [...file.expectedFunctionNames].sort(),
        );
      });
    });
  }
});

// ---------------------------------------------------------------------------
// AC7 (design-level) — "Zustand actions become one-liners"
// ---------------------------------------------------------------------------

/**
 * The store action from S8 is not implemented yet, but the SHAPE we
 * commit to here is:
 *
 * ```ts
 *   const applyEdit = (patch) => set(applyParameters(design, patch, table));
 * ```
 *
 * That's it — one line. This test doesn't call `set()` (Zustand isn't
 * in scope), but it demonstrates the ergonomics: every use-case
 * returns something you can spread straight into a store slice.
 */
import { FIXTURE_DESIGNS } from '../domain/layout/__fixtures__/fixtures-data';
import { IrcSpanTable } from '../domain/spans';

const table = new IrcSpanTable();
const FIXTURE = FIXTURE_DESIGNS[2]!.design;

describe('application layer — AC7 one-liner ergonomics', () => {
  it('applyParameters output slots into a state-store update with no glue', () => {
    // Imagined store-side (S8):
    //   set({ ...applyParameters(currentDesign, patch, table) })
    //
    // This test just proves the RHS is a well-shaped object with the
    // three DesignBundle keys — nothing more is needed to spread it.
    const bundle = applicationBarrel.applyParameters(
      FIXTURE,
      { footprint: { widthMm: 4000 } },
      table,
    );
    // Object.keys returns own-enumerable keys — matches what
    // `...bundle` would spread into the target.
    expect(Object.keys(bundle).sort()).toEqual(['design', 'layout', 'warnings']);
  });

  it('computeLayoutAndCheck output composes into a DesignBundle in ONE spread', () => {
    // Imagined store-side (S8 recompute):
    //   set({ design, ...computeLayoutAndCheck(design, table) })
    const half = applicationBarrel.computeLayoutAndCheck(FIXTURE, table);
    const bundle = { design: FIXTURE, ...half };
    expect(Object.keys(bundle).sort()).toEqual(['design', 'layout', 'warnings']);
  });
});
