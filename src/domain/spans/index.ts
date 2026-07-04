/**
 * `src/domain/spans/index.ts` — the spans package's public facade.
 *
 * Consumers (`application/`, `state/`, `scene/`) import from this
 * file, not from the individual sub-modules. Keeping the internal
 * file split (`span-table` / `irc-2018-tables` / `span-check`) a
 * private implementation detail lets a future refactor merge or
 * split them without breaking callers.
 *
 * ## Exports
 *
 *   - `SpanTable` — the abstraction seam (interface). Consumers
 *     depend on this type; injecting an alternative implementation
 *     (mock, IRC-2024, NBC) requires no downstream changes.
 *   - `IrcSpanTable` — the MVP concrete implementation, sourced
 *     from the AWC DCA-6-2015 tables that mirror IRC-2018 R507.5 /
 *     R507.6. Instantiated by the application layer once at
 *     startup and passed to `spanCheck` on every re-check.
 *   - `spanCheck` — the pure function that consumes a `Layout` and
 *     a `SpanTable`, producing zero or more `Warning`s.
 */

export type { SpanTable } from './span-table';
export { IrcSpanTable } from './irc-2018-tables';
export { spanCheck } from './span-check';

// ---- S16 issue #38 — remediation compute + option types ----------------
//
// `computeRemediations` and its option/patch shape are consumed by
// the state layer (`state/design-store.applyRemediation` +
// `state/hooks.useRemediationsForWarning`). The ui layer is BLOCKED
// from importing `src/domain/spans/**` (see `.dependency-cruiser.cjs`
// `ui-no-domain-spans` rule + BLOCK-2w probe) — the compute is
// reachable only through the store hook. The TYPES ARE STILL
// NEEDED by the UI, which imports them via a re-export on the
// state barrel (`src/state/index.ts`).
export { computeRemediations } from './remediations';
export type {
  RemediationKind,
  RemediationOption,
  RemediationPatch,
} from './remediations';
