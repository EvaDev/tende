import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { api } from '@/lib/api';
import BottomNav from '@/components/BottomNav';

interface Tx {
  event_id: string;
  event_type: string;
  amount_token: string;
  created_at: string;
  direction?: 'in' | 'out';
}

export default function History() {
  const [txs, setTxs] = useState<Tx[]>([]);

  useEffect(() => {
    api.get<Tx[]>('/consumer/transactions').then(setTxs).catch(() => {});
  }, []);

  return (
    <>
      <div className="flex flex-col min-h-dvh pb-24">
        <div className="px-6 pt-12 pb-4">
          <h2 className="text-2xl font-bold text-brand-accent">Transaction History</h2>
        </div>
        <div className="flex-1 px-6 space-y-2">
          {txs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-brand-accent/40 text-sm gap-2">
              <ArrowUpRight size={32} className="opacity-30" />
              No transactions yet
            </div>
          ) : (
            txs.map(tx => (
              <div key={tx.event_id} className="flex items-center gap-4 bg-brand-card border border-brand-accent/20 rounded-2xl px-4 py-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tx.direction === 'in' ? 'bg-green-100' : 'bg-red-100'}`}>
                  {tx.direction === 'in'
                    ? <ArrowDownLeft size={18} className="text-green-700" />
                    : <ArrowUpRight  size={18} className="text-red-700" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-brand-accent capitalize">{tx.event_type.replace(/_/g, ' ')}</p>
                  <p className="text-brand-accent/50 text-xs">{new Date(tx.created_at).toLocaleString('en-ZA')}</p>
                </div>
                <p className={`font-semibold text-sm ${tx.direction === 'in' ? 'text-green-700' : 'text-brand-accent'}`}>
                  {tx.direction === 'in' ? '+' : '−'}{parseFloat(tx.amount_token).toFixed(2)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
      <BottomNav />
    </>
  );
}
