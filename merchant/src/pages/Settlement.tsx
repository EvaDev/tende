import { useEffect, useState } from 'react';
import { Send, Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { statusColor } from '@/lib/utils';
import { useMember } from '@/hooks/useMember';

interface SettlementRequest {
  id: number; amount: string; currency: string; destination: string;
  status: string; requested_by: number; approved_by: number | null; created_at: string;
  executed_tx_hash: string | null;
}

export default function Settlement() {
  const { member, isOrgAdmin } = useMember();
  const [requests, setRequests] = useState<SettlementRequest[]>([]);
  const [config, setConfig]     = useState<{ threshold_amount: string; threshold_currency: string | null } | null>(null);
  const [amount, setAmount]     = useState('');
  const [currency, setCurrency] = useState('ZAR');
  const [destination, setDestination] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);

  async function load() {
    try {
      const [r, c] = await Promise.all([
        api.get<SettlementRequest[]>('/api/settlement/requests'),
        api.get<{ threshold_amount: string; threshold_currency: string | null }>('/api/settlement/config'),
      ]);
      setRequests(r); setConfig(c);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/api/settlement/requests', { amount, currency, destination });
      setAmount(''); setDestination('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(id: number, action: 'approve' | 'reject') {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/settlement/requests/${id}/${action}`, {});
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-accent mb-1">Settlement</h1>
      <p className="text-gray-600 mb-1">Request a payout of your business funds.</p>
      {config && (
        <p className="text-xs text-gray-400 mb-6">
          Requests above {config.threshold_amount} {config.threshold_currency ?? ''} need a second head-office approval.
        </p>
      )}

      {error && <p className="text-sm text-brand-danger mb-4">{error}</p>}

      <form onSubmit={handleRequest} className="bg-brand-card rounded-xl p-5 shadow-sm space-y-3 mb-6">
        <h3 className="font-semibold text-brand-accent flex items-center gap-2"><Send size={16} /> New request</h3>
        <div className="grid grid-cols-3 gap-3">
          <input
            type="number" step="0.01" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm" required
          />
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="ZAR">ZAR</option>
            <option value="USD">USD</option>
          </select>
          <input
            type="text" placeholder="0x… recipient" value={destination} onChange={e => setDestination(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm col-span-3 sm:col-span-1" required
          />
        </div>
        <p className="text-xs text-gray-400">
          No bank off-ramp is wired up yet — destination must be an on-chain address for now.
        </p>
        <button
          type="submit" disabled={busy}
          className="bg-brand-accent text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Request payout'}
        </button>
      </form>

      <table className="w-full text-sm bg-brand-card rounded-xl shadow-sm overflow-hidden">
        <thead className="bg-brand-accent/5 text-brand-accent text-left">
          <tr>
            <th className="px-4 py-2">Amount</th>
            <th className="px-4 py-2">Destination</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2">{r.amount} {r.currency}</td>
              <td className="px-4 py-2 font-mono text-xs">{r.destination.slice(0, 8)}…{r.destination.slice(-6)}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.status)}`}>{r.status}</span>
              </td>
              <td className="px-4 py-2">
                {r.status === 'pending' && isOrgAdmin && r.requested_by !== member?.memberId && (
                  <div className="flex gap-2">
                    <button onClick={() => act(r.id, 'approve')} className="text-brand-accent hover:opacity-70" title="Approve">
                      <Check size={16} />
                    </button>
                    <button onClick={() => act(r.id, 'reject')} className="text-brand-danger hover:opacity-70" title="Reject">
                      <X size={16} />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {requests.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No settlement requests yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
