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
| height-zero                      | 10 ft × 10 ft    | 406 mm  | perpendicular         | Height = 0 edge case                   |

## Regenerating

Fixture JSON files are checked in as goldens. To regenerate after an
INTENTIONAL layout-engine behavior change:

1. Update the layout engine.
2. Run `node scripts/regenerate-layout-fixtures.mjs` (S4-post-MVP; for
   now, temporarily add a `it.only` that logs the output and paste it
   back into the fixture, then remove the log).
3. Manually inspect the new geometry to confirm the change is intended.
4. Commit the updated JSON alongside the engine change.

An accidental fixture drift is a REGRESSION — do NOT auto-accept
without human review.
