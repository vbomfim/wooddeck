# Layout golden fixtures

Curated `(DeckDesign → Layout)` fixtures that lock in the S4 layout
engine's numerical output for a diverse set of shapes and options.
Each `*.json` in this directory is loaded by
`../fixtures.test.ts` and asserted **byte-for-byte** against
`computeLayout(design, { now: () => design.createdAt })`.

## Fixture format

```jsonc
{
  "name": "small-4x4",              // human label; matches the file name (stem)
  "description": "…",               // one-line description of the scenario
  "design": { … },                  // a full DeckDesign
  "expected": {                     // the Layout expected from computeLayout
    "designId": "…",
    "computedAt": "…",              // fixed ISO timestamp matches design.createdAt for determinism
    "bounds": { "widthMm": …, "lengthMm": …, "heightMm": … },
    "members": [ … ]
  }
}
```

`design.id` matches `expected.designId`; `expected.computedAt` matches
`design.createdAt` because tests inject `now: () => design.createdAt`
so the timestamp is deterministic (see AC7).

## Coverage matrix

| Fixture                          | Size             | Spacing | Orientation           | Purpose                                |
| -------------------------------- | ---------------- | ------- | --------------------- | -------------------------------------- |
| small-4x4                        | 4 ft × 4 ft      | 406 mm  | perpendicular default | Minimum viable deck (edge case)        |
| small-4x4-parallel               | 4 ft × 4 ft      | 406 mm  | parallel-to-length    | Small deck, decking orientation flip   |
| medium-10x14                     | 10 ft × 14 ft    | 406 mm  | perpendicular         | Typical residential deck               |
| medium-10x14-cedar               | 10 ft × 14 ft    | 406 mm  | perpendicular         | Different species (Cedar) parity check |
| reference-20x30                  | 20 ft × 30 ft    | 406 mm  | perpendicular         | The AC8 benchmark shape                |
| reference-20x30-composite        | 20 ft × 30 ft    | 406 mm  | perpendicular         | Composite decking parity check         |
| exact-multiples                  | 4064 × 6096 mm   | 508 mm  | perpendicular         | Width EXACTLY divisible by spacing     |
| remainder-heavy                  | 3660 × 4880 mm   | 406 mm  | perpendicular         | Both dims leave remainder              |
| large-40x40                      | 40 ft × 40 ft    | 406 mm  | perpendicular         | AC8 upper-bound benchmark shape        |
| large-40x40-wider-spacing        | 40 ft × 40 ft    | 610 mm  | perpendicular         | Wide 24" o.c. spacing                  |
| tall-narrow                      | 4 ft × 20 ft     | 406 mm  | parallel-to-length    | Non-square, narrow                     |
| min-valid-height                 | 10 ft × 10 ft    | 406 mm  | perpendicular         | heightMm == MIN_STRUCTURAL_HEIGHT_MM   |
| extreme-narrow-4x40              | 4 ft × 40 ft     | 406 mm  | perpendicular         | Extreme aspect ratio (narrow)          |
| extreme-wide-40x4                | 40 ft × 4 ft     | 406 mm  | perpendicular         | Extreme aspect ratio (wide)            |

## Regenerating

Fixture JSON files are checked in as goldens. To regenerate after an
INTENTIONAL layout-engine behavior change:

1. Update the layout engine.
2. Regenerate every fixture with the gated Vitest run:

   ```bash
   export PATH="/tmp/node-v22.23.1-darwin-arm64/bin:$PATH"   # Node 22.23.1
   REGENERATE_FIXTURES=1 npx vitest run \
     src/domain/layout/__fixtures__/_regenerate.test.ts
   ```

   The regenerator lives at `_regenerate.test.ts` — it is `describe.runIf`-
   gated on the `REGENERATE_FIXTURES=1` env var, so the default
   `npm test` run leaves it skipped.
3. `git diff src/domain/layout/__fixtures__/*.json` — MANUALLY inspect
   the new geometry to confirm the change is intended. A drift here is
   a regression; do NOT auto-accept without human review.
4. Commit the updated JSON alongside the engine change.
