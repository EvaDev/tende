import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ArrowDown } from 'lucide-react';
import { DoubleChevron } from '@/components/DoubleChevron';
import { InfoButton } from '@/components/InfoButton';
import { api } from '@/lib/api';

type State = 'idle' | 'loading' | 'success' | 'error';

interface BalanceSummary {
  localSymbol: string;
  zar: { formatted: string };
  usd: { formatted: string };
}
interface FxQuote { rate: number | null }
interface ConvertResult {
  debited:  { amount: string; currency: string };
  credited: { amount: string; currency: string };
  rate: number; spreadBps: number;
}

const SYMBOL: Record<string, string> = { ZAR: 'R', USD: '$', USDC: '$' };
function money(n: number, currency: string) {
  const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const sym = SYMBOL[currency.toUpperCase()];
  return sym ? `${sym}${num}` : `${currency} ${num}`;
}

export default function Convert() {
  const navigate = useNavigate();
  const [zarAvail, setZarAvail] = useState<number | null>(null);
  const [rate, setRate]         = useState<number | null>(null);
  const [amount, setAmount]     = useState('');
  const [state, setState]       = useState<State>('idle');
  const [error, setError]       = useState('');
  const [result, setResult]     = useState<ConvertResult | null>(null);

  useEffect(() => {
    api.get<{ summary: BalanceSummary }>('/consumer/balance')
      .then(b => setZarAvail(parseFloat(b.summary?.zar.formatted ?? '0'))).catch(() => {});
    // Live ZAR→USD mid rate for the estimate (the backend applies the spread at execution).
    api.get<FxQuote>('/fx/rate?from=ZAR&to=USD').then(q => setRate(q.rate)).catch(() => {});
  }, []);

  const amt      = parseFloat(amount || '0');
  // Show an estimate net of the same default spread the backend uses (1.5%).
  const estUsd   = rate != null && amt > 0 ? amt * rate * (1 - 0.015) : 0;
  const tooMuch  = zarAvail != null && amt > zarAvail;

  async function convert() {
    if (!(amt > 0)) { setError('Enter an amount'); return; }
    if (tooMuch)    { setError('Amount exceeds your Rand balance'); return; }
    setState('loading'); setError('');
    try {
      const r = await api.post<ConvertResult>('/consumer/convert', { amount: amount.trim() });
      setResult(r); setState('success');
    } catch (e) {
      setError((e as Error).message); setState('error');
    }
  }

  return (
    <div className="flex flex-col min-h-dvh px-6 py-12 gap-6">
      <button onClick={() => navigate(-1)} className="text-white text-sm text-left">← Back</button>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Convert to USD</h2>
        <InfoButton title="Conversion details">
          <p>Live rate: {rate != null ? `${rate.toFixed(4)} $/R` : '—'}</p>
          <p>Fee: 1.5%, already included in the amount you receive.</p>
          <p>The exact amount is confirmed the moment you convert.</p>
        </InfoButton>
      </div>

      <div className="space-y-1">
        <label className="block text-xs text-white uppercase tracking-wide font-medium">Amount (Rand)</label>
        <input
          type="text" inputMode="decimal" placeholder="0.00" value={amount}
          onChange={e => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setError(''); setState('idle'); }}
          className="w-full bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-4 text-2xl text-center font-semibold text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
        />
        {zarAvail != null && (
          <p className="text-xs text-white px-1">
            Available: {money(zarAvail, 'ZAR')}
            <button onClick={() => setAmount(String(zarAvail))} className="ml-2 underline text-white">Max</button>
          </p>
        )}
      </div>

      <div className="flex justify-center"><ArrowDown size={20} className="text-white" /></div>

      <div className="rounded-2xl bg-brand-card border border-brand-accent/20 px-4 py-4 text-center">
        <p className="text-xs text-brand-accent/60 uppercase tracking-wide">You'll receive ≈</p>
        <p className="text-2xl font-bold text-brand-accent mt-1">{money(estUsd, 'USD')}</p>
      </div>

      {(state === 'error' || error) && (
        <div className="flex items-center gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-4 py-3 text-brand-danger text-sm">
          <AlertCircle size={16} /> {error || 'Conversion failed'}
        </div>
      )}

      <button
        onClick={convert}
        disabled={state === 'loading' || !(amt > 0) || tooMuch}
        className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold disabled:opacity-40 active:scale-95 flex items-center justify-center gap-2"
      >
        {state === 'loading' ? 'Converting…' : <>Convert to USD <DoubleChevron size={18} /></>}
      </button>

      {/* Success — dismissable overlay (tap anywhere to return Home) */}
      {state === 'success' && result && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center px-6" onClick={() => navigate('/home')}>
          <div className="w-full max-w-xs bg-brand-card rounded-2xl p-7 text-center space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 mx-auto rounded-full bg-brand-accent/10 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-brand-accent" />
            </div>
            <h2 className="text-xl font-bold text-brand-accent">Converted to USD</h2>
            <p className="text-brand-accent/80">
              {money(parseFloat(result.debited.amount), 'ZAR')} → <span className="font-semibold">{money(parseFloat(result.credited.amount), 'USD')}</span>
            </p>
            <p className="text-brand-accent/50 text-xs">Rate {result.rate.toFixed(4)} $/R · {(result.spreadBps / 100).toFixed(2)}% fee</p>
            <button onClick={() => navigate('/home')} className="w-full py-3 rounded-xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
