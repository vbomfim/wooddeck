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
