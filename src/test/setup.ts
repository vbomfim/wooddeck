import '@testing-library/jest-dom/vitest';

// React 18+ test-environment flag. Tells React that the current
// runtime is a testing environment where component updates SHOULD
// be wrapped in `act(...)`. Without this global, React logs
// "The current testing environment is not configured to support
// act(...)" every time a Zustand store subscription fires a
// synchronous React update outside an explicit act boundary
// (see @react-three/test-renderer + Zustand interaction —
// discovered during S10 layer-visibility tests). Setting the
// flag globally silences the warning and matches Testing Library's
// own behaviour (RTL sets it internally).
//
// See https://react.dev/reference/react/act for the flag docs.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
