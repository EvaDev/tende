import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownLeft, Bell, User, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';

interface Profile {
  ensSubdomain?: string;
  kyc: { levelName: string; allowsUsdSavings: boolean; allowsRemittance: boolean };
}
interface Tx {
  event_id: string; event_type: string; amount_token: string;
  created_at: string; direction?: 'in' | 'out';
}
interface TokenBalance {
  token: string; symbol?: string; baseCurrency?: string;
  isTreasury?: boolean; formatted: string;
}
interface FxQuote { rate: number | null }

// Format an amount in a given ISO currency using the browser locale.
function formatMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export default function Home() {
  const navigate = useNavigate();
  const [profile, setProfile]   = useState<Profile | null>(null);
  const [balances, setBalances] = useState<TokenBalance[] | null>(null);
  const [usdRate, setUsdRate]   = useState<number | null>(null);
  const [txs, setTxs]           = useState<Tx[]>([]);

  useEffect(() => {
    api.get<Profile>('/consumer/me').then(setProfile).catch(() => {});
    api.get<{ balances: TokenBalance[] }>('/consumer/balance')
      .then(b => setBalances(b.balances ?? [])).catch(() => setBalances([]));
    api.get<Tx[]>('/consumer/transactions').then(setTxs).catch(() => {});
  }, []);

  // Local currency = the treasury token's peg (e.g. ZAR). Combined total =
  // local-pegged holdings + USD holdings converted at the live $→local rate.
  const localCurrency = balances?.find(b => b.isTreasury)?.baseCurrency
    ?? balances?.[0]?.baseCurrency ?? 'ZAR';
  const usdBalance   = (balances ?? []).filter(b => b.baseCurrency === 'USD')
    .reduce((s, b) => s + parseFloat(b.formatted || '0'), 0);
  const localBalance = (balances ?? []).filter(b => b.baseCurrency === localCurrency)
    .reduce((s, b) => s + parseFloat(b.formatted || '0'), 0);

  // Fetch the live USD→local rate (skip if local already is USD)
  useEffect(() => {
    if (localCurrency === 'USD') { setUsdRate(1); return; }
    api.get<FxQuote>(`/fx/rate?from=USD&to=${localCurrency}`).then(q => setUsdRate(q.rate)).catch(() => setUsdRate(null));
  }, [localCurrency]);

  // Combined local-currency total. If USD can't be converted (no rate), show
  // just the local-pegged portion rather than a misleading figure.
  const combinedLocal = usdRate != null ? localBalance + usdBalance * usdRate : localBalance;
  const balanceReady  = balances !== null && (usdBalance === 0 || usdRate != null);

  return (
    <div className="flex flex-col min-h-dvh pb-24">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 pt-12 pb-4">
        <div className="w-10 h-10 rounded-xl bg-brand-card shadow flex items-center justify-center">
          <span className="text-brand-accent font-bold text-sm">iM</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="w-10 h-10 rounded-xl bg-brand-card border border-brand-accent/20 flex items-center justify-center text-brand-accent/50 shadow-sm">
            <Bell size={18} />
          </button>
          <button onClick={() => navigate('/account')} className="w-10 h-10 rounded-xl bg-brand-card border border-brand-accent/20 flex items-center justify-center text-brand-accent/50 shadow-sm">
            <User size={18} />
          </button>
        </div>
      </div>

      {/* Balance card */}
      <div className="mx-6 rounded-3xl bg-brand-accent p-6 space-y-4 shadow-lg">
        <div>
          <p className="text-brand-text/70 text-xs uppercase tracking-wide">Available Balance</p>
          <p className="text-4xl font-bold text-brand-text mt-1">
            {!balanceReady ? '—' : formatMoney(combinedLocal, localCurrency)}
          </p>
          {balanceReady && usdBalance > 0 && (
            <p className="text-brand-text/60 text-xs mt-1">
              includes {formatMoney(usdBalance, 'USD')}
              {usdRate != null && ` @ ${formatMoney(usdRate, localCurrency)}/$`}
            </p>
          )}
          {profile?.ensSubdomain && (
            <p className="text-brand-text/60 text-xs mt-1 font-mono">@{profile.ensSubdomain}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/top-up')}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-card text-brand-accent font-semibold text-sm active:scale-95 transition-transform"
          >
            <ArrowDownLeft size={16} /> Top Up
          </button>
          <button
            onClick={() => navigate('/send')}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-text/20 text-brand-text font-semibold text-sm active:scale-95 transition-transform"
          >
            <ArrowUpRight size={16} /> Send Money
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mx-6 mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={() => navigate('/pay')}
          className="flex items-center gap-3 bg-brand-card border border-brand-accent/20 rounded-2xl px-4 py-3 shadow-sm active:scale-95 transition-transform"
        >
          <div className="w-9 h-9 rounded-xl bg-brand-accent/10 flex items-center justify-center">
            <ArrowUpRight size={16} className="text-brand-accent" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-brand-accent">Pay</p>
            <p className="text-[11px] text-brand-accent/50">to an @tag</p>
          </div>
        </button>
        <button
          onClick={() => navigate('/send')}
          className="flex items-center gap-3 bg-brand-card border border-brand-accent/20 rounded-2xl px-4 py-3 shadow-sm active:scale-95 transition-transform"
        >
          <div className="w-9 h-9 rounded-xl bg-brand-accent/10 flex items-center justify-center">
            <ArrowUpRight size={16} className="text-brand-accent" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-brand-accent">Remit</p>
            <p className="text-[11px] text-brand-accent/50">cross-border</p>
          </div>
        </button>
      </div>

      {/* USD Savings */}
      {profile?.kyc.allowsUsdSavings && (
        <div className="mx-6 mt-4 rounded-2xl bg-brand-card border border-brand-accent/20 p-4 flex items-center gap-4 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-brand-accent/10 flex items-center justify-center">
            <TrendingUp size={18} className="text-brand-accent" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm text-brand-accent">USD Wallet</p>
            <p className="text-brand-accent/60 text-xs">
              {balanceReady ? formatMoney(usdBalance, 'USD') : '—'} · earn yield on your dollars
            </p>
          </div>
          <button onClick={() => navigate('/savings')} className="text-brand-accent text-sm font-medium">View →</button>
        </div>
      )}

      {/* Recent transactions */}
      <div className="mx-6 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-brand-accent">Recent Transactions</h3>
          <button onClick={() => navigate('/history')} className="text-brand-accent text-sm font-medium">See all</button>
        </div>
        {txs.length === 0 ? (
          <div className="text-center py-12 text-brand-accent/40 text-sm">No transactions yet</div>
        ) : (
          <div className="space-y-2">
            {txs.slice(0, 4).map(tx => (
              <div key={tx.event_id} className="flex items-center gap-4 bg-brand-card border border-brand-accent/20 rounded-2xl px-4 py-3 shadow-sm">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tx.direction === 'in' ? 'bg-green-100' : 'bg-red-100'}`}>
                  {tx.direction === 'in' ? <ArrowDownLeft size={18} className="text-green-700" /> : <ArrowUpRight size={18} className="text-red-700" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-brand-accent capitalize">{tx.event_type.replace(/_/g, ' ')}</p>
                  <p className="text-brand-accent/50 text-xs">{new Date(tx.created_at).toLocaleDateString('en-ZA')}</p>
                </div>
                <p className={`font-semibold text-sm ${tx.direction === 'in' ? 'text-green-700' : 'text-brand-accent'}`}>
                  {tx.direction === 'in' ? '+' : '−'}{parseFloat(tx.amount_token).toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
