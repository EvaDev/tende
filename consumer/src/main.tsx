import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { loadBrandColors, getAppName } from './lib/brand';

// Fetch brand config (colours, app name, ENS domain) from DB before first render
// so there's no flash of empty/wrong values. applyBrandColors() sets :root CSS vars;
// Tailwind utilities read them via rgb(var(--color-*)). getAppName()/getEnsParentDomain()
// are populated here too. Render proceeds even if the fetch fails (CSS fallbacks apply).
loadBrandColors().finally(() => {
  if (getAppName()) document.title = getAppName();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
