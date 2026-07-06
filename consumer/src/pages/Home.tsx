import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CheckCircle2 } from 'lucide-react';
import { DoubleChevron } from '@/components/DoubleChevron';
import { api } from '@/lib/api';
import { useAppBrand } from '@/hooks/useAppBrand';

interface Profile {
  ensSubdomain?: string;
  kyc: { levelName: string; allowsUsdSavings: boolean; allowsRemittance: boolean };
}
interface BalanceSummary {
  localCurrency: string;
  localSymbol: string;
  hasSeparateZar?: boolean;
  spend: { currency: string; formatted: string };
  zar: { currency: string; formatted: string };
  usd: { formatted: string };
  fxUsdToLocal: number | null;
  grandTotalLocal: string;
}

type Leg = 'SPEND' | 'ZAR' | 'USDC';

const SYMBOL: Record<string, string> = { ZAR: 'R', MWK: 'MK', USD: '$', USDC: '$' };
function formatMoney(n: number, currency: string, symbolOverride?: string) {
  const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const sym = symbolOverride ?? SYMBOL[currency.toUpperCase()];
  return sym ? `${sym}${num}` : `${currency} ${num}`;
}

function BalanceRow({ label, amount, currency, symbol, onClick }: {
  label: string; amount: string; currency: string; symbol?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between rounded-2xl bg-brand-accent text-white px-5 py-5 active:scale-[0.98] transition-transform"
    >
      <span className="text-2xl font-semibold text-white">{label}</span>
      <span className="text-2xl font-bold">{amount === '—' ? '—' : formatMoney(parseFloat(amount), currency, symbol)}</span>
    </button>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { name: appName } = useAppBrand();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [summary, setSummary] = useState<BalanceSummary | null>(null);
  const [menuFor, setMenuFor]       = useState<Leg | null>(null);
  const [welcome, setWelcome]       = useState(false);

  useEffect(() => {
    api.get<Profile>('/consumer/me').then(setProfile).catch(() => {});
    api.get<{ summary: BalanceSummary }>('/consumer/balance')
      .then(b => setSummary(b.summary ?? null)).catch(() => setSummary(null));
    if (sessionStorage.getItem('imali_welcome') === '1') {
      sessionStorage.removeItem('imali_welcome');
      setWelcome(true);
    }
  }, []);

  const localCurrency = summary?.localCurrency ?? 'ZAR';
  const localSymbol   = summary?.localSymbol ?? 'R';
  const hasSeparateZar = summary?.hasSeparateZar ?? localCurrency !== 'ZAR';
  const tag           = profile?.ensSubdomain;
  const localBalance  = summary?.spend?.formatted;
  const zarBalance    = summary?.zar?.formatted;
  const usdBalance    = summary?.usd?.formatted;
  const combinedLocal = summary?.grandTotalLocal;
  const balanceReady  = summary !== null;

  const legLabel = (leg: Leg) => {
    if (leg === 'SPEND') return formatMoney(parseFloat(localBalance ?? '0'), localCurrency, localSymbol);
    if (leg === 'ZAR') return formatMoney(parseFloat(zarBalance ?? '0'), 'ZAR');
    return formatMoney(parseFloat(usdBalance ?? '0'), 'USD');
  };

  function act(leg: Leg, action: 'topup' | 'buy' | 'send' | 'receive') {
    setMenuFor(null);
    if (action === 'topup')         navigate('/top-up');
    else if (action === 'send')     navigate('/pay', { state: { from: leg } });
    else if (action === 'buy') navigate('/buy', { state: { from: leg } });
    else if (action === 'receive')  navigate('/receive');
  }

  return (
    <div className="flex flex-col min-h-dvh pb-24 px-6 pt-14">
      <p className="text-[2.8rem] leading-tight font-extrabold text-brand-accent text-center mb-4">{appName}</p>

      <div className="flex items-baseline justify-between mb-7">
        <p className="text-2xl font-bold text-white">{tag ? `@${tag}` : '—'}</p>
        {balanceReady && combinedLocal && (
          <p className="text-2xl font-semibold text-white">~ {formatMoney(parseFloat(combinedLocal), localCurrency, localSymbol)}</p>
        )}
      </div>

      <div>
        {hasSeparateZar && (
          <>
            <BalanceRow
              label="Spend"
              amount={balanceReady ? localBalance! : '—'}
              currency={localCurrency}
              symbol={localSymbol}
              onClick={() => setMenuFor('SPEND')}
            />
            <div className="h-2" />
          </>
        )}

        <BalanceRow
          label={hasSeparateZar ? 'Rand' : 'Spend'}
          amount={balanceReady ? zarBalance! : '—'}
          currency="ZAR"
          onClick={() => setMenuFor(hasSeparateZar ? 'ZAR' : 'SPEND')}
        />

        <div className="flex justify-center gap-10 my-2 relative z-10">
          <button
            onClick={() => navigate('/convert', {
              state: {
                direction: hasSeparateZar ? 'zar-to-usd' : 'local-to-usd',
                localCurrency,
                localSymbol,
              },
            })}
            aria-label={hasSeparateZar ? 'Convert Rand to USD' : `Convert ${localCurrency} to USD`}
            className="w-14 h-14 rounded-full bg-brand-accent text-white flex items-center justify-center shadow-lg border-2 border-brand-bg active:scale-90 transition-transform"
          >
            <DoubleChevron size={30} className="rotate-90" />
          </button>
          <button
            onClick={() => navigate('/convert', {
              state: {
                direction: hasSeparateZar ? 'usd-to-zar' : 'usd-to-local',
                localCurrency,
                localSymbol,
              },
            })}
            aria-label={hasSeparateZar ? 'Convert USD to Rand' : `Convert USD to ${localCurrency}`}
            className="w-14 h-14 rounded-full bg-brand-accent text-white flex items-center justify-center shadow-lg border-2 border-brand-bg active:scale-90 transition-transform"
          >
            <DoubleChevron size={30} className="-rotate-90" />
          </button>
        </div>

        <BalanceRow
          label="$ Save"
          amount={balanceReady ? usdBalance! : '—'}
          currency="USD"
          onClick={() => setMenuFor('USDC')}
        />
      </div>

      <div className="flex gap-3 mt-auto">
        <button
          onClick={() => navigate('/top-up')}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand-accent text-white text-lg font-bold active:scale-95 transition-transform"
        >
          Top Up <DoubleChevron size={27} className="rotate-90" />
        </button>
        <button
          onClick={() => navigate('/pay')}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand-accent text-white text-lg font-bold active:scale-95 transition-transform"
        >
          Send <DoubleChevron size={27} />
        </button>
      </div>

      {menuFor && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center px-6 pb-28 sm:pb-8" onClick={() => setMenuFor(null)}>
          <div className="w-full max-w-sm bg-brand-card rounded-2xl p-2 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2">
              <p className="font-semibold text-brand-accent">{legLabel(menuFor)}</p>
              <button onClick={() => setMenuFor(null)} aria-label="Close"><X size={18} className="text-brand-accent/60" /></button>
            </div>
            {([['Top Up', 'topup'], ['Buy', 'buy'], ['Send', 'send'], ['Receive', 'receive']] as const).map(([label, action]) => (
              <button
                key={action}
                onClick={() => act(menuFor, action)}
                className="w-full text-center py-3 my-1 rounded-xl bg-brand-accent text-brand-text font-medium active:scale-95 transition-transform"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {welcome && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center px-6" onClick={() => setWelcome(false)}>
          <div className="w-full max-w-xs bg-brand-card rounded-2xl p-7 text-center space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 mx-auto rounded-full bg-brand-accent/10 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-brand-accent" />
            </div>
            <h2 className="text-xl font-bold text-brand-accent">Account created!</h2>
            {tag && <p className="text-lg font-bold text-brand-accent">@{tag}</p>}
            <p className="text-brand-accent/60 text-sm">You're all set to send and receive.</p>
            <button
              onClick={() => setWelcome(false)}
              className="w-full py-3 rounded-xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform"
            >
              Get started
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
