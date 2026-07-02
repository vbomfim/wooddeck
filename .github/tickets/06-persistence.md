# [S6] Persistence — `.deck` v1 file format + JSON Schema + localStorage + file I/O

**Parent Spec:** `specs/mvp-deck-designer/spec.md`
**Branch:** `story/6-file-format-persistence` (off `feat/mvp-deck-designer`)
**Depends on:** S1, S3

## 1. User Story

As **a DIY homeowner (and, by proxy, the application/state layer that serves them)**,
I want **my design autosaved to browser local storage, and downloadable / uploadable as a `.deck` JSON file with a versioned envelope and JSON Schema validation**,
so that **I don't lose my work, I can back it up, and future format changes won't silently corrupt my files**.

**Success metrics:** SC-006 (`.deck` file round-trip byte-for-byte identical). Local storage restore after tab reload. Loader rejects files with unknown `schema` version with a clear error. JSON Schema at `docs/deck-file-schema-v1.json` validates every generated file.

## 2. Component Design (Rewritable by Design)

### Component Map

| Component | Responsibility (single) | New or Existing |
|---|---|---|
| `src/persistence/deck-file/schema-v1.ts` | Envelope + serialization for `.deck` v1 files | New |
| `src/persistence/deck-file/validator.ts` | Ajv-based JSON Schema validator | New |
| `src/persistence/local-storage.ts` | Save/load current design to `localStorage` (debounced) | New |
| `src/persistence/file-io.ts` | Trigger browser download + read uploaded `File` | New |
| `src/persistence/index.ts` | Barrel export of the persistence public API | New |
| `docs/deck-file-schema-v1.json` | JSON Schema for the v1 envelope | New |
| `src/persistence/**/*.test.ts` | Round-trip + validation + version-switch tests | New |

**Boundary:** All I/O and format concerns live here. `domain/` MUST NOT import from `persistence/` (Code Review Guardian finding #2 — `serialization.ts` was moved into `persistence/`).
**File structure:** `src/persistence/` + `docs/deck-file-schema-v1.json`.

**Interface Contract:**

```ts
import type { DeckDesign } from "../domain/model";

// -------- .deck file envelope --------
export interface DeckFileV1 {
  schema: 1;
  generator: "wooddeck";
  generatorVersion: string;   // semver — read from package.json at build time
  createdAt: string;          // ISO-8601
  design: DeckDesign;
}

export type DeckFile = DeckFileV1; // union grows when schema v2 lands

// -------- Serialization --------
export function serialize(design: DeckDesign, opts?: { generatorVersion?: string }): string;
export function deserialize(json: string): { design: DeckDesign; meta: { schema: number; generator: string; generatorVersion: string; createdAt: string } };

// -------- Local storage adapter --------
export const STORAGE_KEY = "wooddeck:current-design:v1";
export function saveDesignToLocalStorage(design: DeckDesign): void;               // synchronous; safe to call from debounced handler
export function loadDesignFromLocalStorage(): DeckDesign | null;                  // null if absent or invalid
export function clearDesignFromLocalStorage(): void;

// -------- File download / upload --------
export function downloadDeckFile(design: DeckDesign, opts?: { filename?: string }): void;   // triggers browser download
export async function readDeckFile(file: File): Promise<DeckDesign>;                        // parses + validates; throws DeckFileError on invalid

// -------- Errors --------
export class DeckFileError extends Error {
  constructor(public code: "unknown-schema" | "invalid-json" | "schema-validation-failed" | "storage-full" | "storage-blocked", message: string, public cause?: unknown);
}
```

**Input contract:** `DeckDesign` from domain, or raw JSON strings from user files.
**Output contract:** JSON strings, `DeckDesign` values, or `DeckFileError`.
**Error contract:** every failure path throws a `DeckFileError` with a specific `code`.

**Dependencies:**
- Depends on: `domain/model.ts` (S3), `ajv` (npm), `package.json` version at build time (via Vite `define`).
- Consumed by: `application/*` (S7), UI export/import (S14).
- Rule: `persistence/` MUST NOT import from `state/`, `scene/`, `ui/`, or `application/`.

**Rewritability check:**
- [x] Rewritable from interface + JSON Schema + tests.
- [x] Consumers survive rewrite as long as `serialize/deserialize/downloadDeckFile/readDeckFile/localStorage helpers` signatures are preserved.
- [x] Storage key + schema version are frozen after first release.

## 3. Audience & Personas
- Primary: DIY homeowner (indirectly, via S14 UI).
- Secondary: any future contributor adding a `.deck` v2.

## 4. Functional Requirements

### Acceptance Criteria

**AC1: Round-trip identity**
- Given any `DeckDesign` `D`,
- When `deserialize(serialize(D)).design` is compared to `D`,
- Then they are deep-equal.
- Additionally, `serialize(deserialize(serialize(D)).design) === serialize(D)` (byte-for-byte).

**AC2: Envelope contents**
- Given `serialize(D)` output,
- Then parsing it produces `{ schema: 1, generator: "wooddeck", generatorVersion: <matches package.json>, createdAt: <iso>, design: D }`.

**AC3: Unknown schema rejected**
- Given a JSON string with `{"schema": 999, "design": {...}}`,
- When `deserialize` is called,
- Then it throws `DeckFileError` with `code: "unknown-schema"` and a message including `999`.

**AC4: JSON Schema validation on load**
- Given a file with `schema: 1` but a missing required field (e.g., no `design.footprint`),
- When `deserialize` is called,
- Then it throws `DeckFileError` with `code: "schema-validation-failed"` and message identifying the missing field.

**AC5: JSON Schema file exists**
- Given the repo,
- Then `docs/deck-file-schema-v1.json` is a valid JSON Schema Draft-2020-12 document.
- The Ajv validator is instantiated from this file (checked-in schema, not hand-coded).

**AC6: Corrupt JSON rejected**
- Given `deserialize("not json {")`,
- Then throws `DeckFileError` with `code: "invalid-json"`.

**AC7: LocalStorage save + load**
- Given a design saved via `saveDesignToLocalStorage(D)`,
- When `loadDesignFromLocalStorage()` is subsequently called (same page or a new page reload),
- Then it returns a design deep-equal to `D`.

**AC8: LocalStorage full / blocked**
- Given `saveDesignToLocalStorage(D)` and a mocked `localStorage.setItem` that throws `QuotaExceededError`,
- Then the function throws `DeckFileError` with `code: "storage-full"` — caller decides UX (S8 will handle by disabling autosave + surfacing a banner).

**AC9: Download filename**
- Given `downloadDeckFile(D)`,
- Then the triggered download's filename matches `/^wooddeck-\d{8}T\d{6}\.deck\.json$/`.

**AC10: Upload happy path**
- Given a `File` containing a valid `.deck` v1 JSON,
- When `readDeckFile(file)` is called,
- Then it resolves to a `DeckDesign` deep-equal to the source.

### Edge Cases
- LocalStorage disabled (private browsing on some browsers) → `saveDesignToLocalStorage` throws `code: "storage-blocked"`.
- File > 10 MB → still handled (no artificial limit for MVP), but `readDeckFile` should reject `File`s with `.size > 10 * 1024 * 1024` with a `DeckFileError` to prevent DoS.
- Filename with special chars → download filename is always generated (never derived from user input), so this is not a vector.

### User Flows
- Autosave: state store subscribes to `DeckDesign` changes; debounced 500 ms; calls `saveDesignToLocalStorage`.
- Explicit download: user clicks "Download .deck" → `downloadDeckFile(current)`.
- Explicit upload: user clicks "Open…" → file picker → `readDeckFile(file)` → replace store state.

## 5. Reliability [Azure WAF]
- Failure modes: storage full, storage blocked, corrupt file — all surfaced as `DeckFileError`.
- Recovery: on load failure, app starts with an empty default design; a banner (S12) can notify the user.

## 6. Security [Azure WAF]
- **Input validation:** JSON parse + JSON Schema validation. Ajv rejects any file that doesn't match the schema. No `eval`. No prototype pollution (Ajv option `useDefaults: false` for load; validate as-received).
- **Data sensitivity:** design contains only geometry — no PII, no secrets.
- **File size limit:** 10 MB cap (see edge case).
- **Filename:** always generated; never taken from user input.
- **XSS surface:** files could contain arbitrary JSON — but the design is only ever passed to typed domain code (not `innerHTML`), so no XSS vector.

## 7. Cost Optimization [Azure WAF]
- N/A.

## 8. Operational Excellence [Azure WAF]
- N/A (no server).

## 9. Performance Efficiency [Azure WAF]
- `serialize` / `deserialize` complete in ≤ 20 ms for a design with ≤ 100 members.
- `saveDesignToLocalStorage` completes in ≤ 5 ms.

## 10. Accessibility [WCAG 2.2]
- N/A — no UI (the download/upload UI lives in S14, which owns the accessibility of file pickers).

## 11. API & Data Contracts

### `.deck` v1 envelope (frozen after first release)

```json
{
  "schema": 1,
  "generator": "wooddeck",
  "generatorVersion": "0.1.0",
  "createdAt": "2026-07-02T18:30:00.000Z",
  "design": { "...": "DeckDesign shape" }
}
```

### `docs/deck-file-schema-v1.json` — JSON Schema Draft-2020-12

Must declare all required fields; MUST NOT declare `additionalProperties: false` at the envelope level (allow forward-compat additive metadata); MUST declare `additionalProperties: false` inside `design` (strict).

## 12. Data Model & Storage
- **localStorage key:** `wooddeck:current-design:v1` (frozen; a new key namespace ships if the on-disk shape ever changes).
- **File format:** `.deck.json` (double-extension so OSes treat it as JSON).
- No cookies, no IndexedDB, no ServiceWorker in MVP.

## 13. Deployment & Infrastructure
- N/A — client-side.

## 14. Observability [Google SRE]
- N/A. (Errors surface via `DeckFileError` for the UI to display.)

## 15. Dependencies & Risks
- **Third-party:** `ajv`, `ajv-formats` (for ISO-8601 date-time validation). Both are widely used, MIT-licensed, no known CVEs at spec time.
- **Risks:**
  - `.deck` v1 shape gets calcified before it's really ready → mitigated by comprehensive schema + JSON Schema in docs + tests exercising every field.
  - Ajv bundle size (~50 KB) → acceptable; runs client-side.
  - Browsers with unusual quota policies → `AC8` guards; UX (S8 + S12) handles the fallback.

## 16. Out of Scope
- `.deck` v2 or migrations (deferred; the version-switch scaffold is in place).
- Cloud sync / share links.
- IndexedDB or larger persistence.
- Auto-backup rotation.
- Compression / encryption of `.deck` files.

## 17. Open Questions & Trade-offs

### Open Questions
- [ ] Should `DeckFileError code: "storage-full"` prompt a UI download-and-save-locally suggestion? — Deferred to S14's UX design.

### Trade-off Decisions

| Trade-off | Option A | Option B | Decision | Rationale |
|---|---|---|---|---|
| Full envelope (generator, version, createdAt, JSON Schema, `switch(schema)`) | Ceremony-heavy | Minimal `{ design: ... }` | **Full envelope** | Code Review Guardian finding #8 — cheapest at day one, painful to add later. |
| Ajv (runtime validation) vs. hand-rolled type guard | Extra dep | Zero dep | **Ajv** | JSON Schema doubles as machine-readable documentation; validation errors are informative; small bundle. |
| `additionalProperties: false` inside `design` | Strict | Lenient | **Strict** | Prevents silent field drops on load; consistent with "reject unknown, don't guess." |

## 18. Testing Strategy
- **Unit tests:** all ACs above.
- **Property tests:** AC1 round-trip using a `fast-check` `DeckDesign` generator (reuse the one from S3 tests).
- **Fixture tests:** parse the committed JSON Schema and validate a golden `.deck.json` fixture.
- **Integration:** N/A at this layer (S7 covers the app-level integration).

### Guardian Review Plan
| Guardian | Why | When |
|---|---|---|
| Security Guardian | Loader parses untrusted user input — verify schema-validation + no XSS + size cap | PR review |
| Code Review Guardian | Verify `serialization` lives in `persistence/` (finding #2) and boundary lint enforces it | PR review |
