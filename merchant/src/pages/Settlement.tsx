import { useEffect, useState } from 'react';
import { Send, Check, X, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { statusColor } from '@/lib/utils';
import { useMember } from '@/hooks/useMember';

interface SettlementRequest {
  id: number; amount: string; currency: string; destination: string;
  status: string; requested_by: number; approved_by: number | null; created_at: string;
  executed_tx_hash: string | null;
  fee_bps: number | null; fee_amount: string | null; net_amount: string | null;
}

interface BalanceInfo {
  currency: string;
  vaultBalance: string;
  pendingSettlement: string;
  available: string;
  settlementType: string;
  bankPayout: string | null;
}

export default function Settlement() {
  const { isOrgAdmin } = useMember();
  const [requests, setRequests] = useState<SettlementRequest[]>([]);
  const [balance, setBalance]   = useState<BalanceInfo | null>(null);
  const [config, setConfig]     = useState<{ threshold_amount: string; threshold_currency: string | null; settlementFeeBps?: number } | null>(null);
  const [amount, setAmount]     = useState('');
  const [currency, setCurrency] = useState('ZAR');
  const [bankReference, setBankReference] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);

  const isFiat = balance?.settlementType !== 'ONCHAIN';

  async function load() {
    try {
      const [r, c, b] = await Promise.all([
        api.get<SettlementRequest[]>('/api/settlement/requests'),
        api.get<{ threshold_amount: string; threshold_currency: string | null; settlementFeeBps?: number }>('/api/settlement/config'),
        api.get<BalanceInfo>('/api/settlement/balance'),
      ]);
      setRequests(r); setConfig(c); setBalance(b);
      if (b.currency) setCurrency(b.currency);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const body = isFiat
        ? { amount, currency, bankReference: bankReference || undefined }
        : { amount, currency, destination };
      await api.post('/api/settlement/requests', body);
      setAmount(''); setBankReference(''); setDestination('');
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

  const feePreview = (() => {
    const bps = config?.settlementFeeBps ?? 0;
    const gross = Number(amount);
    if (!bps || !gross || gross <= 0) return null;
    const fee = Math.round(gross * bps) / 10_000;
    const net = Math.round((gross - fee) * 100) / 100;
    return { fee, net, bps };
  })();

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-white mb-1">Settlement</h1>
      <p className="text-white/80 mb-1">
        {isFiat
          ? 'Request a fiat payout from the platform operator. Tokens move to platform custody and are burned once your bank is paid.'
          : 'Request an on-chain payout of your business funds.'}
      </p>
      {!isOrgAdmin && config && (
        <p className="text-xs text-white/70 mb-6">
          Cashier requests need head-office approval before the platform can pay out.
        </p>
      )}

      {balance && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-brand-card rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 flex items-center gap-1"><Wallet size={12} /> Vault balance</p>
            <p className="text-xl font-bold text-brand-accent tabular-nums">{balance.vaultBalance} {balance.currency}</p>
          </div>
          <div className="bg-brand-card rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-500">Pending settlement</p>
            <p className="text-xl font-bold tabular-nums">{balance.pendingSettlement} {balance.currency}</p>
          </div>
          <div className="bg-brand-card rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-500">Available to settle</p>
            <p className="text-xl font-bold text-brand-accent tabular-nums">{balance.available} {balance.currency}</p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-brand-danger mb-4">{error}</p>}

      <form onSubmit={handleRequest} className="bg-brand-card rounded-xl p-5 shadow-sm space-y-3 mb-6">
        <h3 className="font-semibold text-brand-accent flex items-center gap-2"><Send size={16} /> New request</h3>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number" step="0.01" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm" required
          />
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="ZAR">ZAR</option>
            <option value="USD">USD</option>
          </select>
        </div>
        {isFiat ? (
          <>
            {balance?.bankPayout && (
              <p className="text-sm text-gray-600">Payout account: <strong>{balance.bankPayout}</strong></p>
            )}
            <input
              type="text" placeholder="Bank reference (optional)" value={bankReference}
              onChange={e => setBankReference(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm w-full"
            />
            <p className="text-xs text-gray-400">
              The platform operator will pay your registered bank account and withdraw the equivalent tokens from your vault.
            </p>
            {feePreview && (
              <p className="text-sm text-gray-600">
                Platform fee ({feePreview.bps / 100}%): <strong>{feePreview.fee.toFixed(2)} {currency}</strong>
                {' · '}Bank payout: <strong>{feePreview.net.toFixed(2)} {currency}</strong>
              </p>
            )}
          </>
        ) : (
          <>
            <input
              type="text" placeholder="0x… recipient" value={destination} onChange={e => setDestination(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm w-full" required
            />
            <p className="text-xs text-gray-400">On-chain settlement — tokens sent directly to this address.</p>
          </>
        )}
        <button
          type="submit" disabled={busy}
          className="bg-brand-accent text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Submitting…' : isFiat ? 'Request fiat settlement' : 'Request payout'}
        </button>
      </form>

      <table className="w-full text-sm bg-brand-card rounded-xl shadow-sm overflow-hidden">
        <thead className="bg-brand-accent/5 text-brand-accent text-left">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Amount</th>
            <th className="px-4 py-2">{isFiat ? 'Bank / ref' : 'Destination'}</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2 text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</td>
              <td className="px-4 py-2 tabular-nums">
                {r.amount} {r.currency}
                {r.fee_amount && (
                  <span className="block text-xs text-gray-500">Fee {r.fee_amount} · Net {r.net_amount}</span>
                )}
              </td>
              <td className="px-4 py-2 text-xs">{r.destination}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.status)}`}>{r.status}</span>
              </td>
              <td className="px-4 py-2">
                {r.status === 'pending' && isOrgAdmin && (
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
            <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No settlement requests yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
