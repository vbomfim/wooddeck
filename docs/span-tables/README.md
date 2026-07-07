# Span-table provenance — wooddeck MVP

This document is the source-of-truth for the IRC deck-span data reproduced
in `src/domain/spans/irc-2018-tables.ts`. It exists so any reviewer,
building-code inspector, or contributor swapping in a different edition
(IRC-2024, NBC, etc.) can verify **exactly** which rows we copied, from
which authoritative publication, and under which fair-use posture.

Story S5 (GitHub issue #6, AC5) requires this file.

---

## 1. Authoritative source

**Publication:** _2018 International Residential Code® for One- and
Two-Family Dwellings_, published by the International Code Council
(ICC). This is the code we implement — the `IrcSpanTable.edition`
constant is the exact string `"IRC-2018"`.

**Sections we reproduce data from:**

- **Section R507 — Exterior Decks** (all deck framing prescriptive
  provisions live under R507).
- **Table R507.5** — Deck Beam Span Lengths (`L_B`) for wood beams
  supporting a single span of joists.
- **Table R507.6** — Deck Joist Spans for Common Lumber Species (`L_J`).

The 2018 IRC is available for read-only consultation on the ICC's
public code portal:

- <https://codes.iccsafe.org/content/IRC2018P4/chapter-5-floors#IRC2018P4_Pt03_Ch05_SecR507>

(The URL above lands on R507; the tables are inside that section. The
ICC portal requires no login for read-only access.)

## 2. Free, publicly downloadable mirror we transcribed from

Because the ICC publication itself is copyright-protected, we
transcribed the factual span values from the American Wood Council's
**DCA 6 — Prescriptive Residential Wood Deck Construction Guide**, a
free PDF that AWC produces **specifically to make the IRC deck
provisions easy to consume**. The DCA 6 tables are (per AWC's own
introduction) the IRC R507.5 / R507.6 tables re-published with AWC's
figures and diagrams:

- **AWC DCA 6-2015 (based on the 2015 IRC provisions carried forward
  verbatim to 2018)** —
  <https://awc.org/wp-content/uploads/2022/02/AWC-DCA62015-DeckGuide-1804.pdf>
  - **Page 4 — Table 2 "Maximum Joist Spans and Overhangs"**
    (mirrors IRC Table R507.6). No.2 grade, 40 psf live + 10 psf
    dead load, wet-service conditions, L/360 deflection limit.
  - **Page 6 — Table 3A "Dimension Lumber Deck Beam Spans (L_B)"**
    (mirrors IRC Table R507.5). Same load / grade / service
    assumptions as Table 2; No.2 grade; L/360 simple-span deflection
    limit; single span of joists with or without overhangs.

The 2015-basis values in DCA 6-2015 are unchanged in the 2018 IRC for
the SKU × spacing × species-group combinations the MVP catalog uses.
If a future contributor moves to IRC-2021 or IRC-2024, they MUST
re-transcribe from the corresponding DCA 6 edition (or from the ICC
publication) and update this file.

## 3. Species-group mapping decision

IRC Table R507.6 keys on structural species **groups**, not on the
material-treatment categories (`PT`, `Cedar`, `Composite`) the wooddeck
`DeckDesign` uses. The following mapping is baked into the
module-level `speciesGroupFor(...)` function in
`src/domain/spans/irc-2018-tables.ts` — full rationale is in that
module's header, summarised here for reviewers.

| `Species` (wooddeck) | IRC-2018 R507.6 species-group column                              | Why this mapping                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PT`                 | **Southern Pine**                                                 | Pressure-treated dimension lumber sold in the US is, by market share, **overwhelmingly Southern Yellow Pine** — the treatment industry is concentrated in the Southeast where SYP grows. Choosing SYP gives the DIY user span values consistent with the lumber they will actually buy at Home Depot / Lowe's in most of the country. |
| `Cedar`              | **Redwood, Western Cedars, Ponderosa Pine, Red Pine**             | Cedar in the wooddeck catalog is Western Red Cedar, which sits in the IRC's Redwood / Western Cedars group (the least-strong softwood group in R507.6). This is the ONLY IRC group that includes Western Cedars.                                                                                                                                    |
| `Composite`          | (none — not structurally rated)                                   | Composite (Trex / TimberTech / Fiberon) is a manufactured wood-plastic product used for **decking boards**, not framing. IRC R507 does not tabulate composite framing spans; the manufacturer's own listing (typically an ICC-ES report) governs. `IrcSpanTable` returns the fail-safe (`0 mm` + "not rated" message) for any Composite framing lookup. |

**Why not SPF or DF-L for PT?** SPF (Spruce-Pine-Fir) and DF-L
(Douglas-Fir-Larch) are the West-coast / Canadian PT species. They
give **shorter** allowable spans than SYP (so choosing SYP is the
_less_ conservative pick). The trade-off: SYP matches real-world
Southeast / Midwest / Northeast PT stock (probably ≥ 70% of US
homeowner installs); a homeowner buying "PT" in the Pacific Northwest
will get slightly less span than our tool predicts. The
`SpanTable` interface (S5) makes it trivial to add a regional /
species-selectable table variant in a future story.

## 4. Fair-use posture — what we reproduce, and what we do NOT

**What is copyrighted:** the ICC publication itself — the narrative
text, the figures, the layout, the commentary sections. Reproducing
those verbatim would require an ICC license.

**What we reproduce:** the **factual span values** (e.g. "2×8 Southern
Pine No.2 at 16″ o.c. → max 11'-10"") — numeric measurements that are
the natural, uncopyrightable consequence of applying published
engineering design values (from NDS Supplement) to a standard
load-and-deflection case (40 psf live + 10 psf dead; L/360). These
numbers are the same in every secondary source — the AWC DCA 6,
state building-department deck guides (e.g., Ohio's Ashtabula County
Deck Guide, Pennsylvania's Montgomery Township Deck Guide), homeowner
associations, and every online deck-span calculator. Facts are not
copyrightable under _Feist Publications v. Rural Telephone_ (1991),
and the AWC DCA 6 is explicitly published to distribute these
factual span values to homeowners and contractors.

**What we cite in every warning:** the source-of-truth row —
`"IRC-2018 Table R507.6 — Southern Pine No.2 2×8 @ 16″ o.c."`. This
lets the DIY user verify against their local jurisdiction's adopted
code without ever leaving wooddeck. Coverage of this citation string
is enforced by the golden-test naming rule (SC-005 / AC6).

**If a legal concern is ever raised:** the `SpanTable` interface
makes swapping to a fully-open dataset trivial. Candidate open
alternatives:

- Recompute from the NDS Supplement design values (Section 4.3 of the
  NDS itself is not free, but the derivation is a standard beam
  formula documented in every structural textbook).
- Use the AWC's own DCA 6 tables directly, cited as such.
- Use the Simpson Strong-Tie / Louisiana Pacific published span
  tables that ship with their engineered-lumber products.

## 5. Load / grade / service assumptions

Every value in `irc-2018-tables.ts` assumes the standard IRC deck
prescriptive-design case:

- Grade: **No. 2**
- Live load: **40 psf**
- Dead load: **10 psf**
- Service condition: **wet** (deck exposure)
- Deflection limit: **L / 360** (joists), **L / 360 for simple span** (beams)
- Cantilever: values are for the beam / joist **span between supports**,
  with cantilevers permitted up to L/4 per the IRC's own rules.
- Incising (for DF-L / Hem-Fir / SPF): assumed. Not relevant to the
  MVP mapping since neither PT (→ Southern Pine) nor Cedar (→
  Redwood/Western Cedars) picks up the incising factor.

**Any design that violates these assumptions** (e.g., a hot-tub with a
40 psf point load, snow country with > 40 psf ground snow load, or
Grade #1 lumber the homeowner happens to have picked up on sale) is
_outside_ the scope of these tables. The disclaimer banner (FR-016 /
S12) already communicates "planning aid, not an engineering document"
— the same disclaimer applies here.

## 6. Reproduced row inventory

For traceability, the exact rows the MVP `IrcSpanTable` reproduces are
enumerated in the module header of `src/domain/spans/irc-2018-tables.ts`.
That header is the single source of truth for _which_ rows are in the
table; this document is the source of truth for _where_ the rows came
from.
