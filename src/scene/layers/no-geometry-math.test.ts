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
 *   - `member.position.x + 100`  — infix arithmetic AFTER coord
 *   - `member.size.x / 2`
 *   - `member.size.x * 0.5`
 *   - `-member.position.y`       — leading unary minus (axis flip)
 *   - `member.position['x']`     — bracket notation (any use)
 *   - `member.position['x'] + 1` — bracket notation + arithmetic
 *
 * ## Self-tests (the guard's guard)
 *
 * The regex is exercised BY THIS FILE against a `mustFire[]`
 * fixture list AND a `mustNotFire[]` fixture list — a
 * regression that silently weakens the pattern (as happened in
 * Opus review #1: the previous `captured.slice(-2)` tail check
 * missed unary-minus) is caught by the fixtures immediately
 * rather than by a slow-burn "we never noticed the guard broke"
 * discovery months later.
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
 * Guard patterns for arithmetic on member coordinate fields.
 *
 * ## Design: three narrow regexes beat one clever combined regex
 *
 * The first iteration of this guard tried to squeeze the three
 * forbidden shapes into one alternation and then post-filter on
 * `captured.slice(-2)`. That approach missed leading unary minus
 * silently (`-member.position.y` — Opus review #1 HIGH) because
 * the tail-slice fell on `.y` instead of on the `-` prefix. Lesson:
 * one regex per forbidden shape, each tested independently, is
 * both easier to reason about and easier to prove-fires with
 * fixture strings below.
 *
 * ## The three forbidden shapes
 *
 *   1. Infix arithmetic AFTER the coord access:
 *      `member.position.x + 1`, `member.size.y / 2`, `member.rotation.z * 0.5`.
 *
 *   2. Leading unary minus BEFORE the coord access — the axis-flip
 *      idiom (`-member.position.y` to invert Y):
 *      the `-` must be preceded by start-of-line, whitespace, or a
 *      grouping/expression character (`[`, `(`, `,`, `=`, `:`) so
 *      we don't false-positive an identifier fragment like
 *      `foo-member.position.y` (which would be a syntax error
 *      anyway, but tidy).
 *
 *   3. Bracket notation on the coord fields — a defense against
 *      `member.position['x'] + 1` and friends that would sneak
 *      past the dot-only pattern above.
 *
 * Each regex is `global` so the scanner can find every offender
 * on a line — the failing test lists them all.
 */
const INFIX_ARITHMETIC_AFTER_COORD =
  /member\.(?:position|size|rotation)\.[xyz]\s*[+\-*/%]/g;

const UNARY_MINUS_BEFORE_COORD =
  /(?:^|[\s([{,;:=?])-\s*member\.(?:position|size|rotation)\.[xyz]\b/g;

const BRACKET_NOTATION_ON_COORD =
  /member\.(?:position|size|rotation)\[/g;

/**
 * Apply all three guard regexes to a single (comment-stripped)
 * source line and return the concatenated matches (empty if
 * clean). Exported for the fixture-string self-tests below —
 * so a regression that weakens any of the three patterns is
 * caught mechanically.
 */
export function findGeometryMathOffenses(line: string): string[] {
  const found: string[] = [];
  for (const re of [INFIX_ARITHMETIC_AFTER_COORD, UNARY_MINUS_BEFORE_COORD, BRACKET_NOTATION_ON_COORD]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      found.push(m[0]);
    }
  }
  return found;
}

describe('layers — no scene geometry math (finding #3)', () => {
  const files = collectSourceFiles(LAYERS_DIR);

  it('scanned at least one layer source file', () => {
    // Sanity — if the discovery walk found nothing, the assertions
    // below would trivially pass (vacuous). This test guards against
    // a refactor that moves the layer files elsewhere without
    // updating the walk root.
    expect(files.length).toBeGreaterThan(0);
  });

  describe('guard-regex self-tests — MUST-FIRE fixtures (regression sentinels)', () => {
    // Each fixture is a string that the guard MUST flag. If any of
    // these ever passes silently, we have re-introduced the exact
    // finding-#3 escape hatch that Code Review Guardian Opus flagged.
    const mustFire: Array<[label: string, source: string]> = [
      ['infix add on position.x', 'const y = member.position.x + 100;'],
      ['infix multiply on size.y', 'const h = member.size.y * 0.5;'],
      ['infix divide on rotation.z', 'const r = member.rotation.z / 2;'],
      ['infix subtract on position.y', 'const d = member.position.y - offset;'],
      ['leading unary minus on position.y (Opus #1 miss)', 'const flipped = -member.position.y;'],
      ['unary minus after equals', 'const v = -member.size.x;'],
      ['unary minus in array literal', 'const arr = [-member.position.x, 0, 0];'],
      ['unary minus in function call', 'foo(-member.rotation.y);'],
      ['bracket notation on position', "const v = member.position['x'] + 1;"],
      ['bracket notation on size (no arithmetic — still forbidden)', "const s = member.size['y'];"],
    ];
    for (const [label, source] of mustFire) {
      it(`FIRES on: ${label}`, () => {
        const offenses = findGeometryMathOffenses(source);
        expect(offenses.length, `expected the guard to flag: ${source}`).toBeGreaterThan(0);
      });
    }
  });

  describe('guard-regex self-tests — MUST-NOT-FIRE fixtures (false-positive sentinels)', () => {
    // Each fixture is a legitimate scene-layer line the guard
    // MUST leave alone. If a regex tweak here starts firing on any
    // of them, we have made the guard too aggressive.
    const mustNotFire: Array<[label: string, source: string]> = [
      ['bare coord read in array construction', 'position={[member.position.x, member.position.y, member.position.z]}'],
      ['bare coord read in another array', 'scale={[member.size.x, member.size.y, member.size.z]}'],
      ['bare coord read in rotation array', 'rotation={[member.rotation.x, member.rotation.y, member.rotation.z]}'],
      ['coord passed to a function without arithmetic', 'someHelper(member.position.x, member.position.y);'],
      ['object shorthand with coord', 'const p = { x: member.position.x };'],
      ['coord in a variable assignment', 'const px = member.position.x;'],
      ['string containing member.position.x + but with word boundary', 'const doc = "member.position.x describes the center";'],
    ];
    for (const [label, source] of mustNotFire) {
      it(`does NOT fire on: ${label}`, () => {
        const offenses = findGeometryMathOffenses(source);
        expect(offenses, `expected the guard to leave alone: ${source}`).toEqual([]);
      });
    }
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
        const offenses = findGeometryMathOffenses(stripped);
        for (const _ of offenses) {
          matches.push(`  ${i + 1}: ${line.trim()}`);
          break; // one report per line is enough
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
