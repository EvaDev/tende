import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, QrCode, AlertCircle, CheckCircle2, X } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { QrScanner } from '@/components/QrScanner';
import { prepareTransfer, signAndSubmitTransfer, type TransferResult } from '@/lib/pay';
import { isPasskeySupported } from '@/lib/passkey';

type Cur = 'ZAR' | 'USDC';
const SYM: Record<Cur, string> = { ZAR: 'R', USDC: '$' };
const money = (n: number, c: Cur) =>
  `${SYM[c]}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

interface LineItem { name: string; qty: number; unitPrice: number }
interface Charge {
  to: string; amount: string; currency: Cur; merchant: string;
  merchantId?: string; store?: string; till?: string; lat?: number; lng?: number;
  items: LineItem[];
}

// Buy = pay a merchant at the point of sale. Scan the POS "Scan to pay" QR, review
// the merchant + line items + total, then approve with a passkey. The payment is the
// same user-signed Vault.transfer as Send; the backend also records it as a sale.
export default function Buy() {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [charge, setCharge]     = useState<Charge | null>(null);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<TransferResult | null>(null);

  function onScan(text: string) {
    setScanning(false); setError('');
    try {
      const p = JSON.parse(text) as {
        imali?: unknown; to?: string; amt?: string; cur?: string; n?: string; mid?: string;
        store?: string; till?: string; lat?: number; lng?: number;
        items?: { n: string; q: number; p: number }[];
      };
      if (p && p.imali && p.to && p.amt) {
        const currency: Cur = p.cur === 'USDC' ? 'USDC' : 'ZAR';
        setCharge({
          to: String(p.to), amount: String(p.amt), currency,
          merchant: p.n ? String(p.n) : 'Merchant',
          merchantId: p.mid, store: p.store, till: p.till, lat: p.lat, lng: p.lng,
          items: Array.isArray(p.items) ? p.items.map(i => ({ name: i.n, qty: i.q, unitPrice: i.p })) : [],
        });
        return;
      }
    } catch { /* not an iMali pay-request */ }
    setError('That’s not an iMali payment QR. Ask the cashier to show the “Scan to pay” code.');
  }

  async function pay() {
    if (!charge) return;
    if (!isPasskeySupported()) { setError('Passkeys aren’t supported on this device.'); return; }
    setLoading(true); setError('');
    try {
      const prepared = await prepareTransfer({
        to: charge.to, amount: charge.amount, currency: charge.currency,
        sale: {
          merchantId: charge.merchantId, storeNumber: charge.store, tillNumber: charge.till,
          lat: charge.lat, lng: charge.lng, items: charge.items,
        },
      });
      setResult(await signAndSubmitTransfer(prepared));
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (msg.includes('INSUFFICIENT_BALANCE') || msg.includes('Insufficient')) setError('You don’t have enough balance for this purchase.');
      else if (msg.includes('cancelled')) setError('Approval was cancelled. Try again.');
      else if (msg.includes('SENDER_UNREGISTERED')) setError('Your account isn’t registered yet.');
      else setError(msg || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-6 shadow-xl text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-full bg-brand-accent/10 flex items-center justify-center">
            <CheckCircle2 size={44} className="text-brand-accent" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-brand-accent">Paid {charge && money(parseFloat(charge.amount), charge.currency)}</h2>
            <p className="text-brand-accent/70 text-sm">to {charge?.merchant}</p>
            <a href={`https://sepolia.etherscan.io/tx/${result.txHash}`} target="_blank" rel="noreferrer" className="text-brand-accent text-xs font-mono underline break-all">
              {result.txHash.slice(0, 10)}…{result.txHash.slice(-8)}
            </a>
          </div>
          <button onClick={() => navigate('/home')} className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform">Done</button>
        </div>
      </div>
    );
  }

  // ── Confirm purchase ─────────────────────────────────────────────────────────
  if (charge) {
    const total = parseFloat(charge.amount);
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-brand-accent">Confirm payment</h2>
            <button onClick={() => { setCharge(null); setError(''); }} aria-label="Cancel"><X size={20} className="text-brand-accent/60" /></button>
          </div>

          <div className="text-center">
            <p className="text-brand-accent/70 text-sm">Pay</p>
            <p className="text-3xl font-bold text-brand-accent">{money(total, charge.currency)}</p>
            <p className="text-brand-accent/70 text-sm">to <span className="font-semibold">{charge.merchant}</span></p>
            {(charge.store || charge.till) && (
              <p className="text-brand-accent/50 text-xs mt-1">
                {charge.store ? `Store ${charge.store}` : ''}{charge.store && charge.till ? ' · ' : ''}{charge.till ? `Till ${charge.till}` : ''}
              </p>
            )}
          </div>

          {charge.items.length > 0 && (
            <div className="bg-white rounded-xl divide-y divide-brand-accent/10 border border-brand-accent/10">
              {charge.items.map((it, i) => (
                <div key={i} className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-brand-accent">{it.qty} × {it.name}</span>
                  <span className="text-brand-accent/70 tabular-nums">{money(it.qty * it.unitPrice, charge.currency)}</span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-3 py-2 text-brand-danger text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <button
            onClick={pay}
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform disabled:opacity-40"
          >
            {loading ? 'Paying…' : `Pay ${money(total, charge.currency)}`}
          </button>
          <p className="text-center text-brand-accent/50 text-xs">Paid from your {charge.currency === 'USDC' ? 'USD' : 'Rand'} balance</p>
        </div>
      </div>
    );
  }

  // ── Idle — scan CTA ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-dvh pb-24 px-6 pt-14 bg-brand-bg">
      {scanning && <QrScanner onResult={onScan} onClose={() => setScanning(false)} />}
      <h1 className="text-3xl font-bold text-white">Buy</h1>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 -mt-12">
        <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
          <ShoppingBag size={36} className="text-white" />
        </div>
        <p className="text-white font-semibold text-lg">Scan to pay a merchant</p>
        <p className="text-white/80 text-sm max-w-xs">Point your camera at the merchant’s “Scan to pay” code to review and pay for your purchase.</p>
        {error && (
          <div className="flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-3 py-2 text-white text-sm max-w-xs">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}
        <button
          onClick={() => { setError(''); setScanning(true); }}
          className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-white text-brand-accent font-semibold active:scale-95 transition-transform"
        >
          <QrCode size={20} /> Scan QR code
        </button>
      </div>
      <BottomNav />
    </div>
  );
}
