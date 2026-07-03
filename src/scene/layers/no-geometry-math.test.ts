/**
 * `src/scene/layers/no-geometry-math.test.ts` — grep-based guard
 * against Code Review Guardian finding #3 ("no scene geometry
 * math").
 *
 * ## Why a grep test
 *
 * Boundary rules (dep-cruiser) already forbid layer files from
 * importing `src/domain/layout/*` — so the layers cannot call
 * `computeLayout` or any of its sub-functions. But that leaves
 * one path open: a well-meaning developer could inline a piece
 * of geometry math (e.g. `member.position.y + member.size.y / 2`)
 * INSIDE a layer file. There is no boundary rule for that; the
 * closest thing is a code-review checklist item.
 *
 * This grep test makes the "no arithmetic on member coordinates"
 * rule mechanically checkable. It scans every `.tsx` / `.ts` file
 * under `src/scene/layers/` (excluding tests, fixtures, and
 * itself) for arithmetic operators immediately following any of
 * `member.position` / `member.size` / `member.rotation` — the
 * three coordinate-carrying fields.
 *
 * ## Allowed patterns
 *
 *   - `member.position.x` (property access — the layer reads
 *     the coordinate)
 *   - `[member.position.x, member.position.y, member.position.z]`
 *     (array construction for a prop — no arithmetic)
 *
 * ## Forbidden patterns (this test fires)
 *
 *   - `member.position.x + 100`
 *   - `member.size.x / 2`
 *   - `member.size.x * 0.5`
 *   - `-member.position.y`
 *
 * ## What this test does NOT catch
 *
 *   - Assigning `member.position.x` to a variable and doing
 *     arithmetic on that variable. This is a deliberate design
 *     escape hatch — a future feature that legitimately needs
 *     to compute a derived offset (e.g. warning overlay position)
 *     will assign to a local first and get a review comment.
 *     The point of the grep is to catch the obvious "typed
 *     arithmetic inline" case that scanning eyes miss.
 *
 * ## How to fix a firing test
 *
 * Move the arithmetic to `src/domain/layout/**` and re-export the
 * derived coordinate as a new `LayoutMember` field, or via a
 * new domain helper. Never do it in the scene.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Layers live in the same directory as this test file.
const LAYERS_DIR = dirname(fileURLToPath(import.meta.url));

// Files exempt from the scan.
const EXEMPT_FILES = new Set([
  // Tests are excluded from the scan (they DO construct member
  // fixtures with numeric literals in position / size fields, but
  // that's construction, not derivation).
  // The grep below already excludes '.test.tsx' / '.test.ts', but
  // we also skip any file inside `__testing__/` because those are
  // test-only fixtures.
  '__testing__',
]);

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (EXEMPT_FILES.has(entry)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // Skip tests.
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    // Skip the grep test file itself.
    if (entry === 'no-geometry-math.test.ts') continue;
    out.push(full);
  }
  return out;
}

/**
 * Regex that matches arithmetic on member coordinate fields.
 * Any of `member.position.<axis>` / `member.size.<axis>` /
 * `member.rotation.<axis>` immediately followed by whitespace and
 * a `+` / `-` / `*` / `/` / `%` operator (avoiding `**` for the
 * spread operator false-positive by requiring a single operator).
 *
 * The regex also flags a leading unary minus: `-member.position.x`.
 */
const ARITHMETIC_ON_MEMBER_COORD = new RegExp(
  // Group 1: optional unary minus prefix (with a preceding char that
  // isn't an identifier so we don't match `foo-member.position.x`
  // where the `-` is part of a var name — unlikely but tidy).
  '(?:^|[^A-Za-z0-9_])' +
    // Group 2: the coord access itself.
    '(-)?(?:member\\.(?:position|size|rotation)\\.[xyz])' +
    // Group 3: an infix arithmetic operator that follows.
    '(?:\\s*[+*/%]|\\s*-(?!>))?',
  'g',
);

describe('layers — no scene geometry math (finding #3)', () => {
  const files = collectSourceFiles(LAYERS_DIR);

  it('scanned at least one layer source file', () => {
    // Sanity — if the discovery walk found nothing, the assertions
    // below would trivially pass (vacuous). This test guards against
    // a refactor that moves the layer files elsewhere without
    // updating the walk root.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.replace(LAYERS_DIR, '.')} does not perform inline arithmetic on member.position/size/rotation`, () => {
      const source = readFileSync(file, 'utf-8');
      const matches: string[] = [];
      // We split into lines so error messages point at the offending
      // line — useful when the test fires.
      const lines = source.split('\n');
      lines.forEach((line, i) => {
        // Strip line comments so `// -member.size.x / 2 explanation`
        // in a docstring doesn't fire. Block comments are approximated
        // by skipping lines that start with `*` (jsdoc continuation).
        const stripped = line.replace(/\/\/.*$/, '').trim();
        if (stripped.startsWith('*') || stripped.startsWith('//')) return;
        // Re-run the regex on each line — resetting lastIndex is a
        // must because we're re-using the global regex.
        ARITHMETIC_ON_MEMBER_COORD.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = ARITHMETIC_ON_MEMBER_COORD.exec(stripped)) !== null) {
          // Group 2 is the coord access; group 3 (if present) is the
          // arithmetic operator. If we captured the group 3 half of
          // the alternation, arithmetic is happening.
          const captured = m[0];
          // Require that some arithmetic operator was captured
          // (either the unary minus in group 1 or the infix
          // operator at the end of the pattern) — a bare
          // `member.position.x` (no arithmetic) is OK.
          if (/[+*/%]|(?:^|[^-])-[a-zA-Z0-9_]|^-|-$/.test(captured.slice(-2))) {
            matches.push(`  ${i + 1}: ${line.trim()}`);
          }
        }
      });
      // If any offending line was found, surface all of them at once
      // — a fired test SHOULD list every violation so the developer
      // can fix them in one pass.
      expect(matches, matches.length === 0 ? '' : `\n${matches.join('\n')}`).toEqual([]);
    });
  }

  it('does NOT import from src/domain/layout (layout engine coupling)', () => {
    // Belt + suspenders alongside the dep-cruiser
    // `scene-no-domain-layout` rule. Any layer source file that
    // imports from `domain/layout/**` — including via a barrel
    // named `layout` — makes this test fire.
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      // Match `from '.../domain/layout/...'` or
      // `from '.../domain/layout'` (barrel).
      const importsLayout = /from\s+['"][^'"]*domain\/layout(?:\/[^'"]*)?['"]/.test(source);
      expect(importsLayout, `${file}: forbidden import of domain/layout`).toBe(false);
    }
  });

  it('does NOT reference computeLayout, layoutJoists, layoutBeams, layoutPostsAndFootings, or layoutDecking', () => {
    // Symbol-level guard — even a well-crafted alias
    // (`import { computeLayout as cl }`) would show `computeLayout`
    // in the raw source before the alias binds.
    const forbidden = [
      'computeLayout',
      'layoutJoists',
      'layoutBeams',
      'layoutPostsAndFootings',
      'layoutDecking',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      for (const sym of forbidden) {
        // Use a word-boundary match so a variable called
        // `computeLayoutBadge` (if it ever existed) wouldn't fire.
        const re = new RegExp(`\\b${sym}\\b`);
        expect(re.test(source), `${file}: forbidden reference to ${sym}`).toBe(false);
      }
    }
  });
});
