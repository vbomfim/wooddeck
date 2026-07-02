/**
 * `src/domain/id.ts` — canonical identifier generator for `DeckDesign`.
 *
 * ## Why this module exists (and why it is separate from model.ts)
 *
 * Per ticket S3 §2, `model.ts` MUST hold ONLY anemic type definitions:
 * no runtime code, no side effects, no globals. Yet the ticket also
 * requires `DeckDesign.id` to be a UUID. Putting the generator directly
 * in `model.ts` would break that invariant — hence this dedicated
 * one-function module.
 *
 * ## Implementation choice — `crypto.randomUUID()` over an npm dep
 *
 * We use `globalThis.crypto.randomUUID()` (Web Crypto API, present as a
 * global in every browser since 2022 and in Node ≥ 19.0.0 — the project
 * requires Node ≥ 22.13 per `package.json#engines`, so support is
 * guaranteed). Rationale:
 *
 *   - Zero new dependency footprint — the domain layer stays leaf-only.
 *   - `crypto` is NOT in `BROWSER_ONLY_GLOBALS` (see
 *     `eslint.config.js`) so the `src/domain/**` globals ban does not
 *     fire on it. It is also not in the framework ban list in
 *     `.dependency-cruiser.cjs`.
 *   - RFC 4122 v4 UUIDs are cryptographically random — a strong
 *     collision guarantee for a persisted-design identifier.
 *
 * ## Testability
 *
 * `crypto.randomUUID()` is non-deterministic. Consumers that need
 * deterministic ids (fixtures, tests) MUST accept `id` as an injected
 * value and only call `makeDeckDesignId()` at the composition edge
 * (use-case layer, S7). No test in this module asserts a specific
 * UUID — only shape (RFC-4122 v4) and non-repetition across two
 * consecutive calls.
 */

/**
 * Strict RFC 4122 v4 pattern — 8-4-4-4-12 hex, version-4 digit fixed,
 * variant field within `[8, 9, a, b]`. Exported so tests can validate
 * the format without duplicating the regex.
 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Return a fresh RFC 4122 v4 UUID suitable for `DeckDesign.id`.
 *
 * @throws {Error} If the runtime does not expose `crypto.randomUUID`.
 *         This should be unreachable on the supported Node/browser
 *         matrix but the guard makes the failure mode explicit rather
 *         than a cryptic `undefined is not a function`.
 */
export function makeDeckDesignId(): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!cryptoLike || typeof cryptoLike.randomUUID !== 'function') {
    throw new Error(
      'makeDeckDesignId: globalThis.crypto.randomUUID is not available. ' +
        'wooddeck requires Node ≥ 22.13 or a modern browser.',
    );
  }
  return cryptoLike.randomUUID();
}
