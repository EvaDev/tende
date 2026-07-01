import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, api } from '@/lib/api';
import { statusColor, shortAddr } from '@/lib/utils';
import { useRole } from '@/hooks/useRole';
import { ConnectPrompt } from '@/components/ConnectPrompt';

interface Claim {
  id: string;
  sender: string;
  recipientMasked: string;
  amount: string;
  currency: string;
  status: string;
  escrowTx: string | null;
  releaseTx: string | null;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}
interface EscrowData {
  escrowAddress: string | null;
  counts: { pending: number; claimed: number; reclaimed: number };
  outstanding: { currency: string; amount: string }[];
  claims: Claim[];
}

const sym = (c: string) => (c === 'USD' ? '$' : c === 'ZAR' ? 'R' : '');

export default function Escrow() {
  const { isAdmin } = useRole();
  const [data, setData]   = useState<EscrowData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');

  function load() {
    apiFetch<EscrowData>('/api/admin/escrow').then(setData).catch(e => setError((e as Error).message));
  }
  useEffect(load, []);

  async function reclaimExpired() {
    setBusy(true); setMsg('');
    try {
      const r = await api.post<{ reclaimed: number }>('/api/admin/claims/reclaim-expired', {});
      setMsg(`Reclaimed ${r.reclaimed} expired claim(s) back to senders.`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally { setBusy(false); }
  }

  if (!isAdmin) return <ConnectPrompt action="view escrow" />;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Escrow</h2>
          <p className="text-sm text-white/70 mt-1">
            Value sent to not-yet-onboarded recipients via WhatsApp, held at the platform escrow address until claimed.
          </p>
        </div>
        <Button size="sm" onClick={reclaimExpired} disabled={busy}>{busy ? 'Reclaiming…' : 'Reclaim expired'}</Button>
      </div>

      {error && <p className="text-sm text-brand-danger">{error}</p>}
      {msg   && <p className="text-sm text-brand-accent">{msg}</p>}

      {/* Outstanding liability + counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-brand-card border border-gray-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Outstanding (held)</p>
          {data && data.outstanding.length > 0 ? (
            data.outstanding.map(o => (
              <p key={o.currency} className="text-xl font-bold text-brand-accent mt-1">{sym(o.currency)}{Number(o.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-xs text-gray-400">{o.currency}</span></p>
            ))
          ) : <p className="text-xl font-bold text-brand-accent mt-1">—</p>}
        </div>
        {data && ([['Pending', data.counts.pending], ['Claimed', data.counts.claimed], ['Reclaimed', data.counts.reclaimed]] as const).map(([label, n]) => (
          <div key={label} className="bg-brand-card border border-gray-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
            <p className="text-xl font-bold text-brand-accent mt-1">{n}</p>
          </div>
        ))}
      </div>

      {data?.escrowAddress && (
        <p className="text-xs text-white/60 font-mono">Escrow address: {data.escrowAddress}</p>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Sender', 'Recipient', 'Amount', 'Status', 'Created', 'Expires', 'Tx'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(!data || data.claims.length === 0) && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No escrow claims yet</td></tr>
            )}
            {data?.claims.map(c => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{c.sender}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.recipientMasked}</td>
                <td className="px-4 py-3 font-medium">{sym(c.currency)}{Number(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="px-4 py-3">
                  <Badge className={statusColor(c.expired ? 'EXPIRED' : c.status)}>{c.expired ? 'expired' : c.status}</Badge>
                </td>
                <td className="px-4 py-3 text-gray-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-gray-400">{new Date(c.expiresAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  {(c.releaseTx ?? c.escrowTx)
                    ? <a href={`https://sepolia.etherscan.io/tx/${c.releaseTx ?? c.escrowTx}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline hover:text-brand-accent">{shortAddr(c.releaseTx ?? c.escrowTx!)}</a>
                    : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
