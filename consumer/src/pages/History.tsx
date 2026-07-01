import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, X } from 'lucide-react';
import { api } from '@/lib/api';
import BottomNav from '@/components/BottomNav';

interface TxDetail {
  type?: 'topup' | 'conversion';
  source?: string; reference?: string;       // top-up
  from?: string; to?: string; rate?: string; fee?: string; // conversion
}
interface Tx {
  event_id: string;
  event_type: string;
  amount_token: string;
  currency?: string;
  created_at: string;
  direction?: 'in' | 'out';
  tx_hash?: string;
  detail?: TxDetail;
}

const sym = (c?: string) => (c === 'USDC' || c === 'USD' ? '$' : c === 'ZAR' ? 'R' : '');

export default function History() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [selected, setSelected] = useState<Tx | null>(null);

  useEffect(() => {
    api.get<{ transactions: Tx[] }>('/consumer/transactions')
      .then(r => setTxs(Array.isArray(r) ? r as unknown as Tx[] : r.transactions ?? []))
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="flex flex-col min-h-dvh pb-24">
        <div className="px-6 pt-12 pb-4">
          <h2 className="text-2xl font-bold text-white">Transaction History</h2>
        </div>
        <div className="flex-1 px-6 space-y-2">
          {txs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-white text-sm gap-2">
              <ArrowUpRight size={32} className="opacity-30" />
              No transactions yet
            </div>
          ) : (
            txs.map(tx => (
              <button
                key={tx.event_id}
                onClick={() => setSelected(tx)}
                className="w-full flex items-center gap-4 bg-brand-card border border-brand-accent/20 rounded-2xl px-4 py-3 text-left active:scale-[0.99] transition-transform"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-brand-accent/10">
                  {tx.direction === 'in'
                    ? <ArrowDownLeft size={18} className="text-brand-accent" />
                    : <ArrowUpRight  size={18} className="text-brand-accent" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-brand-accent capitalize">{tx.event_type.replace(/_/g, ' ')}</p>
                  <p className="text-brand-accent/50 text-xs">
                    {new Date(tx.created_at).toLocaleString('en-ZA')}
                    {tx.detail?.source && ` · ${tx.detail.source}`}
                  </p>
                </div>
                <p className="font-semibold text-sm text-brand-accent whitespace-nowrap">
                  {tx.direction === 'in' ? '+' : '−'}{sym(tx.currency)}{parseFloat(tx.amount_token).toFixed(2)}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center px-6" onClick={() => setSelected(null)}>
          <div className="w-full max-w-xs bg-brand-card rounded-2xl p-5 space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-brand-accent capitalize">{selected.event_type.replace(/_/g, ' ')}</p>
              <button onClick={() => setSelected(null)} aria-label="Close"><X size={18} className="text-brand-accent/60" /></button>
            </div>

            <p className="text-2xl font-bold text-brand-accent">
              {selected.direction === 'in' ? '+' : '−'}{sym(selected.currency)}{parseFloat(selected.amount_token).toFixed(2)}
            </p>

            <div className="text-sm divide-y divide-brand-accent/10">
              <Row label="Date" value={new Date(selected.created_at).toLocaleString('en-ZA')} />
              {selected.detail?.type === 'topup' && <>
                <Row label="Source" value={selected.detail.source ?? '—'} />
                {selected.detail.reference && <Row label="Reference" value={selected.detail.reference} />}
              </>}
              {selected.detail?.type === 'conversion' && <>
                {selected.detail.from && selected.detail.to && <Row label="Converted" value={`${selected.detail.from} → ${selected.detail.to}`} />}
                {selected.detail.rate && <Row label="Rate" value={selected.detail.rate} />}
                {selected.detail.fee  && <Row label="Fee"  value={selected.detail.fee} />}
              </>}
            </div>

            {selected.tx_hash && (
              <a href={`https://sepolia.etherscan.io/tx/${selected.tx_hash}`} target="_blank" rel="noreferrer"
                 className="block text-center text-xs font-mono text-brand-accent underline break-all">
                {selected.tx_hash.slice(0, 12)}…{selected.tx_hash.slice(-10)}
              </a>
            )}
          </div>
        </div>
      )}

      <BottomNav />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <span className="text-brand-accent/60">{label}</span>
      <span className="font-medium text-brand-accent text-right">{value}</span>
    </div>
  );
}
