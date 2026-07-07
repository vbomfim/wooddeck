/**
 * Unit tests for `src/scene/lighting.tsx`.
 *
 * ## Why @react-three/test-renderer (not RTL)
 *
 * `<SceneLighting/>` returns three.js scene primitives (`<ambientLight>`,
 * `<directionalLight>`) that live INSIDE an r3f `<Canvas>` context —
 * they cannot render standalone through React Testing Library because
 * r3f's reconciler is required to translate the JSX into three.js
 * objects. `@react-three/test-renderer` provides that reconciler in a
 * headless mode (no real WebGL context, no jsdom canvas hacks) so we
 * can assert the SCENE GRAPH STRUCTURE — the same shape a real Canvas
 * would produce, just without pixels.
 *
 * ## What we assert (per ticket §9)
 *
 *   - Exactly one ambient light present.
 *   - Exactly one directional light present.
 *   - Shadows OFF by default (FPS budget guard — NFR-003 requires 30
 *     FPS on M1 MacBook Air with the full deck; enabling soft shadows
 *     drops us below that on lower-tier hardware, so shadows stay off
 *     for MVP).
 *
 * Colour / intensity / directional angle are style choices left to
 * pixel-diff QA in Playwright E2E (later). We just guard the
 * structural invariants.
 */
import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';

import { SceneLighting } from './lighting';

describe('<SceneLighting />', () => {
  it('mounts exactly one <ambientLight> (baseline diffuse fill)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<SceneLighting />);
    const ambient = renderer.scene.findAllByType('AmbientLight');
    expect(ambient).toHaveLength(1);
    await renderer.unmount();
  });

  it('mounts exactly one <directionalLight> (single key light)', async () => {
    const renderer = await ReactThreeTestRenderer.create(<SceneLighting />);
    const directional = renderer.scene.findAllByType('DirectionalLight');
    expect(directional).toHaveLength(1);
    await renderer.unmount();
  });

  it('directional light has castShadow disabled (§9 FPS budget)', async () => {
    // Enabling soft shadows on a WebGL 2 baseline pushes an M1 MacBook
    // Air below the 30 FPS NFR-003 target for a 20×30 ft deck with
    // every layer visible (measured during S9 spike; documented in
    // ticket §9). Shadows can flip to `true` post-MVP behind a
    // user-facing "quality" toggle.
    const renderer = await ReactThreeTestRenderer.create(<SceneLighting />);
    const directionals = renderer.scene.findAllByType('DirectionalLight');
    // The `mounts exactly one <directionalLight>` test above already
    // proves there is exactly one — narrow the type here so the
    // `.instance` access is safe under noUncheckedIndexedAccess.
    expect(directionals).toHaveLength(1);
    const directional = directionals[0]!;
    expect(directional.instance.castShadow).toBe(false);
    await renderer.unmount();
  });

  it('emits exactly TWO lights total — no accidental extra fill lights', async () => {
    // Regression guard: a future addition (env map, hemisphere fill)
    // must go through a review pass, not silently increase the light
    // count. If you're editing this test, update the ticket §9 too.
    const renderer = await ReactThreeTestRenderer.create(<SceneLighting />);
    const allLights = [
      ...renderer.scene.findAllByType('AmbientLight'),
      ...renderer.scene.findAllByType('DirectionalLight'),
      ...renderer.scene.findAllByType('PointLight'),
      ...renderer.scene.findAllByType('SpotLight'),
      ...renderer.scene.findAllByType('HemisphereLight'),
    ];
    expect(allLights).toHaveLength(2);
    await renderer.unmount();
  });
});
