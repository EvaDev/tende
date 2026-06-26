import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; error?: Error }

// Top-level boundary so a render crash (e.g. RainbowKit's WalletConnect QR
// throwing "invalid border=0") shows a friendly message instead of a blank
// screen / console stack trace. "Try again" remounts the tree (closing the
// offending modal); "Reload" does a hard refresh.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // console.error is forwarded to the backend Logs feed by installClientErrorReporter.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: undefined });

  render() {
    if (!this.state.hasError) return this.props.children;

    const msg = this.state.error?.message ?? 'Unknown error';
    const looksLikeWalletConnect = /border=0|encodeQR|qr|walletconnect/i.test(msg);

    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-6 space-y-4">
          <h1 className="text-xl font-bold text-brand-accent">Something went wrong</h1>
          <p className="text-sm text-gray-600">
            The app hit an unexpected error and stopped rendering this view.
          </p>
          {looksLikeWalletConnect && (
            <div className="rounded-lg bg-brand-accent/5 border border-brand-accent/20 p-3 text-sm text-gray-700">
              This looks like a <strong>wallet-connection</strong> error (the WalletConnect QR code
              failed to render). Try connecting with a <strong>browser-extension wallet</strong> such
              as MetaMask instead — it doesn’t use a QR code. Viewing data (e.g. the Treasury page)
              doesn’t require connecting at all.
            </div>
          )}
          <pre className="text-xs text-gray-400 whitespace-pre-wrap break-words max-h-32 overflow-auto">{msg}</pre>
          <div className="flex gap-3">
            <button
              onClick={this.reset}
              className="flex-1 py-2.5 rounded-xl bg-brand-accent text-white font-semibold text-sm active:scale-95"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-2.5 rounded-xl border border-brand-accent/30 text-brand-accent font-semibold text-sm active:scale-95"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
