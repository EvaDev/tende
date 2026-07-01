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
import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App';
import './index.css';
import faviconUrl from '@/assets/iMali_icon.png';

// Forward uncaught client errors to the backend Logs feed (tagged source=admin)
installClientErrorReporter('admin');

// Point the favicon at the bundled (content-hashed) logo so it cache-busts whenever
// the logo file changes — no stale icon after swapping src/assets/iMali_icon.png.
(() => {
  const link = (document.querySelector("link[rel~='icon']") as HTMLLinkElement) ?? document.createElement('link');
  link.rel = 'icon'; link.href = faviconUrl;
  document.head.appendChild(link);
})();

// Restore JWT from localStorage so write actions work after a page refresh
restoreToken();

const queryClient = new QueryClient();

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
