import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { QRCodeSVG } from 'qrcode.react';
import { X, Share2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useMerchantProfile } from '@/hooks/useMerchantProfile';
import { useMember } from '@/hooks/useMember';
import { getAppName } from '@/lib/brand';
import { Link } from 'react-router-dom';

interface Product {
  id: string; name: string; price: number | null; currency_code: string; is_active?: boolean;
  delivery_type?: string; is_fixed_price?: boolean; min_price?: number | null; max_price?: number | null;
}

interface MerchantStore {
  id: string; storeCode: string; name: string; countryCode: string; currencyCode: string; isActive: boolean;
}

type ChangeMode = 'qr' | 'tag';

const SYM: Record<string, string> = { ZAR: 'R', MWK: 'MK', USD: '$', USDC: '$' };
function money(n: number, currency: string) {
  const sym = SYM[currency.toUpperCase()] ?? currency;
  return `${sym}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}
function isCashOut(p: Product) {
  return /cash\s*out/i.test(p.name);
}

export default function PointOfSale() {
  const { merchant } = useMerchantProfile();
  const { isOrgAdmin } = useMember();

  const [stores, setStores] = useState<MerchantStore[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [activeStoreId, setActiveStoreId] = useState(() => localStorage.getItem('pos.storeId') ?? '');

  const [products, setProducts] = useState<Product[]>([]);
  const [voucherProducts, setVoucherProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [charging, setCharging] = useState(false);

  const [tillNumber, setTillNumber] = useState(() => localStorage.getItem('pos.till') ?? '');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);

  const [changeOpen, setChangeOpen] = useState(false);
  const [changeMode, setChangeMode] = useState<ChangeMode>('qr');
  const [changeProductId, setChangeProductId] = useState('');
  const [changeAmount, setChangeAmount] = useState('');
  const [changeTag, setChangeTag] = useState('');
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState('');
  const [changeQr, setChangeQr] = useState<{ payload: string; amount: string; currency: string; link: string } | null>(null);
  const [changeSent, setChangeSent] = useState<string | null>(null);

  const activeStore = useMemo(
    () => stores.find(s => s.id === activeStoreId) ?? null,
    [stores, activeStoreId],
  );
  const storeCurrency = activeStore?.currencyCode ?? 'ZAR';
  const settleCurrency = (merchant?.settlement_currency ?? merchant?.currency_code ?? storeCurrency).toUpperCase();
  const crossBorderSettle = Boolean(activeStore && settleCurrency !== storeCurrency.toUpperCase());

  useEffect(() => { localStorage.setItem('pos.storeId', activeStoreId); }, [activeStoreId]);
  useEffect(() => { localStorage.setItem('pos.till', tillNumber); }, [tillNumber]);

  function openCharge() {
    if (!activeStore) return;
    setGeo(null);
    setCharging(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setGeo({ lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) }),
        () => setGeo(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
      );
    }
  }

  function load() {
    Promise.all([
      apiFetch<MerchantStore[]>('/api/merchant/me/stores'),
      apiFetch<Product[]>('/api/merchant/me/products'),
    ])
      .then(([storeRows, all]) => {
        setStores(storeRows);
        const savedId = localStorage.getItem('pos.storeId') ?? '';
        const savedValid = savedId && storeRows.some(s => s.id === savedId);
        const headOffice = storeRows.find(s => s.storeCode === 'HO');
        if (savedValid) {
          setActiveStoreId(savedId);
        } else if (headOffice && isOrgAdmin) {
          setActiveStoreId(headOffice.id);
        } else if (storeRows.length === 1) {
          setActiveStoreId(storeRows[0].id);
        } else if (storeRows.length) {
          setActiveStoreId(storeRows[0].id);
        }

        const activeId = savedValid
          ? savedId
          : (headOffice && isOrgAdmin ? headOffice.id : storeRows[0]?.id);
        const cur = (storeRows.find(s => s.id === activeId)?.currencyCode ?? 'ZAR').toUpperCase();
        setProducts(all.filter(p => p.is_active !== false && p.delivery_type === 'DIRECT' && p.currency_code.toUpperCase() === cur));
        const vouchers = all.filter(p => p.is_active !== false && p.delivery_type === 'VOUCHER' && p.currency_code.toUpperCase() === cur);
        setVoucherProducts(vouchers);
        if (vouchers.length && !changeProductId) setChangeProductId(vouchers[0].id);
      })
      .catch(() => {})
      .finally(() => setStoresLoading(false));
  }

  useEffect(() => { load(); }, [isOrgAdmin]);

  useEffect(() => {
    if (!activeStore) return;
    const cur = activeStore.currencyCode.toUpperCase();
    apiFetch<Product[]>('/api/merchant/me/products')
      .then(all => {
        setProducts(all.filter(p => p.is_active !== false && p.delivery_type === 'DIRECT' && p.currency_code.toUpperCase() === cur));
        const vouchers = all.filter(p => p.is_active !== false && p.delivery_type === 'VOUCHER' && p.currency_code.toUpperCase() === cur);
        setVoucherProducts(vouchers);
        setCart({});
        if (vouchers.length) setChangeProductId(vouchers[0].id);
        else setChangeProductId('');
      })
      .catch(() => {});
  }, [activeStore?.id, activeStore?.currencyCode]);

  const unitPrice = (p: Product) => Number(p.price ?? 0);
  const maxQty = (p: Product) => {
    const unit = unitPrice(p);
    if (unit <= 0 || p.max_price == null) return Infinity;
    return Math.floor(p.max_price / unit);
  };
  const lineTotal = (p: Product) => {
    const v = cart[p.id] ?? 0;
    const unit = unitPrice(p);
    return unit > 0 ? v * unit : v;
  };
  const displayAmount = (p: Product) => {
    const amt = lineTotal(p);
    return amt > 0 ? (Number.isInteger(amt) ? String(amt) : amt.toFixed(2)) : '';
  };
  const setQty = (id: string, q: number) => {
    const p = products.find(x => x.id === id);
    const cap = p ? maxQty(p) : Infinity;
    setCart(c => ({ ...c, [id]: Math.max(0, Math.min(q, cap)) }));
  };
  const setAmountForProduct = (p: Product, amount: number) => {
    const unit = unitPrice(p);
    const cap = p.max_price ?? Infinity;
    const capped = Math.min(Math.max(0, amount), cap);
    if (unit > 0) {
      const qty = unit === 1 ? Math.round(capped) : capped / unit;
      setQty(p.id, qty);
    } else {
      setCart(c => ({ ...c, [p.id]: Math.round(capped * 100) / 100 }));
    }
  };
  const total = products.reduce((s, p) => s + lineTotal(p), 0);

  const items = products
    .filter(p => lineTotal(p) > 0)
    .map(p => {
      const unit = unitPrice(p);
      const totalLine = lineTotal(p);
      if (unit > 0) return { n: p.name, q: cart[p.id] ?? 0, p: unit };
      return { n: p.name, q: 1, p: totalLine };
    });

  const payload = merchant && activeStore
    ? JSON.stringify({
        imali: 1, to: merchant.wallet_address, amt: total.toFixed(2), cur: storeCurrency, n: merchant.name,
        mid: merchant.merchant_id,
        sid: activeStore.id,
        store: activeStore.storeCode,
        till: tillNumber.trim() || undefined,
        lat: geo?.lat, lng: geo?.lng,
        ...(crossBorderSettle ? { settle: settleCurrency } : {}),
        items,
      })
    : '';

  function openChange() {
    if (!activeStore) return;
    setChangeError('');
    setChangeSent(null);
    setChangeQr(null);
    setChangeTag('');
    setChangeAmount('');
    setChangeMode('qr');
    setChangeOpen(true);
  }

  async function issueChangeQr() {
    if (!activeStore) { setChangeError('Select a store first'); return; }
    if (!changeAmount) { setChangeError('Enter change amount'); return; }
    setChangeLoading(true);
    setChangeError('');
    try {
      const r = await apiFetch<{ qrPayload: string; amount: string; currency: string; consumerLink: string }>(
        '/api/merchant/me/change-voucher/prepare',
        {
          method: 'POST',
          body: JSON.stringify({
            amount: changeAmount,
            productId: changeProductId || undefined,
            storeId: activeStore.id,
            tillNumber: tillNumber.trim() || undefined,
          }),
        },
      );
      const consumerOrigin = window.location.origin.replace(':5175', ':5173');
      setChangeQr({
        payload: r.qrPayload,
        amount: r.amount,
        currency: r.currency,
        link: `${consumerOrigin}/#${r.consumerLink}`,
      });
    } catch (e) {
      setChangeError((e as Error).message);
    } finally {
      setChangeLoading(false);
    }
  }

  async function sendChangeTag() {
    if (!activeStore) { setChangeError('Select a store first'); return; }
    if (!changeTag.trim() || !changeAmount) { setChangeError('Enter @tag and amount'); return; }
    setChangeLoading(true);
    setChangeError('');
    try {
      await apiFetch('/api/merchant/me/change-voucher/send', {
        method: 'POST',
        body: JSON.stringify({
          tag: changeTag.trim(),
          amount: changeAmount,
          productId: changeProductId || undefined,
          storeId: activeStore.id,
          tillNumber: tillNumber.trim() || undefined,
        }),
      });
      setChangeSent(changeTag.trim().startsWith('@') ? changeTag.trim() : `@${changeTag.trim()}`);
      setChangeQr(null);
      setChangeOpen(false);
      setChangeSent(null);
      setChangeTag('');
      setChangeAmount('');
    } catch (e) {
      setChangeError((e as Error).message);
    } finally {
      setChangeLoading(false);
    }
  }

  if (!merchant) return <p className="text-sm text-white/90">Loading your store…</p>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold text-white">Point of Sale</h2>
        <p className="text-sm text-white/90">{merchant.name}</p>
      </div>

      {storesLoading ? (
        <p className="text-sm text-white/80">Loading stores…</p>
      ) : stores.length === 0 ? (
        <Card className="p-4 text-sm text-gray-600">
          No stores configured yet. Head office must add stores under{' '}
          <Link to="/my-business" className="text-brand-accent underline">My Business</Link> before you can ring up sales.
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Store</Label>
            <select
              value={activeStoreId}
              onChange={e => setActiveStoreId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.storeCode}) — {s.currencyCode}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Till number</Label>
            <Input value={tillNumber} onChange={e => setTillNumber(e.target.value)} placeholder="e.g. 3" />
          </div>
        </div>
      )}

      {activeStore && products.length > 0 && (
      <Card className="p-0 overflow-hidden">
          <div className="divide-y">
            {products.map(p => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500">
                    {isCashOut(p)
                      ? `Enter ${storeCurrency} amount`
                      : `${money(unitPrice(p), storeCurrency)} each`}
                  </p>
                </div>
                {isCashOut(p) ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-sm font-semibold text-gray-500">{SYM[storeCurrency] ?? storeCurrency}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      placeholder="0"
                      value={displayAmount(p)}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') { setCart(c => ({ ...c, [p.id]: 0 })); return; }
                        const n = parseFloat(raw);
                        if (Number.isFinite(n)) setAmountForProduct(p, n);
                      }}
                      className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-right text-lg font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-brand-accent/40"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setQty(p.id, (cart[p.id] ?? 0) - 1)} className="w-9 h-9 rounded-lg border border-gray-300 text-lg font-bold text-gray-600 active:scale-90">−</button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={maxQty(p) === Infinity ? undefined : maxQty(p)}
                      value={cart[p.id] ?? ''}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') { setCart(c => ({ ...c, [p.id]: 0 })); return; }
                        setQty(p.id, parseInt(raw, 10) || 0);
                      }}
                      className="w-16 rounded-lg border border-gray-300 px-1 py-2 text-center font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-brand-accent/40"
                    />
                    <button onClick={() => setQty(p.id, (cart[p.id] ?? 0) + 1)} className="w-9 h-9 rounded-lg border border-gray-300 text-lg font-bold text-gray-600 active:scale-90">+</button>
                  </div>
                )}
              </div>
            ))}
          </div>
      </Card>
      )}

      {activeStore && (
        <>
          <div className="flex items-center justify-between bg-brand-card rounded-xl px-5 py-4">
            <span className="text-lg font-semibold text-gray-700">Total</span>
            <span className="text-2xl font-bold text-brand-accent">{money(total, storeCurrency)}</span>
          </div>
          {crossBorderSettle && (
            <p className="text-xs text-white/80 text-center -mt-2">
              Customer can pay in {settleCurrency} at the live {settleCurrency}/{storeCurrency} rate — you receive {settleCurrency}.
            </p>
          )}
          <Button onClick={openCharge} disabled={total <= 0} className="w-full">
            Charge {money(total, storeCurrency)}
          </Button>

          {voucherProducts.length > 0 && (
            <Button variant="outline" onClick={openChange} className="w-full bg-white">
              Issue change voucher
            </Button>
          )}
        </>
      )}

      {charging && activeStore && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6" onClick={() => setCharging(false)}>
          <div className="w-full max-w-xs bg-white rounded-2xl p-6 text-center space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end -mt-2 -mr-2"><button onClick={() => setCharging(false)} aria-label="Close"><X size={18} className="text-gray-400" /></button></div>
            <p className="font-semibold text-brand-accent">Scan to pay</p>
            <div className="flex justify-center"><QRCodeSVG value={payload} size={200} fgColor="#3D1919" bgColor="#FFFFFF" level="M" /></div>
            <p className="text-3xl font-bold text-brand-accent">{money(total, storeCurrency)}</p>
            <p className="text-xs text-gray-500">{activeStore.name} · Customer pays from the {getAppName()} app</p>
            {crossBorderSettle && (
              <p className="text-xs text-gray-500">Accepts {settleCurrency} for {money(total, storeCurrency)} cash value</p>
            )}
            <Button onClick={() => { setCharging(false); setCart({}); }} className="w-full">Done</Button>
          </div>
        </div>
      )}

      {changeOpen && activeStore && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6" onClick={() => setChangeOpen(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <p className="font-semibold text-brand-accent">Change voucher</p>
              <button onClick={() => setChangeOpen(false)} aria-label="Close"><X size={18} className="text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-500">
              Issue digital change ({storeCurrency}) at {activeStore.name}. Debits your merchant in-app balance.
            </p>

            <div>
              <Label>Product</Label>
              <select
                value={changeProductId}
                onChange={e => setChangeProductId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {voucherProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Amount ({SYM[storeCurrency] ?? storeCurrency})</Label>
              <Input value={changeAmount} onChange={e => setChangeAmount(e.target.value)} placeholder="e.g. 13.00" />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setChangeMode('qr'); setChangeSent(null); setChangeQr(null); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${changeMode === 'qr' ? 'bg-brand-accent text-white' : 'border border-gray-300'}`}
              >
                Show QR
              </button>
              <button
                type="button"
                onClick={() => { setChangeMode('tag'); setChangeQr(null); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${changeMode === 'tag' ? 'bg-brand-accent text-white' : 'border border-gray-300'}`}
              >
                Send to @tag
              </button>
            </div>

            {changeError && <p className="text-sm text-red-600">{changeError}</p>}

            {changeMode === 'qr' && !changeQr && (
              <Button onClick={issueChangeQr} disabled={changeLoading} className="w-full">
                {changeLoading ? 'Creating…' : 'Generate QR'}
              </Button>
            )}

            {changeQr && (
              <div className="text-center space-y-2">
                <div className="flex justify-center"><QRCodeSVG value={changeQr.payload} size={180} fgColor="#3D1919" bgColor="#FFFFFF" level="M" /></div>
                <p className="text-2xl font-bold text-brand-accent">{money(Number(changeQr.amount), changeQr.currency)}</p>
                <p className="text-xs text-gray-500">Customer scans in Receive → Change voucher</p>
                <button
                  type="button"
                  onClick={() => navigator.share?.({ url: changeQr.link, title: 'Change voucher' })
                    .catch(() => navigator.clipboard?.writeText(changeQr.link))}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm text-brand-accent underline"
                >
                  <Share2 size={16} /> Share link (WhatsApp)
                </button>
              </div>
            )}

            {changeMode === 'tag' && (
              <>
                <div>
                  <Label>Customer @tag</Label>
                  <Input value={changeTag} onChange={e => setChangeTag(e.target.value)} placeholder="@customer" />
                </div>
                <Button onClick={sendChangeTag} disabled={changeLoading} className="w-full">
                  {changeLoading ? 'Sending…' : 'Send change'}
                </Button>
                {changeSent && (
                  <p className="text-sm text-green-700 text-center">Sent to {changeSent}</p>
                )}
              </>
            )}

            <Button variant="outline" onClick={() => setChangeOpen(false)} className="w-full">Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}
