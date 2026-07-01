import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { DoubleChevron } from '@/components/DoubleChevron';
import { api } from '@/lib/api';

interface Profile {
  ensSubdomain?: string;
  kyc: { levelName: string; allowsUsdSavings: boolean; allowsRemittance: boolean };
}
interface BalanceSummary {
  localCurrency: string; localSymbol: string;
  zar: { formatted: string }; usd: { formatted: string };
  fxUsdToZar: number | null; grandTotalLocal: string;
}

type Leg = 'ZAR' | 'USDC';

// Format money as "<symbol><amount>" with no space, consistently across currencies
// (Intl's `currencyDisplay:narrowSymbol` adds a space for ZAR but not USD — we avoid
// that by prepending the symbol ourselves).
const SYMBOL: Record<string, string> = { ZAR: 'R', USD: '$', USDC: '$' };
function formatMoney(n: number, currency: string) {
  const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const sym = SYMBOL[currency.toUpperCase()];
  return sym ? `${sym}${num}` : `${currency} ${num}`;
}

export default function Home() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [summary, setSummary] = useState<BalanceSummary | null>(null);
  const [menuFor, setMenuFor]       = useState<Leg | null>(null); // per-balance options sheet
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [welcome, setWelcome]       = useState(false); // "Account created" overlay after signup

  useEffect(() => {
    api.get<Profile>('/consumer/me').then(setProfile).catch(() => {});
    api.get<{ summary: BalanceSummary }>('/consumer/balance')
      .then(b => setSummary(b.summary ?? null)).catch(() => setSummary(null));
    // Show the one-time celebratory overlay just after registration, then clear the flag.
    if (sessionStorage.getItem('imali_welcome') === '1') {
      sessionStorage.removeItem('imali_welcome');
      setWelcome(true);
    }
  }, []);

  const localCurrency = summary?.localCurrency ?? 'ZAR';
  const tag           = profile?.ensSubdomain;
  const localBalance  = parseFloat(summary?.zar.formatted ?? '0');
  const usdBalance    = parseFloat(summary?.usd.formatted ?? '0');
  const combinedLocal = parseFloat(summary?.grandTotalLocal ?? '0');
  const balanceReady  = summary !== null;

  const legLabel = (leg: Leg) => (leg === 'ZAR' ? formatMoney(localBalance, localCurrency) : formatMoney(usdBalance, 'USD'));

  function act(leg: Leg, action: 'topup' | 'purchase' | 'send' | 'receive') {
    setMenuFor(null);
    if (action === 'topup')         navigate('/top-up');
    else if (action === 'send')     navigate('/pay', { state: { from: leg } });
    else if (action === 'purchase') navigate('/convert');
    else if (action === 'receive')  setReceiveOpen(true);
  }

  return (
    <div className="flex flex-col min-h-dvh pb-24 px-6 pt-14">
      {/* Brand header */}
      <p className="text-[2.8rem] leading-tight font-extrabold text-brand-accent text-center mb-4">iMali</p>

      {/* Identity + approximate total on one line */}
      <div className="flex items-baseline justify-between mb-7">
        <p className="text-2xl font-bold text-white">{tag ? `@${tag}` : '—'}</p>
        {balanceReady && <p className="text-2xl font-semibold text-white">~ {formatMoney(combinedLocal, localCurrency)}</p>}
      </div>

      {/* Balances stacked (old-iMali style), convert buttons floating between */}
      <div>
        <button
          onClick={() => setMenuFor('ZAR')}
          className="w-full flex items-center justify-between rounded-2xl bg-brand-accent text-white px-5 py-5 active:scale-[0.98] transition-transform"
        >
          <span className="text-2xl font-semibold text-white">Spend</span>
          <span className="text-2xl font-bold">{!balanceReady ? '—' : formatMoney(localBalance, localCurrency)}</span>
        </button>

        {/* Convert between balances — down + up, centered in a clear gap between the boxes */}
        <div className="flex justify-center gap-10 my-2 relative z-10">
          <button
            onClick={() => navigate('/convert')}
            aria-label="Convert Rand to USD"
            className="w-14 h-14 rounded-full bg-brand-accent text-white flex items-center justify-center shadow-lg border-2 border-brand-bg active:scale-90 transition-transform"
          >
            <DoubleChevron size={30} className="rotate-90" />
          </button>
          <button
            onClick={() => navigate('/convert')}
            aria-label="Convert USD to Rand"
            className="w-14 h-14 rounded-full bg-brand-accent text-white flex items-center justify-center shadow-lg border-2 border-brand-bg active:scale-90 transition-transform"
          >
            <DoubleChevron size={30} className="-rotate-90" />
          </button>
        </div>

        <button
          onClick={() => setMenuFor('USDC')}
          className="w-full flex items-center justify-between rounded-2xl bg-brand-accent text-white px-5 py-5 active:scale-[0.98] transition-transform"
        >
          <span className="text-2xl font-semibold text-white">$ Save</span>
          <span className="text-2xl font-bold">{!balanceReady ? '—' : formatMoney(usdBalance, 'USD')}</span>
        </button>
      </div>

      {/* Primary actions — pinned to the bottom, above the nav */}
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

      {/* Per-balance options sheet */}
      {menuFor && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center px-6 pb-28 sm:pb-8" onClick={() => setMenuFor(null)}>
          <div className="w-full max-w-sm bg-brand-card rounded-2xl p-2 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2">
              <p className="font-semibold text-brand-accent">{legLabel(menuFor)}</p>
              <button onClick={() => setMenuFor(null)} aria-label="Close"><X size={18} className="text-brand-accent/60" /></button>
            </div>
            {([['Top Up', 'topup'], ['Purchase', 'purchase'], ['Send', 'send'], ['Receive', 'receive']] as const).map(([label, action]) => (
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

      {/* Receive — payment tag + QR */}
      {receiveOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center px-6" onClick={() => setReceiveOpen(false)}>
          <div className="w-full max-w-xs bg-brand-card rounded-2xl p-6 text-center space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end -mt-2 -mr-2"><button onClick={() => setReceiveOpen(false)} aria-label="Close"><X size={18} className="text-brand-accent/60" /></button></div>
            <p className="text-brand-accent/60 text-sm">Scan to pay</p>
            {tag
              ? <div className="flex justify-center"><QRCodeSVG value={`@${tag}`} size={176} fgColor="#3D1919" bgColor="#FFFFFF" level="M" /></div>
              : <p className="text-brand-accent/50 text-sm">No payment tag yet</p>}
            <p className="text-xl font-bold text-brand-accent">{tag ? `@${tag}` : '—'}</p>
            {tag && (
              <button
                onClick={() => navigator.clipboard?.writeText(`@${tag}`)}
                className="w-full py-3 rounded-xl bg-brand-accent text-brand-text font-medium active:scale-95 transition-transform"
              >
                Copy tag
              </button>
            )}
          </div>
        </div>
      )}

      {/* Account-created overlay — shown once after signup, tap anywhere to continue */}
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
