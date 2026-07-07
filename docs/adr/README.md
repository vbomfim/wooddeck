# Architecture Decision Records — wooddeck

This folder holds every **Architecture Decision Record (ADR)** for wooddeck. `docs/ARCHITECTURE.md § 7` (Change Control) makes ADRs **mandatory** for any change that touches:

- the layer boundaries (`.dependency-cruiser.cjs`), or
- the pinned 3D-stack versions (`three`, `@react-three/fiber`, `@react-three/drei`), or
- the composition-root topology (which file(s) may compose `ui/` + `scene/`), or
- the framework-ban rules in `src/domain/**` (spec § NFR-010), or
- the CI gate itself (adding/removing a required check, changing the branch-protection contract).

If a PR touches any of the above without an ADR in this folder, the reviewer is expected to block the merge.

---

## Format — MADR 4.0

ADRs use the [MADR 4.0](https://adr.github.io/madr/) template. The template below is intentionally short — an ADR should fit on one screen. Long ADRs signal the decision hasn't been made yet.

**File naming:** `NNNN-short-slug.md`, four-digit zero-padded sequence, kebab-case slug. E.g. `0001-adopt-hexagonal-architecture.md`, `0007-pin-r3f-9-6-1.md`.

**Statuses:** `Proposed` → `Accepted` → (`Deprecated` | `Superseded by ADR-NNNN`). Do NOT delete a rejected or superseded ADR — mark it and move on. History is a feature.

---

## Template

Copy the block below into `NNNN-short-slug.md` and fill it in.

```markdown
# NNNN — <short imperative title>

- Status: Proposed | Accepted | Deprecated | Superseded by [ADR-NNNN](NNNN-...)
- Date: YYYY-MM-DD
- Deciders: @vbomfim (+ any Guardian involved)
- Consulted: (Guardians reviewed, if any)
- Informed: (downstream teams / repos, if any)

## Context and Problem Statement

One or two paragraphs. What forces are at play? What is the concrete question being answered? Link the ticket / issue / spec section.

## Decision Drivers

- Driver 1 (measurable if possible)
- Driver 2
- Driver 3

## Considered Options

1. Option A — one-liner
2. Option B — one-liner
3. Option C — one-liner

## Decision Outcome

**Chosen option:** _Option X_.

Rationale in ≤ 3 sentences. Cite the driver(s) that tipped the decision.

### Positive Consequences

- What this unlocks
- What it makes easier

### Negative Consequences / Trade-offs

- What this costs
- What it makes harder
- What we accept as a known risk

## Pros and Cons of the Options

### Option A
- ✅ …
- ❌ …

### Option B
- ✅ …
- ❌ …

### Option C
- ✅ …
- ❌ …

## Links

- Ticket / Issue: #NN
- Spec section: `specs/…/spec.md § X.Y`
- Related ADRs: [ADR-NNNN](NNNN-...)
```

---

## Index

_(No ADRs recorded yet. The next ADR is `0001`.)_

<!--
When you add an ADR, append a row to this table:

| # | Title | Status | Date |
| - | ----- | ------ | ---- |
| [0001](0001-short-slug.md) | … | Accepted | YYYY-MM-DD |
-->
