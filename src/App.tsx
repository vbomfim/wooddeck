/**
 * Scaffold placeholder for the wooddeck app shell.
 *
 * This is Story S1 (project scaffold, tooling & CI) — its sole purpose is
 * to prove the Vite + React + TypeScript + Vitest wiring works end-to-end.
 * The r3f `<Canvas>`, layout engine, parameter panel, warning overlay, etc.
 * arrive in later stories (S9 for the scene shell, S13 for the parameter
 * panel). The disclaimer text is rendered from day one because spec US3
 * AC2 requires it to be present for the "duration of the session" and
 * "cannot be dismissed" — no reason to defer that guarantee.
 */
export function App(): React.JSX.Element {
  return (
    <main>
      <h1>Hello wooddeck</h1>
      <p role="note">
        Planning aid, not an engineering document — consult a licensed professional or your local
        building department.
      </p>
    </main>
  );
}
