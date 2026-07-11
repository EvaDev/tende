import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShoppingBag, QrCode, AlertCircle, CheckCircle2, X, Store, ChevronRight } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { QrScanner } from '@/components/QrScanner';
import { executeTransfer, type TransferResult, type TransferStep } from '@/lib/pay';
import { isPasskeySupported } from '@/lib/passkey';
import { api } from '@/lib/api';
import { getAppName } from '@/lib/brand';
import PaymentProgress, { PAYMENT_STEPS } from '@/components/PaymentProgress';

type PayLeg = 'SPEND' | 'ZAR' | 'USDC';

function legToCurrency(leg: PayLeg, spendCode: string): string {
  if (leg === 'USDC') return 'USDC';
  if (leg === 'ZAR') return 'ZAR';
  return spendCode;
}
const SYM: Record<string, string> = { ZAR: 'R', MWK: 'MK', USD: '$', USDC: '$' };
const money = (n: number, c: string) =>
  `${SYM[c.toUpperCase()] ?? c}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

interface LineItem { name: string; qty: number; unitPrice: number }
interface CheckoutQuote {
  crossBorder: boolean;
  chargeAmount: string;
  chargeCurrency: string;
  payAmount: string;
  payCurrency: string;
  fxRate: number;
  fxSource: string;
  fxAsOf: string | null;
}
interface Charge {
  to: string; amount: string; currency: string; merchant: string;
  payCurrency?: string;
  merchantId?: string; productId?: string; storeId?: string;
  store?: string; till?: string; lat?: number; lng?: number;
  items: LineItem[];
}

interface CatalogProduct {
  id: string; name: string; description: string | null;
  deliveryType: string; isFixedPrice: boolean;
  price: number | null; minAmount: number | null; maxAmount: number | null;
  currency: string; merchantId: string; merchantName: string; walletAddress: string;
}

const deliveryTag: Record<string, string> = {
  VIRTUAL: 'Mobile', PHYSICAL: 'Delivery', VOUCHER: 'Digital',
};

function priceHint(p: CatalogProduct) {
  const cur = p.currency.toUpperCase();
  if (p.isFixedPrice && p.price != null) return money(p.price, cur);
  if (p.minAmount != null && p.maxAmount != null) return `${money(p.minAmount, cur)} – ${money(p.maxAmount, cur)}`;
  return '—';
}

export default function Buy() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { from?: PayLeg } | null;
  const [payFrom] = useState<PayLeg | null>(navState?.from ?? null);
  const [spendCode, setSpendCode] = useState('ZAR');
  const [scanning, setScanning]   = useState(false);
  const [charge, setCharge]       = useState<Charge | null>(null);
  const [catalog, setCatalog]     = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [picked, setPicked]       = useState<CatalogProduct | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [payStep, setPayStep]     = useState<TransferStep | null>(null);
  const [result, setResult]       = useState<TransferResult | null>(null);
  const [quote, setQuote]         = useState<CheckoutQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    api.get<{ summary: { spend?: { currency: string } } }>('/consumer/balance')
      .then(b => setSpendCode(b.summary?.spend?.currency ?? 'ZAR'))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!charge?.merchantId) { setQuote(null); return; }
    setQuoteLoading(true);
    const params = new URLSearchParams({
      merchantId: charge.merchantId,
      chargeAmount: charge.amount,
      chargeCurrency: charge.currency,
    });
    if (charge.storeId) params.set('storeId', charge.storeId);
    const walletPay = payFrom ? legToCurrency(payFrom, spendCode) : undefined;
    const payCur = charge.payCurrency ?? walletPay;
    if (payCur) params.set('payCurrency', payCur);
    api.get<CheckoutQuote>(`/consumer/checkout/quote?${params}`)
      .then(setQuote)
      .catch((e: Error) => { setQuote(null); setError(e.message); })
      .finally(() => setQuoteLoading(false));
  }, [charge, payFrom, spendCode]);

  useEffect(() => {
    api.get<CatalogProduct[]>('/consumer/products')
      .then(setCatalog)
      .catch(() => setCatalog([]))
      .finally(() => setCatalogLoading(false));
  }, []);

  function onScan(text: string) {
    setScanning(false); setError('');
    try {
      const p = JSON.parse(text) as {
        imali?: unknown; to?: string; amt?: string; cur?: string; settle?: string; n?: string; mid?: string; sid?: string;
        store?: string; till?: string; lat?: number; lng?: number;
        items?: { n: string; q: number; p: number }[];
      };
      if (p && p.imali && p.to && p.amt) {
        const currency = (p.cur ?? 'ZAR').toUpperCase();
        const settle = p.settle ? String(p.settle).toUpperCase() : undefined;
        setCharge({
          to: String(p.to), amount: String(p.amt), currency,
          payCurrency: settle && settle !== currency ? settle : undefined,
          merchant: p.n ? String(p.n) : 'Merchant',
          merchantId: p.mid, storeId: p.sid, store: p.store, till: p.till, lat: p.lat, lng: p.lng,
          items: Array.isArray(p.items) ? p.items.map(i => ({ name: i.n, qty: i.q, unitPrice: i.p })) : [],
        });
        setPicked(null);
        return;
      }
    } catch { /* not an iMali pay-request */ }
    setError(`That’s not a ${getAppName()} payment QR. Ask the cashier to show the “Scan to pay” code.`);
  }

  function pickProduct(p: CatalogProduct) {
    setError('');
    setPicked(p);
    if (p.isFixedPrice && p.price != null) setAmountInput(String(p.price));
    else setAmountInput(p.minAmount != null ? String(p.minAmount) : '');
  }

  function confirmCatalogPurchase() {
    if (!picked) return;
    const cur = picked.currency.toUpperCase();
    const amt = parseFloat(amountInput);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    if (picked.minAmount != null && amt < picked.minAmount) {
      setError(`Minimum is ${money(picked.minAmount, cur)}`); return;
    }
    if (picked.maxAmount != null && amt > picked.maxAmount) {
      setError(`Maximum is ${money(picked.maxAmount, cur)}`); return;
    }
    if (!picked.walletAddress) { setError('This merchant cannot accept payments yet.'); return; }

    setCharge({
      to: picked.walletAddress,
      amount: amt.toFixed(2),
      currency: cur,
      merchant: picked.merchantName,
      merchantId: picked.merchantId,
      productId: picked.id,
      items: [{ name: picked.name, qty: 1, unitPrice: amt }],
    });
    setPicked(null);
  }

  async function pay() {
    if (!charge) return;
    if (!isPasskeySupported()) { setError('Passkeys aren’t supported on this device.'); return; }
    if (quoteLoading) return;
    if (charge.merchantId && !quote) { setError('Could not load payment quote — try again'); return; }

    const payCurrency = quote?.crossBorder ? quote.payCurrency : charge.currency;
    const payAmount = quote?.crossBorder ? quote.payAmount : charge.amount;
    const walletPay = payFrom ? legToCurrency(payFrom, spendCode) : null;
    if (walletPay && walletPay !== payCurrency) {
      setError(`This purchase is paid in ${payCurrency} — open Purchase from that wallet on Home`);
      return;
    }

    setLoading(true); setError(''); setPayStep('prepare');
    try {
      setResult(await executeTransfer({
        to: charge.to, amount: payAmount, currency: payCurrency,
        sale: {
          merchantId: charge.merchantId, productId: charge.productId,
          storeId: charge.storeId, storeNumber: charge.store, tillNumber: charge.till,
          lat: charge.lat, lng: charge.lng, items: charge.items,
          chargeAmount: charge.amount,
          chargeCurrency: charge.currency,
        },
      }, setPayStep));
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (msg.includes('INSUFFICIENT_BALANCE') || msg.includes('Insufficient')) setError('You don’t have enough balance for this purchase.');
      else if (msg.includes('QUOTE_STALE')) setError('The rate changed — close and scan again.');
      else if (msg.includes('FX_UNAVAILABLE')) setError('Exchange rate is unavailable right now — try again shortly.');
      else if (msg.includes('cancelled')) setError('Approval was cancelled. Try again.');
      else if (msg.includes('SENDER_UNREGISTERED')) setError('Your account isn’t registered yet.');
      else setError(msg || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      setPayStep(null);
    }
  }

  if (result) {
    const paidCur = quote?.crossBorder ? quote.payCurrency : charge?.currency ?? 'ZAR';
    const paidAmt = quote?.crossBorder ? quote.payAmount : charge?.amount ?? '0';
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-6 shadow-xl text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-full bg-brand-accent/10 flex items-center justify-center">
            <CheckCircle2 size={44} className="text-brand-accent" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-brand-accent">
              Paid {money(parseFloat(paidAmt), paidCur)}
            </h2>
            {quote?.crossBorder && charge && (
              <p className="text-brand-accent/70 text-sm">
                Cash value {money(parseFloat(charge.amount), charge.currency)}
              </p>
            )}
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

  if (loading && payStep) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-5 shadow-xl">
          <PaymentProgress steps={PAYMENT_STEPS} currentId={payStep} title="Processing payment" />
        </div>
      </div>
    );
  }

  if (charge) {
    const chargeTotal = parseFloat(charge.amount);
    const crossBorder = quote?.crossBorder ?? false;
    const payTotal = crossBorder ? parseFloat(quote!.payAmount) : chargeTotal;
    const payCur = crossBorder ? quote!.payCurrency : charge.currency;

    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-brand-accent">Confirm payment</h2>
            <button onClick={() => { setCharge(null); setQuote(null); setError(''); }} aria-label="Cancel"><X size={20} className="text-brand-accent/60" /></button>
          </div>
          <div className="text-center space-y-1">
            {crossBorder ? (
              <>
                <p className="text-brand-accent/70 text-sm">Cash / purchase value</p>
                <p className="text-3xl font-bold text-brand-accent">{money(chargeTotal, charge.currency)}</p>
                <p className="text-brand-accent/70 text-sm pt-2">You pay</p>
                <p className="text-2xl font-bold text-brand-accent">{money(payTotal, payCur)}</p>
                <p className="text-xs text-brand-accent/60">
                  1 {payCur} = {quote!.fxRate.toFixed(2)} {charge.currency}
                  {quote!.fxAsOf ? ` · ${new Date(quote!.fxAsOf).toLocaleTimeString()}` : ''}
                </p>
              </>
            ) : (
              <>
                <p className="text-brand-accent/70 text-sm">Pay</p>
                <p className="text-3xl font-bold text-brand-accent">{money(chargeTotal, charge.currency)}</p>
              </>
            )}
            <p className="text-brand-accent/70 text-sm">to <span className="font-semibold">{charge.merchant}</span></p>
            {payFrom && (
              <p className="text-xs text-brand-accent/50">
                Paying from {payFrom === 'USDC' ? 'USD' : payFrom === 'ZAR' ? 'Rand' : spendCode} wallet
              </p>
            )}
          </div>
          {quoteLoading && (
            <p className="text-center text-sm text-brand-accent/60">Loading rate…</p>
          )}
          {charge.items.length > 0 && (
            <div className="bg-white rounded-xl divide-y divide-brand-accent/10 border border-brand-accent/10">
              {charge.items.map((it, i) => (
                <div key={i} className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-brand-accent">{it.name}</span>
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
          <button onClick={pay} disabled={loading || quoteLoading || (charge.merchantId != null && !quote)} className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform disabled:opacity-40">
            {loading ? 'Paying…' : `Pay ${money(payTotal, payCur)}`}
          </button>
        </div>
      </div>
    );
  }

  if (picked) {
    const cur = picked.currency.toUpperCase();
    return (
      <div className="min-h-dvh flex flex-col px-6 pt-14 pb-24 bg-brand-bg">
        <button onClick={() => { setPicked(null); setError(''); }} className="text-white/80 text-sm mb-4 self-start">← Back</button>
        <h1 className="text-2xl font-bold text-white mb-1">{picked.name}</h1>
        <p className="text-white/70 text-sm mb-6">{picked.merchantName}</p>
        <div className="bg-brand-accent rounded-2xl p-5 space-y-4 text-white">
          {picked.isFixedPrice ? (
            <p className="text-2xl font-bold text-white">{priceHint(picked)}</p>
          ) : (
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">
                Amount ({picked.minAmount != null && picked.maxAmount != null
                  ? `${money(picked.minAmount, cur)} – ${money(picked.maxAmount, cur)}`
                  : 'enter amount'})
              </label>
              <input
                type="number" min={picked.minAmount ?? 0} max={picked.maxAmount ?? undefined}
                step="0.01" value={amountInput}
                onChange={e => setAmountInput(e.target.value)}
                className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-lg font-semibold text-white placeholder:text-white/40"
              />
            </div>
          )}
          {error && <p className="text-red-200 text-sm">{error}</p>}
          <button
            onClick={confirmCatalogPurchase}
            className="w-full py-3.5 rounded-2xl bg-white text-brand-accent font-semibold"
          >
            Continue
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh pb-24 px-6 pt-14 bg-brand-bg">
      {scanning && <QrScanner onResult={onScan} onClose={() => setScanning(false)} />}
      <h1 className="text-3xl font-bold text-white mb-2">Buy</h1>
      <p className="text-white/80 text-sm mb-6">Pay a merchant in store, or buy from a product in your country.</p>

      <button
        onClick={() => { setError(''); setScanning(true); }}
        className="flex items-center justify-center gap-3 w-full px-4 py-4 rounded-2xl bg-brand-accent text-white font-semibold active:scale-[0.98] transition-transform mb-6"
      >
        <QrCode size={22} /> Scan merchant QR
      </button>

      {error && (
        <div className="flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-3 py-2 text-white text-sm mb-4">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
        <Store size={18} /> Products near you
      </h2>

      {catalogLoading ? (
        <p className="text-white/60 text-sm">Loading products…</p>
      ) : catalog.length === 0 ? (
        <p className="text-white/60 text-sm">No mobile or delivery products available in your country yet.</p>
      ) : (
        <div className="space-y-2">
          {catalog.map(p => (
            <button
              key={p.id}
              onClick={() => pickProduct(p)}
              className="w-full flex items-center gap-3 bg-brand-accent rounded-2xl px-4 py-4 text-left text-white active:scale-[0.98] transition-transform"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{p.name}</p>
                <p className="text-xs text-white/70 truncate">{p.merchantName}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-white tabular-nums">{priceHint(p)}</p>
                {deliveryTag[p.deliveryType] && (
                  <p className="text-[10px] uppercase tracking-wide text-white/60">{deliveryTag[p.deliveryType]}</p>
                )}
              </div>
              <ChevronRight size={18} className="text-white/50 shrink-0" />
            </button>
          ))}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
