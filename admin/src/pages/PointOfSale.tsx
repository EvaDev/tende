import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useRole } from '@/hooks/useRole';
import { useMerchant } from '@/hooks/useMerchant';

interface Product { id: string; name: string; price: string; currency_code: string; is_active?: boolean }

// Merchant Point of Sale. The teller rings up products by quantity — e.g. a
// "Cash out" unit-price product (R1) × N for a cash withdrawal. "Charge" shows a QR
// the customer scans in the iMali app to pay the total ZAR to the merchant wallet
// (the merchant is then settled on-chain; for cash-out the teller hands over cash).
export default function PointOfSale() {
  const { role, resolved } = useRole();
  const { merchant } = useMerchant(role === 'merchant');

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [charging, setCharging] = useState(false);

  const [adding, setAdding] = useState(false);
  const [pName, setPName]   = useState('');
  const [pPrice, setPPrice] = useState('1');
  const [err, setErr]       = useState('');

  function load() { apiFetch<Product[]>('/api/merchants/me/products').then(setProducts).catch(() => {}); }
  useEffect(() => { if (role === 'merchant') load(); }, [role]);

  // products.price is stored in minor units (cents) → Rand = price / 100.
  const unitRand = (p: Product) => Number(p.price) / 100;
  const setQty = (id: string, q: number) => setCart(c => ({ ...c, [id]: Math.max(0, q) }));
  const total  = products.reduce((s, p) => s + (cart[p.id] ?? 0) * unitRand(p), 0);

  async function addProduct() {
    setErr('');
    if (!pName.trim() || !(Number(pPrice) > 0)) { setErr('Enter a name and a positive unit price'); return; }
    try {
      await apiFetch('/api/merchants/me/products', { method: 'POST', body: JSON.stringify({ name: pName.trim(), unitPrice: Number(pPrice) }) });
      setPName(''); setPPrice('1'); setAdding(false); load();
    } catch (e) { setErr((e as Error).message); }
  }

  // QR the customer scans in the iMali app to pay the merchant wallet.
  const payload = merchant
    ? JSON.stringify({ imali: 1, to: merchant.wallet_address, amt: total.toFixed(2), cur: 'ZAR', n: merchant.name })
    : '';

  if (resolved && role !== 'merchant') {
    return <p className="text-sm text-white/90">Point of Sale is for merchant accounts. Connect your merchant wallet to ring up sales.</p>;
  }
  if (!merchant) return <p className="text-sm text-white/90">Loading your store…</p>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Point of Sale</h2>
          <p className="text-sm text-white/80">{merchant.name}</p>
        </div>
        <Button size="sm" onClick={() => setAdding(v => !v)}>{adding ? 'Cancel' : '+ Add product'}</Button>
      </div>

      {adding && (
        <Card className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Product name</Label><Input value={pName} onChange={e => setPName(e.target.value)} placeholder="e.g. Cash out" /></div>
            <div><Label>Unit price (R)</Label><Input type="number" value={pPrice} min="0" step="0.01" onChange={e => setPPrice(e.target.value)} /></div>
          </div>
          <p className="text-xs text-gray-400">For cash-out, add a “Cash out” product at R1 — the teller rings up the cash amount as the quantity.</p>
          {err && <p className="text-brand-danger text-sm">{err}</p>}
          <Button onClick={addProduct}>Save product</Button>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {products.length === 0 ? (
          <p className="text-gray-500 text-sm p-6 text-center">No products yet. Add a “Cash out” product (R1 / unit) to ring up amounts.</p>
        ) : (
          <div className="divide-y">
            {products.map(p => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500">R{unitRand(p).toFixed(2)} each</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setQty(p.id, (cart[p.id] ?? 0) - 1)} className="w-9 h-9 rounded-lg border border-gray-300 text-lg font-bold text-gray-600 active:scale-90">−</button>
                  <span className="w-8 text-center font-semibold">{cart[p.id] ?? 0}</span>
                  <button onClick={() => setQty(p.id, (cart[p.id] ?? 0) + 1)} className="w-9 h-9 rounded-lg border border-gray-300 text-lg font-bold text-gray-600 active:scale-90">+</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between bg-brand-card rounded-xl px-5 py-4">
        <span className="text-lg font-semibold text-gray-700">Total</span>
        <span className="text-2xl font-bold text-brand-accent">R{total.toFixed(2)}</span>
      </div>
      <Button onClick={() => setCharging(true)} disabled={total <= 0} className="w-full">Charge R{total.toFixed(2)}</Button>

      {/* Charge QR — customer scans to pay */}
      {charging && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6" onClick={() => setCharging(false)}>
          <div className="w-full max-w-xs bg-white rounded-2xl p-6 text-center space-y-3 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end -mt-2 -mr-2"><button onClick={() => setCharging(false)} aria-label="Close"><X size={18} className="text-gray-400" /></button></div>
            <p className="font-semibold text-brand-accent">Scan to pay</p>
            <div className="flex justify-center"><QRCodeSVG value={payload} size={200} fgColor="#3D1919" bgColor="#FFFFFF" level="M" /></div>
            <p className="text-3xl font-bold text-brand-accent">R{total.toFixed(2)}</p>
            <p className="text-xs text-gray-500">Customer pays {merchant.name} from the iMali app</p>
            <Button onClick={() => { setCharging(false); setCart({}); }} className="w-full">Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}
