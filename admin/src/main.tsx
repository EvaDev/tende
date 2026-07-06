import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

import { wagmiConfig } from '@/lib/wagmi';
import { restoreToken } from '@/lib/auth';
import { installClientErrorReporter } from '@/lib/clientLog';
import { refreshAppConfig } from '@/hooks/useAppConfig';
import { APP_DEFAULTS } from '@/config/app';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App';
import './index.css';

// Forward uncaught client errors to the backend Logs feed (tagged source=admin)
installClientErrorReporter('admin');

// Restore JWT from localStorage so write actions work after a page refresh
restoreToken();

const queryClient = new QueryClient();

// Load branding from DB before first paint so sidebar name/logo match Settings.
refreshAppConfig().then(cfg => {
  const name = cfg['app.name'] ?? APP_DEFAULTS.name;
  if (name) document.title = `${name} Admin`;
}).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider theme={darkTheme({ accentColor: '#5C2D1E' })}>
              <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <App />
              </BrowserRouter>
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
