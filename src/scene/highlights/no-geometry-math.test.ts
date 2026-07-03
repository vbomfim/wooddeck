/**
 * `src/scene/highlights/no-geometry-math.test.ts` — grep-based
 * guard mirroring `src/scene/layers/no-geometry-math.test.ts`
 * scoped to the S11 highlights directory + `WarningOverlay.tsx`.
 *
 * ## Why a grep test HERE too
 *
 * S10 established the "no scene geometry math" pledge for layer
 * files (finding #3). The S11 `warning-overlay-no-layers`
 * boundary rule forbids the overlay from reusing the layer
 * primitives — which means the overlay + highlights get their
 * OWN self-contained mesh-construction path. That self-contained
 * path is subject to the SAME "no arithmetic on
 * member.position/size/rotation" discipline: the layout engine
 * (S4) owns every derivation, and the overlay is a passive
 * consumer just like the layers.
 *
 * This test replicates the layers grep guard, scoped to:
 *   - `src/scene/highlights/**`   (all files under highlights/)
 *   - `src/scene/WarningOverlay.tsx` (the overlay itself)
 *
 * Also confirms neither the overlay nor the highlights files
 * import from `src/scene/layers/**` — a belt-and-suspenders
 * check next to the dep-cruiser `warning-overlay-no-layers`
 * rule and the BLOCK-2q boundary self-test.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIGHLIGHTS_DIR = dirname(fileURLToPath(import.meta.url));
const SCENE_DIR = resolve(HIGHLIGHTS_DIR, '..');
const WARNING_OVERLAY_FILE = join(SCENE_DIR, 'WarningOverlay.tsx');

const EXEMPT_DIRS = new Set(['__testing__', '__selftest__']);

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (EXEMPT_DIRS.has(entry)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    // Skip the grep test file itself.
    if (entry === 'no-geometry-math.test.ts') continue;
    out.push(full);
  }
  return out;
}

// See `src/scene/layers/no-geometry-math.test.ts` for the design
// rationale on why we use THREE narrow regexes rather than one
// clever alternation.
const INFIX_ARITHMETIC_AFTER_COORD =
  /member\.(?:position|size|rotation)\.[xyz]\s*[+\-*/%]/g;

const UNARY_MINUS_BEFORE_COORD =
  /(?:^|[\s([{,;:=?])-\s*member\.(?:position|size|rotation)\.[xyz]\b/g;

const BRACKET_NOTATION_ON_COORD =
  /member\.(?:position|size|rotation)\[/g;

function findGeometryMathOffenses(line: string): string[] {
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

describe('highlights + WarningOverlay — no scene geometry math (S10 finding #3 discipline)', () => {
  const files = [...collectSourceFiles(HIGHLIGHTS_DIR), WARNING_OVERLAY_FILE];

  it('scanned at least one highlights source file + WarningOverlay.tsx', () => {
    // Sanity — guard against a folder rename that leaves the
    // discovery walk pointing at nothing.
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain(WARNING_OVERLAY_FILE);
  });

  for (const file of files) {
    it(`${file.replace(SCENE_DIR, '.')} does not perform inline arithmetic on member.position/size/rotation`, () => {
      const source = readFileSync(file, 'utf-8');
      const matches: string[] = [];
      const lines = source.split('\n');
      lines.forEach((line, i) => {
        const stripped = line.replace(/\/\/.*$/, '').trim();
        if (stripped.startsWith('*') || stripped.startsWith('//')) return;
        const offenses = findGeometryMathOffenses(stripped);
        for (const _ of offenses) {
          matches.push(`  ${i + 1}: ${line.trim()}`);
          break;
        }
      });
      expect(matches, matches.length === 0 ? '' : `\n${matches.join('\n')}`).toEqual([]);
    });
  }

  it('does NOT import from src/scene/layers (S11 boundary rule)', () => {
    // Belt + suspenders alongside the dep-cruiser
    // `warning-overlay-no-layers` rule + BLOCK-2q self-test.
    // Any file under highlights/ or WarningOverlay.tsx that imports
    // from a path under `src/scene/layers/` (via any relative form)
    // flips this test to red.
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      // Match relative imports whose specifier ends in `layers`
      // or `layers/<anything>` — covers `../layers`,
      // `./layers/shared/BoxMember`, etc.
      const importsLayers = /from\s+['"](?:\.\.?\/)+(?:[^'"]*\/)?layers(?:\/[^'"]*)?['"]/.test(
        source,
      );
      expect(importsLayers, `${file}: forbidden import from src/scene/layers/`).toBe(false);
    }
  });
});
