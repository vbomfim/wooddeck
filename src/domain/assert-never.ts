/**
 * `assertNever` — exhaustive-switch guard.
 *
 * Introduced in S26 FIX #7 (review-gate hardening) so the two
 * `floatingFraming` dispatches (`floating-layout.ts` +
 * `y-stack-floating.ts`) can be written as exhaustive switches
 * that fail **both** at compile time (TypeScript rejects the call
 * when `x` is not `never`) AND at runtime (a future enum-widening
 * that bypasses the compile check — `as` casts, JSON parsing —
 * throws instead of silently falling into one branch).
 *
 * @param x - The value that TypeScript's exhaustiveness check
 *   proves is `never` in the reachable branch. Runtime call means
 *   the union widened at runtime (bad cast, corrupt persisted
 *   data, etc.) — throw so it's loud.
 * @param context - Optional hint appended to the error message
 *   naming the discriminator so debugging is faster.
 * @throws Error with the unexpected value stringified.
 */
export function assertNever(x: never, context?: string): never {
  throw new Error(
    context !== undefined
      ? `Unreachable — unexpected value in ${context}: ${String(x)}`
      : `Unreachable — unexpected value: ${String(x)}`,
  );
}
