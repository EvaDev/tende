import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useReport } from '@/pages/reports/_shared';

export interface SettlementRow {
  id: number;
  merchant_name: string;
  amount: string;
  currency: string;
  destination: string;
  status: string;
  requested_by_name: string | null;
  settlement_type: string;
  approved_at: string | null;
  executed_tx_hash: string | null;
  created_at: string;
  fee_amount: string | null;
  net_amount: string | null;
}

function statusBadge(s: string) {
  const cls = s === 'executed' ? 'bg-green-100 text-green-800'
    : s === 'approved' ? 'bg-blue-100 text-blue-800'
    : s === 'pending' ? 'bg-yellow-100 text-yellow-800'
    : s === 'failed' ? 'bg-red-100 text-red-800'
    : 'bg-gray-100 text-gray-600';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{s}</span>;
}

/** Platform operator queue — approve is merchant-side; Execute is here once approved. */
export default function MerchantSettlementsPanel({ compact = false }: { compact?: boolean }) {
  const { data, loading, error, reload } = useReport<SettlementRow[]>('/api/admin/reports/settlements');
  const [busy, setBusy] = useState<number | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  async function execute(id: number) {
    setBusy(id); setExecError(null);
    try {
      await apiFetch(`/api/admin/settlements/${id}/execute`, { method: 'POST' });
      reload();
    } catch (e: unknown) {
      setExecError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const rows = data ?? [];
  const approved = rows.filter(r => r.status === 'approved' || r.status === 'failed');
  const pending = rows.filter(r => r.status === 'pending');
  const show = compact
    ? [...approved, ...pending].slice(0, 10)
    : rows;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-4">
          <span>Merchant settlements</span>
          {compact && (
            <Link to="/reports/settlements" className="text-xs font-normal text-brand-accent underline">
              Full history →
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <p className="text-sm text-gray-600 mb-4">
        Fiat payout queue. <strong>Pending</strong> requests need head-office approval on the merchant app
        (Settlement → approve). Once <strong>approved</strong>, use <strong>Execute</strong> here to withdraw tokens
        to platform treasury — then pay the merchant&apos;s bank (net of fee) and burn via Treasury supply.
      </p>
      {execError && <p className="text-sm text-brand-danger mb-3">{execError}</p>}
      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-brand-danger">{error}</p>}
      {!loading && !error && show.length === 0 && (
        <p className="text-sm text-gray-400 italic">No open settlement requests.</p>
      )}
      {show.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 uppercase border-b">
              <tr>
                <th className="pb-2 pr-3">Requested</th>
                <th className="pb-2 pr-3">Merchant</th>
                <th className="pb-2 pr-3">Amount</th>
                <th className="pb-2 pr-3">Bank / ref</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {show.map(r => (
                <tr key={r.id}>
                  <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 font-medium">{r.merchant_name}</td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                    {r.amount} {r.currency}
                    {r.net_amount && (
                      <span className="block text-xs text-gray-500">Pay bank {r.net_amount}{r.fee_amount ? ` · fee ${r.fee_amount}` : ''}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs max-w-[12rem] truncate" title={r.destination}>{r.destination}</td>
                  <td className="py-2 pr-3">{statusBadge(r.status)}</td>
                  <td className="py-2 text-right">
                    {r.status === 'approved' || r.status === 'failed' ? (
                      <Button size="sm" disabled={busy === r.id} onClick={() => execute(r.id)}>
                        {busy === r.id ? '…' : r.status === 'failed' ? 'Retry' : 'Execute'}
                      </Button>
                    ) : r.status === 'pending' ? (
                      <span className="text-xs text-gray-400">Merchant approval</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {compact && pending.length > 0 && approved.length === 0 && (
        <p className="text-xs text-gray-500 mt-3">
          {pending.length} request(s) waiting on merchant head-office — nothing for you to execute yet.
        </p>
      )}
    </Card>
  );
}
