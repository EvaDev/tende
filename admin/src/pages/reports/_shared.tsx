import { useEffect, useState, useCallback } from 'react';
import { apiFetch, AuthError } from '@/lib/api';

export { Section, Table, Code } from '@/pages/docs/_shared';

// Small fetch hook for the report endpoints (admin JWT auto-attached by apiFetch).
export function useReport<T>(path: string): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    apiFetch<T>(path)
      .then(d => setData(d))
      .catch((e: unknown) => setError(e instanceof AuthError ? 'Admin sign-in required.' : (e as Error).message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

// Status line shown above each report.
export function ReportState({ loading, error, empty }: { loading: boolean; error: string | null; empty?: boolean }) {
  if (loading) return <p className="text-sm text-gray-400">Loading…</p>;
  if (error)   return <p className="text-sm text-brand-danger">{error}</p>;
  if (empty)   return <p className="text-sm text-gray-500 italic">No data yet.</p>;
  return null;
}

export const shortHash = (h: string | null | undefined) =>
  h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '—';

export const shortAddr = (a: string | null | undefined) =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
