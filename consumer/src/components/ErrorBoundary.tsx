import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; error?: Error }

// App-wide boundary so a render error (e.g. an unexpected API shape) shows a
// friendly screen with Try again / Reload instead of a blank page.
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
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-8 gap-5 text-center">
        <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
        <p className="text-white text-sm">The app hit an unexpected error. Try again, or reload.</p>
        <div className="w-full max-w-xs space-y-3">
          <button onClick={this.reset} className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">
            Try again
          </button>
          <button onClick={() => window.location.reload()} className="w-full py-3.5 rounded-2xl border border-white/30 text-white font-semibold active:scale-95">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
