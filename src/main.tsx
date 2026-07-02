import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootEl = document.getElementById('root');
if (!rootEl) {
  // Fail fast — a missing #root means index.html and this entry file have
  // drifted; silently mounting to <body> would hide the bug.
  throw new Error('wooddeck: #root element not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
