import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { loadBrandColors } from './lib/brand';
import { installClientErrorReporter } from './lib/clientLog';
import { ErrorBoundary } from './components/ErrorBoundary';

// Forward uncaught client errors to the backend Logs feed (tagged source=consumer)
installClientErrorReporter('consumer');

// Fetch brand config (name, logo, colours) from DB before first render.
loadBrandColors().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
