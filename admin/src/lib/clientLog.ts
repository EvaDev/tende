// Lightweight client-side error reporter. Forwards uncaught errors and unhandled
// promise rejections to the backend so they surface in the admin Logs feed
// (POST /api/client-log), tagged by `source`. Fire-and-forget, capped and deduped —
// it never throws and never loops on its own network failures.

const MAX_REPORTS = 30;   // per page session, to avoid flooding the log buffer
let sent = 0;
let lastMsg = '';

function post(source: string, level: string, message: string): void {
  const msg = message.slice(0, 1000);
  if (!msg || msg === lastMsg || sent >= MAX_REPORTS) return;
  lastMsg = msg;
  sent += 1;
  try {
    void fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, level, message: msg }),
      keepalive: true, // still delivers if the page is unloading
    }).catch(() => { /* swallow — reporting must never cascade */ });
  } catch { /* never let reporting throw */ }
}

export function installClientErrorReporter(source: 'admin' | 'consumer'): void {
  window.addEventListener('error', (e) => {
    const detail = e.error?.stack || e.message || String(e.error ?? 'unknown error');
    const loc = e.filename ? ` (${e.filename}:${e.lineno ?? 0})` : '';
    post(source, 'error', `${detail}${loc}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { stack?: string; message?: string } | undefined;
    post(source, 'error', `unhandledrejection: ${r?.stack || r?.message || String(r)}`);
  });
}
