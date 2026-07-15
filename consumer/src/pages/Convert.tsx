import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ArrowDown, X } from 'lucide-react';
import { DoubleChevron } from '@/components/DoubleChevron';
import { InfoButton } from '@/components/InfoButton';
import PaymentProgress, { CONVERT_STEPS } from '@/components/PaymentProgress';
import { api } from '@/lib/api';

type State = 'idle' | 'loading' | 'success' | 'error';
type Direction = 'local-to-usd' | 'usd-to-local' | 'zar-to-usd' | 'usd-to-zar';
type ConvertStep = 'prepare' | 'rate' | 'settle' | 'done';

const ALLOWED_DIRECTIONS = new Set<Direction>([
  'local-to-usd', 'usd-to-local', 'zar-to-usd', 'usd-to-zar',
]);

interface BalanceSummary {
  localCurrency: string;
  localSymbol: string;
  spend: { formatted: string };
  zar: { formatted: string };
  usd: { formatted: string };
}
interface FxQuote { rate: number | null }
interface ConvertResult {
  from: string;
  to: string;
  debited:  { amount: string; currency: string };
  credited: { amount: string; currency: string };
  rate: number; spreadBps: number;
}

const SYMBOL: Record<string, string> = { ZAR: 'R', MWK: 'MK', MZN: 'MZN', USD: '$', USDC: '$' };
const NAMES: Record<string, string> = { ZAR: 'Rand', MWK: 'Kwacha', MZN: 'Metical', USD: 'USD' };

function money(n: number, currency: string, symbolOverride?: string) {
  const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const sym = symbolOverride ?? SYMBOL[currency.toUpperCase()];
  return sym ? `${sym}${num}` : `${currency} ${num}`;
}

function localName(currency: string): string {
  return NAMES[currency.toUpperCase()] ?? currency.toUpperCase();
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function fiatFromDirection(direction: Direction, localCurrency: string): string {
  if (direction === 'zar-to-usd' || direction === 'usd-to-zar') return 'ZAR';
  return localCurrency;
}

export default function Convert() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { direction?: Direction; localCurrency?: string; localSymbol?: string } | null;
  const rawDirection = navState?.direction ?? 'local-to-usd';
  const direction: Direction = ALLOWED_DIRECTIONS.has(rawDirection as Direction)
    ? (rawDirection as Direction)
    : 'local-to-usd';
  const localToUsd = direction === 'local-to-usd' || direction === 'zar-to-usd';
  const initialLocal = navState?.localCurrency ?? 'ZAR';

  const [localCurrency, setLocalCurrency] = useState(initialLocal);
  const [localSymbol, setLocalSymbol]     = useState(navState?.localSymbol ?? 'R');
  const [fiatCode, setFiatCode]           = useState(() => fiatFromDirection(direction, initialLocal));
  const [spendAvail, setSpendAvail]       = useState<number | null>(null);
  const [zarAvail, setZarAvail]           = useState<number | null>(null);
  const [usdAvail, setUsdAvail]           = useState<number | null>(null);
  const [rate, setRate]                   = useState<number | null>(null);
  const [amount, setAmount]               = useState('');
  const [state, setState]                 = useState<State>('idle');
  const [convertStep, setConvertStep]     = useState<ConvertStep | null>(null);
  const [error, setError]                 = useState('');
  const [result, setResult]               = useState<ConvertResult | null>(null);

  const canChooseZar = localCurrency.toUpperCase() !== 'ZAR';

  useEffect(() => {
    api.get<{ summary: BalanceSummary }>('/consumer/balance')
      .then(b => {
        const s = b.summary;
        if (s?.localCurrency) {
          setLocalCurrency(s.localCurrency);
          // Keep user's fiat choice unless balance load reveals local is ZAR-only.
          setFiatCode(prev => {
            if (s.localCurrency.toUpperCase() === 'ZAR') return 'ZAR';
            if (prev === 'ZAR' || prev.toUpperCase() === s.localCurrency.toUpperCase()) return prev;
            return fiatFromDirection(direction, s.localCurrency);
          });
        }
        if (s?.localSymbol) setLocalSymbol(s.localSymbol);
        setSpendAvail(parseFloat(s?.spend?.formatted ?? '0'));
        setZarAvail(parseFloat(s?.zar?.formatted ?? '0'));
        setUsdAvail(parseFloat(s?.usd.formatted ?? '0'));
      }).catch(() => {});
  }, [direction]);

  useEffect(() => {
    const from = localToUsd ? fiatCode : 'USD';
    const to   = localToUsd ? 'USD' : fiatCode;
    setRate(null);
    api.get<FxQuote>(`/fx/rate?from=${from}&to=${to}`).then(q => setRate(q.rate)).catch(() => {});
  }, [localToUsd, fiatCode]);

  const amt      = parseFloat(amount || '0');
  const sourceAvail = localToUsd
    ? (fiatCode === 'ZAR' ? zarAvail : spendAvail)
    : usdAvail;
  const estOut   = rate != null && amt > 0 ? amt * rate * (1 - 0.015) : 0;
  const tooMuch  = sourceAvail != null && amt > sourceAvail;
  const spendName = localName(fiatCode);
  const fromSymbol = fiatCode === localCurrency ? localSymbol : SYMBOL[fiatCode];

  async function convert() {
    if (!(amt > 0)) { setError('Enter an amount'); return; }
    if (tooMuch) {
      setError(localToUsd
        ? `Amount exceeds your ${spendName} balance`
        : 'Amount exceeds your USD balance');
      return;
    }
    setState('loading'); setError(''); setConvertStep('prepare');
    try {
      await sleep(250);
      setConvertStep('rate');
      await sleep(250);
      setConvertStep('settle');
      const body = localToUsd
        ? { amount: amount.trim(), from: fiatCode, to: 'USD' }
        : { amount: amount.trim(), from: 'USD', to: fiatCode };
      const r = await api.post<ConvertResult>('/consumer/convert', body);
      setConvertStep('done');
      setResult(r); setState('success');
    } catch (e) {
      setError((e as Error).message); setState('error');
    } finally {
      setConvertStep(null);
    }
  }

  const title = localToUsd
    ? `Convert ${spendName} to USD`
    : `Convert USD to ${spendName}`;
  const fromLabel = localToUsd ? `Amount (${spendName})` : 'Amount (USD)';
  const outCurrency = localToUsd ? 'USD' : fiatCode;
  const rateLabel = localToUsd
    ? (rate != null ? `${rate.toFixed(4)} $/${fromSymbol || fiatCode}` : '—')
    : (rate != null ? `${rate.toFixed(2)} ${fromSymbol || fiatCode}/$` : '—');

  if (state === 'loading' && convertStep) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-5 shadow-xl">
          <PaymentProgress
            steps={CONVERT_STEPS}
            currentId={convertStep}
            title={title}
            hint="Debiting one balance and crediting the other on-chain."
          />
        </div>
      </div>
    );
  }

  if (state === 'success' && result) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-6 shadow-xl text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-full bg-brand-accent/10 flex items-center justify-center">
            <CheckCircle2 size={44} className="text-brand-accent" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-brand-accent">{title}</h2>
            <p className="text-brand-accent/80">
              {money(parseFloat(result.debited.amount), result.debited.currency)} →{' '}
              <span className="font-semibold">{money(parseFloat(result.credited.amount), result.credited.currency)}</span>
            </p>
            <p className="text-brand-accent/50 text-xs">
              Rate {rateLabel} · {(result.spreadBps / 100).toFixed(2)}% fee
            </p>
          </div>
          <button onClick={() => navigate('/home')} className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg py-8">
      <div className="w-full max-w-sm bg-brand-card rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-accent">{title}</h2>
          <div className="flex items-center gap-2">
            <InfoButton title="Conversion details">
              <p>Supported: your local currency ↔ USD, and ZAR ↔ USD.</p>
              <p>Not supported: direct conversions between treasury corridors (e.g. MWK ↔ ZAR).</p>
              <p>Live rate: {rateLabel}</p>
              <p>Fee: 1.5%, already included in the amount you receive.</p>
              <p>The exact amount is confirmed the moment you convert.</p>
            </InfoButton>
            <button onClick={() => navigate(-1)} aria-label="Close"><X size={20} className="text-brand-accent/60" /></button>
          </div>
        </div>

        {canChooseZar && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-brand-accent">
              {localToUsd ? 'Convert from' : 'Convert to'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([localCurrency, 'ZAR'] as const).map(code => {
                const selected = fiatCode.toUpperCase() === code.toUpperCase();
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setFiatCode(code);
                      setAmount('');
                      setError('');
                      setState('idle');
                    }}
                    className={`rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                      selected
                        ? 'bg-brand-accent text-brand-text'
                        : 'bg-white border border-brand-accent/20 text-brand-accent'
                    }`}
                  >
                    {localName(code)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-brand-accent">{fromLabel}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-accent/50 font-semibold">
              {localToUsd ? (fromSymbol || fiatCode) : '$'}
            </span>
            <input
              type="text" inputMode="decimal" placeholder="0.00" value={amount}
              onChange={e => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setError(''); setState('idle'); }}
              className="w-full bg-white border border-brand-accent/20 rounded-xl pl-7 pr-3 py-3 text-lg font-semibold text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
            />
          </div>
          {sourceAvail != null && (
            <p className="text-xs text-brand-accent/60 px-1">
              Available: {money(sourceAvail, localToUsd ? fiatCode : 'USD', localToUsd ? fromSymbol : undefined)}
              <button type="button" onClick={() => setAmount(String(sourceAvail))} className="ml-2 underline text-brand-accent">Max</button>
            </p>
          )}
        </div>

        <div className="flex justify-center"><ArrowDown size={18} className="text-brand-accent/40" /></div>

        <div className="rounded-xl bg-white border border-brand-accent/10 px-4 py-4 text-center">
          <p className="text-xs text-brand-accent/60 uppercase tracking-wide">You'll receive ≈</p>
          <p className="text-2xl font-bold text-brand-accent mt-1">
            {money(estOut, outCurrency, localToUsd ? undefined : fromSymbol)}
          </p>
          <p className="text-xs text-brand-accent/50 mt-1">Rate {rateLabel}</p>
        </div>

        {(state === 'error' || error) && (
          <div className="flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-3 py-2 text-brand-danger text-sm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error || 'Conversion failed'}
          </div>
        )}

        <button
          onClick={convert}
          disabled={state === 'loading' || !(amt > 0) || tooMuch}
          className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold disabled:opacity-40 active:scale-95 transition-transform flex items-center justify-center gap-2"
        >
          {state === 'loading' ? 'Converting…' : <>{title} <DoubleChevron size={18} /></>}
        </button>
      </div>
    </div>
  );
}
