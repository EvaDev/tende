import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { loadBrandColors, getAppName } from './lib/brand';
import { installClientErrorReporter } from './lib/clientLog';
import { ErrorBoundary } from './components/ErrorBoundary';
import faviconUrl from './assets/iMali_icon.png';

// Forward uncaught client errors to the backend Logs feed (tagged source=consumer)
installClientErrorReporter('consumer');

// Point the favicon at the bundled (content-hashed) logo so it cache-busts whenever
// the logo file changes — no stale icon after swapping src/assets/iMali_icon.png.
(() => {
  const link = (document.querySelector("link[rel~='icon']") as HTMLLinkElement) ?? document.createElement('link');
  link.rel = 'icon'; link.href = faviconUrl;
  document.head.appendChild(link);
})();

// Fetch brand config (colours, app name, ENS domain) from DB before first render
// so there's no flash of empty/wrong values. applyBrandColors() sets :root CSS vars;
// Tailwind utilities read them via rgb(var(--color-*)). getAppName()/getEnsParentDomain()
// are populated here too. Render proceeds even if the fetch fails (CSS fallbacks apply).
loadBrandColors().finally(() => {
  if (getAppName()) document.title = getAppName();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
